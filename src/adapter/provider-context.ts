import type { KnownIncident } from "../domain";

export interface ProviderContext {
  signal: AbortSignal;
  fetcher: typeof fetch;
  getUnresolvedIncidents: () => Promise<KnownIncident[]>;
}
