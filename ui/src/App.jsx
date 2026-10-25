import { useEffect, useState } from 'react';
import {
  ApiOperation,
  entraConfigurationKeys,
  getAuthorizedOperations,
  getAuthorizationHeaders,
  initializeEntra,
  isEntraConfigured,
  signInToEntra,
  signOutOfEntra,
} from './auth';
import { AnalyticsWorkspace } from './components/AnalyticsWorkspace';
import { AppHeader } from './components/AppHeader';
import { AuthenticationGate } from './components/AuthenticationGate';
import { InteractionsPage } from './components/InteractionsPage';
import { BatchPage, HomePage } from './components/WorkspacePages';
import { useAgentRequest } from './hooks/useAgentRequest';
import { useInteractions } from './hooks/useInteractions';

const defaultAgentUrl = import.meta.env.VITE_HOSTED_AGENT_URL || '/invocations';
const defaultHistoryUrl = import.meta.env.VITE_PERSISTENCE_HISTORY_URL || '/api/agent-interactions';
const defaultAnalyticsUrl = import.meta.env.VITE_PERSISTENCE_ANALYTICS_URL || '/api/pcr-analytics';
const defaultDemandDriverAnalyticsUrl = import.meta.env.VITE_PERSISTENCE_DEMAND_DRIVER_ANALYTICS_URL || '/api/demand-driver-analytics';
const defaultVulnerabilityAnalyticsUrl = import.meta.env.VITE_PERSISTENCE_VULNERABILITY_ANALYTICS_URL || '/api/vulnerability-analytics';
const pageOperations = {
  home: ApiOperation.AGENT_INVOKE,
  batch: ApiOperation.AGENT_INVOKE,
  interactions: ApiOperation.INTERACTION_HISTORY_READ,
  'pcr-analytics': ApiOperation.PCR_ANALYTICS_READ,
  'demand-driver-analytics': ApiOperation.DEMAND_DRIVER_ANALYTICS_READ,
  'vulnerability-analytics': ApiOperation.VULNERABILITY_ANALYTICS_READ,
};

function App() {
  const [agentUrl, setAgentUrl] = useState(defaultAgentUrl);
  const [historyUrl, setHistoryUrl] = useState(defaultHistoryUrl);
  const [analyticsUrl, setAnalyticsUrl] = useState(defaultAnalyticsUrl);
  const [demandDriverAnalyticsUrl, setDemandDriverAnalyticsUrl] = useState(defaultDemandDriverAnalyticsUrl);
  const [vulnerabilityAnalyticsUrl, setVulnerabilityAnalyticsUrl] = useState(defaultVulnerabilityAnalyticsUrl);
  const [page, setPage] = useState('home');
  const [authAccount, setAuthAccount] = useState(null);
  const [authReady, setAuthReady] = useState(!isEntraConfigured);
  const [authorizationReady, setAuthorizationReady] = useState(!isEntraConfigured);
  const [authorizedOperations, setAuthorizedOperations] = useState(new Set());
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [signOutMessage, setSignOutMessage] = useState('');
  const [analyticsStartDate, setAnalyticsStartDate] = useState('');
  const [analyticsEndDate, setAnalyticsEndDate] = useState('');
  const [selectedContactReasons, setSelectedContactReasons] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [demandDriverAnalyticsStartDate, setDemandDriverAnalyticsStartDate] = useState('');
  const [demandDriverAnalyticsEndDate, setDemandDriverAnalyticsEndDate] = useState('');
  const [selectedDemandDriverCategories, setSelectedDemandDriverCategories] = useState([]);
  const [analyticsTotal, setAnalyticsTotal] = useState(0);
  const [availableContactReasons, setAvailableContactReasons] = useState([]);
  const [analyticsError, setAnalyticsError] = useState('');
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [demandDriverAnalytics, setDemandDriverAnalytics] = useState([]);
  const [demandDriverAnalyticsTotal, setDemandDriverAnalyticsTotal] = useState(0);
  const [availableDemandDriverCategories, setAvailableDemandDriverCategories] = useState([]);
  const [demandDriverAnalyticsError, setDemandDriverAnalyticsError] = useState('');
  const [isDemandDriverAnalyticsLoading, setIsDemandDriverAnalyticsLoading] = useState(false);
  const [vulnerabilityAnalyticsStartDate, setVulnerabilityAnalyticsStartDate] = useState('');
  const [vulnerabilityAnalyticsEndDate, setVulnerabilityAnalyticsEndDate] = useState('');
  const [selectedVulnerabilityCategories, setSelectedVulnerabilityCategories] = useState([]);
  const [availableVulnerabilityCategories, setAvailableVulnerabilityCategories] = useState([]);
  const [vulnerabilityAnalytics, setVulnerabilityAnalytics] = useState([]);
  const [vulnerabilityAnalyticsTotal, setVulnerabilityAnalyticsTotal] = useState(0);
  const [vulnerabilityAnalyticsError, setVulnerabilityAnalyticsError] = useState('');
  const [isVulnerabilityAnalyticsLoading, setIsVulnerabilityAnalyticsLoading] = useState(false);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const {
    error,
    isLoading,
    lastRunMode,
    message,
    reset: resetAgentRequest,
    result,
    setUserInput,
    status,
    submit: handleSubmit,
    userInput,
  } = useAgentRequest(agentUrl);
  const {
    agentFilter,
    agentNames,
    hasMoreInteractions,
    historyError,
    interactions,
    interactionSearch,
    interactionSort,
    isHistoryLoading,
    load: loadInteractions,
    reset: resetInteractions,
    setAgentFilter,
    setInteractionSearch,
    setInteractionSort,
    visibleInteractions,
  } = useInteractions(historyUrl, Boolean(authAccount));

  const isOperationAuthorized = (operation) => authorizedOperations.has(operation);
  const isPageAuthorized = (targetPage) => isOperationAuthorized(pageOperations[targetPage]);
  const defaultAuthorizedPage = (operations) => (
    operations.has(ApiOperation.AGENT_INVOKE) ? 'home' : 'interactions'
  );

  const authorizeAccount = async () => {
    setAuthorizationReady(false);
    try {
      const operations = await getAuthorizedOperations();
      setAuthorizedOperations(operations);
      if (operations.size === 0) {
        setAuthError('Your account does not have permission to access Voice Analytics.');
      }
      return operations;
    } catch (authorizationError) {
      setAuthorizedOperations(new Set());
      setAuthError(
        authorizationError.message || 'Unable to verify your account permissions.',
      );
      return new Set();
    } finally {
      setAuthorizationReady(true);
    }
  };

  useEffect(() => {
    let isMounted = true;
    initializeEntra()
      .then(async (account) => {
        if (!isMounted) return;
        setAuthAccount(account);
        if (account) {
          const operations = await authorizeAccount();
          if (isMounted) setPage(defaultAuthorizedPage(operations));
        } else if (isMounted) {
          setAuthorizationReady(true);
        }
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

  const openInteractions = () => {
    if (!isOperationAuthorized(ApiOperation.INTERACTION_HISTORY_READ)) return;
    setPage('interactions');
    setIsMobileNavigationOpen(false);
    if (authAccount) loadInteractions();
  };

  const loadPcrAnalytics = async (isAuthenticated = Boolean(authAccount)) => {
    if (!isAuthenticated) {
      setAnalyticsError(
        isEntraConfigured
          ? 'Sign in with your work account to view PCR analytics.'
          : `Configure ${entraConfigurationKeys.join(', ')} to enable Microsoft sign-in.`,
      );
      return;
    }

    setIsAnalyticsLoading(true);
    setAnalyticsError('');
    setAnalytics([]);
    setAnalyticsTotal(0);
    try {
      const query = new URLSearchParams();
      if (analyticsStartDate) query.set('start_date', analyticsStartDate);
      if (analyticsEndDate) query.set('end_date', analyticsEndDate);
      if (selectedContactReasons.length) {
        query.set('contact_reasons', selectedContactReasons.join(','));
      }
      const separator = analyticsUrl.includes('?') ? '&' : '?';
      const response = await fetch(`${analyticsUrl}${separator}${query.toString()}`, {
        headers: await getAuthorizationHeaders(ApiOperation.PCR_ANALYTICS_READ),
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `PCR analytics request failed with status ${response.status}.`);
      }

      const payload = JSON.parse(rawText);
      if (!Array.isArray(payload.items) || !Array.isArray(payload.available_reasons)
        || !Number.isInteger(payload.total_count)) {
        throw new Error('The persistence API returned an invalid PCR analytics response.');
      }
      setAnalytics(payload.items);
      setAnalyticsTotal(payload.total_count);
      setAvailableContactReasons(payload.available_reasons);
    } catch (fetchError) {
      setAnalyticsError(fetchError.message || 'Unable to retrieve PCR analytics.');
    } finally {
      setIsAnalyticsLoading(false);
    }
  };

  const openPcrAnalytics = () => {
    if (!isOperationAuthorized(ApiOperation.PCR_ANALYTICS_READ)) return;
    setPage('pcr-analytics');
    if (authAccount) loadPcrAnalytics();
  };

  const loadDemandDriverAnalytics = async (isAuthenticated = Boolean(authAccount)) => {
    if (!isAuthenticated) {
      setDemandDriverAnalyticsError(
        isEntraConfigured
          ? 'Sign in with your work account to view demand driver analytics.'
          : `Configure ${entraConfigurationKeys.join(', ')} to enable Microsoft sign-in.`,
      );
      return;
    }

    setIsDemandDriverAnalyticsLoading(true);
    setDemandDriverAnalyticsError('');
    setDemandDriverAnalytics([]);
    setDemandDriverAnalyticsTotal(0);
    try {
      const query = new URLSearchParams();
      if (demandDriverAnalyticsStartDate) query.set('start_date', demandDriverAnalyticsStartDate);
      if (demandDriverAnalyticsEndDate) query.set('end_date', demandDriverAnalyticsEndDate);
      if (selectedDemandDriverCategories.length) {
        query.set('categories', selectedDemandDriverCategories.join(','));
      }
      const separator = demandDriverAnalyticsUrl.includes('?') ? '&' : '?';
      const response = await fetch(`${demandDriverAnalyticsUrl}${separator}${query.toString()}`, {
        headers: await getAuthorizationHeaders(ApiOperation.DEMAND_DRIVER_ANALYTICS_READ),
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `Demand driver analytics request failed with status ${response.status}.`);
      }

      const payload = JSON.parse(rawText);
      if (!Array.isArray(payload.items) || !Array.isArray(payload.available_categories)
        || !Number.isInteger(payload.total_count)) {
        throw new Error('The persistence API returned an invalid demand driver analytics response.');
      }
      setDemandDriverAnalytics(payload.items);
      setDemandDriverAnalyticsTotal(payload.total_count);
      setAvailableDemandDriverCategories(payload.available_categories);
    } catch (fetchError) {
      setDemandDriverAnalyticsError(fetchError.message || 'Unable to retrieve demand driver analytics.');
    } finally {
      setIsDemandDriverAnalyticsLoading(false);
    }
  };

  const openDemandDriverAnalytics = () => {
    if (!isOperationAuthorized(ApiOperation.DEMAND_DRIVER_ANALYTICS_READ)) return;
    setPage('demand-driver-analytics');
    if (authAccount) loadDemandDriverAnalytics();
  };

  const loadVulnerabilityAnalytics = async (isAuthenticated = Boolean(authAccount)) => {
    if (!isAuthenticated) {
      setVulnerabilityAnalyticsError(
        isEntraConfigured
          ? 'Sign in with your work account to view vulnerability indicator analytics.'
          : `Configure ${entraConfigurationKeys.join(', ')} to enable Microsoft sign-in.`,
      );
      return;
    }

    setIsVulnerabilityAnalyticsLoading(true);
    setVulnerabilityAnalyticsError('');
    setVulnerabilityAnalytics([]);
    setVulnerabilityAnalyticsTotal(0);
    try {
      const query = new URLSearchParams();
      if (vulnerabilityAnalyticsStartDate) query.set('start_date', vulnerabilityAnalyticsStartDate);
      if (vulnerabilityAnalyticsEndDate) query.set('end_date', vulnerabilityAnalyticsEndDate);
      if (selectedVulnerabilityCategories.length) {
        query.set('categories', selectedVulnerabilityCategories.join(','));
      }
      const separator = vulnerabilityAnalyticsUrl.includes('?') ? '&' : '?';
      const response = await fetch(`${vulnerabilityAnalyticsUrl}${separator}${query.toString()}`, {
        headers: await getAuthorizationHeaders(ApiOperation.VULNERABILITY_ANALYTICS_READ),
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `Vulnerability analytics request failed with status ${response.status}.`);
      }

      const payload = JSON.parse(rawText);
      if (!Array.isArray(payload.items) || !Array.isArray(payload.available_categories)
        || !Number.isInteger(payload.total_count)) {
        throw new Error(
          'The vulnerability analytics endpoint has an outdated or invalid response. '
          + 'Expected items, available_categories, and integer total_count; deploy the updated '
          + 'Persistence API and verify the configured endpoint.',
        );
      }
      setVulnerabilityAnalytics(payload.items);
      setVulnerabilityAnalyticsTotal(payload.total_count);
      setAvailableVulnerabilityCategories(payload.available_categories);
    } catch (fetchError) {
      setVulnerabilityAnalyticsError(fetchError.message || 'Unable to retrieve vulnerability analytics.');
    } finally {
      setIsVulnerabilityAnalyticsLoading(false);
    }
  };

  const openVulnerabilityAnalytics = () => {
    if (!isOperationAuthorized(ApiOperation.VULNERABILITY_ANALYTICS_READ)) return;
    setPage('vulnerability-analytics');
    if (authAccount) loadVulnerabilityAnalytics();
  };

  const handleSignIn = async () => {
    setIsAuthBusy(true);
    setAuthError('');
    setSignOutMessage('');
    try {
      const account = await signInToEntra();
      setAuthAccount(account);
      const operations = await authorizeAccount();
      if (operations.size > 0) {
        setPage(defaultAuthorizedPage(operations));
      }
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
      setAuthorizedOperations(new Set());
      setAuthorizationReady(true);
      setPage('home');
      resetAgentRequest();
      resetInteractions();
      setAnalytics([]);
      setAnalyticsTotal(0);
      setAnalyticsError('');
      setDemandDriverAnalytics([]);
      setDemandDriverAnalyticsTotal(0);
      setAvailableDemandDriverCategories([]);
      setDemandDriverAnalyticsError('');
      setVulnerabilityAnalytics([]);
      setVulnerabilityAnalyticsTotal(0);
      setVulnerabilityAnalyticsError('');
      setSignOutMessage('You have been signed out of Voice Analytics and Microsoft Entra ID.');
    } catch (signOutError) {
      setAuthError(signOutError.message || 'Unable to sign out.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const isAgentInteractionPage = ['interactions', 'pcr-analytics', 'demand-driver-analytics', 'vulnerability-analytics'].includes(page);
  const isInteractionNavigationActive = isAgentInteractionPage;
  const navigateTo = (targetPage) => {
    if (!isPageAuthorized(targetPage)) {
      setAuthError('Your account does not have permission to access that page.');
      return;
    }
    setPage(targetPage);
    setIsMobileNavigationOpen(false);
  };
  const analyticsPages = {
    'pcr-analytics': {
      availableCategories: availableContactReasons,
      categoryLabel: 'Contact reasons',
      emptyMessage: 'No PCR results found for these filters.',
      endDate: analyticsEndDate,
      error: analyticsError,
      isLoading: isAnalyticsLoading,
      items: analytics,
      metricLabel: 'Interactions by primary contact reason',
      onApplyFilters: (event) => {
        event.preventDefault();
        loadPcrAnalytics();
      },
      onChangeCategories: (event) => setSelectedContactReasons(
        [...event.target.selectedOptions].map((option) => option.value),
      ),
      onChangeEndDate: (event) => setAnalyticsEndDate(event.target.value),
      onChangeStartDate: (event) => setAnalyticsStartDate(event.target.value),
      onRefresh: () => loadPcrAnalytics(),
      selectedCategories: selectedContactReasons,
      startDate: analyticsStartDate,
      subtitle: 'Explore completed interaction counts by primary contact reason.',
      title: 'Primary Contact Reason Analytics',
      total: analyticsTotal,
      totalLabel: 'interactions',
    },
    'demand-driver-analytics': {
      availableCategories: availableDemandDriverCategories,
      categoryLabel: 'Demand Driver Categories',
      emptyMessage: 'No demand driver results found for these filters.',
      endDate: demandDriverAnalyticsEndDate,
      error: demandDriverAnalyticsError,
      isLoading: isDemandDriverAnalyticsLoading,
      items: demandDriverAnalytics,
      metricLabel: 'Interactions by demand driver',
      onApplyFilters: (event) => {
        event.preventDefault();
        loadDemandDriverAnalytics();
      },
      onChangeCategories: (event) => setSelectedDemandDriverCategories(
        [...event.target.selectedOptions].map((option) => option.value),
      ),
      onChangeEndDate: (event) => setDemandDriverAnalyticsEndDate(event.target.value),
      onChangeStartDate: (event) => setDemandDriverAnalyticsStartDate(event.target.value),
      onRefresh: () => loadDemandDriverAnalytics(),
      selectedCategories: selectedDemandDriverCategories,
      startDate: demandDriverAnalyticsStartDate,
      subtitle: 'Explore completed interaction counts by demand driver.',
      title: 'Demand Driver Analytics',
      total: demandDriverAnalyticsTotal,
      totalLabel: 'interactions',
    },
    'vulnerability-analytics': {
      availableCategories: availableVulnerabilityCategories,
      categoryLabel: 'Vulnerability indicator categories',
      emptyMessage: 'No vulnerability indicator results found for these filters.',
      endDate: vulnerabilityAnalyticsEndDate,
      error: vulnerabilityAnalyticsError,
      isLoading: isVulnerabilityAnalyticsLoading,
      items: vulnerabilityAnalytics,
      metricLabel: 'Indicators by vulnerability category',
      onApplyFilters: (event) => {
        event.preventDefault();
        loadVulnerabilityAnalytics();
      },
      onChangeCategories: (event) => setSelectedVulnerabilityCategories(
        [...event.target.selectedOptions].map((option) => option.value),
      ),
      onChangeEndDate: (event) => setVulnerabilityAnalyticsEndDate(event.target.value),
      onChangeStartDate: (event) => setVulnerabilityAnalyticsStartDate(event.target.value),
      onRefresh: () => loadVulnerabilityAnalytics(),
      selectedCategories: selectedVulnerabilityCategories,
      startDate: vulnerabilityAnalyticsStartDate,
      subtitle: 'Explore completed interaction counts by vulnerability indicator category.',
      title: 'Vulnerability Indicator Analytics',
      total: vulnerabilityAnalyticsTotal,
      totalLabel: 'indicators',
    },
  };
  const analyticsNavigation = {
    onInteractions: openInteractions,
    onAnalytics: openPcrAnalytics,
    onDemandDriverAnalytics: openDemandDriverAnalytics,
    onVulnerabilityAnalytics: openVulnerabilityAnalytics,
  };

  if (!isEntraConfigured || !authReady || !authAccount || !authorizationReady || authorizedOperations.size === 0) {
    return (
      <AuthenticationGate
        authError={authError}
        authReady={authReady}
        authorizationReady={authorizationReady}
        isAuthBusy={isAuthBusy}
        isAuthenticated={Boolean(authAccount)}
        isAuthorized={authorizedOperations.size > 0}
        isConfigured={isEntraConfigured}
        missingConfigurationKeys={entraConfigurationKeys}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        signOutMessage={signOutMessage}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        account={authAccount}
        canInvokeAgent={isOperationAuthorized(ApiOperation.AGENT_INVOKE)}
        canReadInteractions={isOperationAuthorized(ApiOperation.INTERACTION_HISTORY_READ)}
        agentUrl={agentUrl}
        analyticsUrl={analyticsUrl}
        demandDriverAnalyticsUrl={demandDriverAnalyticsUrl}
        historyUrl={historyUrl}
        isInteractionPage={isInteractionNavigationActive}
        isMobileNavigationOpen={isMobileNavigationOpen}
        isSigningOut={isAuthBusy}
        onNavigate={navigateTo}
        onOpenInteractions={openInteractions}
        onSignOut={handleSignOut}
        page={page}
        setAgentUrl={setAgentUrl}
        setAnalyticsUrl={setAnalyticsUrl}
        setDemandDriverAnalyticsUrl={setDemandDriverAnalyticsUrl}
        setHistoryUrl={setHistoryUrl}
        setIsMobileNavigationOpen={setIsMobileNavigationOpen}
        setVulnerabilityAnalyticsUrl={setVulnerabilityAnalyticsUrl}
        vulnerabilityAnalyticsUrl={vulnerabilityAnalyticsUrl}
      />

      <main className={`main-panel${isAgentInteractionPage ? ' main-panel--wide' : ''}`}>
        {authError && !['interactions', 'pcr-analytics', 'demand-driver-analytics', 'vulnerability-analytics'].includes(page) && <p className="error-message" role="alert">{authError}</p>}
        {page === 'home' && isPageAuthorized('home') && (
          <HomePage
            error={error}
            isLoading={isLoading}
            lastRunMode={lastRunMode}
            message={message}
            onNavigate={navigateTo}
            onOpenInteractions={openInteractions}
            canReadInteractions={isOperationAuthorized(ApiOperation.INTERACTION_HISTORY_READ)}
            onSubmit={handleSubmit}
            result={result}
            setUserInput={setUserInput}
            status={status}
            userInput={userInput}
          />
        )}

        {page === 'batch' && isPageAuthorized('batch') && (
          <BatchPage
            error={error}
            isLoading={isLoading}
            lastRunMode={lastRunMode}
            message={message}
            onSubmit={(event) => handleSubmit(event, true)}
            result={result}
            status={status}
          />
        )}

        {page === 'interactions' && isPageAuthorized('interactions') && (
          <InteractionsPage
            agentFilter={agentFilter}
            agentNames={agentNames}
            hasMoreInteractions={hasMoreInteractions}
            historyError={historyError}
            interactions={interactions}
            interactionSearch={interactionSearch}
            interactionSort={interactionSort}
            isHistoryLoading={isHistoryLoading}
            onAnalytics={openPcrAnalytics}
            onDemandDriverAnalytics={openDemandDriverAnalytics}
            onInteractions={openInteractions}
            onLoadMore={() => loadInteractions(interactions.length, true)}
            onRefresh={() => loadInteractions()}
            onVulnerabilityAnalytics={openVulnerabilityAnalytics}
            page={page}
            setAgentFilter={setAgentFilter}
            setInteractionSearch={setInteractionSearch}
            setInteractionSort={setInteractionSort}
            visibleInteractions={visibleInteractions}
          />
        )}
        {analyticsPages[page] && isPageAuthorized(page) && (
          <AnalyticsWorkspace
            analytics={analyticsPages[page]}
            navigation={analyticsNavigation}
            page={page}
          />
        )}
      </main>
    </div>
  );
}

export default App;
