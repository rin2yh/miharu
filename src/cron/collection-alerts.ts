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
      if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
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
      new Date(Date.parse(now) + 5 * 60 * 1_000).toISOString(),
      20,
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

  for (const alert of alerts) {
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
        await store.releaseCollectionAlert(alert.id);
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
      continue;
    }

    try {
      await store.markCollectionAlertDelivered(alert.id, now);
    } catch (error) {
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
