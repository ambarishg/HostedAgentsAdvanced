export function AppHeader({
  account,
  canInvokeAgent,
  canReadInteractions,
  analyticsUrl,
  agentUrl,
  demandDriverAnalyticsUrl,
  historyUrl,
  isMobileNavigationOpen,
  isSigningOut,
  isInteractionPage,
  onNavigate,
  onOpenInteractions,
  onSignOut,
  setAnalyticsUrl,
  setAgentUrl,
  setDemandDriverAnalyticsUrl,
  setHistoryUrl,
  setIsMobileNavigationOpen,
  setVulnerabilityAnalyticsUrl,
  vulnerabilityAnalyticsUrl,
  page,
}) {
  return (
    <header className="site-header">
      <a className="brand" href="#home" onClick={() => onNavigate('home')}>
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
        <span className="brand-name">Voice Analytics<span /></span>
      </a>
      <button
        type="button"
        className="mobile-navigation-toggle"
        aria-label={isMobileNavigationOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={isMobileNavigationOpen}
        aria-controls="primary-navigation"
        onClick={() => setIsMobileNavigationOpen((open) => !open)}
      >
        <span aria-hidden="true">{isMobileNavigationOpen ? '×' : '☰'}</span>
      </button>
      <nav
        id="primary-navigation"
        className={`page-navigation${isMobileNavigationOpen ? ' page-navigation--open' : ''}`}
        aria-label="Main navigation"
      >
        {canInvokeAgent && <button type="button" className={page === 'home' ? 'page-navigation__active' : ''} aria-current={page === 'home' ? 'page' : undefined} onClick={() => onNavigate('home')}>Home</button>}
        {canInvokeAgent && <button type="button" className={page === 'batch' ? 'page-navigation__active' : ''} aria-current={page === 'batch' ? 'page' : undefined} onClick={() => onNavigate('batch')}>Batch Processing</button>}
        {canReadInteractions && <button type="button" className={isInteractionPage ? 'page-navigation__active' : ''} aria-current={isInteractionPage ? 'page' : undefined} onClick={onOpenInteractions}>Agent Interactions</button>}
      </nav>
      <div className="auth-controls">
        <span className="signed-in-user">{account.name || account.username}</span>
        <button type="button" className="auth-button auth-button--quiet" onClick={onSignOut} disabled={isSigningOut}>
          {isSigningOut ? 'Please wait…' : 'Sign out'}
        </button>
      </div>
      <details className="settings">
        <summary>Settings</summary>
        <div className="settings-panel">
          <div className="settings-panel__heading">
            <h2>Connection settings</h2>
            <p>Configure the service endpoints used by this workspace.</p>
          </div>
          <EndpointInput label="Agent endpoint" value={agentUrl} onChange={setAgentUrl} />
          <EndpointInput label="Interaction history endpoint" value={historyUrl} onChange={setHistoryUrl} />
          <EndpointInput label="PCR analytics endpoint" value={analyticsUrl} onChange={setAnalyticsUrl} />
          <EndpointInput label="Demand driver analytics endpoint" value={demandDriverAnalyticsUrl} onChange={setDemandDriverAnalyticsUrl} />
          <EndpointInput label="Vulnerability analytics endpoint" value={vulnerabilityAnalyticsUrl} onChange={setVulnerabilityAnalyticsUrl} />
        </div>
      </details>
    </header>
  );
}

function EndpointInput({ label, onChange, value }) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
