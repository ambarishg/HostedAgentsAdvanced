from __future__ import annotations

from collections.abc import Mapping
from enum import Enum
from typing import Any

from persistence_api.auth import EntraTokenValidator
from persistence_api.config import ApiSettings


class AuthorizationPolicy(Enum):
    PERSISTENCE_WRITE = "persistence_write"
    INTERACTION_HISTORY_READ = "interaction_history_read"


class AuthorizationService:
    """Applies the API's operation-specific Entra authorization policies."""

    def __init__(self, settings: ApiSettings, token_validator: EntraTokenValidator) -> None:
        self._settings = settings
        self._token_validator = token_validator

    def authorize(
        self, authorization_header: str | None, policy: AuthorizationPolicy
    ) -> Mapping[str, Any]:
        if policy is AuthorizationPolicy.PERSISTENCE_WRITE:
            return self._token_validator.validate(authorization_header)
        if policy is AuthorizationPolicy.INTERACTION_HISTORY_READ:
            return self._token_validator.validate(
                authorization_header,
                required_scope="",
                required_app_role=self._settings.interaction_history_app_role,
            )
        raise ValueError(f"Unsupported authorization policy: {policy}.")
