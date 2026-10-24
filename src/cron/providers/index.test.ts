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
  const getUnresolvedIncidents = vi.fn<ProviderContext["getUnresolvedIncidents"]>(async () => []);
  const context: ProviderContext = { signal, fetcher, getUnresolvedIncidents };
  return { context, fetcher, getUnresolvedIncidents };
}

describe("provider dispatch", () => {
  it("dispatches Slack through its configured endpoint", async () => {
    const service = getService("slack");
    const { context, fetcher, getUnresolvedIncidents } = providerContext({
      status: "ok",
      active_incidents: [],
    });

    const snapshot = await fetchServiceSnapshot(service, context);

    expect(snapshot.sourceStatus).toBe("ok");
    expect(fetcher).toHaveBeenCalledWith(service.currentUrl, expect.any(Object));
    expect(getUnresolvedIncidents).not.toHaveBeenCalled();
  });

  it("dispatches Statuspage through its configured endpoint", async () => {
    const service = getService("notion");
    const { context, fetcher, getUnresolvedIncidents } = providerContext({
      status: { indicator: "none" },
      components: [],
      incidents: [],
    });

    const snapshot = await fetchServiceSnapshot(service, context);

    expect(snapshot.status).toBe("operational");
    expect(fetcher).toHaveBeenCalledWith(service.summaryUrl, expect.any(Object));
    expect(getUnresolvedIncidents).not.toHaveBeenCalled();
  });

  it("dispatches ChatGPT and lets its provider load active incidents", async () => {
    const service = getService("chatgpt");
    const { context, fetcher, getUnresolvedIncidents } = providerContext({
      status: { indicator: "none" },
      components: service.components.map(({ id, name }) => ({ id, name, status: "operational" })),
      incidents: [],
    });

    const snapshot: ProviderSnapshot = await fetchServiceSnapshot(service, context);

    expect(snapshot.status).toBe("operational");
    expect(fetcher).toHaveBeenCalledWith(service.summaryUrl, expect.any(Object));
    expect(getUnresolvedIncidents).toHaveBeenCalledOnce();
  });

  it("dispatches Google Workspace through its product and incident feeds", async () => {
    const service = getService("google-workspace");
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const payload =
        String(input) === service.productsUrl
          ? { products: [{ id: "gmail", title: "Gmail" }] }
          : [];
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      });
    });
    const getUnresolvedIncidents = vi.fn<ProviderContext["getUnresolvedIncidents"]>(async () => []);

    const snapshot = await fetchServiceSnapshot(service, {
      signal,
      fetcher,
      getUnresolvedIncidents,
    });

    expect(snapshot.status).toBe("unknown");
    expect(fetcher).toHaveBeenCalledWith(service.productsUrl, expect.any(Object));
    expect(fetcher).toHaveBeenCalledWith(service.incidentsUrl, expect.any(Object));
    expect(getUnresolvedIncidents).toHaveBeenCalledOnce();
  });
});
