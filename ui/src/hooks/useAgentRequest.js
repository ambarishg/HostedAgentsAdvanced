import { useState } from 'react';
import { ApiOperation, getAuthorizationHeaders } from '../auth';

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

export function useAgentRequest(agentUrl) {
  const [userInput, setUserInput] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('Your agent is ready when you are.');
  const [lastRunMode, setLastRunMode] = useState('request');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const submit = async (event, batchMode = false) => {
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
    setMessage(batchMode ? 'Processing the configured batch input…' : 'Sending your request to the agent…');
    setError('');
    setResult(null);

    try {
      const response = await fetch(agentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...await getAuthorizationHeaders(ApiOperation.AGENT_INVOKE),
        },
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
      const completedWithWarnings = Array.isArray(finalResult.warnings)
        && finalResult.warnings.length > 0;

      setResult(finalResult);
      setStatus(completedWithWarnings ? 'warning' : 'success');
      setMessage(completedWithWarnings
        ? `The ${batchMode ? 'batch' : 'request'} completed with warnings.`
        : batchMode ? 'The configured batch completed.' : 'Your request is complete.');
    } catch (requestError) {
      setStatus('error');
      setError(requestError.message || 'Unable to contact the hosted agent service.');
      setMessage('The request could not be processed. Check the service and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setUserInput('');
    setStatus('idle');
    setMessage('Your agent is ready when you are.');
    setLastRunMode('request');
    setIsLoading(false);
    setResult(null);
    setError('');
  };

  return {
    error,
    isLoading,
    lastRunMode,
    message,
    reset,
    result,
    setUserInput,
    status,
    submit,
    userInput,
  };
}
