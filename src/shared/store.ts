import type {
  DashboardRows,
  IncidentEventRow,
  IncidentRow,
  ServiceComponentRow,
  ServiceStatusRow,
} from "../../db/schema";
import {
  INCIDENT_HISTORY_DISPLAY_LIMIT,
  INCIDENT_HISTORY_RETENTION_DAYS,
  type ServiceConfig,
} from "./config/services";
import { type KnownIncident, type ProviderSnapshot } from "../domain";
import {
  incidentFingerprint,
  reconcileIncidents,
  type IncidentEventRecord,
  type IncidentRecord,
} from "../domain/reconcile";
import { failureMetadata } from "../domain/failure";

export interface CollectionStore {
  getUnresolvedIncidents(serviceId: string): Promise<KnownIncident[]>;
  saveSuccess(
    service: ServiceConfig,
    snapshot: ProviderSnapshot,
    observedAt: string,
  ): Promise<void>;
  saveFailure(service: ServiceConfig, observedAt: string, errorCode: string): Promise<void>;
}

export interface DashboardStore extends CollectionStore {
  getDashboardRows(): Promise<DashboardRows>;
  pruneHistory(now: Date): Promise<void>;
}

export function createD1Store(database: D1Database): DashboardStore {
  return {
    async getUnresolvedIncidents(serviceId) {
      const result = await database
        .prepare(`
    SELECT
      service_id AS serviceId,
      id,
      title,
      body,
      kind,
      state,
      source_status AS sourceStatus,
      source_type AS sourceType,
      source_impact AS sourceImpact,
      severity_status AS severityStatus,
      component_ids_json AS componentIdsJson,
      components_json AS componentsJson,
      official_created_at AS officialCreatedAt,
      official_updated_at AS officialUpdatedAt,
      url,
      lifecycle,
      first_seen_at AS firstSeenAt,
      resolved_detected_at AS resolvedDetectedAt,
      fingerprint,
      revision,
      last_observed_at AS lastObservedAt
    FROM incidents
        WHERE service_id = ? AND lifecycle IN ('active', 'unverified')
  `)
        .bind(serviceId)
        .all<IncidentRow>();
      return result.results.map(toIncidentRecord);
    },

    async saveSuccess(service, snapshot, observedAt) {
      const existing = await database
        .prepare(`
    SELECT
      service_id AS serviceId,
      id,
      title,
      body,
      kind,
      state,
      source_status AS sourceStatus,
      source_type AS sourceType,
      source_impact AS sourceImpact,
      severity_status AS severityStatus,
      component_ids_json AS componentIdsJson,
      components_json AS componentsJson,
      official_created_at AS officialCreatedAt,
      official_updated_at AS officialUpdatedAt,
      url,
      lifecycle,
      first_seen_at AS firstSeenAt,
      resolved_detected_at AS resolvedDetectedAt,
      fingerprint,
      revision,
      last_observed_at AS lastObservedAt
    FROM incidents
    WHERE service_id = ?
  `)
        .bind(service.id)
        .all<IncidentRow>();
      const reconciled = reconcileIncidents(
        service.id,
        existing.results.map(toIncidentRecord),
        snapshot.incidents,
        observedAt,
        snapshot.incidentListComplete,
      );

      await database.batch([
        database
          .prepare(
            `INSERT INTO service_status (
              service_id, status, source_status, summary, last_checked_at,
              last_success_at, last_error_at, error_code
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
            ON CONFLICT(service_id) DO UPDATE SET
              status = excluded.status,
              source_status = excluded.source_status,
              summary = excluded.summary,
              last_checked_at = excluded.last_checked_at,
              last_success_at = excluded.last_success_at,
              last_error_at = NULL,
              error_code = NULL
            WHERE service_status.last_checked_at IS NULL
              OR service_status.last_checked_at <= excluded.last_checked_at`,
          )
          .bind(
            service.id,
            snapshot.status,
            snapshot.sourceStatus,
            snapshot.summary,
            observedAt,
            observedAt,
          ),
      ]);

      if (snapshot.components !== undefined) {
        await syncComponents(database, service.id, snapshot.components, observedAt);
      }

      const eventsById = new Map(reconciled.events.map((event) => [event.id, event]));
      const groups = reconciled.changedIncidents.map((record) => {
        const eventId = JSON.stringify([record.serviceId, record.id, record.revision]);
        const event = eventsById.get(eventId);
        return [incidentUpsert(database, record), ...(event ? [eventInsert(database, event)] : [])];
      });
      await runBatches(database, groups);
    },

    async saveFailure(service, observedAt, errorCode) {
      const failure = failureMetadata(observedAt, errorCode);
      await database
        .prepare(
          `INSERT INTO service_status (
            service_id, status, last_checked_at, last_error_at, error_code
          ) VALUES (?, 'unknown', ?, ?, ?)
          ON CONFLICT(service_id) DO UPDATE SET
            last_checked_at = excluded.last_checked_at,
            last_error_at = excluded.last_error_at,
            error_code = excluded.error_code
          WHERE service_status.last_checked_at IS NULL
            OR service_status.last_checked_at <= excluded.last_checked_at`,
        )
        .bind(service.id, failure.lastCheckedAt, failure.lastErrorAt, failure.errorCode)
        .run();
    },

    async getDashboardRows() {
      const [statuses, components, incidents, events] = await Promise.all([
        database
          .prepare(
            `SELECT
              service_id AS serviceId, status, source_status AS sourceStatus,
              summary, last_checked_at AS lastCheckedAt, last_success_at AS lastSuccessAt,
              last_error_at AS lastErrorAt, error_code AS errorCode
            FROM service_status`,
          )
          .all<ServiceStatusRow>(),
        database
          .prepare(
            `SELECT
              service_id AS serviceId, id, name, status,
              source_status AS sourceStatus, last_changed_at AS lastChangedAt
            FROM service_components
            ORDER BY service_id, name COLLATE NOCASE, id`,
          )
          .all<ServiceComponentRow>(),
        database
          .prepare(
            `SELECT
              service_id AS serviceId, id, title, body, kind, state,
              source_status AS sourceStatus, source_type AS sourceType,
              source_impact AS sourceImpact, severity_status AS severityStatus,
              component_ids_json AS componentIdsJson, components_json AS componentsJson,
              official_created_at AS officialCreatedAt,
              official_updated_at AS officialUpdatedAt, url, lifecycle,
              first_seen_at AS firstSeenAt, resolved_detected_at AS resolvedDetectedAt,
              fingerprint, revision, last_observed_at AS lastObservedAt
            FROM incidents
            WHERE lifecycle IN ('active', 'unverified')
            ORDER BY service_id, official_created_at DESC`,
          )
          .all<IncidentRow>(),
        database
          .prepare(
            `SELECT
              id, service_id AS serviceId, incident_id AS incidentId, title, body,
              kind, event_kind AS eventKind, source_status AS sourceStatus,
              severity_status AS severityStatus, component_ids_json AS componentIdsJson,
              components_json AS componentsJson,
              detected_at AS detectedAt, official_event_at AS officialEventAt, url
            FROM incident_events
            ORDER BY detected_at DESC
            LIMIT ?`,
          )
          .bind(INCIDENT_HISTORY_DISPLAY_LIMIT)
          .all<IncidentEventRow>(),
      ]);
      return {
        statusRows: statuses.results,
        componentRows: components.results,
        incidentRows: incidents.results,
        eventRows: events.results,
      };
    },

    async pruneHistory(now) {
      const cutoff = new Date(
        now.getTime() - INCIDENT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
      ).toISOString();
      await database.batch([
        database.prepare("DELETE FROM incident_events WHERE detected_at < ?").bind(cutoff),
        database
          .prepare(
            `DELETE FROM incidents
            WHERE lifecycle = 'resolved' AND resolved_detected_at < ?`,
          )
          .bind(cutoff),
      ]);
    },
  };
}

function incidentUpsert(database: D1Database, record: IncidentRecord): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO incidents (
        service_id, id, title, body, kind, state, source_status, source_type,
        source_impact, severity_status, component_ids_json, components_json, official_created_at,
        official_updated_at, url, active, lifecycle, first_seen_at, resolved_detected_at,
        fingerprint, revision, last_observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(service_id, id) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        kind = excluded.kind,
        state = excluded.state,
        source_status = excluded.source_status,
        source_type = excluded.source_type,
        source_impact = excluded.source_impact,
        severity_status = excluded.severity_status,
        component_ids_json = excluded.component_ids_json,
        components_json = excluded.components_json,
        official_created_at = excluded.official_created_at,
        official_updated_at = excluded.official_updated_at,
        url = excluded.url,
        active = excluded.active,
        lifecycle = excluded.lifecycle,
        resolved_detected_at = excluded.resolved_detected_at,
        fingerprint = excluded.fingerprint,
        revision = excluded.revision,
        last_observed_at = excluded.last_observed_at
      WHERE incidents.last_observed_at <= excluded.last_observed_at`,
    )
    .bind(
      record.serviceId,
      record.id,
      record.title,
      record.body,
      record.kind,
      record.state,
      record.sourceStatus,
      record.sourceType,
      record.sourceImpact,
      record.severityStatus,
      record.componentIdsJson,
      record.componentsJson,
      record.officialCreatedAt,
      record.officialUpdatedAt,
      record.url,
      Number(record.lifecycle !== "resolved"),
      record.lifecycle,
      record.firstSeenAt,
      record.resolvedDetectedAt,
      record.fingerprint,
      record.revision,
      record.lastObservedAt,
    );
}

function eventInsert(database: D1Database, event: IncidentEventRecord): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO incident_events (
        id, service_id, incident_id, kind, event_kind, title, body, state,
        source_status, source_type, source_impact, severity_status,
        component_ids_json, components_json, url, official_event_at, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      event.id,
      event.serviceId,
      event.incidentId,
      event.kind,
      event.eventKind,
      event.title,
      event.body,
      event.state,
      event.sourceStatus,
      event.sourceType,
      event.sourceImpact,
      event.severityStatus,
      event.componentIdsJson,
      event.componentsJson,
      event.url,
      event.officialEventAt,
      event.detectedAt,
    );
}

async function runBatches(database: D1Database, groups: D1PreparedStatement[][]): Promise<void> {
  let batch: D1PreparedStatement[] = [];
  for (const group of groups) {
    if (batch.length + group.length > 100) {
      if (batch.length > 0) await database.batch(batch);
      batch = [];
    }
    batch.push(...group);
  }
  if (batch.length > 0) await database.batch(batch);
}

function toIncidentRecord(row: IncidentRow): IncidentRecord {
  const record: IncidentRecord = {
    serviceId: row.serviceId,
    id: row.id,
    title: row.title,
    body: row.body,
    kind: row.kind,
    state: row.state,
    sourceStatus: row.sourceStatus,
    sourceType: row.sourceType,
    sourceImpact: row.sourceImpact,
    severityStatus: row.severityStatus,
    componentIds: parseComponents(row.componentIdsJson),
    componentIdsJson: row.componentIdsJson,
    components: parseComponents(row.componentsJson),
    componentsJson: row.componentsJson,
    officialCreatedAt: row.officialCreatedAt,
    officialUpdatedAt: row.officialUpdatedAt,
    url: row.url,
    lifecycle: row.lifecycle,
    firstSeenAt: row.firstSeenAt,
    resolvedDetectedAt: row.resolvedDetectedAt,
    fingerprint: row.fingerprint,
    revision: row.revision,
    lastObservedAt: row.lastObservedAt,
  };
  return { ...record, fingerprint: incidentFingerprint(record) };
}

async function syncComponents(
  database: D1Database,
  serviceId: string,
  components: NonNullable<ProviderSnapshot["components"]>,
  observedAt: string,
): Promise<void> {
  const upserts = components.map((component) =>
    database
      .prepare(
        `INSERT INTO service_components (
          service_id, id, name, status, source_status, last_changed_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(service_id, id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          source_status = excluded.source_status,
          last_changed_at = excluded.last_changed_at
        WHERE EXISTS (
          SELECT 1 FROM service_status
          WHERE service_id = excluded.service_id
            AND last_checked_at <= excluded.last_changed_at
        )
        AND (
          service_components.name <> excluded.name
          OR service_components.status <> excluded.status
          OR service_components.source_status <> excluded.source_status
        )`,
      )
      .bind(
        serviceId,
        component.id,
        component.name,
        component.status,
        component.sourceStatus,
        observedAt,
      ),
  );
  await runBatches(
    database,
    upserts.map((statement) => [statement]),
  );

  await database
    .prepare(
      `DELETE FROM service_components
      WHERE service_id = ?
        AND id NOT IN (SELECT value FROM json_each(?))
        AND EXISTS (
          SELECT 1 FROM service_status
          WHERE service_id = service_components.service_id
            AND last_checked_at <= ?
        )`,
    )
    .bind(serviceId, JSON.stringify(components.map((component) => component.id)), observedAt)
    .run();
}

export function parseComponents(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
