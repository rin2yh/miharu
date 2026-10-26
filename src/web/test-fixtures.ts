import { classifyIncident } from "../domain/incident-category";
import type { DashboardEvent, DashboardPayload, DashboardService } from "../domain";

export const lastSuccessAt = "2026-10-23T05:00:00.000Z";
export const slackLinkName = "Slackの公式ステータスページを新しいタブで開く";
export const githubLinkName = "GitHubの公式ステータスページを新しいタブで開く";
type TestComponent = DashboardService["components"][number];

export function service(overrides: Partial<DashboardService> = {}): DashboardService {
  return {
    id: "github",
    name: "GitHub",
    statusPageUrl: "https://www.githubstatus.com/",
    status: "operational",
    sourceStatus: "none",
    summary: null,
    lastSuccessAt,
    hasFetchError: false,
    isStale: false,
    components: [],
    incidents: [],
    ...overrides,
  };
}

export function incident(overrides: Partial<DashboardService["incidents"][number]> = {}) {
  return {
    id: "incident-1",
    title: "Messaging delays for some users",
    body: "We are investigating.",
    kind: "incident" as const,
    state: "investigating" as const,
    sourceStatus: "investigating",
    sourceType: "incident",
    sourceImpact: "major",
    severityStatus: "partial_outage" as const,
    componentIds: [],
    components: ["Messaging"],
    officialCreatedAt: "2026-10-23T04:50:00.000Z",
    officialUpdatedAt: "2026-10-23T04:55:00.000Z",
    url: "https://www.githubstatus.com/incidents/incident-1",
    lifecycle: "active" as const,
    closureReason: null,
    ...overrides,
    displayCategory: classifyIncident({
      kind: "incident",
      sourceType: "incident",
      sourceImpact: "major",
      ...overrides,
    }),
  };
}

export function component(
  id: string,
  name: string,
  status: TestComponent["status"] = "operational",
): TestComponent {
  return { id, name, status, sourceStatus: status, lastChangedAt: lastSuccessAt };
}

export function payload(
  services: DashboardService[],
  recentEvents: DashboardEvent[] = [],
): DashboardPayload {
  return {
    generatedAt: lastSuccessAt,
    freshnessWarningSeconds: 180,
    services,
    recentEvents,
  };
}

export const basePayload = payload([
  service({
    id: "slack",
    name: "Slack",
    statusPageUrl: "https://slack-status.com/",
    sourceStatus: "ok",
    incidents: [incident()],
  }),
  service(),
]);
