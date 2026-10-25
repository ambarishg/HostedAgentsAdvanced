The UI uses MSAL to require Microsoft Entra ID authentication before rendering any application page. Configure the following Vite environment variables:

```text
VITE_ENTRA_CLIENT_ID=<UI-SPA-APPLICATION-ID>
VITE_ENTRA_TENANT_ID=<DIRECTORY-TENANT-ID>
VITE_PERSISTENCE_API_SCOPE=api://<API-APPLICATION-ID>/access_as_user
```

Optionally set `VITE_ENTRA_REDIRECT_URI`; otherwise the UI uses `<origin>/redirect.html`. Users who are not signed in see only the Microsoft sign-in screen. If required Entra configuration is absent, the UI fails closed and does not render application content.

Selecting **Sign out** signs the user out through the Entra ID logout endpoint, clears the active MSAL account, removes in-memory application data, and returns the user to the sign-in screen with a confirmation message.