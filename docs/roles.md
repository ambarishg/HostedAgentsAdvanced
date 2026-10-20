# Role-based access for page-level permissions

This document explains how to restrict access to specific pages in the UI using Microsoft Entra ID groups or app roles, while keeping the backend authorization checks authoritative.

## Goal

We want:

1. Home and Batch Processing pages available to a general user group.
2. Agent Interactions page available only to a separate privileged group.

The UI should hide or redirect unauthorized pages, and the API should still enforce the same rules on the server side.

## Recommended model

Use Entra ID group membership or app roles as the source of truth.

- General user group: can view Home and Batch Processing.
- Interaction admin group: can view Agent Interactions.
- Keep authorization checks in both places:
  - UI: hide or redirect unauthorized pages.
  - API: reject unauthorized history/analytics calls with 403.

This ensures a user cannot bypass access controls by manually editing the frontend.

## 1. Configure Entra groups or app roles

### Option A: Use Entra security groups (simplest)

1. In Microsoft Entra ID, open Groups.
2. Create a group such as:
   - `Hosted Agents General Users`
   - `Hosted Agents Interaction Viewers`
3. Add the relevant users to each group.
4. In the application registration for the API, configure access tokens to include group claims if your tenant supports them.
5. Ensure the app registration includes the group claim in the token (for example `groups` or a custom role claim depending on your setup).

### Option B: Use app roles (more explicit and enterprise-friendly)

1. In the API app registration, update the app manifest to add roles such as:

```json
"appRoles": [
  {
    "allowedMemberTypes": ["User", "Application"],
    "description": "Access to Home and Batch Processing pages",
    "displayName": "Hosted Agents General User",
    "id": "11111111-1111-1111-1111-111111111111",
    "isEnabled": true,
    "value": "HostedAgentsGeneralUser"
  },
  {
    "allowedMemberTypes": ["User", "Application"],
    "description": "Access to Agent Interactions pages and analytics",
    "displayName": "Hosted Agents Interaction Viewer",
    "id": "22222222-2222-2222-2222-222222222222",
    "isEnabled": true,
    "value": "HostedAgentsInteractionViewer"
  }
]
```

2. Assign those roles to the relevant users or groups.
3. Ensure the web app requests the API permission and receives an access token with the role claims.

### Token claim shape

The UI can read one of these claims after sign-in:

- `roles` for app role assignments
- `groups` for group memberships

The UI should normalize these into a simple list of user roles.

## 2. Update the UI to check access before rendering a page

The current UI already handles Microsoft sign-in in `ui/src/auth.js` and page switching in `ui/src/App.jsx`.

Add authorization helpers near the app entry point.

### Example helper

```js
function getUserRoles(account) {
  const claims = account?.idTokenClaims || {};
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  const groups = Array.isArray(claims.groups) ? claims.groups : [];
  return new Set([...roles, ...groups]);
}
```

Then define page permission rules:

```js
const canAccessGeneralPages = (account) => {
  const roles = getUserRoles(account);
  return (
    roles.has('HostedAgentsGeneralUser') ||
    roles.has('Hosted Agents General Users') ||
    roles.has('HostedAgentsInteractionViewer')
  );
};

const canAccessInteractionPage = (account) => {
  const roles = getUserRoles(account);
  return (
    roles.has('HostedAgentsInteractionViewer') ||
    roles.has('Hosted Agents Interaction Viewers')
  );
};
```

### Example UI page guard

```jsx
const openInteractions = () => {
  if (!canAccessInteractionPage(authAccount)) {
    setPage('home');
    setMessage('You do not have permission to access Agent Interactions.');
    return;
  }

  setPage('interactions');
  if (authAccount) loadInteractions();
};
```

And for the home and batch pages:

```jsx
const isAllowedHomeOrBatch = canAccessGeneralPages(authAccount);
```

If the user is not allowed, render a permission message or route them back to a permitted page.

## 3. Gate route-level rendering

In the main render, add a page guard:

```jsx
{page === 'home' && canAccessGeneralPages(authAccount) && (
  <HomePage />
)}

{page === 'batch' && canAccessGeneralPages(authAccount) && (
  <BatchPage />
)}

{page === 'interactions' && canAccessInteractionPage(authAccount) && (
  <InteractionsPage />
)}

{!canAccessGeneralPages(authAccount) && page !== 'interactions' && (
  <AccessDenied message="You do not have access to this application area." />
)}
```

A more user-friendly pattern is to redirect to Home when a user attempts to open a page they are not allowed to access.

## 4. Restrict the API as the authoritative check

The UI is only a convenience layer. The backend should validate the token claims before returning history or analytics data.

### Example backend policy

For the `GET /api/agent-interactions` and `GET /api/pcr-analytics` routes:

- Require a valid Entra access token.
- Check for the role or group claim.
- Reject with `403 Forbidden` if the caller is not in the interaction viewer group.

Pseudo-code:

```python
claims = token_validator.validate(request.headers.get("Authorization"))
roles = set(claims.get("roles", []))
groups = set(claims.get("groups", []))

if not ("HostedAgentsInteractionViewer" in roles or "Hosted Agents Interaction Viewers" in groups):
    return HttpResponse(status_code=403)
```

The home and batch APIs should still be protected as needed, but they are usually less sensitive than the interaction history and analytics endpoints.

## 5. Recommended page assignment

| Page | Required access |
|------|-----------------|
| Home | General user role/group |
| Batch Processing | General user role/group |
| Agent Interactions | Interaction viewer role/group |
| PCR Analytics | Interaction viewer role/group |

## 6. Example Entra permission model

### Group-based layout

- `Hosted Agents General Users`
  - allowed: Home, Batch Processing
- `Hosted Agents Interaction Viewers`
  - allowed: Home, Batch Processing, Agent Interactions, PCR Analytics

This is a good pattern if interaction access is a subset of the full app access.

### Role-based layout

- `HostedAgentsGeneralUser`
- `HostedAgentsInteractionViewer`

The interaction viewer role can implicitly include the general user role if the app is designed that way.

## 7. Best practices

- Do not rely on client-side only checks for security.
- Always enforce page access in the frontend for a better user experience.
- Always enforce authorization in the backend for real protection.
- Use group claims or app roles rather than storing user names in the UI.
- Log authorization failures for audit purposes.
- Keep the role names stable and descriptive.

## 8. Practical implementation summary

1. Create two Entra groups or two app roles.
2. Assign users to the appropriate group or role.
3. Add token claim parsing in the UI.
4. Add page-level guards for Home, Batch Processing, and Agent Interactions.
5. Add server-side checks to the interaction history and analytics endpoints.
6. Return a user-friendly “Access denied” message in the UI if a user does not have permission.

This gives you a clean separation of access: a general user group for day-to-day workflows and a restricted group for sensitive interaction review and reporting.
