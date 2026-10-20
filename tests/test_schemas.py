from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from hosted_agent.schemas import AgentResult, ExternalRequest, ModelAgentOutput, PCRClassification
from persistence_api.schemas import PersistenceRequest, calculate_payload_hash


def test_external_request_generates_uuid_and_accepts_empty_transcript() -> None:
    request = ExternalRequest(user_input="hello")
    empty_request = ExternalRequest(user_input="")

    assert isinstance(request.request_id, uuid.UUID)
    assert empty_request.user_input == ""


def test_agent_result_rejects_extra_fields_and_non_object_result() -> None:
    with pytest.raises(ValidationError):
        AgentResult.model_validate({"schema_version": "v1", "result": [], "other": "value"})


def test_model_agent_output_schema_is_compatible_with_strict_json_schema() -> None:
    schema = ModelAgentOutput.model_json_schema()

    assert schema["additionalProperties"] is False
    assert schema["properties"]["result_json"]["$ref"] == "#/$defs/PCRClassification"
    assert all(
        definition.get("additionalProperties") is not True
        for definition in schema.get("$defs", {}).values()
    )


def test_pcr_classification_enforces_exact_fields_and_not_identified_value() -> None:
    classification = PCRClassification(
        primary_contact_reason="Not identified",
        demand_driver="Not identified",
        confidence="Low",
        evidence=[],
        rationale="The transcript does not provide enough information.",
        secondary_reasons=[],
        demand_driver_evidence=[],
        demand_driver_rationale="The transcript does not provide enough information to identify the demand driver.",
    )

    assert classification.primary_contact_reason == "Not identified"
    with pytest.raises(ValidationError):
        PCRClassification.model_validate(
            {
                **classification.model_dump(),
                "primary_contact_reason": "Unclear",
            }
        )
    with pytest.raises(ValidationError):
        PCRClassification.model_validate({**classification.model_dump(), "extra": "not allowed"})


def test_persistence_hash_covers_validated_fields() -> None:
    payload = PersistenceRequest(
        request_id=uuid.uuid4(),
        user_input="hello",
        result_json={"schema_version": "generic-v1", "result": {"answer": "hi"}},
        agent_name="agent",
        agent_version="1",
        prompt_version="v1",
        prompt_hash="a" * 64,
        schema_version="generic-v1",
        metadata=None,
        payload_hash="0" * 64,
    )
    first_hash = calculate_payload_hash(payload)
    changed = payload.model_copy(update={"user_input": "different"})

    assert len(first_hash) == 64
    assert calculate_payload_hash(changed) != first_hash


def test_persistence_request_accepts_empty_transcript() -> None:
    payload = PersistenceRequest(
        request_id=uuid.uuid4(),
        user_input="",
        result_json={"schema_version": "generic-v1", "result": {}},
        agent_name="agent",
        agent_version="1",
        prompt_version="v1",
        prompt_hash="a" * 64,
        schema_version="generic-v1",
        metadata=None,
        payload_hash="0" * 64,
    )

    assert payload.user_input == ""
