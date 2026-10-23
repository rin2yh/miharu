import type {
  IncidentEventKind,
  IncidentKind,
  IncidentState,
  NormalizedStatus,
} from "../src/domain";

export interface ServiceStatusRow {
  serviceId: string;
  status: NormalizedStatus;
  sourceStatus: string | null;
  summary: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  errorCode: string | null;
}

export interface IncidentRow {
  serviceId: string;
  id: string;
  title: string;
  body: string | null;
  kind: IncidentKind;
  state: IncidentState;
  sourceStatus: string;
  sourceType: string | null;
  sourceImpact: string | null;
  severityStatus: NormalizedStatus | null;
  componentsJson: string;
  officialCreatedAt: string | null;
  officialUpdatedAt: string | null;
  url: string | null;
  active: number;
  firstSeenAt: string;
  resolvedDetectedAt: string | null;
  fingerprint: string;
  revision: number;
  lastObservedAt: string;
}

export interface IncidentEventRow {
  id: string;
  serviceId: string;
  incidentId: string;
  title: string;
  kind: IncidentKind;
  eventKind: IncidentEventKind;
  sourceStatus: string;
  severityStatus: NormalizedStatus | null;
  detectedAt: string;
  officialEventAt: string | null;
  url: string | null;
  body: string | null;
  componentsJson: string;
}

export interface DashboardRows {
  statusRows: ServiceStatusRow[];
  activeRows: IncidentRow[];
  eventRows: IncidentEventRow[];
}
