import { describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot } from "../../domain";
import { SERVICES } from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import { fetchServiceSnapshot } from "./index";

const signal = new AbortController().signal;

type ConfiguredService = (typeof SERVICES)[number];

function getService<Id extends ConfiguredService["id"]>(
  id: Id,
): Extract<ConfiguredService, { id: Id }> {
  const service = SERVICES.find(
    (candidate): candidate is Extract<ConfiguredService, { id: Id }> => candidate.id === id,
  );
  if (!service) throw new Error(`Missing service: ${id}`);
  return service;
}

function providerContext(payload: unknown) {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      }),
  );
  const getActiveIncidents = vi.fn<ProviderContext["getActiveIncidents"]>(async () => []);
  const context: ProviderContext = { signal, fetcher, getActiveIncidents };
  return { context, fetcher, getActiveIncidents };
}

describe("provider dispatch", () => {
  it("dispatches Slack through its configured endpoint", async () => {
    const service = getService("slack");
    const { context, fetcher, getActiveIncidents } = providerContext({
      status: "ok",
      active_incidents: [],
    });

    const snapshot = await fetchServiceSnapshot(service, context);

    expect(snapshot.sourceStatus).toBe("ok");
    expect(fetcher).toHaveBeenCalledWith(service.currentUrl, expect.any(Object));
    expect(getActiveIncidents).not.toHaveBeenCalled();
  });

  it("dispatches Statuspage through its configured endpoint", async () => {
    const service = getService("notion");
    const { context, fetcher, getActiveIncidents } = providerContext({
      status: { indicator: "none" },
      components: [],
      incidents: [],
    });

    const snapshot = await fetchServiceSnapshot(service, context);

    expect(snapshot.status).toBe("operational");
    expect(fetcher).toHaveBeenCalledWith(service.summaryUrl, expect.any(Object));
    expect(getActiveIncidents).not.toHaveBeenCalled();
  });

  it("dispatches ChatGPT and lets its provider load active incidents", async () => {
    const service = getService("chatgpt");
    const { context, fetcher, getActiveIncidents } = providerContext({
      status: { indicator: "none" },
      components: service.components.map(({ id, name }) => ({ id, name, status: "operational" })),
      incidents: [],
    });

    const snapshot: ProviderSnapshot = await fetchServiceSnapshot(service, context);

    expect(snapshot.status).toBe("operational");
    expect(fetcher).toHaveBeenCalledWith(service.summaryUrl, expect.any(Object));
    expect(getActiveIncidents).toHaveBeenCalledOnce();
  });
});
