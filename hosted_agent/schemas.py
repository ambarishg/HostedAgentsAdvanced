from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


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

DemandDriver = Literal[
    "Change in personal circumstances",
    "Affordability pressure",
    "Payment failure",
    "Unclear policy information",
    "Missing or delayed documentation",
    "Previous issue unresolved",
    "Failed callback",
    "Incorrect correspondence",
    "Bereavement-related administration",
    "Change in protection need",
    "Spending / affordability review",
    "Need for communication support",
    "Other",
    "Not identified",
]


class PCRClassification(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    primary_contact_reason: ContactReason | Literal["Not identified"]
    demand_driver: DemandDriver
    confidence: Literal["High", "Medium", "Low"]
    evidence: list[str]
    rationale: str = Field(min_length=1)
    secondary_reasons: list[ContactReason]
    demand_driver_evidence: list[str]
    demand_driver_rationale: str = Field(min_length=1)


class ModelAgentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: str = Field(min_length=1, max_length=64)
    result_json: PCRClassification
    summary: str | None = Field(default=None, max_length=20_000)
    warnings: list[str] = Field(default_factory=list, max_length=100)


VulnerabilityCategory = Literal[
    "Communication support",
    "Understanding information",
    "Financial difficulty",
    "Ability to interact",
    "Additional support",
    "No vulnerability indicator identified",
]


class VulnerabilityIndicator(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    category: VulnerabilityCategory
    evidence: str = Field(min_length=1)
    rationale: str = Field(min_length=1)


class VulnerabilityClassification(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    vulnerability_indicators: list[VulnerabilityIndicator] = Field(max_length=6)
    confidence: Literal["High", "Medium", "Low"]
    overall_rationale: str = Field(min_length=1)

    @field_validator("vulnerability_indicators")
    @classmethod
    def validate_indicator_categories(
        cls, indicators: list[VulnerabilityIndicator]
    ) -> list[VulnerabilityIndicator]:
        categories = [indicator.category for indicator in indicators]
        if len(categories) != len(set(categories)):
            raise ValueError("Vulnerability indicator categories must be unique.")
        no_indicator = "No vulnerability indicator identified"
        if no_indicator in categories and len(categories) != 1:
            raise ValueError("The no-indicator outcome cannot accompany other categories.")
        return indicators


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
