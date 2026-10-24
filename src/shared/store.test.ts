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

describe("D1 incident lifecycle persistence", () => {
  it("backfills legacy states and round-trips unverified incidents to the dashboard API", async () => {
    const database = new SqliteD1Adapter();
    database.migrate("db/migrations/0001_initial.sql");
    database.migrate("db/migrations/0002_service_components.sql");
    insertLegacyIncident(database, {
      id: "legacy-active",
      state: "investigating",
      sourceStatus: "investigating",
      active: 1,
    });
    insertLegacyIncident(database, {
      id: "legacy-unverified",
      state: "unknown",
      sourceStatus: "recheck_unavailable",
      active: 0,
    });
    insertLegacyIncident(database, {
      id: "legacy-resolved",
      state: "resolved",
      sourceStatus: "resolved",
      active: 0,
    });
    database.migrate("db/migrations/0003_incident_lifecycle.sql");
    database.migrate("db/migrations/0004_incident_lifecycle_compat_recheck.sql");

    const store = createD1Store(database as unknown as D1Database);
    const known = await store.getUnresolvedIncidents("google-workspace");
    expect(known.map(({ id, lifecycle }) => [id, lifecycle])).toEqual([
      ["legacy-active", "active"],
      ["legacy-unverified", "unverified"],
    ]);
    expect(
      database.sqlite.prepare("SELECT active FROM incidents WHERE id = 'legacy-unverified'").get(),
    ).toMatchObject({ active: 1 });
    await database.prepare("UPDATE incidents SET active = 0 WHERE id = 'legacy-unverified'").run();
    expect(
      database.sqlite
        .prepare("SELECT active, lifecycle FROM incidents WHERE id = 'legacy-unverified'")
        .get(),
    ).toMatchObject({ active: 1, lifecycle: "unverified" });
    await database
      .prepare(
        "UPDATE incidents SET active = 1, state = 'investigating', source_status = 'SERVICE_DISRUPTION' WHERE id = 'legacy-unverified'",
      )
      .run();
    expect(
      database.sqlite
        .prepare("SELECT active, lifecycle FROM incidents WHERE id = 'legacy-unverified'")
        .get(),
    ).toMatchObject({ active: 1, lifecycle: "active" });
    await database
      .prepare(
        "UPDATE incidents SET active = 0, state = 'resolved', source_status = 'resolved' WHERE id = 'legacy-unverified'",
      )
      .run();
    expect(
      database.sqlite
        .prepare("SELECT active, lifecycle FROM incidents WHERE id = 'legacy-unverified'")
        .get(),
    ).toMatchObject({ active: 0, lifecycle: "resolved" });

    const service = SERVICES.find(({ id }) => id === "google-workspace");
    if (!service) throw new Error("Google Workspace service config is missing");
    const incident = {
      id: "new-unverified",
      title: "Workspace API interruption",
      body: "The official history no longer lists the incident.",
      kind: "incident" as const,
      state: "investigating" as const,
      sourceStatus: "SERVICE_DISRUPTION",
      sourceType: "incident",
      sourceImpact: "SERVICE_DISRUPTION",
      severityStatus: "degraded_performance" as const,
      componentIds: [],
      components: [],
      officialCreatedAt: "2026-10-23T04:00:00.000Z",
      officialUpdatedAt: "2026-10-23T04:00:00.000Z",
      url: "https://www.google.com/appsstatus/dashboard/incidents/new-unverified",
      lifecycle: "active" as const,
    };
    const save = (lifecycle: "active" | "unverified"): Promise<void> => {
      const snapshot: ProviderSnapshot = {
        status: "unknown",
        sourceStatus: "no_active_incidents",
        summary: null,
        incidentListComplete: false,
        incidents: [{ ...incident, lifecycle }],
      };
      return store.saveSuccess(service, snapshot, "2026-10-23T05:00:00.000Z");
    };

    await save("active");
    await save("unverified");

    const rows = await store.getDashboardRows();
    const payload = buildDashboardPayload(rows, new Date("2026-10-23T05:01:00.000Z"));
    const workspace = payload.services.find(({ id }) => id === "google-workspace");
    expect(workspace?.incidents.find(({ id }) => id === "new-unverified")).toMatchObject({
      lifecycle: "unverified",
      title: "Workspace API interruption",
    });
    expect(
      database.sqlite
        .prepare(
          "SELECT event_kind AS eventKind FROM incident_events WHERE incident_id = 'new-unverified'",
        )
        .all(),
    ).toEqual([{ eventKind: "opened" }]);
    database.sqlite.close();
  });
});
