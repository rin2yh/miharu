import { classifyIncident } from "../adapter/incident-category";
import type { NormalizedIncident } from "../domain";
import type { ServiceConfig } from "../shared/config/services";
import { getErrorType, type CollectionAlertSender } from "./collection-alerts";
import { getErrorDiagnostics } from "./error-diagnostics";

export interface UnknownIncidentAlert {
  kind: "unknown_incident";
  environment: string;
  serviceId: string;
  serviceName: string;
  incidentId: string;
  title: string;
  sourceType: string | null;
  sourceImpact: string | null;
  sourceStatus: string;
  url: string | null;
  detectedAt: string;
}

export interface IncidentAlertStateStore {
  get(key: string): Promise<string | null>;
  put(key: string, fingerprint: string): Promise<void>;
}

export function createKvIncidentAlertStateStore(namespace: KVNamespace): IncidentAlertStateStore {
  return {
    get: (key) => namespace.get(key),
    put: (key, fingerprint) => namespace.put(key, fingerprint),
  };
}

export async function notifyUnknownIncidents(
  stateStore: IncidentAlertStateStore,
  sender: CollectionAlertSender,
  service: ServiceConfig,
  incidents: NormalizedIncident[],
  detectedAt: string,
  environment: string,
): Promise<void> {
  if (!sender.enabled) return;
  for (const incident of incidents) {
    if (classifyIncident(incident, service.provider) !== "unknown") continue;
    try {
      const identity = JSON.stringify([environment, service.id, incident.id]);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
      const key = `incident-classification:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      const fingerprint = JSON.stringify([
        incident.kind,
        incident.sourceType,
        incident.sourceImpact,
      ]);
      // Best-effort deduplication: KV is eventually consistent and this read/send/write
      // sequence is not atomic. Overlapping executions may both send the same alert.
      if ((await stateStore.get(key)) === fingerprint) continue;
      await sender.send({
        kind: "unknown_incident",
        environment,
        serviceId: service.id,
        serviceName: service.name,
        incidentId: incident.id,
        title: incident.title,
        sourceType: incident.sourceType,
        sourceImpact: incident.sourceImpact,
        sourceStatus: incident.sourceStatus,
        url: incident.url,
        detectedAt,
      });
      // A failed delivery remains unacknowledged so the next successful poll retries it.
      // If Discord accepted the alert but acknowledgement fails, that retry may duplicate it.
      await stateStore.put(key, fingerprint);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "incident_classification_notification_failed",
          serviceId: service.id,
          incidentId: incident.id,
          environment,
          ...getErrorDiagnostics(error),
          errorCategory: "notification",
        }),
      );
    }
  }
}

function escapeDiscordText(value: string | null, limit: number): string {
  return (
    (value ?? "(なし)")
      // Control characters must not create forged lines in the notification.
      // eslint-disable-next-line no-control-regex
      .replaceAll(/[\u0000-\u001f\u007f]/g, " ")
      .replaceAll(/([\\`*_{}[\]()<>#+.!|~-])/g, "\\$1")
      .slice(0, limit)
  );
}

export function formatUnknownIncidentAlert(alert: UnknownIncidentAlert) {
  // Ten bounded fields stay below Discord's 1024/field and 6000/embed limits.
  const fields = [
    ["環境", alert.environment, 400],
    ["サービス名", alert.serviceName, 400],
    ["サービスID", alert.serviceId, 400],
    ["インシデントID", alert.incidentId, 400],
    ["タイトル", alert.title, 900],
    ["sourceType", alert.sourceType, 400],
    ["sourceImpact", alert.sourceImpact, 400],
    ["sourceStatus", alert.sourceStatus, 400],
    ["公式URL", alert.url, 900],
    ["検出時刻", alert.detectedAt, 400],
  ] as const;
  return {
    title: "miharu: インシデントの分類不明",
    fields: fields.map(([name, value, limit]) => ({
      name,
      value: escapeDiscordText(value, limit),
    })),
  };
}
