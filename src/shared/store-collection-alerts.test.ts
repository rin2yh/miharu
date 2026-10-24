import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SERVICES } from "./config/services";
import { createD1Store } from "./store";

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
      all: async <T>() => ({ results: statement.all(...(parameters as never[])) as T[] }),
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

function setupStore() {
  const database = new SqliteD1Adapter();
  for (const migration of [
    "0001_initial.sql",
    "0002_service_components.sql",
    "0003_incident_lifecycle.sql",
    "0004_collection_alerts.sql",
    "0005_collection_alert_error_type.sql",
  ]) {
    database.migrate(`db/migrations/${migration}`);
  }
  return { database, store: createD1Store(database as unknown as D1Database) };
}

const snapshot = {
  status: "operational" as const,
  sourceStatus: "none",
  summary: "All Systems Operational",
  incidents: [],
};

describe("collection alert persistence", () => {
  it("does not count a stale failure that shares a timestamp with a saved success", async () => {
    const { database, store } = setupStore();
    const service = SERVICES.find(({ id }) => id === "slack");
    if (!service) throw new Error("Slack service config is missing");

    await store.saveSuccess(service, snapshot, "2026-10-24T05:00:00.000Z");
    await store.saveFailure(service, "2026-10-24T05:00:00.000Z", "timeout", "TimeoutError");

    expect(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM collection_failures").get(),
    ).toMatchObject({ count: 0 });
  });

  it("queues one alert after three distinct failures and one recovery alert", async () => {
    const { database, store } = setupStore();
    const service = SERVICES.find(({ id }) => id === "slack");
    if (!service) throw new Error("Slack service config is missing");

    await store.saveFailure(service, "2026-10-24T05:00:00.000Z", "timeout", "TimeoutError");
    expect(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM collection_alert_notifications").get(),
    ).toMatchObject({ count: 0 });
    await store.saveFailure(service, "2026-10-24T05:01:00.000Z", "timeout", "TimeoutError");
    await store.saveFailure(service, "2026-10-24T05:02:00.000Z", "timeout", "TimeoutError");
    await store.saveFailure(service, "2026-10-24T05:02:00.000Z", "timeout", "TimeoutError");
    await store.saveFailure(service, "2026-10-24T05:03:00.000Z", "timeout", "TimeoutError");

    const first = await store.claimPendingCollectionAlerts(
      "2026-10-24T05:04:00.000Z",
      "2026-10-24T05:09:00.000Z",
      20,
    );
    expect(first).toMatchObject([
      {
        kind: "failure",
        serviceId: "slack",
        errorCode: "timeout",
        errorType: "TimeoutError",
        firstFailedAt: "2026-10-24T05:00:00.000Z",
        failureCount: 3,
      },
    ]);
    expect(
      await store.claimPendingCollectionAlerts(
        "2026-10-24T05:04:00.000Z",
        "2026-10-24T05:09:00.000Z",
        20,
      ),
    ).toEqual([]);

    await store.markCollectionAlertDelivered(first[0]!.id, "2026-10-24T05:04:05.000Z");
    await store.saveSuccess(service, snapshot, "2026-10-24T05:04:00.000Z");
    await createD1Store(database as unknown as D1Database).saveSuccess(
      service,
      snapshot,
      "2026-10-24T05:04:00.000Z",
    );

    const recovery = await store.claimPendingCollectionAlerts(
      "2026-10-24T05:05:00.000Z",
      "2026-10-24T05:10:00.000Z",
      20,
    );
    expect(recovery).toMatchObject([
      {
        kind: "recovery",
        serviceId: "slack",
        firstFailedAt: "2026-10-24T05:00:00.000Z",
        failureCount: 4,
      },
    ]);
    expect(
      database.sqlite
        .prepare(
          "SELECT consecutive_failures AS count FROM collection_failures WHERE service_id = ?",
        )
        .get("slack"),
    ).toBeUndefined();
  });

  it("tracks concurrent failures independently by service", async () => {
    const { store } = setupStore();
    const services = SERVICES.filter(({ id }) => id === "slack" || id === "github");
    for (const minute of [0, 1, 2]) {
      await Promise.all(
        services.map((service) =>
          store.saveFailure(
            service,
            `2026-10-24T05:0${minute}:00.000Z`,
            service.id === "slack" ? "timeout" : "network_error",
            service.id === "slack" ? "TimeoutError" : "TypeError",
          ),
        ),
      );
    }

    const notifications = await store.claimPendingCollectionAlerts(
      "2026-10-24T05:03:00.000Z",
      "2026-10-24T05:08:00.000Z",
      20,
    );
    expect(
      notifications.toSorted((left, right) => left.serviceId.localeCompare(right.serviceId)),
    ).toMatchObject([
      {
        kind: "failure",
        serviceId: "github",
        errorCode: "network_error",
        errorType: "TypeError",
        failureCount: 3,
      },
      {
        kind: "failure",
        serviceId: "slack",
        errorCode: "timeout",
        errorType: "TimeoutError",
        failureCount: 3,
      },
    ]);
  });
});
