export interface CollectionAlertState {
  consecutiveFailures: number;
  firstFailedAt: string;
  lastFailedAt: string;
  errorCode: string;
  errorType: string;
  errorMessage?: string;
  errorCause?: string;
  errorCategory?: string;
  notified: boolean;
  notificationSuppressed?: boolean;
}

export interface CollectionAlertStateStore {
  get(serviceId: string): Promise<CollectionAlertState | null>;
  put(serviceId: string, state: CollectionAlertState): Promise<void>;
  delete(serviceId: string): Promise<void>;
}

const COLLECTION_ALERT_KEY_PREFIX = "collection-alert:";
const COLLECTION_ALERT_CACHE_TTL_SECONDS = 30;

export function createKvCollectionAlertStateStore(
  namespace: KVNamespace,
): CollectionAlertStateStore {
  return {
    get(serviceId) {
      return namespace.get<CollectionAlertState>(collectionAlertKey(serviceId), {
        type: "json",
        cacheTtl: COLLECTION_ALERT_CACHE_TTL_SECONDS,
      });
    },
    async put(serviceId, state) {
      await namespace.put(collectionAlertKey(serviceId), JSON.stringify(state));
    },
    async delete(serviceId) {
      await namespace.delete(collectionAlertKey(serviceId));
    },
  };
}

function collectionAlertKey(serviceId: string): string {
  return `${COLLECTION_ALERT_KEY_PREFIX}${serviceId}`;
}
