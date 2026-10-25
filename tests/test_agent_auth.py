from __future__ import annotations

from hosted_agent.auth import AgentAuthorizationService


def test_agent_authorization_uses_the_role_for_the_requested_mode(agent_settings) -> None:
    calls = []

    class Validator:
        def validate(self, authorization_header: str | None, **kwargs):
            calls.append((authorization_header, kwargs))
            return {"roles": [kwargs["required_app_role"]]}

    authorization_service = AgentAuthorizationService(agent_settings, validator=Validator())

    direct_claims = authorization_service.authorize("Bearer direct", batch_mode=False)
    batch_claims = authorization_service.authorize("Bearer batch", batch_mode=True)

    assert direct_claims["roles"] == ["Agent.Invoke"]
    assert batch_claims["roles"] == ["Agent.Batch.Run"]
    assert calls == [
        (
            "Bearer direct",
            {"required_scope": "", "required_app_role": "Agent.Invoke"},
        ),
        (
            "Bearer batch",
            {"required_scope": "", "required_app_role": "Agent.Batch.Run"},
        ),
    ]
