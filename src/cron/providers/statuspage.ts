import { normalizeStatus, type NormalizedIncident, type ProviderSnapshot } from "../../domain";
import { stableFallbackId } from "../../domain/id";
import { INCIDENTS_PER_SERVICE_LIMIT, type ServiceConfig } from "../../shared/config/services";
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
  statusFromImpact,
  uniqueNames,
  type FetchLike,
} from "./shared";

type StatusPageService = Extract<ServiceConfig, { provider: "statuspage" }>;

export async function fetchStatuspageSnapshot(
  service: StatusPageService,
  signal: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<ProviderSnapshot> {
  const data = asRecord(await fetchJson(service.summaryUrl, signal, fetcher));
  const status = asRecord(data?.status);
  const components = data?.components;
  const incidents = data?.incidents;
  const maintenances = data?.scheduled_maintenances;

  if (
    !data ||
    !status ||
    !Array.isArray(components) ||
    !Array.isArray(incidents) ||
    (service.scheduledMaintenances && !Array.isArray(maintenances))
  ) {
    throw new ProviderError("invalid_payload", "Statuspage summary shape changed");
  }
  const scheduledMaintenances = Array.isArray(maintenances) ? maintenances : [];
  if (incidents.length + scheduledMaintenances.length > INCIDENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "Statuspage incident list exceeded the supported limit",
    );
  }

  const componentNames = new Map<string, string>();
  for (const item of components) {
    const component = asRecord(item);
    if (!component) throw new ProviderError("invalid_payload", "Invalid Statuspage component");
    const id = boundedText(component.id, 200);
    const name = boundedText(component.name, 100);
    if (id && name) componentNames.set(id, name);
  }

  const sourceStatus = requiredText(status.indicator ?? status.status, "status indicator", 100);
  const normalizedIncidents = incidents.map((item) =>
    parseStatuspageIncident(item, service, componentNames, false),
  );
  const normalizedMaintenances = scheduledMaintenances.map((item) =>
    parseStatuspageIncident(item, service, componentNames, true),
  );

  return {
    status: normalizeStatus(sourceStatus),
    sourceStatus,
    summary: boundedText(status.description),
    incidents: [...normalizedIncidents, ...normalizedMaintenances],
  };
}

function parseStatuspageIncident(
  value: unknown,
  service: StatusPageService,
  componentNames: Map<string, string>,
  maintenance: boolean,
): NormalizedIncident {
  const row = asRecord(value);
  if (!row) throw new ProviderError("invalid_payload", "Invalid Statuspage incident");

  const title = requiredText(row.name ?? row.title, "incident title");
  const sourceStatus = requiredText(row.status, "incident status", 100);
  const state = parseIncidentState(sourceStatus);
  const createdAt =
    normalizeTimestamp(row.created_at) ??
    normalizeTimestamp(row.date_created) ??
    normalizeTimestamp(row.scheduled_for);
  const updates = Array.isArray(row.incident_updates) ? row.incident_updates : [];
  const latestUpdate = [...updates]
    .map((update) => asRecord(update))
    .filter((update): update is Record<string, unknown> => update !== null)
    .toSorted((left, right) => {
      const leftTime = Date.parse(String(left.display_at ?? left.created_at ?? "")) || 0;
      const rightTime = Date.parse(String(right.display_at ?? right.created_at ?? "")) || 0;
      return rightTime - leftTime;
    })[0];
  const updatedAt =
    normalizeTimestamp(row.updated_at) ??
    normalizeTimestamp(row.date_updated) ??
    normalizeTimestamp(latestUpdate?.display_at ?? latestUpdate?.created_at);

  const ids = Array.isArray(row.component_ids) ? row.component_ids : [];
  const names = ids.map((id) => (typeof id === "string" ? componentNames.get(id) : undefined));
  const affected = Array.isArray(latestUpdate?.affected_components)
    ? latestUpdate.affected_components
        .map((component) => boundedText(asRecord(component)?.name, 100))
        .filter((name): name is string => Boolean(name))
    : [];
  const directComponents = Array.isArray(row.components)
    ? row.components
        .map((component) => {
          const record = asRecord(component);
          return (
            boundedText(record?.name, 100) ?? (typeof component === "string" ? component : null)
          );
        })
        .filter((name): name is string => Boolean(name))
    : [];
  const components = uniqueNames([...names, ...affected, ...directComponents]);
  const rawId = boundedText(row.id, 200);
  const rawUrl = row.url ?? row.shortlink ?? row.short_link;
  const url = safeIncidentUrl(rawUrl, service);
  const fallbackIdentity = createdAt || url ? [createdAt, url] : [title];
  const id = rawId ?? stableFallbackId(service.id, fallbackIdentity);
  const sourceImpact = boundedText(row.impact, 100);
  const rowType = asRecord(row.incident_type)?.name ?? row.type;
  const sourceType = boundedText(rowType, 100);
  const explicitDescription = boundedText(row.description ?? row.body);
  const updateBody = boundedText(latestUpdate?.body ?? latestUpdate?.update_text);
  const active = isIncidentActive(state);

  return {
    id,
    title,
    body: updateBody ?? explicitDescription,
    kind: maintenance ? "maintenance" : "incident",
    state,
    sourceStatus,
    sourceType,
    sourceImpact,
    severityStatus: maintenance ? "under_maintenance" : statusFromImpact(sourceImpact),
    components,
    officialCreatedAt: createdAt,
    officialUpdatedAt: updatedAt,
    url,
    active,
  };
}
