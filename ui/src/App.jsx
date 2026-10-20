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
  const [page, setPage] = useState('home');
  const [authAccount, setAuthAccount] = useState(null);
  const [authReady, setAuthReady] = useState(!isEntraConfigured);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('Your agent is ready when you are.');
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
    if (authAccount) loadInteractions();
  };

  const handleSignIn = async () => {
    setIsAuthBusy(true);
    setAuthError('');
    try {
      const account = await signInToEntra();
      setAuthAccount(account);
      if (page === 'interactions') await loadInteractions(0, false, true);
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
    } catch (signOutError) {
      setAuthError(signOutError.message || 'Unable to sign out.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleSubmit = async (event, batchMode = false) => {
    event.preventDefault();

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
      setStatus('success');
      setMessage('Your request is complete.');
    } catch (fetchError) {
      setStatus('error');
      setError(fetchError.message || 'Unable to contact the hosted agent service.');
      setMessage('The request could not be processed. Check the service and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#home" onClick={() => setPage('home')}>
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>Hosted agents</span>
        </a>
        <nav className="page-navigation" aria-label="Main navigation">
          <button
            type="button"
            className={page === 'home' ? 'page-navigation__active' : ''}
            aria-current={page === 'home' ? 'page' : undefined}
            onClick={() => setPage('home')}
          >
            Home
          </button>
          <button
            type="button"
            className={page === 'batch' ? 'page-navigation__active' : ''}
            aria-current={page === 'batch' ? 'page' : undefined}
            onClick={() => setPage('batch')}
          >
            Batch processing
          </button>
          <button
            type="button"
            className={page === 'interactions' ? 'page-navigation__active' : ''}
            aria-current={page === 'interactions' ? 'page' : undefined}
            onClick={openInteractions}
          >
            Agent interactions
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
            <label>
              Agent endpoint
              <input value={agentUrl} onChange={(event) => setAgentUrl(event.target.value)} />
            </label>
            <label>
              Interaction history endpoint
              <input value={historyUrl} onChange={(event) => setHistoryUrl(event.target.value)} />
            </label>
          </div>
        </details>
      </header>

      <main className="main-panel">
        {authError && page !== 'interactions' && <p className="error-message" role="alert">{authError}</p>}
        {page === 'home' && (
          <section className="page-content">
            <div className="page-heading">
              <p className="eyebrow">Home</p>
              <h1>What can your agent help with?</h1>
              <p>Enter a request and get a response from your hosted agent.</p>
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
                <span>Request ID is generated automatically.</span>
                <button type="submit" disabled={isLoading}>
                  {isLoading ? 'Working…' : 'Submit request'}
                </button>
              </div>
            </form>

            <ResponsePanel
              status={status}
              message={message}
              error={error}
              result={result}
            />
          </section>
        )}

        {page === 'batch' && (
          <section className="page-content">
            <div className="page-heading">
              <p className="eyebrow">Batch processing</p>
              <h1>Process a configured batch</h1>
              <p>Run the input file or blob configured for your hosted agent.</p>
            </div>
            <form className="batch-card" onSubmit={(event) => handleSubmit(event, true)}>
              <div className="batch-description">
                <span className="batch-icon" aria-hidden="true">↗</span>
                <div>
                  <h2>Configured batch input</h2>
                  <p>The agent will read its batch source. No request text is needed here.</p>
                </div>
              </div>
              <button type="submit" disabled={isLoading}>
                {isLoading ? 'Processing…' : 'Start batch'}
              </button>
            </form>
            <ResponsePanel
              status={status}
              message={message}
              error={error}
              result={result}
            />
          </section>
        )}

        {page === 'interactions' && (
          <section className="page-content interaction-page">
            <div className="page-heading page-heading--row interaction-heading">
              <div>
                <p className="eyebrow">History</p>
                <h1>Agent interactions</h1>
                <p>Browse requests and results recorded by your hosted agents.</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => loadInteractions()}
                disabled={isHistoryLoading || !authAccount}
              >
                {isHistoryLoading ? 'Loading…' : 'Refresh'}
              </button>
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
              <p className="interaction-count" aria-live="polite">
                Showing {visibleInteractions.length} of {interactions.length} loaded
              </p>
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
                    <div className="interaction-card__heading">
                      <div>
                        <span className="meta-label">Request ID</span>
                        <strong>{interaction.request_id}</strong>
                      </div>
                      <span className="agent-name">{interaction.agent_name}</span>
                    </div>
                    <div className="interaction-card__body">
                      <div>
                        <h2>Request</h2>
                        <p>{interaction.user_input || 'Configured batch input'}</p>
                      </div>
                      <div>
                        <h2>Result</h2>
                        {interaction.result_json
                          ? <InteractionResult value={interaction.result_json} />
                          : <p className="result-empty">No result recorded.</p>}
                      </div>
                    </div>
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
      </main>
    </div>
  );
}

function ResponsePanel({ status, message, error, result }) {
  return (
    <section className="response-panel" aria-live="polite">
      <div className="response-heading">
        <div>
          <p className="eyebrow">Agent response</p>
          <h2>{status === 'success' ? 'Completed' : status === 'loading' ? 'In progress' : 'Response'}</h2>
        </div>
        <span className={`status-indicator status-indicator--${status}`}>{status}</span>
      </div>
      <p className="response-message">{message}</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {result && (
        <div className="response-result">
          <div className="result-meta">
            <span><strong>Request ID</strong>{result.request_id}</span>
            <span><strong>Agent</strong>{result.agent_name || 'Hosted agent'}</span>
            <span><strong>Duration</strong>{result.duration_ms ?? '—'}{result.duration_ms != null && ' ms'}</span>
          </div>
          {result.summary && <p className="result-summary">{result.summary}</p>}
          <pre>{JSON.stringify(result.result || result, null, 2)}</pre>
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

function InteractionResult({ value }) {
  const classification = value?.result_json || value?.result || value;
  const evidence = Array.isArray(classification?.evidence)
    ? classification.evidence
    : classification?.evidence
      ? [classification.evidence]
      : [];

  return (
    <dl className="classification-result">
      <div>
        <dt>Primary Contact Reason</dt>
        <dd>{classification?.primary_contact_reason ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>Confidence</dt>
        <dd>{classification?.confidence ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>Evidence</dt>
        <dd>
          {evidence.length > 0
            ? <ul>{evidence.map((item, index) => <li key={`${item}-${index}`}>{String(item)}</li>)}</ul>
            : 'No evidence provided'}
        </dd>
      </div>
    </dl>
  );
}

export default App;
