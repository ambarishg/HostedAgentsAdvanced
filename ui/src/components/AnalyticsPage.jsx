export function AnalyticsPage({
  availableCategories,
  categoryLabel,
  emptyMessage,
  isLoading,
  items,
  metricLabel,
  navigation,
  onApplyFilters,
  onChangeEndDate,
  onChangeStartDate,
  onChangeCategories,
  onRefresh,
  selectedCategories,
  startDate,
  endDate,
  subtitle,
  title,
  total,
  totalLabel = 'interactions',
  error,
}) {
  return (
    <section className="page-content interaction-page">
      {navigation}
      <div className="page-heading page-heading--row interaction-heading">
        <div>
          <p className="eyebrow">Agent Interaction</p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="secondary" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <form className="analytics-filters" onSubmit={onApplyFilters}>
        <label>
          Start date
          <input type="date" value={startDate} max={endDate || undefined} onChange={onChangeStartDate} />
        </label>
        <label>
          End date
          <input type="date" value={endDate} min={startDate || undefined} onChange={onChangeEndDate} />
        </label>
        <label className="analytics-reasons">
          {categoryLabel}
          <select multiple size={5} value={selectedCategories} onChange={onChangeCategories}>
            {availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <span className="filter-hint">Use Ctrl or Command to select multiple {categoryLabel.toLowerCase()}.</span>
        </label>
        <button type="submit" disabled={isLoading}>{isLoading ? 'Applying…' : 'Apply filters'}</button>
      </form>
      {isLoading && items.length === 0 ? (
        <p className="empty-state">Loading {metricLabel.toLowerCase()}…</p>
      ) : items.length === 0 ? (
        <p className="empty-state">{error ? `${metricLabel} could not be loaded.` : emptyMessage}</p>
      ) : (
        <section className="analytics-chart" aria-label={`${metricLabel} counts`}>
          <div className="analytics-chart__heading"><h2>{metricLabel}</h2><span>{total} {totalLabel}</span></div>
          <div className="analytics-bars">
            {items.map((item) => (
              <div className="analytics-bar" key={item.reason}>
                <div className="analytics-bar__label"><span>{item.reason}</span><strong>{item.count}</strong></div>
                <div className="analytics-bar__track" role="progressbar" aria-label={`${item.reason}: ${item.count} ${totalLabel}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={item.percentage}>
                  <div className="analytics-bar__fill" style={{ width: `${item.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
