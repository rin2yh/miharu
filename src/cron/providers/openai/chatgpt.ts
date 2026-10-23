import type { KnownIncident, ProviderSnapshot } from "../../../domain";
import { asRecord, fetchJson, ProviderError, type FetchLike } from "../shared";
import { parseChatGPTComponents, type OpenAIChatGPTService } from "./chatgpt-components";
import { parseOpenAIChatGPTIncidents } from "./chatgpt-incidents";

export async function fetchOpenAIChatGPTSnapshot(
  service: OpenAIChatGPTService,
  signal: AbortSignal,
  fetcher: FetchLike = fetch,
  knownActiveIncidents: KnownIncident[] = [],
): Promise<ProviderSnapshot> {
  const data = asRecord(await fetchJson(service.summaryUrl, signal, fetcher));
  if (!data || !Array.isArray(data.components)) {
    throw new ProviderError("invalid_payload", "OpenAI summary component list is missing");
  }

  const componentSnapshot = parseChatGPTComponents(service, data.components);
  const incidents = Object.hasOwn(data, "incidents")
    ? parseSummaryIncidents(data.incidents)
    : await fetchIncidentList(service, signal, fetcher);
  const normalizedIncidents = await parseOpenAIChatGPTIncidents(
    service,
    incidents,
    knownActiveIncidents,
    signal,
    fetcher,
  );

  return {
    ...componentSnapshot,
    // The OpenAI page-level status describes more than ChatGPT, so it is omitted.
    summary: null,
    incidents: normalizedIncidents,
    // OpenAI exposes only its 25 most recent incidents and ignores page parameters.
    incidentListComplete: false,
  };
}

function parseSummaryIncidents(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new ProviderError("invalid_payload", "OpenAI summary incident list is invalid");
  }
  return value;
}

async function fetchIncidentList(
  service: OpenAIChatGPTService,
  signal: AbortSignal,
  fetcher: FetchLike,
): Promise<unknown[]> {
  const data = asRecord(await fetchJson(service.incidentsUrl, signal, fetcher));
  if (!data || !Array.isArray(data.incidents)) {
    throw new ProviderError("invalid_payload", "OpenAI incident list is missing");
  }
  return data.incidents;
}
