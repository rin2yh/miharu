import { describe, expect, it, vi } from "vitest";
import { SERVICES } from "../shared/config/services";
import type { ProviderSnapshot } from "../domain";
import type { CollectionStore } from "../shared/store";
import { ProviderError } from "../adapter/shared";
import {
  collectAll,
  collectService,
  type CollectorOptions,
  type SnapshotFetcher,
} from "./collector";

const service = SERVICES[0];
if (!service) throw new Error("Service config is empty");
const slackService = SERVICES.find((item) => item.provider === "slack");
const statuspageService = SERVICES.find((item) => item.provider === "statuspage");
const chatgptService = SERVICES.find((item) => item.provider === "openai-chatgpt");
if (
  !slackService ||
  slackService.provider !== "slack" ||
  !statuspageService ||
  statuspageService.provider !== "statuspage" ||
  !chatgptService ||
  chatgptService.provider !== "openai-chatgpt"
) {
  throw new Error("A provider service config is missing");
}

const snapshot: ProviderSnapshot = {
  status: "operational",
  sourceStatus: "none",
  summary: "All Systems Operational",
  incidents: [],
};

function store(overrides: Partial<CollectionStore> = {}): CollectionStore {
  return {
    getUnresolvedIncidents: vi.fn<CollectionStore["getUnresolvedIncidents"]>(async () => []),
    saveSuccess: vi.fn<CollectionStore["saveSuccess"]>(async () => undefined),
    saveFailure: vi.fn<CollectionStore["saveFailure"]>(async () => undefined),
    ...overrides,
  };
}

describe("status collection", () => {
  it("saves a successful snapshot", async () => {
    const persistence = store();
    const result = await collectService(
      service,
      "2026-10-23T05:00:00.000Z",
      persistence,
      async () => snapshot,
    );
    expect(result).toBe("ok");
    expect(persistence.saveSuccess).toHaveBeenCalledWith(
      service,
      snapshot,
      "2026-10-23T05:00:00.000Z",
    );
    expect(persistence.saveFailure).not.toHaveBeenCalled();
  });

  it("records a provider failure without saving a replacement snapshot", async () => {
    const persistence = store();
    const result = await collectService(
      service,
      "2026-10-23T05:00:00.000Z",
      persistence,
      async () => {
        throw new ProviderError("invalid_payload", "bad upstream data");
      },
    );
    expect(result).toBe("failed");
    expect(persistence.saveFailure).toHaveBeenCalledWith(
      service,
      "2026-10-23T05:00:00.000Z",
      "invalid_payload",
    );
    expect(persistence.saveSuccess).not.toHaveBeenCalled();
  });

  it("logs and forwards an Error message on collection failure", async () => {
    const persistence = store();
    const onCollectionFailure = vi.fn<NonNullable<CollectorOptions["onCollectionFailure"]>>(
      async () => undefined,
    );
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await collectService(
        service,
        "2026-10-23T05:00:00.000Z",
        persistence,
        async () => {
          throw new ProviderError("invalid_payload", "Missing incident status");
        },
        { environment: "production", onCollectionFailure },
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('"errorMessage":"Missing incident status"'),
      );
      expect(onCollectionFailure).toHaveBeenCalledWith(
        service,
        "2026-10-23T05:00:00.000Z",
        "invalid_payload",
        "ProviderError",
        "Missing incident status",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("passes known active ChatGPT incidents to the provider for rechecks", async () => {
    const knownIncident = {
      id: "older-chatgpt-incident",
      title: "Elevated ChatGPT conversation errors",
      body: "Investigating.",
      kind: "incident" as const,
      state: "investigating" as const,
      sourceStatus: "investigating",
      sourceType: "incident",
      sourceImpact: null,
      severityStatus: null,
      componentIds: [],
      components: [],
      officialCreatedAt: null,
      officialUpdatedAt: null,
      url: null,
      lifecycle: "active" as const,
      closureReason: null,
      lastObservedAt: "2026-10-23T04:59:00.000Z",
    };
    const persistence = store({
      getUnresolvedIncidents: vi.fn<CollectionStore["getUnresolvedIncidents"]>(async () => [
        knownIncident,
      ]),
    });
    const fetchSnapshot = vi.fn<SnapshotFetcher>(async (_item, context) => {
      await expect(context.getUnresolvedIncidents()).resolves.toEqual([knownIncident]);
      return snapshot;
    });

    const result = await collectService(
      chatgptService,
      "2026-10-23T05:00:00.000Z",
      persistence,
      fetchSnapshot,
    );

    expect(result).toBe("ok");
    expect(persistence.getUnresolvedIncidents).toHaveBeenCalledWith(chatgptService.id);
  });

  it("does not load active incidents for Slack or Statuspage providers", async () => {
    const persistence = store();
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const sourceUrl = String(input);
      const payload =
        sourceUrl === slackService.currentUrl
          ? { status: "ok", active_incidents: [] }
          : { status: { indicator: "none" }, components: [], incidents: [] };
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    try {
      await collectAll([slackService, statuspageService], "2026-10-23T05:00:00.000Z", persistence);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(persistence.saveSuccess).toHaveBeenCalledTimes(2);
    expect(persistence.getUnresolvedIncidents).not.toHaveBeenCalled();
  });

  it("uses the service timeout and labels an abort as a timeout", async () => {
    const shortTimeout = { ...service, timeoutMs: 5 };
    const persistence = store();
    const result = await collectService(
      shortTimeout,
      "2026-10-23T05:00:00.000Z",
      persistence,
      (_service, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    expect(result).toBe("failed");
    expect(persistence.saveFailure).toHaveBeenCalledWith(
      shortTimeout,
      "2026-10-23T05:00:00.000Z",
      "timeout",
    );
  });

  it("isolates failures across services", async () => {
    const persistence = store();
    const failedServiceIds = new Set<string>([service.id]);
    const result = await collectAll(
      SERVICES,
      "2026-10-23T05:00:00.000Z",
      persistence,
      async (item) => {
        if (failedServiceIds.has(item.id)) {
          throw new ProviderError("network_error", "unavailable");
        }
        return snapshot;
      },
    );
    expect(result).toBeUndefined();
    const successfulServiceCount = SERVICES.filter((item) => !failedServiceIds.has(item.id)).length;
    expect(persistence.saveSuccess).toHaveBeenCalledTimes(successfulServiceCount);
    expect(persistence.saveFailure).toHaveBeenCalledTimes(failedServiceIds.size);
  });

  it("reports persistence failures without stopping other service collections", async () => {
    const persistence = store({
      saveSuccess: vi.fn<CollectionStore["saveSuccess"]>(async (item) => {
        if (item.id === service.id) throw new Error("D1 unavailable");
      }),
    });
    const onPersistenceFailure = vi.fn<NonNullable<CollectorOptions["onPersistenceFailure"]>>(
      async () => undefined,
    );

    await collectAll(
      [service, statuspageService],
      "2026-10-24T05:00:00.000Z",
      persistence,
      async () => snapshot,
      { environment: "production", onPersistenceFailure },
    );

    expect(persistence.saveSuccess).toHaveBeenCalledTimes(2);
    expect(onPersistenceFailure).toHaveBeenCalledOnce();
    expect(onPersistenceFailure).toHaveBeenCalledWith(service, expect.any(Error));
  });

  it("reports a D1 read failure as persistence failure instead of upstream outage", async () => {
    const persistence = store({
      getUnresolvedIncidents: vi.fn<CollectionStore["getUnresolvedIncidents"]>(async () => {
        throw new Error("D1 unavailable");
      }),
    });
    const onPersistenceFailure = vi.fn<NonNullable<CollectorOptions["onPersistenceFailure"]>>(
      async () => undefined,
    );
    const fetcher = vi.fn<SnapshotFetcher>(async (_service, context) => {
      await context.getUnresolvedIncidents();
      return snapshot;
    });

    await collectAll([chatgptService], "2026-10-24T05:00:00.000Z", persistence, fetcher, {
      environment: "production",
      onPersistenceFailure,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(persistence.saveFailure).not.toHaveBeenCalled();
    expect(onPersistenceFailure).toHaveBeenCalledOnce();
    expect(onPersistenceFailure.mock.calls[0]?.[1]).toMatchObject({
      name: "CollectionPersistenceError",
    });
  });
});
