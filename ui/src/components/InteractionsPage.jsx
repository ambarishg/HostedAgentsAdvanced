import {
  AgentInteractionNavigation,
  CopyButton,
  InteractionResult,
} from './InteractionDetails';

export function InteractionsPage({
  agentFilter,
  agentNames,
  hasMoreInteractions,
  historyError,
  interactions,
  interactionSearch,
  interactionSort,
  isHistoryLoading,
  onAnalytics,
  onDemandDriverAnalytics,
  onInteractions,
  onLoadMore,
  onRefresh,
  onVulnerabilityAnalytics,
  page,
  setAgentFilter,
  setInteractionSearch,
  setInteractionSort,
  visibleInteractions,
}) {
  return (
    <section className="page-content interaction-page interaction-page--history">
      <AgentInteractionNavigation
        page={page}
        onInteractions={onInteractions}
        onAnalytics={onAnalytics}
        onDemandDriverAnalytics={onDemandDriverAnalytics}
        onVulnerabilityAnalytics={onVulnerabilityAnalytics}
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
            onClick={onRefresh}
            disabled={isHistoryLoading}
          >
            <span aria-hidden="true">↻</span>
            {isHistoryLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {historyError && <p className="error-message" role="alert">{historyError}</p>}
      <div className="interaction-tools" role="search">
        <label className="interaction-search">
          <span>Search interactions</span>
          <input
            type="search"
            value={interactionSearch}
            onChange={(event) => setInteractionSearch(event.target.value)}
            placeholder="Search request, agent, or result"
          />
        </label>
        <label>
          Filter by agent
          <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
            <option value="">All agents</option>
            {agentNames.map((agentName) => (
              <option key={agentName} value={agentName}>{agentName}</option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select value={interactionSort} onChange={(event) => setInteractionSort(event.target.value)}>
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
      {isHistoryLoading && interactions.length === 0 ? (
        <p className="empty-state">Loading interactions…</p>
      ) : interactions.length === 0 ? (
        <p className="empty-state">
          {historyError ? 'Interaction history could not be loaded.' : 'No interactions found yet.'}
        </p>
      ) : visibleInteractions.length === 0 ? (
        <p className="empty-state">No interactions match these search and filter settings.</p>
      ) : (
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
      )}
      {hasMoreInteractions && (
        <button
          type="button"
          className="secondary load-more-button"
          onClick={onLoadMore}
          disabled={isHistoryLoading}
        >
          {isHistoryLoading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
