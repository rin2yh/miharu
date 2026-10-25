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
              id: "546",
              title: "Slack’s forwarding email feature is failing for some customers",
              status: "active",
              type: "incident",
              date_created: "2018-09-07T14:35:00-07:00",
              date_updated: "2018-09-07T18:34:15-07:00",
              url: "https://slack-status.com/2018-09/7dea1cd14cd0f657",
              services: ["Apps/Integrations/APIs"],
              notes: [
                {
                  date_created: "2018-09-07T18:34:15-07:00",
                  body: "Email forwarding addresses are failing for some customers.",
                },
              ],
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
      officialUpdatedAt: "2018-09-08T01:34:15.000Z",
      body: "Email forwarding addresses are failing for some customers.",
      components: ["Apps/Integrations/APIs"],
    });
    expect(snapshot.components).toHaveLength(slack.components.length);
    expect(snapshot.components).toContainEqual({
      id: "apps-integrations-apis",
      name: "Apps/Integrations/APIs",
      status: "unknown",
      sourceStatus: "affected",
    });
    expect(snapshot.components).toContainEqual({
      id: "messaging",
      name: "Messaging",
      status: "unknown",
      sourceStatus: "not_reported",
    });
  });

  it("normalizes Slack's healthy response", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      providerContext(jsonFetcher({ status: "ok", active_incidents: [] })),
    );
    expect(snapshot.status).toBe("operational");
    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.components).toHaveLength(slack.components.length);
    expect(snapshot.components?.every((component) => component.status === "operational")).toBe(
      true,
    );
    expect(
      snapshot.components?.every((component) => component.sourceStatus === "not_reported"),
    ).toBe(true);
  });

  it("keeps unreported features unknown when Slack's global status is abnormal", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      providerContext(jsonFetcher({ status: "active", active_incidents: [] })),
    );

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.components?.every((component) => component.status === "unknown")).toBe(true);
    expect(
      snapshot.components?.every((component) => component.sourceStatus === "not_reported"),
    ).toBe(true);
  });

  it("does not assign undocumented service names to a feature component", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      providerContext(
        jsonFetcher({
          status: "active",
          active_incidents: [
            {
              id: "slack-unknown-service",
              title: "An issue in an undocumented service",
              status: "active",
              type: "incident",
              services: ["Undocumented feature"],
            },
          ],
        }),
      ),
    );

    expect(snapshot.incidents[0]?.components).toEqual(["Undocumented feature"]);
    expect(
      snapshot.components?.every((component) => component.sourceStatus === "not_reported"),
    ).toBe(true);
  });

  it("keeps a scheduled feature unknown before the maintenance start time", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      providerContext(
        jsonFetcher({
          status: "active",
          active_incidents: [
            {
              id: "slack-maintenance",
              title: "Scheduled maintenance for Huddles",
              status: "scheduled",
              type: "notice",
              date_created: "2999-01-01T00:00:00Z",
              services: ["Huddles"],
            },
          ],
        }),
      ),
    );

    expect(snapshot.components).toContainEqual({
      id: "huddles",
      name: "Huddles",
      status: "unknown",
      sourceStatus: "scheduled",
    });
    expect(snapshot.incidents[0]).toMatchObject({
      kind: "maintenance",
      state: "scheduled",
    });
  });

  it("marks a scheduled feature as under maintenance after its documented start time", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      providerContext(
        jsonFetcher({
          status: "active",
          active_incidents: [
            {
              id: "slack-maintenance-started",
              title: "Scheduled maintenance for Huddles",
              status: "scheduled",
              type: "notice",
              date_created: "2000-01-01T00:00:00Z",
              services: ["Huddles"],
            },
          ],
        }),
      ),
    );

    expect(snapshot.components).toContainEqual({
      id: "huddles",
      name: "Huddles",
      status: "under_maintenance",
      sourceStatus: "scheduled",
    });
    expect(snapshot.incidents[0]).toMatchObject({
      kind: "maintenance",
      state: "scheduled",
    });
  });

  it("keeps the current component state unknown when scheduled maintenance has no start time", async () => {
    const snapshot = await fetchSlackSnapshot(
      slack,
      providerContext(
        jsonFetcher({
          status: "active",
          active_incidents: [
            {
              id: "slack-maintenance-without-start",
              title: "Scheduled maintenance for Huddles",
              status: "scheduled",
              type: "notice",
              services: ["Huddles"],
            },
          ],
        }),
      ),
    );

    expect(snapshot.components).toContainEqual({
      id: "huddles",
      name: "Huddles",
      status: "unknown",
      sourceStatus: "scheduled",
    });
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
