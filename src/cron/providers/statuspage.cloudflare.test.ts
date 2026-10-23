import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVICES, type ServiceConfig } from "../../shared/config/services";
import { fetchStatuspageSnapshot } from "./statuspage";
import type { FetchLike } from "./shared";

const abortSignal = new AbortController().signal;

function getService<P extends ServiceConfig["provider"]>(
  id: string,
  provider: P,
): Extract<ServiceConfig, { provider: P }> {
  const service = SERVICES.find((candidate) => candidate.id === id);

  if (!service || service.provider !== provider) {
    throw new Error(`Missing ${provider} service: ${id}`);
  }

  return service as Extract<ServiceConfig, { provider: P }>;
}

function jsonFetcher(payload: unknown, contentType = "application/json"): FetchLike {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": contentType },
    })) as FetchLike;
}

const cloudflare = getService("cloudflare", "statuspage");

type CloudflareSummaryFixture = {
  status: { indicator: string; description: string };
  components: unknown[];
  incidents: unknown[];
  scheduled_maintenances: unknown[];
};

// Captured from Cloudflare's official API on 2026-10-24; component rows are minimized.
const cloudflareSummaryFixture = JSON.parse(
  readFileSync("src/cron/providers/fixtures/cloudflare-summary.json", "utf8"),
) as CloudflareSummaryFixture;

const cloudflareServiceGroupId = "1km35smx8p41";
const cloudflareWorkersId = "57srcl8zcn7c";
const cloudflareNetworkId = "4n0gb0kh02gf";
const cloudflareD1Id = "z0yd3sxqjqdm";
const cloudflareRegionalComponentId = "8h9sn12x310t";

function oversizedCloudflareSummary(serviceCount: number) {
  const serviceComponents = Array.from({ length: serviceCount }, (_, index) => ({
    id: `cf-service-${index}`,
    name: `Service ${index}`,
    status: "operational",
    group_id: cloudflareServiceGroupId,
  }));
  return {
    status: cloudflareSummaryFixture.status,
    components: [
      ...serviceComponents,
      {
        id: cloudflareServiceGroupId,
        name: "Cloudflare Sites and Services",
        group: true,
        components: serviceComponents.map((component) => component.id),
      },
    ],
    incidents: [],
    scheduled_maintenances: [],
  };
}

describe("Cloudflare Statuspage provider", () => {
  it.each([
    {
      scenario: "the captured official summary",
      getPayload: () => cloudflareSummaryFixture,
      expectedCount: 133,
      expectedStatus: "partial_outage",
      expectedSourceStatus: "major",
    },
    {
      scenario: "service components whose states differ from the official overall status",
      getPayload: () => ({
        ...cloudflareSummaryFixture,
        status: { indicator: "none", description: "All Systems Operational" },
      }),
      expectedCount: 133,
      expectedStatus: "operational",
      expectedSourceStatus: "none",
    },
  ])(
    "filters components for $scenario",
    async ({ getPayload, expectedCount, expectedStatus, expectedSourceStatus }) => {
      const payload = getPayload();
      expect(payload.components).toHaveLength(482);
      const snapshot = await fetchStatuspageSnapshot(cloudflare, abortSignal, jsonFetcher(payload));

      expect(snapshot.status).toBe(expectedStatus);
      expect(snapshot.sourceStatus).toBe(expectedSourceStatus);
      expect(snapshot.summary).toBe(payload.status.description);
      expect(snapshot.components).toHaveLength(expectedCount);
      expect(snapshot.components?.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          "Workers",
          "R2",
          "D1",
          "Workers KV",
          "Authoritative DNS",
          "CDN/Cache",
        ]),
      );
      expect(snapshot.components?.some(({ name }) => name === "Accra, Ghana - (ACC)")).toBe(false);
    },
  );

  it("keeps only incidents linked to a Cloudflare service component", async () => {
    const payload = {
      ...cloudflareSummaryFixture,
      incidents: [
        ...cloudflareSummaryFixture.incidents,
        {
          id: "d1-incident",
          name: "D1 API errors",
          status: "investigating",
          impact: "major",
          incident_updates: [
            {
              affected_components: [
                { code: cloudflareD1Id, name: "Cloudflare Sites and Services - D1" },
              ],
            },
          ],
        },
        {
          id: "regional-components-workers-incident",
          name: "Workers degraded during a regional network issue",
          status: "investigating",
          impact: "major",
          component_ids: [cloudflareRegionalComponentId],
          components: [{ id: cloudflareRegionalComponentId, name: "Accra, Ghana - (ACC)" }],
          incident_updates: [
            {
              affected_components: [
                { code: cloudflareWorkersId, name: "Cloudflare Sites and Services - Workers" },
              ],
            },
          ],
        },
        {
          id: "regional-incident",
          name: "Connectivity issues in Accra",
          status: "investigating",
          impact: "major",
          components: [{ id: cloudflareRegionalComponentId, name: "Accra, Ghana - (ACC)" }],
        },
        {
          id: "incident-with-many-regional-components",
          name: "Workers degradation with many regional components",
          status: "investigating",
          impact: "major",
          component_ids: [
            ...Array.from({ length: 201 }, (_, index) => `regional-component-${index}`),
            cloudflareWorkersId,
          ],
        },
        {
          id: "unassigned-incident",
          name: "Unassigned incident",
          status: "investigating",
          impact: "minor",
        },
      ],
    };
    const snapshot = await fetchStatuspageSnapshot(cloudflare, abortSignal, jsonFetcher(payload));

    expect(snapshot.incidents.map(({ id }) => id)).toEqual([
      "sufgcbe8rrwt",
      "3ts1mfzs0khz",
      "d1-incident",
      "regional-components-workers-incident",
      "incident-with-many-regional-components",
    ]);
    expect(snapshot.incidents[0]).toMatchObject({
      componentIds: [cloudflareNetworkId],
      components: ["Network"],
    });
    expect(snapshot.incidents[1]).toMatchObject({
      componentIds: [cloudflareWorkersId],
      components: ["Workers"],
    });
    expect(snapshot.incidents[2]).toMatchObject({
      componentIds: [cloudflareD1Id],
      components: ["D1"],
    });
    expect(snapshot.incidents[3]).toMatchObject({
      componentIds: [cloudflareWorkersId],
      components: ["Workers"],
    });
    expect(snapshot.incidents[4]).toMatchObject({
      componentIds: [cloudflareWorkersId],
      components: ["Workers"],
    });
  });

  it("checks the component limit after Cloudflare's group filter", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      cloudflare,
      abortSignal,
      jsonFetcher(cloudflareSummaryFixture),
    );
    expect(snapshot.components).toHaveLength(133);

    await expect(
      fetchStatuspageSnapshot(
        cloudflare,
        abortSignal,
        jsonFetcher(oversizedCloudflareSummary(201)),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("rejects a missing configured service group", async () => {
    await expect(
      fetchStatuspageSnapshot(
        cloudflare,
        abortSignal,
        jsonFetcher({
          status: { indicator: "none" },
          components: [],
          incidents: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });
});
