import { useMemo, useState } from 'react';
import { ApiOperation, getAuthorizationHeaders } from '../auth';

export function useInteractions(historyUrl, isAuthenticated) {
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

  const load = async (offset = 0, append = false) => {
    if (!isAuthenticated) {
      setHistoryError('Sign in with your work account to view interactions.');
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
      const response = await fetch(`${historyUrl}${separator}limit=100&offset=${offset}`, {
        headers: await getAuthorizationHeaders(ApiOperation.INTERACTION_HISTORY_READ),
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
    } catch (requestError) {
      setHistoryError(requestError.message || 'Unable to retrieve interaction history.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const reset = () => {
    setInteractions([]);
    setHistoryError('');
    setIsHistoryLoading(false);
    setHasMoreInteractions(false);
    setInteractionSearch('');
    setAgentFilter('');
    setInteractionSort('newest');
  };

  return {
    agentFilter,
    agentNames,
    hasMoreInteractions,
    historyError,
    interactions,
    interactionSearch,
    interactionSort,
    isHistoryLoading,
    load,
    reset,
    setAgentFilter,
    setInteractionSearch,
    setInteractionSort,
    visibleInteractions,
  };
}
