from __future__ import annotations

from dataclasses import replace

import certifi
import pytest

from persistence_api import database


@pytest.mark.parametrize(
    ("sslmode", "rootcert", "expected_rootcert"),
    [
        ("disable", None, None),
        ("verify-full", None, certifi.where()),
        ("verify-full", "C:\\certs\\local-ca.pem", "C:\\certs\\local-ca.pem"),
    ],
)
def test_engine_uses_configured_postgresql_tls(
    api_settings, monkeypatch, sslmode, rootcert, expected_rootcert
) -> None:
    settings = replace(
        api_settings,
        pg_auth_mode="password",
        pg_password="local-only",
        pg_sslmode=sslmode,
        pg_sslrootcert=rootcert,
    )
    captured = {}
    monkeypatch.setattr(database, "get_settings", lambda: settings)
    monkeypatch.setattr(
        database,
        "create_engine",
        lambda url, **kwargs: captured.update(kwargs) or object(),
    )

    database.get_engine.__wrapped__()

    connect_args = captured["connect_args"]
    assert connect_args["sslmode"] == sslmode
    if expected_rootcert is None:
        assert "sslrootcert" not in connect_args
    else:
        assert connect_args["sslrootcert"] == expected_rootcert
