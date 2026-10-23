import { describe, expect, it, vi } from "vitest";
import { SERVICES } from "../shared/config/services";
import type { ProviderSnapshot } from "../domain";
import type { CollectionStore } from "../shared/store";
import { ProviderError } from "./providers/shared";
import { collectAll, collectService, type SnapshotFetcher } from "./collector";

const service = SERVICES[0];
if (!service) throw new Error("Service config is empty");
const chatgptService = SERVICES.find((item) => item.provider === "openai-chatgpt");
if (!chatgptService || chatgptService.provider !== "openai-chatgpt") {
  throw new Error("ChatGPT service config is missing");
}

const snapshot: ProviderSnapshot = {
  status: "operational",
  sourceStatus: "none",
  summary: "All Systems Operational",
  incidents: [],
};

function store(overrides: Partial<CollectionStore> = {}): CollectionStore {
  return {
    getActiveIncidents: vi.fn<CollectionStore["getActiveIncidents"]>(async () => []),
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
      active: true,
      lastObservedAt: "2026-10-23T04:59:00.000Z",
    };
    const persistence = store({
      getActiveIncidents: vi.fn<CollectionStore["getActiveIncidents"]>(async () => [knownIncident]),
    });
    const fetchSnapshot = vi.fn<SnapshotFetcher>(async (_item, _signal, knownIncidents) => {
      expect(knownIncidents).toEqual([knownIncident]);
      return snapshot;
    });

    const result = await collectService(
      chatgptService,
      "2026-10-23T05:00:00.000Z",
      persistence,
      fetchSnapshot,
    );

    expect(result).toBe("ok");
    expect(persistence.getActiveIncidents).toHaveBeenCalledWith(chatgptService.id);
  });

  it("uses the service timeout and labels an abort as a timeout", async () => {
    const shortTimeout = { ...service, timeoutMs: 5 };
    const persistence = store();
    const result = await collectService(
      shortTimeout,
      "2026-10-23T05:00:00.000Z",
      persistence,
      (_service, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
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
    const failedServiceIds = new Set([service.id]);
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
});
