import { describe, expect, it, vi } from "vitest";
import { SERVICES } from "../shared/config/services";
import { incident } from "../web/test-fixtures";
import type { CollectionAlertSender } from "./collection-alerts";
import type { CollectionStore } from "../shared/store";
import type { CollectionAlertStateStore } from "../shared/collection-alert-state";
import { createDiscordAlertSender } from "./collection-alerts";
import { collectAtScheduledTime } from "./collect-status";
import {
  createKvIncidentAlertStateStore,
  notifyUnknownIncidents,
  type IncidentAlertStateStore,
} from "./unknown-incident-alerts";

const service = SERVICES.find((entry) => entry.id === "notion")!;
const detectedAt = "2026-10-26T05:01:00.000Z";
const unknown = incident({ sourceImpact: null, sourceType: null });
function setup() {
  const values = new Map<string, string>();
  const state: IncidentAlertStateStore = {
    get: vi.fn<IncidentAlertStateStore["get"]>(async (key) => values.get(key) ?? null),
    put: vi.fn<IncidentAlertStateStore["put"]>(async (key, value) => {
      values.set(key, value);
    }),
  };
  const sender = { enabled: true, send: vi.fn<CollectionAlertSender["send"]>(async () => {}) };
  return {
    state,
    sender,
    notify: (entries = [unknown], environment = "preview") =>
      notifyUnknownIncidents(state, sender, service, entries, detectedAt, environment),
  };
}

describe("unknown incident alerts", () => {
  it("notifies immediately, deduplicates polls and retries when evidence changes", async () => {
    const { sender, notify } = setup();
    await notify();
    await notify();
    await notify([{ ...unknown, title: "renamed", sourceStatus: "monitoring" }]);
    expect(sender.send).toHaveBeenCalledTimes(1);
    await notify([{ ...unknown, sourceImpact: "future" }]);
    expect(sender.send).toHaveBeenCalledTimes(2);
    await notify([unknown], "production");
    expect(sender.send).toHaveBeenCalledTimes(3);
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "unknown_incident",
        serviceId: "notion",
        incidentId: unknown.id,
        title: unknown.title,
        sourceType: null,
        sourceImpact: null,
        sourceStatus: unknown.sourceStatus,
        url: unknown.url,
        detectedAt,
        environment: "preview",
      }),
    );
  });

  it("does not notify known categories", async () => {
    const { sender, notify } = setup();
    await notify([
      incident(),
      incident({ sourceImpact: "none" }),
      incident({ kind: "maintenance" }),
    ]);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("logs delivery failure, retries on the next poll, then suppresses duplicates", async () => {
    const { sender, state, notify } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sender.send.mockRejectedValueOnce(new Error("delivery failed"));
    await notify();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("incident_classification_notification_failed"),
    );
    expect(state.put).not.toHaveBeenCalled();
    await notify();
    await notify();
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it("isolates KV failure from other incidents", async () => {
    const { state, sender, notify } = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(state.get).mockRejectedValueOnce(new Error("KV unavailable"));
    await notify([unknown, { ...unknown, id: "second" }]);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("stores acknowledgements in its own KV namespace prefix", async () => {
    const get = vi.fn<IncidentAlertStateStore["get"]>(async () => null);
    const put = vi.fn<IncidentAlertStateStore["put"]>(async () => {});
    const state = createKvIncidentAlertStateStore({ get, put } as unknown as KVNamespace);
    await notifyUnknownIncidents(
      state,
      { enabled: true, send: vi.fn<CollectionAlertSender["send"]>() },
      service,
      [unknown],
      detectedAt,
      "preview",
    );
    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/^incident-classification:[0-9a-f]{64}$/),
    );
    expect(put).toHaveBeenCalledWith(expect.any(String), JSON.stringify(["incident", null, null]));
  });

  it("saves a successful snapshot despite Discord failure and still runs recovery", async () => {
    const { state, sender } = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    sender.send.mockRejectedValueOnce(new Error("delivery failed"));
    const store = {
      getUnresolvedIncidents: vi.fn<CollectionStore["getUnresolvedIncidents"]>(async () => []),
      saveSuccess: vi.fn<CollectionStore["saveSuccess"]>(async () => {}),
      saveFailure: vi.fn<CollectionStore["saveFailure"]>(async () => {}),
      pruneHistory: vi.fn<() => Promise<void>>(async () => {}),
    };
    const recovery = {
      get: vi.fn<CollectionAlertStateStore["get"]>(async () => null),
      put: vi.fn<CollectionAlertStateStore["put"]>(),
      delete: vi.fn<CollectionAlertStateStore["delete"]>(),
    };
    await collectAtScheduledTime({} as D1Database, Date.parse(detectedAt), {
      environment: "preview",
      sender,
      alertState: recovery,
      incidentAlertState: state,
      services: [service],
      fetcher: async () => ({
        status: "operational",
        sourceStatus: "none",
        summary: null,
        incidents: [unknown],
      }),
      storeFactory: () => store,
    });
    expect(store.saveSuccess).toHaveBeenCalledOnce();
    expect(store.saveFailure).not.toHaveBeenCalled();
    expect(recovery.get).toHaveBeenCalledWith(service.id);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("escapes untrusted fields, disables mentions and bounds Discord content", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const sender = createDiscordAlertSender({
      webhookUrl: "https://discord.com/api/webhooks/test/token",
      fetcher,
    });
    const { state } = setup();
    await notifyUnknownIncidents(
      state,
      sender,
      service,
      [{ ...unknown, title: "**@everyone**\n<@123>", sourceType: "`injected`" }],
      detectedAt,
      "preview",
    );
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].fields).toEqual(
      expect.arrayContaining([
        { name: "タイトル", value: "\\*\\*@everyone\\*\\* \\<@123\\>" },
        { name: "sourceType", value: "\\`injected\\`" },
        { name: "sourceImpact", value: "\\(なし\\)" },
      ]),
    );
    await notifyUnknownIncidents(
      state,
      sender,
      service,
      [
        {
          ...unknown,
          id: "long",
          title: "*".repeat(500),
          sourceType: "*".repeat(100),
          sourceImpact: "*".repeat(100),
          sourceStatus: "*".repeat(100),
          url: "*".repeat(2000),
        },
      ],
      detectedAt,
      "*".repeat(300),
    );
    const embed = JSON.parse(fetcher.mock.calls[1][1]!.body as string).embeds[0];
    expect(JSON.stringify(embed).length).toBeLessThan(6000);
    for (const field of embed.fields) expect(field.value.length).toBeLessThanOrEqual(1024);
  });
});
