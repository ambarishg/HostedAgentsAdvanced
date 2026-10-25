# Backend Authentication with a Microsoft Entra ID Frontend

The frontend must not be the only authentication control. MSAL in the React UI signs users in and obtains access tokens, but any caller can bypass the browser and invoke a public HTTP endpoint directly. Each backend API must independently authenticate and authorize every request.

## Recommended request flow

1. The UI signs the user in through Microsoft Entra ID.
2. The UI requests an access token for the API scope, for example `api://<api-application-id>/access_as_user`.
3. The UI sends the token in the request header:

   ```http
   Authorization: Bearer <access-token>
   ```

4. The API validates the token before reading a request body or performing any business operation.
5. The API authorizes the caller using scopes for delegated user access and app roles for application-to-application access.

## Validate tokens in every backend

Backend validation must confirm all of the following:

- **Signature:** retrieve the signing key from the tenant's OpenID Connect JWKS endpoint and accept only expected signing algorithms.
- **Issuer:** accept only the configured Entra tenant issuer or issuers.
- **Audience:** require the API application's Application ID URI or client ID; never accept a token issued for another API.
- **Lifetime:** require and validate expiration and issued-at claims, with only a small clock-skew allowance.
- **Authorized client:** when applicable, allow only known client application IDs from the `azp` or `appid` claim.
- **Permissions:** require the configured delegated scope in `scp` or application role in `roles`.

The Persistence API already follows this pattern through `persistence_api.auth.EntraTokenValidator`. Its routes validate the `Authorization` header before processing requests. New Persistence API routes should use the same validator rather than implementing a separate, weaker check.

## Protect the agent invocation backend

The UI also submits requests to the hosted-agent invocation endpoint. That endpoint needs the same protection if it is reachable from the browser or another public network:

1. Register or configure the agent endpoint as an Entra-protected API.
2. Expose a dedicated delegated scope for UI users, such as `access_as_user`.
3. Configure the UI to request that scope rather than reusing a token intended for an unrelated API.
4. Require and validate the bearer token at the agent endpoint or at a trusted gateway placed in front of it.
5. Enforce endpoint-specific scopes or roles. A user who can read interaction history does not necessarily need permission to submit agent workloads.

Do not rely on a frontend route guard, CORS, hidden URLs, or a Function key as the primary authorization mechanism. CORS only constrains browser behavior; it does not authenticate a caller.

## Prefer platform enforcement when available

For Azure-hosted HTTP services, use platform authentication in addition to application-level authorization where practical:

- Enable App Service or Azure Functions Authentication with Microsoft Entra ID.
- Require authentication for unauthenticated requests.
- Restrict accepted token audiences to the API application registration.
- Have the platform forward validated identity claims to the application.
- Continue checking scopes and roles in application code when routes have different permissions.

An API gateway such as Azure API Management can also validate JWTs and enforce a baseline policy before traffic reaches the service. The backend should still verify authorization requirements that depend on the specific operation or resource.

## Authorization design

Use the least-privilege permission model:

| Operation | Suggested permission |
| --- | --- |
| Submit a direct agent request | `Agent.Invoke` scope or role |
| Start a batch workload | `Agent.Batch.Run` scope or role |
| Read interaction history | `Interactions.Read` scope or role |
| Read analytics | `Analytics.Read` scope or role |
| Change configuration or access administrative data | a separate administrator role |

Use delegated scopes for user-driven browser requests. Use application roles and client credentials for trusted background services. Do not use a user access token as a substitute for a workload identity.

## Error handling

Return no business data when validation fails:

- Return **401 Unauthorized** for a missing, malformed, expired, invalid-signature, wrong-issuer, or wrong-audience token.
- Return **403 Forbidden** for an authenticated caller without the required scope, role, or allowed client ID.
- Log a stable error code and request correlation ID, but never log access tokens or their complete claims.

The current Persistence API error responses follow this model by returning generic caller-facing authentication messages while logging a specific error code.

## Operational safeguards

- Use HTTPS for every non-local endpoint.
- Keep tenant IDs, audiences, allowed client IDs, and required permissions in managed configuration.
- Rotate credentials and prefer managed identities for service-to-service calls.
- Cache JWKS keys with a bounded lifetime and support key rotation.
- Monitor authentication failures, forbidden responses, and unusual token audiences or client IDs.
- Test missing-token, invalid-token, wrong-audience, wrong-client, missing-scope, and missing-role cases for every protected route.

## Summary

The frontend should acquire and attach Entra access tokens. The backend remains the enforcement point: it validates the token, checks permissions, and rejects direct unauthenticated or unauthorized calls. A UI sign-in screen improves user experience; server-side token validation protects the API.
