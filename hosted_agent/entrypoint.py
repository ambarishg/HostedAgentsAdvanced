from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import replace
from functools import lru_cache
from pathlib import Path

from agent_framework_foundry_hosting import InvocationRun, InvocationsHostServer
from starlette.requests import Request

from hosted_agent.auth import AgentAuthorizationService
from hosted_agent.config import AgentSettings
from hosted_agent.orchestration import (
    HostedOrchestrator,
    RequestContext,
    set_request_context,
)
from hosted_agent.prompt_provider import (
    FilePromptProvider,
    PromptProvider,
    create_prompt_provider,
)
from hosted_agent.schemas import ExternalRequest
from persistence_api.auth import AuthenticationError

logger = logging.getLogger(__name__)
_settings: AgentSettings | None = None


def get_agent_settings() -> AgentSettings:
    global _settings
    if _settings is None:
        _settings = AgentSettings.from_env()
    return _settings


@lru_cache(maxsize=1)
def get_agent_authorization_service() -> AgentAuthorizationService:
    return AgentAuthorizationService(get_agent_settings())


@lru_cache(maxsize=1)
def get_prompt_provider() -> PromptProvider:
    return create_prompt_provider(get_agent_settings())


@lru_cache(maxsize=1)
def get_vulnerability_prompt_provider() -> PromptProvider:
    prompt_path = (
        Path(__file__).resolve().parent.parent / "prompts" / "system_prompt.vulnerability.txt"
    )
    return FilePromptProvider(
        prompt_path,
        "vulnerability-v1",
        get_agent_settings().max_prompt_bytes,
    )


async def parse_request(request: Request) -> InvocationRun:
    settings = get_agent_settings()
    raw_body = await request.body()
    if len(raw_body) > settings.max_input_chars * 8:
        raise ValueError("Request body exceeds the configured size limit.")
    configured_batch_mode = bool(settings.batch_file_path or settings.batch_blob_name)
    try:
        payload = json.loads(raw_body)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
    except ValueError as exc:
        raise ValueError("Request body does not match the agent input schema.") from exc
    requested_batch_mode = payload.pop("batch_mode", None)
    if requested_batch_mode is not None and type(requested_batch_mode) is not bool:
        raise ValueError("batch_mode must be a boolean.")
    batch_mode = configured_batch_mode if requested_batch_mode is None else requested_batch_mode
    if batch_mode and not configured_batch_mode:
        raise ValueError("Batch mode was requested, but no batch input is configured.")
    if batch_mode:
        payload["user_input"] = "Process configured batch input."
    try:
        get_agent_authorization_service().authorize(
            request.headers.get("Authorization"), batch_mode=batch_mode
        )
    except AuthenticationError as exc:
        logger.warning(
            "Hosted agent rejected caller",
            extra={"error_code": exc.code, "status_code": exc.status_code},
        )
        raise ValueError("Caller authentication or authorization failed.") from exc
    try:
        external_request = ExternalRequest.model_validate(payload)
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

    try:
        vulnerability_prompt = await asyncio.to_thread(
            get_vulnerability_prompt_provider().load_prompt
        )
    except Exception:
        logger.exception(
            "Vulnerability system prompt could not be loaded",
            extra={
                "request_id": str(external_request.request_id),
                "error_code": "vulnerability_prompt_unavailable",
            },
        )
        raise ValueError("Bundled vulnerability system prompt is unavailable.") from None

    request_settings = settings
    if configured_batch_mode and not batch_mode:
        request_settings = replace(
            settings,
            batch_storage_account_url=None,
            batch_container=None,
            batch_blob_name=None,
            batch_value_column=None,
            batch_blob_version_id=None,
            batch_file_path=None,
        )

    set_request_context(
        RequestContext(
            request=external_request,
            prompt=prompt,
            vulnerability_prompt=vulnerability_prompt,
            started_at=asyncio.get_running_loop().time(),
            settings=request_settings,
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
