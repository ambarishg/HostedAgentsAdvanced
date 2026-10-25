import { useEffect, useMemo, useState } from 'react';
import {
  acquirePersistenceToken,
  entraConfigurationKeys,
  initializeEntra,
  isEntraConfigured,
  signInToEntra,
  signOutOfEntra,
} from './auth';

const defaultAgentUrl = import.meta.env.VITE_HOSTED_AGENT_URL || '/invocations';
const defaultHistoryUrl = import.meta.env.VITE_PERSISTENCE_HISTORY_URL || '/api/agent-interactions';
const defaultAnalyticsUrl = import.meta.env.VITE_PERSISTENCE_ANALYTICS_URL || '/api/pcr-analytics';
const defaultDemandDriverAnalyticsUrl = import.meta.env.VITE_PERSISTENCE_DEMAND_DRIVER_ANALYTICS_URL || '/api/demand-driver-analytics';
const defaultVulnerabilityAnalyticsUrl = import.meta.env.VITE_PERSISTENCE_VULNERABILITY_ANALYTICS_URL || '/api/vulnerability-analytics';

const createRequestBody = (userInput, requestId, batchMode) => ({
  request_id: requestId,
  batch_mode: batchMode,
  ...(!batchMode && { user_input: userInput }),
  metadata: {
    source: 'ui-console',
    reference: 'hosted-agent-dashboard',
  },
});

const normalizeAgentResponse = (payload) => {
  if (!payload) return null;

  if (typeof payload === 'string') {
    try {
      return normalizeAgentResponse(JSON.parse(payload));
    } catch {
      return { raw_response: payload };
    }
  }

  if (typeof payload.response === 'string') {
    try {
      return normalizeAgentResponse(payload.response);
    } catch {
      return { raw_response: payload.response };
    }
  }

  return payload;
};

function App() {
  const [userInput, setUserInput] = useState('');
  const [agentUrl, setAgentUrl] = useState(defaultAgentUrl);
  const [historyUrl, setHistoryUrl] = useState(defaultHistoryUrl);
  const [analyticsUrl, setAnalyticsUrl] = useState(defaultAnalyticsUrl);
  const [demandDriverAnalyticsUrl, setDemandDriverAnalyticsUrl] = useState(defaultDemandDriverAnalyticsUrl);
  const [vulnerabilityAnalyticsUrl, setVulnerabilityAnalyticsUrl] = useState(defaultVulnerabilityAnalyticsUrl);
  const [page, setPage] = useState('home');
  const [authAccount, setAuthAccount] = useState(null);
  const [authReady, setAuthReady] = useState(!isEntraConfigured);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('Your agent is ready when you are.');
  const [lastRunMode, setLastRunMode] = useState('request');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [interactions, setInteractions] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [hasMoreInteractions, setHasMoreInteractions] = useState(false);
  const [interactionSearch, setInteractionSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [interactionSort, setInteractionSort] = useState('newest');
  const [analyticsStartDate, setAnalyticsStartDate] = useState('');
  const [analyticsEndDate, setAnalyticsEndDate] = useState('');
  const [selectedContactReasons, setSelectedContactReasons] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [demandDriverAnalyticsStartDate, setDemandDriverAnalyticsStartDate] = useState('');
  const [demandDriverAnalyticsEndDate, setDemandDriverAnalyticsEndDate] = useState('');
  const [selectedDemandDriverCategories, setSelectedDemandDriverCategories] = useState([]);
  const [analyticsTotal, setAnalyticsTotal] = useState(0);
  const [availableContactReasons, setAvailableContactReasons] = useState([]);
  const [analyticsError, setAnalyticsError] = useState('');
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [demandDriverAnalytics, setDemandDriverAnalytics] = useState([]);
  const [demandDriverAnalyticsTotal, setDemandDriverAnalyticsTotal] = useState(0);
  const [availableDemandDriverCategories, setAvailableDemandDriverCategories] = useState([]);
  const [demandDriverAnalyticsError, setDemandDriverAnalyticsError] = useState('');
  const [isDemandDriverAnalyticsLoading, setIsDemandDriverAnalyticsLoading] = useState(false);
  const [vulnerabilityAnalyticsStartDate, setVulnerabilityAnalyticsStartDate] = useState('');
  const [vulnerabilityAnalyticsEndDate, setVulnerabilityAnalyticsEndDate] = useState('');
  const [selectedVulnerabilityCategories, setSelectedVulnerabilityCategories] = useState([]);
  const [availableVulnerabilityCategories, setAvailableVulnerabilityCategories] = useState([]);
  const [vulnerabilityAnalytics, setVulnerabilityAnalytics] = useState([]);
  const [vulnerabilityAnalyticsTotal, setVulnerabilityAnalyticsTotal] = useState(0);
  const [vulnerabilityAnalyticsError, setVulnerabilityAnalyticsError] = useState('');
  const [isVulnerabilityAnalyticsLoading, setIsVulnerabilityAnalyticsLoading] = useState(false);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);

  const agentNames = useMemo(
    () => [...new Set(interactions.map(({ agent_name: agentName }) => agentName).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second)),
    [interactions],
  );

  const visibleInteractions = useMemo(() => {
    const query = interactionSearch.trim().toLocaleLowerCase();
    const filtered = interactions.filter((interaction) => {
      const matchesAgent = !agentFilter || interaction.agent_name === agentFilter;
      const searchableContent = [
        interaction.request_id,
        interaction.agent_name,
        interaction.user_input,
        JSON.stringify(interaction.result_json),
      ].join(' ').toLocaleLowerCase();
      return matchesAgent && (!query || searchableContent.includes(query));
    });

    if (interactionSort === 'oldest') return filtered.slice().reverse();
    if (interactionSort === 'agent-asc' || interactionSort === 'agent-desc') {
      const direction = interactionSort === 'agent-asc' ? 1 : -1;
      return filtered.slice().sort(
        (first, second) => direction * (first.agent_name || '').localeCompare(second.agent_name || ''),
      );
    }
    return filtered;
  }, [interactions, interactionSearch, agentFilter, interactionSort]);

  useEffect(() => {
    let isMounted = true;
    initializeEntra()
      .then((account) => {
        if (isMounted) setAuthAccount(account);
      })
      .catch((initializationError) => {
        if (isMounted) setAuthError(initializationError.message || 'Unable to initialize Microsoft sign-in.');
      })
      .finally(() => {
        if (isMounted) setAuthReady(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const loadInteractions = async (offset = 0, append = false, isAuthenticated = Boolean(authAccount)) => {
    if (!isAuthenticated) {
      setHistoryError(
        isEntraConfigured
          ? 'Sign in with your work account to view interactions.'
          : `Configure ${entraConfigurationKeys.join(', ')} to enable Microsoft sign-in.`,
      );
      return;
    }

    setIsHistoryLoading(true);
    setHistoryError('');
    if (!append) {
      setInteractions([]);
      setHasMoreInteractions(false);
    }

    try {
      const separator = historyUrl.includes('?') ? '&' : '?';
      const token = await acquirePersistenceToken();
      const response = await fetch(`${historyUrl}${separator}limit=100&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `History request failed with status ${response.status}.`);
      }

      const payload = JSON.parse(rawText);
      if (!Array.isArray(payload.items)) {
        throw new Error('The persistence API returned an invalid interaction history response.');
      }
      setInteractions((current) => append ? [...current, ...payload.items] : payload.items);
      setHasMoreInteractions(payload.has_more === true);
    } catch (fetchError) {
      setHistoryError(fetchError.message || 'Unable to retrieve interaction history.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const openInteractions = () => {
    setPage('interactions');
    setIsMobileNavigationOpen(false);
    if (authAccount) loadInteractions();
  };

  const loadPcrAnalytics = async (isAuthenticated = Boolean(authAccount)) => {
    if (!isAuthenticated) {
      setAnalyticsError(
        isEntraConfigured
          ? 'Sign in with your work account to view PCR analytics.'
          : `Configure ${entraConfigurationKeys.join(', ')} to enable Microsoft sign-in.`,
      );
      return;
    }

    setIsAnalyticsLoading(true);
    setAnalyticsError('');
    setAnalytics([]);
    setAnalyticsTotal(0);
    try {
      const query = new URLSearchParams();
      if (analyticsStartDate) query.set('start_date', analyticsStartDate);
      if (analyticsEndDate) query.set('end_date', analyticsEndDate);
      if (selectedContactReasons.length) {
        query.set('contact_reasons', selectedContactReasons.join(','));
      }
      const separator = analyticsUrl.includes('?') ? '&' : '?';
      const token = await acquirePersistenceToken();
      const response = await fetch(`${analyticsUrl}${separator}${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `PCR analytics request failed with status ${response.status}.`);
      }

      const payload = JSON.parse(rawText);
      if (!Array.isArray(payload.items) || !Array.isArray(payload.available_reasons)
        || !Number.isInteger(payload.total_count)) {
        throw new Error('The persistence API returned an invalid PCR analytics response.');
      }
      setAnalytics(payload.items);
      setAnalyticsTotal(payload.total_count);
      setAvailableContactReasons(payload.available_reasons);
    } catch (fetchError) {
      setAnalyticsError(fetchError.message || 'Unable to retrieve PCR analytics.');
    } finally {
      setIsAnalyticsLoading(false);
    }
  };

  const openPcrAnalytics = () => {
    setPage('pcr-analytics');
    if (authAccount) loadPcrAnalytics();
  };

  const loadDemandDriverAnalytics = async (isAuthenticated = Boolean(authAccount)) => {
    if (!isAuthenticated) {
      setDemandDriverAnalyticsError(
        isEntraConfigured
          ? 'Sign in with your work account to view demand driver analytics.'
          : `Configure ${entraConfigurationKeys.join(', ')} to enable Microsoft sign-in.`,
      );
      return;
    }

    setIsDemandDriverAnalyticsLoading(true);
    setDemandDriverAnalyticsError('');
    setDemandDriverAnalytics([]);
    setDemandDriverAnalyticsTotal(0);
    try {
      const query = new URLSearchParams();
      if (demandDriverAnalyticsStartDate) query.set('start_date', demandDriverAnalyticsStartDate);
      if (demandDriverAnalyticsEndDate) query.set('end_date', demandDriverAnalyticsEndDate);
      if (selectedDemandDriverCategories.length) {
        query.set('categories', selectedDemandDriverCategories.join(','));
      }
      const separator = demandDriverAnalyticsUrl.includes('?') ? '&' : '?';
      const token = await acquirePersistenceToken();
      const response = await fetch(`${demandDriverAnalyticsUrl}${separator}${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `Demand driver analytics request failed with status ${response.status}.`);
      }

      const payload = JSON.parse(rawText);
      if (!Array.isArray(payload.items) || !Array.isArray(payload.available_categories)
        || !Number.isInteger(payload.total_count)) {
        throw new Error('The persistence API returned an invalid demand driver analytics response.');
      }
      setDemandDriverAnalytics(payload.items);
      setDemandDriverAnalyticsTotal(payload.total_count);
      setAvailableDemandDriverCategories(payload.available_categories);
    } catch (fetchError) {
      setDemandDriverAnalyticsError(fetchError.message || 'Unable to retrieve demand driver analytics.');
    } finally {
      setIsDemandDriverAnalyticsLoading(false);
    }
  };

  const openDemandDriverAnalytics = () => {
    setPage('demand-driver-analytics');
    if (authAccount) loadDemandDriverAnalytics();
  };

  const loadVulnerabilityAnalytics = async (isAuthenticated = Boolean(authAccount)) => {
    if (!isAuthenticated) {
      setVulnerabilityAnalyticsError(
        isEntraConfigured
          ? 'Sign in with your work account to view vulnerability indicator analytics.'
          : `Configure ${entraConfigurationKeys.join(', ')} to enable Microsoft sign-in.`,
      );
      return;
    }

    setIsVulnerabilityAnalyticsLoading(true);
    setVulnerabilityAnalyticsError('');
    setVulnerabilityAnalytics([]);
    setVulnerabilityAnalyticsTotal(0);
    try {
      const query = new URLSearchParams();
      if (vulnerabilityAnalyticsStartDate) query.set('start_date', vulnerabilityAnalyticsStartDate);
      if (vulnerabilityAnalyticsEndDate) query.set('end_date', vulnerabilityAnalyticsEndDate);
      if (selectedVulnerabilityCategories.length) {
        query.set('categories', selectedVulnerabilityCategories.join(','));
      }
      const separator = vulnerabilityAnalyticsUrl.includes('?') ? '&' : '?';
      const token = await acquirePersistenceToken();
      const response = await fetch(`${vulnerabilityAnalyticsUrl}${separator}${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `Vulnerability analytics request failed with status ${response.status}.`);
      }

      const payload = JSON.parse(rawText);
      if (!Array.isArray(payload.items) || !Array.isArray(payload.available_categories)
        || !Number.isInteger(payload.total_count)) {
        throw new Error(
          'The vulnerability analytics endpoint has an outdated or invalid response. '
          + 'Expected items, available_categories, and integer total_count; deploy the updated '
          + 'Persistence API and verify the configured endpoint.',
        );
      }
      setVulnerabilityAnalytics(payload.items);
      setVulnerabilityAnalyticsTotal(payload.total_count);
      setAvailableVulnerabilityCategories(payload.available_categories);
    } catch (fetchError) {
      setVulnerabilityAnalyticsError(fetchError.message || 'Unable to retrieve vulnerability analytics.');
    } finally {
      setIsVulnerabilityAnalyticsLoading(false);
    }
  };

  const openVulnerabilityAnalytics = () => {
    setPage('vulnerability-analytics');
    if (authAccount) loadVulnerabilityAnalytics();
  };

  const handleSignIn = async () => {
    setIsAuthBusy(true);
    setAuthError('');
    try {
      const account = await signInToEntra();
      setAuthAccount(account);
      if (page === 'interactions') await loadInteractions(0, false, true);
      if (page === 'pcr-analytics') await loadPcrAnalytics(true);
      if (page === 'demand-driver-analytics') await loadDemandDriverAnalytics(true);
      if (page === 'vulnerability-analytics') await loadVulnerabilityAnalytics(true);
    } catch (signInError) {
      setAuthError(signInError.message || 'Unable to sign in with Microsoft.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setIsAuthBusy(true);
    setAuthError('');
    try {
      await signOutOfEntra();
      setAuthAccount(null);
      setInteractions([]);
      setHasMoreInteractions(false);
      setAnalytics([]);
      setAnalyticsTotal(0);
      setDemandDriverAnalytics([]);
      setDemandDriverAnalyticsTotal(0);
      setAvailableDemandDriverCategories([]);
      setVulnerabilityAnalytics([]);
      setVulnerabilityAnalyticsTotal(0);
    } catch (signOutError) {
      setAuthError(signOutError.message || 'Unable to sign out.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleSubmit = async (event, batchMode = false) => {
    event.preventDefault();
    setLastRunMode(batchMode ? 'batch' : 'request');

    const trimmedInput = userInput.trim();
    if (!batchMode && !trimmedInput) {
      setStatus('error');
      setError('Enter a request before submitting.');
      setMessage('User input is required.');
      setResult(null);
      return;
    }

    const requestId = crypto.randomUUID();
    setStatus('loading');
    setIsLoading(true);
    setMessage(batchMode ? 'Processing the configured batch input…' : 'Sending your request to the agent…');
    setError('');
    setResult(null);

    try {
      const response = await fetch(agentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createRequestBody(trimmedInput, requestId, batchMode)),
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `Request failed with status ${response.status}.`);
      }

      const parsed = normalizeAgentResponse(rawText || '{}');
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
        throw new Error('The backend returned an empty response.');
      }

      const finalResult = {
        ...parsed,
        request_id: parsed.request_id || requestId,
      };

      setResult(finalResult);
      const completedWithWarnings = Array.isArray(finalResult.warnings)
        && finalResult.warnings.length > 0;
      setStatus(completedWithWarnings ? 'warning' : 'success');
      setMessage(completedWithWarnings
        ? `The ${batchMode ? 'batch' : 'request'} completed with warnings.`
        : batchMode ? 'The configured batch completed.' : 'Your request is complete.');
    } catch (fetchError) {
      setStatus('error');
      setError(fetchError.message || 'Unable to contact the hosted agent service.');
      setMessage('The request could not be processed. Check the service and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isAgentInteractionPage = ['interactions', 'pcr-analytics', 'demand-driver-analytics', 'vulnerability-analytics'].includes(page);
  const isInteractionNavigationActive = isAgentInteractionPage;
  const navigateTo = (targetPage) => {
    setPage(targetPage);
    setIsMobileNavigationOpen(false);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#home" onClick={() => navigateTo('home')}>
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-name">Voice Analytics
            <span></span></span>
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
          <button
            type="button"
            className={page === 'home' ? 'page-navigation__active' : ''}
            aria-current={page === 'home' ? 'page' : undefined}
            onClick={() => navigateTo('home')}
          >
            Home
          </button>
          <button
            type="button"
            className={page === 'batch' ? 'page-navigation__active' : ''}
            aria-current={page === 'batch' ? 'page' : undefined}
            onClick={() => navigateTo('batch')}
          >
            Batch Processing
          </button>
          <button
            type="button"
            className={isInteractionNavigationActive ? 'page-navigation__active' : ''}
            aria-current={isInteractionNavigationActive ? 'page' : undefined}
            onClick={openInteractions}
          >
            Agent Interactions
          </button>
        </nav>
        {isEntraConfigured && (
          <div className="auth-controls">
            {authAccount && <span className="signed-in-user">{authAccount.name || authAccount.username}</span>}
            <button
              type="button"
              className={authAccount ? 'auth-button auth-button--quiet' : 'auth-button'}
              onClick={authAccount ? handleSignOut : handleSignIn}
              disabled={!authReady || isAuthBusy}
            >
              {!authReady || isAuthBusy
                ? 'Please wait…'
                : authAccount ? 'Sign out' : 'Sign in'}
            </button>
          </div>
        )}
        <details className="settings">
          <summary>Settings</summary>
          <div className="settings-panel">
            <div className="settings-panel__heading">
              <h2>Connection settings</h2>
              <p>Configure the service endpoints used by this workspace.</p>
            </div>
            <label>
              Agent endpoint
              <input value={agentUrl} onChange={(event) => setAgentUrl(event.target.value)} />
            </label>
            <label>
              Interaction history endpoint
              <input value={historyUrl} onChange={(event) => setHistoryUrl(event.target.value)} />
            </label>
            <label>
              PCR analytics endpoint
              <input value={analyticsUrl} onChange={(event) => setAnalyticsUrl(event.target.value)} />
            </label>
            <label>
              Demand driver analytics endpoint
              <input value={demandDriverAnalyticsUrl} onChange={(event) => setDemandDriverAnalyticsUrl(event.target.value)} />
            </label>
            <label>
              Vulnerability analytics endpoint
              <input value={vulnerabilityAnalyticsUrl} onChange={(event) => setVulnerabilityAnalyticsUrl(event.target.value)} />
            </label>
          </div>
        </details>
      </header>

      <main className={`main-panel${isAgentInteractionPage ? ' main-panel--wide' : ''}`}>
        {authError && !['interactions', 'pcr-analytics', 'demand-driver-analytics', 'vulnerability-analytics'].includes(page) && <p className="error-message" role="alert">{authError}</p>}
        {page === 'home' && (
          <section className="page-content">
            <div className="page-heading">
              <p className="eyebrow">Voice Analytics</p>
              <h1>Voice Analytics</h1>
              <p>Submit a request, run a configured workload, or investigate agent activity.</p>
            </div>

            <div className="workspace-shortcuts" aria-label="Workspace shortcuts">
              <button type="button" className="shortcut-card" onClick={() => navigateTo('batch')}>
                <span className="shortcut-card__icon" aria-hidden="true">↗</span>
                <span><strong>Batch processing</strong><small>Run a configured workload</small></span>
                <span className="shortcut-card__arrow" aria-hidden="true">→</span>
              </button>
              <button type="button" className="shortcut-card" onClick={openInteractions}>
                <span className="shortcut-card__icon shortcut-card__icon--blue" aria-hidden="true">≡</span>
                <span><strong>Agent interactions</strong><small>Review requests and results</small></span>
                <span className="shortcut-card__arrow" aria-hidden="true">→</span>
              </button>
            </div>

            <div className="section-heading">
              <div>
                <p className="eyebrow">DIRECT REQUEST</p>
                <h2>Send a request to your agent</h2>
              </div>
              <span className="section-heading__note">Request ID generated automatically</span>
            </div>
            <form className="request-form" onSubmit={handleSubmit}>
              <label htmlFor="user-input">Your request</label>
              <textarea
                id="user-input"
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                rows={6}
                placeholder="Describe what you need…"
              />
              <div className="form-footer">
                <span>Your request is sent to the configured hosted agent endpoint.</span>
                <button type="submit" disabled={isLoading}>
                  {isLoading ? 'Working…' : 'Submit request'}
                </button>
              </div>
            </form>

            <ResponsePanel
              status={lastRunMode === 'request' ? status : 'idle'}
              message={lastRunMode === 'request' ? message : 'Your agent is ready when you are.'}
              error={lastRunMode === 'request' ? error : ''}
              result={lastRunMode === 'request' ? result : null}
            />
          </section>
        )}

        {page === 'batch' && (
          <section className="page-content">
            <div className="page-heading">
              <p className="eyebrow">BATCH PROCESSING</p>
              <h1>Batch Processing</h1>
              <p>Run and monitor configured batch workloads for your hosted agents.</p>
            </div>
            <form className="batch-card" onSubmit={(event) => handleSubmit(event, true)}>
              <div className="batch-card__content">
                <div className="batch-description">
                  <span className="batch-icon" aria-hidden="true">↗</span>
                  <div>
                    <span className="meta-label">CONFIGURED WORKLOAD</span>
                    <h2>Configured Batch</h2>
                    <p>The hosted agent will read and process its configured input source.</p>
                  </div>
                </div>
                <div className="batch-source">
                  <span className="batch-source__icon" aria-hidden="true">▤</span>
                  <span><strong>Input source</strong><small>Source details are not exposed by the current agent configuration.</small></span>
                </div>
              </div>
              <button type="submit" disabled={isLoading}>
                {isLoading ? 'Submitting batch…' : 'Start batch'}
              </button>
            </form>
            <p className="batch-note">Starting a batch runs the input currently configured for the hosted agent. No input source details are available in this workspace.</p>
            <ResponsePanel
              status={lastRunMode === 'batch' ? status : 'idle'}
              message={lastRunMode === 'batch' ? message : 'No batch has been submitted in this session.'}
              error={lastRunMode === 'batch' ? error : ''}
              result={lastRunMode === 'batch' ? result : null}
              mode="batch"
            />
          </section>
        )}

        {page === 'interactions' && (
          <section className="page-content interaction-page interaction-page--history">
            <AgentInteractionNavigation
              page={page}
              onInteractions={openInteractions}
              onAnalytics={openPcrAnalytics}
              onDemandDriverAnalytics={openDemandDriverAnalytics}
              onVulnerabilityAnalytics={openVulnerabilityAnalytics}
            />
            <div className="page-heading page-heading--row interaction-heading interaction-heading--history">
              <div>
                <p className="eyebrow">Interaction history</p>
                <h1>Agent Interactions</h1>
                <p>Search, review, and investigate requests and responses from your hosted agents.</p>
              </div>
              <div className="interaction-heading__actions">
                <div className="interaction-summary" aria-live="polite">
                  <strong>{visibleInteractions.length}</strong>
                  <span>matching</span>
                  <span className="interaction-summary__total">
                    {interactions.length} loaded{hasMoreInteractions ? ' · more available' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="interaction-refresh"
                  onClick={() => loadInteractions()}
                  disabled={isHistoryLoading || !authAccount}
                >
                  <span aria-hidden="true">↻</span>
                  {isHistoryLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
            <p className="loaded-records-note">
              Counts reflect the records loaded here; the API does not provide a database-wide total.
            </p>

            {historyError && <p className="error-message" role="alert">{historyError}</p>}
            {authError && <p className="error-message" role="alert">{authError}</p>}
            {!isEntraConfigured && (
              <div className="auth-notice">
                <h2>Microsoft sign-in needs configuration</h2>
                <p>
                  Set {entraConfigurationKeys.join(', ')} in <code>ui/.env.local</code>, then restart the UI.
                </p>
              </div>
            )}
            {isEntraConfigured && !authAccount && (
              <div className="auth-notice">
                <h2>Sign in to view agent interactions</h2>
                <p>Use your work account to securely access the Persistence API.</p>
                <button type="button" className="auth-button" onClick={handleSignIn} disabled={!authReady || isAuthBusy}>
                  {!authReady || isAuthBusy ? 'Please wait…' : 'Sign in with Microsoft'}
                </button>
              </div>
            )}
            <div className="interaction-tools" role="search">
              <label className="interaction-search">
                <span>Search interactions</span>
                <input
                  type="search"
                  value={interactionSearch}
                  onChange={(event) => setInteractionSearch(event.target.value)}
                  placeholder="Search request, agent, or result"
                  disabled={!authAccount}
                />
              </label>
              <label>
                Filter by agent
                <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} disabled={!authAccount}>
                  <option value="">All agents</option>
                  {agentNames.map((agentName) => (
                    <option key={agentName} value={agentName}>{agentName}</option>
                  ))}
                </select>
              </label>
              <label>
                Sort by
                <select value={interactionSort} onChange={(event) => setInteractionSort(event.target.value)} disabled={!authAccount}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="agent-asc">Agent name (A–Z)</option>
                  <option value="agent-desc">Agent name (Z–A)</option>
                </select>
              </label>
              {(interactionSearch || agentFilter || interactionSort !== 'newest') && (
                <button
                  type="button"
                  className="clear-filters-button"
                  onClick={() => {
                    setInteractionSearch('');
                    setAgentFilter('');
                    setInteractionSort('newest');
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
            {authAccount && isHistoryLoading && interactions.length === 0 ? (
              <p className="empty-state">Loading interactions…</p>
            ) : authAccount && interactions.length === 0 ? (
              <p className="empty-state">
                {historyError ? 'Interaction history could not be loaded.' : 'No interactions found yet.'}
              </p>
            ) : authAccount && visibleInteractions.length === 0 ? (
              <p className="empty-state">No interactions match these search and filter settings.</p>
            ) : authAccount ? (
              <div className="interaction-list">
                {visibleInteractions.map((interaction) => (
                  <article className="interaction-card" key={interaction.request_id}>
                    <div className="interaction-card__overview">
                      <div className="interaction-card__identity">
                        <span className="agent-name">{interaction.agent_name}</span>
                        <span className="meta-label">REQUEST ID</span>
                        <strong className="request-id">{interaction.request_id}</strong>
                        <CopyButton value={interaction.request_id} label="Copy request ID" />
                      </div>
                      <div className="interaction-card__summary">
                        {interaction.created_at && (
                          <time dateTime={interaction.created_at}>
                            {new Date(interaction.created_at).toLocaleString()}
                          </time>
                        )}
                        <strong>{interaction.primary_contact_reason || 'Classification result'}</strong>
                        <span>{interaction.user_input || 'Configured batch input'}</span>
                      </div>
                    </div>
                    <details className="interaction-card__details">
                      <summary>View interaction details</summary>
                      <div className="interaction-card__body">
                        <div>
                          <div className="detail-section-heading">
                            <h2>Request</h2>
                            <CopyButton value={interaction.user_input || ''} label="Copy request" />
                          </div>
                          <p>{interaction.user_input || 'Configured batch input'}</p>
                        </div>
                        <div>
                          <h2>Agent result</h2>
                          {interaction.result_json
                            ? (
                              <InteractionResult
                                value={interaction.result_json}
                                requestId={interaction.request_id}
                              />
                            )
                            : <p className="result-empty">No result recorded.</p>}
                        </div>
                      </div>
                    </details>
                  </article>
                ))}
              </div>
            ) : null}
            {hasMoreInteractions && (
              <button
                type="button"
                className="secondary load-more-button"
                onClick={() => loadInteractions(interactions.length, true)}
                disabled={isHistoryLoading}
              >
                {isHistoryLoading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </section>
        )}
        {page === 'pcr-analytics' && (
          <section className="page-content interaction-page">
            <AgentInteractionNavigation
              page={page}
              onInteractions={openInteractions}
              onAnalytics={openPcrAnalytics}
              onDemandDriverAnalytics={openDemandDriverAnalytics}
              onVulnerabilityAnalytics={openVulnerabilityAnalytics}
            />
            <div className="page-heading page-heading--row interaction-heading">
              <div>
                <p className="eyebrow">Agent Interaction</p>
                <h1>Primary Contact Reason Analytics</h1>
                <p>Explore completed interaction counts by primary contact reason.</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => loadPcrAnalytics()}
                disabled={isAnalyticsLoading || !authAccount}
              >
                {isAnalyticsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {analyticsError && <p className="error-message" role="alert">{analyticsError}</p>}
            {authError && <p className="error-message" role="alert">{authError}</p>}
            {!isEntraConfigured && (
              <div className="auth-notice">
                <h2>Microsoft sign-in needs configuration</h2>
                <p>
                  Set {entraConfigurationKeys.join(', ')} in <code>ui/.env.local</code>, then restart the UI.
                </p>
              </div>
            )}
            {isEntraConfigured && !authAccount && (
              <div className="auth-notice">
                <h2>Sign in to view PCR analytics</h2>
                <p>Use your work account to securely access the Persistence API.</p>
                <button type="button" className="auth-button" onClick={handleSignIn} disabled={!authReady || isAuthBusy}>
                  {!authReady || isAuthBusy ? 'Please wait…' : 'Sign in with Microsoft'}
                </button>
              </div>
            )}
            <form
              className="analytics-filters"
              onSubmit={(event) => {
                event.preventDefault();
                loadPcrAnalytics();
              }}
            >
              <label>
                Start date
                <input
                  type="date"
                  value={analyticsStartDate}
                  max={analyticsEndDate || undefined}
                  onChange={(event) => setAnalyticsStartDate(event.target.value)}
                  disabled={!authAccount}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={analyticsEndDate}
                  min={analyticsStartDate || undefined}
                  onChange={(event) => setAnalyticsEndDate(event.target.value)}
                  disabled={!authAccount}
                />
              </label>
              <label className="analytics-reasons">
                Contact reasons
                <select
                  multiple
                  size={5}
                  value={selectedContactReasons}
                  onChange={(event) => setSelectedContactReasons(
                    [...event.target.selectedOptions].map((option) => option.value),
                  )}
                  disabled={!authAccount}
                >
                  {availableContactReasons.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
                <span className="filter-hint">Use Ctrl or Command to select multiple reasons.</span>
              </label>
              <button type="submit" disabled={!authAccount || isAnalyticsLoading}>
                {isAnalyticsLoading ? 'Applying…' : 'Apply filters'}
              </button>
            </form>
            {!authAccount ? null : isAnalyticsLoading && analytics.length === 0 ? (
              <p className="empty-state">Loading PCR analytics…</p>
            ) : analytics.length === 0 ? (
              <p className="empty-state">
                {analyticsError ? 'PCR analytics could not be loaded.' : 'No PCR results found for these filters.'}
              </p>
            ) : (
              <section className="analytics-chart" aria-label="Primary Contact Reason counts">
                <div className="analytics-chart__heading">
                  <h2>Interactions by primary contact reason</h2>
                  <span>{analyticsTotal} interactions</span>
                </div>
                <div className="analytics-bars">
                  {analytics.map((item) => (
                    <div className="analytics-bar" key={item.reason}>
                      <div className="analytics-bar__label">
                        <span>{item.reason}</span>
                        <strong>{item.count}</strong>
                      </div>
                      <div
                        className="analytics-bar__track"
                        role="progressbar"
                        aria-label={`${item.reason}: ${item.count} interactions`}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={item.percentage}
                      >
                        <div className="analytics-bar__fill" style={{ width: `${item.percentage}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </section>
        )}

        {page === 'demand-driver-analytics' && (
          <section className="page-content interaction-page">
            <AgentInteractionNavigation
              page={page}
              onInteractions={openInteractions}
              onAnalytics={openPcrAnalytics}
              onDemandDriverAnalytics={openDemandDriverAnalytics}
              onVulnerabilityAnalytics={openVulnerabilityAnalytics}
            />
            <div className="page-heading page-heading--row interaction-heading">
              <div>
                <p className="eyebrow">Agent Interaction</p>
                <h1>Demand Driver Analytics</h1>
                <p>Explore completed interaction counts by demand driver.</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => loadDemandDriverAnalytics()}
                disabled={isDemandDriverAnalyticsLoading || !authAccount}
              >
                {isDemandDriverAnalyticsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {demandDriverAnalyticsError && <p className="error-message" role="alert">{demandDriverAnalyticsError}</p>}
            {authError && <p className="error-message" role="alert">{authError}</p>}
            {!isEntraConfigured && (
              <div className="auth-notice">
                <h2>Microsoft sign-in needs configuration</h2>
                <p>
                  Set {entraConfigurationKeys.join(', ')} in <code>ui/.env.local</code>, then restart the UI.
                </p>
              </div>
            )}
            {isEntraConfigured && !authAccount && (
              <div className="auth-notice">
                <h2>Sign in to view demand driver analytics</h2>
                <p>Use your work account to securely access the Persistence API.</p>
                <button type="button" className="auth-button" onClick={handleSignIn} disabled={!authReady || isAuthBusy}>
                  {!authReady || isAuthBusy ? 'Please wait…' : 'Sign in with Microsoft'}
                </button>
              </div>
            )}
            <form
              className="analytics-filters"
              onSubmit={(event) => {
                event.preventDefault();
                loadDemandDriverAnalytics();
              }}
            >
              <label>
                Start date
                <input
                  type="date"
                  value={demandDriverAnalyticsStartDate}
                  max={demandDriverAnalyticsEndDate || undefined}
                  onChange={(event) => setDemandDriverAnalyticsStartDate(event.target.value)}
                  disabled={!authAccount}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={demandDriverAnalyticsEndDate}
                  min={demandDriverAnalyticsStartDate || undefined}
                  onChange={(event) => setDemandDriverAnalyticsEndDate(event.target.value)}
                  disabled={!authAccount}
                />
              </label>
              <label className="analytics-reasons">
                Demand Driver Categories
                <select
                  multiple
                  size={5}
                  value={selectedDemandDriverCategories}
                  onChange={(event) => setSelectedDemandDriverCategories(
                    [...event.target.selectedOptions].map((option) => option.value),
                  )}
                  disabled={!authAccount}
                >
                  {availableDemandDriverCategories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <span className="filter-hint">Use Ctrl or Command to select multiple categories.</span>
              </label>
              <button type="submit" disabled={!authAccount || isDemandDriverAnalyticsLoading}>
                {isDemandDriverAnalyticsLoading ? 'Applying…' : 'Apply filters'}
              </button>
            </form>
            {!authAccount ? null : isDemandDriverAnalyticsLoading && demandDriverAnalytics.length === 0 ? (
              <p className="empty-state">Loading demand driver analytics…</p>
            ) : demandDriverAnalytics.length === 0 ? (
              <p className="empty-state">
                {demandDriverAnalyticsError
                  ? 'Demand driver analytics could not be loaded.'
                  : 'No demand driver results found for these filters.'}
              </p>
            ) : (
              <section className="analytics-chart" aria-label="Demand driver counts">
                <div className="analytics-chart__heading">
                  <h2>Interactions by demand driver</h2>
                  <span>{demandDriverAnalyticsTotal} interactions</span>
                </div>
                <div className="analytics-bars">
                  {demandDriverAnalytics.map((item) => (
                    <div className="analytics-bar" key={item.reason}>
                      <div className="analytics-bar__label">
                        <span>{item.reason}</span>
                        <strong>{item.count}</strong>
                      </div>
                      <div
                        className="analytics-bar__track"
                        role="progressbar"
                        aria-label={`${item.reason}: ${item.count} interactions`}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={item.percentage}
                      >
                        <div className="analytics-bar__fill" style={{ width: `${item.percentage}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </section>
        )}
        {page === 'vulnerability-analytics' && (
          <section className="page-content interaction-page">
            <AgentInteractionNavigation
              page={page}
              onInteractions={openInteractions}
              onAnalytics={openPcrAnalytics}
              onDemandDriverAnalytics={openDemandDriverAnalytics}
              onVulnerabilityAnalytics={openVulnerabilityAnalytics}
            />
            <div className="page-heading page-heading--row interaction-heading">
              <div>
                <p className="eyebrow">Agent Interaction</p>
                <h1>Vulnerability Indicator Analytics</h1>
                <p>Explore completed interaction counts by vulnerability indicator category.</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => loadVulnerabilityAnalytics()}
                disabled={isVulnerabilityAnalyticsLoading || !authAccount}
              >
                {isVulnerabilityAnalyticsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {vulnerabilityAnalyticsError && <p className="error-message" role="alert">{vulnerabilityAnalyticsError}</p>}
            {authError && <p className="error-message" role="alert">{authError}</p>}
            {!isEntraConfigured && (
              <div className="auth-notice">
                <h2>Microsoft sign-in needs configuration</h2>
                <p>
                  Set {entraConfigurationKeys.join(', ')} in <code>ui/.env.local</code>, then restart the UI.
                </p>
              </div>
            )}
            {isEntraConfigured && !authAccount && (
              <div className="auth-notice">
                <h2>Sign in to view vulnerability indicator analytics</h2>
                <p>Use your work account to securely access the Persistence API.</p>
                <button type="button" className="auth-button" onClick={handleSignIn} disabled={!authReady || isAuthBusy}>
                  {!authReady || isAuthBusy ? 'Please wait…' : 'Sign in with Microsoft'}
                </button>
              </div>
            )}
            <form
              className="analytics-filters"
              onSubmit={(event) => {
                event.preventDefault();
                loadVulnerabilityAnalytics();
              }}
            >
              <label>
                Start date
                <input
                  type="date"
                  value={vulnerabilityAnalyticsStartDate}
                  max={vulnerabilityAnalyticsEndDate || undefined}
                  onChange={(event) => setVulnerabilityAnalyticsStartDate(event.target.value)}
                  disabled={!authAccount}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={vulnerabilityAnalyticsEndDate}
                  min={vulnerabilityAnalyticsStartDate || undefined}
                  onChange={(event) => setVulnerabilityAnalyticsEndDate(event.target.value)}
                  disabled={!authAccount}
                />
              </label>
              <label className="analytics-reasons">
                Vulnerability indicator categories
                <select
                  multiple
                  size={5}
                  value={selectedVulnerabilityCategories}
                  onChange={(event) => setSelectedVulnerabilityCategories(
                    [...event.target.selectedOptions].map((option) => option.value),
                  )}
                  disabled={!authAccount}
                >
                  {availableVulnerabilityCategories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <span className="filter-hint">Use Ctrl or Command to select multiple categories.</span>
              </label>
              <button type="submit" disabled={!authAccount || isVulnerabilityAnalyticsLoading}>
                {isVulnerabilityAnalyticsLoading ? 'Applying…' : 'Apply filters'}
              </button>
            </form>
            {!authAccount ? null : isVulnerabilityAnalyticsLoading && vulnerabilityAnalytics.length === 0 ? (
              <p className="empty-state">Loading vulnerability indicator analytics…</p>
            ) : vulnerabilityAnalytics.length === 0 ? (
              <p className="empty-state">
                {vulnerabilityAnalyticsError
                  ? 'Vulnerability indicator analytics could not be loaded.'
                  : 'No vulnerability indicator results found for these filters.'}
              </p>
            ) : (
              <section className="analytics-chart" aria-label="Vulnerability indicator category counts">
                <div className="analytics-chart__heading">
                  <h2>Indicators by vulnerability category</h2>
                  <span>{vulnerabilityAnalyticsTotal} indicators</span>
                </div>
                <div className="analytics-bars">
                  {vulnerabilityAnalytics.map((item) => (
                    <div className="analytics-bar" key={item.reason}>
                      <div className="analytics-bar__label">
                        <span>{item.reason}</span>
                        <strong>{item.count}</strong>
                      </div>
                      <div
                        className="analytics-bar__track"
                        role="progressbar"
                        aria-label={`${item.reason}: ${item.count} indicators`}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={item.percentage}
                      >
                        <div className="analytics-bar__fill" style={{ width: `${item.percentage}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function AgentInteractionNavigation({
  page,
  onInteractions,
  onAnalytics,
  onDemandDriverAnalytics,
  onVulnerabilityAnalytics,
}) {
  return (
    <nav className="interaction-section-navigation" aria-label="Agent Interaction">
      <button
        type="button"
        className={page === 'interactions' ? 'interaction-section-navigation__active' : ''}
        aria-current={page === 'interactions' ? 'page' : undefined}
        onClick={onInteractions}
      >
        Interactions
      </button>
      <button
        type="button"
        className={page === 'pcr-analytics' ? 'interaction-section-navigation__active' : ''}
        aria-current={page === 'pcr-analytics' ? 'page' : undefined}
        onClick={onAnalytics}
      >
        Primary Contact Reason Analytics
      </button>
      <button
        type="button"
        className={page === 'demand-driver-analytics' ? 'interaction-section-navigation__active' : ''}
        aria-current={page === 'demand-driver-analytics' ? 'page' : undefined}
        onClick={onDemandDriverAnalytics}
      >
        Demand Driver Analytics
      </button>
      <button
        type="button"
        className={page === 'vulnerability-analytics' ? 'interaction-section-navigation__active' : ''}
        aria-current={page === 'vulnerability-analytics' ? 'page' : undefined}
        onClick={onVulnerabilityAnalytics}
      >
        Vulnerability Indicator Analytics
      </button>
    </nav>
  );
}

function ResponsePanel({ status, message, error, result, mode = 'request' }) {
  const resultJson = result ? JSON.stringify(result.result || result, null, 2) : '';

  return (
    <section className="response-panel" aria-live="polite">
      <div className="response-heading">
        <div>
          <p className="eyebrow">{mode === 'batch' ? 'BATCH EXECUTION' : 'AGENT RESPONSE'}</p>
          <h2>
            {status === 'success'
              ? 'Completed'
              : status === 'warning'
                ? 'Completed with warnings'
                : status === 'error'
                  ? 'Execution failed'
                  : status === 'loading'
                    ? mode === 'batch' ? 'Submitting batch' : 'Request in progress'
                    : mode === 'batch' ? 'Batch status' : 'Response'}
          </h2>
        </div>
        <span className={`status-indicator status-indicator--${status}`}>
          {status === 'idle' ? 'Ready' : status === 'loading' ? 'Running' : status}
        </span>
      </div>
      <p className="response-message">{message}</p>
      {status === 'loading' && (
        <p className="execution-note">
          Processing is underway. Progress and record counts are not provided by the current agent endpoint.
        </p>
      )}
      {error && <p className="error-message" role="alert">{error}</p>}
      {result && (
        <div className="response-result">
          <div className="result-meta">
            <span><strong>Request ID</strong>{result.request_id}</span>
            {result.agent_name && <span><strong>Agent</strong>{result.agent_name}</span>}
            {result.duration_ms != null && <span><strong>Duration</strong>{result.duration_ms} ms</span>}
          </div>
          {result.summary && <p className="result-summary">{result.summary}</p>}
          {result.result?.primary_contact_reason && (
            <div className="primary-result">
              <span className="meta-label">PRIMARY CONTACT REASON</span>
              <strong>{result.result.primary_contact_reason}</strong>
              {result.result.demand_driver && (
                <span>Demand driver · {result.result.demand_driver}</span>
              )}
              {result.result.confidence && (
                <span>Confidence · {result.result.confidence}</span>
              )}
            </div>
          )}
          <details className="result-json-details">
            <summary>View raw response JSON</summary>
            <div className="result-json-toolbar">
              <CopyButton value={resultJson} label="Copy response" />
            </div>
            <pre className="result-json-full">{resultJson}</pre>
          </details>
          {Array.isArray(result.warnings) && result.warnings.length > 0 && (
            <ul className="warning-list">
              {result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function CopyButton({ value, label }) {
  const [copyMessage, setCopyMessage] = useState('');

  const copyValue = async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyMessage('Clipboard access is unavailable in this browser.');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage('Copied to clipboard.');
    } catch (copyError) {
      setCopyMessage(copyError.message || 'Unable to copy to clipboard.');
    }
  };

  return (
    <span className="copy-control">
      <button type="button" className="copy-button" onClick={copyValue} disabled={!value}>
        {label}
      </button>
      {copyMessage && <span className="copy-message" role="status">{copyMessage}</span>}
    </span>
  );
}

function InteractionResult({ value, requestId }) {
  const resultPayload = value?.result_json || value;
  const classification = resultPayload?.result || resultPayload;
  const assessment = classification?.vulnerability_assessment || {};
  const knownClassificationFields = new Set([
    'primary_contact_reason',
    'demand_driver',
    'confidence',
    'evidence',
    'demand_driver_evidence',
    'vulnerability_assessment',
  ]);
  const additionalFields = Object.entries(classification || {})
    .filter(([key]) => !knownClassificationFields.has(key) && key !== 'schema_version');
  const assessmentFields = Object.entries(assessment)
    .filter(([key]) => ![
      'vulnerability_indicators',
      'vulnerability_indicator_category',
      'vulnerability_indicator_evidence',
    ].includes(key));
  const primaryEvidence = Array.isArray(classification?.evidence)
    ? classification.evidence
    : classification?.evidence
      ? [classification.evidence]
      : [];
  const demandEvidence = Array.isArray(classification?.demand_driver_evidence)
    ? classification.demand_driver_evidence
    : classification?.demand_driver_evidence
      ? [classification.demand_driver_evidence]
      : [];
  const vulnerabilityIndicators = Array.isArray(assessment.vulnerability_indicators)
    ? assessment.vulnerability_indicators
    : [];
  const vulnerabilityCategories = Array.isArray(assessment.vulnerability_indicator_category)
    ? assessment.vulnerability_indicator_category
    : assessment.vulnerability_indicator_category
      ? [assessment.vulnerability_indicator_category]
      : vulnerabilityIndicators.map(({ category }) => category).filter(Boolean);
  const vulnerabilityEvidence = Array.isArray(assessment.vulnerability_indicator_evidence)
    ? assessment.vulnerability_indicator_evidence
    : assessment.vulnerability_indicator_evidence
      ? [assessment.vulnerability_indicator_evidence]
      : vulnerabilityIndicators.map(({ evidence }) => evidence).filter(Boolean);
  const anchorPrefix = `interaction-${String(requestId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const evidenceTargets = [
    {
      key: 'evidence',
      id: `${anchorPrefix}-evidence`,
      label: 'Primary Contact Reason Evidence',
      items: primaryEvidence,
      jsonValue: { result: { evidence: primaryEvidence } },
    },
    {
      key: 'demand_driver_evidence',
      id: `${anchorPrefix}-demand-driver-evidence`,
      label: 'Demand Driver Evidence',
      items: demandEvidence,
      jsonValue: { result: { demand_driver_evidence: demandEvidence } },
    },
    {
      key: 'vulnerability_indicator_evidence',
      id: `${anchorPrefix}-vulnerability-evidence`,
      label: 'Vulnerability Indicator Evidence',
      items: vulnerabilityEvidence,
      jsonValue: {
        result: {
          vulnerability_assessment: {
            vulnerability_indicator_evidence: vulnerabilityEvidence,
          },
        },
      },
    },
  ];
  const openResultJson = (event) => {
    const card = event.currentTarget.closest('.interaction-card');
    const details = card?.querySelector('.result-json-details');
    if (details) details.open = true;
  };

  return (
    <>
      <dl className="classification-result">
        <div>
          <dt>Primary Contact Reason</dt>
          <dd>{classification?.primary_contact_reason ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Demand Driver</dt>
          <dd>{classification?.demand_driver ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Confidence Level</dt>
          <dd>{classification?.confidence ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>
            <a href={`#${anchorPrefix}-evidence`} onClick={openResultJson}>
              Primary Contact Reason Evidence
            </a>
          </dt>
          <dd>
            {primaryEvidence.length > 0
              ? <ul>{primaryEvidence.map((item, index) => <li key={`${item}-${index}`}>{String(item)}</li>)}</ul>
              : 'No evidence provided'}
          </dd>
        </div>
        <div>
          <dt>
            <a href={`#${anchorPrefix}-demand-driver-evidence`} onClick={openResultJson}>
              Demand Driver Evidence
            </a>
          </dt>
          <dd>
            {demandEvidence.length > 0
              ? <ul>{demandEvidence.map((item, index) => <li key={`${item}-${index}`}>{String(item)}</li>)}</ul>
              : 'No demand driver evidence provided'}
          </dd>
        </div>
        <div>
          <dt>Vulnerability Indicator Category</dt>
          <dd>
            {vulnerabilityCategories.length > 0
              ? <ul>{vulnerabilityCategories.map((item, index) => <li key={`${item}-${index}`}>{String(item)}</li>)}</ul>
              : 'No category provided'}
          </dd>
        </div>
        <div>
          <dt>
            <a href={`#${anchorPrefix}-vulnerability-evidence`} onClick={openResultJson}>
              Vulnerability Indicator Evidence
            </a>
          </dt>
          <dd>
            {vulnerabilityEvidence.length > 0
              ? <ul>{vulnerabilityEvidence.map((item, index) => <li key={`${item}-${index}`}>{String(item)}</li>)}</ul>
              : 'No vulnerability indicator evidence provided'}
          </dd>
        </div>
        {[...additionalFields, ...assessmentFields].map(([key, fieldValue]) => (
          <div key={key}>
            <dt>{key.replaceAll('_', ' ')}</dt>
            <dd>{typeof fieldValue === 'string' ? fieldValue : JSON.stringify(fieldValue)}</dd>
          </div>
        ))}
      </dl>
      <details className="result-json-details">
        <summary>View raw result JSON</summary>
        <div className="result-json-toolbar">
          <CopyButton value={JSON.stringify(value, null, 2)} label="Copy result JSON" />
        </div>
        <div className="result-json-evidence">
          {evidenceTargets.map(({ key, id, label, jsonValue }) => (
            <section id={id} key={key}>
              <h3>{label}</h3>
              <pre>{JSON.stringify(jsonValue, null, 2)}</pre>
            </section>
          ))}
        </div>
        <pre className="result-json-full">{JSON.stringify(value, null, 2)}</pre>
      </details>
    </>
  );
}

export default App;
