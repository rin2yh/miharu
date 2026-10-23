import { COLLECTION_TIMEOUT_MS, type ServiceConfig } from "../shared/config/services";
import type { ProviderSnapshot } from "../domain";
import { fetchServiceSnapshot } from "./providers";
import { ProviderError } from "./providers/shared";
import type { CollectionStore } from "../shared/store";

export type SnapshotFetcher = (
  service: ServiceConfig,
  signal: AbortSignal,
) => Promise<ProviderSnapshot>;

export async function collectService(
  service: ServiceConfig,
  observedAt: string,
  store: CollectionStore,
  fetcher: SnapshotFetcher = fetchServiceSnapshot,
): Promise<"ok" | "failed"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), service.timeoutMs ?? COLLECTION_TIMEOUT_MS);
  let snapshot: ProviderSnapshot;

  try {
    snapshot = await fetcher(service, controller.signal);
  } catch (error) {
    const errorCode = getCollectionErrorCode(error, controller.signal.aborted);
    await store.saveFailure(service, observedAt, errorCode);
    return "failed";
  } finally {
    clearTimeout(timeout);
  }

  await store.saveSuccess(service, snapshot, observedAt);
  return "ok";
}

export async function collectAll(
  services: ServiceConfig[],
  observedAt: string,
  store: CollectionStore,
  fetcher: SnapshotFetcher = fetchServiceSnapshot,
): Promise<void> {
  const results = await Promise.allSettled(
    services.map((service) => collectService(service, observedAt, store, fetcher)),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("Status collection persistence failed", services[index]?.id ?? "unknown");
    }
  });
}

function getCollectionErrorCode(error: unknown, timedOut: boolean): string {
  if (timedOut) return "timeout";
  if (error instanceof ProviderError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "network_error";
}
