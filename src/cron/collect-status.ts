import { SERVICES, type ServiceConfig } from "../shared/config/services";
import { createD1Store } from "../shared/store";
import { collectAll, type SnapshotFetcher } from "./collector";
import type { CollectionAlertStore } from "../shared/store";
import {
  dispatchPendingCollectionAlerts,
  getErrorType,
  reportCriticalAlert,
  type CollectionAlertSender,
} from "./collection-alerts";

interface ScheduledCollectionStore extends CollectionAlertStore {
  pruneHistory(now: Date): Promise<void>;
}

export interface ScheduledCollectionOptions {
  sender?: CollectionAlertSender;
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
    await collectAll(options.services ?? SERVICES, observedAt, store, options.fetcher, {
      environment: options.environment,
      onPersistenceFailure: async (service, error) =>
        reportCriticalAlert(options.sender, {
          kind: "persistence_failure",
          serviceId: service.id,
          serviceName: service.name,
          errorCode: "d1_persistence_error",
          errorType: getErrorType(error),
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
          errorType: getErrorType(error),
          occurredAt: observedAt,
          environment: options.environment,
        });
      }
    }

    await dispatchPendingCollectionAlerts(store, options.sender, observedAt, options.environment);
  } catch (error) {
    await reportCriticalAlert(options.sender, {
      kind: "cron_failure",
      serviceId: "miharu-cron",
      serviceName: "miharu Cron",
      errorCode: "cron_execution_error",
      errorType: getErrorType(error),
      occurredAt: observedAt,
      environment: options.environment,
    });
  }
}
