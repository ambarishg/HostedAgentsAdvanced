import { useState } from 'react';

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
        Primary Contact Reason
      </button>
      <button
        type="button"
        className={page === 'demand-driver-analytics' ? 'interaction-section-navigation__active' : ''}
        aria-current={page === 'demand-driver-analytics' ? 'page' : undefined}
        onClick={onDemandDriverAnalytics}
      >
        Demand Driver
      </button>
      <button
        type="button"
        className={page === 'vulnerability-analytics' ? 'interaction-section-navigation__active' : ''}
        aria-current={page === 'vulnerability-analytics' ? 'page' : undefined}
        onClick={onVulnerabilityAnalytics}
      >
        Vulnerability Indicator
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


export { AgentInteractionNavigation, ResponsePanel, CopyButton, InteractionResult };
