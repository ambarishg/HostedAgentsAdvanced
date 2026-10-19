from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class ExternalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID = Field(default_factory=uuid4)
    user_input: str
    metadata: dict[str, Any] | None = None


class AgentResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: str = Field(min_length=1, max_length=64)
    result: dict[str, Any]
    summary: str | None = Field(default=None, max_length=20_000)
    warnings: list[str] = Field(default_factory=list, max_length=100)


ContactReason = Literal[
    "Policy information / clarification",
    "Policy status",
    "Policy administration change",
    "Premium / payment query",
    "Payment difficulty",
    "Document request",
    "Complaint",
    "Service recovery",
    "Cancellation enquiry",
    "Cover change enquiry",
    "Beneficiary / nomination query",
    "Communication support request",
    "Other",
]


class PCRClassification(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    primary_contact_reason: ContactReason | Literal["Not identified"]
    confidence: Literal["High", "Medium", "Low"]
    evidence: list[str]
    rationale: str = Field(min_length=1)
    secondary_reasons: list[ContactReason]


class ModelAgentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: str = Field(min_length=1, max_length=64)
    result_json: PCRClassification
    summary: str | None = Field(default=None, max_length=20_000)
    warnings: list[str] = Field(default_factory=list, max_length=100)


class AgentExecutionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool = True
    status: str = "completed"
    request_id: UUID
    interaction_id: UUID
    agent_name: str
    agent_version: str
    prompt_version: str
    schema_version: str
    result: dict[str, Any]
    summary: str | None = None
    warnings: list[str] = Field(default_factory=list)
    duration_ms: int = Field(ge=0)
    completed_at: datetime
