import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS, type KnownIncident } from "../../domain";
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
  detailResponse?: Response,
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
    if (url.startsWith(`${googleWorkspaceService.statusPageUrl}incidents/`)) {
      return detailResponse ?? new Response("Unavailable", { status: 503 });
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
  detailResponse?: Response,
) {
  const { context, fetcher, getActiveIncidents } = providerContext(
    history,
    knownIncidents,
    failHistory,
    catalogPayload,
    detailResponse,
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
      expectedComponentStatus: "unknown",
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

  it("does not infer current operation from a resolved history entry", async () => {
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
    expect(snapshot.sourceStatus).toBe("no_active_incidents");
    expect(snapshot.components?.find(({ id }) => id === "VHNA7p3Z5p3iakj5sA8V")?.status).toBe(
      "unknown",
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

    const snapshot = await fetchSnapshot(
      [],
      [knownIncident],
      false,
      productCatalog,
      incidentDetailPage(),
    ).result;

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

  it("resolves an omitted incident only when its official detail page shows an end time", async () => {
    const activeSnapshot = await fetchSnapshot([activeIncident("SERVICE_DISRUPTION")]).result;
    const priorIncident = activeSnapshot.incidents[0];
    if (!priorIncident) throw new Error("Expected active incident");
    const knownIncident: KnownIncident = {
      ...priorIncident,
      lastObservedAt: "2026-05-31T05:00:00.000Z",
    };

    const snapshot = await fetchSnapshot(
      [],
      [knownIncident],
      false,
      productCatalog,
      incidentDetailPage("2026-05-31 04:24"),
    ).result;

    expect(snapshot.incidents[0]).toMatchObject({
      id: knownIncident.id,
      state: "resolved",
      sourceStatus: "RESOLVED",
      active: false,
      officialUpdatedAt: "2026-05-31T04:24:00.000Z",
    });
    expect(snapshot.status).toBe("unknown");
  });

  it("keeps a long-omitted incident unverifiable when its official detail page is unavailable", async () => {
    const activeSnapshot = await fetchSnapshot([activeIncident("SERVICE_OUTAGE")]).result;
    const priorIncident = activeSnapshot.incidents[0];
    if (!priorIncident) throw new Error("Expected active incident");
    const knownIncident: KnownIncident = {
      ...priorIncident,
      lastObservedAt: "2026-01-01T00:00:00.000Z",
    };

    const snapshot = await fetchSnapshot([], [knownIncident]).result;

    expect(snapshot.incidents[0]).toMatchObject({
      id: knownIncident.id,
      state: "unknown",
      sourceStatus: INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
      active: true,
    });
    expect(snapshot.status).toBe("unknown");
    expect(snapshot.components?.find(({ id }) => id === "prPt2Yra2CbGsbEm9cpC")?.status).toBe(
      "unknown",
    );
  });

  it("retains affected product ids that are not in the current catalog", async () => {
    const incident = activeIncident("SERVICE_DISRUPTION");
    incident.affected_products = [
      { id: "prPt2Yra2CbGsbEm9cpC" },
      { id: "new-product-not-yet-in-catalog" },
    ];

    const snapshot = await fetchSnapshot([incident]).result;

    expect(snapshot.incidents[0]?.componentIds).toContain("new-product-not-yet-in-catalog");
    expect(snapshot.incidents[0]?.components).toContain(
      "不明な製品 (new-product-not-yet-in-catalog)",
    );
  });

  it("combines multiple active incidents affecting the same product", async () => {
    const disruption = activeIncident("SERVICE_DISRUPTION");
    const outage = { ...activeIncident("SERVICE_OUTAGE"), id: "another-google-incident" };

    const snapshot = await fetchSnapshot([disruption, outage]).result;

    expect(snapshot.status).toBe("major_outage");
    expect(snapshot.components?.find(({ id }) => id === "prPt2Yra2CbGsbEm9cpC")?.status).toBe(
      "major_outage",
    );
    expect(snapshot.incidents).toHaveLength(2);
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

function incidentDetailPage(endTime?: string): Response {
  return new Response(
    `<h2 class="incident-header">Incident affecting Google Workspace</h2>
    <strong class="start-time">2026-05-31 03:28</strong>
    ${endTime ? `<strong class="end-time">${endTime}</strong>` : ""}
    <strong class="timezone">Coordinated Universal Time (UTC)</strong>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
