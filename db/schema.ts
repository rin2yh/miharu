import type {
  IncidentEventKind,
  IncidentKind,
  IncidentLifecycle,
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

export interface ServiceComponentRow {
  serviceId: string;
  id: string;
  name: string;
  status: NormalizedStatus;
  sourceStatus: string;
  lastChangedAt: string;
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
  componentIdsJson: string;
  componentsJson: string;
  officialCreatedAt: string | null;
  officialUpdatedAt: string | null;
  url: string | null;
  lifecycle: IncidentLifecycle;
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
  componentIdsJson: string;
  detectedAt: string;
  officialEventAt: string | null;
  url: string | null;
  body: string | null;
  componentsJson: string;
}

export interface DashboardRows {
  statusRows: ServiceStatusRow[];
  componentRows: ServiceComponentRow[];
  incidentRows: IncidentRow[];
  eventRows: IncidentEventRow[];
}
