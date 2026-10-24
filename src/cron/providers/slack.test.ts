import { describe, expect, it } from "vitest";
import { SERVICES, type ServiceConfig } from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import { fetchSlackSnapshot } from "./slack";
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

function providerContext(fetcher: FetchLike): ProviderContext {
  return { signal: abortSignal, fetcher, getUnresolvedIncidents: async () => [] };
}

const slack = getService("slack", "slack");

describe("Slack provider", () => {
  it("keeps Slack's incident type without inventing a severity", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      providerContext(
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
      ),
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
      providerContext(jsonFetcher({ status: "ok", active_incidents: [] })),
    );
    expect(snapshot.status).toBe("operational");
    expect(snapshot.incidents).toEqual([]);
  });

  it("rejects HTML and malformed responses", async () => {
    await expect(
      fetchSlackSnapshot(slack, providerContext(jsonFetcher({}, "text/html"))),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(
      fetchSlackSnapshot(slack, providerContext(jsonFetcher({ status: "ok" }))),
    ).rejects.toMatchObject({
      code: "invalid_payload",
    });
  });
});
