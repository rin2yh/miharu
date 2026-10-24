import type { ServiceConfig } from "../shared/config/services";
import type {
  CollectionAlertState,
  CollectionAlertStateStore,
} from "../shared/collection-alert-state";

export type CollectionAlert = {
  kind: "failure" | "recovery";
  serviceId: string;
  serviceName: string;
  errorCode: string;
  errorType: string;
  firstFailedAt: string;
  lastFailedAt?: string;
  failureCount: number;
};

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

export async function notifyCollectionFailure(
  stateStore: CollectionAlertStateStore,
  sender: CollectionAlertSender | undefined,
  service: ServiceConfig,
  occurredAt: string,
  errorCode: string,
  errorType: string,
  environment: string,
): Promise<void> {
  let alert: CollectionAlert | undefined;
  try {
    alert = await recordCollectionFailure(stateStore, service, occurredAt, errorCode, errorType);
  } catch (error) {
    reportLog("collection_alert_state_failed", {
      kind: "failure",
      serviceId: service.id,
      serviceName: service.name,
      errorCode: "kv_state_error",
      errorType: getErrorType(error),
      environment,
    });
    return;
  }

  if (!alert) return;

  if (!sender?.enabled) {
    await saveCollectionAlertDeliveryState(stateStore, alert, false, true, environment);
    return;
  }

  if (await sendCollectionAlert(sender, alert, environment)) {
    await saveCollectionAlertDeliveryState(stateStore, alert, true, false, environment);
  }
}

export async function notifyCollectionRecovery(
  stateStore: CollectionAlertStateStore,
  sender: CollectionAlertSender | undefined,
  service: ServiceConfig,
  recoveredAt: string,
  environment: string,
): Promise<void> {
  let alert: CollectionAlert | undefined;
  try {
    alert = await recordCollectionRecovery(stateStore, service, recoveredAt);
  } catch (error) {
    reportLog("collection_alert_state_failed", {
      kind: "recovery",
      serviceId: service.id,
      serviceName: service.name,
      errorCode: "kv_state_error",
      errorType: getErrorType(error),
      environment,
    });
    return;
  }

  if (alert) await sendCollectionAlert(sender, alert, environment);
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

export async function recordCollectionFailure(
  stateStore: CollectionAlertStateStore,
  service: ServiceConfig,
  occurredAt: string,
  errorCode: string,
  errorType: string,
): Promise<CollectionAlert | undefined> {
  const previous = await stateStore.get(service.id);
  if (
    previous?.notified ||
    previous?.notificationSuppressed ||
    (previous && previous.lastFailedAt >= occurredAt)
  ) {
    return undefined;
  }

  const state: CollectionAlertState = {
    consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    firstFailedAt: previous?.firstFailedAt ?? occurredAt,
    lastFailedAt: occurredAt,
    errorCode,
    errorType,
    notified: false,
    notificationSuppressed: false,
  };
  await stateStore.put(service.id, state);

  if (state.consecutiveFailures < 3) return undefined;
  return {
    kind: "failure",
    serviceId: service.id,
    serviceName: service.name,
    errorCode: state.errorCode,
    errorType: state.errorType,
    firstFailedAt: state.firstFailedAt,
    lastFailedAt: state.lastFailedAt,
    failureCount: state.consecutiveFailures,
  };
}

async function saveCollectionAlertDeliveryState(
  stateStore: CollectionAlertStateStore,
  alert: CollectionAlert,
  notified: boolean,
  notificationSuppressed: boolean,
  environment: string,
): Promise<void> {
  try {
    await stateStore.put(alert.serviceId, {
      consecutiveFailures: alert.failureCount,
      firstFailedAt: alert.firstFailedAt,
      lastFailedAt: alert.lastFailedAt ?? alert.firstFailedAt,
      errorCode: alert.errorCode,
      errorType: alert.errorType,
      notified,
      notificationSuppressed,
    });
  } catch (error) {
    reportLog("collection_alert_state_failed", {
      kind: "failure",
      serviceId: alert.serviceId,
      serviceName: alert.serviceName,
      errorCode: "kv_state_error",
      errorType: getErrorType(error),
      environment,
    });
  }
}

export async function recordCollectionRecovery(
  stateStore: CollectionAlertStateStore,
  service: ServiceConfig,
  recoveredAt: string,
): Promise<CollectionAlert | undefined> {
  const previous = await stateStore.get(service.id);
  if (!previous || previous.lastFailedAt >= recoveredAt) return undefined;

  await stateStore.delete(service.id);
  if (!previous.notified) return undefined;

  return {
    kind: "recovery",
    serviceId: service.id,
    serviceName: service.name,
    errorCode: previous.errorCode,
    errorType: previous.errorType,
    firstFailedAt: previous.firstFailedAt,
    failureCount: previous.consecutiveFailures,
  };
}

async function sendCollectionAlert(
  sender: CollectionAlertSender | undefined,
  alert: CollectionAlert,
  environment: string,
): Promise<boolean> {
  if (!sender?.enabled) return false;
  try {
    await sender.send(alert);
    return true;
  } catch (error) {
    reportLog("discord_notification_failed", {
      kind: alert.kind,
      serviceId: alert.serviceId,
      errorCode: "discord_delivery_error",
      errorType: getErrorType(error),
      environment,
    });
    return false;
  }
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
