import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../domain";
import { SERVICES } from "./config/services";
import { createD1Store } from "./store";
import { buildDashboardPayload } from "../web/routes/api/status";

class SqliteD1Adapter {
  readonly sqlite = new DatabaseSync(":memory:");

  prepare(sql: string) {
    const statement = this.sqlite.prepare(sql);
    let parameters: unknown[] = [];
    const bound = {
      bind: (...values: unknown[]) => {
        parameters = values;
        return bound;
      },
      all: async <T>() => ({
        results: statement.all(...(parameters as never[])) as T[],
      }),
      run: async () => {
        const result = statement.run(...(parameters as never[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      execute: () => statement.run(...(parameters as never[])),
    };
    return bound;
  }

  async batch(statements: Array<{ execute: () => unknown }>) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  migrate(path: string) {
    this.sqlite.exec(readFileSync(path, "utf8"));
  }
}

function insertLegacyIncident(
  database: SqliteD1Adapter,
  incident: { id: string; state: string; sourceStatus: string; active: number },
) {
  database
    .prepare(
      `INSERT INTO incidents (
        service_id, id, title, body, kind, state, source_status, source_type,
        source_impact, severity_status, component_ids_json, components_json,
        official_created_at, official_updated_at, url, active, first_seen_at,
        resolved_detected_at, fingerprint, revision, last_observed_at
      ) VALUES (?, ?, ?, NULL, 'incident', ?, ?, NULL, NULL, NULL, '[]', '[]',
        NULL, NULL, NULL, ?, '2026-10-23T04:00:00.000Z', NULL, 'old-fingerprint', 1,
        '2026-10-23T04:00:00.000Z')`,
    )
    .bind(
      "google-workspace",
      incident.id,
      incident.id,
      incident.state,
      incident.sourceStatus,
      incident.active,
    )
    .run();
}

function insertLegacyEvent(
  database: SqliteD1Adapter,
  event: { id: string; incidentId: string; eventKind: string; state: string; sourceStatus: string },
) {
  database
    .prepare(
      `INSERT INTO incident_events (
        id, service_id, incident_id, kind, event_kind, title, body, state,
        source_status, source_type, source_impact, severity_status, components_json,
        url, official_event_at, detected_at
      ) VALUES (?, 'google-workspace', ?, 'incident', ?, ?, NULL, ?, ?, NULL, NULL, NULL,
        '[]', NULL, NULL, '2026-10-23T04:00:00.000Z')`,
    )
    .bind(
      event.id,
      event.incidentId,
      event.eventKind,
      event.incidentId,
      event.state,
      event.sourceStatus,
    )
    .run();
}

describe("D1 incident lifecycle migration", () => {
  it("translates legacy Worker writes into explicit tracking closure data", () => {
    const database = new SqliteD1Adapter();
    database.migrate("db/migrations/0001_initial.sql");
    database.migrate("db/migrations/0002_service_components.sql");
    database.migrate("db/migrations/0003_incident_lifecycle.sql");
    database.migrate("db/migrations/0004_incident_tracking_closure.sql");
    insertLegacyEvent(database, {
      id: "compat-opened",
      incidentId: "compat-disappeared",
      eventKind: "opened",
      state: "investigating",
      sourceStatus: "investigating",
    });
    insertLegacyIncident(database, {
      id: "compat-disappeared",
      state: "investigating",
      sourceStatus: "investigating",
      active: 1,
    });

    database
      .prepare(
        `UPDATE incidents SET
          state = 'resolved', source_status = 'not_listed', active = 0,
          lifecycle = 'resolved', resolved_detected_at = '2026-10-23T05:00:00.000Z'
        WHERE id = 'compat-disappeared'`,
      )
      .run();
    insertLegacyEvent(database, {
      id: "compat-closed",
      incidentId: "compat-disappeared",
      eventKind: "resolved",
      state: "resolved",
      sourceStatus: "not_listed",
    });

    expect(
      database.sqlite
        .prepare(
          `SELECT state, source_status AS sourceStatus, lifecycle,
            closure_reason AS closureReason FROM incidents WHERE id = 'compat-disappeared'`,
        )
        .get(),
    ).toEqual({
      state: "investigating",
      sourceStatus: "investigating",
      lifecycle: "resolved",
      closureReason: "no_longer_listed",
    });
    expect(
      database.sqlite
        .prepare(
          `SELECT event_kind AS eventKind, state, source_status AS sourceStatus,
            closure_reason AS closureReason FROM incident_events WHERE id = 'compat-closed'`,
        )
        .get(),
    ).toEqual({
      eventKind: "closed",
      state: "investigating",
      sourceStatus: "investigating",
      closureReason: "no_longer_listed",
    });
    database.sqlite.close();
  });

  it("separates official recovery, list disappearance, official unknown state, and failed rechecks", async () => {
    const database = new SqliteD1Adapter();
    database.migrate("db/migrations/0001_initial.sql");
    database.migrate("db/migrations/0002_service_components.sql");
    insertLegacyEvent(database, {
      id: "missing-opened",
      incidentId: "legacy-missing",
      eventKind: "opened",
      state: "investigating",
      sourceStatus: "investigating",
    });
    insertLegacyEvent(database, {
      id: "missing-resolved",
      incidentId: "legacy-missing",
      eventKind: "resolved",
      state: "resolved",
      sourceStatus: "not_listed",
    });
    insertLegacyEvent(database, {
      id: "recheck-opened",
      incidentId: "legacy-recheck",
      eventKind: "opened",
      state: "investigating",
      sourceStatus: "SERVICE_DISRUPTION",
    });
    insertLegacyIncident(database, {
      id: "legacy-missing",
      state: "resolved",
      sourceStatus: "not_listed",
      active: 0,
    });
    insertLegacyIncident(database, {
      id: "legacy-recheck",
      state: "unknown",
      sourceStatus: "recheck_unavailable",
      active: 1,
    });
    insertLegacyIncident(database, {
      id: "legacy-official-resolved",
      state: "resolved",
      sourceStatus: "resolved",
      active: 0,
    });
    insertLegacyIncident(database, {
      id: "legacy-official-unknown",
      state: "unknown",
      sourceStatus: "future_status",
      active: 1,
    });
    database.migrate("db/migrations/0003_incident_lifecycle.sql");
    database.migrate("db/migrations/0004_incident_tracking_closure.sql");

    const migrated = database.sqlite
      .prepare(
        `SELECT id, state, source_status AS sourceStatus, lifecycle,
          closure_reason AS closureReason, recheck_unavailable AS recheckUnavailable
        FROM incidents ORDER BY id`,
      )
      .all();
    expect(migrated).toEqual([
      {
        id: "legacy-missing",
        state: "investigating",
        sourceStatus: "investigating",
        lifecycle: "resolved",
        closureReason: "no_longer_listed",
        recheckUnavailable: 0,
      },
      {
        id: "legacy-official-resolved",
        state: "resolved",
        sourceStatus: "resolved",
        lifecycle: "resolved",
        closureReason: "official_resolved",
        recheckUnavailable: 0,
      },
      {
        id: "legacy-official-unknown",
        state: "unknown",
        sourceStatus: "future_status",
        lifecycle: "active",
        closureReason: null,
        recheckUnavailable: 0,
      },
      {
        id: "legacy-recheck",
        state: "investigating",
        sourceStatus: "SERVICE_DISRUPTION",
        lifecycle: "unverified",
        closureReason: null,
        recheckUnavailable: 1,
      },
    ]);

    expect(
      database.sqlite
        .prepare(
          "SELECT event_kind AS eventKind, state, source_status AS sourceStatus, closure_reason AS closureReason FROM incident_events WHERE id = 'missing-resolved'",
        )
        .get(),
    ).toEqual({
      eventKind: "closed",
      state: "investigating",
      sourceStatus: "investigating",
      closureReason: "no_longer_listed",
    });

    const store = createD1Store(database as unknown as D1Database);
    const known = await store.getUnresolvedIncidents("google-workspace");
    expect(known.map(({ id, state, lifecycle }) => [id, state, lifecycle])).toEqual([
      ["legacy-official-unknown", "unknown", "active"],
      ["legacy-recheck", "investigating", "unverified"],
    ]);

    const service = SERVICES.find(({ id }) => id === "google-workspace");
    if (!service) throw new Error("Google Workspace service config is missing");
    const unknownIncident = {
      id: "legacy-official-unknown",
      title: "legacy-official-unknown",
      body: null,
      kind: "incident" as const,
      state: "unknown" as const,
      sourceStatus: "future_status",
      sourceType: null,
      sourceImpact: null,
      severityStatus: null,
      componentIds: [],
      components: [],
      officialCreatedAt: null,
      officialUpdatedAt: null,
      url: null,
    };
    const snapshot: ProviderSnapshot = {
      status: "unknown",
      sourceStatus: "future_status",
      summary: null,
      incidents: [unknownIncident],
      incidentListComplete: false,
      unverifiedIncidentIds: ["legacy-recheck"],
    };
    await store.saveSuccess(service, snapshot, "2026-10-23T05:00:00.000Z");

    const rows = await store.getDashboardRows();
    const payload = buildDashboardPayload(rows, new Date("2026-10-23T05:01:00.000Z"));
    const workspace = payload.services.find(({ id }) => id === "google-workspace");
    expect(workspace?.incidents.find(({ id }) => id === "legacy-official-unknown")).toMatchObject({
      state: "unknown",
      sourceStatus: "future_status",
      lifecycle: "active",
      closureReason: null,
    });
    expect(workspace?.incidents.find(({ id }) => id === "legacy-recheck")).toMatchObject({
      state: "investigating",
      sourceStatus: "SERVICE_DISRUPTION",
      lifecycle: "unverified",
      closureReason: null,
    });
    expect(workspace?.incidents.some(({ id }) => id === "legacy-missing")).toBe(false);
    expect(payload.recentEvents.find(({ id }) => id === "missing-resolved")).toMatchObject({
      eventKind: "closed",
      closureReason: "no_longer_listed",
    });
    database.sqlite.close();
  });
});
