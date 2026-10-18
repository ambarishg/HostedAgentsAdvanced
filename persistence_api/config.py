from __future__ import annotations

import os
import re
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv
from sqlalchemy import URL


def _int_setting(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer.") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}.")
    return value


@dataclass(frozen=True)
class ApiSettings:
    tenant_id: str
    audience: str
    required_scope: str
    required_app_role: str
    allowed_client_ids: frozenset[str]
    agent_name: str
    agent_version: str
    schema_version: str
    max_request_bytes: int
    max_input_chars: int
    max_result_bytes: int
    retention_days: int
    pg_host: str
    pg_port: int
    pg_database: str
    pg_schema: str
    pg_user: str
    pg_auth_mode: str
    pg_password: str | None
    key_vault_url: str | None
    key_vault_secret_name: str | None
    pg_pool_size: int
    pg_max_overflow: int
    pg_pool_timeout_seconds: int
    pg_connect_timeout_seconds: int
    log_level: str

    @classmethod
    def from_env(cls) -> ApiSettings:
        load_dotenv(override=False)
        required = {
            "API_TENANT_ID": os.getenv("API_TENANT_ID", "").strip(),
            "API_AUDIENCE": os.getenv("API_AUDIENCE", "").strip(),
            "PGHOST": os.getenv("PGHOST", "").strip(),
            "PGDATABASE": os.getenv("PGDATABASE", "").strip(),
            "PGUSER": os.getenv("PGUSER", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError(f"Required configuration is missing: {', '.join(missing)}.")
        if (
            not os.getenv("API_REQUIRED_SCOPE", "").strip()
            and not os.getenv("API_REQUIRED_APP_ROLE", "").strip()
        ):
            raise ValueError("Configure API_REQUIRED_SCOPE or API_REQUIRED_APP_ROLE.")

        schema = os.getenv("PGSCHEMA", "agent_platform").strip()
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", schema):
            raise ValueError("PGSCHEMA must be a valid PostgreSQL identifier.")
        auth_mode = os.getenv("PG_AUTH_MODE", "entra").strip().lower()
        if auth_mode not in {"entra", "password"}:
            raise ValueError("PG_AUTH_MODE must be 'entra' or 'password'.")
        password = os.getenv("PGPASSWORD") or None
        key_vault_url = os.getenv("KEY_VAULT_URL", "").strip() or None
        key_vault_secret = os.getenv("KEY_VAULT_SECRET_NAME", "").strip() or None
        if auth_mode == "password" and not (password or (key_vault_url and key_vault_secret)):
            raise ValueError(
                "Password authentication requires PGPASSWORD or both KEY_VAULT_URL "
                "and KEY_VAULT_SECRET_NAME."
            )

        allowed_clients = frozenset(
            value.strip()
            for value in os.getenv("API_ALLOWED_CLIENT_IDS", "").split(",")
            if value.strip()
        )
        retention_raw = os.getenv("RETENTION_DAYS", "365")
        try:
            retention_days = int(retention_raw)
        except ValueError as exc:
            raise ValueError("RETENTION_DAYS must be an integer.") from exc
        if retention_days < 0:
            raise ValueError("RETENTION_DAYS must not be negative.")
        agent_name = os.getenv("PERSISTENCE_AGENT_NAME", "pcr-agent").strip()
        agent_version = os.getenv("PERSISTENCE_AGENT_VERSION", "1.0.0").strip()
        schema_version = os.getenv("PERSISTENCE_SCHEMA_VERSION", "generic-v1").strip()
        if not agent_name or not agent_version or not schema_version:
            raise ValueError(
                "PERSISTENCE_AGENT_NAME, PERSISTENCE_AGENT_VERSION, and "
                "PERSISTENCE_SCHEMA_VERSION must not be empty."
            )

        return cls(
            tenant_id=required["API_TENANT_ID"],
            audience=required["API_AUDIENCE"],
            required_scope=os.getenv("API_REQUIRED_SCOPE", "").strip(),
            required_app_role=os.getenv("API_REQUIRED_APP_ROLE", "").strip(),
            allowed_client_ids=allowed_clients,
            agent_name=agent_name,
            agent_version=agent_version,
            schema_version=schema_version,
            max_request_bytes=_int_setting("MAX_REQUEST_BYTES", 131_072),
            max_input_chars=_int_setting("MAX_INPUT_CHARS", 20_000),
            max_result_bytes=_int_setting("MAX_RESULT_BYTES", 65_536),
            retention_days=retention_days,
            pg_host=required["PGHOST"],
            pg_port=_int_setting("PGPORT", 5432),
            pg_database=required["PGDATABASE"],
            pg_schema=schema,
            pg_user=required["PGUSER"],
            pg_auth_mode=auth_mode,
            pg_password=password,
            key_vault_url=key_vault_url,
            key_vault_secret_name=key_vault_secret,
            pg_pool_size=_int_setting("PG_POOL_SIZE", 5),
            pg_max_overflow=_int_setting("PG_MAX_OVERFLOW", 5, minimum=0),
            pg_pool_timeout_seconds=_int_setting("PG_POOL_TIMEOUT_SECONDS", 20),
            pg_connect_timeout_seconds=_int_setting("PG_CONNECT_TIMEOUT_SECONDS", 10),
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        )

    def sqlalchemy_url(self) -> URL:
        return URL.create(
            "postgresql+psycopg",
            username=self.pg_user,
            host=self.pg_host,
            port=self.pg_port,
            database=self.pg_database,
        )

    def safe_connection_options(self) -> str:
        return f'-c search_path="{self.pg_schema}",public'


@lru_cache(maxsize=1)
def get_settings() -> ApiSettings:
    return ApiSettings.from_env()
