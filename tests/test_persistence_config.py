from __future__ import annotations

import pytest

from persistence_api.config import ApiSettings


def _set_minimum_api_environment(monkeypatch, *, sslmode: str | None = None) -> None:
    monkeypatch.setattr("persistence_api.config.load_dotenv", lambda **kwargs: None)
    monkeypatch.delenv("PGSSLMODE", raising=False)
    monkeypatch.setenv("PGSSLROOTCERT", "")
    values = {
        "API_TENANT_ID": "tenant",
        "API_AUDIENCE": "api://persistence",
        "API_REQUIRED_SCOPE": "save",
        "PGHOST": "127.0.0.1",
        "PGDATABASE": "agentdb",
        "PGUSER": "agent_app",
        "PG_AUTH_MODE": "password",
        "PGPASSWORD": "local-only",
    }
    if sslmode is not None:
        values["PGSSLMODE"] = sslmode
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def test_api_settings_default_to_verified_postgresql_tls(monkeypatch) -> None:
    _set_minimum_api_environment(monkeypatch)

    settings = ApiSettings.from_env()

    assert settings.pg_sslmode == "verify-full"
    assert settings.pg_sslrootcert is None


def test_api_settings_accept_local_ssl_disable_and_custom_root_certificate(monkeypatch) -> None:
    _set_minimum_api_environment(monkeypatch, sslmode="DISABLE")
    monkeypatch.setenv("PGSSLROOTCERT", "C:\\certs\\postgres-ca.pem")

    settings = ApiSettings.from_env()

    assert settings.pg_sslmode == "disable"
    assert settings.pg_sslrootcert == "C:\\certs\\postgres-ca.pem"


def test_api_settings_reject_invalid_postgresql_ssl_mode(monkeypatch) -> None:
    _set_minimum_api_environment(monkeypatch, sslmode="insecure")

    with pytest.raises(ValueError, match="PGSSLMODE must be a valid libpq SSL mode"):
        ApiSettings.from_env()
