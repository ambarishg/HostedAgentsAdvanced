import { CopyButton } from './CopyButton';

export function ResponsePanel({ status, message, error, result, mode = 'request' }) {
  const resultJson = result ? JSON.stringify(result.result || result, null, 2) : '';
  const title = status === 'success' ? 'Completed'
    : status === 'warning' ? 'Completed with warnings'
      : status === 'error' ? 'Execution failed'
        : status === 'loading' ? mode === 'batch' ? 'Submitting batch' : 'Request in progress'
          : mode === 'batch' ? 'Batch status' : 'Response';

  return (
    <section className="response-panel" aria-live="polite">
      <div className="response-heading">
        <div><p className="eyebrow">{mode === 'batch' ? 'BATCH EXECUTION' : 'AGENT RESPONSE'}</p><h2>{title}</h2></div>
        <span className={`status-indicator status-indicator--${status}`}>{status === 'idle' ? 'Ready' : status === 'loading' ? 'Running' : status}</span>
      </div>
      <p className="response-message">{message}</p>
      {status === 'loading' && <p className="execution-note">Processing is underway. Progress and record counts are not provided by the current agent endpoint.</p>}
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
              <span className="meta-label">PRIMARY CONTACT REASON</span><strong>{result.result.primary_contact_reason}</strong>
              {result.result.demand_driver && <span>Demand driver · {result.result.demand_driver}</span>}
              {result.result.confidence && <span>Confidence · {result.result.confidence}</span>}
            </div>
          )}
          <details className="result-json-details"><summary>View raw response JSON</summary><div className="result-json-toolbar"><CopyButton value={resultJson} label="Copy response" /></div><pre className="result-json-full">{resultJson}</pre></details>
          {Array.isArray(result.warnings) && result.warnings.length > 0 && <ul className="warning-list">{result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
