from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
from starlette.requests import Request

from hosted_agent import entrypoint
from hosted_agent.orchestration import HostedOrchestrator
from hosted_agent.prompt_provider import PromptSnapshot


@pytest.mark.asyncio
@pytest.mark.parametrize("user_input", ["question", ""])
async def test_invocations_parser_validates_contract_and_pins_prompt(
    agent_settings, monkeypatch, user_input
) -> None:
    body = json.dumps(
        {
            "user_input": user_input,
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

    assert parsed.messages == user_input
    assert isinstance(hosted_agent, HostedOrchestrator)
    assert hosted_agent._context.request.user_input == user_input
    assert hosted_agent._context.prompt.version == "prompt-7"
    assert hosted_agent._context.vulnerability_prompt.version == "vulnerability-v1"
    assert "{{CALL_TRANSCRIPT}}" in hosted_agent._context.vulnerability_prompt.text


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


@pytest.mark.asyncio
@pytest.mark.parametrize("user_input", [None, "ignore this"])
async def test_batch_invocation_does_not_require_or_use_user_input(
    agent_settings, monkeypatch, user_input
) -> None:
    settings = replace(
        agent_settings,
        batch_file_path=Path("customers.csv"),
        batch_value_column="customer",
    )
    payload = {"metadata": {"source": "batch"}, "batch_mode": True}
    if user_input is not None:
        payload["user_input"] = user_input
    body = json.dumps(payload).encode()

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
    monkeypatch.setattr(entrypoint, "get_agent_settings", lambda: settings)
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

    assert parsed.messages == "Process configured batch input."
    assert hosted_agent._context.request.user_input == "Process configured batch input."
    assert hosted_agent._context.settings.batch_file_path == Path("customers.csv")


@pytest.mark.asyncio
async def test_explicit_single_invocation_overrides_configured_batch(
    agent_settings, monkeypatch
) -> None:
    settings = replace(
        agent_settings,
        batch_file_path=Path("customers.csv"),
        batch_value_column="customer",
    )
    body = json.dumps(
        {
            "batch_mode": False,
            "user_input": "Use only this UI request.",
            "metadata": {"source": "ui"},
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
    monkeypatch.setattr(entrypoint, "get_agent_settings", lambda: settings)
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

    assert parsed.messages == "Use only this UI request."
    assert hosted_agent._context.request.user_input == "Use only this UI request."
    assert hosted_agent._context.settings.batch_file_path is None
    assert hosted_agent._context.settings.batch_blob_name is None


@pytest.mark.asyncio
async def test_explicit_batch_invocation_requires_batch_configuration(
    agent_settings, monkeypatch
) -> None:
    body = b'{"batch_mode":true}'

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

    with pytest.raises(ValueError, match="no batch input is configured"):
        await entrypoint.parse_request(request)
