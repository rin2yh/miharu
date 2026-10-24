import { describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot } from "../domain";
import type { CollectionAlertStore } from "../shared/store";
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

function collectionStore(overrides: Partial<CollectionAlertStore> = {}) {
  return {
    getUnresolvedIncidents: vi.fn<CollectionAlertStore["getUnresolvedIncidents"]>(async () => []),
    saveSuccess: vi.fn<CollectionAlertStore["saveSuccess"]>(async () => undefined),
    saveFailure: vi.fn<CollectionAlertStore["saveFailure"]>(async () => undefined),
    claimPendingCollectionAlerts: vi.fn<CollectionAlertStore["claimPendingCollectionAlerts"]>(
      async () => [],
    ),
    markCollectionAlertDelivered: vi.fn<CollectionAlertStore["markCollectionAlertDelivered"]>(
      async () => undefined,
    ),
    releaseCollectionAlert: vi.fn<CollectionAlertStore["releaseCollectionAlert"]>(
      async () => undefined,
    ),
    pruneHistory: vi.fn<(now: Date) => Promise<void>>(async () => undefined),
    ...overrides,
  };
}

function sender(): CollectionAlertSender {
  return {
    enabled: true,
    send: vi.fn<CollectionAlertSender["send"]>(async () => undefined),
  };
}

describe("scheduled status collection alerts", () => {
  it("immediately reports a service-specific persistence failure", async () => {
    const store = collectionStore({
      saveSuccess: vi.fn<CollectionAlertStore["saveSuccess"]>(async () => {
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
