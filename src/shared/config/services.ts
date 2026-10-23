export type ServiceConfig = {
  id: string;
  name: string;
  statusPageUrl: string;
  allowedLinkHosts: string[];
  timeoutMs?: number;
} & (
  | { provider: "statuspage"; summaryUrl: string; scheduledMaintenances?: boolean }
  | {
      provider: "openai-chatgpt";
      summaryUrl: string;
      incidentsUrl: string;
      componentIds: string[];
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
    id: "claude",
    name: "Claude",
    provider: "statuspage",
    summaryUrl: "https://status.claude.com/api/v2/summary.json",
    statusPageUrl: "https://status.claude.com/",
    allowedLinkHosts: ["status.claude.com"],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    provider: "openai-chatgpt",
    summaryUrl: "https://status.openai.com/api/v2/summary.json",
    incidentsUrl: "https://status.openai.com/api/v2/incidents.json",
    statusPageUrl: "https://status.openai.com/",
    allowedLinkHosts: ["status.openai.com"],
    // OpenAI's public component response omits group metadata. These IDs are
    // the components shown under the official page's "ChatGPT" section.
    componentIds: [
      "01JMXBNJXGV1T5GT2M9XA83XNG", // Conversations
      "01JMXBNJXG1S2D9V65P1ZZTD94", // Login
      "01KX45G1SH21AX5DT93D4HMF0P", // ChatGPT Work
      "01KMKFAMWKQ81YWSE1Z18R6VHR", // Codex in ChatGPT Desktop
      "01JNKS9D9S72PMP1938PVFFQN4", // Compliance API
      "01JMXBNJXGKKP51D4DEJ2HZJ8Q", // Search
      "01JMXBNJXG1YMQPPCPCQX3MPA2", // File uploads
      "01JMXBNJXGGT5SR5DB9J7GYY48", // Voice mode
      "01JSFK5QX36ZRW0TW0ZV0ZYFXQ", // GPTs
      "01JQ7EKW990MSPSWVXC7VPV2ZJ", // Image Generation
      "01JSYVYQSWMJ9QG35XHP08BHA7", // Deep Research
      "01JSG1XMJ9RVJJQ0E85NVSJ2AZ", // Agent
      "01M3Q6NERHVE2WPPAQRHBAC6XB", // dots
      "01M3Q6NERHS4BG0HQ85VAR1SRH", // Space
      "01KX45G1SHQQ9DTAX9S4W7FV8G", // Sites
      "01K6TVGGGDCP0PPGCHXAG3AQX8", // Connectors/Apps
    ],
  },
];

export const COLLECTION_TIMEOUT_MS = 8_000;
export const FRESHNESS_WARNING_SECONDS = 180;
export const INCIDENT_HISTORY_RETENTION_DAYS = 7;
export const INCIDENT_HISTORY_DISPLAY_LIMIT = 8;
export const DASHBOARD_POLL_INTERVAL_MS = 60_000;
export const INCIDENTS_PER_SERVICE_LIMIT = 100;
export const PROVIDER_RESPONSE_LIMIT_BYTES = 1_000_000;
// The component cleanup query binds two fixed values alongside each official ID.
export const COMPONENTS_PER_SERVICE_LIMIT = 98;
