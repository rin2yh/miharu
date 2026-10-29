import { classifyIncident } from "./incident-category";
import type { KnownIncident } from "../domain";
import { reconcileIncidents } from "../domain/reconcile";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVICES, type ServiceConfig } from "../shared/config/services";
import type { ProviderContext } from "./provider-context";
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

function providerContext(
  fetcher: FetchLike,
  knownIncidents: KnownIncident[] = [],
): ProviderContext {
  return { signal: abortSignal, fetcher, getUnresolvedIncidents: async () => knownIncidents };
}

function knownNotionIncident(id: string): KnownIncident {
  return {
    id,
    title: "An old incident",
    body: null,
    kind: "incident",
    state: "investigating",
    sourceStatus: "investigating",
    sourceType: null,
    sourceImpact: null,
    severityStatus: null,
    componentIds: [],
    components: [],
    officialCreatedAt: "2026-10-01T00:00:00.000Z",
    officialUpdatedAt: null,
    url: null,
    lifecycle: "active",
    closureReason: null,
    lastObservedAt: "2026-10-01T00:00:00.000Z",
  };
}

const github = getService("github", "statuspage");
const notion = getService("notion", "statuspage");
const cloudflare = getService("cloudflare", "statuspage");

type CloudflareSummaryFixture = {
  status: { indicator: string; description: string };
  components: unknown[];
  incidents: unknown[];
  scheduled_maintenances: unknown[];
};

// Captured from Cloudflare's official API on 2026-10-24; component rows are minimized.
const cloudflareSummaryFixture = JSON.parse(
  readFileSync("src/adapter/fixtures/cloudflare-summary.json", "utf8"),
) as CloudflareSummaryFixture;
// Captured from Cloudflare's official summary API on 2026-10-24.
const cloudflareStorageMaintenanceFixture = JSON.parse(
  readFileSync("src/adapter/fixtures/cloudflare-storage-maintenance.json", "utf8"),
) as unknown;
// Captured from Cloudflare's official summary API on 2026-10-24.
const cloudflareInProgressMaintenanceFixture = JSON.parse(
  readFileSync("src/adapter/fixtures/cloudflare-in-progress-maintenance.json", "utf8"),
) as unknown;
// Captured from Notion's official summary API on 2026-10-29; the response omits incidents.
const notionSummaryWithoutIncidentsFixture = JSON.parse(
  readFileSync("src/adapter/fixtures/notion-summary-without-incidents.json", "utf8"),
) as unknown;

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

function fetchIncidentWithFallbackTitle(title: string) {
  return fetchStatuspageSnapshot(
    github,
    providerContext(
      jsonFetcher({
        status: { indicator: "none" },
        components: [],
        incidents: [{ name: title, status: "investigating", created_at: "2026-10-23T00:00:00Z" }],
        scheduled_maintenances: [],
      }),
    ),
  );
}

describe("Statuspage provider", () => {
  it.each([
    { impact: "none", expected: "notice" },
    { impact: "minor", expected: "outage" },
    { impact: "major", expected: "outage" },
    { impact: "critical", expected: "outage" },
    { impact: undefined, expected: "unknown" },
    { impact: "future", expected: "unknown" },
  ])("retains Notion's monitoring evidence for $expected", async ({ impact, expected }) => {
    const snapshot = await fetchStatuspageSnapshot(
      notion,
      providerContext(
        jsonFetcher({
          status: { indicator: "none" },
          components: [],
          incidents: [
            { id: "security-notice", name: "Security notification", status: "monitoring", impact },
          ],
        }),
      ),
    );
    expect(snapshot.status).toBe("operational");
    expect(snapshot.incidents[0]).toMatchObject({
      kind: "incident",
      state: "monitoring",
      sourceImpact: impact ?? null,
    });
    expect(classifyIncident(snapshot.incidents[0], notion.provider)).toBe(expected);
  });
  it("normalizes overall status and keeps incident impact separate", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      github,
      providerContext(
        jsonFetcher({
          status: { indicator: "major", description: "Partial System Outage" },
          components: [{ id: "actions", name: "Actions", status: "partial_outage" }],
          incidents: [
            {
              id: "inc-1",
              name: "Actions are delayed",
              status: "monitoring",
              impact: "critical",
              created_at: "2026-10-23T01:00:00Z",
              updated_at: "2026-10-23T01:14:00Z",
              component_ids: ["actions"],
              incident_updates: [
                {
                  body: "Mitigation is in place.<br />Next line.",
                  created_at: "2026-10-23T01:14:00Z",
                  affected_components: [{ name: "Actions" }],
                },
              ],
              url: "https://www.githubstatus.com/incidents/inc-1",
            },
          ],
          scheduled_maintenances: [],
        }),
      ),
    );

    expect(snapshot.status).toBe("partial_outage");
    expect(snapshot.incidentListComplete).toBe(true);
    expect(snapshot.sourceStatus).toBe("major");
    expect(snapshot.components).toEqual([
      {
        id: "actions",
        name: "Actions",
        status: "partial_outage",
        sourceStatus: "partial_outage",
      },
    ]);
    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0]).toMatchObject({
      id: "inc-1",
      state: "monitoring",
      sourceImpact: "critical",
      severityStatus: "major_outage",
      body: "Mitigation is in place.\nNext line.",
      componentIds: ["actions"],
      components: ["Actions"],
      url: "https://www.githubstatus.com/incidents/inc-1",
    });
  });

  it("accepts Notion's current summary without treating its missing incident list as complete", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      notion,
      providerContext(jsonFetcher(notionSummaryWithoutIncidentsFixture)),
    );

    expect(snapshot.status).toBe("operational");
    expect(snapshot.components).toHaveLength(19);
    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.incidentListComplete).toBe(false);

    const previous = reconcileIncidents(
      "notion",
      [],
      [
        {
          id: "still-active",
          title: "An ongoing incident",
          body: null,
          kind: "incident",
          state: "investigating",
          sourceStatus: "investigating",
          sourceType: null,
          sourceImpact: null,
          severityStatus: "unknown",
          componentIds: [],
          components: [],
          officialCreatedAt: null,
          officialUpdatedAt: null,
          url: null,
        },
      ],
      "2026-10-29T03:00:00.000Z",
    ).changedIncidents;
    const reconciled = reconcileIncidents(
      "notion",
      previous,
      snapshot.incidents,
      "2026-10-29T03:01:00.000Z",
      snapshot.incidentListComplete,
    );
    expect(reconciled.changedIncidents).toEqual([]);
    expect(reconciled.events).toEqual([]);
  });

  it("rechecks omitted Notion incidents through the official individual endpoint", async () => {
    const old = knownNotionIncident("php2shell");
    const urls: string[] = [];
    const fetcher = (async (input) => {
      const url = String(input);
      urls.push(url);
      return new Response(
        JSON.stringify(
          url === notion.summaryUrl
            ? {
                status: { indicator: "none" },
                components: [],
              }
            : {
                incident: {
                  id: old.id,
                  name: old.title,
                  status: "resolved",
                  updated_at: "2026-10-29T04:00:00Z",
                },
              },
        ),
        { headers: { "content-type": "application/json" } },
      );
    }) as FetchLike;

    const snapshot = await fetchStatuspageSnapshot(notion, providerContext(fetcher, [old]));
    const previous = reconcileIncidents("notion", [], [old], old.lastObservedAt).changedIncidents;
    const result = reconcileIncidents(
      "notion",
      previous,
      snapshot.incidents,
      "2026-10-29T04:01:00.000Z",
      snapshot.incidentListComplete,
      snapshot.unverifiedIncidentIds,
      snapshot.notFoundIncidentIds,
    );

    expect(urls).toEqual([
      notion.summaryUrl,
      "https://www.notion-status.com/api/v2/incidents/php2shell.json",
    ]);
    expect(snapshot.incidentListComplete).toBe(false);
    expect(snapshot.incidents[0]?.state).toBe("resolved");
    expect(result.changedIncidents[0]).toMatchObject({
      id: old.id,
      lifecycle: "closed",
      closureReason: "official_resolved",
    });
    expect(result.events).toMatchObject([
      { eventKind: "resolved", closureReason: "official_resolved" },
    ]);
  });

  it.each([
    {
      label: "still active",
      status: 200,
      payload: { incident: { id: "php2shell", name: "An old incident", status: "investigating" } },
      expectedState: "investigating",
    },
    { label: "5xx", status: 503, payload: {}, expectedState: undefined },
    {
      label: "malformed response",
      status: 200,
      payload: { incident: { id: "other", status: "resolved" } },
      expectedState: undefined,
    },
    { label: "invalid JSON", status: 200, payload: "not JSON", expectedState: undefined },
    { label: "network error", failure: true, status: 200, payload: {}, expectedState: undefined },
  ])(
    "does not resolve an omitted Notion incident when its recheck is $label",
    async ({ failure, status, payload, expectedState }) => {
      const old = knownNotionIncident("php2shell");
      const fetcher = (async (input) => {
        if (String(input) === notion.summaryUrl) {
          return new Response(JSON.stringify({ status: { indicator: "none" }, components: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (failure) throw new Error("network failure");
        return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        });
      }) as FetchLike;
      const snapshot = await fetchStatuspageSnapshot(notion, providerContext(fetcher, [old]));
      const previous = reconcileIncidents("notion", [], [old], old.lastObservedAt).changedIncidents;
      const reconciled = reconcileIncidents(
        "notion",
        previous,
        snapshot.incidents,
        "2026-10-29T04:01:00.000Z",
        snapshot.incidentListComplete,
        snapshot.unverifiedIncidentIds,
        snapshot.notFoundIncidentIds,
      );

      expect(snapshot.incidentListComplete).toBe(false);
      expect(snapshot.incidents[0]?.state).toBe(expectedState);
      expect(snapshot.unverifiedIncidentIds).toEqual(expectedState ? [] : [old.id]);
      expect(reconciled.changedIncidents[0]).toMatchObject({
        id: old.id,
        lifecycle: expectedState ? "active" : "unverified",
        closureReason: null,
      });
      expect(reconciled.events).toEqual([]);
    },
  );

  it("ends an omitted Notion incident when its individual API returns 404", async () => {
    const old = knownNotionIncident("php2shell");
    const alsoActive = knownNotionIncident("still-open");
    const fetcher = (async (input) => {
      const url = String(input);
      if (url === notion.summaryUrl) {
        return new Response(JSON.stringify({ status: { indicator: "none" }, components: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", {
        status: url.endsWith("php2shell.json") ? 404 : 503,
        headers: { "content-type": "application/json" },
      });
    }) as FetchLike;
    const snapshot = await fetchStatuspageSnapshot(
      notion,
      providerContext(fetcher, [old, alsoActive]),
    );
    const previous = reconcileIncidents(
      "notion",
      [],
      [old, alsoActive],
      old.lastObservedAt,
    ).changedIncidents;
    const reconciled = reconcileIncidents(
      "notion",
      previous,
      snapshot.incidents,
      "2026-10-29T04:01:00.000Z",
      snapshot.incidentListComplete,
      snapshot.unverifiedIncidentIds,
      snapshot.notFoundIncidentIds,
    );

    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.unverifiedIncidentIds).toEqual([alsoActive.id]);
    expect(snapshot.notFoundIncidentIds).toEqual([old.id]);
    expect(reconciled.changedIncidents).toMatchObject([
      { id: old.id, lifecycle: "closed", closureReason: "no_longer_listed" },
      { id: alsoActive.id, lifecycle: "unverified", closureReason: null },
    ]);
    expect(reconciled.events).toMatchObject([
      { eventKind: "closed", closureReason: "no_longer_listed" },
    ]);
  });

  it("handles a missing Notion incident list when no old incidents exist", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      notion,
      providerContext(jsonFetcher({ status: { indicator: "none" }, components: [] })),
    );
    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.unverifiedIncidentIds).toEqual([]);
    expect(snapshot.incidentListComplete).toBe(false);
  });

  it("does not interpret a missing GitHub maintenance list as an empty list", async () => {
    await expect(
      fetchStatuspageSnapshot(
        github,
        providerContext(
          jsonFetcher({
            status: { indicator: "none" },
            components: [],
            incidents: [],
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "invalid_payload",
      message: "Statuspage summary shape changed: invalid scheduled_maintenances",
    });
  });

  it("uses a stable fallback ID when an incident has no official ID", async () => {
    const payload = {
      status: { indicator: "none" },
      components: [],
      incidents: [{ name: "A title", status: "investigating", created_at: "2026-10-23T00:00:00Z" }],
      scheduled_maintenances: [],
    };
    const first = await fetchStatuspageSnapshot(github, providerContext(jsonFetcher(payload)));
    const second = await fetchStatuspageSnapshot(github, providerContext(jsonFetcher(payload)));
    expect(first.incidents[0]?.id).toMatch(/^generated_/);
    expect(first.incidents[0]?.id).toBe(second.incidents[0]?.id);
  });

  it("keeps a fallback ID when an incident title changes", async () => {
    const first = await fetchIncidentWithFallbackTitle("A title");
    const updated = await fetchIncidentWithFallbackTitle("A revised title");
    expect(first.incidents[0]?.id).toBe(updated.incidents[0]?.id);
  });

  it("rejects an invalid API shape so existing incidents are not mistaken as resolved", async () => {
    await expect(
      fetchStatuspageSnapshot(
        github,
        providerContext(
          jsonFetcher({
            status: { indicator: "none" },
            components: [],
            incidents: "not-an-array",
            scheduled_maintenances: [],
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "invalid_payload",
      message: "Statuspage summary shape changed: invalid incidents",
    });
  });
});

describe("Cloudflare", () => {
  it("classifies the official scheduled maintenance separately from service status", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      cloudflare,
      providerContext(
        jsonFetcher({
          ...cloudflareSummaryFixture,
          status: { indicator: "none", description: "All Systems Operational" },
          incidents: [],
          scheduled_maintenances: [cloudflareStorageMaintenanceFixture],
        }),
      ),
    );

    expect(snapshot.status).toBe("operational");
    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0]).toMatchObject({
      id: "96wwk8y2kww4",
      title: "Cloudflare has scheduled maintenance for our storage systems",
      kind: "maintenance",
      state: "scheduled",
      sourceImpact: "maintenance",
      severityStatus: "under_maintenance",
      components: expect.arrayContaining(["Custom Pages", "Log Explorer", "Workers Builds"]),
    });
  });

  it("normalizes an official in-progress maintenance without changing overall status", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      { ...cloudflare, componentGroupId: undefined },
      providerContext(
        jsonFetcher({
          status: { indicator: "none", description: "All Systems Operational" },
          components: [],
          incidents: [],
          scheduled_maintenances: [cloudflareInProgressMaintenanceFixture],
        }),
      ),
    );

    expect(snapshot.status).toBe("operational");
    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0]).toMatchObject({
      id: "7fxwn5qkz3b7",
      kind: "maintenance",
      state: "in_progress",
      sourceStatus: "in_progress",
    });
  });

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
      const snapshot = await fetchStatuspageSnapshot(
        cloudflare,
        providerContext(jsonFetcher(payload)),
      );

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
    const snapshot = await fetchStatuspageSnapshot(
      cloudflare,
      providerContext(jsonFetcher(payload)),
    );

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

  it("checks the component limit after the group filter", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      cloudflare,
      providerContext(jsonFetcher(cloudflareSummaryFixture)),
    );
    expect(snapshot.components).toHaveLength(133);

    await expect(
      fetchStatuspageSnapshot(
        cloudflare,
        providerContext(jsonFetcher(oversizedCloudflareSummary(201))),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("rejects a missing configured service group", async () => {
    await expect(
      fetchStatuspageSnapshot(
        cloudflare,
        providerContext(
          jsonFetcher({
            status: { indicator: "none" },
            components: [],
            incidents: [],
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });
});
