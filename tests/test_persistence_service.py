from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import OperationalError

from persistence_api.repository import InteractionRepository
from persistence_api.schemas import PersistenceRequest, PersistenceResponse, calculate_payload_hash
from persistence_api.service import (
    DatabaseUnavailable,
    PayloadHashMismatch,
    PersistenceService,
)


def make_request() -> PersistenceRequest:
    request = PersistenceRequest(
        request_id=uuid.uuid4(),
        user_input="an input",
        result_json={
            "schema_version": "generic-v1",
            "result": {"answer": "ok"},
            "summary": "Human-readable answer",
        },
        agent_name="test-agent",
        agent_version="1.0.0",
        prompt_version="v1",
        prompt_hash="a" * 64,
        schema_version="generic-v1",
        metadata={"source": "unit-test"},
        payload_hash="0" * 64,
        duration_ms=10,
    )
    return request.model_copy(update={"payload_hash": calculate_payload_hash(request)})


def test_service_persists_only_verified_payload_and_returns_commit(
    api_settings, monkeypatch
) -> None:
    request = make_request()
    committed = PersistenceResponse(
        interaction_id=uuid.uuid4(),
        request_id=request.request_id,
        duplicate=False,
    )
    saved = {}

    def save(self, request, *, server_payload_hash, agent_response):
        saved["request"] = request
        saved["hash"] = server_payload_hash
        saved["response"] = agent_response
        return committed

    monkeypatch.setattr(InteractionRepository, "save", save)
    service = PersistenceService(api_settings, engine=None)

    response = service.save(request)

    assert response == committed
    assert saved["hash"] == request.payload_hash
    assert saved["response"] == "Human-readable answer"


def test_service_rejects_forged_hash_before_database_write(api_settings, monkeypatch) -> None:
    request = make_request().model_copy(update={"payload_hash": "f" * 64})

    def fail_if_called(*args, **kwargs):
        pytest.fail("database must not be called for a forged payload hash")

    monkeypatch.setattr(InteractionRepository, "save", fail_if_called)
    service = PersistenceService(api_settings, engine=None)

    with pytest.raises(PayloadHashMismatch):
        service.save(request)


def test_service_maps_database_connection_failure_safely(api_settings, monkeypatch) -> None:
    def fail(self, *args, **kwargs):
        raise OperationalError("insert", {}, RuntimeError("connection unavailable"))

    monkeypatch.setattr(InteractionRepository, "save", fail)
    service = PersistenceService(api_settings, engine=None)

    with pytest.raises(DatabaseUnavailable, match="temporarily unavailable"):
        service.save(make_request())
