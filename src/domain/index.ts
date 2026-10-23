export const NORMALIZED_STATUSES = [
  "operational",
  "degraded_performance",
  "partial_outage",
  "major_outage",
  "under_maintenance",
  "unknown",
] as const;

export type NormalizedStatus = (typeof NORMALIZED_STATUSES)[number];
export type IncidentState =
  | "investigating"
  | "identified"
  | "monitoring"
  | "scheduled"
  | "resolved"
  | "unknown";
export type IncidentKind = "incident" | "maintenance";
export type IncidentEventKind = "opened" | "updated" | "resolved";

export interface NormalizedComponent {
  id: string;
  name: string;
  status: NormalizedStatus;
  sourceStatus: string;
}

export interface NormalizedIncident {
  id: string;
  title: string;
  body: string | null;
  kind: IncidentKind;
  state: IncidentState;
  sourceStatus: string;
  sourceType: string | null;
  sourceImpact: string | null;
  severityStatus: NormalizedStatus | null;
  componentIds: string[];
  components: string[];
  officialCreatedAt: string | null;
  officialUpdatedAt: string | null;
  url: string | null;
  active: boolean;
}

export interface ProviderSnapshot {
  status: NormalizedStatus;
  sourceStatus: string;
  summary: string | null;
  components?: NormalizedComponent[];
  incidents: NormalizedIncident[];
}

export interface DashboardIncident {
  id: string;
  title: string;
  body: string | null;
  kind: IncidentKind;
  state: IncidentState;
  sourceStatus: string;
  sourceType: string | null;
  sourceImpact: string | null;
  severityStatus: NormalizedStatus | null;
  componentIds: string[];
  components: string[];
  officialCreatedAt: string | null;
  officialUpdatedAt: string | null;
  url: string | null;
}

export interface DashboardService {
  id: string;
  name: string;
  statusPageUrl: string;
  status: NormalizedStatus;
  sourceStatus: string | null;
  summary: string | null;
  lastSuccessAt: string | null;
  hasFetchError: boolean;
  isStale: boolean;
  components: DashboardComponent[];
  incidents: DashboardIncident[];
}

export interface DashboardComponent extends NormalizedComponent {
  lastChangedAt: string;
}

export interface DashboardEvent {
  id: string;
  serviceId: string;
  serviceName: string;
  incidentId: string;
  title: string;
  kind: IncidentKind;
  eventKind: IncidentEventKind;
  sourceStatus: string;
  severityStatus: NormalizedStatus | null;
  detectedAt: string;
  officialEventAt: string | null;
  url: string | null;
}

export interface DashboardPayload {
  generatedAt: string;
  freshnessWarningSeconds: number;
  services: DashboardService[];
  recentEvents: DashboardEvent[];
}

export function normalizeStatus(value: unknown): NormalizedStatus {
  if (typeof value !== "string") return "unknown";
  const status = value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  switch (status) {
    case "ok":
    case "none":
    case "operational":
    case "up":
      return "operational";
    case "minor":
    case "degraded":
    case "degraded_performance":
      return "degraded_performance";
    case "major":
    case "partial":
    case "partial_outage":
      return "partial_outage";
    case "critical":
    case "major_outage":
    case "down":
      return "major_outage";
    case "maintenance":
    case "under_maintenance":
      return "under_maintenance";
    default:
      return "unknown";
  }
}
