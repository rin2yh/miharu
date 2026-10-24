import { describe, expect, it, vi } from "vitest";
import type { CollectionAlertStore } from "../shared/store";
import {
  createDiscordAlertSender,
  dispatchPendingCollectionAlerts,
  reportCriticalAlert,
} from "./collection-alerts";

function alertStore(overrides: Partial<CollectionAlertStore> = {}): CollectionAlertStore {
  return {
    getUnresolvedIncidents: vi.fn<CollectionAlertStore["getUnresolvedIncidents"]>(async () => []),
    saveSuccess: vi.fn<CollectionAlertStore["saveSuccess"]>(async () => undefined),
    saveFailure: vi.fn<CollectionAlertStore["saveFailure"]>(async () => undefined),
    claimPendingCollectionAlerts: vi.fn<CollectionAlertStore["claimPendingCollectionAlerts"]>(
      async () => [
        {
          id: "slack:failure:2026-10-24T05:02:00.000Z",
          kind: "failure" as const,
          serviceId: "slack",
          serviceName: "Slack",
          errorCode: "timeout",
          errorType: "TimeoutError",
          firstFailedAt: "2026-10-24T05:00:00.000Z",
          failureCount: 3,
          createdAt: "2026-10-24T05:02:00.000Z",
        },
      ],
    ),
    markCollectionAlertDelivered: vi.fn<CollectionAlertStore["markCollectionAlertDelivered"]>(
      async () => undefined,
    ),
    releaseCollectionAlert: vi.fn<CollectionAlertStore["releaseCollectionAlert"]>(
      async () => undefined,
    ),
    ...overrides,
  };
}

describe("Discord collection alerts", () => {
  it("sends a service-specific message without allowing mentions", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      enabled: true,
      environment: "production",
      fetcher,
    });
    const store = alertStore();

    await dispatchPendingCollectionAlerts(store, sender, "2026-10-24T05:03:00.000Z", "production");

    expect(fetcher).toHaveBeenCalledOnce();
    const request = fetcher.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body)) as {
      content: string;
      allowed_mentions: { parse: string[] };
    };
    expect(payload.content).toContain("Slack (slack)");
    expect(payload.content).toContain("timeout");
    expect(payload.content).toContain("TimeoutError");
    expect(payload.content).toContain("2026-10-24T05:00:00.000Z");
    expect(payload.content).toContain("失敗回数: 3");
    expect(payload.content).toContain("環境: production");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(store.markCollectionAlertDelivered).toHaveBeenCalledWith(
      "slack:failure:2026-10-24T05:02:00.000Z",
      "2026-10-24T05:03:00.000Z",
    );
  });

  it("releases failed deliveries for a later retry and records a structured error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      enabled: true,
      environment: "production",
      fetcher,
    });
    const store = alertStore();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await dispatchPendingCollectionAlerts(
        store,
        sender,
        "2026-10-24T05:03:00.000Z",
        "production",
      );
      expect(log.mock.calls[0]?.[0]).toContain('"event":"discord_notification_failed"');
    } finally {
      log.mockRestore();
    }

    expect(store.markCollectionAlertDelivered).not.toHaveBeenCalled();
    expect(store.releaseCollectionAlert).toHaveBeenCalledWith(
      "slack:failure:2026-10-24T05:02:00.000Z",
    );
  });

  it("does not send when alerts are disabled or the webhook is missing", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const store = alertStore();
    const disabledSender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      enabled: false,
      environment: "preview",
      fetcher,
    });
    const missingSecretSender = createDiscordAlertSender({
      enabled: true,
      environment: "local",
      fetcher,
    });

    await dispatchPendingCollectionAlerts(
      store,
      disabledSender,
      "2026-10-24T05:03:00.000Z",
      "preview",
    );
    await reportCriticalAlert(missingSecretSender, {
      kind: "cron_failure",
      serviceId: "miharu-cron",
      serviceName: "miharu Cron",
      errorCode: "cron_execution_error",
      errorType: "Error",
      occurredAt: "2026-10-24T05:03:00.000Z",
      environment: "local",
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(store.claimPendingCollectionAlerts).not.toHaveBeenCalled();
  });
});
