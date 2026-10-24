import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot } from "../../domain";
import { SERVICES } from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import { fetchServiceSnapshot } from "./index";

const signal = new AbortController().signal;
const googleWorkspaceProducts = JSON.parse(
  readFileSync("src/cron/providers/fixtures/google-workspace-products.json", "utf8"),
) as unknown;
const googleWorkspaceDashboard = readFileSync(
  "src/cron/providers/fixtures/google-workspace-dashboard.html",
  "utf8",
);

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

  it("dispatches Google Workspace through its current dashboard and history feeds", async () => {
    const service = getService("google-workspace");
    vi.useFakeTimers({ now: new Date("2026-10-24T06:08:00.000Z") });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === service.dashboardUrl) {
        return new Response(googleWorkspaceDashboard, {
          headers: { "content-type": "text/html" },
        });
      }
      const payload = url === service.productsUrl ? googleWorkspaceProducts : [];
      return new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      });
    });
    const getActiveIncidents = vi.fn<ProviderContext["getActiveIncidents"]>(async () => []);

    try {
      const snapshot = await fetchServiceSnapshot(service, { signal, fetcher, getActiveIncidents });

      expect(snapshot.status).toBe("operational");
      expect(fetcher).toHaveBeenCalledWith(service.productsUrl, expect.any(Object));
      expect(fetcher).toHaveBeenCalledWith(service.incidentsUrl, expect.any(Object));
      expect(fetcher).toHaveBeenCalledWith(service.dashboardUrl, expect.any(Object));
      expect(getActiveIncidents).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
