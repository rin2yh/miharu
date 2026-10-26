import type {
  IncidentEventKind,
  IncidentClosureReason,
  IncidentKind,
  IncidentLifecycle,
  IncidentState,
  NormalizedIncident,
  NormalizedStatus,
} from "./index";
import { stableFallbackId } from "../adapter/id";

export interface IncidentRecord extends NormalizedIncident {
  lifecycle: IncidentLifecycle;
  closureReason: IncidentClosureReason | null;
  serviceId: string;
  componentIdsJson: string;
  componentsJson: string;
  firstSeenAt: string;
  closedDetectedAt: string | null;
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
  closureReason: IncidentClosureReason | null;
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
  // Some public APIs expose only a bounded recent list.
  incidentListComplete = true,
  unverifiedIncidentIds: string[] = [],
): ReconcileResult {
  const previousById = new Map(previous.map((incident) => [incident.id, incident]));
  const incomingIds = new Set<string>();
  const unverifiedIds = new Set(unverifiedIncidentIds);
  const changedIncidents: IncidentRecord[] = [];
  const events: IncidentEventRecord[] = [];

  for (const snapshot of incoming) {
    incomingIds.add(snapshot.id);
    const old = previousById.get(snapshot.id);
    const fingerprint = incidentFingerprint(snapshot);
    const lifecycle: IncidentLifecycle =
      snapshot.state === "resolved"
        ? "closed"
        : unverifiedIds.has(snapshot.id)
          ? "unverified"
          : "active";
    const closureReason: IncidentClosureReason | null =
      lifecycle === "closed" ? "official_resolved" : null;

    if (!old) {
      let record = makeRecord(
        serviceId,
        snapshot,
        lifecycle,
        closureReason,
        detectedAt,
        1,
        fingerprint,
        lifecycle === "closed" ? detectedAt : null,
      );
      if (lifecycle === "unverified") {
        changedIncidents.push(record);
        continue;
      }
      if (lifecycle === "closed" && !incidentListComplete) {
        changedIncidents.push(record);
        continue;
      }
      changedIncidents.push(record);
      events.push(makeEvent(record, "opened", 1, snapshot.officialCreatedAt));
      if (lifecycle === "closed") {
        record = {
          ...record,
          revision: 2,
          closedDetectedAt: detectedAt,
          lastObservedAt: detectedAt,
        };
        changedIncidents[changedIncidents.length - 1] = record;
        events.push(
          makeEvent(record, "resolved", 2, snapshot.officialUpdatedAt, "official_resolved"),
        );
      }
      continue;
    }

    const contentChanged = fingerprint !== old.fingerprint;
    const lifecycleChanged = lifecycle !== old.lifecycle;
    const observationChanged =
      contentChanged ||
      lifecycleChanged ||
      closureReason !== old.closureReason ||
      snapshot.officialCreatedAt !== old.officialCreatedAt ||
      snapshot.officialUpdatedAt !== old.officialUpdatedAt ||
      snapshot.url !== old.url;
    if (!observationChanged) continue;

    const reopened = old.lifecycle === "closed" && lifecycle === "active";
    const officiallyResolved =
      lifecycle === "closed" &&
      closureReason === "official_resolved" &&
      old.closureReason !== "official_resolved";
    const revision =
      old.revision +
      (contentChanged || lifecycleChanged || closureReason !== old.closureReason || reopened
        ? 1
        : 0);
    const record = makeRecord(
      serviceId,
      snapshot,
      lifecycle,
      closureReason,
      old.firstSeenAt,
      revision,
      fingerprint,
      lifecycle === "closed" ? (old.closedDetectedAt ?? detectedAt) : null,
      detectedAt,
    );
    changedIncidents.push(record);

    if (officiallyResolved)
      events.push(
        makeEvent(record, "resolved", revision, snapshot.officialUpdatedAt, "official_resolved"),
      );
    else if (reopened)
      events.push(makeEvent(record, "opened", revision, snapshot.officialCreatedAt));
    else if (contentChanged)
      events.push(makeEvent(record, "updated", revision, snapshot.officialUpdatedAt));
  }

  for (const old of previous) {
    if (old.lifecycle === "closed" || incomingIds.has(old.id)) continue;
    if (unverifiedIds.has(old.id)) {
      if (old.lifecycle !== "unverified") {
        changedIncidents.push({
          ...old,
          lifecycle: "unverified",
          closureReason: null,
          closedDetectedAt: null,
          revision: old.revision + 1,
          lastObservedAt: detectedAt,
        });
      }
      continue;
    }
    if (!incidentListComplete) continue;
    const snapshot: NormalizedIncident = { ...old };
    const revision = old.revision + 1;
    const fingerprint = incidentFingerprint(snapshot);
    const record = makeRecord(
      serviceId,
      snapshot,
      "closed",
      "no_longer_listed",
      old.firstSeenAt,
      revision,
      fingerprint,
      detectedAt,
      detectedAt,
    );
    changedIncidents.push(record);
    events.push(makeEvent(record, "closed", revision, null, "no_longer_listed"));
  }

  return { changedIncidents, events };
}

function makeRecord(
  serviceId: string,
  snapshot: NormalizedIncident,
  lifecycle: IncidentLifecycle,
  closureReason: IncidentClosureReason | null,
  firstSeenAt: string,
  revision: number,
  fingerprint: string,
  closedDetectedAt: string | null = null,
  lastObservedAt = firstSeenAt,
): IncidentRecord {
  return {
    ...snapshot,
    lifecycle,
    closureReason,
    serviceId,
    componentIds: [...snapshot.componentIds],
    componentIdsJson: JSON.stringify(snapshot.componentIds),
    components: [...snapshot.components],
    componentsJson: JSON.stringify(snapshot.components),
    firstSeenAt,
    closedDetectedAt,
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
  closureReason: IncidentClosureReason | null = null,
): IncidentEventRecord {
  return {
    id: JSON.stringify([record.serviceId, record.id, revision]),
    serviceId: record.serviceId,
    incidentId: record.id,
    kind: record.kind,
    eventKind,
    closureReason,
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

export function incidentFingerprint(incident: NormalizedIncident): string {
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
  ]);
}
