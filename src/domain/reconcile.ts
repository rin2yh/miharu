import type {
  IncidentEventKind,
  IncidentKind,
  IncidentState,
  NormalizedIncident,
  NormalizedStatus,
} from "./index";
import { stableFallbackId } from "./id";

export interface IncidentRecord extends NormalizedIncident {
  serviceId: string;
  componentIdsJson: string;
  componentsJson: string;
  firstSeenAt: string;
  resolvedDetectedAt: string | null;
  fingerprint: string;
  revision: number;
  lastObservedAt: string;
}

export interface IncidentEventRecord {
  id: string;
  serviceId: string;
  incidentId: string;
  kind: IncidentKind;
  eventKind: IncidentEventKind;
  title: string;
  body: string | null;
  state: IncidentState;
  sourceStatus: string;
  sourceType: string | null;
  sourceImpact: string | null;
  severityStatus: NormalizedStatus | null;
  componentIdsJson: string;
  componentsJson: string;
  url: string | null;
  officialEventAt: string | null;
  detectedAt: string;
}

export interface ReconcileResult {
  changedIncidents: IncidentRecord[];
  events: IncidentEventRecord[];
}

export function reconcileIncidents(
  serviceId: string,
  previous: IncidentRecord[],
  incoming: NormalizedIncident[],
  detectedAt: string,
): ReconcileResult {
  const previousById = new Map(previous.map((incident) => [incident.id, incident]));
  const incomingIds = new Set<string>();
  const changedIncidents: IncidentRecord[] = [];
  const events: IncidentEventRecord[] = [];

  for (const snapshot of incoming) {
    incomingIds.add(snapshot.id);
    const old = previousById.get(snapshot.id);
    const fingerprint = incidentFingerprint(snapshot);

    if (!old) {
      let record = makeRecord(serviceId, snapshot, detectedAt, 1, fingerprint);
      changedIncidents.push(record);
      events.push(makeEvent(record, "opened", 1, snapshot.officialCreatedAt));
      if (!snapshot.active) {
        record = {
          ...record,
          revision: 2,
          resolvedDetectedAt: detectedAt,
          lastObservedAt: detectedAt,
        };
        changedIncidents[changedIncidents.length - 1] = record;
        events.push(makeEvent(record, "resolved", 2, snapshot.officialUpdatedAt));
      }
      continue;
    }

    const contentChanged = fingerprint !== old.fingerprint;
    const observationChanged =
      contentChanged ||
      snapshot.officialCreatedAt !== old.officialCreatedAt ||
      snapshot.officialUpdatedAt !== old.officialUpdatedAt ||
      snapshot.url !== old.url;
    if (!observationChanged) continue;

    const reopened = !old.active && snapshot.active;
    const resolved = old.active && !snapshot.active;
    const revision = old.revision + (contentChanged || reopened || resolved ? 1 : 0);
    const record = makeRecord(
      serviceId,
      snapshot,
      old.firstSeenAt,
      revision,
      fingerprint,
      snapshot.active ? null : (old.resolvedDetectedAt ?? detectedAt),
      detectedAt,
    );
    changedIncidents.push(record);

    if (resolved) events.push(makeEvent(record, "resolved", revision, snapshot.officialUpdatedAt));
    else if (reopened)
      events.push(makeEvent(record, "opened", revision, snapshot.officialCreatedAt));
    else if (contentChanged)
      events.push(makeEvent(record, "updated", revision, snapshot.officialUpdatedAt));
  }

  for (const old of previous) {
    if (!old.active || incomingIds.has(old.id)) continue;
    const snapshot: NormalizedIncident = {
      ...old,
      active: false,
      state: "resolved",
      sourceStatus: "not_listed",
    };
    const revision = old.revision + 1;
    const fingerprint = incidentFingerprint(snapshot);
    const record = makeRecord(
      serviceId,
      snapshot,
      old.firstSeenAt,
      revision,
      fingerprint,
      detectedAt,
      detectedAt,
    );
    changedIncidents.push(record);
    events.push(makeEvent(record, "resolved", revision, null));
  }

  return { changedIncidents, events };
}

function makeRecord(
  serviceId: string,
  snapshot: NormalizedIncident,
  firstSeenAt: string,
  revision: number,
  fingerprint: string,
  resolvedDetectedAt: string | null = null,
  lastObservedAt = firstSeenAt,
): IncidentRecord {
  return {
    ...snapshot,
    serviceId,
    componentIds: [...snapshot.componentIds],
    componentIdsJson: JSON.stringify(snapshot.componentIds),
    components: [...snapshot.components],
    componentsJson: JSON.stringify(snapshot.components),
    firstSeenAt,
    resolvedDetectedAt,
    fingerprint,
    revision,
    lastObservedAt,
  };
}

function makeEvent(
  record: IncidentRecord,
  eventKind: IncidentEventKind,
  revision: number,
  officialEventAt: string | null,
): IncidentEventRecord {
  return {
    id: JSON.stringify([record.serviceId, record.id, revision]),
    serviceId: record.serviceId,
    incidentId: record.id,
    kind: record.kind,
    eventKind,
    title: record.title,
    body: record.body,
    state: record.state,
    sourceStatus: record.sourceStatus,
    sourceType: record.sourceType,
    sourceImpact: record.sourceImpact,
    severityStatus: record.severityStatus,
    componentIdsJson: record.componentIdsJson,
    componentsJson: record.componentsJson,
    url: record.url,
    officialEventAt,
    detectedAt: record.lastObservedAt,
  };
}

function incidentFingerprint(incident: NormalizedIncident): string {
  return stableFallbackId("incident-content", [
    incident.title,
    incident.body,
    incident.kind,
    incident.state,
    incident.sourceStatus,
    incident.sourceType,
    incident.sourceImpact,
    incident.severityStatus,
    [...incident.componentIds].toSorted().join("\u001e"),
    [...incident.components].toSorted().join("\u001e"),
    String(incident.active),
  ]);
}
