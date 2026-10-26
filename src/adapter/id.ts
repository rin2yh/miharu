import { stableId } from "../domain/stable-id";

/** Creates the fallback identifier used when a provider omits an incident ID. */
export function stableFallbackId(serviceId: string, fields: Array<string | null>): string {
  return stableId(serviceId, fields);
}
