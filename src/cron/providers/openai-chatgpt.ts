import {
  normalizeStatus,
  type NormalizedComponent,
  type NormalizedIncident,
  type NormalizedStatus,
  type ProviderSnapshot,
} from "../../domain";
import {
  COMPONENTS_PER_SERVICE_LIMIT,
  INCIDENTS_PER_SERVICE_LIMIT,
  type ServiceConfig,
} from "../../shared/config/services";
import {
  asRecord,
  boundedText,
  fetchJson,
  isIncidentActive,
  normalizeTimestamp,
  parseIncidentState,
  ProviderError,
  requiredText,
  safeIncidentUrl,
  statusText,
  statusFromImpact,
  uniqueNames,
  type FetchLike,
} from "./shared";

type OpenAIChatGPTService = Extract<ServiceConfig, { provider: "openai-chatgpt" }>;

const statusPriority: Record<NormalizedStatus, number> = {
  unknown: -1,
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};

// OpenAI does not include incidents in summary.json, and its incidents.json
// currently omits component links. Only explicit product/component wording in
// official titles or updates can associate those page-wide incidents with ChatGPT.
const explicitChatGPTIncidentTerms = [
  "chatgpt",
  "chatgpt work",
  "codex in chatgpt desktop",
  "gpts",
  "deep research",
  "voice mode",
  "image generation",
  "file uploads",
];

export async function fetchOpenAIChatGPTSnapshot(
  service: OpenAIChatGPTService,
  signal: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<ProviderSnapshot> {
  const data = asRecord(await fetchJson(service.summaryUrl, signal, fetcher));
  if (!data || !Array.isArray(data.components)) {
    throw new ProviderError("invalid_payload", "OpenAI summary component list is missing");
  }
  if (data.components.length > COMPONENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "OpenAI component list exceeded the supported limit",
    );
  }

  const componentsById = new Map<string, NormalizedComponent>();
  for (const value of data.components) {
    const row = asRecord(value);
    const id = boundedText(row?.id, 200);
    if (!id || !service.componentIds.includes(id)) continue;
    const sourceStatus = requiredText(row?.status, "component status", 100);
    componentsById.set(id, {
      id,
      name: requiredText(row?.name, "component name", 100),
      status: normalizeStatus(sourceStatus),
      sourceStatus,
    });
  }
  const components = service.componentIds
    .map((id) => componentsById.get(id))
    .filter((component): component is NormalizedComponent => component !== undefined);
  if (components.length === 0) {
    throw new ProviderError("invalid_payload", "OpenAI ChatGPT components were not found");
  }

  let incidents: unknown[];
  if (Object.hasOwn(data, "incidents")) {
    if (!Array.isArray(data.incidents)) {
      throw new ProviderError("invalid_payload", "OpenAI summary incident list is invalid");
    }
    incidents = data.incidents;
  } else {
    incidents = await fetchIncidentList(service, signal, fetcher);
  }
  if (incidents.length > INCIDENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError("invalid_payload", "OpenAI incident list exceeded the supported limit");
  }

  const componentNames = new Map(components.map((component) => [component.id, component.name]));
  const normalizedIncidents = incidents
    .map((incident) => parseOpenAIIncident(incident, service, componentNames))
    .filter((incident): incident is NormalizedIncident => incident !== null);
  const overall = components.toSorted(
    (left, right) => statusPriority[right.status] - statusPriority[left.status],
  )[0]!;

  return {
    status: components.some((component) => component.status === "unknown")
      ? "unknown"
      : overall.status,
    sourceStatus: components.some((component) => component.status === "unknown")
      ? "unknown"
      : overall.sourceStatus,
    // The OpenAI page-level status describes more than ChatGPT, so it is omitted.
    summary: null,
    components,
    incidents: normalizedIncidents,
    // OpenAI exposes only its 25 most recent incidents and ignores page parameters.
    incidentListComplete: false,
  };
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

function parseOpenAIIncident(
  value: unknown,
  service: OpenAIChatGPTService,
  componentNames: Map<string, string>,
): NormalizedIncident | null {
  const row = asRecord(value);
  if (!row) throw new ProviderError("invalid_payload", "Invalid OpenAI incident");

  const title = requiredText(row.name ?? row.title, "incident title");
  const sourceStatus = requiredText(row.status, "incident status", 100);
  const state = parseIncidentState(sourceStatus);
  const updates = Array.isArray(row.incident_updates) ? row.incident_updates : [];
  const parsedUpdates = updates
    .map((update) => asRecord(update))
    .filter((update): update is Record<string, unknown> => update !== null)
    .toSorted((left, right) => {
      const leftTime = Date.parse(String(left.display_at ?? left.created_at ?? "")) || 0;
      const rightTime = Date.parse(String(right.display_at ?? right.created_at ?? "")) || 0;
      return rightTime - leftTime;
    });
  const latestUpdate = parsedUpdates[0];
  const explicitNames = [...parsedUpdates]
    .map((update) => statusText(update.body ?? update.update_text))
    .filter((body): body is string => body !== null);
  if (!incidentBelongsToChatGPT(title, explicitNames, row, componentNames)) return null;

  const componentIds = uniqueNames(
    Array.isArray(row.component_ids) ? row.component_ids : [],
    COMPONENTS_PER_SERVICE_LIMIT,
  ).filter((id) => componentNames.has(id));
  const affectedNames = Array.isArray(latestUpdate?.affected_components)
    ? latestUpdate.affected_components
        .map((component) => boundedText(asRecord(component)?.name, 100))
        .filter((name): name is string => Boolean(name))
    : [];
  const directNames = Array.isArray(row.components)
    ? row.components
        .map((component) => {
          const record = asRecord(component);
          return (
            boundedText(record?.name, 100) ?? (typeof component === "string" ? component : null)
          );
        })
        .filter((name): name is string => Boolean(name))
    : [];
  const components = uniqueNames([
    ...componentIds.map((id) => componentNames.get(id)),
    ...affectedNames.filter((name) => [...componentNames.values()].includes(name)),
    ...directNames.filter((name) => [...componentNames.values()].includes(name)),
  ]);
  const rawId = boundedText(row.id, 200);
  const createdAt = normalizeTimestamp(row.created_at);
  const updatedAt =
    normalizeTimestamp(row.updated_at) ??
    normalizeTimestamp(latestUpdate?.display_at ?? latestUpdate?.created_at);
  const id = rawId;
  if (!id) throw new ProviderError("invalid_payload", "Missing OpenAI incident id");
  const rawUrl = row.url ?? row.shortlink ?? row.short_link;
  const url = safeIncidentUrl(
    rawUrl ?? new URL(`incidents/${encodeURIComponent(id)}`, service.statusPageUrl).toString(),
    service,
  );
  const sourceImpact = boundedText(row.impact, 100);

  return {
    id,
    title,
    body: statusText(latestUpdate?.body ?? latestUpdate?.update_text),
    kind: "incident",
    state,
    sourceStatus,
    sourceType: "incident",
    sourceImpact,
    severityStatus: statusFromImpact(sourceImpact),
    componentIds,
    components,
    officialCreatedAt: createdAt,
    officialUpdatedAt: updatedAt,
    url,
    active: isIncidentActive(state),
  };
}

function incidentBelongsToChatGPT(
  title: string,
  updateBodies: string[],
  row: Record<string, unknown>,
  componentNames: Map<string, string>,
): boolean {
  const selectedIds = new Set(componentNames.keys());
  const componentIds = Array.isArray(row.component_ids) ? row.component_ids : [];
  if (componentIds.some((id) => typeof id === "string" && selectedIds.has(id))) return true;

  const directNames = Array.isArray(row.components)
    ? row.components.map((component) => boundedText(asRecord(component)?.name ?? component, 100))
    : [];
  if (directNames.some((name) => name && [...componentNames.values()].includes(name))) return true;

  const affectedNames = Array.isArray(row.incident_updates)
    ? row.incident_updates.flatMap((update) => {
        const updateRecord = asRecord(update);
        return Array.isArray(updateRecord?.affected_components)
          ? updateRecord.affected_components.map((component) =>
              boundedText(asRecord(component)?.name, 100),
            )
          : [];
      })
    : [];
  if (affectedNames.some((name) => name && [...componentNames.values()].includes(name)))
    return true;

  const officialText = `${title} ${updateBodies.join(" ")}`.toLocaleLowerCase();
  return explicitChatGPTIncidentTerms.some((term) => officialText.includes(term));
}
