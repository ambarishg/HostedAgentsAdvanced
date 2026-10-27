# Deploying the Recommended Authentication and Authorization Design

This runbook deploys the architecture in
[recommended-authentication-authorization-design.md](recommended-authentication-authorization-design.md):

- a React single-page application (SPA) that signs users in through Microsoft Entra ID;
- a Foundry Hosted Agent API protected by its own Entra resource application;
- a Persistence API protected by a different Entra resource application;
- a managed identity that lets only the Hosted Agent write through the
  Persistence API; and
- Azure API Management (APIM) as the public API gateway and a first validation
  layer.

The application still validates tokens and authorization at each service
boundary. Do not remove the application's JWT validation when configuring APIM
or platform authentication.

## 1. Prerequisites and values to collect

Complete these prerequisites before changing Entra configuration:

1. Select the Microsoft Entra tenant that will contain the applications,
   groups, managed identities, and users.
2. Create or identify the Azure subscription, resource group, and region for
   the workload.
3. Create the Foundry project and deploy the model that will be used by the
   Hosted Agent.
4. Create an Azure Container Registry (ACR), Azure Functions hosting/storage,
   Azure Database for PostgreSQL Flexible Server, Application Insights, and
   APIM. The repository does not provision these resources.
5. Configure PostgreSQL networking and Microsoft Entra authentication. The
   Function App must be able to reach PostgreSQL over its approved private or
   VNet-integrated route.
6. Enable blob versioning on the storage account that will contain the
   production system prompt. Create the prompt container and upload the prompt.
7. Install and sign in to the required tools:

   ```powershell
   az login
   az account set --subscription "<subscription-name-or-id>"
   uv sync
   ```

Use the following values consistently. Replace every placeholder before
deployment; do not put production secrets in this document, `.env`, or source
control.

| Variable | Description |
| --- | --- |
| `$tenantId` | Microsoft Entra tenant ID. |
| `$resourceGroup` | Azure resource group containing the deployed resources. |
| `$hostedAgentApiName` | Display name of the Hosted Agent resource application, for example `hosted-agent-api-prod`. |
| `$persistenceApiName` | Display name of the Persistence resource application, for example `persistence-api-prod`. |
| `$uiAppName` | Display name of the React SPA registration, for example `hosted-agents-ui-prod`. |
| `$hostedAgentIdentifierUri` | `api://<hosted-agent-api-application-client-id>`. |
| `$persistenceIdentifierUri` | `api://<persistence-api-application-client-id>`. |
| `$apimGatewayUrl` | Public APIM gateway URL, such as `https://<apim-name>.azure-api.net`. |
| `$persistenceBackendUrl` | HTTPS base URL of the Function App, such as `https://<function-app>.azurewebsites.net`. |
| `$hostedAgentEndpoint` | HTTPS endpoint exposed by the Foundry Hosted Agent deployment. |

Keep a secure deployment record containing the application (client) IDs,
object IDs, service principal IDs, managed identity principal ID, resource
URLs, and immutable prompt blob version ID. They are configuration data, not
secrets, but must be reviewed because an incorrect value can weaken access
control.

## 2. Create the two resource API registrations

Create separate resource applications. A token issued for the Hosted Agent must
not be valid at the Persistence API.

1. In the Azure portal, open **Microsoft Entra ID** > **App registrations** >
   **New registration**.
2. Register `$hostedAgentApiName` as a single-tenant application. No redirect
   URI is required for a resource API.
3. Record its **Application (client) ID**. In **Expose an API**, set the
   Application ID URI to `api://<hosted-agent-api-client-id>`.
4. Repeat the preceding steps for `$persistenceApiName`. Set its URI to
   `api://<persistence-api-client-id>`.
5. On each registration, open **Manifest** and set
   `accessTokenAcceptedVersion` to `2`. Save the change.

### Hosted Agent API permissions

On the Hosted Agent API registration, open **App roles** and create these
roles. Set **Allowed member types** to `Users/Groups` because they authorize
interactive browser users.

| Display name | Value | Allowed member types | Purpose |
| --- | --- | --- | --- |
| Invoke Hosted Agent | `Agent.Invoke` | Users/Groups | Invoke an interactive agent request. |
| Run Hosted Agent Batch | `Agent.Batch.Run` | Users/Groups | Start a batch request. |

Then open **Expose an API** and add the delegated scope below:

| Scope | Who can consent | Purpose |
| --- | --- | --- |
| `Agent.Access` | Admins and users | Lets the SPA request an access token whose audience is the Hosted Agent API. |

If users cannot self-consent in the tenant, select **Admins only** and grant
tenant-wide admin consent later.

### Persistence API permissions

On the Persistence API registration, open **App roles** and create these
roles:

| Display name | Value | Allowed member types | Purpose |
| --- | --- | --- | --- |
| Write Agent Results | `Persistence.Write` | Applications | Lets the Hosted Agent workload persist a validated result. |
| Read Interaction History | `InteractionHistory.Read` | Users/Groups | Lets approved users read interaction history and analytics. |

Open **Expose an API** and add this delegated scope:

| Scope | Who can consent | Purpose |
| --- | --- | --- |
| `Persistence.Read` | Admins and users | Lets the SPA obtain a Persistence API token for approved read routes. |

Do not create a delegated write scope for the Persistence API. The browser
must never receive `Persistence.Write`.

## 3. Register and configure the React SPA

1. In **App registrations**, create `$uiAppName` as a **Single-page
   application**.
2. Under **Authentication**, add each HTTPS production redirect URI used by
   the UI, for example:

   ```text
   https://<ui-host-name>/
   https://<ui-host-name>/redirect.html
   ```

   Add local development URIs only when needed, such as
   `http://localhost:5173/` and `http://localhost:5173/redirect.html`.
   Do not use wildcard redirect URIs.
3. In **API permissions**, select **My APIs**, add the Hosted Agent API's
   `Agent.Access` delegated permission, and add the Persistence API's
   `Persistence.Read` delegated permission.
4. Click **Grant admin consent for \<tenant\>** if tenant policy requires it.
5. Configure the UI's MSAL settings with the SPA client ID, `$tenantId`, and
   the exact scopes:

   ```typescript
   const hostedAgentScopes = [
     "api://<hosted-agent-api-client-id>/Agent.Access",
   ];

   const persistenceScopes = [
     "api://<persistence-api-client-id>/Persistence.Read",
   ];
   ```

6. Request the Hosted Agent scope only for Hosted Agent calls and request the
   Persistence scope only for persistence/history calls. Never reuse an access
   token for the other API.
7. Configure the UI to send `Authorization: Bearer <access-token>` when
   calling APIM. UI route guards may improve user experience but are not an
   authorization boundary.

## 4. Assign user and group access

Use groups rather than direct individual role assignments.

1. Create groups such as `HostedAgent-Invoke-Prod`,
   `HostedAgent-Batch-Prod`, and `InteractionHistory-Readers-Prod`.
2. Add the appropriate users to each group.
3. Open **Enterprise applications** > the Hosted Agent API service principal >
   **Users and groups**. Assign:
   - `HostedAgent-Invoke-Prod` to `Agent.Invoke`;
   - `HostedAgent-Batch-Prod` to `Agent.Batch.Run`.
4. Open the Persistence API service principal > **Users and groups**. Assign
   `InteractionHistory-Readers-Prod` to `InteractionHistory.Read`.
5. Sign in as a member of each group, acquire a fresh token, and verify that
   its `roles` claim includes only the expected role values.

Role assignments can take several minutes to appear in new access tokens.
Sign out, clear the token cache, and acquire a new token after making role
changes.

## 5. Deploy the Persistence API and database

### 5.1 Configure PostgreSQL with least privilege

1. Enable Microsoft Entra authentication on PostgreSQL Flexible Server and
   configure a Microsoft Entra administrator.
2. Create a dedicated Entra-backed runtime role for the Function App. Configure
   it in `PGUSER`.
3. Use a separate migration identity that can create the configured schema and
   table. Do not grant DDL permissions to the Function App runtime identity.
4. Apply migrations with the migration identity:

   ```powershell
   uv run alembic upgrade head
   ```

5. Grant the runtime role only the required database privileges: `CONNECT`,
   schema `USAGE`, table `SELECT` and `INSERT`, plus `DELETE` only when
   retention cleanup is enabled.

### 5.2 Configure the Function App

1. Deploy the repository root as the Function App package. It contains
   `host.json` and `function_app.py`.
2. Enable a system-assigned managed identity on the Function App.
3. Configure the following Function App settings. The values shown are
   production defaults for this architecture; preserve all other required
   settings from `.env.example`.

   ```text
   API_TENANT_ID=<tenant-id>
   API_AUDIENCE=api://<persistence-api-client-id>
   API_REQUIRED_SCOPE=
   API_REQUIRED_APP_ROLE=Persistence.Write
   API_INTERACTION_HISTORY_APP_ROLE=InteractionHistory.Read
   API_ALLOWED_CLIENT_IDS=<hosted-agent-managed-identity-client-id>
   PERSISTENCE_AGENT_NAME=pcr-agent
   PERSISTENCE_AGENT_VERSION=1.0.0
   PERSISTENCE_SCHEMA_VERSION=generic-v1
   PG_AUTH_MODE=entra
   PGSSLMODE=verify-full
   APPLICATIONINSIGHTS_CONNECTION_STRING=<application-insights-connection-string>
   ```

   `API_REQUIRED_APP_ROLE=Persistence.Write` protects the write endpoint.
   The history endpoint separately requires `InteractionHistory.Read`. If
   routes need different validation requirements, configure and test them
   independently rather than weakening a shared setting.
4. Configure the remaining PostgreSQL values (`PGHOST`, `PGPORT`,
   `PGDATABASE`, `PGSCHEMA`, `PGUSER`, pool settings, and trusted root
   certificate if required). Use TLS verification; do not set
   `PGSSLMODE=disable` in Azure.
5. Configure the Function App networking so that PostgreSQL accepts traffic
   only from the Function App's approved private/VNet-integrated path.
6. If platform authentication is enabled on the Function App, require
   authentication and configure the Persistence API audience. Ensure it
   forwards the bearer token required by the application's validator.

The function route intentionally does not rely on a Function key. Its
application-level Entra validation remains required.

## 6. Deploy the Hosted Agent with a managed identity

1. Build the production image:

   ```powershell
   az acr login --name "<acr-name>"
   docker build --file Dockerfile.agent --tag "<acr-login-server>/hosted-agent:<version>" .
   docker push "<acr-login-server>/hosted-agent:<version>"
   ```

2. Create the Foundry Hosted Agent using the current supported Hosted Agent
   image deployment workflow. Configure:
   - image: `<acr-login-server>/hosted-agent:<version>`;
   - command: `python -m hosted_agent.entrypoint`;
   - a system-assigned or user-assigned managed identity;
   - the HTTPS Foundry project endpoint and model deployment name.
3. Grant that identity the minimum Foundry role needed to invoke the configured
   model deployment.
4. Grant the identity `Storage Blob Data Reader` on the prompt storage
   container. Grant the same role on the batch-input container only when batch
   input is enabled.
5. Configure the agent environment:

   ```text
   AGENT_AUTH_MODE=managed_identity
   AGENT_AUTH_TENANT_ID=<tenant-id>
   AGENT_AUTH_AUDIENCE=api://<hosted-agent-api-client-id>
   AGENT_AUTH_ALLOWED_CLIENT_IDS=<ui-spa-client-id>
   AGENT_DIRECT_REQUEST_APP_ROLE=Agent.Invoke
   AGENT_BATCH_REQUEST_APP_ROLE=Agent.Batch.Run

   PERSISTENCE_API_URL=https://<apim-name>.azure-api.net/persistence/api/pcr-results
   PERSISTENCE_API_SCOPE=api://<persistence-api-client-id>/.default

   SYSTEM_PROMPT_SOURCE=blob
   PROMPT_STORAGE_ACCOUNT_URL=https://<storage-account>.blob.core.windows.net
   PROMPT_CONTAINER=<prompt-container>
   PROMPT_BLOB_NAME=<prompt-blob-name>
   PROMPT_VERSION=<immutable-blob-version-id>
   ```

   Also supply `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_MODEL_DEPLOYMENT_NAME`,
   `AGENT_NAME`, `AGENT_VERSION`, `RESULT_SCHEMA_VERSION`, timeout values, and
   any enabled batch configuration from `.env.example`.
6. Do not set PostgreSQL settings or database credentials on the Hosted Agent.
   The agent must reach the database only through the Persistence API.

## 7. Grant the Hosted Agent the Persistence application role

The `Persistence.Write` application role must be assigned to the Hosted
Agent's managed identity service principal. This is the permission represented
in the app-only token's `roles` claim.

1. Find the Hosted Agent managed identity's **principal ID** and **client ID**
   in the Azure portal. For a user-assigned identity, find it under
   **Managed Identities**; for a system-assigned identity, find it on the
   Hosted Agent resource's **Identity** page.
2. Open **Enterprise applications** > the Persistence API service principal >
   **Users and groups** > **Add user/group**.
3. Select the Hosted Agent managed identity, select the
   `Persistence.Write` role, and assign it.
4. If the portal does not show the managed identity as a selectable
   application, create the app-role assignment with Microsoft Graph using a
   privileged deployment identity. Assign the Persistence API role's ID to
   the managed identity service principal's `appRoleAssignments` collection.
5. Acquire a token from the Hosted Agent for
   `api://<persistence-api-client-id>/.default` and confirm:
   - `aud` equals the Persistence API identifier URI;
   - `roles` contains exactly `Persistence.Write` for this path;
   - `appid` or `azp` matches the allowed Hosted Agent client ID.

Do not add `Persistence.Write` to the SPA registration or any user/group.

## 8. Configure APIM

Import two APIs or route groups into APIM:

| APIM route group | Backend | Required token audience | Intended callers |
| --- | --- | --- | --- |
| `/agent/*` | Hosted Agent endpoint | Hosted Agent API URI | SPA users with `Agent.Invoke` or `Agent.Batch.Run`. |
| `/persistence/*` | Function App | Persistence API URI | SPA users for reads; Hosted Agent identity for writes. |

For each route group:

1. Configure the HTTPS backend URL and restrict direct backend ingress where
   possible. APIM is the public client entry point.
2. Apply a `validate-jwt` inbound policy that:
   - uses the tenant's OpenID Connect metadata endpoint:
     `https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`;
   - requires the exact route group's audience;
   - requires a signed, unexpired token from the intended tenant;
   - rejects requests before they reach the backend.
3. For the Hosted Agent routes, require the `Agent.Invoke` or
   `Agent.Batch.Run` role appropriate to the operation.
4. For Persistence read routes, require `InteractionHistory.Read`.
5. For Persistence write routes, require the app-only `Persistence.Write`
   role and restrict allowed client IDs to the Hosted Agent managed identity.
6. Add the repository's `infra/apim-policy.xml` rate-limit policy to the
   Persistence API after configuring its
   `PERSISTENCE_API_CALLS_PER_MINUTE` named value. Choose the quota based on
   expected authenticated caller traffic.
7. Strip or avoid logging the `Authorization` header and complete JWT claims in
   APIM diagnostics.
8. Configure CORS only for the UI origin. CORS is not authentication and must
   not substitute for JWT validation.

The application services validate their own audience and permissions again.
This intentional duplicate validation protects the services if a route is
misconfigured or traffic reaches a backend without APIM.

## 9. Configure the UI endpoints and deploy it

1. Configure the UI production environment with:
   - the SPA client ID;
   - the tenant authority;
   - the exact production redirect URI;
   - the APIM `/agent` and `/persistence` URLs;
   - the two distinct scope arrays described in section 3.
2. Build the UI:

   ```powershell
   Set-Location ui
   npm ci
   npm run build
   ```

3. Deploy `ui\dist` to the selected static hosting platform over HTTPS.
4. Add the final production URL to the SPA registration's redirect URIs and to
   APIM's CORS allowed origins.
5. Verify sign-out clears the local MSAL account/session and redirects through
   the configured Entra logout flow.

## 10. Run deployment verification

Use a non-production test user and a non-production environment first. Never
use a production database for destructive test cases.

| Test | Expected result |
| --- | --- |
| No `Authorization` header at APIM | `401`; neither backend executes. |
| Hosted Agent token sent to Persistence route | `401`; audience mismatch. |
| Persistence token sent to Hosted Agent route | `401`; audience mismatch. |
| User with no Hosted Agent role invokes an agent route | `403`. |
| `Agent.Invoke` user invokes the interactive route | The invocation reaches the Hosted Agent. |
| `Agent.Batch.Run` user invokes a batch route | Batch request is authorized; an invoke-only user is denied. |
| SPA user attempts a persistence write | `403`; the SPA has no `Persistence.Write` app role. |
| Hosted Agent persists a result | The agent obtains an app-only Persistence API token and receives `201` for a new record. |
| Replay the exact persistence request | `200` with the duplicate/idempotent response. |
| Reuse the same request ID with changed payload | `409` conflict. |
| History reader calls a persistence read route | `200` and only policy-permitted data. |
| User without `InteractionHistory.Read` calls history | `403`. |

Inspect application telemetry during each test. It should contain correlation
IDs, stable error codes, response status, and timing, but never bearer tokens,
connection strings, prompt text, user input, model output, or full JWT claims.

## 11. Production operations

1. Review group membership and app-role assignments regularly. Remove inactive
   users and unused workload identities.
2. Alert on unexpected increases in `401`, `403`, rate-limit responses, and
   app-only token failures.
3. Rotate or redeploy image versions through reviewed release automation.
   Update `AGENT_VERSION` and preserve the image tag used by each deployment.
4. Upload prompt changes as new blob versions. Update `PROMPT_VERSION` only to
   the immutable version ID that was reviewed and approved.
5. Review `API_ALLOWED_CLIENT_IDS`, accepted audiences, redirect URIs, APIM
   CORS origins, and backend network access after every topology change.
6. Test Entra signing-key rotation and managed identity token acquisition in a
   staging environment. The validators use the tenant's JWKS endpoint and
   must continue to reject unknown issuers, audiences, and permissions.
7. Keep migrations separate from runtime deployment. The migration identity
   may create schema objects; the Function App runtime identity must not gain
   those privileges.

## Configuration checklist

Before declaring the environment ready, confirm all of the following:

- [ ] Hosted Agent and Persistence APIs have different Entra application IDs
  and identifier URIs.
- [ ] The SPA requests only `Agent.Access` and `Persistence.Read`.
- [ ] Browser users have no persistence write permission.
- [ ] Hosted Agent callers have `Agent.Invoke` and/or `Agent.Batch.Run`
  through group assignments.
- [ ] The Hosted Agent managed identity alone has `Persistence.Write`.
- [ ] APIM validates the correct audience for every route group.
- [ ] Both backend services retain their application-level JWT and policy
  checks.
- [ ] The Hosted Agent has no PostgreSQL connection configuration or
  credentials.
- [ ] Function App database access uses Entra authentication and TLS
  verification.
- [ ] Prompt and optional batch blob access uses managed identity and
  least-privilege storage RBAC.
- [ ] Application Insights and APIM diagnostics exclude credentials, bearer
  tokens, and sensitive payload contents.
