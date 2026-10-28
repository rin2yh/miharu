import { COLLECTION_TIMEOUT_MS, type ServiceConfig } from "../shared/config/services";
import type { ProviderSnapshot } from "../domain";
import { fetchServiceSnapshot } from "../adapter";
import type { ProviderContext } from "../adapter/provider-context";
import { ProviderError } from "../adapter/shared";
import type { CollectionStore } from "../shared/store";
import { getErrorType } from "./collection-alerts";
import { getErrorDiagnostics } from "./error-diagnostics";

export type SnapshotFetcher = (
  service: ServiceConfig,
  context: ProviderContext,
) => Promise<ProviderSnapshot>;

export interface CollectorOptions {
  environment?: string;
  onPersistenceFailure?: (service: ServiceConfig, error: unknown) => Promise<void>;
  onCollectionFailure?: (
    service: ServiceConfig,
    observedAt: string,
    errorCode: string,
    errorType: string,
    errorMessage?: string,
    errorCause?: string,
    errorCategory?: string,
  ) => Promise<void>;
  onCollectionSuccess?: (
    service: ServiceConfig,
    observedAt: string,
    snapshot: ProviderSnapshot,
  ) => Promise<void>;
}

class CollectionPersistenceError extends Error {
  constructor(cause: unknown) {
    super("Collection persistence failed", { cause });
    this.name = "CollectionPersistenceError";
  }
}

class CollectionStoreError extends Error {
  constructor(cause: unknown) {
    super("D1 collection store operation failed", { cause });
    this.name = "CollectionStoreError";
  }
}

export async function collectService(
  service: ServiceConfig,
  observedAt: string,
  store: CollectionStore,
  fetcher: SnapshotFetcher = fetchServiceSnapshot,
  options: CollectorOptions = {},
): Promise<"ok" | "failed"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), service.timeoutMs ?? COLLECTION_TIMEOUT_MS);
  let snapshot: ProviderSnapshot;

  try {
    const context: ProviderContext = {
      signal: controller.signal,
      fetcher: fetch,
      getUnresolvedIncidents: async () => {
        try {
          return await store.getUnresolvedIncidents(service.id);
        } catch (error) {
          throw new CollectionPersistenceError(error);
        }
      },
    };
    snapshot = await fetcher(service, context);
  } catch (error) {
    if (error instanceof CollectionPersistenceError) throw error;
    const errorCode = getCollectionErrorCode(error, controller.signal.aborted);
    const diagnostics = getErrorDiagnostics(error);
    const errorMessage = diagnostics.errorMessage;
    console.warn(
      JSON.stringify({
        event: "status_collection_failed",
        serviceId: service.id,
        serviceName: service.name,
        errorCode,
        errorType: getErrorType(error),
        ...(errorMessage ? { errorMessage } : {}),
        ...(diagnostics.errorCause ? { errorCause: diagnostics.errorCause } : {}),
        environment: options.environment ?? "unknown",
      }),
    );
    try {
      await store.saveFailure(service, observedAt, errorCode);
    } catch (storeError) {
      throw new CollectionStoreError(storeError);
    }
    await options.onCollectionFailure?.(
      service,
      observedAt,
      errorCode,
      getErrorType(error),
      errorMessage,
      diagnostics.errorCause,
      diagnostics.errorCategory,
    );
    return "failed";
  } finally {
    clearTimeout(timeout);
  }

  try {
    await store.saveSuccess(service, snapshot, observedAt);
  } catch (storeError) {
    throw new CollectionStoreError(storeError);
  }
  await options.onCollectionSuccess?.(service, observedAt, snapshot);
  return "ok";
}

export async function collectAll(
  services: ServiceConfig[],
  observedAt: string,
  store: CollectionStore,
  fetcher: SnapshotFetcher = fetchServiceSnapshot,
  options: CollectorOptions = {},
): Promise<void> {
  await Promise.all(
    services.map(async (service) => {
      try {
        await collectService(service, observedAt, store, fetcher, options);
      } catch (error) {
        const isD1Error =
          error instanceof CollectionStoreError || error instanceof CollectionPersistenceError;
        const diagnostics = getErrorDiagnostics(error);
        const errorCategory = isD1Error ? "D1" : diagnostics.errorCategory;
        console.error(
          JSON.stringify({
            event: "status_collection_error",
            serviceId: service.id,
            serviceName: service.name,
            errorCode: isD1Error
              ? "d1_persistence_error"
              : `collection_${errorCategory.toLowerCase()}_error`,
            ...diagnostics,
            errorCategory,
            environment: options.environment ?? "unknown",
          }),
        );
        if (options.onPersistenceFailure) {
          try {
            await options.onPersistenceFailure(service, error);
          } catch (notificationError) {
            console.error(
              JSON.stringify({
                event: "discord_notification_failed",
                kind: "persistence_failure",
                serviceId: service.id,
                errorCode: "discord_delivery_error",
                ...getErrorDiagnostics(notificationError),
                errorCategory: "Discord",
                environment: options.environment ?? "unknown",
              }),
            );
          }
        }
      }
    }),
  );
}

function getCollectionErrorCode(error: unknown, timedOut: boolean): string {
  if (timedOut) return "timeout";
  if (error instanceof ProviderError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "network_error";
}
