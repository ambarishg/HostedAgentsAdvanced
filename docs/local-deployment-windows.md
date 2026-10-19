# Local Deployment on Windows 11

This guide runs the persistence API and Foundry agent as local processes. A complete end-to-end invocation still uses Azure services for the Foundry model, Microsoft Entra authentication, and (with the database TLS verification configured by this project) PostgreSQL. The simplest setup is to run both applications locally and connect the API to Azure Database for PostgreSQL Flexible Server.

The project supports Python 3.11–3.13, not Python 3.14. This guide uses Python 3.12 in a separate project environment and leaves your installed Python 3.14 unchanged.

## 1. Install the prerequisites

Install Python 3.12, `uv`, Node.js LTS, Azure CLI, and Azure Functions Core Tools v4. Docker Desktop is optional. For example, with `winget`:

```powershell
winget install --id Python.Python.3.12 -e
winget install --id astral-sh.uv -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Microsoft.AzureCLI -e
```

Close and reopen PowerShell after installing tools so `PATH` is refreshed. Install Functions Core Tools v4 using npm:

```powershell
npm install -g azure-functions-core-tools@4
```

Verify installations:

```powershell
py -0p
uv --version
node --version
npm --version
az --version
func --version
```

If `winget` is unavailable, install the same tools using their official Windows installers. Use Python 3.12 for this project even if Python 3.14 is your default.

## 2. Create the project environment

In PowerShell:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
uv python install 3.12
$env:UV_PROJECT_ENVIRONMENT = ".venv-py312"
uv sync --python 3.12
uv run python --version
```

The last command should print Python 3.12.x. The environment is named `.venv-py312`, so it does not replace an existing `.venv` or change your system Python. In each new PowerShell window, set the environment variable again before running `uv run`:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
$env:UV_PROJECT_ENVIRONMENT = ".venv-py312"
```

Alternatively, activate the environment for that PowerShell window:

```powershell
.\.venv-py312\Scripts\Activate.ps1
```

## 3. Configure Azure services and sign in

Have these configured before attempting an end-to-end run:

- A Microsoft Foundry project with a deployed model that supports structured output. Your signed-in identity needs permission to invoke the model.
- ed1f8ff0-599f-4a50-bf5e-0fac64619ec8.
- An Azure Database for PostgreSQL Flexible Server database and a user allowed to run the migration. Permit your current public IP in the server firewall.

Sign in to the tenant and select the subscription containing your Foundry project:

```powershell
az login --tenant YOUR-TENANT-ID --scope api://YOUR-API-APPLICATION-ID/.default
az account set --subscription YOUR-SUBSCRIPTION-ID
az account show
```

The scope must match `PERSISTENCE_API_SCOPE` in `.env`. Set `API_AUDIENCE` to the exact `aud` value of the access token; for the Azure CLI v1 token shown by this setup, that is the API Application ID URI (`api://YOUR-API-APPLICATION-ID`). The agent uses `DefaultAzureCredential` locally and can use the Azure CLI sign-in only when the persistence API has authorized the Azure CLI client application for its delegated scope. The API independently validates the token's signature, tenant, audience, expiry, and required permission; local mode does not disable API authentication.

## 4. Configure environment settings

Create local configuration files:

```powershell
Copy-Item .env.example .env
Copy-Item local.settings.example.json local.settings.json
```

Edit `.env` and replace the placeholders. At a minimum, set:

```dotenv
FOUNDRY_PROJECT_ENDPOINT=https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT
FOUNDRY_MODEL_DEPLOYMENT_NAME=YOUR-MODEL-DEPLOYMENT
AGENT_AUTH_MODE=default

SYSTEM_PROMPT_SOURCE=file
SYSTEM_PROMPT_PATH=prompts/system_prompt.example.txt
SYSTEM_PROMPT_VERSION=local-v1


# 75d2fd2d-a0ed-4767-8a0e-d6b3aa80fcda = YOUR-API-APPLICATION-ID
# 0f942ca0-ebef-4f26-80f8-f501d599ba90 = TENANT_ID

PERSISTENCE_API_URL=http://localhost:7071/api/pcr-results
PERSISTENCE_API_SCOPE=api://75d2fd2d-a0ed-4767-8a0e-d6b3aa80fcda/.default

API_TENANT_ID=0f942ca0-ebef-4f26-80f8-f501d599ba90 #YOUR-TENANT-ID
API_AUDIENCE=api://75d2fd2d-a0ed-4767-8a0e-d6b3aa80fcda # YOUR-API-APPLICATION-ID
API_REQUIRED_SCOPE=access_as_user
API_REQUIRED_APP_ROLE=
API_ALLOWED_CLIENT_IDS=

AGENT_NAME=pcr-agent
AGENT_VERSION=1.0.0
RESULT_SCHEMA_VERSION=generic-v1
PERSISTENCE_AGENT_NAME=pcr-agent
PERSISTENCE_AGENT_VERSION=1.0.0
PERSISTENCE_SCHEMA_VERSION=generic-v1

PGHOST=YOUR-SERVER.postgres.database.azure.com
PGPORT=5432
PGDATABASE=agentdb
PGSCHEMA=agent_platform
PGUSER=YOUR-DATABASE-USER
PG_AUTH_MODE=password
PGPASSWORD=YOUR-DATABASE-PASSWORD

RETENTION_DAYS=0
```

Keep the Foundry project endpoint and model deployment name exact. Use the API app registration's Application ID URI for `API_AUDIENCE`; use the matching API scope in `PERSISTENCE_API_SCOPE`. The scope name in `API_REQUIRED_SCOPE` must match the scope exposed by that app. Leave `API_ALLOWED_CLIENT_IDS` blank during initial local testing unless you have identified the correct client ID to allow.

To enable local CSV batch processing, configure `BATCH_FILE_PATH` and `BATCH_VALUE_COLUMN` in `.env`, for example:

```dotenv
BATCH_FILE_PATH=C:\Ambarish\HostedAgentsAdvanced\data\customers.csv
BATCH_VALUE_COLUMN=customer
```

The path is resolved by the agent process on the same machine; use an absolute Windows path or a path relative to the process working directory. The CSV must be UTF-8 and contain the configured value column. Each row's value in that column is used as the row's USER prompt and processed/persisted separately. Configure either local file input or Blob batch input, not both.

The local API settings are loaded from `.env`; `local.settings.json` supplies Azure Functions host settings such as `AzureWebJobsStorage` and `FUNCTIONS_WORKER_RUNTIME`. Do not commit `.env` or `local.settings.json`.

For a plain-language explanation of how the API app registration, agent identity, and Function App fit together, including how to configure and troubleshoot them, see [How the persistence API app registration works](entra-api-app-registration-explained.md).

## 5. Apply the database migration

The migration user needs permission to create the configured schema and table. The app verifies the database TLS certificate and hostname, so use the PostgreSQL server DNS hostname (not an IP address) and a certificate trusted by the configured CA bundle.

From the repository root, with `.venv-py312` selected:

```powershell
uv run alembic upgrade head
```

This creates the `agent_platform` schema and persistence table. A typical local PostgreSQL container may not satisfy the configured `sslmode=verify-full` certificate checks. For a straightforward end-to-end setup, use Azure Database for PostgreSQL as above; do not disable TLS verification for a deployed environment.

## 6. Start Azurite and the persistence API

Azure Functions uses Azurite for the local `AzureWebJobsStorage` setting in `local.settings.json`. In one PowerShell window, start Azurite and leave it running:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
npx azurite --silent --location .azurite --debug .azurite\debug.log
```

In a second PowerShell window, start the Functions API:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
$env:UV_PROJECT_ENVIRONMENT = ".venv-py312"
func start
```

The HTTP route should be available at `http://localhost:7071/api/pcr-results`. The route is configured for anonymous Functions-key auth because the application performs its own Entra bearer-token validation. An unauthenticated test request is expected to be rejected.

The authenticated interaction-history route is `GET http://localhost:7071/api/agent-interactions`; it returns `request_id`, `agent_name`, `user_input`, and `agent_response` in pages of up to 100 rows. The UI's **Agent Interaction History** page calls this route. The current UI does not yet include MSAL sign-in; until that frontend integration is added, get a token for `PERSISTENCE_API_SCOPE` and paste it into the UI's **Persistence API access token** field:

```powershell
$token = az account get-access-token `
  --scope "api://YOUR-API-APPLICATION-ID/.default" `
  --query accessToken -o tsv
```

Keep the token private; it remains only in the current UI page state. The caller must have the configured API scope or app role and pass any configured allowed-client check.

### Automatic Entra sign-in for the UI (MSAL rollout)

Use this setup to replace manual token entry with interactive user sign-in. The steps below configure Entra and deployment prerequisites; **they do not by themselves add MSAL to the React UI**. The current UI does not read the `VITE_ENTRA_*` settings below or acquire tokens automatically. That requires a separate frontend change using `@azure/msal-browser` and `@azure/msal-react`. Until that is implemented and deployed, continue using the temporary token procedure above.

#### 1. Record the API registration values

In the Microsoft Entra admin center, open **Identity > Applications > App registrations** and select the registration for the Persistence API. Record:

- **Directory (tenant) ID**.
- **Application (client) ID** for the API.
- The API's **Application ID URI**, expected in this project to be `api://<API-APPLICATION-ID>`.

Under **Expose an API**, verify that the Application ID URI is set and that a delegated scope named `access_as_user` exists and is enabled for the intended users/admins. The API's `API_AUDIENCE` Function setting must exactly match the access token's `aud` claim; this project commonly uses the Application ID URI. Keep `API_REQUIRED_SCOPE=access_as_user`.

#### 2. Register the React UI as a single-page application

Create a **separate** app registration for the browser UI; do not use the API registration as the SPA client.

1. In **App registrations**, select **New registration**. Give it an identifiable name such as `Hosted Agents UI`.
2. Select the account type approved for your organization (normally single-tenant for this project), then create the registration.
3. On the registration's **Authentication** page, choose **Add a platform > Single-page application (SPA)**.
4. Add the local redirect URI `http://localhost:3000/`. Register each actual deployed UI origin as a separate redirect URI, for example `https://hosted-agents.example.com/`. Redirect URIs must match the deployed origin/path exactly; do not use wildcard URLs.
5. Do not create a client secret. A React SPA is a public client; anything bundled into browser JavaScript is visible to users. Do not enable implicit grant as a workaround—use MSAL's authorization-code flow with PKCE.
6. On **API permissions**, choose **Add a permission > My APIs > [Persistence API registration] > Delegated permissions**, select `access_as_user`, and add it.
7. Grant admin consent if required by the tenant. Otherwise, ensure users are allowed to consent to this permission and consent during sign-in.
8. Record the UI app's **Application (client) ID**. This is the SPA client ID, not the API's client ID.

The token requested by the future MSAL UI must use the explicit delegated scope:

```text
api://<API-APPLICATION-ID>/access_as_user
```

The API validates the token's tenant, signature, audience, and delegated scope. The browser should acquire this token with MSAL's `acquireTokenSilent` for API calls, with an interactive fallback when Entra requires user interaction.

#### 3. Allow the SPA caller at the API

The API's optional `API_ALLOWED_CLIENT_IDS` setting compares the token's `azp`/`appid` claim against allowed client IDs. If this setting is non-empty, include the **UI SPA application's client ID** in its comma-separated list. Keep any existing authorized caller IDs when adding it; do not replace an existing list accidentally.

For local Functions, edit the `Values` object in the untracked `local.settings.json` file, for example:

```json
{
  "Values": {
    "API_ALLOWED_CLIENT_IDS": "<UI-SPA-APPLICATION-ID>"
  }
}
```

Merge this property into the existing `Values` object; do not replace the rest of `local.settings.json`. If the API is deployed to Azure, add/update `API_ALLOWED_CLIENT_IDS` in the Function App's **Environment variables / Application settings** and restart the Function App. If the setting is blank, the API does not apply a client-ID allowlist, though it still requires valid Entra authentication and the configured scope.

#### 4. Configure the UI for each environment

After the MSAL frontend integration is added, configure the UI build with these **public, non-secret** Vite settings. They are a specification for the integration; the current UI source does not consume them yet:

```dotenv
VITE_ENTRA_CLIENT_ID=<UI-SPA-APPLICATION-ID>
VITE_ENTRA_TENANT_ID=<DIRECTORY-TENANT-ID>
VITE_ENTRA_REDIRECT_URI=http://localhost:3000/
VITE_PERSISTENCE_API_SCOPE=api://<API-APPLICATION-ID>/access_as_user
VITE_PERSISTENCE_HISTORY_URL=/api/agent-interactions
```

Create `ui\.env.local` for local development and keep it uncommitted. Vite embeds `VITE_*` values in the client bundle, so they are appropriate for tenant/client IDs and URLs only—**never put credentials, client secrets, access tokens, or other secrets in them**. The MSAL app configuration should use the tenant-specific authority `https://login.microsoftonline.com/<DIRECTORY-TENANT-ID>` and the registered redirect URI. The UI should request the Persistence API scope for history requests and send the returned access token in the `Authorization: Bearer` header; it should not store or log the token itself.

For a production build, set the same variables in the UI hosting/build environment, but use the production redirect URI registered in Entra. Rebuild and redeploy the SPA whenever a `VITE_*` value changes; these values are compiled into the static assets. Do not rely on changing a server-side environment setting after the build to update browser configuration.

The local Vite proxy maps `/api` to `http://localhost:7071`, so local browser requests remain same-origin with the UI. If a deployed UI calls the Function App directly instead of through a same-origin backend/proxy, configure the Function App's CORS allowlist for the exact HTTPS UI origin and set `VITE_PERSISTENCE_HISTORY_URL` to the deployed API URL. Do not use `*` as the production allowed origin.

#### 5. Run and verify the sign-in flow

Once the MSAL integration is present:

1. Start/rebuild the UI and API using the local steps above. Open `http://localhost:3000/` and sign in with an account from the configured tenant.
2. Navigate to **Agent Interaction History**. MSAL should silently acquire a token for `access_as_user`; if Entra requires interaction (first consent, MFA, or renewed authentication), the UI should prompt the user through MSAL.
3. In browser developer tools, verify the history request goes to `/api/agent-interactions` (or the configured deployed URL), includes an `Authorization: Bearer` header, and returns `200`. Do not copy the header into logs, screenshots, or support tickets.
4. Verify no token is present in the URL, application source, committed files, or browser console output. A `401` generally indicates authority/tenant, redirect URI, audience, or token validation mismatch. A `403` generally indicates missing delegated consent/scope or a caller ID missing from `API_ALLOWED_CLIENT_IDS`.

For the existing API token validation and troubleshooting details, see [How the Persistence API app registration works](entra-api-app-registration-explained.md).

## 7. Start the agent

In a third PowerShell window:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
$env:UV_PROJECT_ENVIRONMENT = ".venv-py312"
uv run python -m hosted_agent.entrypoint
```

The Invocations server listens on port 8088 by default. Leave the process running.

## 8. Invoke the agent

In a fourth PowerShell window:

```powershell
$body = @{
  user_input = "Summarize the main benefit of a transactional database write."
  metadata = @{ source = "local-test" }
} | ConvertTo-Json -Depth 10

$result = Invoke-RestMethod `
  -Uri http://localhost:8088/invocations `
  -Method Post `
  -ContentType "application/json" `
  -Body $body

$result
```

The response is wrapped in an adapter `response` field containing the application's JSON response as a string. A successful invocation means the model result was validated and the API confirmed persistence. If it fails, inspect the output in the agent and Functions windows; the API intentionally returns sanitized errors.

### Process a local CSV batch

Create a CSV at the configured path with a column matching `BATCH_VALUE_COLUMN`. For example, with `BATCH_VALUE_COLUMN=customer`:

```csv
customer
Summarize Alice's profile
Summarize Bob's profile
Summarize Contoso's profile
```

Each row's `customer` value is sent directly to the model as that row's USER prompt and persisted as a separate interaction. Rows are read incrementally, so the full CSV is not loaded into memory. A row error is recorded and processing continues with the next row.

Start the agent with `BATCH_FILE_PATH` and `BATCH_VALUE_COLUMN` set in `.env`, then invoke it without `user_input`:

```powershell
$body = @{
  metadata = @{ source = "local-file-batch" }
} | ConvertTo-Json -Depth 10

$result = Invoke-RestMethod `
  -Uri http://localhost:8088/invocations `
  -Method Post `
  -ContentType "application/json" `
  -Body $body

$result
```

The returned batch response includes the per-row results and any row errors. Check PostgreSQL for the persisted interactions using the query above. To return to single-request processing, clear `BATCH_FILE_PATH` and `BATCH_VALUE_COLUMN` from `.env` and restart the agent.

When invoking from the React UI, enable **Invoke using configured batch input** before submitting. The UI sends `batch_mode: true`, omits `user_input`, and the agent uses its configured batch file/blob. Leave this toggle off for a single request; the UI sends `batch_mode: false` and the agent uses the text in the UI's **User request** field, even when batch input is configured on the server.

Verify a row in PostgreSQL:

```sql
SELECT request_id, agent_name, prompt_version, schema_version, status, created_at
FROM agent_platform.agent_interactions
ORDER BY created_at DESC
LIMIT 10;
```

## 9. Run local checks

These checks do not require Azure credentials:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
$env:UV_PROJECT_ENVIRONMENT = ".venv-py312"
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

The PostgreSQL concurrency integration test is skipped unless a disposable test database is explicitly configured with the opt-in variables described in `README.md`. Never use a production database for that test.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| `func` is not recognized | Install Functions Core Tools v4, reopen PowerShell, and run `func --version`. |
| Python 3.14 is selected | Set `$env:UV_PROJECT_ENVIRONMENT = ".venv-py312"`, run `uv sync --python 3.12`, and verify with `uv run python --version`. |
| Functions host cannot reach storage | Confirm Azurite is running and `local.settings.json` has `AzureWebJobsStorage` set to `UseDevelopmentStorage=true`. |
| Foundry authentication or model error | Check `az account show`, project endpoint, deployment name, model access, and structured-output support. |
| `Could not acquire an Entra token for PERSISTENCE_API_SCOPE` or `AADSTS65001` | Run `az login --tenant YOUR-TENANT-ID --scope api://YOUR-API-APPLICATION-ID/.default` using the exact `PERSISTENCE_API_SCOPE` from `.env`. If consent is blocked, ask the tenant administrator to grant the required delegated API permission. |
| `AADSTS650057: Invalid resource` for client `04b07795-8ddb-461a-bbee-02f9e1bf7b46` | The Microsoft Azure CLI client is not authorized for this custom API. In the API app registration, add Microsoft Azure CLI (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`) under **Expose an API > Authorized client applications** and select the delegated `access_as_user` scope, then retry login. If tenant policy does not allow preauthorizing Azure CLI, use a client app registration your organization controls and configure the local agent to authenticate with that client instead. |
| Persistence API returns 401 | Check that the token audience matches `API_AUDIENCE` in `local.settings.json` and that `API_TENANT_ID` matches the signed-in tenant. |
| Persistence API returns 403 | Check `API_REQUIRED_SCOPE`, consent for the API scope, and `API_ALLOWED_CLIENT_IDS`; inspect the Functions host log for the sanitized `error_code` (`required_scope_missing`, `caller_not_authorized`, or related reason). |
| PostgreSQL connection or certificate failure | Check firewall allowlisting, server FQDN, database/user/password, TLS certificate trust, and schema permissions. |
| Missing prompt | Check the prompt path relative to the repository root and ensure the file is present and non-empty. |

For Azure-hosted deployment and broader security/configuration details, see `README.md`.
