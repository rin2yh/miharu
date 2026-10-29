import {
  normalizeStatus,
  type NormalizedComponent,
  type NormalizedIncident,
  type ProviderSnapshot,
} from "../domain";
import { stableFallbackId } from "./id";
import {
  COMPONENTS_PER_SERVICE_LIMIT,
  INCIDENTS_PER_SERVICE_LIMIT,
  type ServiceConfig,
} from "../shared/config/services";
import type { ProviderContext } from "./provider-context";
import {
  asRecord,
  boundedText,
  fetchJson,
  normalizeTimestamp,
  parseIncidentState,
  ProviderError,
  requiredText,
  safeIncidentUrl,
  statusText,
  statusFromImpact,
  uniqueNames,
} from "./shared";

type StatusPageService = Extract<ServiceConfig, { provider: "statuspage" }>;

function parseStatuspageComponents(
  components: unknown[],
  service: StatusPageService,
): NormalizedComponent[] {
  const selected = selectStatuspageComponents(components, service.componentGroupId);
  if (selected.length > COMPONENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "Statuspage component list exceeded the supported limit",
    );
  }
  return selected.map(parseStatuspageComponent);
}

function selectStatuspageComponents(components: unknown[], groupId?: string): unknown[] {
  if (!groupId) return components;

  const group = components
    .map((component) => asRecord(component))
    .find((component) => component?.id === groupId && component.group === true);
  const memberIds = Array.isArray(group?.components)
    ? group.components.filter((id): id is string => typeof id === "string")
    : [];

  if (!group || memberIds.length === 0) {
    throw new ProviderError("invalid_payload", "Configured Statuspage component group is missing");
  }

  const members = new Set(memberIds);
  const selected = components.filter((component) => {
    const row = asRecord(component);
    return (
      row !== null &&
      row.group !== true &&
      row.group_id === groupId &&
      typeof row.id === "string" &&
      members.has(row.id)
    );
  });

  // An incomplete success would make store synchronization delete omitted components.
  if (selected.length === 0 || selected.length !== memberIds.length) {
    throw new ProviderError(
      "invalid_payload",
      "Configured Statuspage component group is empty or incomplete",
    );
  }
  return selected;
}

function parseStatuspageComponent(value: unknown): NormalizedComponent {
  const row = asRecord(value);
  if (!row) throw new ProviderError("invalid_payload", "Invalid Statuspage component");
  const sourceStatus = requiredText(row.status, "component status", 100);
  return {
    id: requiredText(row.id, "component id", 200),
    name: requiredText(row.name, "component name", 100),
    status: normalizeStatus(sourceStatus),
    sourceStatus,
  };
}

export async function fetchStatuspageSnapshot(
  service: StatusPageService,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  const { signal, fetcher } = context;
  const data = asRecord(await fetchJson(service.summaryUrl, signal, fetcher));
  const status = asRecord(data?.status);
  const components = data?.components;
  const incidents = data?.incidents;
  const maintenances = data?.scheduled_maintenances;
  const incidentListComplete = Array.isArray(incidents);
  const missingNotionIncidentList = service.id === "notion" && incidents === undefined;

  if (
    !data ||
    !status ||
    !Array.isArray(components) ||
    (!incidentListComplete && !missingNotionIncidentList) ||
    (service.scheduledMaintenances && !Array.isArray(maintenances))
  ) {
    const invalidFields = [
      !data && "summary",
      data && !status && "status",
      data && !Array.isArray(components) && "components",
      data && !incidentListComplete && !missingNotionIncidentList && "incidents",
      service.scheduledMaintenances && !Array.isArray(maintenances) && "scheduled_maintenances",
    ].filter((field): field is string => typeof field === "string");
    throw new ProviderError(
      "invalid_payload",
      `Statuspage summary shape changed: invalid ${invalidFields.join(", ")}`,
    );
  }
  const incidentRows = incidentListComplete ? incidents : [];
  const scheduledMaintenances = Array.isArray(maintenances) ? maintenances : [];
  if (incidentRows.length + scheduledMaintenances.length > INCIDENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "Statuspage incident list exceeded the supported limit",
    );
  }

  const normalizedComponents = parseStatuspageComponents(components, service);
  const componentIdFilter = service.componentGroupId
    ? new Set(normalizedComponents.map((component) => component.id))
    : undefined;
  const componentNames = new Map(
    normalizedComponents.map((component) => [component.id, component.name]),
  );

  const sourceStatus = requiredText(status.indicator ?? status.status, "status indicator", 100);
  const normalizedIncidents = incidentRows.map((item) =>
    parseStatuspageIncident(item, service, componentNames, false, componentIdFilter),
  );
  const normalizedMaintenances = scheduledMaintenances.map((item) =>
    parseStatuspageIncident(item, service, componentNames, true, componentIdFilter),
  );
  const allIncidents = [...normalizedIncidents, ...normalizedMaintenances];

  return {
    status: normalizeStatus(sourceStatus),
    sourceStatus,
    summary: statusText(status.description),
    components: normalizedComponents,
    incidentListComplete,
    incidents: componentIdFilter
      ? allIncidents.filter((incident) =>
          incident.componentIds.some((id) => componentIdFilter.has(id)),
        )
      : allIncidents,
  };
}

function parseStatuspageIncident(
  value: unknown,
  service: StatusPageService,
  componentNames: Map<string, string>,
  maintenance: boolean,
  componentIdFilter?: Set<string>,
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
  const latestUpdate = latestStatuspageUpdate(updates);
  const updatedAt =
    normalizeTimestamp(row.updated_at) ??
    normalizeTimestamp(row.date_updated) ??
    normalizeTimestamp(latestUpdate?.display_at ?? latestUpdate?.created_at);

  const ids = Array.isArray(row.component_ids)
    ? row.component_ids.filter((id): id is string => typeof id === "string")
    : [];
  const directComponentRows = Array.isArray(row.components)
    ? row.components.map((component) => asRecord(component))
    : [];
  const directIds = directComponentRows
    .map((component) => boundedText(component?.id, 200))
    .filter((id): id is string => id !== null);
  const latestAffectedIds = Array.isArray(latestUpdate?.affected_components)
    ? latestUpdate.affected_components
        .map((component) => boundedText(asRecord(component)?.code, 200))
        .filter((id): id is string => id !== null)
    : [];
  const sourceIncidentIds = componentIdFilter
    ? [...ids, ...directIds, ...latestAffectedIds].filter((id) => componentIdFilter.has(id))
    : ids;
  const incidentIds = uniqueNames(sourceIncidentIds, COMPONENTS_PER_SERVICE_LIMIT);
  const names = (componentIdFilter && ids.length === 0 ? directIds : ids).map((id) =>
    componentNames.get(id),
  );
  const affected = Array.isArray(latestUpdate?.affected_components)
    ? latestUpdate.affected_components
        .map((component) => {
          const record = asRecord(component);
          if (
            componentIdFilter &&
            (typeof record?.code !== "string" || !componentIdFilter.has(record.code))
          ) {
            return null;
          }
          return componentIdFilter
            ? (componentNames.get(String(record?.code)) ?? boundedText(record?.name, 100))
            : boundedText(record?.name, 100);
        })
        .filter((name): name is string => Boolean(name))
    : [];
  const directComponents = Array.isArray(row.components)
    ? row.components
        .map((component) => {
          const record = asRecord(component);
          const componentId = boundedText(record?.id, 200);
          if (componentIdFilter && (!componentId || !componentIdFilter.has(componentId))) {
            return null;
          }
          return (
            boundedText(record?.name, 100) ?? (typeof component === "string" ? component : null)
          );
        })
        .filter((name): name is string => Boolean(name))
    : [];
  const components = uniqueNames([...names, ...affected, ...directComponents]);
  const componentIds = incidentIds;
  const rawId = boundedText(row.id, 200);
  const rawUrl = row.url ?? row.shortlink ?? row.short_link;
  const url = safeIncidentUrl(rawUrl, service);
  const fallbackIdentity = createdAt || url ? [createdAt, url] : [title];
  const id = rawId ?? stableFallbackId(service.id, fallbackIdentity);
  const sourceImpact = boundedText(row.impact, 100);
  const rowType = asRecord(row.incident_type)?.name ?? row.type;
  const sourceType = boundedText(rowType, 100);
  const explicitDescription = statusText(row.description ?? row.body);
  const updateBody = statusText(latestUpdate?.body ?? latestUpdate?.update_text);

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
    componentIds,
    components,
    officialCreatedAt: createdAt,
    officialUpdatedAt: updatedAt,
    url,
  };
}

function latestStatuspageUpdate(updates: unknown[]): Record<string, unknown> | undefined {
  return updates
    .map((update) => asRecord(update))
    .filter((update): update is Record<string, unknown> => update !== null)
    .toSorted((left, right) => {
      const leftTime = Date.parse(String(left.display_at ?? left.created_at ?? "")) || 0;
      const rightTime = Date.parse(String(right.display_at ?? right.created_at ?? "")) || 0;
      return rightTime - leftTime;
    })[0];
}
