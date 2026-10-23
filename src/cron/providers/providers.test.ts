import { describe, expect, it } from "vitest";
import { SERVICES } from "../../shared/config/services";
import { fetchSlackSnapshot } from "./slack";
import { fetchStatuspageSnapshot } from "./statuspage";
import type { FetchLike } from "./shared";

const abortSignal = new AbortController().signal;
const github = SERVICES.find((service) => service.id === "github");
const notion = SERVICES.find((service) => service.id === "notion");
const slack = SERVICES.find((service) => service.id === "slack");

if (
  !github ||
  github.provider !== "statuspage" ||
  !notion ||
  notion.provider !== "statuspage" ||
  !slack ||
  slack.provider !== "slack"
) {
  throw new Error("Service config is missing a provider fixture");
}

const githubStatuspage = github;

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
                body: "Mitigation is in place.",
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
    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0]).toMatchObject({
      id: "inc-1",
      state: "monitoring",
      active: true,
      sourceImpact: "critical",
      severityStatus: "major_outage",
      body: "Mitigation is in place.",
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
    expect(snapshot.incidents[0]).toMatchObject({
      officialUpdatedAt: "2026-10-23T04:01:17.000Z",
      severityStatus: "major_outage",
      active: true,
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
      officialUpdatedAt: "2026-10-23T01:05:00.000Z",
      body: "We are investigating.",
      components: ["Messaging"],
    });
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
