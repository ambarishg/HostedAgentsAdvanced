# Configure Microsoft Entra App Roles

This guide configures the app roles enforced by the Hosted Agents application:

| Role value | Purpose | Assigned users can |
| --- | --- | --- |
| `Agent.Invoke` | Direct-request authorization | Submit an individual agent request |
| `Agent.Batch.Run` | Batch-request authorization | Start a configured batch workload |
| `InteractionHistory.Read` | History and analytics authorization | View interaction history and analytics |

The Hosted Agent and Persistence API can share one Entra API app registration. If they use separate registrations, create `Agent.Invoke` and `Agent.Batch.Run` on the Hosted Agent registration and `InteractionHistory.Read` on the Persistence API registration.

## Prerequisites

You need a role that can manage app registrations and enterprise applications, such as **Application Administrator**, **Cloud Application Administrator**, or **Global Administrator**. You also need:

- The **UI SPA app registration** client ID.
- The **API app registration** application (client) ID.
- The Entra tenant ID.
- Groups that represent the authorized user sets. Using groups is recommended over individual assignments.

## 1. Open the API app registration

1. Open the [Azure portal](https://portal.azure.com/).
2. Go to **Microsoft Entra ID** → **App registrations**.
3. Select the API app registration used by the UI. Its **Application (client) ID** is the value used in the API audience, such as `api://<api-application-id>`.
4. Select **App roles** → **Create app role**.

Create the following roles one at a time. For every role, set **Allowed member types** to **Users/Groups**, set **Do you want to enable this app role?** to **Yes**, then select **Apply**.

| Display name | Allowed member types | Value | Description |
| --- | --- | --- | --- |
| Submit Direct Agent Requests | Users/Groups | `Agent.Invoke` | Allows users to submit individual Hosted Agent requests. |
| Run Agent Batch Workloads | Users/Groups | `Agent.Batch.Run` | Allows users to start configured batch processing. |
| Read Agent Interactions | Users/Groups | `InteractionHistory.Read` | Allows users to read interaction history and analytics. |

The **Value** must match exactly, including capitalization. Do not use the display name in application configuration.

## 2. Expose the delegated API scope

The React UI needs a delegated scope to request an access token for the API:

1. In the same app registration, select **Expose an API**.
2. Set the Application ID URI to `api://<api-application-id>` if it is not already set.
3. Select **Add a scope**.
4. Create `access_as_user` with:
   - **Who can consent:** Admins and users, unless tenant policy requires admins only.
   - **Admin consent display name:** Access Hosted Agents API.
   - **State:** Enabled.
5. Select **Add scope**.

The scope authenticates the user to the API. The app role determines which operations that authenticated user may perform.

## 3. Grant the UI permission to request the API token

1. Open the UI SPA app registration.
2. Select **API permissions** → **Add a permission**.
3. Select **My APIs**, then select the API app registration.
4. Select **Delegated permissions**.
5. Select `access_as_user` and choose **Add permissions**.
6. If required by tenant policy, select **Grant admin consent for \<tenant\>**.

## 4. Assign roles to groups or users

App roles are assigned from the API's enterprise application, not from the API permissions page:

1. Go to **Microsoft Entra ID** → **Enterprise applications**.
2. Select the enterprise application with the same name as the API app registration.
3. Select **Users and groups** → **Add user/group**.
4. Select the group or user that should receive access.
5. Select a role, for example **Submit Direct Agent Requests**.
6. Select **Assign**.
7. Repeat for each authorized set of users and each role.

A user can be assigned more than one role. For example, an operations group can receive both `Agent.Invoke` and `InteractionHistory.Read`, while a batch-operations group receives all three roles.

## 5. Configure the application

When one API registration is shared, use the same tenant and audience for the Hosted Agent and Persistence API.

```dotenv
# Hosted Agent
AGENT_AUTH_TENANT_ID=<tenant-id>
AGENT_AUTH_AUDIENCE=api://<api-application-id>
AGENT_AUTH_ALLOWED_CLIENT_IDS=<ui-spa-application-id>
AGENT_DIRECT_REQUEST_APP_ROLE=Agent.Invoke
AGENT_BATCH_REQUEST_APP_ROLE=Agent.Batch.Run

# Persistence API
API_TENANT_ID=<tenant-id>
API_AUDIENCE=api://<api-application-id>
API_INTERACTION_HISTORY_APP_ROLE=InteractionHistory.Read
API_ALLOWED_CLIENT_IDS=<ui-spa-application-id>

# React UI
VITE_ENTRA_TENANT_ID=<tenant-id>
VITE_ENTRA_CLIENT_ID=<ui-spa-application-id>
VITE_PERSISTENCE_API_SCOPE=api://<api-application-id>/access_as_user
# Optional when the Hosted Agent shares the same API registration:
VITE_HOSTED_AGENT_SCOPE=api://<api-application-id>/access_as_user
```

The Hosted Agent defaults to `API_TENANT_ID` and `API_AUDIENCE` if its `AGENT_AUTH_TENANT_ID` and `AGENT_AUTH_AUDIENCE` values are omitted. Keep explicit values when the Hosted Agent uses a different API registration.

Restart the backend services and rebuild or restart the Vite UI after changing environment variables.

## 6. Verify the role claim

1. Sign out of the UI and sign back in after assigning roles. Existing tokens do not gain new roles.
2. Obtain an access token for `api://<api-application-id>/access_as_user`.
3. Decode the token using a trusted internal tool or [jwt.ms](https://jwt.ms). Do not paste production tokens into untrusted services.
4. Confirm that the token has a `roles` claim with the expected value:

   ```json
   {
     "roles": ["Agent.Invoke", "InteractionHistory.Read"]
   }
   ```

5. Verify behavior:
   - A user with `Agent.Invoke` can submit a direct request.
   - A user without `Agent.Batch.Run` receives `403` for a batch request.
   - A user with `InteractionHistory.Read` can view history and analytics.
   - A user without `InteractionHistory.Read` receives `403` from the persistence read endpoints.

New role assignments can take several minutes to appear in tokens. Sign out, sign in, and retry after a short delay before troubleshooting further.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| The token has no `roles` claim | Confirm the role is enabled, assigned in **Enterprise applications**, and the user requested a token for the correct API audience. |
| The API returns `401` | Confirm the token is present, unexpired, signed by the configured tenant, and has the configured audience. |
| The API returns `403` | Confirm the role **value** exactly matches the relevant environment variable and the user or group is assigned that role. |
| The UI cannot acquire a token | Confirm the UI app registration has delegated `access_as_user` permission and the configured scope uses the correct Application ID URI. |
| Group changes have no effect | Sign out and back in to obtain a fresh token; allow time for Entra assignment propagation. |

Never authorize users based on client-side group checks alone. The backend validates the token and role claim for every protected operation.
