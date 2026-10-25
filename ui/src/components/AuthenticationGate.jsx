export function AuthenticationGate({
  authError,
  authReady,
  authorizationReady,
  isAuthBusy,
  isAuthenticated,
  isAuthorized,
  isConfigured,
  missingConfigurationKeys,
  onSignIn,
  onSignOut,
  signOutMessage,
}) {
  if (!isConfigured) {
    return (
      <main className="authentication-gate" aria-labelledby="authentication-gate-title">
        <section className="authentication-gate__card">
          <p className="authentication-gate__eyebrow">Authentication required</p>
          <h1 id="authentication-gate-title">Entra ID sign-in is not configured</h1>
          <p>
            Configure {missingConfigurationKeys.join(', ')} before users can access this
            application.
          </p>
        </section>
      </main>
    );
  }

  if (!authReady) {
    return (
      <main className="authentication-gate" aria-live="polite">
        <section className="authentication-gate__card">
          <p className="authentication-gate__eyebrow">Authentication required</p>
          <h1>Checking your Microsoft sign-in</h1>
        </section>
      </main>
    );
  }

  if (!authorizationReady) {
    return (
      <main className="authentication-gate" aria-live="polite">
        <section className="authentication-gate__card">
          <p className="authentication-gate__eyebrow">Authorization required</p>
          <h1>Checking your account permissions</h1>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="authentication-gate" aria-labelledby="authentication-gate-title">
        <section className="authentication-gate__card">
          <p className="authentication-gate__eyebrow">Authentication required</p>
          <h1 id="authentication-gate-title">Sign in to access Voice Analytics</h1>
          <p>Use your work account to access this application.</p>
          {signOutMessage && <p className="sign-out-message" role="status">{signOutMessage}</p>}
          {authError && <p className="error-message" role="alert">{authError}</p>}
          <button type="button" className="auth-button" onClick={onSignIn} disabled={isAuthBusy}>
            {isAuthBusy ? 'Signing in...' : 'Sign in with Microsoft'}
          </button>
        </section>
      </main>
    );
  }

  if (!isAuthorized) {
    return (
      <main className="authentication-gate" aria-labelledby="authentication-gate-title">
        <section className="authentication-gate__card">
          <p className="authentication-gate__eyebrow">Access denied</p>
          <h1 id="authentication-gate-title">Your account is not authorized</h1>
          <p>Contact an administrator to request access to Voice Analytics.</p>
          {authError && <p className="error-message" role="alert">{authError}</p>}
          <button type="button" className="auth-button" onClick={onSignOut} disabled={isAuthBusy}>
            {isAuthBusy ? 'Please wait...' : 'Sign out'}
          </button>
        </section>
      </main>
    );
  }

  return null;
}
