import { AnalyticsPage } from './AnalyticsPage';
import { AgentInteractionNavigation } from './InteractionDetails';

export function AnalyticsWorkspace({
  analytics,
  navigation,
  page,
}) {
  return (
    <AnalyticsPage
      {...analytics}
      navigation={(
        <AgentInteractionNavigation
          page={page}
          onInteractions={navigation.onInteractions}
          onAnalytics={navigation.onAnalytics}
          onDemandDriverAnalytics={navigation.onDemandDriverAnalytics}
          onVulnerabilityAnalytics={navigation.onVulnerabilityAnalytics}
        />
      )}
    />
  );
}
