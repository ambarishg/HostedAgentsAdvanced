from __future__ import annotations

from functools import lru_cache
from typing import Any

import certifi
from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
from azure.keyvault.secrets import SecretClient
from sqlalchemy import Engine, create_engine, event

from persistence_api.config import ApiSettings, get_settings


def _get_database_password(settings: ApiSettings) -> str:
    if settings.pg_password:
        return settings.pg_password
    if not settings.key_vault_url or not settings.key_vault_secret_name:
        raise ValueError("Database password is not configured.")
    credential = DefaultAzureCredential()
    try:
        secret = SecretClient(vault_url=settings.key_vault_url, credential=credential).get_secret(
            settings.key_vault_secret_name
        )
        if not secret.value:
            raise ValueError("Configured database password secret is empty.")
        return secret.value
    finally:
        credential.close()


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    connect_args: dict[str, Any] = {
        "sslmode": "verify-full",
        "sslrootcert": certifi.where(),
        "connect_timeout": settings.pg_connect_timeout_seconds,
        "options": settings.safe_connection_options(),
    }
    if settings.pg_auth_mode == "password":
        connect_args["password"] = _get_database_password(settings)

    engine = create_engine(
        settings.sqlalchemy_url(),
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_size=settings.pg_pool_size,
        max_overflow=settings.pg_max_overflow,
        pool_timeout=settings.pg_pool_timeout_seconds,
    )
    if settings.pg_auth_mode == "entra":
        credential = ManagedIdentityCredential()

        @event.listens_for(engine, "do_connect")
        def add_entra_token(
            dialect: Any, conn_rec: Any, cargs: list[Any], cparams: dict[str, Any]
        ) -> None:
            token = credential.get_token("https://ossrdbms-aad.database.windows.net/.default")
            cparams["password"] = token.token

    return engine
