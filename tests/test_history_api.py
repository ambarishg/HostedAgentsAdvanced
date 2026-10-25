from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from typing import get_args

import azure.functions as func
import pytest

import function_app
from hosted_agent.schemas import ContactReason, DemandDriver, VulnerabilityCategory
from persistence_api.auth import AuthenticationError
from persistence_api.schemas import (
    DemandDriverAnalyticsResponse,
    InteractionHistoryItem,
    InteractionHistoryResponse,
    PcrAnalyticsResponse,
    VulnerabilityAnalyticsResponse,
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
        created_at=datetime(2025, 1, 1, tzinfo=UTC),
        result_json={
            "schema_version": "generic-v1",
            "result": {
                "primary_contact_reason": "Policy status",
                "demand_driver": "Payment failure",
                "confidence": "High",
                "evidence": ["The customer asked about their policy status."],
                "demand_driver_evidence": ["The customer mentioned a failed payment."],
                "vulnerability_assessment": {
                    "vulnerability_indicator_category": ["Financial difficulty"],
                    "vulnerability_indicator_evidence": ["The customer cannot afford the premium."],
                },
            },
        },
    )
    assert item.vulnerability_indicator_category == ["Financial difficulty"]
    assert item.vulnerability_indicator_evidence == ["The customer cannot afford the premium."]
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


def test_pcr_analytics_endpoint_passes_filters_to_service(api_settings, monkeypatch) -> None:
    expected = PcrAnalyticsResponse(
        items=[{"reason": "Policy status", "count": 3, "percentage": 100}],
        available_reasons=[*get_args(ContactReason), "Not identified"],
        total_count=3,
    )

    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            assert authorization is None

    class Service:
        def pcr_analytics(
            self,
            *,
            start_date: date | None,
            end_date: date | None,
            contact_reasons: list[str],
        ) -> PcrAnalyticsResponse:
            assert start_date == date(2025, 1, 1)
            assert end_date == date(2025, 1, 31)
            assert contact_reasons == ["Policy status", "Complaint"]
            return expected

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(function_app, "_persistence_service", lambda: Service())

    response = function_app.get_pcr_analytics(
        make_request(
            params={
                "start_date": "2025-01-01",
                "end_date": "2025-01-31",
                "contact_reasons": "Policy status,Complaint,Policy status",
            }
        )
    )

    assert response.status_code == 200
    assert json.loads(response.get_body()) == expected.model_dump(mode="json")


def test_demand_driver_analytics_endpoint_passes_filters_to_service(
    api_settings, monkeypatch
) -> None:
    expected = DemandDriverAnalyticsResponse(
        items=[{"reason": "Payment failure", "count": 2, "percentage": 100}],
        available_categories=list(get_args(DemandDriver)),
        total_count=2,
    )

    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            assert authorization is None

    class Service:
        def demand_driver_analytics(
            self,
            *,
            start_date: date | None,
            end_date: date | None,
            categories: list[str],
        ) -> DemandDriverAnalyticsResponse:
            assert start_date == date(2025, 2, 1)
            assert end_date == date(2025, 2, 28)
            assert categories == ["Payment failure", "Affordability pressure"]
            return expected

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(function_app, "_persistence_service", lambda: Service())

    response = function_app.get_demand_driver_analytics(
        make_request(
            params={
                "start_date": "2025-02-01",
                "end_date": "2025-02-28",
                "categories": "Payment failure,Affordability pressure,Payment failure",
            }
        )
    )

    assert response.status_code == 200
    assert json.loads(response.get_body()) == expected.model_dump(mode="json")


def test_demand_driver_analytics_endpoint_rejects_invalid_category(
    api_settings, monkeypatch
) -> None:
    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            return None

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(
        function_app,
        "_persistence_service",
        lambda: pytest.fail("service must not run for an invalid demand driver category"),
    )

    response = function_app.get_demand_driver_analytics(
        make_request(params={"categories": "Unknown"})
    )

    assert response.status_code == 400
    assert json.loads(response.get_body())["error"]["code"] == "invalid_demand_driver_category"


def test_vulnerability_analytics_endpoint_passes_filters_to_service(
    api_settings, monkeypatch
) -> None:
    expected = VulnerabilityAnalyticsResponse(
        items=[{"reason": "Financial difficulty", "count": 2, "percentage": 100}],
        available_categories=list(get_args(VulnerabilityCategory)),
        total_count=2,
    )

    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            assert authorization is None

    class Service:
        def vulnerability_analytics(
            self,
            *,
            start_date: date | None,
            end_date: date | None,
            categories: list[str],
        ) -> VulnerabilityAnalyticsResponse:
            assert start_date == date(2025, 3, 1)
            assert end_date == date(2025, 3, 31)
            assert categories == ["Financial difficulty", "Communication support"]
            return expected

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(function_app, "_persistence_service", lambda: Service())

    response = function_app.get_vulnerability_analytics(
        make_request(
            params={
                "start_date": "2025-03-01",
                "end_date": "2025-03-31",
                "categories": ("Financial difficulty,Communication support,Financial difficulty"),
            }
        )
    )

    assert response.status_code == 200
    assert json.loads(response.get_body()) == expected.model_dump(mode="json")


def test_vulnerability_analytics_endpoint_rejects_invalid_category(
    api_settings, monkeypatch
) -> None:
    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            return None

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(
        function_app,
        "_persistence_service",
        lambda: pytest.fail("service must not run for an invalid vulnerability category"),
    )

    response = function_app.get_vulnerability_analytics(
        make_request(params={"categories": "Unknown"})
    )

    assert response.status_code == 400
    assert json.loads(response.get_body())["error"]["code"] == "invalid_vulnerability_category"


@pytest.mark.parametrize(
    ("params", "error_code"),
    [
        ({"start_date": "not-a-date"}, "invalid_date_range"),
        ({"start_date": "2025-02-01", "end_date": "2025-01-31"}, "invalid_date_range"),
        ({"contact_reasons": "Unknown"}, "invalid_contact_reason"),
    ],
)
def test_pcr_analytics_endpoint_rejects_invalid_filters(
    api_settings, monkeypatch, params: dict[str, str], error_code: str
) -> None:
    class TokenValidator:
        def validate(self, authorization: str | None) -> None:
            return None

    monkeypatch.setattr(function_app, "get_settings", lambda: api_settings)
    monkeypatch.setattr(function_app, "_token_validator", lambda: TokenValidator())
    monkeypatch.setattr(
        function_app,
        "_persistence_service",
        lambda: pytest.fail("service must not run for invalid analytics filters"),
    )

    response = function_app.get_pcr_analytics(make_request(params=params))

    assert response.status_code == 400
    assert json.loads(response.get_body())["error"]["code"] == error_code
