from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from hosted_agent.schemas import AgentResult, ContactReason, DemandDriver
from shared.canonical import sha256_json

PcrReason = ContactReason | Literal["Not identified"]
DemandDriverReason = DemandDriver


class PersistenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    user_input: str = Field(max_length=100_000)
    result_json: dict[str, Any]
    agent_name: str = Field(min_length=1, max_length=128)
    agent_version: str | None = Field(default=None, max_length=128)
    prompt_version: str | None = Field(default=None, max_length=512)
    prompt_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    schema_version: str = Field(min_length=1, max_length=64)
    metadata: dict[str, Any] | None = None
    payload_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    duration_ms: int | None = Field(default=None, ge=0, le=2**63 - 1)
    input_tokens: int | None = Field(default=None, ge=0, le=2**63 - 1)
    output_tokens: int | None = Field(default=None, ge=0, le=2**63 - 1)
    provider_response_id: str | None = Field(default=None, max_length=512)

    @field_validator("result_json")
    @classmethod
    def result_must_be_valid(cls, value: dict[str, Any]) -> dict[str, Any]:
        return AgentResult.model_validate(value).model_dump(mode="json")


class PersistenceResponse(BaseModel):
    success: bool = True
    interaction_id: UUID
    request_id: UUID
    status: str = "completed"
    duplicate: bool


class InteractionHistoryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    agent_name: str
    user_input: str
    result_json: dict[str, Any]
    primary_contact_reason: str | None = None
    demand_driver: str | None = None
    confidence: str | None = None
    evidence: list[str] = Field(default_factory=list)
    demand_driver_evidence: list[str] = Field(default_factory=list)
    vulnerability_indicator_category: list[str] = Field(default_factory=list)
    vulnerability_indicator_evidence: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def populate_result_summary_fields(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        result_json = value.get("result_json")
        if not isinstance(result_json, dict):
            return value

        result = result_json.get("result")
        if not isinstance(result, dict):
            return value

        extracted = dict(value)
        extracted.setdefault("primary_contact_reason", result.get("primary_contact_reason"))
        extracted.setdefault("demand_driver", result.get("demand_driver"))
        extracted.setdefault("confidence", result.get("confidence"))
        extracted.setdefault("evidence", result.get("evidence") or [])
        extracted.setdefault("demand_driver_evidence", result.get("demand_driver_evidence") or [])
        assessment = result.get("vulnerability_assessment")
        if isinstance(assessment, dict):
            categories = assessment.get("vulnerability_indicator_category")
            evidence = assessment.get("vulnerability_indicator_evidence")
            indicators = assessment.get("vulnerability_indicators")
            if not isinstance(categories, list) and isinstance(indicators, list):
                categories = [
                    item.get("category")
                    for item in indicators
                    if isinstance(item, dict) and isinstance(item.get("category"), str)
                ]
            if not isinstance(evidence, list) and isinstance(indicators, list):
                evidence = [
                    item.get("evidence")
                    for item in indicators
                    if isinstance(item, dict) and isinstance(item.get("evidence"), str)
                ]
            extracted.setdefault("vulnerability_indicator_category", categories or [])
            extracted.setdefault("vulnerability_indicator_evidence", evidence or [])
        return extracted


class InteractionHistoryResponse(BaseModel):
    items: list[InteractionHistoryItem]
    limit: int
    offset: int
    has_more: bool


class PcrAnalyticsItem(BaseModel):
    reason: str
    count: int = Field(ge=0)
    percentage: float = Field(ge=0, le=100)


class PcrAnalyticsResponse(BaseModel):
    items: list[PcrAnalyticsItem]
    available_reasons: list[PcrReason]
    total_count: int = Field(ge=0)


class DemandDriverAnalyticsItem(BaseModel):
    reason: str
    count: int = Field(ge=0)
    percentage: float = Field(ge=0, le=100)


class DemandDriverAnalyticsResponse(BaseModel):
    items: list[DemandDriverAnalyticsItem]
    available_reasons: list[PcrReason]
    total_count: int = Field(ge=0)


class ErrorResponse(BaseModel):
    success: bool = False
    error: dict[str, str]


def canonical_payload(request: PersistenceRequest) -> dict[str, Any]:
    return request.model_dump(mode="json", exclude={"payload_hash"})


def calculate_payload_hash(request: PersistenceRequest) -> str:
    return sha256_json(canonical_payload(request))
