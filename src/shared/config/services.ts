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
  | {
      provider: "openai-chatgpt";
      summaryUrl: string;
      incidentsUrl: string;
      components: Array<{ id: string; name: string }>;
    }
  | {
      provider: "google-workspace";
      productsUrl: string;
      incidentsUrl: string;
    }
  | {
      provider: "slack";
      currentUrl: string;
      components: Array<{ id: string; name: string }>;
    }
);

// Service changes are intentionally managed in code and take effect on deploy.
export const SERVICES = [
  {
    id: "slack" as const,
    name: "Slack",
    provider: "slack",
    currentUrl: "https://slack-status.com/api/v2.0.0/current",
    statusPageUrl: "https://slack-status.com/",
    allowedLinkHosts: ["slack-status.com", "www.slack-status.com"],
    // Slack's status page lists these feature categories, while its API only
    // reports which categories an active incident affects. See
    // https://docs.slack.dev/reference/slack-status-api/ and https://slack-status.com/.
    components: [
      { id: "login-sso", name: "Login/SSO" },
      { id: "connectivity", name: "Connectivity" },
      { id: "messaging", name: "Messaging" },
      { id: "files", name: "Files" },
      { id: "notifications", name: "Notifications" },
      { id: "huddles", name: "Huddles" },
      { id: "search", name: "Search" },
      { id: "apps-integrations-apis", name: "Apps/Integrations/APIs" },
      { id: "workspace-org-administration", name: "Workspace/Org Administration" },
      { id: "workflows", name: "Workflows" },
      { id: "canvases", name: "Canvases" },
    ],
  },
  {
    id: "notion" as const,
    name: "Notion",
    provider: "statuspage",
    summaryUrl: "https://www.notion-status.com/api/v2/summary.json",
    statusPageUrl: "https://www.notion-status.com/",
    allowedLinkHosts: ["status.notion.so", "www.notion-status.com"],
  },
  {
    id: "github" as const,
    name: "GitHub",
    provider: "statuspage",
    summaryUrl: "https://www.githubstatus.com/api/v2/summary.json",
    scheduledMaintenances: true,
    statusPageUrl: "https://www.githubstatus.com/",
    allowedLinkHosts: ["www.githubstatus.com", "githubstatus.com"],
  },
  {
    id: "cloudflare" as const,
    name: "Cloudflare",
    provider: "statuspage",
    summaryUrl: "https://www.cloudflarestatus.com/api/v2/summary.json",
    componentGroupId: "1km35smx8p41",
    statusPageUrl: "https://www.cloudflarestatus.com/",
    allowedLinkHosts: ["www.cloudflarestatus.com", "cloudflarestatus.com"],
  },
  {
    id: "claude" as const,
    name: "Claude",
    provider: "statuspage",
    summaryUrl: "https://status.claude.com/api/v2/summary.json",
    statusPageUrl: "https://status.claude.com/",
    allowedLinkHosts: ["status.claude.com"],
  },
  {
    id: "chatgpt" as const,
    name: "ChatGPT",
    provider: "openai-chatgpt",
    summaryUrl: "https://status.openai.com/api/v2/summary.json",
    incidentsUrl: "https://status.openai.com/api/v2/incidents.json",
    statusPageUrl: "https://status.openai.com/",
    allowedLinkHosts: ["status.openai.com"],
    // OpenAI's public component response omits group metadata. These IDs are
    // the components shown under the official page's "ChatGPT" section.
    components: [
      { id: "01JMXBNJXGV1T5GT2M9XA83XNG", name: "Conversations" },
      { id: "01JMXBNJXG1S2D9V65P1ZZTD94", name: "Login" },
      { id: "01KX45G1SH21AX5DT93D4HMF0P", name: "ChatGPT Work" },
      { id: "01KMKFAMWKQ81YWSE1Z18R6VHR", name: "Codex in ChatGPT Desktop" },
      { id: "01JNKS9D9S72PMP1938PVFFQN4", name: "Compliance API" },
      { id: "01JMXBNJXGKKP51D4DEJ2HZJ8Q", name: "Search" },
      { id: "01JMXBNJXG1YMQPPCPCQX3MPA2", name: "File uploads" },
      { id: "01JMXBNJXGGT5SR5DB9J7GYY48", name: "Voice mode" },
      { id: "01JSFK5QX36ZRW0TW0ZV0ZYFXQ", name: "GPTs" },
      { id: "01JQ7EKW990MSPSWVXC7VPV2ZJ", name: "Image Generation" },
      { id: "01JSYVYQSWMJ9QG35XHP08BHA7", name: "Deep Research" },
    ],
  },
  {
    id: "google-workspace" as const,
    name: "Google Workspace",
    provider: "google-workspace",
    productsUrl: "https://www.google.com/appsstatus/dashboard/products.json",
    incidentsUrl: "https://www.google.com/appsstatus/dashboard/incidents.json",
    statusPageUrl: "https://www.google.com/appsstatus/dashboard/",
    allowedLinkHosts: ["www.google.com"],
  },
] satisfies ServiceConfig[];

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
