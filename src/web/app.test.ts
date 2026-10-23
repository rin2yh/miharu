import { describe, expect, it, vi } from "vitest";
import type { DashboardRows } from "../../db/schema";
import { SERVICES } from "../shared/config/services";
import { createStatusRoutes } from "./routes/api/status";

const slackService = SERVICES.find((service) => service.provider === "slack");
const githubService = SERVICES.find(
  (service) => service.provider === "statuspage" && service.scheduledMaintenances,
);
if (!slackService || !githubService) throw new Error("Service config is missing a test fixture");

const rows: DashboardRows = {
  statusRows: [
    {
      serviceId: slackService.id,
      status: "operational",
      sourceStatus: "ok",
      summary: null,
      lastCheckedAt: "2026-10-23T05:00:00.000Z",
      lastSuccessAt: "2026-10-23T05:00:00.000Z",
      lastErrorAt: "2026-10-23T05:01:00.000Z",
      errorCode: "private_parser_detail",
    },
  ],
  componentRows: [
    {
      serviceId: githubService.id,
      id: "actions",
      name: "Actions",
      status: "degraded_performance",
      sourceStatus: "partial_outage",
      lastChangedAt: "2026-10-23T04:55:00.000Z",
    },
  ],
  activeRows: [
    {
      serviceId: slackService.id,
      id: "incident-1",
      title: "Message delivery delays",
      body: "<p>We are investigating.<br />Update &amp; details</p>",
      kind: "incident",
      state: "investigating",
      sourceStatus: "investigating",
      sourceType: "incident",
      sourceImpact: null,
      severityStatus: "partial_outage",
      componentIdsJson: "[]",
      componentsJson: '["Messaging",4,null]',
      officialCreatedAt: "2026-10-23T04:50:00.000Z",
      officialUpdatedAt: "2026-10-23T04:55:00.000Z",
      url: "https://slack-status.com/2026-10/incident-1",
      active: 1,
      firstSeenAt: "2026-10-23T04:50:00.000Z",
      resolvedDetectedAt: null,
      fingerprint: "fingerprint",
      revision: 1,
      lastObservedAt: "2026-10-23T05:00:00.000Z",
    },
  ],
  eventRows: [
    {
      id: "event-1",
      serviceId: slackService.id,
      incidentId: "incident-1",
      title: "Message delivery delays",
      body: "Private history body",
      kind: "incident",
      eventKind: "opened",
      sourceStatus: "investigating",
      severityStatus: "partial_outage",
      componentIdsJson: "[]",
      componentsJson: '["Messaging"]',
      detectedAt: "2026-10-23T05:00:00.000Z",
      officialEventAt: "2026-10-23T04:50:00.000Z",
      url: "https://slack-status.com/2026-10/incident-1",
    },
  ],
};

describe("status API", () => {
  it("returns registered services, active incidents, and a small public history", async () => {
    const reader = { getDashboardRows: vi.fn<() => Promise<DashboardRows>>(async () => rows) };
    const app = createStatusRoutes(() => reader);
    const response = await app.request("/api/status", {}, { DB: {} as D1Database });
    const payload = (await response.json()) as {
      services: Array<Record<string, unknown>>;
      recentEvents: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=10");
    expect(payload.services.map((service) => service.id)).toEqual(
      SERVICES.map((service) => service.id),
    );
    const slack = payload.services.find((service) => service.id === slackService.id);
    const github = payload.services.find((service) => service.id === githubService.id);
    expect(slack).toMatchObject({
      hasFetchError: true,
      isStale: true,
    });
    expect(slack).not.toHaveProperty("errorCode");
    expect(slack).not.toHaveProperty("lastCheckedAt");
    expect(slack).toMatchObject({
      incidents: [
        {
          title: "Message delivery delays",
          components: ["Messaging"],
          body: "We are investigating.\nUpdate & details",
        },
      ],
    });
    expect(slack).toMatchObject({ components: [] });
    expect(github).toMatchObject({
      components: [
        {
          id: "actions",
          name: "Actions",
          status: "degraded_performance",
          sourceStatus: "partial_outage",
        },
      ],
    });
    expect(payload.recentEvents[0]).toMatchObject({ serviceName: "Slack", eventKind: "opened" });
    expect(payload.recentEvents[0]).not.toHaveProperty("body");
  });

  it("returns a generic unavailable response when D1 cannot be read", async () => {
    const reader = {
      getDashboardRows: vi.fn<() => Promise<DashboardRows>>(() =>
        Promise.reject(new Error("private")),
      ),
    };
    const app = createStatusRoutes(() => reader);
    const response = await app.request("/api/status", {}, { DB: {} as D1Database });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "dashboard_unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
