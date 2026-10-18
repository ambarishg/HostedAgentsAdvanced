from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
from azure.storage.blob import BlobServiceClient

from hosted_agent.config import AgentSettings


class PromptError(RuntimeError):
    pass


@dataclass(frozen=True)
class PromptSnapshot:
    text: str
    version: str
    sha256: str


class PromptProvider(Protocol):
    def load_prompt(self) -> PromptSnapshot: ...

    def get_prompt_version(self) -> str: ...

    def get_prompt_hash(self) -> str: ...


class FilePromptProvider:
    def __init__(self, path: Path, version: str, max_prompt_bytes: int = 65_536) -> None:
        self._path = path
        self._version = version
        self._max_prompt_bytes = max_prompt_bytes

    def load_prompt(self) -> PromptSnapshot:
        try:
            if self._path.stat().st_size > self._max_prompt_bytes:
                raise PromptError("Configured system prompt exceeds the size limit.")
            text = self._path.read_text(encoding="utf-8")
        except PromptError:
            raise
        except OSError as exc:
            raise PromptError("Configured system prompt file is unavailable.") from exc
        return _snapshot(text, self._version, self._max_prompt_bytes)

    def get_prompt_version(self) -> str:
        return self._version

    def get_prompt_hash(self) -> str:
        return self.load_prompt().sha256


class BlobPromptProvider:
    def __init__(
        self,
        account_url: str,
        container: str,
        blob_name: str,
        version_id: str,
        auth_mode: str = "default",
        max_prompt_bytes: int = 65_536,
    ) -> None:
        self._account_url = account_url
        self._container = container
        self._blob_name = blob_name
        self._version_id = version_id
        self._auth_mode = auth_mode
        self._max_prompt_bytes = max_prompt_bytes

    def load_prompt(self) -> PromptSnapshot:
        credential = (
            ManagedIdentityCredential()
            if self._auth_mode == "managed_identity"
            else DefaultAzureCredential()
        )
        try:
            service = BlobServiceClient(self._account_url, credential=credential)
            blob = service.get_blob_client(
                self._container, self._blob_name, version_id=self._version_id
            )
            properties = blob.get_blob_properties()
            if properties.version_id != self._version_id:
                raise PromptError("Configured immutable prompt version is not available.")
            if properties.size > self._max_prompt_bytes:
                raise PromptError("Configured system prompt exceeds the size limit.")
            text = blob.download_blob().readall().decode("utf-8")
        except PromptError:
            raise
        except Exception as exc:
            raise PromptError("Configured Blob Storage prompt version is unavailable.") from exc
        finally:
            credential.close()
        return _snapshot(text, self._version_id, self._max_prompt_bytes)

    def get_prompt_version(self) -> str:
        return self._version_id

    def get_prompt_hash(self) -> str:
        return self.load_prompt().sha256


def _snapshot(text: str, version: str, max_prompt_bytes: int) -> PromptSnapshot:
    if not text.strip():
        raise PromptError("Configured system prompt is empty.")
    if len(text.encode("utf-8")) > max_prompt_bytes:
        raise PromptError("Configured system prompt exceeds the size limit.")
    return PromptSnapshot(
        text=text,
        version=version,
        sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )


def create_prompt_provider(settings: AgentSettings) -> PromptProvider:
    if settings.prompt_source == "file":
        assert settings.prompt_path is not None and settings.prompt_version is not None
        return FilePromptProvider(
            settings.prompt_path, settings.prompt_version, settings.max_prompt_bytes
        )
    assert (
        settings.prompt_storage_account_url
        and settings.prompt_container
        and settings.prompt_blob_name
        and settings.prompt_version
    )
    return BlobPromptProvider(
        settings.prompt_storage_account_url,
        settings.prompt_container,
        settings.prompt_blob_name,
        settings.prompt_version,
        settings.auth_mode,
        settings.max_prompt_bytes,
    )
