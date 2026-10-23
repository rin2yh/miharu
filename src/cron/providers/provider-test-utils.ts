import { SERVICES, type ServiceConfig } from "../../shared/config/services";
import type { FetchLike } from "./shared";

export function getService<P extends ServiceConfig["provider"]>(
  id: string,
  provider: P,
): Extract<ServiceConfig, { provider: P }> {
  const service = SERVICES.find((candidate) => candidate.id === id);

  if (!service || service.provider !== provider) {
    throw new Error(`Missing ${provider} service: ${id}`);
  }

  return service as Extract<ServiceConfig, { provider: P }>;
}

export function jsonFetcher(payload: unknown, contentType = "application/json"): FetchLike {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": contentType },
    })) as FetchLike;
}
