import { notifyUnknownIncidents, type IncidentAlertStateStore } from "./unknown-incident-alerts";
import { SERVICES, type ServiceConfig } from "../shared/config/services";
import { createD1Store, type CollectionStore } from "../shared/store";
import type { CollectionAlertStateStore } from "../shared/collection-alert-state";
import { collectAll, type SnapshotFetcher } from "./collector";
import {
  getErrorType,
  notifyCollectionFailure,
  notifyCollectionRecovery,
  reportCriticalAlert,
  type CollectionAlertSender,
} from "./collection-alerts";
import { getErrorDiagnostics } from "./error-diagnostics";

interface ScheduledCollectionStore extends CollectionStore {
  pruneHistory(now: Date): Promise<void>;
}

export interface ScheduledCollectionOptions {
  sender?: CollectionAlertSender;
  alertState?: CollectionAlertStateStore;
  incidentAlertState?: IncidentAlertStateStore;
  environment: string;
  services?: ServiceConfig[];
  fetcher?: SnapshotFetcher;
  storeFactory?: (database: D1Database) => ScheduledCollectionStore;
}

export async function collectAtScheduledTime(
  database: D1Database,
  scheduledTime: number,
  options: ScheduledCollectionOptions = { environment: "local" },
): Promise<void> {
  const observedAt = new Date(scheduledTime).toISOString();

  try {
    const store = (options.storeFactory ?? createD1Store)(database);
    const alertSender = options.sender?.enabled ? options.sender : undefined;
    const alertState = alertSender ? options.alertState : undefined;
    await collectAll(options.services ?? SERVICES, observedAt, store, options.fetcher, {
      environment: options.environment,
      onCollectionFailure:
        alertSender && alertState
          ? (service, failedAt, errorCode, errorType, errorMessage, errorCause) =>
              notifyCollectionFailure(
                alertState,
                alertSender,
                service,
                failedAt,
                errorCode,
                errorType,
                options.environment,
                errorMessage,
                errorCause,
              )
          : undefined,
      onCollectionSuccess: async (service, succeededAt, snapshot) => {
        if (alertSender && options.incidentAlertState) {
          await notifyUnknownIncidents(
            options.incidentAlertState,
            alertSender,
            service,
            snapshot.incidents,
            succeededAt,
            options.environment,
          );
        }
        if (alertSender && alertState) {
          await notifyCollectionRecovery(
            alertState,
            alertSender,
            service,
            succeededAt,
            options.environment,
          );
        }
      },
      onPersistenceFailure: async (service, error) =>
        reportCriticalAlert(options.sender, {
          kind:
            error instanceof Error && /StoreError|PersistenceError/.test(error.name)
              ? "persistence_failure"
              : "cron_failure",
          serviceId: service.id,
          serviceName: service.name,
          errorCode:
            error instanceof Error && /StoreError|PersistenceError/.test(error.name)
              ? "d1_persistence_error"
              : "collection_callback_error",
          ...getErrorDiagnostics(error),
          errorCategory:
            error instanceof Error && /StoreError|PersistenceError/.test(error.name)
              ? "D1"
              : "collection_callback",
          occurredAt: observedAt,
          environment: options.environment,
        }),
    });

    if (new Date(scheduledTime).getUTCMinutes() % 15 === 0) {
      try {
        await store.pruneHistory(new Date(scheduledTime));
      } catch (error) {
        await reportCriticalAlert(options.sender, {
          kind: "persistence_failure",
          serviceId: "miharu-d1",
          serviceName: "miharu D1",
          errorCode: "d1_persistence_error",
          ...getErrorDiagnostics(error),
          errorCategory: "D1",
          occurredAt: observedAt,
          environment: options.environment,
        });
      }
    }
  } catch (error) {
    await reportCriticalAlert(options.sender, {
      kind: "cron_failure",
      serviceId: "miharu-cron",
      serviceName: "miharu Cron",
      errorCode: "cron_execution_error",
      ...getErrorDiagnostics(error),
      errorCategory: "cron",
      occurredAt: observedAt,
      environment: options.environment,
    });
  }
}
