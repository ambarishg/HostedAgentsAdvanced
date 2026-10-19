from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


def _positive_int(name: str, default: int, *, allow_zero: bool = False) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer.") from exc
    if value < 0 if allow_zero else value <= 0:
        qualifier = "non-negative" if allow_zero else "positive"
        raise ValueError(f"{name} must be {qualifier}.")
    return value


@dataclass(frozen=True)
class AgentSettings:
    project_endpoint: str
    model_deployment_name: str
    agent_name: str
    agent_version: str
    result_schema_version: str
    auth_mode: str
    model_timeout_seconds: int
    max_input_chars: int
    max_result_bytes: int
    max_prompt_bytes: int
    prompt_source: str
    prompt_path: Path | None
    prompt_version: str | None
    prompt_storage_account_url: str | None
    prompt_container: str | None
    prompt_blob_name: str | None
    persistence_api_url: str
    persistence_api_scope: str
    persistence_api_timeout_seconds: int
    persistence_api_retries: int
    user_prompt: str | None = None
    batch_storage_account_url: str | None = None
    batch_container: str | None = None
    batch_blob_name: str | None = None
    batch_value_column: str | None = None
    batch_blob_version_id: str | None = None

    @classmethod
    def from_env(cls) -> AgentSettings:
        load_dotenv(override=False)
        endpoint = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").strip()
        model = os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME", "").strip()
        api_url = os.getenv("PERSISTENCE_API_URL", "").strip()
        api_scope = os.getenv("PERSISTENCE_API_SCOPE", "").strip()
        for key, value in (
            ("FOUNDRY_PROJECT_ENDPOINT", endpoint),
            ("FOUNDRY_MODEL_DEPLOYMENT_NAME", model),
            ("PERSISTENCE_API_URL", api_url),
            ("PERSISTENCE_API_SCOPE", api_scope),
        ):
            if not value:
                raise ValueError(f"{key} is required.")

        project_parts = urlparse(endpoint)
        if project_parts.scheme != "https" or not project_parts.hostname:
            raise ValueError("FOUNDRY_PROJECT_ENDPOINT must use HTTPS.")
        api_parts = urlparse(api_url)
        if not api_parts.hostname or (
            api_parts.scheme != "https"
            and api_parts.hostname not in {"localhost", "127.0.0.1", "::1"}
        ):
            raise ValueError("PERSISTENCE_API_URL must use HTTPS except for local development.")

        prompt_source = os.getenv("SYSTEM_PROMPT_SOURCE", "file").strip().lower()
        if prompt_source not in {"file", "blob"}:
            raise ValueError("SYSTEM_PROMPT_SOURCE must be 'file' or 'blob'.")

        prompt_path: Path | None = None
        prompt_version: str | None = None
        account_url = container = blob_name = None
        if prompt_source == "file":
            raw_path = os.getenv("SYSTEM_PROMPT_PATH", "").strip()
            prompt_version = os.getenv("SYSTEM_PROMPT_VERSION", "").strip()
            if not raw_path or not prompt_version:
                raise ValueError(
                    "SYSTEM_PROMPT_PATH and SYSTEM_PROMPT_VERSION are required for file prompts."
                )
            prompt_path = Path(raw_path)
        else:
            account_url = os.getenv("PROMPT_STORAGE_ACCOUNT_URL", "").strip()
            container = os.getenv("PROMPT_CONTAINER", "").strip()
            blob_name = os.getenv("PROMPT_BLOB_NAME", "").strip()
            prompt_version = os.getenv("PROMPT_VERSION", "").strip()
            if not all((account_url, container, blob_name, prompt_version)):
                raise ValueError(
                    "PROMPT_STORAGE_ACCOUNT_URL, PROMPT_CONTAINER, PROMPT_BLOB_NAME, "
                    "and immutable PROMPT_VERSION are required for blob prompts."
                )
            if urlparse(account_url).scheme != "https":
                raise ValueError("PROMPT_STORAGE_ACCOUNT_URL must use HTTPS.")

        batch_storage_account_url = os.getenv("BATCH_STORAGE_ACCOUNT_URL", "").strip() or None
        batch_container = os.getenv("BATCH_CONTAINER", "").strip() or None
        batch_blob_name = os.getenv("BATCH_BLOB_NAME", "").strip() or None
        batch_value_column = os.getenv("BATCH_VALUE_COLUMN", "").strip() or None
        batch_blob_version_id = os.getenv("BATCH_BLOB_VERSION_ID", "").strip() or None
        user_prompt = os.getenv("USER_PROMPT", "").strip() or None
        batch_configuration = (
            batch_storage_account_url,
            batch_container,
            batch_blob_name,
            batch_value_column,
            user_prompt,
        )
        if any(batch_configuration) and not all(batch_configuration):
            raise ValueError(
                "USER_PROMPT, BATCH_STORAGE_ACCOUNT_URL, BATCH_CONTAINER, "
                "BATCH_BLOB_NAME, and BATCH_VALUE_COLUMN must be configured together."
            )
        if batch_storage_account_url and urlparse(batch_storage_account_url).scheme != "https":
            raise ValueError("BATCH_STORAGE_ACCOUNT_URL must use HTTPS.")

        auth_mode = os.getenv("AGENT_AUTH_MODE", "default").strip().lower()
        if auth_mode not in {"default", "managed_identity"}:
            raise ValueError("AGENT_AUTH_MODE must be 'default' or 'managed_identity'.")
        agent_name = os.getenv("AGENT_NAME", "pcr-agent").strip()
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", agent_name):
            raise ValueError("AGENT_NAME must use Foundry's alphanumeric/hyphen naming rules.")
        agent_version = os.getenv("AGENT_VERSION", "1.0.0").strip()
        result_schema_version = os.getenv("RESULT_SCHEMA_VERSION", "generic-v1").strip()
        if not agent_version or not result_schema_version or len(result_schema_version) > 64:
            raise ValueError(
                "AGENT_VERSION must not be empty and "
                "RESULT_SCHEMA_VERSION must be at most 64 characters."
            )

        return cls(
            project_endpoint=endpoint,
            model_deployment_name=model,
            agent_name=agent_name,
            agent_version=agent_version,
            result_schema_version=result_schema_version,
            auth_mode=auth_mode,
            model_timeout_seconds=_positive_int("MODEL_TIMEOUT_SECONDS", 90),
            max_input_chars=_positive_int("MAX_INPUT_CHARS", 20_000),
            max_result_bytes=_positive_int("MAX_RESULT_BYTES", 65_536),
            max_prompt_bytes=_positive_int("MAX_SYSTEM_PROMPT_BYTES", 65_536),
            prompt_source=prompt_source,
            prompt_path=prompt_path,
            prompt_version=prompt_version,
            prompt_storage_account_url=account_url,
            prompt_container=container,
            prompt_blob_name=blob_name,
            persistence_api_url=api_url,
            persistence_api_scope=api_scope,
            persistence_api_timeout_seconds=_positive_int("PERSISTENCE_API_TIMEOUT_SECONDS", 15),
            persistence_api_retries=_positive_int("PERSISTENCE_API_RETRIES", 1, allow_zero=True),
            user_prompt=user_prompt,
            batch_storage_account_url=batch_storage_account_url,
            batch_container=batch_container,
            batch_blob_name=batch_blob_name,
            batch_value_column=batch_value_column,
            batch_blob_version_id=batch_blob_version_id,
        )
