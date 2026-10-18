from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from hosted_agent.config import AgentSettings
from hosted_agent.orchestration import RequestContext
from hosted_agent.prompt_provider import PromptSnapshot
from hosted_agent.schemas import ExternalRequest
from persistence_api.config import ApiSettings


@pytest.fixture
def agent_settings() -> AgentSettings:
    return AgentSettings(
        project_endpoint="https://example.services.ai.azure.com/api/projects/test",
        model_deployment_name="test-model",
        agent_name="test-agent",
        agent_version="1.0.0",
        result_schema_version="generic-v1",
        auth_mode="default",
        model_timeout_seconds=5,
        max_input_chars=1000,
        max_result_bytes=5000,
        max_prompt_bytes=5000,
        prompt_source="file",
        prompt_path=Path("prompt.txt"),
        prompt_version="dev-v1",
        prompt_storage_account_url=None,
        prompt_container=None,
        prompt_blob_name=None,
        persistence_api_url="https://api.example.test/api/pcr-results",
        persistence_api_scope="api://persistence/.default",
        persistence_api_timeout_seconds=1,
        persistence_api_retries=0,
    )


@pytest.fixture
def request_context(agent_settings: AgentSettings) -> RequestContext:
    return RequestContext(
        request=ExternalRequest(
            request_id=uuid.uuid4(), user_input="hello", metadata={"source": "test"}
        ),
        prompt=PromptSnapshot(
            text="Only follow these system instructions.", version="v1", sha256="a" * 64
        ),
        started_at=0.0,
        settings=agent_settings,
    )


@pytest.fixture
def api_settings() -> ApiSettings:
    return ApiSettings(
        tenant_id="tenant",
        audience="api://persistence",
        required_scope="save",
        required_app_role="",
        allowed_client_ids=frozenset(),
        agent_name="test-agent",
        agent_version="1.0.0",
        schema_version="generic-v1",
        max_request_bytes=10000,
        max_input_chars=1000,
        max_result_bytes=5000,
        retention_days=0,
        pg_host="localhost",
        pg_port=5432,
        pg_database="agent_test",
        pg_schema="agent_platform",
        pg_user="test-role",
        pg_auth_mode="entra",
        pg_password=None,
        key_vault_url=None,
        key_vault_secret_name=None,
        pg_pool_size=2,
        pg_max_overflow=0,
        pg_pool_timeout_seconds=5,
        pg_connect_timeout_seconds=5,
        log_level="INFO",
    )
