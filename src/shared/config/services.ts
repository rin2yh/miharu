export type ServiceConfig = {
  id: string;
  name: string;
  statusPageUrl: string;
  allowedLinkHosts: string[];
  timeoutMs?: number;
} & (
  | {
      provider: "statuspage";
      summaryUrl: string;
      scheduledMaintenances?: boolean;
      componentGroupId?: string;
    }
  | { provider: "slack"; currentUrl: string }
);

// Service changes are intentionally managed in code and take effect on deploy.
export const SERVICES: ServiceConfig[] = [
  {
    id: "slack",
    name: "Slack",
    provider: "slack",
    currentUrl: "https://slack-status.com/api/v2.0.0/current",
    statusPageUrl: "https://slack-status.com/",
    allowedLinkHosts: ["slack-status.com", "www.slack-status.com"],
  },
  {
    id: "notion",
    name: "Notion",
    provider: "statuspage",
    summaryUrl: "https://www.notion-status.com/api/v2/summary.json",
    statusPageUrl: "https://www.notion-status.com/",
    allowedLinkHosts: ["status.notion.so", "www.notion-status.com"],
  },
  {
    id: "github",
    name: "GitHub",
    provider: "statuspage",
    summaryUrl: "https://www.githubstatus.com/api/v2/summary.json",
    scheduledMaintenances: true,
    statusPageUrl: "https://www.githubstatus.com/",
    allowedLinkHosts: ["www.githubstatus.com", "githubstatus.com"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    provider: "statuspage",
    summaryUrl: "https://www.cloudflarestatus.com/api/v2/summary.json",
    componentGroupId: "1km35smx8p41",
    statusPageUrl: "https://www.cloudflarestatus.com/",
    allowedLinkHosts: ["www.cloudflarestatus.com", "cloudflarestatus.com"],
  },
];

export const COLLECTION_TIMEOUT_MS = 8_000;
export const FRESHNESS_WARNING_SECONDS = 180;
export const INCIDENT_HISTORY_RETENTION_DAYS = 7;
export const INCIDENT_HISTORY_DISPLAY_LIMIT = 8;
export const DASHBOARD_POLL_INTERVAL_MS = 60_000;
export const INCIDENTS_PER_SERVICE_LIMIT = 100;
export const PROVIDER_RESPONSE_LIMIT_BYTES = 1_000_000;
// Cloudflare's service group currently has 133 components. Keep a bounded limit
// after provider-specific filtering; store cleanup handles larger ID sets.
export const COMPONENTS_PER_SERVICE_LIMIT = 200;
