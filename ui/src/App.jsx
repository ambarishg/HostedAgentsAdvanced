import { useEffect, useMemo, useState } from 'react';
import {
  acquirePersistenceToken,
  entraConfigurationKeys,
  initializeEntra,
  isEntraConfigured,
  signInToEntra,
  signOutOfEntra,
} from './auth';
import { AnalyticsPage } from './components/AnalyticsPage';
import { AppHeader } from './components/AppHeader';
import { AuthenticationGate } from './components/AuthenticationGate';
import { BatchPage, HomePage } from './components/WorkspacePages';
import { AgentInteractionNavigation, CopyButton, InteractionResult } from './components/InteractionDetails';

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
  const [signOutMessage, setSignOutMessage] = useState('');
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
    setSignOutMessage('');
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
      setPage('home');
      setUserInput('');
      setStatus('idle');
      setMessage('Your agent is ready when you are.');
      setResult(null);
      setError('');
      setInteractions([]);
      setHistoryError('');
      setHasMoreInteractions(false);
      setAnalytics([]);
      setAnalyticsTotal(0);
      setAnalyticsError('');
      setDemandDriverAnalytics([]);
      setDemandDriverAnalyticsTotal(0);
      setAvailableDemandDriverCategories([]);
      setDemandDriverAnalyticsError('');
      setVulnerabilityAnalytics([]);
      setVulnerabilityAnalyticsTotal(0);
      setVulnerabilityAnalyticsError('');
      setSignOutMessage('You have been signed out of Voice Analytics and Microsoft Entra ID.');
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
    setMessage(batchMode ? 'Processing the configured batch inputâ€¦' : 'Sending your request to the agentâ€¦');
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

  if (!isEntraConfigured || !authReady || !authAccount) {
    return (
      <AuthenticationGate
        authError={authError}
        authReady={authReady}
        isAuthBusy={isAuthBusy}
        isConfigured={isEntraConfigured}
        missingConfigurationKeys={entraConfigurationKeys}
        onSignIn={handleSignIn}
        signOutMessage={signOutMessage}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        account={authAccount}
        agentUrl={agentUrl}
        analyticsUrl={analyticsUrl}
        demandDriverAnalyticsUrl={demandDriverAnalyticsUrl}
        historyUrl={historyUrl}
        isInteractionPage={isInteractionNavigationActive}
        isMobileNavigationOpen={isMobileNavigationOpen}
        isSigningOut={isAuthBusy}
        onNavigate={navigateTo}
        onOpenInteractions={openInteractions}
        onSignOut={handleSignOut}
        page={page}
        setAgentUrl={setAgentUrl}
        setAnalyticsUrl={setAnalyticsUrl}
        setDemandDriverAnalyticsUrl={setDemandDriverAnalyticsUrl}
        setHistoryUrl={setHistoryUrl}
        setIsMobileNavigationOpen={setIsMobileNavigationOpen}
        setVulnerabilityAnalyticsUrl={setVulnerabilityAnalyticsUrl}
        vulnerabilityAnalyticsUrl={vulnerabilityAnalyticsUrl}
      />

      <main className={`main-panel${isAgentInteractionPage ? ' main-panel--wide' : ''}`}>
        {authError && !['interactions', 'pcr-analytics', 'demand-driver-analytics', 'vulnerability-analytics'].includes(page) && <p className="error-message" role="alert">{authError}</p>}
        {page === 'home' && (
          <HomePage
            error={error}
            isLoading={isLoading}
            lastRunMode={lastRunMode}
            message={message}
            onNavigate={navigateTo}
            onOpenInteractions={openInteractions}
            onSubmit={handleSubmit}
            result={result}
            setUserInput={setUserInput}
            status={status}
            userInput={userInput}
          />
        )}

        {page === 'batch' && (
          <BatchPage
            error={error}
            isLoading={isLoading}
            lastRunMode={lastRunMode}
            message={message}
            onSubmit={(event) => handleSubmit(event, true)}
            result={result}
            status={status}
          />
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
                    {interactions.length} loaded{hasMoreInteractions ? ' Â· more available' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="interaction-refresh"
                  onClick={() => loadInteractions()}
                  disabled={isHistoryLoading || !authAccount}
                >
                  <span aria-hidden="true">â†»</span>
                  {isHistoryLoading ? 'Refreshingâ€¦' : 'Refresh'}
                </button>
              </div>
            </div>
            

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
                  {!authReady || isAuthBusy ? 'Please waitâ€¦' : 'Sign in with Microsoft'}
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
                  <option value="agent-asc">Agent name (Aâ€“Z)</option>
                  <option value="agent-desc">Agent name (Zâ€“A)</option>
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
              <p className="empty-state">Loading interactionsâ€¦</p>
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
                {isHistoryLoading ? 'Loadingâ€¦' : 'Load more'}
              </button>
            )}
          </section>
        )}
        {page === 'pcr-analytics' && (
          <AnalyticsPage
            availableCategories={availableContactReasons}
            categoryLabel="Contact reasons"
            emptyMessage="No PCR results found for these filters."
            endDate={analyticsEndDate}
            error={analyticsError}
            isLoading={isAnalyticsLoading}
            items={analytics}
            metricLabel="Interactions by primary contact reason"
            navigation={(
            <AgentInteractionNavigation
              page={page}
              onInteractions={openInteractions}
              onAnalytics={openPcrAnalytics}
              onDemandDriverAnalytics={openDemandDriverAnalytics}
              onVulnerabilityAnalytics={openVulnerabilityAnalytics}
            />
            )}
            onApplyFilters={(event) => { event.preventDefault(); loadPcrAnalytics(); }}
            onChangeCategories={(event) => setSelectedContactReasons([...event.target.selectedOptions].map((option) => option.value))}
            onChangeEndDate={(event) => setAnalyticsEndDate(event.target.value)}
            onChangeStartDate={(event) => setAnalyticsStartDate(event.target.value)}
            onRefresh={() => loadPcrAnalytics()}
            selectedCategories={selectedContactReasons}
            startDate={analyticsStartDate}
            subtitle="Explore completed interaction counts by primary contact reason."
            title="Primary Contact Reason Analytics"
            total={analyticsTotal}
            totalLabel="interactions"
          />
        )}

        {page === 'demand-driver-analytics' && (
          <AnalyticsPage
            availableCategories={availableDemandDriverCategories}
            categoryLabel="Demand Driver Categories"
            emptyMessage="No demand driver results found for these filters."
            endDate={demandDriverAnalyticsEndDate}
            error={demandDriverAnalyticsError}
            isLoading={isDemandDriverAnalyticsLoading}
            items={demandDriverAnalytics}
            metricLabel="Interactions by demand driver"
            navigation={(
            <AgentInteractionNavigation
              page={page}
              onInteractions={openInteractions}
              onAnalytics={openPcrAnalytics}
              onDemandDriverAnalytics={openDemandDriverAnalytics}
              onVulnerabilityAnalytics={openVulnerabilityAnalytics}
            />
            )}
            onApplyFilters={(event) => { event.preventDefault(); loadDemandDriverAnalytics(); }}
            onChangeCategories={(event) => setSelectedDemandDriverCategories([...event.target.selectedOptions].map((option) => option.value))}
            onChangeEndDate={(event) => setDemandDriverAnalyticsEndDate(event.target.value)}
            onChangeStartDate={(event) => setDemandDriverAnalyticsStartDate(event.target.value)}
            onRefresh={() => loadDemandDriverAnalytics()}
            selectedCategories={selectedDemandDriverCategories}
            startDate={demandDriverAnalyticsStartDate}
            subtitle="Explore completed interaction counts by demand driver."
            title="Demand Driver Analytics"
            total={demandDriverAnalyticsTotal}
            totalLabel="interactions"
          />
        )}

        {page === 'vulnerability-analytics' && (
          <AnalyticsPage
            availableCategories={availableVulnerabilityCategories}
            categoryLabel="Vulnerability indicator categories"
            emptyMessage="No vulnerability indicator results found for these filters."
            endDate={vulnerabilityAnalyticsEndDate}
            error={vulnerabilityAnalyticsError}
            isLoading={isVulnerabilityAnalyticsLoading}
            items={vulnerabilityAnalytics}
            metricLabel="Indicators by vulnerability category"
            navigation={(
            <AgentInteractionNavigation
              page={page}
              onInteractions={openInteractions}
              onAnalytics={openPcrAnalytics}
              onDemandDriverAnalytics={openDemandDriverAnalytics}
              onVulnerabilityAnalytics={openVulnerabilityAnalytics}
            />
            )}
            onApplyFilters={(event) => { event.preventDefault(); loadVulnerabilityAnalytics(); }}
            onChangeCategories={(event) => setSelectedVulnerabilityCategories([...event.target.selectedOptions].map((option) => option.value))}
            onChangeEndDate={(event) => setVulnerabilityAnalyticsEndDate(event.target.value)}
            onChangeStartDate={(event) => setVulnerabilityAnalyticsStartDate(event.target.value)}
            onRefresh={() => loadVulnerabilityAnalytics()}
            selectedCategories={selectedVulnerabilityCategories}
            startDate={vulnerabilityAnalyticsStartDate}
            subtitle="Explore completed interaction counts by vulnerability indicator category."
            title="Vulnerability Indicator Analytics"
            total={vulnerabilityAnalyticsTotal}
            totalLabel="indicators"
          />
        )}
      </main>
    </div>
  );
}

export default App;
