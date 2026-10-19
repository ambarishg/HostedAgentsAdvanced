import { useState } from 'react';

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
  const [historyToken, setHistoryToken] = useState('');
  const [page, setPage] = useState('home');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('Your agent is ready when you are.');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [interactions, setInteractions] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [hasMoreInteractions, setHasMoreInteractions] = useState(false);

  const loadInteractions = async (offset = 0, append = false) => {
    setIsHistoryLoading(true);
    setHistoryError('');
    if (!append) {
      setInteractions([]);
      setHasMoreInteractions(false);
    }

    try {
      const separator = historyUrl.includes('?') ? '&' : '?';
      const response = await fetch(`${historyUrl}${separator}limit=100&offset=${offset}`, {
        headers: historyToken ? { Authorization: `Bearer ${historyToken}` } : {},
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
    loadInteractions();
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
            <label>
              History access token
              <input
                type="password"
                autoComplete="off"
                value={historyToken}
                onChange={(event) => setHistoryToken(event.target.value)}
                placeholder="Optional bearer token"
              />
            </label>
          </div>
        </details>
      </header>

      <main className="main-panel">
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
          <section className="page-content">
            <div className="page-heading page-heading--row">
              <div>
                <p className="eyebrow">Agent interactions</p>
                <h1>Interaction history</h1>
                <p>Review requests and results saved by the Persistence API.</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => loadInteractions()}
                disabled={isHistoryLoading}
              >
                {isHistoryLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {historyError && <p className="error-message" role="alert">{historyError}</p>}
            {interactions.length === 0 && !isHistoryLoading ? (
              <p className="empty-state">
                {historyError ? 'Interaction history could not be loaded.' : 'No interactions found yet.'}
              </p>
            ) : (
              <div className="interaction-list">
                {interactions.map((interaction) => (
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
                        <pre>{JSON.stringify(interaction.result_json, null, 2) || 'No result recorded.'}</pre>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
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

export default App;
