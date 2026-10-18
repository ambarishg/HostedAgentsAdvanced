# How the Persistence API App Registration Works

This guide explains how the Microsoft Entra app registration protects the persistence API in the Azure Function App. It uses plain language first, then describes the token and configuration details.

## The short version

Imagine the Function App is a locked room where database records are saved:

- The **API app registration** is the room's public name and rulebook. It tells Microsoft Entra which API the room represents and what permission callers need.
- The **agent** is a visitor. Before it enters, it asks Microsoft Entra for a signed pass (an access token).
- The **Function App** is the door guard. It checks that the pass was issued by the right tenant, is meant for this API, and includes the required permission.
- The **database** is inside the room. A caller does not get the database key; only the Function App accesses the database.

The registration is not the Function App itself, does not run code, and does not grant database access. It is an identity and configuration record used by Microsoft Entra and the Function App's token validator.

## Which identities are involved?

There are several IDs in this flow. They identify different things and should not be mixed up.

| Identity | What it represents | Example use |
| --- | --- | --- |
| API app registration | The protected persistence API | Defines the API's Application (client) ID, Application ID URI, and exposed permissions |
| Local caller | The signed-in developer using Azure CLI locally | `DefaultAzureCredential` can use this identity during local testing |
| Hosted Agent caller | The agent workload running in Azure | Its managed identity obtains a token when deployed |
| Function App managed identity | The Function App as a workload | Used for Azure resources the Function itself needs, such as Key Vault or Entra-authenticated PostgreSQL |
| Azure CLI application | Microsoft's client application used by the `az` command | It is the client requesting a token during local Azure CLI login; it is not your API registration |

An app registration normally has a corresponding enterprise application (service principal) in a tenant. That service principal is the tenant-local instance used for sign-in and consent. You usually create one API app registration for this API; you do not create a new app registration for each Function App instance.

## What happens during a request?

1. The agent asks Microsoft Entra for an access token for the persistence API. Locally, the configured credential can use the Azure CLI login. In Azure, the agent should use its managed identity.
2. Microsoft Entra checks whether that caller is allowed to request the API permission and issues a signed token.
3. The agent sends the token in the HTTP `Authorization: Bearer ...` header to the Function App's `/api/pcr-results` endpoint.
4. The Function App validates the token signature, issuer/tenant, audience, and permission. It can also check an optional client allowlist.
5. Only after the token is accepted does the Function validate the request and write to PostgreSQL using the Function's database configuration/identity.

The API route uses anonymous Azure Functions host-level authorization because the application performs its own Entra bearer-token validation. “Anonymous” here does **not** mean the API accepts unauthenticated requests.

## The important values

In the examples below, replace `<API-APPLICATION-ID>` with the Application (client) ID of the **API registration**. Its Application ID URI is commonly `api://<API-APPLICATION-ID>`.

### Application (client) ID

This is the GUID that identifies the API registration in Entra. The Application ID URI is the resource name used in scopes and often appears in the audience claim. These are related identifiers, but not interchangeable in every setting.

### Application ID URI and audience

The API's Application ID URI might look like:

```text
api://<API-APPLICATION-ID>
```

The access token contains an `aud` (audience) claim saying which API it is for. The Function App compares that claim with `API_AUDIENCE`. Set `API_AUDIENCE` to the **exact `aud` value in the token**. For the local Azure CLI token used by this project, it is the Application ID URI above. Some token versions/client configurations can use the API's GUID instead, so inspect the claim if there is a 401 rather than guessing.

### Scope

A delegated scope is a permission exercised on behalf of a signed-in user. This project's example scope is named `access_as_user`. The agent's token request uses a scope such as:

```text
api://<API-APPLICATION-ID>/.default
```

The `/.default` suffix tells Entra to issue the permissions already configured and consented for that resource/client combination. The resulting token should include `access_as_user` in its `scp` (scope) claim.

### Tenant ID

`API_TENANT_ID` is the Entra tenant that is trusted to issue tokens for this API. It must correspond to the `tid` claim and issuer in the token. A token from another tenant is rejected even if its audience looks right.

## How the settings map to the flow

| Setting | Where it is configured | What it does |
| --- | --- | --- |
| `PERSISTENCE_API_SCOPE` | Agent `.env` | Tells the agent credential which API resource to request a token for, for example `api://<API-APPLICATION-ID>/.default`. |
| `API_AUDIENCE` | Local Function `local.settings.json` or Azure Function App settings | Tells the Function which `aud` claim it will accept. It must match the token's audience exactly. |
| `API_TENANT_ID` | Local Function settings or Azure Function App settings | Restricts validation to tokens issued by this tenant. |
| `API_REQUIRED_SCOPE` | Local Function settings or Azure Function App settings | Requires a delegated scope such as `access_as_user` in the token's `scp` claim. |
| `API_REQUIRED_APP_ROLE` | Local Function settings or Azure Function App settings | Optional alternative for application permissions, represented by a role in the token's `roles` claim. |
| `API_ALLOWED_CLIENT_IDS` | Local Function settings or Azure Function App settings | Optional comma-separated allowlist for the token's client ID (`azp` in v2 tokens or `appid` in v1 tokens). Leave empty unless you intend to restrict callers. |

The agent's `PERSISTENCE_API_SCOPE` is a request to Entra; the Function's `API_REQUIRED_SCOPE` is the permission name the Function checks inside the token. They are related, but they are not the same string.

## Configure the API registration

In the Microsoft Entra admin center, configure the API registration:

1. Create or open the registration that represents the persistence API. Record its Application (client) ID and tenant ID.
2. Under **Expose an API**, set an Application ID URI. If using the examples in this repository, use `api://<API-APPLICATION-ID>`.
3. Add a delegated scope named `access_as_user` (or use the exact scope name your organization chose). Configure who can consent according to your organization's policy.
4. Grant/admin-consent the required API permission for the caller used by the agent.
5. If using the Azure CLI identity for local testing, your tenant's policy and the API registration must allow the Azure CLI client to request this API's delegated scope. Azure CLI's application ID is Microsoft's; it is not the API Application ID. If organizational policy does not allow this, use an approved client application or test with an approved workload identity.
6. If restricting `API_ALLOWED_CLIENT_IDS`, configure the exact caller client ID(s); otherwise leave it empty during initial development.

For the local Azure CLI flow, `.env` might contain:

```dotenv
PERSISTENCE_API_SCOPE=api://<API-APPLICATION-ID>/.default
```

And `local.settings.json` might contain:

```json
{
  "Values": {
    "API_TENANT_ID": "<TENANT-ID>",
    "API_AUDIENCE": "api://<API-APPLICATION-ID>",
    "API_REQUIRED_SCOPE": "access_as_user"
  }
}
```

Keep these local/development values out of source control when they contain real environment details. The committed `local.settings.example.json` should contain placeholders only.

## Local login with Azure CLI

For local development, `.env` configures the agent's `DefaultAzureCredential`. Sign in to the tenant and request the API scope:

```powershell
az login --tenant YOUR-TENANT-ID --scope api://YOUR-API-APPLICATION-ID/.default
az account show
```

If Azure CLI reports `AADSTS65001`, consent for the requested API permission is missing or has not been granted. If it reports `AADSTS650057`, the Azure CLI client is not authorized for that API resource in the tenant; an Entra administrator must configure an approved consent/authorization path, or you must use an approved client identity instead.

To check a token without disclosing the token itself, decode it locally and inspect only selected claims:

```powershell
$token = (az account get-access-token --scope "api://YOUR-API-APPLICATION-ID/.default" | ConvertFrom-Json).accessToken
$part = $token.Split('.')[1].Replace('-', '+').Replace('_', '/')
$part += '=' * ((4 - $part.Length % 4) % 4)
$claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json
$claims | Select-Object aud, iss, tid, ver, scp, roles
```

Never paste or log the full access token. Check:

- `aud` equals `API_AUDIENCE`.
- `tid` matches `API_TENANT_ID`.
- `iss` is an issuer for that tenant. This project validates both v2 issuers (`https://login.microsoftonline.com/<TENANT-ID>/v2.0`) and v1 issuers (`https://sts.windows.net/<TENANT-ID>/`).
- `scp` includes `access_as_user` when using delegated permissions.
- `roles` contains the expected role if using application permissions.

After changing `local.settings.json` or `.env`, restart the Function host and agent so each process reloads its settings and credentials.

## Azure deployment identity

For a deployed agent, use the Hosted Agent's managed identity as the caller instead of a developer's Azure CLI account. Configure the identity with permission to call the API and grant/admin-consent as required. If using an application permission, configure the API's app role and set `API_REQUIRED_APP_ROLE` to that role. Ensure `API_ALLOWED_CLIENT_IDS`, if set, includes the identity/client ID represented in the token.

The Function App has its own managed identity too. It is a separate workload identity. Give it only the resource permissions it needs (for example, Key Vault access or PostgreSQL Entra login). Do not assume the Function identity automatically becomes the Hosted Agent caller, and do not give the agent PostgreSQL credentials.

## Troubleshooting

| Symptom | What it usually means | Check |
| --- | --- | --- |
| `401 invalid_access_token` | Token signature, issuer, audience, or lifetime validation failed | In Function settings, check `API_TENANT_ID` and exact `API_AUDIENCE`; compare with `tid`, `iss`, `aud`, `ver` claims. Restart `func start` after changing settings. |
| `403 required_scope_missing` | The token is valid but lacks the delegated permission | Check the exposed scope name, consent, `API_REQUIRED_SCOPE`, and token's `scp` claim. |
| `403 required_app_role_missing` | The token is valid but lacks the required application role | Check app-role assignment/admin consent, `API_REQUIRED_APP_ROLE`, and the token's `roles` claim. |
| `403 caller_not_authorized` | The caller client ID is not in the configured allowlist | Check `API_ALLOWED_CLIENT_IDS` against `azp` (v2) or `appid` (v1). Clear the setting only if caller allowlisting is not required by your security policy. |
| `AADSTS65001` during login | Permission consent is missing | Request the configured API scope and have the appropriate administrator grant consent if required. |
| `AADSTS650057` during login | The client is not authorized for that API resource | Ask the Entra administrator to authorize an approved client or use an approved client/workload identity. |

The API returns sanitized authentication errors to callers. The local Functions host logs the specific validation code (for example, `invalid_access_token` or `required_scope_missing`) without logging the token. Use that code alongside the locally decoded claims to narrow down the cause.
