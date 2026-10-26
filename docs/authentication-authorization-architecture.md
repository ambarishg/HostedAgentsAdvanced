# Authentication and Authorization Architecture

## Purpose and trust boundaries

The application has three relevant request paths:

1. A user in the React UI invokes the Hosted Agent.
2. The Hosted Agent writes results to the Persistence API.
3. A user in the React UI reads persisted interaction history and analytics.

Microsoft Entra ID is the identity provider. The UI provides a user experience
boundary only; every backend independently validates the bearer token and makes
the authorization decision. PostgreSQL is reachable only from the Persistence
API and is not exposed to the UI or Hosted Agent.



## Current authentication mechanisms

### React UI

`ui/src/auth.js` uses MSAL Browser to sign in users and acquire tokens for
`VITE_HOSTED_AGENT_SCOPE` and `VITE_PERSISTENCE_API_SCOPE`. Tokens are held in
`sessionStorage`, not long-lived browser storage. The UI decodes the signed
token only to hide unavailable operations; that inspection is not a security
control because a caller can bypass the UI.

### Hosted Agent

`hosted_agent/entrypoint.py` calls `AgentAuthorizationService` before parsing
the request into the agent input schema or executing agent work.
`hosted_agent/auth.py` creates the shared `EntraTokenValidator`, which verifies:

- bearer-header format;
- JWT signature against the tenant JWKS endpoint;
- RS256 algorithm;
- tenant issuer, audience, expiry, and issued-at time;
- optionally, the client application ID from `azp` or `appid`.

The relevant tenant, audience, client allowlist, and role values are loaded by
`hosted_agent/config.py`. `AGENT_AUTH_*` settings may be supplied directly, or
the tenant and audience can reuse `API_TENANT_ID` and `API_AUDIENCE`.

### Persistence API

Each protected Azure Function route in `function_app.py` uses
`requires_authorization`. `persistence_api/auth.py` uses the same
`EntraTokenValidator` checks described above. It also reads:

- `scp` as the space-delimited delegated-permission set;
- `roles` as the app-role set.

The Persistence API configuration requires at least one of
`API_REQUIRED_SCOPE` and `API_REQUIRED_APP_ROLE` for write access, and can
limit callers with `API_ALLOWED_CLIENT_IDS`. Its interaction-history and
analytics routes use a separate role setting:
`API_INTERACTION_HISTORY_APP_ROLE`, which defaults to
`InteractionHistory.Read`.

## Current authorization model

The API registration defines a delegated scope, normally `access_as_user`, so
the UI can request a token for the API audience. App roles then authorize a
specific operation. Their values must match the configured values exactly.

| Operation | Enforcement point | Required role or permission |
| --- | --- | --- |
| Direct agent invocation | `hosted_agent.auth.AgentAuthorizationService` | `Agent.Invoke` |
| Batch agent invocation | `hosted_agent.auth.AgentAuthorizationService` | `Agent.Batch.Run` |
| Persistence write | `persistence_api.authorization.AuthorizationService` | `API_REQUIRED_SCOPE` **or** `API_REQUIRED_APP_ROLE` |
| Read interaction history or analytics | `persistence_api.authorization.AuthorizationService` | `InteractionHistory.Read` |

`Agent.Invoke` and `Agent.Batch.Run` are intentionally not checked by
`persistence_api/authorization.py`: that module secures persistence routes,
not the Hosted Agent's invocation endpoint. The Hosted Agent selects the
required role from the request mode and passes it to the common validator.

For browser-driven delegated access, Entra normally emits `scp`, and it can
also emit assigned user/group app roles in `roles`. For service-to-service
access using a managed identity or client credentials, Entra normally emits
application permissions in `roles`, not `scp`. The Hosted Agent's
`PERSISTENCE_API_SCOPE` can use `api://<api-id>/.default` to request the
statically assigned application permissions for that service call.

## Entra configuration locations

Configure these values in Microsoft Entra ID:

| Configuration | Location |
| --- | --- |
| API Application ID URI and `access_as_user` | App registrations -> API app -> Expose an API |
| `Agent.Invoke`, `Agent.Batch.Run`, and `InteractionHistory.Read` definitions | App registrations -> API app -> App roles |
| UI delegated permission to request `access_as_user` | App registrations -> UI app -> API permissions -> My APIs |
| User or group app-role assignments | Enterprise applications -> API service principal -> Users and groups |
| Hosted Agent managed-identity app-role assignment | Enterprise applications -> API service principal -> Users and groups, or a supported automation/IaC mechanism |

The API app registration and Hosted Agent registration can be separate. If
they are separate, define `Agent.Invoke` and `Agent.Batch.Run` on the resource
representing the Hosted Agent endpoint, and define persistence permissions on
the Persistence API resource.

## Recommended practices

1. **Use separate resource app registrations per backend when their audiences
   or permissions differ.** Give the Hosted Agent and Persistence API distinct
   Application ID URIs and delegated scopes. This prevents a token intended for
   one service from being accepted by the other and makes ownership clearer.
2. **Use app roles for endpoint authorization and scopes for consent.** Keep
   delegated scopes coarse enough to establish user access to one resource, and
   enforce operation-specific app roles server-side. Do not rely on UI role
   checks.
3. **Use workload identities for service-to-service calls.** Assign the
   Hosted Agent managed identity only the application role needed to write to
   the Persistence API. Configure `API_REQUIRED_APP_ROLE` for that path and
   use the `.default` scope when acquiring its token. Do not use a user's token
   for background work.
4. **Separate write and read permissions.** Use a dedicated persistence-write
   app role rather than allowing every identity with a delegated
   `access_as_user` scope to write. Retain `InteractionHistory.Read` for
   history and analytics, and add narrowly scoped administrative roles when
   needed.
5. **Keep the shared token validator strict.** Continue validating signature,
   issuer, audience, expiry, issued-at time, and the optional caller allowlist.
   Keep JWKS caching bounded to support Entra signing-key rotation. Never log
   bearer tokens or complete claims.
6. **Apply defense in depth at the platform edge.** Enable Entra
   authentication at Azure Functions/App Service or validate JWTs at API
   Management before traffic reaches the application. Preserve the existing
   route-level role checks because platform-level authentication alone cannot
   enforce operation-specific permissions.
7. **Manage role definitions and assignments as code where possible.** Keep
   role values in a central configuration source, automate assignments through
   reviewed IaC or deployment automation, and test the resulting claims in a
   non-production tenant. This avoids capitalization drift between Entra and
   environment settings.
8. **Test authorization as a contract.** Cover missing, expired, wrong-issuer,
   wrong-audience, wrong-client, missing-role, and missing-scope tokens for
   every protected route. Test that a direct-invocation user cannot start a
   batch and that a history reader cannot invoke or persist agent work.

## Operational guidance

Use group-based assignments instead of individual assignments, enable role
assignment change auditing, and require fresh sign-in after changes because
existing tokens do not gain new role claims. Monitor 401 and 403 events with
stable error codes and correlation IDs. Store secrets outside application
settings when a managed identity cannot be used; prefer certificates or
federated credentials over client secrets.
