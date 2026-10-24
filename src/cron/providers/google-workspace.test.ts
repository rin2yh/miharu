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
  const getUnresolvedIncidents = vi.fn<ProviderContext["getUnresolvedIncidents"]>(
    async () => knownIncidents,
  );
  const context: ProviderContext = {
    signal: new AbortController().signal,
    fetcher,
    getUnresolvedIncidents,
  };
  return { context, fetcher, getUnresolvedIncidents };
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
  const { context, fetcher, getUnresolvedIncidents } = providerContext(
    history,
    knownIncidents,
    failHistory,
    catalogPayload,
  );
  return {
    result: fetchGoogleWorkspaceSnapshot(googleWorkspaceService, context),
    fetcher,
    getUnresolvedIncidents,
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
      const { result, fetcher, getUnresolvedIncidents } = fetchSnapshot([activeIncident(impact)]);
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
        lifecycle: "active",
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
      expect(getUnresolvedIncidents).toHaveBeenCalledOnce();
      expect(snapshot.incidentListComplete).toBe(false);
      expect(snapshot.components?.find(({ id }) => id === "prPt2Yra2CbGsbEm9cpC")?.status).toBe(
        expectedComponentStatus,
      );
      expect(incident?.severityStatus).toBe(expectedSeverityStatus);
    },
  );

  it.each([
    {
      name: "omitted from the history",
      history: () => [],
      previouslyUnverifiable: false,
      expectedState: "investigating",
      expectedSourceStatus: "SERVICE_DISRUPTION",
      expectedLifecycle: "unverified",
      expectedServiceStatus: "unknown",
      expectedOfficialUpdatedAt: "2026-06-04T20:11:27.000Z",
      expectedDriveStatus: "unknown",
    },
    {
      name: "listed as active again",
      history: () => [activeIncident("SERVICE_OUTAGE")],
      previouslyUnverifiable: true,
      expectedState: "investigating",
      expectedSourceStatus: "SERVICE_OUTAGE",
      expectedLifecycle: "active",
      expectedServiceStatus: "major_outage",
      expectedOfficialUpdatedAt: "2026-06-04T20:11:27.000Z",
      expectedDriveStatus: "major_outage",
    },
    {
      name: "listed as resolved",
      history: () => historyFixture,
      previouslyUnverifiable: true,
      expectedState: "resolved",
      expectedSourceStatus: "AVAILABLE",
      expectedLifecycle: "resolved",
      expectedServiceStatus: "unknown",
      expectedOfficialUpdatedAt: "2026-05-31T04:24:00.000Z",
      expectedDriveStatus: "unknown",
    },
  ])(
    "handles a known incident that is $name",
    async ({
      history,
      previouslyUnverifiable,
      expectedState,
      expectedSourceStatus,
      expectedLifecycle,
      expectedServiceStatus,
      expectedOfficialUpdatedAt,
      expectedDriveStatus,
    }) => {
      const activeSnapshot = await fetchSnapshot([activeIncident("SERVICE_DISRUPTION")]).result;
      const priorIncident = activeSnapshot.incidents[0];
      if (!priorIncident) throw new Error("Expected captured active incident");
      const knownIncident: KnownIncident = {
        ...priorIncident,
        ...(previouslyUnverifiable
          ? {
              lifecycle: "unverified" as const,
            }
          : {}),
        lastObservedAt: "2026-01-01T00:00:00.000Z",
      };

      const { result, fetcher } = fetchSnapshot(history(), [knownIncident]);
      const snapshot = await result;
      const currentIncident = snapshot.incidents.find(({ id }) => id === knownIncident.id);

      expect(currentIncident).toMatchObject({
        state: expectedState,
        sourceStatus: expectedSourceStatus,
        lifecycle: expectedLifecycle,
      });
      expect(snapshot.status).toBe(expectedServiceStatus);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(currentIncident?.officialUpdatedAt).toBe(expectedOfficialUpdatedAt);
      expect(snapshot.components?.find(({ id }) => id === "VHNA7p3Z5p3iakj5sA8V")?.status).toBe(
        expectedDriveStatus,
      );
    },
  );

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
    expect(snapshot.summary).toContain("進行中の障害はありません");
    expect(snapshot.summary).toContain("現在の稼働状態は公開データから判断できません");
    expect(snapshot.components?.every(({ status }) => status === "unknown")).toBe(true);
  });

  it.each([
    {
      name: "history request fails",
      history: [],
      failHistory: true,
      catalogPayload: productCatalog,
      expectedCode: "upstream_http_error",
    },
    {
      name: "catalog is empty",
      history: [],
      failHistory: false,
      catalogPayload: { products: [] },
      expectedCode: "invalid_payload",
    },
    {
      name: "history has an invalid shape",
      history: { incidents: [] },
      failHistory: false,
      catalogPayload: productCatalog,
      expectedCode: "invalid_payload",
    },
  ])("rejects input when $name", async ({ history, failHistory, catalogPayload, expectedCode }) => {
    const { result, fetcher } = fetchSnapshot(history, [], failHistory, catalogPayload);

    await expect(result).rejects.toMatchObject({ code: expectedCode });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
