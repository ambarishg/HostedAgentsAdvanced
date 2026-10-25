from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from hosted_agent.config import AgentSettings
from persistence_api.auth import EntraTokenValidator


@dataclass(frozen=True)
class AgentTokenSettings:
    tenant_id: str
    audience: str
    allowed_client_ids: frozenset[str]
    required_scope: str = ""
    required_app_role: str = ""


class AgentAuthorizationService:
    def __init__(
        self, settings: AgentSettings, validator: EntraTokenValidator | None = None
    ) -> None:
        self._settings = settings
        self._validator = validator or EntraTokenValidator(
            AgentTokenSettings(
                tenant_id=settings.authorization_tenant_id,
                audience=settings.authorization_audience,
                allowed_client_ids=settings.authorization_allowed_client_ids,
            )
        )

    def authorize(self, authorization_header: str | None, *, batch_mode: bool) -> dict[str, Any]:
        required_role = (
            self._settings.batch_request_app_role
            if batch_mode
            else self._settings.direct_request_app_role
        )
        return dict(
            self._validator.validate(
                authorization_header,
                required_scope="",
                required_app_role=required_role,
            )
        )
