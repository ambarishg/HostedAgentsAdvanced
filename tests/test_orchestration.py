from __future__ import annotations

import asyncio
import json
from uuid import UUID

import pytest
from agent_framework import AgentResponse, Message

from hosted_agent.orchestration import AgentExecutionError, HostedOrchestrator, execute_request
from hosted_agent.persistence_client import PersistenceToolError
from hosted_agent.schemas import ModelAgentOutput


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
                ['{"schema_version":"generic-v1","result_json":"{\\"answer\\":\\"ok\\"}"}'],
            ),
            value=ModelAgentOutput(schema_version="generic-v1", result_json='{"answer":"ok"}'),
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
    assert persistence.saved["result"].result == {"answer": "ok"}
    assert model.inputs == ["hello"]


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
@pytest.mark.parametrize("result_json", ["[]", "not json", '{"value": NaN}'])
async def test_invalid_result_json_is_not_persisted(request_context, result_json) -> None:
    model = FakeModelAgent(
        AgentResponse(
            messages=Message(
                "assistant",
                [json.dumps({"schema_version": "generic-v1", "result_json": result_json})],
            ),
            value=ModelAgentOutput(schema_version="generic-v1", result_json=result_json),
            finish_reason="stop",
        )
    )
    persistence = FakePersistenceTool()

    with pytest.raises(AgentExecutionError, match="valid JSON object"):
        await execute_request(request_context, model_agent=model, persistence_tool=persistence)

    assert persistence.saved is None


@pytest.mark.asyncio
async def test_schema_version_mismatch_is_not_persisted(request_context) -> None:
    model = FakeModelAgent(
        AgentResponse(
            messages=Message(
                "assistant",
                [json.dumps({"schema_version": "v2", "result_json": "{}"})],
            ),
            value=ModelAgentOutput(schema_version="v2", result_json="{}"),
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
                ['{"schema_version":"generic-v1","result_json":"{\\"answer\\":\\"ok\\"}"}'],
            ),
            value=ModelAgentOutput(schema_version="generic-v1", result_json='{"answer":"ok"}'),
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
    csv_text = "prompt,customer\nBase: {prompt},Alice\nBase: {prompt},Bob\n"

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
                                "result_json": '{"answer":"processed"}',
                            }
                        )
                    ],
                ),
                value=ModelAgentOutput(
                    schema_version="generic-v1",
                    result_json='{"answer":"processed"}',
                ),
                finish_reason="stop",
                response_id=row_context.request.request_id.hex,
            )
        )

    responses = await orchestrator.process_blob_rows(
        account_url="https://example.blob.core.windows.net",
        container="input",
        blob_name="customers.csv",
        value_column="customer",
        user_prompt="Process this customer:",
        model_agent_factory=factory,
        persistence_tool=FakePersistenceTool(),
    )

    assert len(responses) == 2
    assert orchestrator.last_errors == []
    assert received_inputs == [
        "Process this customer:\n\nAlice",
        "Process this customer:\n\nBob",
    ]


@pytest.mark.asyncio
async def test_blob_row_errors_are_recorded_without_aborting(request_context, monkeypatch) -> None:
    csv_text = "prompt,customer\nValidRow,ok\nBadRow,\n"

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
                    [
                        json.dumps(
                            {"schema_version": "generic-v1", "result_json": '{"answer":"ok"}'}
                        )
                    ],
                ),
                value=ModelAgentOutput(
                    schema_version="generic-v1",
                    result_json='{"answer":"ok"}',
                ),
                finish_reason="stop",
                response_id=row_context.request.request_id.hex,
            )
        )

    responses = await orchestrator.process_blob_rows(
        account_url="https://example.blob.core.windows.net",
        container="input",
        blob_name="customers.csv",
        value_column="customer",
        user_prompt="Process this customer:",
        model_agent_factory=factory,
        persistence_tool=FakePersistenceTool(),
    )

    assert len(responses) == 1
    assert len(orchestrator.last_errors) == 1
