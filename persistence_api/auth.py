from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import jwt
from jwt import PyJWKClient

from persistence_api.config import ApiSettings


class AuthenticationError(RuntimeError):
    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class EntraTokenValidator:
    def __init__(self, settings: ApiSettings, jwks_client: Any | None = None) -> None:
        self._settings = settings
        self._issuers = [
            f"https://login.microsoftonline.com/{settings.tenant_id}/v2.0",
            f"https://sts.windows.net/{settings.tenant_id}/",
        ]
        self._jwks = jwks_client or PyJWKClient(
            f"https://login.microsoftonline.com/{settings.tenant_id}/discovery/v2.0/keys",
            cache_jwk_set=True,
            lifespan=3600,
        )

    def validate(self, authorization_header: str | None) -> Mapping[str, Any]:
        if not authorization_header:
            raise AuthenticationError("authentication_required", 401)
        scheme, _, token = authorization_header.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise AuthenticationError("invalid_authorization_header", 401)
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token.strip())
            claims = jwt.decode(
                token.strip(),
                signing_key.key,
                algorithms=["RS256"],
                audience=self._settings.audience,
                issuer=self._issuers,
                options={"require": ["exp", "iat", "iss", "aud"]},
                leeway=60,
            )
        except jwt.PyJWTError as exc:
            raise AuthenticationError("invalid_access_token", 401) from exc

        client_id = claims.get("azp") or claims.get("appid")
        if self._settings.allowed_client_ids and client_id not in self._settings.allowed_client_ids:
            raise AuthenticationError("caller_not_authorized", 403)

        scopes = set(str(claims.get("scp", "")).split())
        role_claims = claims.get("roles", [])
        roles = (
            {role for role in role_claims if isinstance(role, str)}
            if isinstance(role_claims, list)
            else set()
        )
        required_scope = self._settings.required_scope
        required_role = self._settings.required_app_role
        if (required_scope and required_scope not in scopes) and (
            required_role and required_role not in roles
        ):
            raise AuthenticationError("required_permission_missing", 403)
        if required_scope and required_scope not in scopes and not required_role:
            raise AuthenticationError("required_scope_missing", 403)
        if required_role and required_role not in roles and not required_scope:
            raise AuthenticationError("required_app_role_missing", 403)
        return claims
