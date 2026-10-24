import type { CollectionAlertNotificationRow } from "../../db/schema";
import type { CollectionAlertStore } from "../shared/store";

export type CollectionAlert = CollectionAlertNotificationRow;

export type CriticalCollectionAlert = {
  kind: "persistence_failure" | "cron_failure";
  serviceId: string;
  serviceName: string;
  errorCode: string;
  errorType: string;
  occurredAt: string;
  environment: string;
};

export interface CollectionAlertSender {
  enabled: boolean;
  send(alert: CollectionAlert | CriticalCollectionAlert): Promise<void>;
}

const MAX_PENDING_ALERTS_PER_RUN = 8;
const MAX_CONCURRENT_SERVICE_GROUPS = 4;
const ALERT_LEASE_MS = 5 * 60 * 1_000;
const RETRY_BASE_DELAY_MS = 60 * 1_000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1_000;

class DiscordDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DiscordDeliveryError";
  }
}

interface DiscordAlertConfig {
  webhookUrl?: string;
  enabled: boolean;
  environment: string;
  fetcher?: typeof fetch;
}

export function createDiscordAlertSender(config: DiscordAlertConfig): CollectionAlertSender {
  const webhookUrl = config.webhookUrl;
  const enabled = config.enabled && isDiscordWebhookUrl(webhookUrl);

  return {
    enabled,
    async send(alert) {
      if (!enabled || !webhookUrl) return;
      const response = await (config.fetcher ?? fetch)(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: formatAlert(alert, config.environment),
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        const retryAfterMs = response.status === 429 ? await getRetryAfterMs(response) : undefined;
        throw new DiscordDeliveryError(
          `Discord webhook returned HTTP ${response.status}`,
          response.status,
          retryAfterMs,
        );
      }
    },
  };
}

export async function dispatchPendingCollectionAlerts(
  store: CollectionAlertStore,
  sender: CollectionAlertSender | undefined,
  now: string,
  environment: string,
): Promise<void> {
  if (!sender?.enabled) return;

  let alerts: CollectionAlertNotificationRow[];
  try {
    alerts = await store.claimPendingCollectionAlerts(
      now,
      new Date(Date.parse(now) + ALERT_LEASE_MS).toISOString(),
      MAX_PENDING_ALERTS_PER_RUN,
    );
  } catch (error) {
    await reportCriticalAlert(sender, {
      kind: "persistence_failure",
      serviceId: "miharu-d1",
      serviceName: "miharu D1",
      errorCode: "d1_persistence_error",
      errorType: getErrorType(error),
      occurredAt: now,
      environment,
    });
    return;
  }

  const alertsByService = new Map<string, CollectionAlertNotificationRow[]>();
  for (const alert of alerts.toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )) {
    const serviceAlerts = alertsByService.get(alert.serviceId) ?? [];
    serviceAlerts.push(alert);
    alertsByService.set(alert.serviceId, serviceAlerts);
  }

  const serviceQueues = [...alertsByService.values()];
  let nextQueueIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_SERVICE_GROUPS, serviceQueues.length) },
      async () => {
        while (nextQueueIndex < serviceQueues.length) {
          const serviceQueue = serviceQueues[nextQueueIndex++];
          if (!serviceQueue) continue;
          for (const alert of serviceQueue) {
            await dispatchAlert(store, sender, alert, now, environment);
          }
        }
      },
    ),
  );
}

async function dispatchAlert(
  store: CollectionAlertStore,
  sender: CollectionAlertSender,
  alert: CollectionAlertNotificationRow,
  now: string,
  environment: string,
): Promise<void> {
  try {
    await sender.send(alert);
  } catch (error) {
    reportLog("discord_notification_failed", {
      kind: alert.kind,
      serviceId: alert.serviceId,
      errorCode: "discord_delivery_error",
      errorType: getErrorType(error),
      environment,
    });
    try {
      await store.releaseCollectionAlert(alert.id, getNextAttemptAt(alert, error, now));
    } catch (releaseError) {
      await reportCriticalAlert(sender, {
        kind: "persistence_failure",
        serviceId: alert.serviceId,
        serviceName: alert.serviceName,
        errorCode: "d1_persistence_error",
        errorType: getErrorType(releaseError),
        occurredAt: now,
        environment,
      });
    }
    return;
  }

  try {
    await store.markCollectionAlertDelivered(alert.id, now);
  } catch (error) {
    // Delivery is at-least-once: if D1 cannot record this ACK, the lease expiry can cause a duplicate.
    await reportCriticalAlert(sender, {
      kind: "persistence_failure",
      serviceId: alert.serviceId,
      serviceName: alert.serviceName,
      errorCode: "d1_persistence_error",
      errorType: getErrorType(error),
      occurredAt: now,
      environment,
    });
  }
}

function getNextAttemptAt(
  alert: CollectionAlertNotificationRow,
  error: unknown,
  now: string,
): string {
  if (error instanceof DiscordDeliveryError && error.retryAfterMs !== undefined) {
    return new Date(Date.now() + Math.max(1_000, error.retryAfterMs)).toISOString();
  }

  const exponent = Math.min(Math.max(alert.attempts - 1, 0), 10);
  const retryDelayMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** exponent);
  return new Date(Date.parse(now) + retryDelayMs).toISOString();
}

async function getRetryAfterMs(response: Response): Promise<number | undefined> {
  const headerDelay = parseRetryAfter(response.headers.get("retry-after"));
  let bodyDelay: number | undefined;
  try {
    const body: unknown = await response.clone().json();
    if (
      typeof body === "object" &&
      body !== null &&
      "retry_after" in body &&
      typeof body.retry_after === "number" &&
      Number.isFinite(body.retry_after) &&
      body.retry_after >= 0
    ) {
      const delay = body.retry_after * 1_000;
      if (Number.isFinite(delay)) bodyDelay = delay;
    }
  } catch {
    // A missing or non-JSON body is valid; the header is the primary source.
  }

  if (headerDelay === undefined) return bodyDelay;
  if (bodyDelay === undefined) return headerDelay;
  return Math.max(headerDelay, bodyDelay);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (/^\d+(\.\d+)?$/.test(normalized)) {
    const delay = Number(normalized) * 1_000;
    return Number.isFinite(delay) ? delay : undefined;
  }
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

export async function reportCriticalAlert(
  sender: CollectionAlertSender | undefined,
  alert: CriticalCollectionAlert,
): Promise<void> {
  reportLog(alert.kind, {
    serviceId: alert.serviceId,
    serviceName: alert.serviceName,
    errorCode: alert.errorCode,
    errorType: alert.errorType,
    environment: alert.environment,
  });
  if (!sender?.enabled) return;

  try {
    await sender.send(alert);
  } catch (error) {
    reportLog("discord_notification_failed", {
      kind: alert.kind,
      serviceId: alert.serviceId,
      errorCode: "discord_delivery_error",
      errorType: getErrorType(error),
      environment: alert.environment,
    });
  }
}

export function getErrorType(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][\w.]{0,63}$/.test(error.name)) return error.name;
  return "UnknownError";
}

function formatAlert(
  alert: CollectionAlert | CriticalCollectionAlert,
  environment: string,
): string {
  if ("firstFailedAt" in alert) {
    const headline = alert.kind === "failure" ? "収集失敗が継続" : "収集が復旧";
    return [
      `**miharu: ${headline}**`,
      `サービス: ${alert.serviceName} (${alert.serviceId})`,
      `エラー種別: ${alert.errorType}`,
      `エラーコード: ${alert.errorCode}`,
      `初回失敗: ${alert.firstFailedAt}`,
      `失敗回数: ${alert.failureCount}`,
      `環境: ${environment}`,
    ].join("\n");
  }

  const headline = alert.kind === "persistence_failure" ? "D1永続化エラー" : "Cron全体エラー";
  return [
    `**miharu: ${headline}**`,
    `サービス: ${alert.serviceName} (${alert.serviceId})`,
    `エラーコード: ${alert.errorCode}`,
    `エラー種別: ${alert.errorType}`,
    `発生時刻: ${alert.occurredAt}`,
    "失敗回数: 1",
    `環境: ${alert.environment}`,
  ].join("\n");
}

function isDiscordWebhookUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "discord.com" || url.hostname === "discordapp.com") &&
      url.pathname.startsWith("/api/webhooks/") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function reportLog(
  event: string,
  details: {
    kind?: string;
    serviceId: string;
    serviceName?: string;
    errorCode: string;
    errorType: string;
    environment: string;
  },
): void {
  console.error(JSON.stringify({ event, ...details }));
}
