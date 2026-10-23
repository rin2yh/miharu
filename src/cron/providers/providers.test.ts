import { describe, expect, it } from "vitest";
import { SERVICES } from "../../shared/config/services";
import { fetchOpenAIChatGPTSnapshot } from "./openai-chatgpt";
import { fetchSlackSnapshot } from "./slack";
import { fetchStatuspageSnapshot } from "./statuspage";
import type { FetchLike } from "./shared";

const abortSignal = new AbortController().signal;
const github = SERVICES.find((service) => service.id === "github");
const notion = SERVICES.find((service) => service.id === "notion");
const slack = SERVICES.find((service) => service.id === "slack");
const claude = SERVICES.find((service) => service.id === "claude");
const chatgpt = SERVICES.find((service) => service.id === "chatgpt");

if (
  !github ||
  github.provider !== "statuspage" ||
  !notion ||
  notion.provider !== "statuspage" ||
  !slack ||
  slack.provider !== "slack" ||
  !claude ||
  claude.provider !== "statuspage" ||
  !chatgpt ||
  chatgpt.provider !== "openai-chatgpt"
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

function routedJsonFetcher(payloads: Record<string, unknown>): FetchLike {
  return (async (input) => {
    const path = new URL(String(input)).pathname;
    return new Response(JSON.stringify(payloads[path]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as FetchLike;
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

  it("accepts Claude's current Statuspage-compatible summary", async () => {
    const snapshot = await fetchStatuspageSnapshot(
      claude,
      abortSignal,
      jsonFetcher({
        page: { name: "Claude" },
        status: { indicator: "none", description: "All Systems Operational" },
        components: [
          { id: "rwppv331jlwc", name: "claude.ai", status: "operational" },
          {
            id: "k8w3r06qmzrp",
            name: "Claude API (api.anthropic.com)",
            status: "operational",
          },
        ],
        incidents: [],
        scheduled_maintenances: [],
      }),
    );

    expect(snapshot).toMatchObject({
      status: "operational",
      sourceStatus: "none",
      components: [
        { id: "rwppv331jlwc", name: "claude.ai", status: "operational" },
        {
          id: "k8w3r06qmzrp",
          name: "Claude API (api.anthropic.com)",
          status: "operational",
        },
      ],
      incidents: [],
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

describe("OpenAI ChatGPT provider", () => {
  it("uses ChatGPT section components and explicitly scoped incidents", async () => {
    const conversationId = chatgpt.componentIds[0]!;
    const loginId = chatgpt.componentIds[1]!;
    const snapshot = await fetchOpenAIChatGPTSnapshot(
      chatgpt,
      abortSignal,
      routedJsonFetcher({
        "/api/v2/summary.json": {
          page: { name: "OpenAI" },
          status: { indicator: "major", description: "OpenAI page-wide outage" },
          components: [
            { id: conversationId, name: "Conversations", status: "degraded_performance" },
            { id: loginId, name: "Login", status: "operational" },
            { id: "api-component", name: "Chat Completions", status: "major_outage" },
          ],
        },
        "/api/v2/incidents.json": {
          page: { name: "OpenAI" },
          incidents: [
            {
              id: "chatgpt-incident",
              name: "Elevated ChatGPT conversation errors",
              status: "investigating",
              impact: "major",
              created_at: "2026-10-23T04:00:00Z",
              updated_at: "2026-10-23T04:15:00Z",
              incident_updates: [
                { body: "We are investigating the issue.", created_at: "2026-10-23T04:15:00Z" },
              ],
            },
            {
              id: "api-incident",
              name: "Responses API elevated errors",
              status: "investigating",
              impact: "major",
              created_at: "2026-10-23T04:00:00Z",
              incident_updates: [{ body: "The Responses API is affected." }],
            },
          ],
        },
      }),
    );

    expect(snapshot).toMatchObject({
      status: "degraded_performance",
      sourceStatus: "degraded_performance",
      summary: null,
      components: [
        { id: conversationId, name: "Conversations", status: "degraded_performance" },
        { id: loginId, name: "Login", status: "operational" },
      ],
    });
    expect(snapshot.components).toHaveLength(2);
    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0]).toMatchObject({
      id: "chatgpt-incident",
      title: "Elevated ChatGPT conversation errors",
      active: true,
      componentIds: [],
      components: [],
      url: "https://status.openai.com/incidents/chatgpt-incident",
    });
  });

  it("parses the official OpenAI incident feed shape missing from summary.json", async () => {
    const conversationId = chatgpt.componentIds[0]!;
    const incidentId = "01M5GPE9C4E19HE461P8JAMYXD";
    const snapshot = await fetchOpenAIChatGPTSnapshot(
      chatgpt,
      abortSignal,
      routedJsonFetcher({
        "/api/v2/summary.json": {
          page: { name: "OpenAI" },
          status: { indicator: "none", description: "All Systems Operational" },
          components: [{ id: conversationId, name: "Conversations", status: "operational" }],
        },
        "/api/v2/incidents.json": {
          page: { name: "OpenAI" },
          incidents: [
            {
              id: incidentId,
              name: "Elevated ChatGPT conversation and Responses API errors",
              status: "resolved",
              created_at: "2026-10-22T02:18:32Z",
              updated_at: "2026-10-22T08:50:43Z",
              resolved_at: "2026-10-22T08:50:43Z",
              impact: "minor",
              page_id: "01JMDK9XYNY6RXSED6SDWW50WY",
              incident_updates: [
                {
                  id: "01M5HCWCW9XX2VDNZE2TG5WDBX",
                  body: "All impacted services have now fully recovered.",
                  created_at: "2026-10-22T08:50:43Z",
                  display_at: "2026-10-22T08:50:43Z",
                  incident_id: incidentId,
                  status: "resolved",
                  updated_at: "2026-10-22T08:50:43Z",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(snapshot.incidentListComplete).toBe(false);
    expect(snapshot.incidents).toMatchObject([
      {
        id: incidentId,
        title: "Elevated ChatGPT conversation and Responses API errors",
        state: "resolved",
        active: false,
        officialUpdatedAt: "2026-10-22T08:50:43.000Z",
      },
    ]);
  });

  it("uses official component links when the incident text has no product name", async () => {
    const conversationId = chatgpt.componentIds[0]!;
    const snapshot = await fetchOpenAIChatGPTSnapshot(
      chatgpt,
      abortSignal,
      routedJsonFetcher({
        "/api/v2/summary.json": {
          status: { indicator: "none" },
          components: [{ id: conversationId, name: "Conversations", status: "operational" }],
        },
        "/api/v2/incidents.json": {
          incidents: [
            {
              id: "linked-incident",
              name: "A service issue",
              status: "monitoring",
              component_ids: [conversationId],
              components: [{ id: conversationId, name: "Conversations" }],
            },
          ],
        },
      }),
    );

    expect(snapshot.incidents).toMatchObject([
      { id: "linked-incident", componentIds: [conversationId], components: ["Conversations"] },
    ]);
  });

  it("uses stable fallback IDs when an incident has no official ID", async () => {
    const conversationId = chatgpt.componentIds[0]!;
    const fetchIncident = (incident: Record<string, unknown>) =>
      fetchOpenAIChatGPTSnapshot(
        chatgpt,
        abortSignal,
        routedJsonFetcher({
          "/api/v2/summary.json": {
            status: { indicator: "none" },
            components: [{ id: conversationId, name: "Conversations", status: "operational" }],
          },
          "/api/v2/incidents.json": { incidents: [incident] },
        }),
      );

    const firstWithUrl = await fetchIncident({
      name: "ChatGPT conversation delays",
      status: "investigating",
      created_at: "2026-10-23T04:00:00Z",
      url: "https://status.openai.com/incidents/shared-url",
    });
    const renamedWithUrl = await fetchIncident({
      name: "ChatGPT conversation delays for some users",
      status: "investigating",
      created_at: "2026-10-23T04:00:00Z",
      url: "https://status.openai.com/incidents/shared-url",
    });
    const firstWithTitle = await fetchIncident({
      name: "ChatGPT file uploads are delayed",
      status: "investigating",
    });
    const sameTitle = await fetchIncident({
      name: "ChatGPT file uploads are delayed",
      status: "investigating",
    });

    expect(firstWithUrl.incidents[0]?.id).toMatch(/^generated_/);
    expect(firstWithUrl.incidents[0]?.id).toBe(renamedWithUrl.incidents[0]?.id);
    expect(firstWithUrl.incidents[0]?.url).toBe("https://status.openai.com/incidents/shared-url");
    expect(firstWithTitle.incidents[0]?.id).toMatch(/^generated_/);
    expect(firstWithTitle.incidents[0]?.id).toBe(sameTitle.incidents[0]?.id);
  });

  it("fails when OpenAI's separate incident list is missing instead of treating it as empty", async () => {
    await expect(
      fetchOpenAIChatGPTSnapshot(
        chatgpt,
        abortSignal,
        routedJsonFetcher({
          "/api/v2/summary.json": {
            status: { indicator: "none" },
            components: [
              {
                id: chatgpt.componentIds[0],
                name: "Conversations",
                status: "operational",
              },
            ],
          },
          "/api/v2/incidents.json": { incidents: "not-an-array" },
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("rejects a component response without the known ChatGPT page section", async () => {
    await expect(
      fetchOpenAIChatGPTSnapshot(
        chatgpt,
        abortSignal,
        routedJsonFetcher({
          "/api/v2/summary.json": {
            status: { indicator: "none" },
            components: [{ id: "api-component", name: "Chat Completions", status: "operational" }],
          },
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
