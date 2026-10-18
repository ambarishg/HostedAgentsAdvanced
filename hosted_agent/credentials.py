from __future__ import annotations

from functools import lru_cache

from azure.identity import DefaultAzureCredential, ManagedIdentityCredential


@lru_cache(maxsize=2)
def get_credential(auth_mode: str) -> DefaultAzureCredential | ManagedIdentityCredential:
    if auth_mode == "managed_identity":
        return ManagedIdentityCredential()
    return DefaultAzureCredential()
