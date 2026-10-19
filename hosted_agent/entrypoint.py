from __future__ import annotations

import asyncio
import json
import logging
from functools import lru_cache

from agent_framework_foundry_hosting import InvocationRun, InvocationsHostServer
from starlette.requests import Request

from hosted_agent.config import AgentSettings
from hosted_agent.orchestration import (
    HostedOrchestrator,
    RequestContext,
    set_request_context,
)
from hosted_agent.prompt_provider import PromptProvider, create_prompt_provider
from hosted_agent.schemas import ExternalRequest

logger = logging.getLogger(__name__)
_settings: AgentSettings | None = None


def get_agent_settings() -> AgentSettings:
    global _settings
    if _settings is None:
        _settings = AgentSettings.from_env()
    return _settings


@lru_cache(maxsize=1)
def get_prompt_provider() -> PromptProvider:
    return create_prompt_provider(get_agent_settings())


async def parse_request(request: Request) -> InvocationRun:
    settings = get_agent_settings()
    raw_body = await request.body()
    if len(raw_body) > settings.max_input_chars * 8:
        raise ValueError("Request body exceeds the configured size limit.")
    batch_mode = bool(settings.batch_file_path or settings.batch_blob_name)
    try:
        if batch_mode:
            payload = json.loads(raw_body)
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object.")
            payload["user_input"] = "Process configured batch input."
            external_request = ExternalRequest.model_validate(payload)
        else:
            external_request = ExternalRequest.model_validate_json(raw_body)
    except ValueError as exc:
        raise ValueError("Request body does not match the agent input schema.") from exc
    if len(external_request.user_input) > settings.max_input_chars:
        raise ValueError("user_input exceeds the configured character limit.")
    if (
        len(json.dumps(external_request.metadata, ensure_ascii=False).encode("utf-8"))
        > settings.max_input_chars * 4
    ):
        raise ValueError("metadata exceeds the configured size limit.")

    try:
        prompt = await asyncio.to_thread(get_prompt_provider().load_prompt)
    except Exception:
        logger.exception(
            "System prompt could not be loaded",
            extra={
                "request_id": str(external_request.request_id),
                "error_code": "prompt_unavailable",
            },
        )
        raise ValueError("Configured system prompt is unavailable.") from None

    set_request_context(
        RequestContext(
            request=external_request,
            prompt=prompt,
            started_at=asyncio.get_running_loop().time(),
            settings=settings,
        )
    )
    invocation_message = (
        "Process configured batch input." if batch_mode else external_request.user_input
    )
    return InvocationRun(messages=invocation_message, options={}, stream=False)


def create_agent() -> HostedOrchestrator:
    from hosted_agent.orchestration import consume_request_context

    return HostedOrchestrator(consume_request_context())


def main() -> None:
    get_agent_settings()
    server = InvocationsHostServer(
        agent=create_agent,
        parse_request=parse_request,
        unsupported_options="error",
    )
    server.run()


if __name__ == "__main__":
    main()
