from __future__ import annotations

import hashlib

import pytest

from hosted_agent.prompt_provider import BlobPromptProvider, FilePromptProvider, PromptError


def test_file_prompt_provider_returns_fixed_version_and_fingerprint(tmp_path) -> None:
    prompt_path = tmp_path / "system.txt"
    content = "A system instruction."
    prompt_path.write_text(content, encoding="utf-8")

    snapshot = FilePromptProvider(prompt_path, "release-7").load_prompt()

    assert snapshot.text == content
    assert snapshot.version == "release-7"
    assert snapshot.sha256 == hashlib.sha256(content.encode()).hexdigest()


@pytest.mark.parametrize("content", ["", " \n\t"])
def test_empty_prompt_fails_clearly(tmp_path, content: str) -> None:
    prompt_path = tmp_path / "system.txt"
    prompt_path.write_text(content, encoding="utf-8")

    with pytest.raises(PromptError, match="empty"):
        FilePromptProvider(prompt_path, "release-7").load_prompt()


def test_missing_prompt_fails_without_fallback(tmp_path) -> None:
    with pytest.raises(PromptError, match="unavailable"):
        FilePromptProvider(tmp_path / "missing.txt", "release-7").load_prompt()


def test_blob_prompt_reads_the_configured_immutable_version(monkeypatch) -> None:
    class Credential:
        def close(self) -> None:
            pass

    class Blob:
        def get_blob_properties(self):
            return type("Properties", (), {"version_id": "version-7", "size": 10})()

        def download_blob(self):
            return type("Downloader", (), {"readall": lambda self: b"blob prompt"})()

    class Service:
        def __init__(self, account_url, credential):
            assert account_url == "https://storage.example.test"

        def get_blob_client(self, container, name, *, version_id):
            assert (container, name, version_id) == ("prompts", "system.txt", "version-7")
            return Blob()

    monkeypatch.setattr("hosted_agent.prompt_provider.DefaultAzureCredential", Credential)
    monkeypatch.setattr("hosted_agent.prompt_provider.BlobServiceClient", Service)

    snapshot = BlobPromptProvider(
        "https://storage.example.test", "prompts", "system.txt", "version-7"
    ).load_prompt()

    assert snapshot.text == "blob prompt"
    assert snapshot.version == "version-7"
    assert snapshot.sha256 == hashlib.sha256(b"blob prompt").hexdigest()


def test_blob_prompt_access_failure_is_explicit(monkeypatch) -> None:
    class Credential:
        def close(self) -> None:
            pass

    class Service:
        def __init__(self, account_url, credential):
            pass

        def get_blob_client(self, container, name, *, version_id):
            raise OSError("private account detail")

    monkeypatch.setattr("hosted_agent.prompt_provider.DefaultAzureCredential", Credential)
    monkeypatch.setattr("hosted_agent.prompt_provider.BlobServiceClient", Service)

    with pytest.raises(PromptError, match="Blob Storage"):
        BlobPromptProvider(
            "https://storage.example.test", "prompts", "system.txt", "v1"
        ).load_prompt()
