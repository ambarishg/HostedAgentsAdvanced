from __future__ import annotations

from pathlib import Path

import pytest

from hosted_agent.config import AgentSettings


def _set_required_environment(monkeypatch) -> None:
    for name in (
        "BATCH_STORAGE_ACCOUNT_URL",
        "BATCH_CONTAINER",
        "BATCH_BLOB_NAME",
        "BATCH_VALUE_COLUMN",
        "BATCH_BLOB_VERSION_ID",
        "BATCH_FILE_PATH",
    ):
        monkeypatch.setenv(name, "")
    monkeypatch.setenv(
        "FOUNDRY_PROJECT_ENDPOINT",
        "https://example.services.ai.azure.com/api/projects/test",
    )
    monkeypatch.setenv("FOUNDRY_MODEL_DEPLOYMENT_NAME", "test-model")
    monkeypatch.setenv("PERSISTENCE_API_URL", "https://api.example.test/api/pcr-results")
    monkeypatch.setenv("PERSISTENCE_API_SCOPE", "api://persistence/.default")
    monkeypatch.setenv("AGENT_AUTH_TENANT_ID", "tenant")
    monkeypatch.setenv("AGENT_AUTH_AUDIENCE", "api://hosted-agent")
    monkeypatch.setenv("AGENT_DIRECT_REQUEST_APP_ROLE", "Agent.Invoke")
    monkeypatch.setenv("AGENT_BATCH_REQUEST_APP_ROLE", "Agent.Batch.Run")
    monkeypatch.setenv("SYSTEM_PROMPT_SOURCE", "file")
    monkeypatch.setenv("SYSTEM_PROMPT_PATH", "prompt.txt")
    monkeypatch.setenv("SYSTEM_PROMPT_VERSION", "test")


def test_batch_configuration_reads_blob_settings_without_user_prompt(monkeypatch) -> None:
    _set_required_environment(monkeypatch)
    monkeypatch.setenv("BATCH_STORAGE_ACCOUNT_URL", "https://storage.blob.core.windows.net")
    monkeypatch.setenv("BATCH_CONTAINER", "input")
    monkeypatch.setenv("BATCH_BLOB_NAME", "items.csv")
    monkeypatch.setenv("BATCH_VALUE_COLUMN", "description")
    monkeypatch.setenv("BATCH_BLOB_VERSION_ID", "version-1")

    settings = AgentSettings.from_env()

    assert settings.batch_storage_account_url == "https://storage.blob.core.windows.net"
    assert settings.batch_container == "input"
    assert settings.batch_blob_name == "items.csv"
    assert settings.batch_value_column == "description"
    assert settings.batch_blob_version_id == "version-1"


def test_partial_batch_configuration_is_rejected(monkeypatch) -> None:
    _set_required_environment(monkeypatch)
    monkeypatch.setenv("BATCH_VALUE_COLUMN", "description")

    with pytest.raises(ValueError, match="must be configured together"):
        AgentSettings.from_env()


def test_local_file_batch_configuration_reads_path_and_value_column(monkeypatch) -> None:
    _set_required_environment(monkeypatch)
    for name in (
        "BATCH_STORAGE_ACCOUNT_URL",
        "BATCH_CONTAINER",
        "BATCH_BLOB_NAME",
        "BATCH_BLOB_VERSION_ID",
    ):
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("BATCH_FILE_PATH", "data\\customers.csv")
    monkeypatch.setenv("BATCH_VALUE_COLUMN", "customer")

    settings = AgentSettings.from_env()

    assert settings.batch_file_path == Path("data\\customers.csv")
    assert settings.batch_value_column == "customer"


def test_blob_and_local_batch_inputs_cannot_both_be_configured(monkeypatch) -> None:
    _set_required_environment(monkeypatch)
    monkeypatch.setenv("BATCH_STORAGE_ACCOUNT_URL", "https://storage.blob.core.windows.net")
    monkeypatch.setenv("BATCH_CONTAINER", "input")
    monkeypatch.setenv("BATCH_BLOB_NAME", "items.csv")
    monkeypatch.setenv("BATCH_VALUE_COLUMN", "description")
    monkeypatch.setenv("BATCH_FILE_PATH", "items.csv")

    with pytest.raises(ValueError, match="either blob batch input"):
        AgentSettings.from_env()
