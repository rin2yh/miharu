import { describe, expect, it, vi } from "vitest";
import type { IncidentRow } from "../../db/schema";
import type { NormalizedIncident, ProviderSnapshot } from "../domain";
import { SERVICES } from "./config/services";
import { createD1Store, parseComponents } from "./store";

interface PreparedCall {
  sql: string;
  args: unknown[];
  all: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

function createDatabase(
  options: {
    existingIncidents?: IncidentRow[];
    resultsForSql?: (sql: string) => unknown[];
  } = {},
) {
  const calls: PreparedCall[] = [];
  const batches: PreparedCall[][] = [];
  const database = {
    prepare(sql: string) {
      const statement = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          statement.args = args;
          return statement;
        },
        all: vi.fn<() => Promise<{ results: unknown[] }>>(async () => ({
          results: (options.resultsForSql?.(sql) ??
            (sql.includes("FROM incidents\n    WHERE service_id")
              ? (options.existingIncidents ?? [])
              : [])) as unknown[],
        })),
        run: vi.fn<() => Promise<{ success: boolean; meta: { changes: number } }>>(async () => ({
          success: true,
          meta: { changes: 1 },
        })),
      };
      calls.push(statement);
      return statement;
    },
    batch: vi.fn<(statements: PreparedCall[]) => Promise<unknown[]>>(async (statements) => {
      batches.push([...statements]);
      return [];
    }),
  };
  return { database: database as unknown as D1Database, calls, batches };
}

function existingIncidentRow(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    serviceId: "github",
    id: "incident-1",
    title: "Old title",
    body: "Old update",
    kind: "incident",
    state: "investigating",
    sourceStatus: "investigating",
    sourceType: "incident",
    sourceImpact: "major",
    severityStatus: "partial_outage",
    componentIdsJson: '["actions"]',
    componentsJson: '["Actions"]',
    officialCreatedAt: "2026-10-23T04:50:00.000Z",
    officialUpdatedAt: "2026-10-23T04:55:00.000Z",
    url: "https://www.githubstatus.com/incidents/incident-1",
    active: 1,
    firstSeenAt: "2026-10-23T04:50:00.000Z",
    resolvedDetectedAt: null,
    fingerprint: "old-fingerprint",
    revision: 1,
    lastObservedAt: "2026-10-23T05:00:00.000Z",
    ...overrides,
  };
}

function normalizedIncident(overrides: Partial<NormalizedIncident> = {}): NormalizedIncident {
  return {
    id: "incident-1",
    title: "Updated title",
    body: "The service is recovering.",
    kind: "incident",
    state: "monitoring",
    sourceStatus: "monitoring",
    sourceType: "incident",
    sourceImpact: "major",
    severityStatus: "partial_outage",
    componentIds: ["actions"],
    components: ["Actions"],
    officialCreatedAt: "2026-10-23T04:50:00.000Z",
    officialUpdatedAt: "2026-10-23T05:05:00.000Z",
    url: "https://www.githubstatus.com/incidents/incident-1",
    active: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    status: "partial_outage",
    sourceStatus: "major_outage",
    summary: "Partial disruption",
    incidents: [normalizedIncident()],
    ...overrides,
  };
}

describe("D1 store", () => {
  it.each([
    { input: '["api",4,null,"web"]', expected: ["api", "web"] },
    { input: "{}", expected: [] },
    { input: "invalid JSON", expected: [] },
  ])("parses component JSON safely: $input", ({ input, expected }) => {
    expect(parseComponents(input)).toEqual(expected);
  });

  it("records a fetch failure without replacing the previous service status", async () => {
    const mock = createDatabase();
    const store = createD1Store(mock.database);

    await store.saveFailure(SERVICES[2]!, "2026-10-23T05:10:00.000Z", "timeout");

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.sql).toContain("last_error_at = excluded.last_error_at");
    expect(mock.calls[0]?.sql).toContain("last_checked_at <= excluded.last_checked_at");
    expect(mock.calls[0]?.args).toEqual([
      "github",
      "2026-10-23T05:10:00.000Z",
      "2026-10-23T05:10:00.000Z",
      "timeout",
    ]);
    expect(mock.calls[0]?.run).toHaveBeenCalledOnce();
  });

  it("loads all dashboard row groups", async () => {
    const statusRow = { serviceId: "github", status: "operational" };
    const componentRow = { serviceId: "github", id: "actions" };
    const incidentRow = existingIncidentRow();
    const eventRow = { id: "event-1", serviceId: "github", incidentId: "incident-1" };
    const mock = createDatabase({
      resultsForSql(sql) {
        if (sql.includes("FROM service_status")) return [statusRow];
        if (sql.includes("FROM service_components")) return [componentRow];
        if (sql.includes("FROM incidents")) return [incidentRow];
        if (sql.includes("FROM incident_events")) return [eventRow];
        return [];
      },
    });
    const store = createD1Store(mock.database);

    const result = await store.getDashboardRows();

    expect(result).toEqual({
      statusRows: [statusRow],
      componentRows: [componentRow],
      activeRows: [incidentRow],
      eventRows: [eventRow],
    });
    expect(mock.calls).toHaveLength(4);
    expect(mock.calls.every((call) => call.all.mock.calls.length === 1)).toBe(true);
    expect(mock.calls.find((call) => call.sql.includes("FROM incident_events"))?.args).toEqual([8]);
  });

  it("loads active known incidents for a single service", async () => {
    const row = existingIncidentRow();
    const mock = createDatabase({ existingIncidents: [row] });
    const store = createD1Store(mock.database);

    const incidents = await store.getActiveIncidents("github");

    expect(incidents).toMatchObject([
      {
        serviceId: "github",
        id: "incident-1",
        componentIds: ["actions"],
        components: ["Actions"],
        active: true,
        lastObservedAt: row.lastObservedAt,
      },
    ]);
    expect(mock.calls[0]?.sql).toContain("WHERE service_id = ? AND active = 1");
    expect(mock.calls[0]?.args).toEqual(["github"]);
  });

  it("prunes events and resolved incidents older than the retention window", async () => {
    const mock = createDatabase();
    const store = createD1Store(mock.database);

    await store.pruneHistory(new Date("2026-10-24T00:00:00.000Z"));

    expect(mock.batches).toHaveLength(1);
    expect(mock.batches[0]?.map(({ sql }) => sql)).toEqual([
      "DELETE FROM incident_events WHERE detected_at < ?",
      expect.stringContaining("UPDATE incidents SET active = 0"),
      expect.stringContaining("DELETE FROM incidents"),
    ]);
    expect(mock.batches[0]?.map(({ args }) => args)).toEqual([
      ["2026-10-17T00:00:00.000Z"],
      ["recheck_unavailable", "2026-10-17T00:00:00.000Z"],
      ["2026-10-17T00:00:00.000Z", "recheck_unavailable", "2026-10-17T00:00:00.000Z"],
    ]);
  });

  it("updates an incident, records its revision, syncs components, and removes stale components", async () => {
    const mock = createDatabase({ existingIncidents: [existingIncidentRow()] });
    const store = createD1Store(mock.database);

    await store.saveSuccess(
      SERVICES[2]!,
      snapshot({
        components: [
          {
            id: "actions",
            name: "Actions",
            status: "partial_outage",
            sourceStatus: "partial_outage",
          },
        ],
      }),
      "2026-10-23T05:10:00.000Z",
    );

    expect(mock.batches.map((batch) => batch.map(({ sql }) => sql))).toEqual([
      [expect.stringContaining("INSERT INTO service_status")],
      [expect.stringContaining("INSERT INTO service_components")],
      [
        expect.stringContaining("INSERT INTO incidents"),
        expect.stringContaining("INSERT INTO incident_events"),
      ],
    ]);
    const componentCleanup = mock.calls.find((call) =>
      call.sql.includes("DELETE FROM service_components"),
    );
    expect(componentCleanup?.args).toEqual(["github", '["actions"]', "2026-10-23T05:10:00.000Z"]);
    expect(mock.batches[2]?.[0]?.args.slice(0, 3)).toEqual([
      "github",
      "incident-1",
      "Updated title",
    ]);
    expect(mock.batches[2]?.[1]?.args.slice(0, 6)).toEqual([
      '["github","incident-1",2]',
      "github",
      "incident-1",
      "incident",
      "updated",
      "Updated title",
    ]);
  });

  it("splits incident persistence into batches of at most 100 statements", async () => {
    const incidents = Array.from({ length: 51 }, (_, index) =>
      normalizedIncident({ id: `incident-${index}`, title: `Incident ${index}` }),
    );
    const mock = createDatabase();
    const store = createD1Store(mock.database);

    await store.saveSuccess(SERVICES[2]!, snapshot({ incidents }), "2026-10-23T05:10:00.000Z");

    expect(mock.batches.map((batch) => batch.length)).toEqual([1, 100, 2]);
    expect(
      mock.batches.flatMap((batch) => batch).filter(({ sql }) => sql.includes("incident_events")),
    ).toHaveLength(51);
  });
});
