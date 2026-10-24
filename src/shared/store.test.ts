import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { NormalizedIncident, ProviderSnapshot } from "../domain";
import { SERVICES } from "./config/services";
import { createD1Store, parseComponents } from "./store";

const service = SERVICES.find(({ id }) => id === "github");

if (!service) throw new Error("GitHub service configuration is missing");

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

describe("parseComponents", () => {
  it.each([
    { input: '["api",4,null,"web"]', expected: ["api", "web"] },
    { input: "{}", expected: [] },
    { input: "invalid JSON", expected: [] },
  ])("parses component JSON safely: $input", ({ input, expected }) => {
    expect(parseComponents(input)).toEqual(expected);
  });
});

describe("createD1Store with local D1", () => {
  it("persists a successful status, components, incident, and opened event", async () => {
    const store = createD1Store(env.DB);

    await store.saveSuccess(service, snapshot(), "2026-10-01T05:00:00.000Z");

    const statuses = await selectRows(
      `SELECT service_id, status, source_status, summary, last_checked_at,
        last_success_at, last_error_at, error_code FROM service_status`,
    );
    expect(statuses).toEqual([
      {
        service_id: "github",
        status: "partial_outage",
        source_status: "major_outage",
        summary: "Partial disruption",
        last_checked_at: "2026-10-01T05:00:00.000Z",
        last_success_at: "2026-10-01T05:00:00.000Z",
        last_error_at: null,
        error_code: null,
      },
    ]);

    const components = await selectRows(
      `SELECT id, name, status FROM service_components ORDER BY id`,
    );
    expect(components).toEqual([
      { id: "api", name: "API", status: "partial_outage" },
      { id: "web", name: "Web", status: "operational" },
    ]);

    const incidents = await selectRows(
      `SELECT id, title, lifecycle, revision, component_ids_json, components_json
        FROM incidents`,
    );
    expect(incidents).toEqual([
      {
        id: "incident-1",
        title: "API requests are failing",
        lifecycle: "active",
        revision: 1,
        component_ids_json: '["api"]',
        components_json: '["API"]',
      },
    ]);

    const events = await selectRows(
      `SELECT id, event_kind, incident_id, detected_at FROM incident_events`,
    );
    expect(events).toEqual([
      {
        id: '["github","incident-1",1]',
        event_kind: "opened",
        incident_id: "incident-1",
        detected_at: "2026-10-01T05:00:00.000Z",
      },
    ]);
    await expect(store.getDashboardRows()).resolves.toMatchObject({
      statusRows: [
        {
          serviceId: "github",
          status: "partial_outage",
          lastSuccessAt: "2026-10-01T05:00:00.000Z",
        },
      ],
      componentRows: [{ id: "api" }, { id: "web" }],
      incidentRows: [{ id: "incident-1", revision: 1, lifecycle: "active" }],
      eventRows: [{ id: '["github","incident-1",1]', eventKind: "opened" }],
    });
    await expect(store.getUnresolvedIncidents("github")).resolves.toMatchObject([
      { id: "incident-1", revision: 1, componentIds: ["api"], components: ["API"] },
    ]);
  });

  it("increments revision on change and does not add an event for a repeat snapshot", async () => {
    const store = createD1Store(env.DB);
    const original = snapshot();
    const updated = snapshot({
      incidents: [
        incident({
          title: "API requests are recovering",
          body: "The error rate is decreasing.",
          state: "monitoring",
          sourceStatus: "monitoring",
        }),
      ],
    });

    await store.saveSuccess(service, original, "2026-10-01T05:00:00.000Z");
    await store.saveSuccess(service, updated, "2026-10-01T05:01:00.000Z");

    let persisted = await selectRows(
      `SELECT title, revision, last_observed_at FROM incidents WHERE id = 'incident-1'`,
    );
    expect(persisted).toEqual([
      {
        title: "API requests are recovering",
        revision: 2,
        last_observed_at: "2026-10-01T05:01:00.000Z",
      },
    ]);
    await expect(
      selectRows(`SELECT event_kind, id FROM incident_events ORDER BY detected_at`),
    ).resolves.toEqual([
      { event_kind: "opened", id: '["github","incident-1",1]' },
      { event_kind: "updated", id: '["github","incident-1",2]' },
    ]);

    await store.saveSuccess(service, updated, "2026-10-01T05:02:00.000Z");

    persisted = await selectRows(
      `SELECT title, revision, last_observed_at FROM incidents WHERE id = 'incident-1'`,
    );
    expect(persisted).toEqual([
      {
        title: "API requests are recovering",
        revision: 2,
        last_observed_at: "2026-10-01T05:01:00.000Z",
      },
    ]);
    expect(await selectRows(`SELECT id FROM incident_events`)).toHaveLength(2);
  });

  it("preserves the last successful status after a fetch failure", async () => {
    const store = createD1Store(env.DB);

    await store.saveSuccess(service, snapshot(), "2026-10-01T05:00:00.000Z");
    await store.saveFailure(service, "2026-10-01T05:01:00.000Z", "timeout");

    const statuses = await selectRows(
      `SELECT status, source_status, summary, last_checked_at, last_success_at,
        last_error_at, error_code FROM service_status WHERE service_id = 'github'`,
    );
    expect(statuses).toEqual([
      {
        status: "partial_outage",
        source_status: "major_outage",
        summary: "Partial disruption",
        last_checked_at: "2026-10-01T05:01:00.000Z",
        last_success_at: "2026-10-01T05:00:00.000Z",
        last_error_at: "2026-10-01T05:01:00.000Z",
        error_code: "timeout",
      },
    ]);
    expect(await selectRows(`SELECT id FROM service_components`)).toHaveLength(2);
    expect(await selectRows(`SELECT id FROM incidents`)).toHaveLength(1);
  });

  it("queues one alert after three distinct failures and one recovery alert", async () => {
    const store = createD1Store(env.DB);

    await store.saveFailure(service, "2026-10-01T05:00:00.000Z", "timeout", "TimeoutError");
    expect(await selectRows(`SELECT id FROM collection_alert_notifications`)).toEqual([]);
    await store.saveFailure(service, "2026-10-01T05:01:00.000Z", "timeout", "TimeoutError");
    await store.saveFailure(service, "2026-10-01T05:02:00.000Z", "timeout", "TimeoutError");
    await store.saveFailure(service, "2026-10-01T05:02:00.000Z", "timeout", "TimeoutError");
    await store.saveFailure(service, "2026-10-01T05:03:00.000Z", "timeout", "TimeoutError");

    const failures = await store.claimPendingCollectionAlerts(
      "2026-10-01T05:04:00.000Z",
      "2026-10-01T05:09:00.000Z",
      20,
    );
    expect(failures).toMatchObject([
      {
        kind: "failure",
        serviceId: "github",
        errorCode: "timeout",
        errorType: "TimeoutError",
        firstFailedAt: "2026-10-01T05:00:00.000Z",
        failureCount: 3,
        attempts: 1,
      },
    ]);
    await expect(
      store.claimPendingCollectionAlerts(
        "2026-10-01T05:04:00.000Z",
        "2026-10-01T05:09:00.000Z",
        20,
      ),
    ).resolves.toEqual([]);

    await store.releaseCollectionAlert(failures[0]!.id, "2026-10-01T05:06:00.000Z");
    await expect(
      store.claimPendingCollectionAlerts(
        "2026-10-01T05:05:00.000Z",
        "2026-10-01T05:10:00.000Z",
        20,
      ),
    ).resolves.toEqual([]);
    const retry = await store.claimPendingCollectionAlerts(
      "2026-10-01T05:06:00.000Z",
      "2026-10-01T05:11:00.000Z",
      20,
    );
    expect(retry).toMatchObject([{ id: failures[0]!.id, attempts: 2 }]);

    await store.markCollectionAlertDelivered(retry[0]!.id, "2026-10-01T05:06:05.000Z");
    await store.saveSuccess(service, snapshot(), "2026-10-01T05:07:00.000Z");
    await store.saveSuccess(service, snapshot(), "2026-10-01T05:07:00.000Z");

    const recoveries = await store.claimPendingCollectionAlerts(
      "2026-10-01T05:08:00.000Z",
      "2026-10-01T05:13:00.000Z",
      20,
    );
    expect(recoveries).toMatchObject([
      {
        kind: "recovery",
        serviceId: "github",
        firstFailedAt: "2026-10-01T05:00:00.000Z",
        failureCount: 4,
      },
    ]);
    expect(await selectRows(`SELECT service_id FROM collection_failures`)).toEqual([]);
  });

  it("tracks consecutive failures independently for multiple services", async () => {
    const store = createD1Store(env.DB);
    const slack = SERVICES.find(({ id }) => id === "slack");
    if (!slack) throw new Error("Slack service configuration is missing");

    for (const minute of [0, 1, 2]) {
      await Promise.all([
        store.saveFailure(service, `2026-10-01T05:0${minute}:00.000Z`, "timeout", "TimeoutError"),
        store.saveFailure(slack, `2026-10-01T05:0${minute}:00.000Z`, "network_error", "TypeError"),
      ]);
    }

    const alerts = await store.claimPendingCollectionAlerts(
      "2026-10-01T05:03:00.000Z",
      "2026-10-01T05:08:00.000Z",
      20,
    );
    expect(
      alerts.toSorted((left, right) => left.serviceId.localeCompare(right.serviceId)),
    ).toMatchObject([
      { kind: "failure", serviceId: "github", errorCode: "timeout", failureCount: 3 },
      { kind: "failure", serviceId: "slack", errorCode: "network_error", failureCount: 3 },
    ]);
  });

  it("does not count a stale failure that shares a timestamp with a saved success", async () => {
    const store = createD1Store(env.DB);

    await store.saveSuccess(service, snapshot(), "2026-10-01T05:00:00.000Z");
    await store.saveFailure(service, "2026-10-01T05:00:00.000Z", "timeout", "TimeoutError");

    expect(await selectRows(`SELECT service_id FROM collection_failures`)).toEqual([]);
    expect(await selectRows(`SELECT id FROM collection_alert_notifications`)).toEqual([]);
  });

  it("removes stale components and prunes expired resolved incidents and events", async () => {
    const store = createD1Store(env.DB);

    await store.saveSuccess(service, snapshot(), "2026-10-01T05:00:00.000Z");
    await store.saveSuccess(
      service,
      snapshot({ components: [], incidents: [] }),
      "2026-10-03T05:00:00.000Z",
    );

    expect(await selectRows(`SELECT id FROM service_components`)).toEqual([]);
    expect(await selectRows(`SELECT lifecycle, resolved_detected_at FROM incidents`)).toEqual([
      { lifecycle: "resolved", resolved_detected_at: "2026-10-03T05:00:00.000Z" },
    ]);
    expect(await selectRows(`SELECT event_kind FROM incident_events ORDER BY detected_at`)).toEqual(
      [{ event_kind: "opened" }, { event_kind: "resolved" }],
    );

    await store.pruneHistory(new Date("2026-10-12T05:00:00.000Z"));

    expect(await selectRows(`SELECT id FROM incidents`)).toEqual([]);
    expect(await selectRows(`SELECT id FROM incident_events`)).toEqual([]);
  });

  it("persists incidents and events across D1 batch limits", async () => {
    const store = createD1Store(env.DB);
    const incidents = Array.from({ length: 51 }, (_, index) =>
      incident({ id: `incident-${index}`, title: `Incident ${index}` }),
    );

    await store.saveSuccess(service, snapshot({ incidents }), "2026-10-01T05:00:00.000Z");

    expect(await selectRows(`SELECT id FROM incidents`)).toHaveLength(51);
    expect(await selectRows(`SELECT id FROM incident_events`)).toHaveLength(51);
  });
});

async function selectRows<T extends Record<string, unknown>>(query: string): Promise<T[]> {
  const { results } = await env.DB.prepare(query).all<T>();
  return results;
}

function snapshot(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    status: "partial_outage",
    sourceStatus: "major_outage",
    summary: "Partial disruption",
    components: [
      { id: "api", name: "API", status: "partial_outage", sourceStatus: "degraded_performance" },
      { id: "web", name: "Web", status: "operational", sourceStatus: "operational" },
    ],
    incidents: [incident()],
    ...overrides,
  };
}

function incident(overrides: Partial<NormalizedIncident> = {}): NormalizedIncident {
  return {
    id: "incident-1",
    title: "API requests are failing",
    body: "Requests are returning errors.",
    kind: "incident",
    state: "investigating",
    sourceStatus: "investigating",
    sourceType: "incident",
    sourceImpact: "major",
    severityStatus: "partial_outage",
    componentIds: ["api"],
    components: ["API"],
    officialCreatedAt: "2026-10-01T04:55:00.000Z",
    officialUpdatedAt: "2026-10-01T04:55:00.000Z",
    url: "https://www.githubstatus.com/incidents/incident-1",
    lifecycle: "active",
    ...overrides,
  };
}
