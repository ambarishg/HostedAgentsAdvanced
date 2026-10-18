from __future__ import annotations

import jwt
import pytest

from persistence_api.auth import AuthenticationError, EntraTokenValidator
from persistence_api.config import ApiSettings


class FakeJwks:
    def get_signing_key_from_jwt(self, token: str):
        assert token == "signed-token"
        return type("SigningKey", (), {"key": "verified-key"})()


def auth_settings() -> ApiSettings:
    return ApiSettings(
        tenant_id="tenant",
        audience="api://persistence",
        required_scope="save",
        required_app_role="",
        allowed_client_ids=frozenset({"agent-client"}),
        agent_name="agent",
        agent_version="1",
        schema_version="generic-v1",
        max_request_bytes=1000,
        max_input_chars=100,
        max_result_bytes=1000,
        retention_days=0,
        pg_host="localhost",
        pg_port=5432,
        pg_database="agent_test",
        pg_schema="agent_platform",
        pg_user="agent",
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


def test_entra_token_checks_signature_issuer_audience_permission_and_client(monkeypatch) -> None:
    claims = {
        "iss": "https://login.microsoftonline.com/tenant/v2.0",
        "aud": "api://persistence",
        "exp": 4_000_000_000,
        "iat": 1_700_000_000,
        "scp": "save",
        "azp": "agent-client",
    }
    monkeypatch.setattr(jwt, "decode", lambda *args, **kwargs: claims)

    validated = EntraTokenValidator(auth_settings(), jwks_client=FakeJwks()).validate(
        "Bearer signed-token"
    )

    assert validated["azp"] == "agent-client"


def test_entra_token_accepts_v1_issuer_for_azure_cli_tokens(monkeypatch) -> None:
    claims = {
        "iss": "https://sts.windows.net/tenant/",
        "aud": "api://persistence",
        "exp": 4_000_000_000,
        "iat": 1_700_000_000,
        "scp": "save",
        "appid": "agent-client",
        "ver": "1.0",
    }
    decode_kwargs = {}

    def decode(*args, **kwargs):
        decode_kwargs.update(kwargs)
        return claims

    monkeypatch.setattr(jwt, "decode", decode)

    authorization_header = "Bearer " + "signed-" + "token"
    validated = EntraTokenValidator(auth_settings(), jwks_client=FakeJwks()).validate(
        authorization_header
    )

    assert validated["ver"] == "1.0"
    assert decode_kwargs["issuer"] == [
        "https://login.microsoftonline.com/tenant/v2.0",
        "https://sts.windows.net/tenant/",
    ]


def test_missing_token_is_401() -> None:
    with pytest.raises(AuthenticationError) as error:
        EntraTokenValidator(auth_settings(), jwks_client=FakeJwks()).validate(None)

    assert error.value.status_code == 401


def test_missing_permission_is_403(monkeypatch) -> None:
    claims = {
        "iss": "https://login.microsoftonline.com/tenant/v2.0",
        "aud": "api://persistence",
        "exp": 4_000_000_000,
        "iat": 1_700_000_000,
        "scp": "read",
        "azp": "agent-client",
    }
    monkeypatch.setattr(jwt, "decode", lambda *args, **kwargs: claims)

    with pytest.raises(AuthenticationError) as error:
        EntraTokenValidator(auth_settings(), jwks_client=FakeJwks()).validate("Bearer signed-token")

    assert error.value.status_code == 403
