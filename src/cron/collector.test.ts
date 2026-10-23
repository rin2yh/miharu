import { describe, expect, it, vi } from "vitest";
import { SERVICES } from "../shared/config/services";
import type { ProviderSnapshot } from "../domain";
import type { CollectionStore } from "../shared/store";
import { ProviderError } from "./providers/shared";
import { collectAll, collectService } from "./collector";

const service = SERVICES.find((item) => item.id === "github");
if (!service) throw new Error("GitHub service config is missing");

const snapshot: ProviderSnapshot = {
  status: "operational",
  sourceStatus: "none",
  summary: "All Systems Operational",
  incidents: [],
};

function store(overrides: Partial<CollectionStore> = {}): CollectionStore {
  return {
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
    const result = await collectAll(
      SERVICES,
      "2026-10-23T05:00:00.000Z",
      persistence,
      async (item) => {
        if (item.id === "notion") throw new ProviderError("network_error", "unavailable");
        return snapshot;
      },
    );
    expect(result).toBeUndefined();
    expect(persistence.saveSuccess).toHaveBeenCalledTimes(SERVICES.length - 1);
    expect(persistence.saveFailure).toHaveBeenCalledTimes(1);
  });
});
