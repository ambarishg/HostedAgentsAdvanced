import { useMemo, useState } from 'react';

const defaultAgentUrl = import.meta.env.VITE_HOSTED_AGENT_URL || '/invocations';
const defaultPersistUrl = import.meta.env.VITE_PERSISTENCE_API_URL || '/api/pcr-results';
const defaultHistoryUrl = import.meta.env.VITE_PERSISTENCE_HISTORY_URL || '/api/agent-interactions';
const savedTheme = window.localStorage.getItem('hosted-agents-theme');

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
  const [theme, setTheme] = useState(savedTheme === 'light' ? 'light' : 'dark');
  const [userInput, setUserInput] = useState('Summarize the main benefit of a transactional database write.');
  const [batchMode, setBatchMode] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [agentUrl, setAgentUrl] = useState(defaultAgentUrl);
  const [persistUrl, setPersistUrl] = useState(defaultPersistUrl);
  const [historyUrl, setHistoryUrl] = useState(defaultHistoryUrl);
  const [historyToken, setHistoryToken] = useState('');
  const [page, setPage] = useState('workspace');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('Ready to submit a new agent request.');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [recentRequests, setRecentRequests] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [hasMoreInteractions, setHasMoreInteractions] = useState(false);

  const requestLabel = useMemo(() => {
    if (requestId) return requestId;
    return 'auto-generated';
  }, [requestId]);

  const loadInteractions = async (offset = 0, append = false) => {
    setIsHistoryLoading(true);
    setHistoryError('');
    if (!append) {
      setInteractions([]);
      setHasMoreInteractions(false);
    }

    try {
      const separator = historyUrl.includes('?') ? '&' : '?';
      const response = await fetch(
        `${historyUrl}${separator}limit=100&offset=${offset}`,
        {
          headers: historyToken ? { Authorization: `Bearer ${historyToken}` } : {},
        },
      );
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

  const openHistory = () => {
    setPage('history');
    loadInteractions();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const trimmedInput = userInput.trim();
    if (!batchMode && !trimmedInput) {
      setStatus('error');
      setError('Please enter a request before submitting.');
      setMessage('User input is required.');
      setResult(null);
      return;
    }

    const nextRequestId = requestId || crypto.randomUUID();
    setRequestId(nextRequestId);
    setStatus('loading');
    setIsLoading(true);
    setMessage(
      batchMode
        ? 'Submitting configured batch input to the hosted agent...'
        : 'Submitting request to the hosted agent...',
    );
    setError('');
    setResult(null);

    try {
      const response = await fetch(agentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createRequestBody(trimmedInput, nextRequestId, batchMode)),
      });

      const rawText = await response.text();
      if (!response.ok) {
        const detail = rawText || `Request failed with status ${response.status}.`;
        throw new Error(detail);
      }

      const parsed = normalizeAgentResponse(rawText || '{}');

      if (!parsed || Object.keys(parsed).length === 0) {
        throw new Error('The backend returned an empty response.');
      }

      const finalResult = {
        ...parsed,
        request_id: parsed.request_id || nextRequestId,
      };

      setResult(finalResult);
      setStatus('success');
      setMessage(`Request ${nextRequestId} completed successfully.`);

      setRecentRequests((current) => [
        {
          requestId: nextRequestId,
          summary: finalResult.summary || finalResult.result?.summary || 'Request completed',
          status: finalResult.status || 'completed',
          at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        ...current,
      ].slice(0, 5));
    } catch (fetchError) {
      setStatus('error');
      setError(fetchError.message || 'Unable to contact the hosted agent service.');
      setMessage('The request could not be processed. Please check the backend and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div>
          <div className="brand-mark" aria-hidden="true">H</div>
          <p className="eyebrow">Hosted agents</p>
          <h1>Console</h1>
          <p className="brand-caption">A workspace for your AI operations</p>
        </div>

        <div className="status-card status-card--accent">
          <span className="status-dot" data-status={status} />
          <div>
            <strong>Current status</strong>
            <p>{status === 'success' ? 'Request completed' : status === 'loading' ? 'Processing' : status === 'error' ? 'Attention required' : 'Ready'}</p>
          </div>
        </div>

        <div className="config-stack">
          <label>
            Agent endpoint
            <input value={agentUrl} onChange={(event) => setAgentUrl(event.target.value)} />
          </label>
          <label>
            Persistence endpoint
            <input value={persistUrl} onChange={(event) => setPersistUrl(event.target.value)} />
          </label>
          <label>
            Interaction history endpoint
            <input value={historyUrl} onChange={(event) => setHistoryUrl(event.target.value)} />
          </label>
          <label>
            Persistence API access token
            <input
              type="password"
              autoComplete="off"
              value={historyToken}
              onChange={(event) => setHistoryToken(event.target.value)}
              placeholder="Paste a short-lived Entra token"
            />
          </label>
        </div>

        <nav className="page-navigation" aria-label="Main navigation">
          <button
            type="button"
            className={page === 'workspace' ? 'page-navigation__active' : ''}
            aria-current={page === 'workspace' ? 'page' : undefined}
            onClick={() => setPage('workspace')}
          >
            Request workspace
          </button>
          <button
            type="button"
            className={page === 'history' ? 'page-navigation__active' : ''}
            aria-current={page === 'history' ? 'page' : undefined}
            onClick={openHistory}
          >
            Agent Interaction History
          </button>
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">{page === 'history' ? 'Persistence records' : 'Request workspace'}</p>
            <h2>{page === 'history' ? 'Agent Interaction History' : 'Submit a new hosted agent task'}</h2>
            <p className="page-caption">
              {page === 'history'
                ? 'Review completed interactions retrieved from the Persistence API.'
                : 'Send a task to your agent and review its response.'}
            </p>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                window.localStorage.setItem('hosted-agents-theme', nextTheme);
                setTheme(nextTheme);
              }}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            {page === 'workspace' && <span className="request-pill">ID: {requestLabel}</span>}
          </div>
        </header>

        {page === 'workspace' ? (
          <>
        <form className="request-form" onSubmit={handleSubmit}>
          <label className="batch-mode-toggle">
            <input
              type="checkbox"
              checked={batchMode}
              onChange={(event) => setBatchMode(event.target.checked)}
            />
            Invoke using configured batch input
          </label>
          <p className="field-help" role="status">
            {batchMode
              ? 'Batch mode uses the input file or blob configured on the agent. The user input below will not be sent.'
              : 'Single-request mode sends the user input below to the agent.'}
          </p>

          <label className="field-label" htmlFor="request-id">
            Request ID (optional)
          </label>
          <input
            id="request-id"
            value={requestId}
            onChange={(event) => setRequestId(event.target.value)}
            placeholder="Leave blank to auto-generate"
          />

          <label className="field-label" htmlFor="user-input">
            User request
          </label>
          <textarea
            id="user-input"
            value={userInput}
            onChange={(event) => setUserInput(event.target.value)}
            disabled={batchMode}
            rows={8}
            placeholder={batchMode ? 'Not used for batch processing' : 'Describe the task for the hosted agent'}
          />

          <div className="button-row">
            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Submitting...' : 'Submit request'}
            </button>
            <button type="button" className="secondary" onClick={() => setUserInput('')}>
              Clear
            </button>
          </div>
        </form>

        <section className="feedback-panel" aria-live="polite">
          <div className="feedback-header">
            <strong>Request feedback</strong>
            <span className={`tag tag--${status}`}>{status}</span>
          </div>
          <p>{message}</p>
          {error && <p className="error-message">{error}</p>}
        </section>

        <section className="results-panel">
          <div className="section-heading">
            <h3>Latest result</h3>
          </div>

          {result ? (
            <div className="result-card">
              <div className="result-grid">
                <div>
                  <span className="meta-label">Status</span>
                  <p>{result.status || 'completed'}</p>
                </div>
                <div>
                  <span className="meta-label">Request ID</span>
                  <p>{result.request_id || requestLabel}</p>
                </div>
                <div>
                  <span className="meta-label">Agent</span>
                  <p>{result.agent_name || 'pcr-agent'}</p>
                </div>
                <div>
                  <span className="meta-label">Duration</span>
                  <p>{result.duration_ms ?? 0} ms</p>
                </div>
              </div>

              <div className="result-content">
                <div>
                  <h4>Summary</h4>
                  <p>{result.summary || 'No summary returned.'}</p>
                </div>

                <div>
                  <h4>Structured result</h4>
                  <pre>{JSON.stringify(result.result || result, null, 2)}</pre>
                </div>

                {Array.isArray(result.warnings) && result.warnings.length > 0 && (
                  <div>
                    <h4>Warnings</h4>
                    <ul>
                      {result.warnings.map((warning, index) => (
                        <li key={`${warning}-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">No result has been returned yet.</div>
          )}
        </section>

        <section className="history-panel">
          <div className="section-heading">
            <h3>Recent requests</h3>
          </div>

          {recentRequests.length === 0 ? (
            <p className="empty-state small">Submit a request to begin tracking activity.</p>
          ) : (
            <ul className="history-list">
              {recentRequests.map((item) => (
                <li key={`${item.requestId}-${item.at}`}>
                  <div>
                    <strong>{item.requestId}</strong>
                    <p>{item.summary}</p>
                  </div>
                  <span>{item.status}</span>
                  <time>{item.at}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
          </>
        ) : (
          <section className="interaction-history-panel" aria-live="polite">
            <div className="section-heading">
              <h3>Interactions</h3>
              <button
                type="button"
                className="secondary"
                onClick={() => loadInteractions()}
                disabled={isHistoryLoading}
              >
                {isHistoryLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            {historyError && <p className="error-message">{historyError}</p>}
            {interactions.length === 0 && !isHistoryLoading ? (
              <p className="empty-state">
                {historyError ? 'Interaction history could not be loaded.' : 'No interactions were found.'}
              </p>
            ) : (
              <div className="table-scroll">
                <table className="interaction-table">
                  <thead>
                    <tr>
                      <th scope="col">Request ID</th>
                      <th scope="col">Agent Name</th>
                      <th scope="col">User Input</th>
                      <th scope="col">Agent Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interactions.map((interaction) => (
                      <tr key={interaction.request_id}>
                        <td>{interaction.request_id}</td>
                        <td>{interaction.agent_name}</td>
                        <td>{interaction.user_input}</td>
                        <td>{interaction.agent_response || 'No response recorded.'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {hasMoreInteractions && (
              <button
                type="button"
                className="secondary load-more-button"
                onClick={() => loadInteractions(interactions.length, true)}
                disabled={isHistoryLoading}
              >
                {isHistoryLoading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
