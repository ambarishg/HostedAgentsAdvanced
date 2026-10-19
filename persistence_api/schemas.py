from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from hosted_agent.schemas import AgentResult
from shared.canonical import sha256_json


class PersistenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    user_input: str = Field(min_length=1, max_length=100_000)
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

    @field_validator("user_input")
    @classmethod
    def nonblank_input(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("user_input must not be empty.")
        return value

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
    request_id: UUID
    agent_name: str
    user_input: str
    agent_response: str | None


class InteractionHistoryResponse(BaseModel):
    items: list[InteractionHistoryItem]
    limit: int
    offset: int
    has_more: bool


class ErrorResponse(BaseModel):
    success: bool = False
    error: dict[str, str]


def canonical_payload(request: PersistenceRequest) -> dict[str, Any]:
    return request.model_dump(mode="json", exclude={"payload_hash"})


def calculate_payload_hash(request: PersistenceRequest) -> str:
    return sha256_json(canonical_payload(request))
