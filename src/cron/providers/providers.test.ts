import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { KnownIncident } from "../../domain";
import { SERVICES } from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import { fetchGoogleWorkspaceSnapshot } from "./google-workspace";

const service = SERVICES.find((candidate) => candidate.provider === "google-workspace");
if (!service) throw new Error("Google Workspace service config is missing");
const googleWorkspaceService = service!;

const productCatalog = JSON.parse(
  readFileSync("src/cron/providers/fixtures/google-workspace-products.json", "utf8"),
) as unknown;
const historyFixture = JSON.parse(
  readFileSync("src/cron/providers/fixtures/google-workspace-history.json", "utf8"),
) as unknown[];
const multiProductIncident = historyFixture.find(
  (incident) => (incident as Record<string, unknown>).id === "vagmms1y6yRxwg6RMQZp",
) as Record<string, unknown> | undefined;
if (!multiProductIncident)
  throw new Error("Google Workspace fixture is missing its multi-product incident");
const capturedMultiProductIncident = multiProductIncident!;

function providerContext(
  history: unknown,
  knownIncidents: KnownIncident[] = [],
  failHistory = false,
  catalogPayload: unknown = productCatalog,
) {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === googleWorkspaceService.productsUrl) {
      return new Response(JSON.stringify(catalogPayload), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url === googleWorkspaceService.incidentsUrl && !failHistory) {
      return new Response(JSON.stringify(history), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Unavailable", { status: 503 });
  });
  const getActiveIncidents = vi.fn<ProviderContext["getActiveIncidents"]>(
    async () => knownIncidents,
  );
  const context: ProviderContext = {
    signal: new AbortController().signal,
    fetcher,
    getActiveIncidents,
  };
  return { context, fetcher, getActiveIncidents };
}

function activeIncident(impact: string): Record<string, unknown> {
  const latest = capturedMultiProductIncident.most_recent_update as Record<string, unknown>;
  return {
    ...capturedMultiProductIncident,
    end: null,
    status_impact: impact,
    severity: impact === "SERVICE_OUTAGE" ? "high" : "medium",
    most_recent_update: { ...latest, status: impact },
  };
}

function fetchSnapshot(
  history: unknown,
  knownIncidents: KnownIncident[] = [],
  failHistory = false,
  catalogPayload: unknown = productCatalog,
) {
  const { context, fetcher, getActiveIncidents } = providerContext(
    history,
    knownIncidents,
    failHistory,
    catalogPayload,
  );
  return {
    result: fetchGoogleWorkspaceSnapshot(googleWorkspaceService, context),
    fetcher,
    getActiveIncidents,
  };
}

describe("Google Workspace provider", () => {
  it.each([
    {
      impact: "SERVICE_DISRUPTION",
      expectedStatus: "degraded_performance",
      expectedComponentStatus: "degraded_performance",
      expectedSeverityStatus: "degraded_performance",
    },
    {
      impact: "SERVICE_OUTAGE",
      expectedStatus: "major_outage",
      expectedComponentStatus: "major_outage",
      expectedSeverityStatus: "major_outage",
    },
    {
      impact: "SERVICE_INFORMATION",
      expectedStatus: "unknown",
      expectedComponentStatus: "operational",
      expectedSeverityStatus: null,
    },
    {
      impact: "UNRECOGNIZED",
      expectedStatus: "unknown",
      expectedComponentStatus: "unknown",
      expectedSeverityStatus: null,
    },
  ])(
    "normalizes an active $impact incident across multiple products",
    async ({ impact, expectedStatus, expectedComponentStatus, expectedSeverityStatus }) => {
      const { result, fetcher, getActiveIncidents } = fetchSnapshot([activeIncident(impact)]);
      const snapshot = await result;
      const incident = snapshot.incidents[0];

      expect(snapshot.status).toBe(expectedStatus);
      expect(snapshot.components).toHaveLength(
        (productCatalog as { products: unknown[] }).products.length,
      );
      expect(incident).toMatchObject({
        id: "vagmms1y6yRxwg6RMQZp",
        state: "investigating",
        sourceImpact: impact,
        active: true,
        componentIds: [
          "prPt2Yra2CbGsbEm9cpC",
          "n5hVexuq1PM9onY9qrmo",
          "Ht9Vx5PFzDPHYvrnrvSk",
          "wNHuVFtZEWU5Mmj2eRCK",
          "VHNA7p3Z5p3iakj5sA8V",
          "sUH4BQXzYXma7NiS94Hi",
          "gh79SrQk6wqonWoxPdCm",
        ],
        url: "https://www.google.com/appsstatus/dashboard/incidents/vagmms1y6yRxwg6RMQZp",
      });
      expect(fetcher).toHaveBeenCalledWith(googleWorkspaceService.productsUrl, expect.any(Object));
      expect(fetcher).toHaveBeenCalledWith(googleWorkspaceService.incidentsUrl, expect.any(Object));
      expect(getActiveIncidents).toHaveBeenCalledOnce();
      expect(snapshot.incidentListComplete).toBe(false);
      expect(snapshot.components?.find(({ id }) => id === "prPt2Yra2CbGsbEm9cpC")?.status).toBe(
        expectedComponentStatus,
      );
      expect(incident?.severityStatus).toBe(expectedSeverityStatus);
    },
  );

  it("uses the official end time when a previously active incident is resolved", async () => {
    const activeSnapshot = await fetchSnapshot([activeIncident("SERVICE_DISRUPTION")]).result;
    const priorIncident = activeSnapshot.incidents[0];
    if (!priorIncident) throw new Error("Expected captured active incident");
    const knownIncident: KnownIncident = {
      ...priorIncident,
      lastObservedAt: "2026-05-31T05:00:00.000Z",
    };

    const { result } = fetchSnapshot(historyFixture, [knownIncident]);
    const snapshot = await result;
    const resolved = snapshot.incidents.find(({ id }) => id === priorIncident.id);

    expect(resolved).toMatchObject({
      state: "resolved",
      active: false,
      officialCreatedAt: "2026-05-31T03:28:00.000Z",
      officialUpdatedAt: "2026-05-31T04:24:00.000Z",
    });
    expect(snapshot.status).toBe("unknown");
    expect(snapshot.sourceStatus).toBe("incomplete_product_history");
    expect(snapshot.components?.find(({ id }) => id === "VHNA7p3Z5p3iakj5sA8V")?.status).toBe(
      "operational",
    );
  });

  it("keeps a known active incident when it is temporarily absent from the history feed", async () => {
    const activeSnapshot = await fetchSnapshot([activeIncident("SERVICE_DISRUPTION")]).result;
    const priorIncident = activeSnapshot.incidents[0];
    if (!priorIncident) throw new Error("Expected active incident");
    const knownIncident: KnownIncident = {
      ...priorIncident,
      lastObservedAt: "2026-05-31T05:00:00.000Z",
    };

    const snapshot = await fetchSnapshot([], [knownIncident]).result;

    expect(snapshot.status).toBe("degraded_performance");
    expect(snapshot.incidents[0]).toMatchObject({
      id: knownIncident.id,
      active: true,
      sourceStatus: knownIncident.sourceStatus,
    });
    expect(snapshot.components?.find(({ id }) => id === "prPt2Yra2CbGsbEm9cpC")?.status).toBe(
      "degraded_performance",
    );
  });

  it("marks products unknown when the history feed has no evidence of their state", async () => {
    const { result } = fetchSnapshot([]);
    const snapshot = await result;

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.sourceStatus).toBe("no_incident_history");
    expect(snapshot.summary).toContain("現在の状態を判断できません");
    expect(snapshot.components?.every(({ status }) => status === "unknown")).toBe(true);
  });

  it("fails the collection when the history feed cannot be fetched", async () => {
    const { result, fetcher } = fetchSnapshot([], [], true);

    await expect(result).rejects.toMatchObject({ code: "upstream_http_error" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed catalog and history payloads", async () => {
    await expect(fetchSnapshot([], [], false, { products: [] }).result).rejects.toMatchObject({
      code: "invalid_payload",
    });
    await expect(fetchSnapshot({ incidents: [] }).result).rejects.toMatchObject({
      code: "invalid_payload",
    });
  });
});
