import {
  InteractionRequiredAuthError,
  PublicClientApplication,
} from '@azure/msal-browser';

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID?.trim();
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID?.trim();
const redirectUri = import.meta.env.VITE_ENTRA_REDIRECT_URI?.trim()
  || `${window.location.origin}/redirect.html`;
const persistenceScope = import.meta.env.VITE_PERSISTENCE_API_SCOPE?.trim();
const hostedAgentScope = import.meta.env.VITE_HOSTED_AGENT_SCOPE?.trim() || persistenceScope;
const agentInvokeAppRole = import.meta.env.VITE_AGENT_INVOKE_APP_ROLE?.trim() || 'Agent.Invoke';
const interactionHistoryReadAppRole = import.meta.env.VITE_INTERACTION_HISTORY_READ_APP_ROLE?.trim()
  || 'InteractionHistory.Read';

export const ApiOperation = Object.freeze({
  AGENT_INVOKE: 'agent_invoke',
  INTERACTION_HISTORY_READ: 'interaction_history_read',
  PCR_ANALYTICS_READ: 'pcr_analytics_read',
  DEMAND_DRIVER_ANALYTICS_READ: 'demand_driver_analytics_read',
  VULNERABILITY_ANALYTICS_READ: 'vulnerability_analytics_read',
});

const operationScopes = {
  [ApiOperation.AGENT_INVOKE]: hostedAgentScope,
  [ApiOperation.INTERACTION_HISTORY_READ]: persistenceScope,
  [ApiOperation.PCR_ANALYTICS_READ]: persistenceScope,
  [ApiOperation.DEMAND_DRIVER_ANALYTICS_READ]: persistenceScope,
  [ApiOperation.VULNERABILITY_ANALYTICS_READ]: persistenceScope,
};

const operationRoles = {
  [ApiOperation.AGENT_INVOKE]: agentInvokeAppRole,
  [ApiOperation.INTERACTION_HISTORY_READ]: interactionHistoryReadAppRole,
  [ApiOperation.PCR_ANALYTICS_READ]: interactionHistoryReadAppRole,
  [ApiOperation.DEMAND_DRIVER_ANALYTICS_READ]: interactionHistoryReadAppRole,
  [ApiOperation.VULNERABILITY_ANALYTICS_READ]: interactionHistoryReadAppRole,
};

export class AuthorizationError extends Error {
  constructor(operation) {
    super('Your account does not have permission for this operation.');
    this.name = 'AuthorizationError';
    this.operation = operation;
  }
}

export const isEntraConfigured = Boolean(
  clientId && tenantId && persistenceScope && hostedAgentScope,
);
export const entraConfigurationKeys = [
  !clientId && 'VITE_ENTRA_CLIENT_ID',
  !tenantId && 'VITE_ENTRA_TENANT_ID',
  !persistenceScope && 'VITE_PERSISTENCE_API_SCOPE',
].filter(Boolean);

const msalInstance = isEntraConfigured
  ? new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri,
    },
    cache: {
      cacheLocation: 'sessionStorage',
    },
  })
  : null;

let initializationPromise;
let interactiveQueue = Promise.resolve();

async function withInteractiveLock(operation) {
  const previous = interactiveQueue;
  let release;
  interactiveQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function initializeEntra() {
  if (!msalInstance) return null;

  initializationPromise ??= msalInstance.initialize().then(() => {
    const account = msalInstance.getActiveAccount()
      || msalInstance.getAllAccounts()[0]
      || null;
    if (account) msalInstance.setActiveAccount(account);
    return account;
  });

  return initializationPromise;
}

export async function signInToEntra() {
  if (!msalInstance || !persistenceScope || !hostedAgentScope) {
    throw new Error('Entra sign-in is not configured for this UI.');
  }

  await initializeEntra();
  return withInteractiveLock(async () => {
    const response = await msalInstance.loginPopup({
      scopes: [...new Set([persistenceScope, hostedAgentScope])],
    });
    msalInstance.setActiveAccount(response.account);
    return response.account;
  });
}

export async function signOutOfEntra() {
  if (!msalInstance) return;

  const account = msalInstance.getActiveAccount();
  await withInteractiveLock(async () => {
    await msalInstance.logoutPopup({ account, postLogoutRedirectUri: redirectUri });
    msalInstance.setActiveAccount(null);
  });
}

export async function getAuthorizationHeaders(operation) {
  const scope = operationScopes[operation];
  if (!scope) {
    throw new Error(`No authorization policy is configured for operation "${operation}".`);
  }
  const accessToken = await acquireToken(scope);
  if (!hasRequiredRole(accessToken, operationRoles[operation])) {
    throw new AuthorizationError(operation);
  }
  return { Authorization: `Bearer ${accessToken}` };
}

export async function getAuthorizedOperations() {
  const operations = await Promise.all(
    Object.values(ApiOperation).map(async (operation) => {
      try {
        await getAuthorizationHeaders(operation);
        return operation;
      } catch (error) {
        if (error instanceof AuthorizationError) return null;
        throw error;
      }
    }),
  );
  return new Set(operations.filter(Boolean));
}

async function acquireToken(scope) {
  if (!msalInstance || !scope) {
    throw new Error('Entra sign-in is not configured for this UI.');
  }

  const account = msalInstance.getActiveAccount() || await initializeEntra();
  if (!account) throw new Error('Sign in with your work account to view interactions.');

  try {
    const response = await msalInstance.acquireTokenSilent({
      account,
      scopes: [scope],
    });
    return response.accessToken;
  } catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error;
    return withInteractiveLock(async () => {
      try {
        const response = await msalInstance.acquireTokenSilent({
          account,
          scopes: [scope],
        });
        return response.accessToken;
      } catch (retryError) {
        if (!(retryError instanceof InteractionRequiredAuthError)) throw retryError;
        const response = await msalInstance.acquireTokenPopup({
          account,
          scopes: [scope],
        });
        return response.accessToken;
      }
    });
  }
}

function hasRequiredRole(accessToken, requiredRole) {
  try {
    const [, encodedClaims] = accessToken.split('.');
    if (!encodedClaims) return false;
    const normalizedClaims = encodedClaims.replace(/-/g, '+').replace(/_/g, '/');
    const paddedClaims = normalizedClaims.padEnd(
      normalizedClaims.length + ((4 - (normalizedClaims.length % 4)) % 4),
      '=',
    );
    const claims = JSON.parse(atob(paddedClaims));
    return Array.isArray(claims.roles) && claims.roles.includes(requiredRole);
  } catch {
    return false;
  }
}
