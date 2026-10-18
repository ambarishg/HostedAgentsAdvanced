from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any
from uuid import UUID

import httpx
from agent_framework import FunctionTool
from azure.core.exceptions import ClientAuthenticationError
from azure.identity import CredentialUnavailableError
from pydantic import BaseModel, ConfigDict, Field

from hosted_agent.config import AgentSettings
from hosted_agent.credentials import get_credential
from hosted_agent.schemas import AgentResult
from shared.canonical import sha256_json

logger = logging.getLogger(__name__)


class SaveAgentResultArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    user_input: str = Field(min_length=1)
    result: AgentResult
    agent_name: str = Field(min_length=1, max_length=128)
    agent_version: str = Field(min_length=1, max_length=128)
    prompt_version: str = Field(min_length=1, max_length=512)
    prompt_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    metadata: dict[str, Any] | None
    duration_ms: int = Field(ge=0)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    provider_response_id: str | None = Field(default=None, max_length=512)


class PersistenceToolError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class PersistenceApiTool:
    """Deterministic application tool that persists only schema-validated agent results."""

    def __init__(
        self,
        settings: AgentSettings,
        *,
        credential: Any | None = None,
        client_factory: Any = httpx.AsyncClient,
    ) -> None:
        self._settings = settings
        self._credential = credential or get_credential(settings.auth_mode)
        self._client_factory = client_factory
        self._framework_tool = FunctionTool(
            name="save_agent_result",
            description="Persist one validated agent result through the authenticated API.",
            func=self._send_to_api,
            input_model=SaveAgentResultArguments,
            approval_mode="never_require",
        )

    async def save_agent_result(
        self,
        *,
        request_id: UUID,
        user_input: str,
        result: AgentResult,
        agent_name: str,
        agent_version: str,
        prompt_version: str,
        prompt_hash: str,
        metadata: dict[str, Any] | None,
        duration_ms: int,
        input_tokens: int | None,
        output_tokens: int | None,
        provider_response_id: str | None,
    ) -> dict[str, Any]:
        arguments = SaveAgentResultArguments(
            request_id=request_id,
            user_input=user_input,
            result=result,
            agent_name=agent_name,
            agent_version=agent_version,
            prompt_version=prompt_version,
            prompt_hash=prompt_hash,
            metadata=metadata,
            duration_ms=duration_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            provider_response_id=provider_response_id,
        )
        return await self._framework_tool.invoke(arguments=arguments, skip_parsing=True)

    async def _send_to_api(
        self,
        request_id: UUID,
        user_input: str,
        result: AgentResult,
        agent_name: str,
        agent_version: str,
        prompt_version: str,
        prompt_hash: str,
        metadata: dict[str, Any] | None,
        duration_ms: int,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        provider_response_id: str | None = None,
    ) -> dict[str, Any]:
        result = AgentResult.model_validate(result)
        body: dict[str, Any] = {
            "request_id": str(request_id),
            "user_input": user_input,
            "result_json": result.model_dump(mode="json"),
            "agent_name": agent_name,
            "agent_version": agent_version,
            "prompt_version": prompt_version,
            "prompt_hash": prompt_hash,
            "schema_version": result.schema_version,
            "metadata": metadata,
            "duration_ms": duration_ms,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "provider_response_id": provider_response_id,
        }
        body["payload_hash"] = sha256_json(body)
        try:
            token = await asyncio.to_thread(
                self._credential.get_token, self._settings.persistence_api_scope
            )
        except (ClientAuthenticationError, CredentialUnavailableError) as exc:
            raise PersistenceToolError(
                "persistence_authentication_failed",
                "Could not acquire an Entra token for PERSISTENCE_API_SCOPE. "
                "Run 'az login' and verify the configured API scope.",
            ) from exc
        headers = {"Authorization": f"Bearer {token.token}"}
        timeout = httpx.Timeout(self._settings.persistence_api_timeout_seconds)
        retry_statuses = {408, 429, 500, 502, 503, 504}
        started_at = time.monotonic()

        for attempt in range(self._settings.persistence_api_retries + 1):
            try:
                async with self._client_factory(timeout=timeout) as client:
                    response = await client.post(
                        self._settings.persistence_api_url,
                        json=body,
                        headers=headers,
                    )
            except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as exc:
                if attempt < self._settings.persistence_api_retries:
                    await asyncio.sleep(0.2 * (2**attempt))
                    continue
                raise PersistenceToolError(
                    "persistence_timeout", "Persistence API did not confirm the database commit."
                ) from exc

            if (
                response.status_code in retry_statuses
                and attempt < self._settings.persistence_api_retries
            ):
                await asyncio.sleep(0.2 * (2**attempt))
                continue
            if response.status_code == 409:
                raise PersistenceToolError(
                    "idempotency_conflict", "request_id is already associated with another payload."
                )
            if response.status_code == 429:
                raise PersistenceToolError(
                    "persistence_rate_limited", "Persistence API is rate limited."
                )
            if response.status_code == 401:
                raise PersistenceToolError(
                    "persistence_unauthorized",
                    "Persistence API returned HTTP 401. Check that API_AUDIENCE matches the "
                    "token audience and API_TENANT_ID matches the token tenant.",
                )
            if response.status_code == 403:
                raise PersistenceToolError(
                    "persistence_forbidden",
                    "Persistence API returned HTTP 403. Check API_REQUIRED_SCOPE and "
                    "API_ALLOWED_CLIENT_IDS, and confirm the token has the required permission.",
                )
            if response.is_error:
                raise PersistenceToolError(
                    "persistence_failed", "Persistence API did not commit the agent result."
                )
            try:
                saved = response.json()
                interaction_id = UUID(saved["interaction_id"])
                saved_request_id = UUID(saved["request_id"])
                if (
                    saved.get("success") is not True
                    or saved.get("status") != "completed"
                    or saved_request_id != request_id
                    or not isinstance(saved.get("duplicate"), bool)
                ):
                    raise ValueError("Persistence API returned an unconfirmed result.")
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                raise PersistenceToolError(
                    "persistence_unconfirmed",
                    "Persistence API returned an invalid commit confirmation.",
                ) from exc
            return {
                "interaction_id": interaction_id,
                "duplicate": bool(saved.get("duplicate", False)),
                "status": "completed",
                "duration_ms": max(0, int((time.monotonic() - started_at) * 1000)),
            }

        raise PersistenceToolError(
            "persistence_failed", "Persistence API did not commit the agent result."
        )
