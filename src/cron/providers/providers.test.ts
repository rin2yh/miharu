import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
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

type CloudflareSummaryFixture = {
  status: { indicator: string; description: string };
  components: unknown[];
  incidents: unknown[];
  scheduled_maintenances: unknown[];
};

// Captured from Cloudflare's official API on 2026-10-24; component rows are minimized.
let cloudflareSummaryFixture: CloudflareSummaryFixture;

function loadCloudflareSummaryFixture(): CloudflareSummaryFixture {
  return JSON.parse(
    readFileSync("src/cron/providers/fixtures/cloudflare-summary.json", "utf8"),
  ) as CloudflareSummaryFixture;
}

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
  beforeAll(() => {
    cloudflareSummaryFixture = loadCloudflareSummaryFixture();
  });

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
    "filters Cloudflare components for $scenario",
    async ({ getPayload, expectedCount, expectedStatus, expectedSourceStatus }) => {
      const payload = getPayload();
      expect(payload.components).toHaveLength(482);
      const snapshot = await fetchStatuspageSnapshot(
        cloudflareStatuspage,
        abortSignal,
        jsonFetcher(payload),
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
          id: "regional-incident",
          name: "Connectivity issues in Accra",
          status: "investigating",
          impact: "major",
          components: [{ id: cloudflareRegionalComponentId, name: "Accra, Ghana - (ACC)" }],
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
      cloudflareStatuspage,
      abortSignal,
      jsonFetcher(payload),
    );

    expect(snapshot.incidents.map(({ id }) => id)).toEqual([
      "sufgcbe8rrwt",
      "3ts1mfzs0khz",
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
      jsonFetcher(cloudflareSummaryFixture),
    );
    expect(snapshot.components).toHaveLength(133);

    await expect(
      fetchStatuspageSnapshot(
        cloudflareStatuspage,
        abortSignal,
        jsonFetcher(oversizedCloudflareSummary(201)),
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
