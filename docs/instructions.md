# Project: Configurable Hosted AI Agent with Azure PostgreSQL Persistence

## 1. Mission

Build a brand-new, production-oriented AI agent application from an empty repository.

The application must:

1. Accept user input.
2. Load a system prompt supplied externally.
3. Run the AI agent using Microsoft Foundry.
4. Generate a structured response.
5. Persist the input, output, and execution metadata to Azure Database for PostgreSQL.
6. Return the result and persisted record identifier.
7. Handle authentication, validation, failures, retries, and duplicate requests safely.

There is no existing application to preserve. Create the complete project from scratch.

Do not hardcode the business-specific system prompt. Do not hardcode Azure resource names, endpoints, passwords, or other environment-specific configuration.

## 2. Required architecture

Use the following components.

### Component A: Microsoft Foundry Hosted Agent

Implement a code-based Hosted Agent using Python and the currently supported Microsoft Agent Framework integration for Foundry.

Responsibilities:

- Accept the user input through the supported agent invocation protocol.
- Load the configured system prompt.
- Apply the system prompt to the model request.
- Generate a structured result.
- Validate the result against the configured output schema.
- Invoke the persistence tool.
- Wait for the persistence result.
- Return the structured result and persistence confirmation.

Use a Foundry model deployment configured through environment variables.

The agent must not connect directly to PostgreSQL or receive database credentials.

### Component B: External system prompt

Support loading the system prompt from either:

1. A configurable local file for development.
2. Azure Blob Storage for deployed environments.

Use a configurable setting such as:

`SYSTEM_PROMPT_SOURCE=file|blob`

For file-based configuration:

`SYSTEM_PROMPT_PATH=prompts/system_prompt.txt`

For Blob Storage configuration:

`PROMPT_STORAGE_ACCOUNT_URL=https://YOUR_ACCOUNT.blob.core.windows.net`
`PROMPT_CONTAINER=agent-prompts`
`PROMPT_BLOB_NAME=system_prompt.txt`
`PROMPT_VERSION=v1`

The actual settings must be validated at startup or before the first request.

Use managed identity for Blob Storage access where supported.

For reproducibility, load a specific prompt version or immutable blob reference for each run. Do not silently switch prompts during an active request.

Compute and record a SHA-256 fingerprint of the prompt version used. Do not store or log the full prompt in interaction records.

If a configured prompt is missing or empty, fail clearly. Do not silently substitute a generic prompt.

### Component C: PostgreSQL persistence API

Implement a separate Python HTTP API hosted on Azure Functions.

Its sole initial business responsibility is to persist a validated agent result.

Expose one primary operation:

`POST /api/pcr-results`

Use the name PCR only as the initial example business use case. Design the common persistence layer so it can support other agent types later.

The API must:

- Authenticate callers.
- Validate the request schema.
- Enforce idempotency.
- Insert the result into PostgreSQL.
- Commit the transaction before returning success.
- Return the saved interaction ID.
- Return explicit, sanitized errors when persistence fails.

Do not implement arbitrary SQL execution.

### Component D: Azure Database for PostgreSQL

Use Azure Database for PostgreSQL Flexible Server.

Use PostgreSQL JSONB to store structured output. Store the original input and human-readable output separately.

Use SQLAlchemy 2.x, Alembic, and a supported PostgreSQL driver.

Prefer Managed Identity and Microsoft Entra authentication where supported by the deployed runtime and database configuration. Otherwise, retrieve credentials from Azure Key Vault.

Use TLS with certificate verification.

## 3. Technology stack

Use:

- Python 3.12 or another currently supported version compatible with the selected Foundry SDK.
- `uv` for dependency and project management.
- Microsoft Agent Framework with the currently supported Foundry integration.
- FastAPI only if needed for local development, health endpoints, or a separate caller-facing API.
- Azure Functions for the production persistence API.
- Pydantic 2.x for validation.
- SQLAlchemy 2.x.
- Alembic for database migrations.
- The currently supported asynchronous or synchronous PostgreSQL driver.
- Azure Identity for Entra ID and Managed Identity.
- Azure Storage Blob SDK for external prompt loading.
- pytest for automated testing.
- Docker for local packaging and deployment where appropriate.

Before implementing the Foundry integration, inspect the current official Microsoft documentation and SDK examples. Confirm the supported Hosted Agent invocation protocol, tool registration mechanism, environment requirements, and package versions.

Do not invent SDK methods or combine incompatible SDK versions.

## 4. External agent input contract

Define a request model with the following conceptual structure:

{
  "request_id": "optional-uuid",
  "user_input": "The user's task or question",
  "metadata": {
    "source": "application",
    "reference": "optional-reference"
  }
}

Requirements:

- `user_input` is mandatory and non-empty.
- Enforce a configurable maximum input size.
- `request_id` is optional; generate a UUID when omitted.
- Validate supplied UUIDs.
- `metadata` is optional JSON.
- Do not accept arbitrary system prompts from untrusted callers.
- Do not expose internal prompt configuration in the response.

Use the request contract supported by the chosen Hosted Agent runtime. If that runtime's public endpoint does not accept this exact JSON contract, implement a thin authenticated ingress API or adapt the client request format.

The external client must not need to know about database operations.

## 5. External system prompt behavior

The system prompt is independent of the Python source code.

Implement a `PromptProvider` abstraction with operations conceptually equivalent to:

- `load_prompt()`
- `get_prompt_version()`
- `get_prompt_hash()`

Provide two implementations:

- FilePromptProvider.
- BlobPromptProvider.

The selected provider is determined by environment configuration.

The agent must use the prompt as the system-level instruction, not append it to user input as ordinary text.

Treat the user input as untrusted data. Do not let instructions in user input override the system prompt, security policies, or tool permissions.

If the prompt defines a required JSON structure, validate the generated response against the corresponding Pydantic schema.

If a new prompt version changes the output schema, support explicit schema versioning. Do not silently store incompatible result structures under the same schema version.

## 6. Structured response model

Create a configurable Pydantic output model.

For the initial generic implementation, use a generic JSON object for the business result and validate that it is a JSON object. Provide a clear extension point for defining a strict, business-specific schema.

The result must contain:

- `schema_version`
- `result`
- `summary`, when available
- `warnings`, when applicable

Do not invent business fields.

For the PCR use case, allow a specific PCR Pydantic model to be plugged into the application later.

The agent must not treat arbitrary prose as a valid structured response when structured JSON is required.

Handle model refusals, malformed JSON, missing required fields, and output validation failures explicitly.

## 7. Agent execution workflow

Implement the following workflow:

1. Receive the user input.
2. Generate or validate the request ID.
3. Record the execution start time.
4. Load the selected prompt version.
5. Obtain the model response using the supported Foundry Agent Framework API.
6. Validate and normalize the structured result.
7. Calculate the prompt fingerprint and execution duration.
8. Invoke the persistence API with the validated result and required metadata.
9. Wait for the actual tool/API response.
10. Confirm that the response indicates a committed database record.
11. Return the result, interaction ID, request ID, status, prompt version, and agent version.

If validation fails, do not persist an invalid result as a completed record.

Where operational auditing requires failed attempts to be recorded, implement a separate execution-status or failure-audit mechanism. Clearly distinguish failed executions from completed results.

The agent must never report that data has been saved unless the persistence API confirms the commit.

## 8. PostgreSQL table design

Create a table called `agent_interactions`.

Use the following columns:

- `id`: UUID primary key.
- `request_id`: UUID, not null.
- `agent_name`: TEXT, not null.
- `agent_version`: TEXT, nullable.
- `prompt_version`: TEXT, nullable.
- `prompt_hash`: TEXT, not null.
- `schema_version`: TEXT, not null.
- `user_input`: TEXT, not null.
- `result_json`: JSONB, not null for completed results.
- `agent_response`: TEXT, nullable.
- `metadata`: JSONB, nullable.
- `status`: TEXT, not null.
- `error_code`: TEXT, nullable.
- `created_at`: TIMESTAMPTZ, not null.
- `completed_at`: TIMESTAMPTZ, nullable.
- `duration_ms`: BIGINT, nullable.
- `input_tokens`: BIGINT, nullable.
- `output_tokens`: BIGINT, nullable.
- `provider_response_id`: TEXT, nullable.
- `payload_hash`: TEXT, not null.

Use a unique constraint on `request_id` for the initial one-result-per-request model.

Add appropriate indexes on `created_at` and `status`.

Use Alembic migrations rather than relying on ORM auto-creation in production.

If the system later needs multiple operations under one request, introduce a separate execution ID and idempotency key instead of removing the uniqueness safeguard.

## 9. Persistence API contract

Implement `POST /api/pcr-results`.

The request must contain:

- `request_id`
- `user_input`
- `result_json`
- `agent_name`
- `agent_version`
- `prompt_version`
- `prompt_hash`
- `schema_version`
- `metadata`
- `payload_hash`

The API must validate all fields and enforce length and size limits.

On success, return a response conceptually equivalent to:

{
  "success": true,
  "interaction_id": "generated-uuid",
  "request_id": "request-uuid",
  "status": "completed",
  "duplicate": false
}

Use an appropriate HTTP status code for a new insert. Return a documented successful response for an identical repeated request. Return HTTP 409 if the same request ID is reused with a different payload.

Use a database unique constraint to handle concurrent requests safely.

Do not trust a payload hash supplied by the caller without verifying it. Canonicalize the validated request fields and calculate the hash server-side.

The API should derive trusted agent identity and version information from authenticated configuration where feasible, rather than blindly trusting caller-supplied fields.

## 10. Database transaction and error handling

The persistence operation must be atomic.

1. Validate the incoming request.
2. Canonicalize and hash the relevant payload.
3. Begin a database transaction.
4. Check for an existing request ID.
5. If the existing payload is equivalent, return the existing interaction ID.
6. If the request ID conflicts with a different payload, return HTTP 409.
7. Insert the record.
8. Commit the transaction.
9. Return the persisted ID and success status.

If the transaction fails, roll it back and return an appropriate sanitized error.

Handle these error classes separately:

- Invalid input.
- Invalid structured output.
- Missing prompt.
- Prompt access failure.
- Model or agent timeout.
- Model rate limiting.
- Authentication failure.
- Database connection failure.
- Unique constraint conflict.
- Database transaction failure.
- Tool/API timeout.
- Tool/API authentication failure.

Implement bounded retries only for transient failures.

Use idempotency to make retries safe. Do not automatically rerun expensive AI execution merely because a persistence response timed out.

## 11. Authentication and security

Use Managed Identity where supported for:

- Reading the prompt from Blob Storage.
- Calling the persistence API.
- Connecting the persistence API to PostgreSQL.

Verify the actual support for each identity flow in the selected Foundry runtime and tool integration. If a required identity flow is unavailable, use an explicitly configured secure alternative.

Protect the persistence API with Microsoft Entra authentication or another supported authenticated mechanism.

Validate token issuer, audience, expiry, and required authorization.

Grant the API identity only the required PostgreSQL permissions.

Do not expose database credentials to the agent or include them in model prompts or tool arguments.

Use TLS and certificate verification.

Do not log:

- Passwords or connection strings.
- Access tokens.
- Full system prompts.
- Sensitive user input or result data by default.

Implement configurable retention, input-size limits, request throttling, and safe error responses.

## 12. Tool integration

Choose a single supported mechanism for the first version.

Preferred initial approach:

Expose the persistence API through an OpenAPI 3.0 or 3.1 specification and register it as an OpenAPI tool or through a supported Foundry toolbox.

The tool must expose only the save operation.

Requirements:

- Use a descriptive `operationId`, such as `save_agent_result`.
- Define the exact JSON request and response schemas.
- Configure API authentication.
- Use the appropriate API audience and authorization settings.
- Ensure the Hosted Agent can discover and invoke the operation.
- Return a structured success/failure result to the agent.
- Do not expose arbitrary SQL or unrestricted database operations.

If the chosen Hosted Agent framework cannot use the OpenAPI tool directly in the intended execution mode, use the currently supported Foundry toolbox, MCP integration, or a documented framework tool adapter.

Do not invent an integration mechanism or silently fall back to unauthenticated HTTP.

## 13. Observability

Record structured telemetry for:

- Request ID.
- Interaction ID.
- Agent name and version.
- Prompt version and hash.
- Schema version.
- Execution duration.
- Persistence duration.
- Token usage where available.
- Final status.
- Sanitized error code.

Use Application Insights or the supported Azure monitoring integration.

Ensure logs correlate the agent run with the persistence request.

Do not log full input/output content by default.

## 14. Project structure

Create a clean repository with a structure similar to:

agent-platform/
  hosted_agent/
    entrypoint.py
    orchestration.py
    prompt_provider.py
    schemas.py
    tools.py
    config.py
  persistence_api/
    function_app.py
    schemas.py
    config.py
    database.py
    models.py
    repository.py
    service.py
  prompts/
    system_prompt.example.txt
  openapi/
    persistence_api.yaml
  migrations/
  tests/
    test_prompt_provider.py
    test_agent_workflow.py
    test_output_validation.py
    test_persistence.py
    test_idempotency.py
    test_authentication.py
  pyproject.toml
  uv.lock
  .env.example
  Dockerfile
  README.md

Adapt the layout to the actual framework. Do not generate irrelevant Azure Functions files if the selected runtime uses a different supported deployment mechanism.

Keep the Hosted Agent and persistence API as separately testable modules and deployable services.

## 15. Configuration

Provide a `.env.example` containing placeholders for:

- Foundry project endpoint.
- Model deployment name.
- Agent name.
- Agent version.
- Prompt source.
- Prompt file path.
- Blob Storage account URL and prompt reference.
- PostgreSQL host, database, schema, and authentication configuration.
- Persistence API URL.
- Authentication audience and required scopes.
- Connection pool limits.
- Timeouts.
- Input/output limits.
- Logging level.

Never commit actual secrets.

Validate mandatory configuration on startup or before execution.

Document the difference between local developer credentials and production Managed Identity.

## 16. Testing

Implement unit, integration, and end-to-end tests.

Test:

1. Valid user input and successful agent response.
2. Missing or empty prompt.
3. Blob Storage prompt access failure.
4. Prompt version and hash recording.
5. Valid structured JSON response.
6. Invalid JSON or schema mismatch.
7. Successful database insert.
8. Repeated request with identical payload.
9. Repeated request with conflicting payload.
10. Concurrent requests with the same request ID.
11. Database unavailable.
12. API authentication failure.
13. Tool timeout.
14. Agent timeout and rate limiting.
15. Confirmation returned only after a successful database commit.

Mock the model and Foundry calls in unit tests.

Use a disposable PostgreSQL instance or isolated test database for database integration tests.

Do not run destructive tests against production resources.

## 17. Local development

Provide commands for:

- Installing dependencies with `uv`.
- Activating a local environment.
- Configuring environment variables.
- Running the persistence API locally.
- Running the agent locally with developer authentication.
- Applying migrations.
- Running unit and integration tests.
- Testing the HTTP endpoint with curl.
- Inspecting the saved database record.

Use local PostgreSQL through a disposable container if a cloud database is not yet configured.

Provide sample input, expected response shape, and SQL queries for verifying persistence.

## 18. Azure deployment

Provide deployment instructions for:

- A Microsoft Foundry project.
- A supported model deployment.
- A code-based Hosted Agent.
- Azure Database for PostgreSQL Flexible Server.
- Azure Functions for the persistence API.
- Azure Blob Storage for the external system prompt.
- Managed identities and role assignments.
- API authentication.
- PostgreSQL authentication and network rules.
- Application Insights.
- Database migration execution.
- Deployment smoke tests.

Use the supported deployment workflow for the chosen Hosted Agent runtime. Do not assume that an ordinary Docker deployment automatically creates a Foundry Hosted Agent.

Where required, package the agent using the official Foundry Hosted Agent deployment workflow.

Separate local, test, and production configurations.

## 19. Implementation workflow

Stage 1: Inspect the empty repository and verify the latest supported Microsoft Foundry Hosted Agent framework and SDK.

Stage 2: Create the Python project and configuration model.

Stage 3: Implement the external PromptProvider.

Stage 4: Define the structured result schema and database model.

Stage 5: Implement migrations and the PostgreSQL persistence API.

Stage 6: Implement API authentication and idempotency.

Stage 7: Implement the Hosted Agent and tool integration.

Stage 8: Implement tests and run them.

Stage 9: Create the OpenAPI specification and validate it against the deployed API.

Stage 10: Provide the complete deployment guide and smoke tests.

Do not stop after creating a plan or pseudocode. Create the source files, run available tests, and fix implementation errors.

If Azure credentials or resource access are unavailable, complete the local implementation with clearly marked configuration placeholders and report which deployment steps remain.

Do not claim that a live Foundry agent, API, or PostgreSQL connection has been verified unless it has actually been tested.

## 20. Final deliverables

Provide:

- Complete source code.
- Dependency manifest and lockfile.
- External prompt loading implementation.
- Hosted Agent implementation.
- Persistence API.
- PostgreSQL schema and Alembic migration.
- OpenAPI specification.
- Authentication configuration.
- Unit and integration tests.
- Docker and Azure deployment configuration.
- `.env.example`.
- README.
- Sample request and response.
- Example PostgreSQL record.
- Troubleshooting guide.
- List of resources and configuration values I must create in Azure.

The result must be a clean, deployable implementation. Prefer simple, well-tested components over unnecessary frameworks or abstractions.