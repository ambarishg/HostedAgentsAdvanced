from __future__ import annotations

import json
import uuid

import azure.functions as func
import pytest

import function_app
from persistence_api.auth import AuthenticationError
from persistence_api.schemas import (
    InteractionHistoryItem,
    InteractionHistoryResponse,
)


def make_request(*, params: dict[str, str] | None = None) -> func.HttpRequest:
    return func.HttpRequest(
        method="GET",
        url="http://localhost/api/agent-interactions",
        headers={},
        params=params or {},
        route_params={},
        body=b"",
    )


def test_history_endpoint_returns_interactions(api_settings, monkeypatch) -> None:
    item = InteractionHistoryItem(
        request_id=uuid.uuid4(),
        agent_name="test-agent",
        user_input="What happened?",
        result_json={
            "schema_version": "generic-v1",
            "result": {"primary_contact_reason": "Policy status"},
        },
    )
    expected = InteractionHistoryResponse(items=[item], limit=25, offset=50, has_more=True)

    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            assert authorization is None

    class Service:
        def list_interactions(self, *, limit: int, offset: int) -> InteractionHistoryResponse:
            assert (limit, offset) == (25, 50)
            return expected

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(function_app, "_persistence_service", lambda: Service())

    response = function_app.list_agent_interactions(
        make_request(params={"limit": "25", "offset": "50"})
    )

    assert response.status_code == 200
    assert json.loads(response.get_body()) == expected.model_dump(mode="json")


def test_history_endpoint_requires_valid_pagination(api_settings, monkeypatch) -> None:
    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            return None

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(
        function_app,
        "_persistence_service",
        lambda: pytest.fail("service must not run for invalid pagination"),
    )

    response = function_app.list_agent_interactions(make_request(params={"limit": "101"}))

    assert response.status_code == 400
    assert json.loads(response.get_body())["error"]["code"] == "invalid_pagination"


def test_history_endpoint_rejects_unauthenticated_caller(api_settings, monkeypatch) -> None:
    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            raise AuthenticationError("authentication_required", 401)

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(
        function_app,
        "_persistence_service",
        lambda: pytest.fail("service must not run for unauthenticated callers"),
    )

    response = function_app.list_agent_interactions(make_request())

    assert response.status_code == 401
    assert json.loads(response.get_body())["error"]["code"] == "authentication_required"
