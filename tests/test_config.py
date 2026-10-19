from __future__ import annotations

import pytest

from hosted_agent.config import AgentSettings


def _set_required_environment(monkeypatch) -> None:
    monkeypatch.setenv(
        "FOUNDRY_PROJECT_ENDPOINT",
        "https://example.services.ai.azure.com/api/projects/test",
    )
    monkeypatch.setenv("FOUNDRY_MODEL_DEPLOYMENT_NAME", "test-model")
    monkeypatch.setenv("PERSISTENCE_API_URL", "https://api.example.test/api/pcr-results")
    monkeypatch.setenv("PERSISTENCE_API_SCOPE", "api://persistence/.default")
    monkeypatch.setenv("SYSTEM_PROMPT_SOURCE", "file")
    monkeypatch.setenv("SYSTEM_PROMPT_PATH", "prompt.txt")
    monkeypatch.setenv("SYSTEM_PROMPT_VERSION", "test")


def test_batch_configuration_reads_user_prompt_and_blob_settings(monkeypatch) -> None:
    _set_required_environment(monkeypatch)
    monkeypatch.setenv("USER_PROMPT", "Summarize this item")
    monkeypatch.setenv("BATCH_STORAGE_ACCOUNT_URL", "https://storage.blob.core.windows.net")
    monkeypatch.setenv("BATCH_CONTAINER", "input")
    monkeypatch.setenv("BATCH_BLOB_NAME", "items.csv")
    monkeypatch.setenv("BATCH_VALUE_COLUMN", "description")
    monkeypatch.setenv("BATCH_BLOB_VERSION_ID", "version-1")

    settings = AgentSettings.from_env()

    assert settings.user_prompt == "Summarize this item"
    assert settings.batch_storage_account_url == "https://storage.blob.core.windows.net"
    assert settings.batch_container == "input"
    assert settings.batch_blob_name == "items.csv"
    assert settings.batch_value_column == "description"
    assert settings.batch_blob_version_id == "version-1"


def test_partial_batch_configuration_is_rejected(monkeypatch) -> None:
    _set_required_environment(monkeypatch)
    monkeypatch.setenv("USER_PROMPT", "Summarize this item")

    with pytest.raises(ValueError, match="must be configured together"):
        AgentSettings.from_env()
