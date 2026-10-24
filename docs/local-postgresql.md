# Local PostgreSQL for Development

This guide configures a **native Windows PostgreSQL installation** in place of Azure Database for PostgreSQL. It does not use Docker. The persistence API, its Entra authentication, and the Foundry model may still use Azure services. The API continues to require a valid Entra bearer token; using a local database does not disable API authentication.

The instructions use PostgreSQL 16 on Windows; PostgreSQL 14 or later is supported.

## 1. Install PostgreSQL for Windows

Download the Windows installer from the [PostgreSQL download page](https://www.postgresql.org/download/windows/), which links to the official EDB installer. Run it and select at least:

- PostgreSQL Server
- Command Line Tools (includes `psql`)

You may also install pgAdmin if you prefer a graphical database client. During setup:

- Keep the default port `5432`, unless another PostgreSQL server already uses it.
- Set a strong password for the built-in `postgres` administrator account and keep it private.
- Leave the PostgreSQL Windows service enabled to start automatically.
- Record the installation directory if the installer does not add the command-line tools to `PATH`. The default is typically `C:\Program Files\PostgreSQL\16\bin`.

Open a new PowerShell window and verify the command-line client is available:

```powershell
psql --version
```

If PowerShell cannot find `psql`, add the installation's `bin` directory to the current session's `PATH`:

```powershell
$env:Path += ";C:\Applications\PostgreSQL\bin"
psql --version
```

Alternatively, use the **SQL Shell (psql)** shortcut installed with PostgreSQL. Confirm the server is running in Windows Services (the service is usually named `postgresql-x64-16`).

## 2. Create a development role and database

Connect to the local server as the administrator. Enter the `postgres` account password when prompted:

```powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d postgres
```

At the `postgres=#` prompt, create a dedicated application login and database. Replace the sample password with a unique local development password:

```sql
CREATE ROLE agent_app WITH LOGIN PASSWORD 'Ambarish@123456';
CREATE DATABASE agentdb OWNER agent_app;
\q
```

The `agent_app` role owns `agentdb`, so it can create the project schema and run migrations. Do not reuse a production credential or commit this password. If you chose a different PostgreSQL port during installation, use that port in all commands and configuration below.

Check that the application account can connect:

```powershell
psql -h 127.0.0.1 -p 5432 -U agent_app -d agentdb -c "SELECT current_database(), current_user, version();"
```

Enter the `agent_app` password when prompted. The output should show `agentdb` and `agent_app`. The local database files are stored in PostgreSQL's data directory and persist across reboots. Do not delete that directory to reset the database; use PostgreSQL tools or pgAdmin if you intentionally need to remove the development database.

## 3. Configure the project for local PostgreSQL

From the repository root, create the private local environment files if they do not already exist:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
if (-not (Test-Path local.settings.json)) {
  Copy-Item local.settings.example.json local.settings.json
}
```

Edit `.env` and set the persistence API and database values. Keep the existing Foundry and Entra settings as appropriate for your environment:

```dotenv
PERSISTENCE_API_URL=http://localhost:7071/api/pcr-results
PERSISTENCE_API_SCOPE=api://YOUR-API-APPLICATION-ID/.default

API_TENANT_ID=YOUR-TENANT-ID
API_AUDIENCE=api://YOUR-API-APPLICATION-ID
API_REQUIRED_SCOPE=access_as_user

PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=agentdb
PGSCHEMA=agent_platform
PGUSER=agent_app
PG_AUTH_MODE=password
PGPASSWORD=ChangeThisLocalPassword-OnlyForDev
PGSSLMODE=disable
PGSSLROOTCERT=
```

Use the actual password chosen when creating `agent_app`. If PostgreSQL is listening on a different port, change `PGPORT` to match.

Azure Functions uses `local.settings.json` for host settings such as `AzureWebJobsStorage` and `FUNCTIONS_WORKER_RUNTIME`. Keep those existing entries intact. The API and migration read application configuration from the repository-root `.env`; do not replace the Functions settings with the partial JSON below. If you have separately configured any `PG*` values in `local.settings.json` or your process environment, make sure they match `.env`, since process environment values take precedence over `.env`.

Both `.env` and `local.settings.json` may contain credentials. Keep them private and untracked.

`PGSSLMODE=disable` is appropriate only for a database connected over loopback on your development machine. The project defaults to `verify-full`; keep that default for Azure PostgreSQL and other remote databases. `PGSSLROOTCERT` is optional. When using `verify-ca` or `verify-full`, the application uses the configured certificate path or the CA bundle provided by `certifi`.

The API still validates Entra tokens. Configure `API_TENANT_ID`, `API_AUDIENCE`, and either `API_REQUIRED_SCOPE` or `API_REQUIRED_APP_ROLE` for the API registration. The agent also needs valid `PERSISTENCE_API_SCOPE` and Foundry settings for end-to-end inference. See [the Windows deployment guide](local-deployment-windows.md) for Entra, Foundry, Azurite, and UI setup.

## 4. Apply database migrations

In a PowerShell window at the repository root, activate the project environment and run Alembic:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
& .\.venv-py312\Scripts\Activate.ps1
alembic upgrade head
```

If the project environment is named differently, activate that environment instead. The migration uses the configured database credentials and creates the `agent_platform` schema, the `agent_interactions` table, and its indexes.

Verify the migration and tables using the application role:

```powershell
psql -h 127.0.0.1 -p 5432 -U agent_app -d agentdb `
  -c "SELECT version_num FROM agent_platform.alembic_version;"
psql -h 127.0.0.1 -p 5432 -U agent_app -d agentdb `
  -c "\dt agent_platform.*"
```

For future schema updates, rerun `alembic upgrade head` after pulling the corresponding project changes.

## 5. Run the persistence API against the local database

Start Azurite if your Functions host uses the example `AzureWebJobsStorage` setting. From the repository root, in a separate PowerShell window:

```powershell
npx azurite --silent --location .azurite --debug .azurite\debug.log
```

In another window, start the persistence API:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
& .\.venv-py312\Scripts\Activate.ps1
func start
```

The API should start at `http://localhost:7071`. The route still requires Entra authentication; a request without a valid bearer token should be rejected even though PostgreSQL is local.

Start the Hosted Agent in another window after setting the project environment and Foundry configuration:

```powershell
Set-Location C:\Ambarish\HostedAgentsAdvanced
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
& .\.venv-py312\Scripts\Activate.ps1
python -m hosted_agent.entrypoint
```

An end-to-end invocation requires a working Foundry model deployment and an access token accepted by the persistence API. To verify persistence, submit a request from the UI or use the project's authenticated API flow, then inspect the local database:

```powershell
psql -h 127.0.0.1 -p 5432 -U agent_app -d agentdb `
  -c "SELECT request_id, agent_name, status, created_at FROM agent_platform.agent_interactions ORDER BY created_at DESC LIMIT 10;"
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `psql` is not recognized | Add PostgreSQL's `bin` directory to the current session's `PATH` or use the installed SQL Shell (psql) shortcut. |
| Connection refused or timeout | Check that the PostgreSQL Windows service is running. Verify the port in pgAdmin or Services and ensure `PGHOST` and `PGPORT` match. |
| Password authentication failed | Confirm you are using the password for `agent_app`, not the `postgres` administrator. If needed, connect as `postgres` and reset it with `ALTER ROLE agent_app WITH PASSWORD 'your-new-local-password';`. Update `.env` to match. |
| `alembic upgrade head` reports a missing setting | Check that `.env` exists in the repository root and that `API_TENANT_ID` and `API_AUDIENCE` are configured as required by the API settings. |
| SSL connection or certificate error | For this loopback-only development database, confirm `PGSSLMODE=disable` is set in `.env`, then restart Alembic/Functions so they reload settings. Do not use this mode for a remote database. |
| API returns 401 or 403 | This is independent of PostgreSQL. Check the bearer token's tenant, audience, required API permission, and allowed client configuration. Do not disable API authentication to work around it. |
| API starts but records are not visible | Verify the API and migration used the same `PGDATABASE` and `PGSCHEMA`, then query `agent_platform.agent_interactions` with `psql`. |
