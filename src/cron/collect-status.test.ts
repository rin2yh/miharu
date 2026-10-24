import { describe, expect, it, vi } from "vitest";
import type {
  CollectionAlertState,
  CollectionAlertStateStore,
} from "../shared/collection-alert-state";
import type { ProviderSnapshot } from "../domain";
import type { CollectionStore } from "../shared/store";
import { SERVICES } from "../shared/config/services";
import type { CollectionAlertSender } from "./collection-alerts";
import { collectAtScheduledTime } from "./collect-status";

const service = SERVICES.find(({ id }) => id === "slack");
if (!service) throw new Error("Slack service config is missing");

const snapshot: ProviderSnapshot = {
  status: "operational",
  sourceStatus: "none",
  summary: "All Systems Operational",
  incidents: [],
};

const failFetcher = async (): Promise<ProviderSnapshot> => {
  throw new Error("upstream unavailable");
};

function collectionStore(
  overrides: Partial<CollectionStore> & { pruneHistory?: () => Promise<void> } = {},
) {
  return {
    getUnresolvedIncidents: vi.fn<CollectionStore["getUnresolvedIncidents"]>(async () => []),
    saveSuccess: vi.fn<CollectionStore["saveSuccess"]>(async () => undefined),
    saveFailure: vi.fn<CollectionStore["saveFailure"]>(async () => undefined),
    pruneHistory: vi.fn<(now: Date) => Promise<void>>(async () => undefined),
    ...overrides,
  };
}

function alertStateStore() {
  const states = new Map<string, CollectionAlertState>();
  return {
    states,
    get: vi.fn<CollectionAlertStateStore["get"]>(
      async (serviceId) => states.get(serviceId) ?? null,
    ),
    put: vi.fn<CollectionAlertStateStore["put"]>(async (serviceId, state) => {
      states.set(serviceId, state);
    }),
    delete: vi.fn<CollectionAlertStateStore["delete"]>(async (serviceId) => {
      states.delete(serviceId);
    }),
  } satisfies CollectionAlertStateStore & { states: Map<string, CollectionAlertState> };
}

function sender(): CollectionAlertSender {
  return {
    enabled: true,
    send: vi.fn<CollectionAlertSender["send"]>(async () => undefined),
  };
}

describe("scheduled status collection alerts", () => {
  it("immediately reports a service-specific D1 persistence failure", async () => {
    const store = collectionStore({
      saveSuccess: vi.fn<CollectionStore["saveSuccess"]>(async () => {
        throw new Error("D1 unavailable");
      }),
    });
    const alertSender = sender();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await collectAtScheduledTime({} as D1Database, Date.parse("2026-10-24T05:01:00.000Z"), {
        sender: alertSender,
        environment: "production",
        services: [service],
        fetcher: async () => snapshot,
        storeFactory: () => store,
      });
    } finally {
      log.mockRestore();
    }

    expect(alertSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "persistence_failure",
        serviceId: service.id,
        serviceName: service.name,
        errorCode: "d1_persistence_error",
        environment: "production",
      }),
    );
  });

  it("sends failure and recovery alerts from KV state transitions", async () => {
    const store = collectionStore();
    const alertState = alertStateStore();
    const alertSender = sender();
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const minute of [1, 2, 3, 4]) {
        await collectAtScheduledTime(
          {} as D1Database,
          Date.parse(`2026-10-24T05:0${minute}:00.000Z`),
          {
            sender: alertSender,
            alertState,
            environment: "production",
            services: [service],
            fetcher: failFetcher,
            storeFactory: () => store,
          },
        );
      }

      expect(alertSender.send).toHaveBeenCalledTimes(1);
      expect(alertState.put).toHaveBeenCalledTimes(4);

      await collectAtScheduledTime({} as D1Database, Date.parse("2026-10-24T05:05:00.000Z"), {
        sender: alertSender,
        alertState,
        environment: "production",
        services: [service],
        fetcher: async () => snapshot,
        storeFactory: () => store,
      });
    } finally {
      log.mockRestore();
    }

    expect(alertSender.send).toHaveBeenCalledTimes(2);
    expect(alertState.delete).toHaveBeenCalledOnce();
    expect(alertState.states.has(service.id)).toBe(false);
  });

  it("reports a fatal cron error even when collection cannot start", async () => {
    const alertSender = sender();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await collectAtScheduledTime({} as D1Database, Date.parse("2026-10-24T05:01:00.000Z"), {
        sender: alertSender,
        environment: "production",
        storeFactory: () => {
          throw new Error("D1 binding unavailable");
        },
      });
    } finally {
      log.mockRestore();
    }

    expect(alertSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cron_failure",
        serviceId: "miharu-cron",
        errorCode: "cron_execution_error",
        environment: "production",
      }),
    );
  });
});
