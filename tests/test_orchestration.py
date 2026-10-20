from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from uuid import UUID

import pytest
from agent_framework import AgentResponse, Message

from hosted_agent.orchestration import AgentExecutionError, HostedOrchestrator, execute_request
from hosted_agent.persistence_client import PersistenceToolError
from hosted_agent.schemas import ModelAgentOutput, PCRClassification

PCR_RESULT = {
    "primary_contact_reason": "Policy information / clarification",
    "demand_driver": "Unclear policy information",
    "confidence": "High",
    "evidence": ["The customer asks for clarification about their policy."],
    "rationale": "The customer contacted L&G to understand their policy.",
    "secondary_reasons": [],
    "demand_driver_evidence": ["The customer says they do not understand how the policy works."],
    "demand_driver_rationale": "The customer is seeking clarification because the policy terms are unclear.",
}


def make_model_output(
    *, schema_version: str = "generic-v1", result_json: dict | None = None
) -> ModelAgentOutput:
    return ModelAgentOutput(
        schema_version=schema_version,
        result_json=PCRClassification.model_validate(result_json or PCR_RESULT),
    )


class FakeModelAgent:
    def __init__(self, response) -> None:
        self.response = response
        self.inputs = []

    async def run(self, user_input: str):
        self.inputs.append(user_input)
        return self.response


class FakePersistenceTool:
    def __init__(self) -> None:
        self.saved = None

    async def save_agent_result(self, **values):
        self.saved = values
        return {
            "interaction_id": UUID(int=1),
            "duplicate": False,
            "status": "completed",
            "duration_ms": 1,
        }


class FailedPersistenceTool:
    async def save_agent_result(self, **values):
        raise PersistenceToolError("persistence_timeout", "no confirmation")


@pytest.mark.asyncio
async def test_success_is_returned_only_after_commit_confirmation(request_context) -> None:
    model = FakeModelAgent(
        AgentResponse(
            messages=Message(
                "assistant",
                [json.dumps({"schema_version": "generic-v1", "result_json": PCR_RESULT})],
            ),
            value=make_model_output(),
            finish_reason="stop",
            response_id="response-123",
        )
    )
    persistence = FakePersistenceTool()

    response = await execute_request(
        request_context, model_agent=model, persistence_tool=persistence
    )

    assert response.success is True
    assert response.interaction_id == UUID(int=1)
    assert persistence.saved["request_id"] == request_context.request.request_id
    assert persistence.saved["prompt_hash"] == request_context.prompt.sha256
    assert persistence.saved["result"].result == PCR_RESULT
    assert model.inputs == ["hello"]


@pytest.mark.asyncio
async def test_empty_transcript_returns_persisted_not_identified_result(request_context) -> None:
    class UnexpectedModel:
        async def run(self, user_input: str):
            pytest.fail("The model should not be called for an empty transcript.")

    context = replace(
        request_context,
        request=request_context.request.model_copy(update={"user_input": "  "}),
    )
    persistence = FakePersistenceTool()

    response = await execute_request(
        context, model_agent=UnexpectedModel(), persistence_tool=persistence
    )

    assert response.result == {
        "primary_contact_reason": "Not identified",
        "demand_driver": "Not identified",
        "confidence": "Low",
        "evidence": [],
        "rationale": (
            "The transcript does not provide enough information to identify a "
            "primary contact reason."
        ),
        "secondary_reasons": [],
        "demand_driver_evidence": [],
        "demand_driver_rationale": (
            "The transcript does not provide enough information to identify the "
            "underlying demand driver."
        ),
    }
    assert persistence.saved["user_input"] == "  "
    assert persistence.saved["result"].result == response.result


@pytest.mark.asyncio
async def test_invalid_structured_output_is_not_persisted(request_context) -> None:
    model = FakeModelAgent(
        AgentResponse(
            messages=Message("assistant", ["not json"]),
            finish_reason="stop",
        )
    )
    persistence = FakePersistenceTool()

    with pytest.raises(AgentExecutionError, match="valid structured JSON"):
        await execute_request(request_context, model_agent=model, persistence_tool=persistence)

    assert persistence.saved is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result_json",
    [
        "Classified as Communication support request with high confidence.",
        {"answer": "Classified as Communication support request with high confidence."},
        {
            **PCR_RESULT,
            "primary_contact_reason": "Communication support",
        },
    ],
)
async def test_invalid_pcr_output_is_not_persisted(request_context, result_json) -> None:
    model = FakeModelAgent(
        AgentResponse(
            messages=Message(
                "assistant",
                [json.dumps({"schema_version": "generic-v1", "result_json": result_json})],
            ),
            finish_reason="stop",
        )
    )
    persistence = FakePersistenceTool()

    with pytest.raises(AgentExecutionError, match="valid structured JSON"):
        await execute_request(request_context, model_agent=model, persistence_tool=persistence)

    assert persistence.saved is None


@pytest.mark.asyncio
async def test_schema_version_mismatch_is_not_persisted(request_context) -> None:
    model = FakeModelAgent(
        AgentResponse(
            messages=Message(
                "assistant",
                [json.dumps({"schema_version": "v2", "result_json": PCR_RESULT})],
            ),
            value=make_model_output(schema_version="v2"),
            finish_reason="stop",
        )
    )
    persistence = FakePersistenceTool()

    with pytest.raises(AgentExecutionError, match="unsupported schema version"):
        await execute_request(request_context, model_agent=model, persistence_tool=persistence)

    assert persistence.saved is None


@pytest.mark.asyncio
async def test_model_timeout_does_not_persist(request_context, agent_settings) -> None:
    class SlowModel:
        async def run(self, user_input: str):
            await asyncio.sleep(0.05)

    from dataclasses import replace

    context = request_context.__class__(
        request=request_context.request,
        prompt=request_context.prompt,
        started_at=request_context.started_at,
        settings=replace(agent_settings, model_timeout_seconds=0.01),
    )
    persistence = FakePersistenceTool()

    with pytest.raises(AgentExecutionError, match="timed out"):
        await execute_request(context, model_agent=SlowModel(), persistence_tool=persistence)

    assert persistence.saved is None


@pytest.mark.asyncio
async def test_api_timeout_never_returns_success(request_context) -> None:
    model = FakeModelAgent(
        AgentResponse(
            messages=Message(
                "assistant",
                [json.dumps({"schema_version": "generic-v1", "result_json": PCR_RESULT})],
            ),
            value=make_model_output(),
            finish_reason="stop",
        )
    )

    with pytest.raises(AgentExecutionError, match="no confirmation"):
        await execute_request(
            request_context,
            model_agent=model,
            persistence_tool=FailedPersistenceTool(),
        )


@pytest.mark.asyncio
async def test_blob_file_rows_are_processed_individually(request_context, monkeypatch) -> None:
    csv_text = "customer\nAlice\nBob\n"

    class Blob:
        def download_blob(self, **kwargs):
            return type(
                "Downloader",
                (),
                {"chunks": lambda self: [csv_text.encode("utf-8")]},
            )()

    class Service:
        def __init__(self, *args, **kwargs):
            pass

        def get_blob_client(self, container, name, **kwargs):
            return Blob()

    monkeypatch.setattr("hosted_agent.orchestration.BlobServiceClient", Service)

    orchestrator = HostedOrchestrator(request_context)
    received_inputs = []

    async def factory(row_context):
        received_inputs.append(row_context.request.user_input)
        return FakeModelAgent(
            AgentResponse(
                messages=Message(
                    "assistant",
                    [
                        json.dumps(
                            {
                                "schema_version": "generic-v1",
                                "result_json": PCR_RESULT,
                            }
                        )
                    ],
                ),
                value=make_model_output(),
                finish_reason="stop",
                response_id=row_context.request.request_id.hex,
            )
        )

    responses = await orchestrator.process_blob_rows(
        account_url="https://example.blob.core.windows.net",
        container="input",
        blob_name="customers.csv",
        value_column="customer",
        model_agent_factory=factory,
        persistence_tool=FakePersistenceTool(),
    )

    assert len(responses) == 2
    assert orchestrator.last_errors == []
    assert received_inputs == ["Alice", "Bob"]


@pytest.mark.asyncio
async def test_blob_row_errors_are_recorded_without_aborting(request_context, monkeypatch) -> None:
    csv_text = "customer\nValidRow\nBadRow\n"

    class Blob:
        def download_blob(self, **kwargs):
            return type(
                "Downloader",
                (),
                {"chunks": lambda self: [csv_text.encode("utf-8")]},
            )()

    class Service:
        def __init__(self, *args, **kwargs):
            pass

        def get_blob_client(self, container, name, **kwargs):
            return Blob()

    monkeypatch.setattr("hosted_agent.orchestration.BlobServiceClient", Service)

    orchestrator = HostedOrchestrator(request_context)

    async def factory(row_context):
        if "BadRow" in row_context.request.user_input:
            raise ValueError("row failed")
        return FakeModelAgent(
            AgentResponse(
                messages=Message(
                    "assistant",
                    [json.dumps({"schema_version": "generic-v1", "result_json": PCR_RESULT})],
                ),
                value=make_model_output(),
                finish_reason="stop",
                response_id=row_context.request.request_id.hex,
            )
        )

    responses = await orchestrator.process_blob_rows(
        account_url="https://example.blob.core.windows.net",
        container="input",
        blob_name="customers.csv",
        value_column="customer",
        model_agent_factory=factory,
        persistence_tool=FakePersistenceTool(),
    )

    assert len(responses) == 1
    assert len(orchestrator.last_errors) == 1


@pytest.mark.asyncio
async def test_local_file_column_values_are_processed_and_persisted(
    request_context, tmp_path
) -> None:
    file_path = tmp_path / "customers.csv"
    file_path.write_text("customer\nSummarize Alice\nSummarize Bob\n", encoding="utf-8")
    orchestrator = HostedOrchestrator(request_context)
    received_inputs = []

    class RecordingPersistence:
        def __init__(self) -> None:
            self.saved = []

        async def save_agent_result(self, **values):
            self.saved.append(values)
            return {
                "interaction_id": UUID(int=len(self.saved)),
                "duplicate": False,
                "status": "completed",
                "duration_ms": 1,
            }

    persistence = RecordingPersistence()

    async def factory(row_context):
        received_inputs.append(row_context.request.user_input)
        return FakeModelAgent(
            AgentResponse(
                messages=Message(
                    "assistant",
                    [
                        json.dumps(
                            {
                                "schema_version": "generic-v1",
                                "result_json": PCR_RESULT,
                            }
                        )
                    ],
                ),
                value=make_model_output(),
                finish_reason="stop",
                response_id=row_context.request.request_id.hex,
            )
        )

    responses = await orchestrator.process_local_file_rows(
        file_path=str(file_path),
        value_column="customer",
        model_agent_factory=factory,
        persistence_tool=persistence,
    )

    assert len(responses) == 2
    assert len(persistence.saved) == 2
    assert received_inputs == ["Summarize Alice", "Summarize Bob"]
    assert [saved["metadata"]["row_number"] for saved in persistence.saved] == [1, 2]
    assert orchestrator.last_errors == []


@pytest.mark.asyncio
async def test_local_file_row_errors_are_recorded_and_processing_continues(
    request_context, tmp_path
) -> None:
    file_path = tmp_path / "customers.csv"
    file_path.write_text("customer\nProcess Alice\n \n", encoding="utf-8")
    orchestrator = HostedOrchestrator(request_context)
    received_inputs = []

    async def factory(row_context):
        received_inputs.append(row_context.request.user_input)
        return FakeModelAgent(
            AgentResponse(
                messages=Message(
                    "assistant",
                    [json.dumps({"schema_version": "generic-v1", "result_json": PCR_RESULT})],
                ),
                value=make_model_output(),
                finish_reason="stop",
            )
        )

    responses = await orchestrator.process_local_file_rows(
        file_path=str(file_path),
        value_column="customer",
        model_agent_factory=factory,
        persistence_tool=FakePersistenceTool(),
    )

    assert len(responses) == 2
    assert received_inputs == ["Process Alice", ""]
    assert responses[1].result == {
        "primary_contact_reason": "Not identified",
        "demand_driver": "Not identified",
        "confidence": "Low",
        "evidence": [],
        "rationale": (
            "The transcript does not provide enough information to identify a "
            "primary contact reason."
        ),
        "secondary_reasons": [],
        "demand_driver_evidence": [],
        "demand_driver_rationale": (
            "The transcript does not provide enough information to identify the "
            "underlying demand driver."
        ),
    }
    assert orchestrator.last_errors == []


@pytest.mark.asyncio
async def test_local_file_read_failure_is_reported(request_context, tmp_path) -> None:
    orchestrator = HostedOrchestrator(request_context)

    with pytest.raises(AgentExecutionError) as error:
        await orchestrator.process_local_file_rows(
            file_path=tmp_path / "missing.csv",
            value_column="customer",
        )

    assert error.value.code == "local_file_unavailable"


@pytest.mark.asyncio
async def test_run_dispatches_configured_local_file_batch(
    request_context, tmp_path, monkeypatch
) -> None:
    from dataclasses import replace

    file_path = tmp_path / "customers.csv"
    settings = replace(
        request_context.settings,
        batch_file_path=file_path,
        batch_value_column="customer",
    )
    orchestrator = HostedOrchestrator(replace(request_context, settings=settings))
    received = {}

    async def process_local_file_rows(**kwargs):
        received.update(kwargs)
        orchestrator.last_errors = []
        return []

    monkeypatch.setattr(orchestrator, "process_local_file_rows", process_local_file_rows)

    response = await orchestrator.run()

    assert received == {"file_path": str(file_path), "value_column": "customer"}
    assert json.loads(response.text) == {"responses": [], "errors": []}
