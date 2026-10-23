import { describe, expect, it } from "vitest";
import { SERVICES } from "../../shared/config/services";
import { fetchSlackSnapshot } from "./slack";
import { fetchStatuspageSnapshot } from "./statuspage";
import type { FetchLike } from "./shared";

const abortSignal = new AbortController().signal;
const github = SERVICES.find((service) => service.id === "github");
const notion = SERVICES.find((service) => service.id === "notion");
const slack = SERVICES.find((service) => service.id === "slack");
const cloudflare = SERVICES.find((service) => service.id === "cloudflare");

if (
  !github ||
  github.provider !== "statuspage" ||
  !notion ||
  notion.provider !== "statuspage" ||
  !slack ||
  slack.provider !== "slack" ||
  !cloudflare ||
  cloudflare.provider !== "statuspage"
) {
  throw new Error("Service config is missing a provider fixture");
}

const githubStatuspage = github;
const cloudflareStatuspage = cloudflare;

const cloudflareServiceGroupId = "1km35smx8p41";
const cloudflareWorkersId = "57srcl8zcn7c";
const cloudflareNetworkId = "4n0gb0kh02gf";
const cloudflareD1Id = "z0yd3sxqjqdm";
const cloudflareRegionalGroupId = "00gpj4s37mz4";
const cloudflareRegionalComponentId = "8h9sn12x310t";
const cloudflareRegions = [
  { id: cloudflareRegionalGroupId, name: "Africa", count: 33 },
  { id: "77867vxkttgw", name: "Asia", count: 99 },
  { id: "zqxhg7y54vy8", name: "Europe", count: 59 },
  { id: "91blz4ztt7dm", name: "Latin America & the Caribbean", count: 57 },
  { id: "m3639x4txd08", name: "Middle East", count: 21 },
  { id: "4l01sk5cdn5c", name: "North America", count: 58 },
  { id: "q6qm6fvkst4h", name: "Oceania", count: 14 },
];

function cloudflareSummary(serviceCount = 133, regionalCount = 341) {
  const knownServices = [
    { id: cloudflareWorkersId, name: "Workers", status: "major_outage" },
    { id: "hb7g5sq2zz0h", name: "R2", status: "operational" },
    { id: cloudflareD1Id, name: "D1", status: "operational" },
    { id: "tmh50tx2nprs", name: "Workers KV", status: "operational" },
    { id: "dp8ppfycqxcs", name: "Authoritative DNS", status: "operational" },
    { id: "5wnz34mhfhrk", name: "CDN/Cache", status: "operational" },
    { id: cloudflareNetworkId, name: "Network", status: "degraded_performance" },
  ];
  const serviceComponents = Array.from({ length: serviceCount }, (_, index) => ({
    ...(knownServices[index] ?? {
      id: `cf-service-${index}`,
      name: `Service ${index}`,
      status: "operational",
    }),
    group_id: cloudflareServiceGroupId,
  }));
  let regionalIndex = 0;
  const regionalGroups = cloudflareRegions.map(({ id, name, count }) => {
    const memberCount = Math.min(count, regionalCount - regionalIndex);
    const memberComponents = Array.from({ length: Math.max(memberCount, 0) }, (_, index) => {
      const globalIndex = regionalIndex + index;
      return {
        id: globalIndex === 0 ? cloudflareRegionalComponentId : `cf-region-${globalIndex}`,
        name: globalIndex === 0 ? "Accra, Ghana - (ACC)" : `Region ${globalIndex}`,
        status: "operational",
        group_id: id,
      };
    });
    regionalIndex += memberComponents.length;
    return {
      id,
      name,
      group: true,
      components: memberComponents.map((component) => component.id),
      memberComponents,
    };
  });
  const regionalComponents = regionalGroups.flatMap((group) => group.memberComponents);

  return {
    page: { id: "yh6f0r4529hb", name: "Cloudflare Status" },
    status: { indicator: "major", description: "Partial System Outage" },
    components: [
      ...serviceComponents,
      ...regionalComponents,
      {
        id: cloudflareServiceGroupId,
        name: "Cloudflare Sites and Services",
        group: true,
        components: serviceComponents.map((component) => component.id),
      },
      ...regionalGroups.map((group) => ({
        id: group.id,
        name: group.name,
        group: true,
        components: group.components,
      })),
    ],
    incidents: [
      {
        id: "network-incident",
        name: "Network connectivity issues affecting services in North America",
        status: "identified",
        impact: "major",
        components: [{ id: cloudflareNetworkId, name: "Network" }],
        incident_updates: [
          {
            status: "identified",
            created_at: "2026-10-23T16:07:54.202Z",
            body: "We are rerouting traffic away from affected paths.",
            affected_components: null,
          },
          {
            status: "investigating",
            created_at: "2026-10-23T15:47:08.918Z",
            body: "Some customers may see increased latency.",
            affected_components: [
              { code: cloudflareNetworkId, name: "Cloudflare Sites and Services - Network" },
            ],
          },
        ],
      },
      {
        id: "workers-incident",
        name: "Delayed, missed, and duplicated Workers Cron Triggers",
        status: "investigating",
        impact: "critical",
        components: [{ id: cloudflareWorkersId, name: "Workers" }],
        incident_updates: [
          {
            body: "We are investigating.",
            affected_components: [
              { code: cloudflareWorkersId, name: "Cloudflare Sites and Services - Workers" },
            ],
          },
        ],
      },
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
        id: "regional-incident",
        name: "Connectivity issues in Accra",
        status: "investigating",
        impact: "major",
        components: [{ id: cloudflareRegionalComponentId, name: "Accra, Ghana - (ACC)" }],
        incident_updates: [{ affected_components: null }],
      },
      {
        id: "unassigned-incident",
        name: "Unassigned incident",
        status: "investigating",
        impact: "minor",
        incident_updates: [{ affected_components: null }],
      },
    ],
  };
}

function jsonFetcher(payload: unknown, contentType = "application/json"): FetchLike {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": contentType },
    })) as FetchLike;
}

function fetchIncidentWithFallbackTitle(title: string) {
  return fetchStatuspageSnapshot(
    githubStatuspage,
    abortSignal,
    jsonFetcher({
      status: { indicator: "none" },
      components: [],
      incidents: [{ name: title, status: "investigating", created_at: "2026-10-23T00:00:00Z" }],
      scheduled_maintenances: [],
    }),
  );
}

describe("Statuspage provider", () => {
  it("normalizes overall status and keeps incident impact separate", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      github,
      abortSignal,
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
    );

    expect(snapshot.status).toBe("partial_outage");
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
      active: true,
      sourceImpact: "critical",
      severityStatus: "major_outage",
      body: "Mitigation is in place.\nNext line.",
      componentIds: ["actions"],
      components: ["Actions"],
      url: "https://www.githubstatus.com/incidents/inc-1",
    });
  });

  it("accepts Notion's current Statuspage-compatible summary without a maintenance list", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      notion,
      abortSignal,
      jsonFetcher({
        page: { name: "Notion" },
        status: { indicator: "none", description: "All Systems Operational" },
        components: [],
        incidents: [
          {
            id: "notion-incident",
            name: "Users unable to access Notion",
            status: "monitoring",
            impact: "critical",
            created_at: "2026-10-23T03:38:19Z",
            incident_updates: [
              { body: "Service is recovering.", created_at: "2026-10-23T04:01:17Z" },
            ],
          },
        ],
      }),
    );

    expect(snapshot.status).toBe("operational");
    expect(snapshot.components).toEqual([]);
    expect(snapshot.incidents[0]).toMatchObject({
      officialUpdatedAt: "2026-10-23T04:01:17.000Z",
      severityStatus: "major_outage",
      active: true,
      componentIds: [],
    });
  });

  it("does not interpret a missing GitHub maintenance list as an empty list", async () => {
    await expect(
      fetchStatuspageSnapshot(
        github,
        abortSignal,
        jsonFetcher({
          status: { indicator: "none" },
          components: [],
          incidents: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it.each([
    {
      scenario: "the current 482-component official summary",
      payload: cloudflareSummary(),
      expectedCount: 133,
      expectedStatus: "partial_outage",
      expectedSourceStatus: "major",
    },
    {
      scenario: "service components whose states differ from the official overall status",
      payload: {
        ...cloudflareSummary(2, 341),
        status: { indicator: "none", description: "All Systems Operational" },
      },
      expectedCount: 2,
      expectedStatus: "operational",
      expectedSourceStatus: "none",
    },
  ])(
    "filters Cloudflare components for $scenario",
    async ({ payload, expectedCount, expectedStatus, expectedSourceStatus }) => {
      expect(payload.components).toHaveLength(expectedCount === 133 ? 482 : 351);
      const snapshot = await fetchStatuspageSnapshot(
        cloudflareStatuspage,
        abortSignal,
        jsonFetcher(payload),
      );

      expect(snapshot.status).toBe(expectedStatus);
      expect(snapshot.sourceStatus).toBe(expectedSourceStatus);
      expect(snapshot.summary).toBe(payload.status.description);
      expect(snapshot.components).toHaveLength(expectedCount);
      const expectedNames =
        expectedCount === 133
          ? ["Workers", "R2", "D1", "Workers KV", "Authoritative DNS", "CDN/Cache"]
          : ["Workers", "R2"];
      expect(snapshot.components?.map(({ name }) => name)).toEqual(
        expect.arrayContaining(expectedNames),
      );
      expect(snapshot.components?.some(({ name }) => name === "Accra, Ghana - (ACC)")).toBe(false);
    },
  );

  it("keeps only incidents linked to a Cloudflare service component", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      cloudflareStatuspage,
      abortSignal,
      jsonFetcher(cloudflareSummary()),
    );

    expect(snapshot.incidents.map(({ id }) => id)).toEqual([
      "network-incident",
      "workers-incident",
      "d1-incident",
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
  });

  it("checks the component limit after Cloudflare's group filter", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      cloudflareStatuspage,
      abortSignal,
      jsonFetcher(cloudflareSummary(133, 341)),
    );
    expect(snapshot.components).toHaveLength(133);

    await expect(
      fetchStatuspageSnapshot(
        cloudflareStatuspage,
        abortSignal,
        jsonFetcher(cloudflareSummary(201, 0)),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("rejects a missing configured Cloudflare service group", async () => {
    await expect(
      fetchStatuspageSnapshot(
        cloudflareStatuspage,
        abortSignal,
        jsonFetcher({
          status: { indicator: "none" },
          components: [],
          incidents: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("uses a stable fallback ID when an incident has no official ID", async () => {
    const payload = {
      status: { indicator: "none" },
      components: [],
      incidents: [{ name: "A title", status: "investigating", created_at: "2026-10-23T00:00:00Z" }],
      scheduled_maintenances: [],
    };
    const first = await fetchStatuspageSnapshot(github, abortSignal, jsonFetcher(payload));
    const second = await fetchStatuspageSnapshot(github, abortSignal, jsonFetcher(payload));
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
        abortSignal,
        jsonFetcher({
          status: { indicator: "none" },
          components: [],
          incidents: "not-an-array",
          scheduled_maintenances: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });
});

describe("Slack provider", () => {
  it("keeps Slack's incident type without inventing a severity", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      abortSignal,
      jsonFetcher({
        status: "active",
        active_incidents: [
          {
            id: "slack-incident",
            title: "Some users are experiencing delays",
            status: "investigating",
            type: "incident",
            date_created: "2026-10-23T01:00:00Z",
            url: "https://slack-status.com/2026-10/abc",
            services: ["Messaging"],
            notes: [{ date: "2026-10-23T01:05:00Z", body: "We are investigating." }],
          },
        ],
      }),
    );

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.sourceStatus).toBe("active");
    expect(snapshot.incidents[0]).toMatchObject({
      state: "investigating",
      sourceType: "incident",
      severityStatus: null,
      componentIds: [],
      officialUpdatedAt: "2026-10-23T01:05:00.000Z",
      body: "We are investigating.",
      components: ["Messaging"],
    });
    expect(snapshot.components).toBeUndefined();
  });

  it("normalizes Slack's healthy response", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      abortSignal,
      jsonFetcher({ status: "ok", active_incidents: [] }),
    );
    expect(snapshot.status).toBe("operational");
    expect(snapshot.incidents).toEqual([]);
  });

  it("rejects HTML and malformed responses", async () => {
    await expect(
      fetchSlackSnapshot(slack, abortSignal, jsonFetcher({}, "text/html")),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(
      fetchSlackSnapshot(slack, abortSignal, jsonFetcher({ status: "ok" })),
    ).rejects.toMatchObject({
      code: "invalid_payload",
    });
  });
});
