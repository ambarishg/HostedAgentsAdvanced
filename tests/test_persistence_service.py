from __future__ import annotations

import uuid
from datetime import date
from typing import get_args

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import OperationalError

from hosted_agent.schemas import DemandDriver
from persistence_api.repository import InteractionRepository
from persistence_api.schemas import PersistenceRequest, PersistenceResponse, calculate_payload_hash
from persistence_api.service import (
    DatabaseUnavailable,
    PayloadHashMismatch,
    PersistenceService,
)


def test_vulnerability_analytics_query_names_the_expanded_category_column() -> None:
    class Result:
        def mappings(self):
            return self

        def all(self):
            return [{"reason": "Financial difficulty", "count": 2}]

    class Connection:
        def execute(self, statement):
            compiled = statement.compile(dialect=postgresql.dialect())
            sql = str(compiled)
            assert "AS vulnerability_categories(category)" in sql
            assert "jsonb_array_elements_text" in sql
            assert ["Financial difficulty"] in compiled.params.values()
            return Result()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class Engine:
        def connect(self):
            return Connection()

    rows = InteractionRepository(Engine()).vulnerability_analytics(
        start_date=date(2025, 1, 1),
        end_date=date(2025, 1, 31),
        categories=["Financial difficulty"],
    )

    assert rows == [{"reason": "Financial difficulty", "count": 2}]


def test_demand_driver_analytics_query_filters_by_selected_categories() -> None:
    class Result:
        def mappings(self):
            return self

        def all(self):
            return [{"reason": "Payment failure", "count": 2}]

    class Connection:
        def execute(self, statement):
            compiled = statement.compile(dialect=postgresql.dialect())
            sql = str(compiled)
            assert "->>" in sql
            assert ["Payment failure"] in compiled.params.values()
            return Result()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class Engine:
        def connect(self):
            return Connection()

    rows = InteractionRepository(Engine()).demand_driver_analytics(
        start_date=date(2025, 1, 1),
        end_date=date(2025, 1, 31),
        categories=["Payment failure"],
    )

    assert rows == [{"reason": "Payment failure", "count": 2}]


def test_service_returns_demand_driver_category_options_and_aggregates(
    api_settings, monkeypatch
) -> None:
    def demand_driver_analytics(
        self,
        *,
        start_date: date | None,
        end_date: date | None,
        categories: list[str],
    ) -> list[dict[str, int | str]]:
        assert start_date is None
        assert end_date is None
        assert categories == []
        return [{"reason": "Payment failure", "count": 2}]

    monkeypatch.setattr(InteractionRepository, "demand_driver_analytics", demand_driver_analytics)
    service = PersistenceService(api_settings, engine=None)

    response = service.demand_driver_analytics(
        start_date=None,
        end_date=None,
        categories=[],
    )

    assert response.total_count == 2
    assert response.available_categories == list(get_args(DemandDriver))
    assert [(item.reason, item.count, item.percentage) for item in response.items] == [
        ("Payment failure", 2, 100),
    ]


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


def test_service_returns_backend_aggregates_and_percentages(api_settings, monkeypatch) -> None:
    def pcr_analytics(
        self,
        *,
        start_date: date | None,
        end_date: date | None,
        contact_reasons: list[str],
    ) -> list[dict[str, int | str]]:
        assert start_date == date(2025, 1, 1)
        assert end_date == date(2025, 1, 31)
        assert contact_reasons == []
        return [{"reason": "Policy status", "count": 3}, {"reason": "Complaint", "count": 1}]

    monkeypatch.setattr(InteractionRepository, "pcr_analytics", pcr_analytics)
    service = PersistenceService(api_settings, engine=None)

    response = service.pcr_analytics(
        start_date=date(2025, 1, 1),
        end_date=date(2025, 1, 31),
        contact_reasons=[],
    )

    assert response.total_count == 4
    assert [(item.reason, item.count, item.percentage) for item in response.items] == [
        ("Policy status", 3, 75),
        ("Complaint", 1, 25),
    ]


def test_service_returns_vulnerability_category_aggregates(api_settings, monkeypatch) -> None:
    def vulnerability_analytics(
        self,
        *,
        start_date: date | None,
        end_date: date | None,
        categories: list[str],
    ) -> list[dict[str, int | str]]:
        assert start_date == date(2025, 1, 1)
        assert end_date == date(2025, 1, 31)
        assert categories == ["Financial difficulty"]
        return [
            {"reason": "Financial difficulty", "count": 3},
            {"reason": "Communication support", "count": 1},
        ]

    monkeypatch.setattr(InteractionRepository, "vulnerability_analytics", vulnerability_analytics)
    service = PersistenceService(api_settings, engine=None)

    response = service.vulnerability_analytics(
        start_date=date(2025, 1, 1),
        end_date=date(2025, 1, 31),
        categories=["Financial difficulty"],
    )

    assert response.total_count == 4
    assert [(item.reason, item.count, item.percentage) for item in response.items] == [
        ("Financial difficulty", 3, 75),
        ("Communication support", 1, 25),
    ]
