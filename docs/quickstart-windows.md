# Run locally on Windows

You’ll need Python 3.12, `uv`, Node.js, Azure CLI, Azure Functions Core Tools v4, a Foundry project/model, and an Azure Database for PostgreSQL server.

## Configure

From the repository root:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
uv python install 3.12
$env:UV_PROJECT_ENVIRONMENT = ".venv-py312"
uv sync --python 3.12
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
& .\.venv-py312\Scripts\Activate.ps1
Copy-Item .env.example .env
Copy-Item local.settings.example.json local.settings.json
```

Run the execution-policy and activation commands again in each new PowerShell window that runs Python or Azure Functions. The policy change applies only to that PowerShell process.

In `.env`, set your Foundry endpoint and model deployment, plus PostgreSQL host, user, and password. Use the API and tenant values configured for this project:

```dotenv
PERSISTENCE_API_SCOPE=api://75d2fd2d-a0ed-4767-8a0e-d6b3aa80fcda/.default
API_TENANT_ID=0f942ca0-ebef-4f26-80f8-f501d599ba90
API_AUDIENCE=api://75d2fd2d-a0ed-4767-8a0e-d6b3aa80fcda
PG_AUTH_MODE=password
```

Set the same `API_TENANT_ID`, `API_AUDIENCE`, and PostgreSQL connection values—including `PG_AUTH_MODE=password`—in `local.settings.json`. Keep both files private and uncommitted.

Sign in and apply the database migration:

```powershell
az login --tenant 0f942ca0-ebef-4f26-80f8-f501d599ba90 --scope api://75d2fd2d-a0ed-4767-8a0e-d6b3aa80fcda/.default
alembic upgrade head
```

## Start the services

Open three PowerShell windows at the repository root. In the first, start Azurite for the local Functions host:

```powershell
npx azurite --silent --location .azurite --debug .azurite\debug.log
```

In the second, start the persistence API:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
& .\.venv-py312\Scripts\Activate.ps1
func start
```

In the third, start the agent:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
& .\.venv-py312\Scripts\Activate.ps1
python -m hosted_agent.entrypoint
```

## Start the React UI

Before starting the UI, configure the SPA registration, then create and fill in its local settings from the repository root:

```powershell
Copy-Item .\ui\.env.example .\ui\.env.local
```

Set the tenant, client, and API scope values described in [Automatic Entra sign-in for the UI](local-deployment-windows.md#automatic-entra-sign-in-for-the-ui-msal-rollout). Never put access tokens or client secrets in a Vite environment file.

Open a fourth PowerShell window in the repository root and run:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced\ui
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```

Then open:

```text
http://localhost:3000
```

The UI is configured to submit requests to the Hosted Agent at `http://localhost:8088/invocations` and proxy API calls to `http://localhost:7071` while running locally.

Open **Agent Interaction History** in the UI to see persisted interactions, including each interaction's Result JSON.

## Send a test request

In another PowerShell window:

```powershell
$body = @{
  user_input = "Summarize the benefit of a transactional database write."
  metadata = @{ source = "local-test" }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri http://localhost:8088/invocations -Method Post `
  -ContentType "application/json" -Body $body
```

For setup details and troubleshooting, see [the full Windows deployment guide](local-deployment-windows.md).
