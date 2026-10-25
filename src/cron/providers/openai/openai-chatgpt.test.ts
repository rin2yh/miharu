import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { KnownIncident } from "../../../domain";
import { SERVICES } from "../../../shared/config/services";
import { fetchOpenAIChatGPTSnapshot } from "./chatgpt";
import type { ProviderContext } from "../../provider-context";
import type { FetchLike } from "../shared";

const abortSignal = new AbortController().signal;
const chatgpt = SERVICES.find((service) => service.provider === "openai-chatgpt");
if (!chatgpt) throw new Error("ChatGPT service config is missing");

const chatgptConversation = chatgpt.components.find(({ name }) => name === "Conversations");
const chatgptLogin = chatgpt.components.find(({ name }) => name === "Login");
if (!chatgptConversation || !chatgptLogin) {
  throw new Error("ChatGPT component config is missing a provider fixture");
}
const configuredChatGPTComponents = chatgpt.components;
const configuredChatGPTService = chatgpt;
const capturedChatGPTFeed = readFileSync(
  "src/cron/providers/openai/fixtures/chatgpt-incident.rss",
  "utf8",
);
const capturedChatGPTIncident: KnownIncident = {
  id: "01M5GPE9C4E19HE461P8JAMYXD",
  title: "Elevated ChatGPT conversation and Responses API errors",
  body: "We are investigating the issue.",
  kind: "incident",
  state: "investigating",
  sourceStatus: "investigating",
  sourceType: "incident",
  sourceImpact: "minor",
  severityStatus: "degraded_performance",
  componentIds: [chatgptConversation.id],
  components: [chatgptConversation.name],
  officialCreatedAt: "2026-10-22T02:18:32.000Z",
  officialUpdatedAt: "2026-10-22T02:18:32.000Z",
  url: "https://status.openai.com/incidents/01M5GPE9C4E19HE461P8JAMYXD",
  lifecycle: "active",
  closureReason: null,
  lastObservedAt: "2026-10-22T02:18:32.000Z",
};

function routedJsonFetcher(payloads: Record<string, unknown>): FetchLike {
  return (async (input) => {
    const path = new URL(String(input)).pathname;
    return new Response(JSON.stringify(payloads[path]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as FetchLike;
}

function routedResponseFetcher(responses: Record<string, Response>): FetchLike {
  return (async (input) =>
    responses[new URL(String(input)).pathname] ??
    new Response("Not found", { status: 404 })) as FetchLike;
}

function fetchChatGPTSnapshot(fetcher: FetchLike, knownActiveIncidents: KnownIncident[] = []) {
  const context: ProviderContext = {
    signal: abortSignal,
    fetcher,
    getUnresolvedIncidents: async () => knownActiveIncidents,
  };
  return fetchOpenAIChatGPTSnapshot(configuredChatGPTService, context);
}

function chatgptComponentRows(statuses: Record<string, string> = {}) {
  return configuredChatGPTComponents.map(({ id, name }) => ({
    id,
    name,
    status: statuses[id] ?? "operational",
  }));
}

function fetchOpenAIIncident(incident: Record<string, unknown>) {
  return fetchChatGPTSnapshot(
    routedJsonFetcher({
      "/api/v2/summary.json": {
        status: { indicator: "none" },
        components: chatgptComponentRows(),
      },
      "/api/v2/incidents.json": { incidents: [incident] },
    }),
  );
}

function fetchOmittedChatGPTIncident(incident: KnownIncident, feed?: string) {
  const responses: Record<string, Response> = {
    "/api/v2/summary.json": new Response(
      JSON.stringify({ incidents: [], components: chatgptComponentRows() }),
      { headers: { "content-type": "application/json" } },
    ),
  };
  if (feed) {
    responses[`/incidents/${incident.id}/feed.rss`] = new Response(feed, {
      headers: { "content-type": "application/rss+xml" },
    });
  }
  return fetchChatGPTSnapshot(routedResponseFetcher(responses), [incident]);
}
describe("OpenAI ChatGPT provider", () => {
  it("uses ChatGPT section components and explicitly scoped incidents", async () => {
    const conversationId = chatgptConversation.id;
    const loginId = chatgptLogin.id;
    const snapshot = await fetchChatGPTSnapshot(
      routedJsonFetcher({
        "/api/v2/summary.json": {
          page: { name: "OpenAI" },
          status: { indicator: "major", description: "OpenAI page-wide outage" },
          components: [
            ...chatgptComponentRows({ [conversationId]: "degraded_performance" }),
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
    });
    expect(snapshot.components?.find(({ id }) => id === conversationId)).toMatchObject({
      name: chatgptConversation.name,
      status: "degraded_performance",
    });
    expect(snapshot.components?.find(({ id }) => id === loginId)).toMatchObject({
      name: chatgptLogin.name,
      status: "operational",
    });
    expect(snapshot.components).toHaveLength(chatgpt.components.length);
    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0]).toMatchObject({
      id: "chatgpt-incident",
      title: "Elevated ChatGPT conversation errors",
      componentIds: [],
      components: [],
      url: "https://status.openai.com/incidents/chatgpt-incident",
    });
  });

  it("marks missing configured ChatGPT components as unknown", async () => {
    const omittedComponent = chatgpt.components.at(-1)!;
    const snapshot = await fetchChatGPTSnapshot(
      routedJsonFetcher({
        "/api/v2/summary.json": {
          incidents: [],
          components: chatgptComponentRows().filter(({ id }) => id !== omittedComponent.id),
        },
      }),
    );

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.sourceStatus).toBe("incomplete_components");
    expect(snapshot.components).toHaveLength(chatgpt.components.length);
    expect(snapshot.components?.find(({ id }) => id === omittedComponent.id)).toMatchObject({
      name: omittedComponent.name,
      status: "unknown",
      sourceStatus: "missing",
    });
  });

  it("only uses explicit, non-negated ChatGPT wording when component links are absent", async () => {
    const snapshot = await fetchChatGPTSnapshot(
      routedJsonFetcher({
        "/api/v2/summary.json": {
          incidents: [
            {
              id: "image-api-incident",
              name: "Image generation API elevated errors",
              status: "investigating",
            },
            {
              id: "negated-chatgpt-incident",
              name: "Responses API errors; ChatGPT is not affected",
              status: "investigating",
            },
            {
              id: "mixed-service-incident",
              name: "ChatGPT and Responses API elevated errors",
              status: "investigating",
            },
            {
              id: "negated-update-incident",
              name: "Responses API elevated errors",
              status: "investigating",
              incident_updates: [{ body: "This is not affecting ChatGPT users." }],
            },
            {
              id: "nonimpact-chatgpt-incident",
              name: "Responses API errors",
              status: "investigating",
              incident_updates: [{ body: "The issue does not impact ChatGPT." }],
            },
            {
              id: "api-linked-chatgpt-title",
              name: "ChatGPT is affected",
              status: "investigating",
              component_ids: ["api-component"],
            },
          ],
          components: chatgptComponentRows(),
        },
      }),
    );

    expect(snapshot.incidents.map(({ id }) => id)).toEqual(["mixed-service-incident"]);
  });

  it("rechecks an omitted active incident using a captured official ChatGPT RSS response", async () => {
    const snapshot = await fetchOmittedChatGPTIncident(
      capturedChatGPTIncident,
      capturedChatGPTFeed,
    );

    expect(snapshot.incidents).toMatchObject([
      {
        id: capturedChatGPTIncident.id,
        state: "resolved",
        sourceStatus: "Resolved",
        officialUpdatedAt: "2026-10-22T08:50:43.000Z",
      },
    ]);
  });

  it.each([
    {
      format: "XML-escaped HTML",
      description:
        "&lt;b&gt;Status: Resolved&lt;/b&gt;&lt;br/&gt;&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;",
      body: "Status: Resolved\n<script>alert(1)</script>",
    },
    {
      format: "CDATA HTML",
      description:
        "<![CDATA[<b>Status: Resolved</b><br/>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;]]>",
      body: "Status: Resolved\n&lt;script&gt;alert(1)&lt;/script&gt;",
    },
    {
      format: "incomplete HTML in CDATA",
      description: "<![CDATA[<b>Status: Resolved</b><br/>Trailing <i>unfinished]]>",
      body: "Status: Resolved\nTrailing unfinished",
    },
  ])("parses RSS $format into plain text", async ({ description, body }) => {
    const feed = `<rss><channel><link>https://status.openai.com/incidents/${capturedChatGPTIncident.id}</link><item><title>Resolved</title><pubDate>Thu, 22 Oct 2026 08:50:43 GMT</pubDate><description>${description}</description></item></channel></rss>`;
    const snapshot = await fetchOmittedChatGPTIncident(capturedChatGPTIncident, feed);

    expect(snapshot.incidents).toMatchObject([
      {
        id: capturedChatGPTIncident.id,
        state: "resolved",
        body,
      },
    ]);
  });

  it.each([
    {
      label: "converts a legacy stored body",
      body: "<p>Legacy body</p>",
      bodyNormalized: false,
      expected: "Legacy body",
    },
    {
      label: "preserves an already normalized body",
      body: "<script>alert(1)</script>",
      bodyNormalized: true,
      expected: "<script>alert(1)</script>",
    },
  ])("$label when an RSS update omits its description", async (stored) => {
    const incident = { ...capturedChatGPTIncident, ...stored };
    const feed = `<rss><channel><link>https://status.openai.com/incidents/${incident.id}</link><item><title>Resolved</title><pubDate>Thu, 22 Oct 2026 08:50:43 GMT</pubDate><description></description></item></channel></rss>`;
    const snapshot = await fetchOmittedChatGPTIncident(incident, feed);

    expect(snapshot.incidents).toMatchObject([{ id: incident.id, body: stored.expected }]);
  });

  it.each([
    "Resolved - Elevated ChatGPT conversation and Responses API errors",
    "Elevated ChatGPT conversation and Responses API errors - Resolved",
  ])("recognizes a status appended or prepended in an RSS title: %s", async (title) => {
    const feed = capturedChatGPTFeed
      .replace("<title><![CDATA[Resolved]]></title>", `<title><![CDATA[${title}]]></title>`)
      .replace("<b>Status: Resolved</b>", "");
    const snapshot = await fetchOmittedChatGPTIncident(capturedChatGPTIncident, feed);

    expect(snapshot.incidents).toMatchObject([
      {
        id: capturedChatGPTIncident.id,
        state: "resolved",
        sourceStatus: "Resolved",
      },
    ]);
  });

  it("keeps an omitted incident unverified when its official feed is unavailable", async () => {
    const oldIncident = {
      id: "older-chatgpt-incident",
      title: "Elevated ChatGPT conversation errors",
      body: "We are investigating.",
      kind: "incident" as const,
      state: "investigating" as const,
      sourceStatus: "investigating",
      sourceType: "incident",
      sourceImpact: "major",
      severityStatus: "partial_outage" as const,
      componentIds: [chatgptConversation.id],
      components: [chatgptConversation.name],
      officialCreatedAt: "2026-10-22T02:18:32.000Z",
      officialUpdatedAt: "2026-10-22T02:18:32.000Z",
      url: "https://status.openai.com/incidents/older-chatgpt-incident",
      lifecycle: "active" as const,
      closureReason: null,
      lastObservedAt: "2026-10-22T02:18:32.000Z",
    };
    const snapshot = await fetchChatGPTSnapshot(
      routedResponseFetcher({
        "/api/v2/summary.json": new Response(
          JSON.stringify({ incidents: [], components: chatgptComponentRows() }),
          { headers: { "content-type": "application/json" } },
        ),
      }),
      [oldIncident],
    );

    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.unverifiedIncidentIds).toContain(oldIncident.id);
  });

  it("parses the official OpenAI incident feed shape missing from summary.json", async () => {
    const incidentId = "01M5GPE9C4E19HE461P8JAMYXD";
    const snapshot = await fetchChatGPTSnapshot(
      routedJsonFetcher({
        "/api/v2/summary.json": {
          page: { name: "OpenAI" },
          status: { indicator: "none", description: "All Systems Operational" },
          components: chatgptComponentRows(),
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
        officialUpdatedAt: "2026-10-22T08:50:43.000Z",
      },
    ]);
  });

  it("uses official component links when the incident text has no product name", async () => {
    const conversationId = chatgptConversation.id;
    const snapshot = await fetchChatGPTSnapshot(
      routedJsonFetcher({
        "/api/v2/summary.json": {
          status: { indicator: "none" },
          components: chatgptComponentRows(),
        },
        "/api/v2/incidents.json": {
          incidents: [
            {
              id: "linked-incident",
              name: "A service issue",
              status: "monitoring",
              component_ids: [conversationId],
              components: [{ id: conversationId, name: chatgptConversation.name }],
            },
          ],
        },
      }),
    );

    expect(snapshot.incidents).toMatchObject([
      {
        id: "linked-incident",
        componentIds: [conversationId],
        components: [chatgptConversation.name],
      },
    ]);
  });

  it("uses stable fallback IDs when an incident has no official ID", async () => {
    const firstWithUrl = await fetchOpenAIIncident({
      name: "ChatGPT conversation delays",
      status: "investigating",
      created_at: "2026-10-23T04:00:00Z",
      url: "https://status.openai.com/incidents/shared-url",
    });
    const renamedWithUrl = await fetchOpenAIIncident({
      name: "ChatGPT conversation delays for some users",
      status: "investigating",
      created_at: "2026-10-23T04:00:00Z",
      url: "https://status.openai.com/incidents/shared-url",
    });
    const firstWithTitle = await fetchOpenAIIncident({
      name: "ChatGPT file uploads are delayed",
      status: "investigating",
    });
    const sameTitle = await fetchOpenAIIncident({
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
      fetchChatGPTSnapshot(
        routedJsonFetcher({
          "/api/v2/summary.json": {
            status: { indicator: "none" },
            components: chatgptComponentRows(),
          },
          "/api/v2/incidents.json": { incidents: "not-an-array" },
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });

  it("rejects a component response without the known ChatGPT page section", async () => {
    await expect(
      fetchChatGPTSnapshot(
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
