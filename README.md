# Configurable Foundry Hosted Agent with PostgreSQL Persistence

This repository contains two independently runnable components:

- `hosted_agent`: a Python Microsoft Agent Framework application hosted using Foundry's supported Invocations adapter.
- `persistence_api`: an Azure Functions HTTP API that validates a result and writes it transactionally to Azure Database for PostgreSQL Flexible Server.

The agent accepts a caller-owned request ID and user input, snapshots a configured external prompt, calls a Foundry model for a typed JSON result, validates the result, and then invokes the persistence API. The agent has no PostgreSQL driver or database credential path. It returns a success response only after the API confirms a committed database record.

The Orchestrator returns a PCR classification in `result`, with the fields and category values defined in `prompts/system_prompt.example.txt`. The classification is validated against a strict schema before persistence. An empty transcript is accepted and produces a `Not identified` result with Low confidence and an explanatory rationale.

## Runtime contract

The hosted agent implements Foundry's **Invocations** protocol through `InvocationsHostServer`. It accepts:

```json
{
  "request_id": "optional-uuid",
  "user_input": "The user's task or question",
  "metadata": {
    "source": "application",
    "reference": "optional-reference"
  }
}
```

For single-request invocation, `user_input` must contain non-whitespace text. In configured batch mode, `user_input` may be omitted or supplied, but is ignored; the orchestrator uses each row's `BATCH_VALUE_COLUMN` value instead. If omitted, `request_id` is generated. The invocation adapter's wire response is `{"response":"<JSON string>"}`; decode the `response` value to obtain the application result:

```json
{
  "response": "{\"success\":true,\"status\":\"completed\",\"request_id\":\"...\",\"interaction_id\":\"...\",\"agent_name\":\"pcr-agent\",\"agent_version\":\"1.0.0\",\"prompt_version\":\"local-v1\",\"schema_version\":\"generic-v1\",\"result\":{\"primary_contact_reason\":\"Not identified\",\"demand_driver\":\"Not identified\",\"confidence\":\"Low\",\"evidence\":[],\"rationale\":\"The transcript does not provide enough information to identify a primary contact reason.\",\"secondary_reasons\":[],\"demand_driver_evidence\":[],\"demand_driver_rationale\":\"The transcript does not provide enough information to identify the underlying demand driver.\"},\"summary\":null,\"warnings\":[],\"duration_ms\":34,\"completed_at\":\"...\"}"
}
```

An invocation failure uses the adapter's error response and never returns a success-shaped persistence confirmation.

The persistence endpoint accepts only `POST /api/pcr-results`. Its OpenAPI contract is `openapi/persistence_api.yaml`, with `operationId: save_agent_result`. The Hosted Agent uses a Microsoft Agent Framework `FunctionTool` adapter with the same operation name; orchestration invokes it only after result validation, rather than asking the model to decide whether to persist. The adapter calls the single API operation with an Entra bearer token and waits for its response. The API returns `201` for a new commit, `200` for an identical idempotent duplicate, or `409` for a conflicting reuse of `request_id`.

## Local development

### Requirements

- Python 3.11–3.13
- `uv`
- Azure Functions Core Tools v4 for running the Function endpoint
- PostgreSQL 14+ (a disposable local PostgreSQL container is recommended)
- Azure CLI sign-in to a Foundry project for live model calls; unit tests do not require Azure credentials

The lock pins Microsoft Agent Framework Core 1.22.0, Foundry integration 1.15.0, and the current Foundry Hosting adapter 1.0.0b261015. Hosted agent protocol and SDK usage follow the [official Hosted Agents concepts](https://learn.microsoft.com/azure/foundry/agents/concepts/hosted-agents) and the [Microsoft Agent Framework Python hosted-agent sample](https://github.com/microsoft/agent-framework/tree/main/python/samples/04-hosting/foundry-hosted-agents).

### Install and configure

```powershell
uv sync
Copy-Item .env.example .env
.venv\Scripts\Activate.ps1
```

Edit `.env` with your own Foundry endpoint, model deployment, prompt reference, API registration details, and local PostgreSQL settings. Do not check `.env` or `local.settings.json` into source control.

For local prompt development:

```dotenv
SYSTEM_PROMPT_SOURCE=file
SYSTEM_PROMPT_PATH=prompts/system_prompt.example.txt
SYSTEM_PROMPT_VERSION=local-v1
```

The prompt is loaded once per invocation. Its SHA-256 and version are recorded; prompt contents are not returned, persisted, or logged. A missing or whitespace-only prompt fails the invocation. The blob option requires Blob versioning and an immutable `PROMPT_VERSION` (the Azure Blob version ID); configure the Hosted Agent identity with `Storage Blob Data Reader`.

To process rows from an Azure Blob file, set `BATCH_STORAGE_ACCOUNT_URL`, `BATCH_CONTAINER`, `BATCH_BLOB_NAME`, and `BATCH_VALUE_COLUMN`. Each row's configured value is used as that row's user prompt; no separate `USER_PROMPT` or invocation `user_input` is needed. Optionally set `BATCH_BLOB_VERSION_ID` to pin an immutable input version. When these batch settings are enabled, each invocation processes that blob, generates one response per row, and persists each result. Grant the agent identity Blob Data Reader access to the input container.

For local CSV batch input, set `BATCH_FILE_PATH` and `BATCH_VALUE_COLUMN` instead. Each row's configured value is used directly as that row's user prompt. Rows are streamed from disk, and each generated result is persisted separately. The file must be readable at the configured path by the agent process. Batch invocations do not use `user_input`; configure either local file input or Blob batch input, not both.

Local identity uses `DefaultAzureCredential`. In Azure set `AGENT_AUTH_MODE=managed_identity`; grant the Hosted Agent identity access to the model, Blob Storage (when used), and the API's Entra application. Never grant it PostgreSQL access.

### Run and test

Start a local or disposable PostgreSQL server, create the database and configured schema, then apply migrations:

```powershell
uv run alembic upgrade head
```

The migration identity must be able to create the configured schema and table. The Function App runtime identity needs only database `CONNECT`, schema `USAGE`, table `SELECT`/`INSERT`, and `DELETE` if retention cleanup is enabled. No arbitrary SQL execution is exposed.

Start the Azure Functions persistence API from the repository root. Configure local values in an untracked `local.settings.json` (copy `local.settings.example.json`) or `.env`:

```powershell
func start
```

Start a local Foundry hosted agent process in another terminal after setting the remaining `.env` values:

```powershell
uv run python -m hosted_agent.entrypoint
```

The Foundry Agent Framework hosting adapter listens on its documented local port (8088 by default). Invoke it with the custom JSON payload:

```powershell
$body = @{
  user_input = "Summarize the main benefit of a transactional database write."
  metadata = @{ source = "local-test" }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri http://localhost:8088/invocations -Method Post `
  -ContentType "application/json" -Body $body
```

The local API uses the same Entra JWT checks as production. Obtain an access token for the configured API audience, or use a test validator in unit tests; there is deliberately no unauthenticated persistence bypass.

Run the checks:

```powershell
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

To run the PostgreSQL concurrency/idempotency integration test, provide a disposable test database whose name contains the standalone word `test`, and explicitly opt in to test-only DDL:

```powershell
$env:TEST_DATABASE_URL = "postgresql+psycopg://USER:PASSWORD@localhost:5432/agent_test"
$env:ALLOW_TEST_DB_DDL = "true"
uv run pytest -m integration
```

The integration test creates and drops only a uniquely named schema in that explicitly designated test database. It must not be pointed at production.
For a disposable remote test server, additionally set `ALLOW_REMOTE_TEST_DB_DDL=true` only after confirming the target is isolated.

### Test the persistence endpoint directly

Acquire a token for the API audience and use the exact persistence schema. The client computes `payload_hash` over the canonical request fields; the API independently recomputes and verifies it.

```powershell
$token = "<access-token-for-the-configured-api-audience>"
$request = @{
  request_id = "b7a7baad-373f-49e8-8c24-5d58d3044444"
  user_input = "Example input"
  result_json = @{
    schema_version = "generic-v1"
    result = @{ answer = "Example result" }
    summary = "Example summary"
    warnings = @()
  }
  agent_name = "pcr-agent"
  agent_version = "1.0.0"
  prompt_version = "local-v1"
  prompt_hash = "<64-character-lowercase-sha256>"
  schema_version = "generic-v1"
  metadata = @{ source = "manual-test" }
  payload_hash = "<sha256-over-canonical-json-of-all-fields-except-payload_hash>"
  duration_ms = 25
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri http://localhost:7071/api/pcr-results -Method Post `
  -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $request
```

Inspect the saved record:

```sql
SELECT id, request_id, agent_name, agent_version, prompt_version, prompt_hash,
       schema_version, user_input, result_json, agent_response, metadata, status,
       created_at, completed_at, duration_ms, input_tokens, output_tokens, payload_hash
FROM agent_platform.agent_interactions
ORDER BY created_at DESC
LIMIT 20;
```

Example record shape (illustrative values only):

```json
{
  "id": "f5abceef-27c0-49b0-a3ea-4fcfb8a42f16",
  "request_id": "b7a7baad-373f-49e8-8c24-5d58d3044444",
  "agent_name": "pcr-agent",
  "agent_version": "1.0.0",
  "prompt_version": "local-v1",
  "prompt_hash": "<64-character-sha256>",
  "schema_version": "generic-v1",
  "user_input": "Example input",
  "result_json": {
    "schema_version": "generic-v1",
    "result": {"answer": "Example result"},
    "summary": "Example summary",
    "warnings": []
  },
  "agent_response": "Example summary",
  "metadata": {"source": "manual-test"},
  "status": "completed",
  "error_code": null,
  "created_at": "2026-10-18T02:00:00Z",
  "completed_at": "2026-10-18T02:00:01Z",
  "duration_ms": 25,
  "input_tokens": null,
  "output_tokens": null,
  "provider_response_id": null,
  "payload_hash": "<64-character-sha256>"
}
```

## Configuration reference

Use `.env.example` as the canonical list of settings. Required settings are validated before processing requests.

| Area | Settings |
| --- | --- |
| Foundry | `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_MODEL_DEPLOYMENT_NAME`, `AGENT_NAME`, `AGENT_VERSION` |
| Output schema | `RESULT_SCHEMA_VERSION` and matching `PERSISTENCE_SCHEMA_VERSION` |
| Prompt | `SYSTEM_PROMPT_SOURCE=file|blob`; file path/version or Blob account/container/name/immutable version ID |
| Batch input | Azure Blob: `BATCH_STORAGE_ACCOUNT_URL`, `BATCH_CONTAINER`, `BATCH_BLOB_NAME`, `BATCH_VALUE_COLUMN`, optional `BATCH_BLOB_VERSION_ID`; local CSV: `BATCH_FILE_PATH`, `BATCH_VALUE_COLUMN` |
| API client | `PERSISTENCE_API_URL`, `PERSISTENCE_API_SCOPE`, timeout and bounded transient retry count |
| API auth | `API_TENANT_ID`, `API_AUDIENCE`, and required delegated scope or application role; optional allowed client IDs |
| PostgreSQL | `PGHOST`, `PGPORT`, `PGDATABASE`, `PGSCHEMA`, `PGUSER`, `PG_AUTH_MODE`, pool and connect limits |
| Password fallback | `PGPASSWORD` for local use, or `KEY_VAULT_URL` and `KEY_VAULT_SECRET_NAME`; Entra auth is preferred |
| Operations | `MAX_INPUT_CHARS`, `MAX_RESULT_BYTES`, `MAX_REQUEST_BYTES`, `RETENTION_DAYS`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, `LOG_LEVEL` |

The API's `PERSISTENCE_AGENT_NAME` and `PERSISTENCE_AGENT_VERSION` must match the agent values; the API checks them against service configuration instead of trusting the request. Schema version mismatches are rejected. Increment both schema version settings when changing the output shape.

## Azure deployment

Deploy the Hosted Agent and the Function App as separate services. A standard Docker image alone does not create a Foundry Hosted Agent; use Foundry's supported Hosted Agent version deployment workflow.

1. Create a Microsoft Foundry project and deploy a model in the project. Grant the Hosted Agent managed identity the Foundry role required to invoke that deployment.
2. Build and publish `Dockerfile.agent` to an Azure Container Registry. Configure the Foundry Hosted Agent with that image, `python -m hosted_agent.entrypoint`, its Foundry project endpoint/model settings, and the managed identity. Publish it using the current [Foundry Hosted Agent deployment guide](https://learn.microsoft.com/azure/ai-foundry/agents/how-to/hosted-agents) and the [Foundry CLI/azd workflow](https://learn.microsoft.com/azure/developer/azure-developer-cli/).
3. Create a Function App using a currently supported Python runtime, enable its managed identity, deploy this repository root (which contains `host.json` and `function_app.py`), and set the persistence API application settings from `.env.example`. Configure the Function App's app authentication only if it preserves the API's bearer token; the function route intentionally uses anonymous Function-key auth because it independently validates Microsoft Entra tokens.
4. Register an Entra application for the persistence API. Set the API audience, expose a delegated scope or application role, and configure `API_REQUIRED_SCOPE` or `API_REQUIRED_APP_ROLE`. Assign the agent identity the corresponding permission and admin-consent it. Configure `API_ALLOWED_CLIENT_IDS` to restrict accepted callers when the client/application ID is known.
5. Create Azure Database for PostgreSQL Flexible Server with Entra authentication and TLS required. Enable the server's Entra administrator, create the database and Entra-mapped role, and allow network access only from the Function App's private/VNet-integrated route or approved subnet. Configure `PG_AUTH_MODE=entra` and the DB Entra role in `PGUSER`. If password auth is required, use Key Vault and grant the Function App identity only `Key Vault Secrets User`; never put a password in agent settings.
6. Create a versioned Blob Storage container and upload the system prompt. Set `SYSTEM_PROMPT_SOURCE=blob`, `PROMPT_VERSION` to the immutable blob version ID, and grant the Hosted Agent identity `Storage Blob Data Reader`.
7. Configure Application Insights for both services. The application logs request/interaction correlation IDs, versions, hashes, timings, token counts where available, status, and sanitized error codes, but not prompt text, input, output, bearer tokens, or connection strings.
8. Apply the Alembic migration using a separate migration identity with DDL privileges, then reduce the Function identity to runtime table privileges. Enable the timer function with `RETENTION_DAYS` set to a positive number or `0` to disable cleanup.
9. Put the API behind Azure API Management for distributed throttling and apply `infra/apim-policy.xml`. Set the APIM named value `PERSISTENCE_API_CALLS_PER_MINUTE` to the desired quota. The policy keys limits by authenticated principal (or client IP where APIM has no principal).
10. Smoke-test a valid invocation, replay the same exact persistence request (expected `200`, `duplicate: true`), and reuse its `request_id` with a changed payload (expected `409`). Verify the PostgreSQL row and application telemetry. Never use live production credentials/resources for destructive tests.

No cloud resources are created by this source project. Before a live deployment, create/configure the Foundry project and model, identities and app registration, Functions host/storage account, PostgreSQL server/database/networking, Blob container/versioning, Application Insights, and (if throttling is required) API Management. Supply their endpoints, audiences, deployment names, database role, scope/role, and immutable prompt version in the service configuration.

## Security and operational behavior

- The system prompt comes only from the configured provider. The caller contract has no prompt field.
- User input is passed as user content and is explicitly treated as untrusted; model-generated content is validated against Pydantic before persistence.
- PostgreSQL access exists only in the Function App. The agent calls one authenticated persistence operation and receives no database credentials.
- The API verifies JWT signature, tenant issuer, audience, expiry, permission, and optional client allowlist. Errors are sanitized.
- Server-side canonical SHA-256 verification and the unique PostgreSQL `request_id` constraint provide race-safe idempotency.
- A persistence timeout may be retried only with the same payload and request ID; the model is never rerun by the HTTP retry logic. A conflicting result is returned as a conflict, not reported as saved.
- Database TLS certificate verification is enabled (`sslmode=verify-full`). Local PostgreSQL should use a trusted certificate or a test-specific configuration; do not disable TLS verification in deployed environments.
- APIM provides distributed throttling. Azure Functions instance-local state is not used as a rate limiter.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Prompt missing/empty | Verify provider selection, path/container/blob name, immutable Blob version ID, and Blob data-plane RBAC. The agent fails closed. |
| Foundry 401/403 | Check project endpoint, model deployment name, agent managed identity, and the Foundry model inference role. |
| Invalid model result | Confirm the model supports structured output and that `RESULT_SCHEMA_VERSION` matches the generic or custom Pydantic schema. Invalid results are not persisted. |
| Persistence 401/403 | Check the agent token scope/audience, API tenant, required scope/app role, consent, optional client allowlist, and clock skew. |
| `409 idempotency_conflict` | The request ID was already committed with a different canonical payload. Submit a new request ID for a new execution. |
| PostgreSQL connection/TLS error | Verify FQDN, VNet/firewall rules, database Entra auth and role mapping, `PGSCHEMA`, TLS chain, and Function managed identity token access. |
| Migration permission failure | Apply migrations using a separate principal that can create the schema and objects; do not grant DDL to the runtime identity. |
| Request throttled | Review the configured API Management named value and rate-limit policy. |

## Official SDK references

- [Hosted agents in Foundry Agent Service](https://learn.microsoft.com/azure/ai-foundry/agents/concepts/hosted-agents)
- [Microsoft Agent Framework overview](https://learn.microsoft.com/agent-framework/overview/agent-framework-overview)
- [Microsoft Agent Framework source and Foundry-hosting samples](https://github.com/microsoft/agent-framework/tree/main/python/samples/04-hosting/foundry-hosted-agents)
- [Azure Functions Python developer reference](https://learn.microsoft.com/azure/azure-functions/functions-reference-python)
- [Azure Database for PostgreSQL Flexible Server Microsoft Entra authentication](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-configure-sign-in-azure-ad-authentication)
