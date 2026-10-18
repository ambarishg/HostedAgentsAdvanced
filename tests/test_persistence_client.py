from __future__ import annotations

import json
import uuid

import httpx
import pytest

from hosted_agent.persistence_client import PersistenceApiTool, PersistenceToolError
from hosted_agent.schemas import AgentResult
from shared.canonical import sha256_json


class FakeCredential:
    def get_token(self, scope: str):
        assert scope == "api://persistence/.default"
        return type("Token", (), {"token": "test-token"})()


@pytest.mark.asyncio
async def test_persistence_tool_retries_transient_failure_with_same_idempotency_hash(
    agent_settings,
) -> None:
    requests = []
    authorization_headers = []

    async def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        authorization_headers.append(request.headers["Authorization"])
        if len(requests) == 1:
            return httpx.Response(503, json={"success": False})
        return httpx.Response(
            201,
            json={
                "success": True,
                "interaction_id": str(uuid.UUID(int=2)),
                "request_id": body["request_id"],
                "status": "completed",
                "duplicate": False,
            },
        )

    settings = agent_settings.__class__(
        **{
            **agent_settings.__dict__,
            "persistence_api_retries": 1,
        }
    )
    tool = PersistenceApiTool(
        settings,
        credential=FakeCredential(),
        client_factory=lambda **kwargs: httpx.AsyncClient(
            transport=httpx.MockTransport(respond), **kwargs
        ),
    )
    request_id = uuid.uuid4()

    saved = await tool.save_agent_result(
        request_id=request_id,
        user_input="hello",
        result=AgentResult(schema_version="generic-v1", result={"answer": "yes"}),
        agent_name="test-agent",
        agent_version="1.0.0",
        prompt_version="v1",
        prompt_hash="a" * 64,
        metadata=None,
        duration_ms=12,
        input_tokens=None,
        output_tokens=None,
        provider_response_id=None,
    )

    assert saved["status"] == "completed"
    assert len(requests) == 2
    assert authorization_headers == ["Bearer test-token", "Bearer test-token"]
    assert requests[0]["payload_hash"] == requests[1]["payload_hash"]
    assert requests[1]["payload_hash"] == sha256_json(
        {key: value for key, value in requests[1].items() if key != "payload_hash"}
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "error_code", "message"),
    [
        (
            401,
            "persistence_unauthorized",
            "Check that API_AUDIENCE matches the token audience",
        ),
        (
            403,
            "persistence_forbidden",
            "Check API_REQUIRED_SCOPE and API_ALLOWED_CLIENT_IDS",
        ),
    ],
)
async def test_persistence_auth_rejections_report_actionable_status(
    agent_settings, status_code, error_code, message
) -> None:
    async def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"error": "sanitized"})

    tool = PersistenceApiTool(
        agent_settings,
        credential=FakeCredential(),
        client_factory=lambda **kwargs: httpx.AsyncClient(
            transport=httpx.MockTransport(respond), **kwargs
        ),
    )

    with pytest.raises(PersistenceToolError, match=message) as error:
        await tool._send_to_api(
            request_id=uuid.uuid4(),
            user_input="hello",
            result=AgentResult(schema_version="generic-v1", result={"answer": "yes"}),
            agent_name="test-agent",
            agent_version="1.0.0",
            prompt_version="v1",
            prompt_hash="a" * 64,
            metadata=None,
            duration_ms=12,
        )

    assert error.value.code == error_code
