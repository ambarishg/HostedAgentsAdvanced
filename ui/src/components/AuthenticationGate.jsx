export function AuthenticationGate({
  authError,
  authReady,
  isAuthBusy,
  isConfigured,
  missingConfigurationKeys,
  onSignIn,
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
