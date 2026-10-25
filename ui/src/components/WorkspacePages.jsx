import { ResponsePanel } from './ResponsePanel';

export function HomePage({
  error,
  isLoading,
  lastRunMode,
  message,
  onNavigate,
  onOpenInteractions,
  canReadInteractions,
  onSubmit,
  result,
  status,
  userInput,
  setUserInput,
}) {
  return (
    <section className="page-content home-page">
      <div className="home-workspace">
        <div className="request-workspace">
          <div className="section-heading"><div><p className="eyebrow">DIRECT REQUEST</p></div></div>
          <form className="request-form" onSubmit={onSubmit}>
            <label htmlFor="user-input">Your request</label>
            <textarea id="user-input" value={userInput} onChange={(event) => setUserInput(event.target.value)} rows={6} placeholder="Describe the customer interaction, question, or outcome you need to review…" />
            <div className="form-footer">
              <span>Include the relevant context for the most useful result.</span>
              <button type="submit" disabled={isLoading}>{isLoading ? 'Working…' : 'Submit request'}</button>
            </div>
          </form>
        </div>
        <ResponsePanel
          status={lastRunMode === 'request' ? status : 'idle'}
          message={lastRunMode === 'request' ? message : 'Your agent is ready when you are.'}
          error={lastRunMode === 'request' ? error : ''}
          result={lastRunMode === 'request' ? result : null}
        />
      </div>
      <div className="workspace-shortcuts" aria-label="Additional workspace options">
        <button type="button" className="shortcut-card" onClick={() => onNavigate('batch')}>
          <span className="shortcut-card__icon" aria-hidden="true">↗</span>
          <span><strong>Batch processing</strong><small>Run a configured workload</small></span>
          <span className="shortcut-card__arrow" aria-hidden="true">→</span>
        </button>
        {canReadInteractions && (
          <button type="button" className="shortcut-card" onClick={onOpenInteractions}>
            <span className="shortcut-card__icon shortcut-card__icon--blue" aria-hidden="true">≡</span>
            <span><strong>Agent interactions</strong><small>Review previous requests and results</small></span>
            <span className="shortcut-card__arrow" aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </section>
  );
}

export function BatchPage({ error, isLoading, lastRunMode, message, onSubmit, result, status }) {
  return (
    <section className="page-content">
      <div className="page-heading">
        <p className="eyebrow">BATCH PROCESSING</p>
        <h1>Batch Processing</h1>
        <p>Run and monitor configured batch workloads for your hosted agents.</p>
      </div>
      <form className="batch-card" onSubmit={onSubmit}>
        <div className="batch-card__content">
          <div className="batch-description">
            <span className="batch-icon" aria-hidden="true">↗</span>
            <div><span className="meta-label">CONFIGURED WORKLOAD</span><h2>Configured Batch</h2><p>The hosted agent will read and process its configured input source.</p></div>
          </div>
          <div className="batch-source">
            <span className="batch-source__icon" aria-hidden="true">▤</span>
            <span><strong>Input source</strong><small>Source details are not exposed by the current agent configuration.</small></span>
          </div>
        </div>
        <button type="submit" disabled={isLoading}>{isLoading ? 'Submitting batch…' : 'Start batch'}</button>
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
  );
}
