import { describe, expect, it, vi } from "vitest";
import {
  createKvCollectionAlertStateStore,
  type CollectionAlertState,
  type CollectionAlertStateStore,
} from "../shared/collection-alert-state";
import { SERVICES } from "../shared/config/services";
import {
  createDiscordAlertSender,
  notifyCollectionFailure,
  notifyCollectionRecovery,
  recordCollectionFailure,
} from "./collection-alerts";

const service = SERVICES.find(({ id }) => id === "slack");
if (!service) throw new Error("Slack service config is missing");

function stateStore() {
  const states = new Map<string, CollectionAlertState>();
  const get = vi.fn<CollectionAlertStateStore["get"]>(async (serviceId) => {
    return states.get(serviceId) ?? null;
  });
  const put = vi.fn<CollectionAlertStateStore["put"]>(async (serviceId, state) => {
    states.set(serviceId, state);
  });
  const deleteState = vi.fn<CollectionAlertStateStore["delete"]>(async (serviceId) => {
    states.delete(serviceId);
  });
  return {
    states,
    get,
    put,
    delete: deleteState,
  };
}

describe("Discord collection alerts with KV state", () => {
  it("alerts immediately on invalid_payload, suppresses repeats, and announces recovery", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      fetcher,
    });
    const store = stateStore();
    const failedAt = "2026-10-24T05:00:00.000Z";

    await notifyCollectionFailure(
      store,
      sender,
      service,
      failedAt,
      "invalid_payload",
      "ProviderError",
      "production",
      "Statuspage summary shape changed",
    );
    await notifyCollectionFailure(
      store,
      sender,
      service,
      "2026-10-24T05:01:00.000Z",
      "invalid_payload",
      "ProviderError",
      "production",
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const failure = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { content: string };
    expect(failure.content).toContain("エラーコード: invalid_payload");
    expect(failure.content).toContain("エラー詳細: Statuspage summary shape changed");
    expect(failure.content).toContain(`発生時刻: ${failedAt}`);
    expect(failure.content).toContain("環境: production");

    await notifyCollectionRecovery(
      store,
      sender,
      service,
      "2026-10-24T05:02:00.000Z",
      "production",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    const recovery = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as { content: string };
    expect(recovery.content).toContain("収集が復旧");
    expect(recovery.content).toContain("復旧時刻: 2026-10-24T05:02:00.000Z");
  });

  it.each([
    { notified: true, notificationSuppressed: false, label: "a prior notified error" },
    { notified: false, notificationSuppressed: true, label: "a prior suppressed error" },
  ])(
    "notifies invalid_payload when KV contains $label",
    async ({ notified, notificationSuppressed }) => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
      const sender = createDiscordAlertSender({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        fetcher,
      });
      const store = stateStore();
      store.states.set(service.id, {
        consecutiveFailures: 5,
        firstFailedAt: "2026-10-24T04:55:00.000Z",
        lastFailedAt: "2026-10-24T04:59:00.000Z",
        errorCode: "timeout",
        errorType: "TimeoutError",
        notified,
        notificationSuppressed,
      });

      await notifyCollectionFailure(
        store,
        sender,
        service,
        "2026-10-24T05:00:00.000Z",
        "invalid_payload",
        "ProviderError",
        "production",
      );

      expect(fetcher).toHaveBeenCalledOnce();
      expect(store.states.get(service.id)).toMatchObject({
        errorCode: "invalid_payload",
        notified: true,
        notificationSuppressed: false,
      });
    },
  );

  it("retries invalid_payload after Discord failure and records notified only after success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      fetcher,
    });
    const store = stateStore();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await notifyCollectionFailure(
        store,
        sender,
        service,
        "2026-10-24T05:00:00.000Z",
        "invalid_payload",
        "ProviderError",
        "production",
      );
      expect(store.states.get(service.id)).toMatchObject({
        errorCode: "invalid_payload",
        notified: false,
        notificationSuppressed: false,
      });

      await notifyCollectionFailure(
        store,
        sender,
        service,
        "2026-10-24T05:01:00.000Z",
        "invalid_payload",
        "ProviderError",
        "production",
      );
      expect(store.states.get(service.id)).toMatchObject({ notified: true });

      await notifyCollectionFailure(
        store,
        sender,
        service,
        "2026-10-24T05:02:00.000Z",
        "invalid_payload",
        "ProviderError",
        "production",
      );
    } finally {
      log.mockRestore();
    }

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.states.get(service.id)?.consecutiveFailures).toBe(2);
  });

  it("stores service state as JSON under a service-specific KV key", async () => {
    const namespace = {
      get: vi.fn<
        (
          key: string,
          options: { type: "json"; cacheTtl: number },
        ) => Promise<CollectionAlertState | null>
      >(async () => null),
      put: vi.fn<(key: string, value: string) => Promise<void>>(async () => undefined),
      delete: vi.fn<(key: string) => Promise<void>>(async () => undefined),
    } as unknown as KVNamespace;
    const store = createKvCollectionAlertStateStore(namespace);
    const state: CollectionAlertState = {
      consecutiveFailures: 2,
      firstFailedAt: "2026-10-24T05:00:00.000Z",
      lastFailedAt: "2026-10-24T05:01:00.000Z",
      errorCode: "timeout",
      errorType: "TimeoutError",
      notified: false,
    };

    await store.get("slack");
    await store.put("slack", state);
    await store.delete("slack");

    expect(namespace.get).toHaveBeenCalledWith("collection-alert:slack", {
      type: "json",
      cacheTtl: 30,
    });
    expect(namespace.put).toHaveBeenCalledWith("collection-alert:slack", JSON.stringify(state));
    expect(namespace.delete).toHaveBeenCalledWith("collection-alert:slack");
  });

  it("sends one failure alert on the third failure and stops writes until recovery", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      fetcher,
    });
    const store = stateStore();

    for (const minute of [0, 1, 2]) {
      await notifyCollectionFailure(
        store,
        sender,
        service,
        `2026-10-24T05:0${minute}:00.000Z`,
        "timeout",
        "TimeoutError",
        "production",
        "Missing incident status",
      );
      expect(fetcher).toHaveBeenCalledTimes(minute === 2 ? 1 : 0);
    }

    await notifyCollectionFailure(
      store,
      sender,
      service,
      "2026-10-24T05:03:00.000Z",
      "timeout",
      "TimeoutError",
      "production",
    );

    expect(store.put).toHaveBeenCalledTimes(4);
    expect(store.states.get(service.id)).toMatchObject({
      consecutiveFailures: 3,
      firstFailedAt: "2026-10-24T05:00:00.000Z",
      lastFailedAt: "2026-10-24T05:02:00.000Z",
      errorCode: "timeout",
      errorType: "TimeoutError",
      notified: true,
    });
    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      content: string;
      allowed_mentions: { parse: string[] };
    };
    expect(payload.content).toContain("収集失敗が継続");
    expect(payload.content).toContain("Slack (slack)");
    expect(payload.content).toContain("失敗回数: 3");
    expect(payload.content).toContain("エラー詳細: Missing incident status");
    expect(payload.content).toContain("環境: production");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("clears a notified service state and sends recovery once", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      fetcher,
    });
    const store = stateStore();
    store.states.set(service.id, {
      consecutiveFailures: 3,
      firstFailedAt: "2026-10-24T05:00:00.000Z",
      lastFailedAt: "2026-10-24T05:02:00.000Z",
      errorCode: "timeout",
      errorType: "TimeoutError",
      notified: true,
    });

    await notifyCollectionRecovery(
      store,
      sender,
      service,
      "2026-10-24T05:03:00.000Z",
      "production",
    );
    await notifyCollectionRecovery(
      store,
      sender,
      service,
      "2026-10-24T05:03:00.000Z",
      "production",
    );

    expect(store.delete).toHaveBeenCalledOnce();
    expect(store.states.has(service.id)).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { content: string };
    expect(payload.content).toContain("収集が復旧");
  });

  it("clears failures that recover before the notification threshold", async () => {
    const store = stateStore();
    await recordCollectionFailure(store, service, "2026-10-24T05:00:00.000Z", "timeout", "Error");
    await recordCollectionFailure(store, service, "2026-10-24T05:01:00.000Z", "timeout", "Error");

    await notifyCollectionRecovery(
      store,
      undefined,
      service,
      "2026-10-24T05:02:00.000Z",
      "production",
    );

    expect(store.delete).toHaveBeenCalledOnce();
    expect(store.states.has(service.id)).toBe(false);
  });

  it("ignores duplicate failure timestamps and stale recovery events", async () => {
    const store = stateStore();
    const observedAt = "2026-10-24T05:01:00.000Z";

    await recordCollectionFailure(store, service, observedAt, "timeout", "Error");
    await recordCollectionFailure(store, service, observedAt, "timeout", "Error");
    await notifyCollectionRecovery(store, undefined, service, observedAt, "production");

    expect(store.put).toHaveBeenCalledOnce();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.states.get(service.id)?.consecutiveFailures).toBe(1);
  });

  it("retries a failed webhook on later collection failures", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      fetcher,
    });
    const store = stateStore();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      for (const minute of [0, 1, 2, 3]) {
        await notifyCollectionFailure(
          store,
          sender,
          service,
          `2026-10-24T05:0${minute}:00.000Z`,
          "timeout",
          "TimeoutError",
          "production",
        );
      }
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('"event":"discord_notification_failed"'),
      );
    } finally {
      log.mockRestore();
    }

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.put).toHaveBeenCalledTimes(4);
    expect(store.states.get(service.id)).toMatchObject({
      consecutiveFailures: 4,
      lastFailedAt: "2026-10-24T05:03:00.000Z",
      notified: false,
      notificationSuppressed: false,
    });
  });

  it("marks the notification guard only after a later webhook attempt succeeds", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      fetcher,
    });
    const store = stateStore();

    for (const minute of [0, 1, 2, 3, 4]) {
      await notifyCollectionFailure(
        store,
        sender,
        service,
        `2026-10-24T05:0${minute}:00.000Z`,
        "timeout",
        "TimeoutError",
        "production",
      );
    }

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.states.get(service.id)).toMatchObject({
      consecutiveFailures: 4,
      lastFailedAt: "2026-10-24T05:03:00.000Z",
      notified: true,
      notificationSuppressed: false,
    });
  });

  it("keeps service failure counts isolated", async () => {
    const notion = SERVICES.find(({ id }) => id === "notion");
    if (!notion) throw new Error("Notion service config is missing");
    const store = stateStore();

    await recordCollectionFailure(store, service, "2026-10-24T05:00:00.000Z", "timeout", "Error");
    await recordCollectionFailure(
      store,
      notion,
      "2026-10-24T05:00:00.000Z",
      "network_error",
      "TypeError",
    );

    expect(store.states.get(service.id)?.consecutiveFailures).toBe(1);
    expect(store.states.get(notion.id)?.consecutiveFailures).toBe(1);
  });

  it("does not send without an enabled webhook", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const sender = createDiscordAlertSender({
      webhookUrl: undefined,
      fetcher,
    });
    const store = stateStore();

    for (const minute of [0, 1, 2]) {
      await notifyCollectionFailure(
        store,
        sender,
        service,
        `2026-10-24T05:0${minute}:00.000Z`,
        "timeout",
        "TimeoutError",
        "preview",
      );
    }

    expect(fetcher).not.toHaveBeenCalled();
    expect(store.states.get(service.id)).toMatchObject({
      notified: false,
      notificationSuppressed: true,
    });
  });
});
