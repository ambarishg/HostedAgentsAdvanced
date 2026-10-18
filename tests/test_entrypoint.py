from __future__ import annotations

import json

import pytest
from starlette.requests import Request

from hosted_agent import entrypoint
from hosted_agent.orchestration import HostedOrchestrator
from hosted_agent.prompt_provider import PromptSnapshot


@pytest.mark.asyncio
async def test_invocations_parser_validates_contract_and_pins_prompt(
    agent_settings, monkeypatch
) -> None:
    body = json.dumps(
        {
            "user_input": "question",
            "metadata": {"source": "test"},
        }
    ).encode()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/invocations",
            "headers": [(b"content-type", b"application/json")],
            "query_string": b"",
        },
        receive,
    )
    monkeypatch.setattr(entrypoint, "get_agent_settings", lambda: agent_settings)
    monkeypatch.setattr(
        entrypoint,
        "get_prompt_provider",
        lambda: type(
            "Provider",
            (),
            {"load_prompt": lambda self: PromptSnapshot("external prompt", "prompt-7", "b" * 64)},
        )(),
    )

    parsed = await entrypoint.parse_request(request)
    hosted_agent = entrypoint.create_agent()

    assert parsed.messages == "question"
    assert isinstance(hosted_agent, HostedOrchestrator)
    assert hosted_agent._context.request.user_input == "question"
    assert hosted_agent._context.prompt.version == "prompt-7"


@pytest.mark.asyncio
async def test_invocations_parser_rejects_invalid_contract(agent_settings, monkeypatch) -> None:
    body = b'{"user_input":"   ","untrusted_prompt":"not accepted"}'

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/invocations",
            "headers": [(b"content-type", b"application/json")],
            "query_string": b"",
        },
        receive,
    )
    monkeypatch.setattr(entrypoint, "get_agent_settings", lambda: agent_settings)

    with pytest.raises(ValueError, match="agent input schema"):
        await entrypoint.parse_request(request)
