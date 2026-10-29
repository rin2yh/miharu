import { and, asc, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import * as schema from "../../db/schema";
import {
  incidentEvents,
  incidents,
  serviceComponents,
  serviceStatus,
  type DashboardRows,
  type IncidentRow,
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
import { failureMetadata } from "../cron/failure";

type AppDatabase = ReturnType<typeof drizzle<typeof schema, D1Database>>;
type D1BatchQuery = Parameters<AppDatabase["batch"]>[0][number];

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
  getDashboardRows(serviceIds?: readonly string[]): Promise<DashboardRows>;
  pruneHistory(now: Date): Promise<void>;
}

const incidentSelection = {
  serviceId: incidents.serviceId,
  id: incidents.id,
  title: incidents.title,
  body: incidents.body,
  kind: incidents.kind,
  state: incidents.state,
  sourceStatus: incidents.sourceStatus,
  sourceType: incidents.sourceType,
  sourceImpact: incidents.sourceImpact,
  severityStatus: incidents.severityStatus,
  componentIdsJson: incidents.componentIdsJson,
  componentsJson: incidents.componentsJson,
  officialCreatedAt: incidents.officialCreatedAt,
  officialUpdatedAt: incidents.officialUpdatedAt,
  url: incidents.url,
  lifecycle: sql<IncidentRow["lifecycle"]>`CASE WHEN ${incidents.lifecycle} = 'resolved'
    THEN 'closed' ELSE ${incidents.lifecycle} END`,
  closureReason: incidents.closureReason,
  firstSeenAt: incidents.firstSeenAt,
  closedDetectedAt: incidents.resolvedDetectedAt,
  fingerprint: incidents.fingerprint,
  revision: incidents.revision,
  lastObservedAt: incidents.lastObservedAt,
};

export function createD1Store(database: D1Database): DashboardStore {
  const db = drizzle(database, { schema });

  return {
    async getUnresolvedIncidents(serviceId) {
      const rows = await db
        .select(incidentSelection)
        .from(incidents)
        .where(
          and(
            eq(incidents.serviceId, serviceId),
            inArray(incidents.lifecycle, ["active", "unverified"]),
          ),
        )
        .all();
      return rows.map(toIncidentRecord);
    },

    async saveSuccess(service, snapshot, observedAt) {
      const existing = await db
        .select(incidentSelection)
        .from(incidents)
        .where(eq(incidents.serviceId, service.id))
        .all();
      const reconciled = reconcileIncidents(
        service.id,
        existing.map(toIncidentRecord),
        snapshot.incidents,
        observedAt,
        snapshot.incidentListComplete,
        snapshot.unverifiedIncidentIds,
        snapshot.notFoundIncidentIds,
      );

      await db.batch([successStatusUpsert(db, service.id, snapshot, observedAt)]);

      if (snapshot.components !== undefined) {
        await syncComponents(database, service.id, snapshot.components, observedAt);
      }

      const eventsById = new Map(reconciled.events.map((event) => [event.id, event]));
      const groups = reconciled.changedIncidents.map((record) => {
        const eventId = JSON.stringify([record.serviceId, record.id, record.revision]);
        const event = eventsById.get(eventId);
        return [incidentUpsert(db, record), ...(event ? [eventInsert(db, event)] : [])];
      });
      await runDrizzleBatches(db, groups);
    },

    async saveFailure(service, observedAt, errorCode) {
      const failure = failureMetadata(observedAt, errorCode);
      await db.batch([
        db
          .insert(serviceStatus)
          .values({
            serviceId: service.id,
            status: "unknown",
            lastCheckedAt: failure.lastCheckedAt,
            lastErrorAt: failure.lastErrorAt,
            errorCode: failure.errorCode,
          })
          .onConflictDoUpdate({
            target: serviceStatus.serviceId,
            set: {
              lastCheckedAt: sql`excluded.last_checked_at`,
              lastErrorAt: sql`excluded.last_error_at`,
              errorCode: sql`excluded.error_code`,
            },
            setWhere: sql`${serviceStatus.lastCheckedAt} is null
              or ${serviceStatus.lastCheckedAt} < excluded.last_checked_at`,
          }),
      ]);
    },

    async getDashboardRows(serviceIds) {
      const [statusRows, componentRows, incidentRows, eventRows] = await Promise.all([
        db
          .select()
          .from(serviceStatus)
          .where(buildServiceFilter(serviceStatus.serviceId, serviceIds))
          .all(),
        db
          .select()
          .from(serviceComponents)
          .where(buildServiceFilter(serviceComponents.serviceId, serviceIds))
          .orderBy(
            asc(serviceComponents.serviceId),
            sql`${serviceComponents.name} COLLATE NOCASE`,
            asc(serviceComponents.id),
          )
          .all(),
        db
          .select(incidentSelection)
          .from(incidents)
          .where(
            and(
              inArray(incidents.lifecycle, ["active", "unverified"]),
              buildServiceFilter(incidents.serviceId, serviceIds),
            ),
          )
          .orderBy(asc(incidents.serviceId), desc(incidents.officialCreatedAt))
          .all(),
        db
          .select()
          .from(incidentEvents)
          .where(buildServiceFilter(incidentEvents.serviceId, serviceIds))
          .orderBy(desc(incidentEvents.detectedAt))
          .limit(INCIDENT_HISTORY_DISPLAY_LIMIT)
          .all(),
      ]);
      return {
        statusRows,
        componentRows,
        incidentRows,
        eventRows,
      };
    },

    async pruneHistory(now) {
      const cutoff = new Date(
        now.getTime() - INCIDENT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
      ).toISOString();
      await db.batch([
        db.delete(incidentEvents).where(lt(incidentEvents.detectedAt, cutoff)),
        db
          .delete(incidents)
          .where(
            and(eq(incidents.lifecycle, "resolved"), lt(incidents.resolvedDetectedAt, cutoff)),
          ),
      ]);
    },
  };
}

function buildServiceFilter(
  column: AnySQLiteColumn,
  serviceIds: readonly string[] | undefined,
): SQL | undefined {
  if (serviceIds === undefined) return undefined;
  if (serviceIds.length === 0) return sql`1 = 0`;
  return inArray(column, [...serviceIds]);
}

function successStatusUpsert(
  database: AppDatabase,
  serviceId: string,
  snapshot: ProviderSnapshot,
  observedAt: string,
): D1BatchQuery {
  return database
    .insert(serviceStatus)
    .values({
      serviceId,
      status: snapshot.status,
      sourceStatus: snapshot.sourceStatus,
      summary: snapshot.summary,
      lastCheckedAt: observedAt,
      lastSuccessAt: observedAt,
      lastErrorAt: null,
      errorCode: null,
    })
    .onConflictDoUpdate({
      target: serviceStatus.serviceId,
      set: {
        status: sql`excluded.status`,
        sourceStatus: sql`excluded.source_status`,
        summary: sql`excluded.summary`,
        lastCheckedAt: sql`excluded.last_checked_at`,
        lastSuccessAt: sql`excluded.last_success_at`,
        lastErrorAt: null,
        errorCode: null,
      },
      setWhere: sql`${serviceStatus.lastCheckedAt} is null
        or ${serviceStatus.lastCheckedAt} < excluded.last_checked_at`,
    });
}

function incidentUpsert(database: AppDatabase, record: IncidentRecord): D1BatchQuery {
  const values: typeof incidents.$inferInsert = {
    serviceId: record.serviceId,
    id: record.id,
    title: record.title,
    body: record.body,
    kind: record.kind,
    state: record.state,
    sourceStatus: record.sourceStatus,
    sourceType: record.sourceType,
    sourceImpact: record.sourceImpact,
    severityStatus: record.severityStatus,
    componentIdsJson: record.componentIdsJson,
    componentsJson: record.componentsJson,
    officialCreatedAt: record.officialCreatedAt,
    officialUpdatedAt: record.officialUpdatedAt,
    url: record.url,
    active: record.lifecycle !== "closed",
    lifecycle: record.lifecycle === "closed" ? "resolved" : record.lifecycle,
    firstSeenAt: record.firstSeenAt,
    resolvedDetectedAt: record.closedDetectedAt,
    closureReason: record.closureReason,
    recheckUnavailable: record.lifecycle === "unverified",
    fingerprint: record.fingerprint,
    revision: record.revision,
    lastObservedAt: record.lastObservedAt,
  };

  return database
    .insert(incidents)
    .values(values)
    .onConflictDoUpdate({
      target: [incidents.serviceId, incidents.id],
      set: {
        title: values.title,
        body: values.body,
        kind: values.kind,
        state: values.state,
        sourceStatus: values.sourceStatus,
        sourceType: values.sourceType,
        sourceImpact: values.sourceImpact,
        severityStatus: values.severityStatus,
        componentIdsJson: values.componentIdsJson,
        componentsJson: values.componentsJson,
        officialCreatedAt: values.officialCreatedAt,
        officialUpdatedAt: values.officialUpdatedAt,
        url: values.url,
        active: values.active,
        lifecycle: values.lifecycle,
        resolvedDetectedAt: values.resolvedDetectedAt,
        closureReason: values.closureReason,
        recheckUnavailable: values.recheckUnavailable,
        fingerprint: values.fingerprint,
        revision: values.revision,
        lastObservedAt: values.lastObservedAt,
      },
      setWhere: sql`${incidents.lastObservedAt} <= excluded.last_observed_at`,
    });
}

function eventInsert(database: AppDatabase, event: IncidentEventRecord): D1BatchQuery {
  return database
    .insert(incidentEvents)
    .values({
      id: event.id,
      serviceId: event.serviceId,
      incidentId: event.incidentId,
      kind: event.kind,
      eventKind: event.eventKind,
      title: event.title,
      body: event.body,
      state: event.state,
      sourceStatus: event.sourceStatus,
      sourceType: event.sourceType,
      sourceImpact: event.sourceImpact,
      severityStatus: event.severityStatus,
      componentIdsJson: event.componentIdsJson,
      componentsJson: event.componentsJson,
      url: event.url,
      officialEventAt: event.officialEventAt,
      detectedAt: event.detectedAt,
      closureReason: event.closureReason,
    })
    .onConflictDoNothing({ target: incidentEvents.id });
}

async function runDrizzleBatches(database: AppDatabase, groups: D1BatchQuery[][]): Promise<void> {
  let batch: D1BatchQuery[] = [];
  for (const group of groups) {
    if (batch.length + group.length > 100) {
      if (batch.length > 0) await executeDrizzleBatch(database, batch);
      batch = [];
    }
    batch.push(...group);
  }
  if (batch.length > 0) await executeDrizzleBatch(database, batch);
}

async function executeDrizzleBatch(database: AppDatabase, queries: D1BatchQuery[]): Promise<void> {
  if (queries.length === 0) return;
  await database.batch(queries as [D1BatchQuery, ...D1BatchQuery[]]);
}

async function runRawBatches(database: D1Database, groups: D1PreparedStatement[][]): Promise<void> {
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
    closureReason: row.closureReason,
    firstSeenAt: row.firstSeenAt,
    closedDetectedAt: row.closedDetectedAt,
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
  // The freshness guard and json_each cleanup are clearer as SQL with their correlated conditions.
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
  await runRawBatches(
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
