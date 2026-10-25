import { describe, expect, it, vi } from "vitest";
import type { DashboardRows } from "../../db/schema";
import type { DashboardPayload } from "../domain";
import { SERVICES } from "../shared/config/services";
import { buildDashboardPayload, createStatusRoutes } from "./routes/api/status";

const slackService = SERVICES.find((service) => service.provider === "slack");
const githubService = SERVICES.find(
  (service) => service.provider === "statuspage" && service.scheduledMaintenances,
);
const cloudflareService = SERVICES.find(
  (service) => service.provider === "statuspage" && service.componentGroupId !== undefined,
);
if (!slackService || !githubService || !cloudflareService) {
  throw new Error("Service config is missing a test fixture");
}

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
  incidentRows: [
    {
      serviceId: slackService.id,
      id: "incident-1",
      title: "Message delivery delays",
      body: "We are investigating.\nUpdate & details",
      bodyNormalized: true,
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
      lifecycle: "active",
      closureReason: null,
      firstSeenAt: "2026-10-23T04:50:00.000Z",
      closedDetectedAt: null,
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
      state: "investigating",
      closureReason: null,
      sourceStatus: "investigating",
      sourceType: "incident",
      sourceImpact: null,
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
  it("converts D1 rows directly into the public dashboard payload", () => {
    const dashboard = buildDashboardPayload(rows, new Date("2026-10-23T05:03:00.000Z"), 180);
    const slack = dashboard.services.find((service) => service.id === slackService.id);
    const notion = dashboard.services.find((service) => service.id === "notion");
    const github = dashboard.services.find((service) => service.id === githubService.id);

    expect(dashboard.generatedAt).toBe("2026-10-23T05:03:00.000Z");
    expect(dashboard.freshnessWarningSeconds).toBe(180);
    expect(slack).toMatchObject({
      isStale: false,
      hasFetchError: true,
      incidents: [{ body: "We are investigating.\nUpdate & details" }],
    });
    expect(notion).toMatchObject({
      status: "unknown",
      isStale: true,
      components: [],
      incidents: [],
    });
    expect(github).toMatchObject({
      status: "unknown",
      isStale: true,
      components: [{ id: "actions", status: "degraded_performance" }],
    });
    expect(dashboard.recentEvents[0]).toMatchObject({ serviceName: "Slack" });
    expect(dashboard.recentEvents[0]).not.toHaveProperty("body");
  });

  it("ignores rows belonging to services that are not registered", () => {
    const dashboard = buildDashboardPayload(
      {
        ...rows,
        componentRows: [
          ...rows.componentRows,
          { ...rows.componentRows[0]!, serviceId: "unregistered" },
        ],
        incidentRows: [
          ...rows.incidentRows,
          { ...rows.incidentRows[0]!, serviceId: "unregistered" },
        ],
        eventRows: [...rows.eventRows, { ...rows.eventRows[0]!, serviceId: "unregistered" }],
      },
      new Date("2026-10-23T05:00:00.000Z"),
    );

    expect(dashboard.services.flatMap((service) => service.components)).toHaveLength(1);
    expect(dashboard.services.flatMap((service) => service.incidents)).toHaveLength(1);
    expect(dashboard.recentEvents).toHaveLength(1);
  });

  it("does not parse already normalized text a second time", () => {
    const dashboard = buildDashboardPayload(
      {
        ...rows,
        incidentRows: [
          {
            ...rows.incidentRows[0]!,
            body: "Status: Resolved\n<script>alert(1)</script>",
            bodyNormalized: true,
          },
        ],
      },
      new Date("2026-10-23T05:00:00.000Z"),
    );

    expect(
      dashboard.services.find((service) => service.id === slackService.id)?.incidents[0]?.body,
    ).toBe("Status: Resolved\n<script>alert(1)</script>");
  });

  it("converts legacy D1 bodies until a Provider refreshes them", () => {
    const dashboard = buildDashboardPayload(
      {
        ...rows,
        incidentRows: [
          {
            ...rows.incidentRows[0]!,
            body: "<p>Legacy body<br />Update &amp; details</p>",
            bodyNormalized: false,
          },
        ],
      },
      new Date("2026-10-23T05:00:00.000Z"),
    );

    expect(
      dashboard.services.find((service) => service.id === slackService.id)?.incidents[0]?.body,
    ).toBe("Legacy body\nUpdate & details");
  });

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
    const cloudflare = payload.services.find((service) => service.id === cloudflareService.id);
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
          lifecycle: "active",
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
    expect(cloudflare).toMatchObject({
      id: cloudflareService.id,
      name: "Cloudflare",
      statusPageUrl: "https://www.cloudflarestatus.com/",
    });
    expect(payload.recentEvents[0]).toMatchObject({ serviceName: "Slack", eventKind: "opened" });
    expect(payload.recentEvents[0]).not.toHaveProperty("body");
  });

  it("returns only requested services and deduplicates IDs before reading the store", async () => {
    const reader = {
      getDashboardRows: vi.fn<(serviceIds?: readonly string[]) => Promise<DashboardRows>>(
        async () => rows,
      ),
    };
    const app = createStatusRoutes(() => reader);
    const response = await app.request(
      "/api/status?services=github,slack,github",
      {},
      { DB: {} as D1Database },
    );
    const payload = (await response.json()) as DashboardPayload;

    expect(response.status).toBe(200);
    expect(reader.getDashboardRows).toHaveBeenCalledWith([slackService.id, githubService.id]);
    expect(payload.services.map(({ id }) => id)).toEqual([slackService.id, githubService.id]);
    expect(payload.recentEvents.map(({ serviceId }) => serviceId)).toEqual([slackService.id]);
  });

  it.each(["", "slack,", "slack,unknown", "unknown"])(
    "rejects empty or unknown service IDs before reading D1: %s",
    async (serviceQuery) => {
      const reader = { getDashboardRows: vi.fn<() => Promise<DashboardRows>>(async () => rows) };
      const app = createStatusRoutes(() => reader);
      const response = await app.request(
        `/api/status?services=${encodeURIComponent(serviceQuery)}`,
        {},
        { DB: {} as D1Database },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_services" });
      expect(reader.getDashboardRows).not.toHaveBeenCalled();
    },
  );

  it.each([
    { environment: "production", seconds: 180, ageSeconds: 600, isStale: true },
    { environment: "preview", seconds: 2_700, ageSeconds: 600, isStale: false },
    { environment: "preview after 45 minutes", seconds: 2_700, ageSeconds: 2_701, isStale: true },
  ])(
    "uses the $environment freshness threshold in the API response and stale state",
    async ({ seconds, ageSeconds, isStale }) => {
      const checkedAt = new Date(Date.now() - ageSeconds * 1_000).toISOString();
      const recentRows: DashboardRows = {
        ...rows,
        statusRows: rows.statusRows.map((row) => ({ ...row, lastSuccessAt: checkedAt })),
      };
      const reader = {
        getDashboardRows: vi.fn<() => Promise<DashboardRows>>(async () => recentRows),
      };
      const app = createStatusRoutes(() => reader);
      const response = await app.request(
        "/api/status",
        {},
        { DB: {} as D1Database, FRESHNESS_WARNING_SECONDS: String(seconds) },
      );
      const payload = (await response.json()) as DashboardPayload;
      const slack = payload.services.find((service) => service.id === slackService.id);

      expect(response.status).toBe(200);
      expect(payload.freshnessWarningSeconds).toBe(seconds);
      expect(slack?.isStale).toBe(isStale);
    },
  );

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
