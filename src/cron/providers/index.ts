import type { ProviderSnapshot } from "../../domain";
import type { ServiceConfig } from "../../shared/config/services";
import { fetchSlackSnapshot } from "./slack";
import { fetchStatuspageSnapshot } from "./statuspage";
import type { FetchLike } from "./shared";

export async function fetchServiceSnapshot(
  service: ServiceConfig,
  signal: AbortSignal,
  fetcher?: FetchLike,
): Promise<ProviderSnapshot> {
  if (service.provider === "slack") return fetchSlackSnapshot(service, signal, fetcher);
  return fetchStatuspageSnapshot(service, signal, fetcher);
}
