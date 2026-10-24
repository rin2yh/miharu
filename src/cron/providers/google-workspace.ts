import type {
  NormalizedComponent,
  NormalizedIncident,
  NormalizedStatus,
  ProviderSnapshot,
} from "../../domain";
import {
  COMPONENTS_PER_SERVICE_LIMIT,
  INCIDENTS_PER_SERVICE_LIMIT,
  type ServiceConfig,
} from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import {
  asRecord,
  boundedText,
  fetchJson,
  normalizeTimestamp,
  ProviderError,
  requiredText,
  safeIncidentUrl,
  statusText,
} from "./shared";

type GoogleWorkspaceService = Extract<ServiceConfig, { provider: "google-workspace" }>;
type KnownStatus = Exclude<NormalizedStatus, "unknown">;

interface GoogleProduct {
  id: string;
  name: string;
}

interface ParsedIncident extends NormalizedIncident {
  statusImpact: string | null;
}

const statusPriority: Record<NormalizedStatus, number> = {
  unknown: -1,
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};

const impactStatuses: Record<string, NormalizedStatus> = {
  SERVICE_INFORMATION: "operational",
  SERVICE_DISRUPTION: "degraded_performance",
  SERVICE_OUTAGE: "major_outage",
};

const severityStatuses: Partial<Record<string, NormalizedStatus>> = {
  SERVICE_DISRUPTION: "degraded_performance",
  SERVICE_OUTAGE: "major_outage",
};

export async function fetchGoogleWorkspaceSnapshot(
  service: GoogleWorkspaceService,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  const [catalogPayload, historyPayload] = await Promise.all([
    fetchJson(service.productsUrl, context.signal, context.fetcher),
    fetchJson(service.incidentsUrl, context.signal, context.fetcher),
  ]);
  const catalog = asRecord(catalogPayload);
  const history = historyPayload;
  if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(history)) {
    throw new ProviderError("invalid_payload", "Google Workspace JSON feed shape changed");
  }

  const products = parseProducts(catalog.products);
  const productNames = new Map(products.map(({ id, name }) => [id, name]));
  const historyIncidents = history.map((value) => parseIncident(value, service, productNames));
  const knownActiveIncidents = await context.getActiveIncidents();
  const incidentsById = new Map(historyIncidents.map((incident) => [incident.id, incident]));
  const knownActiveById = new Map(knownActiveIncidents.map((incident) => [incident.id, incident]));

  // The history feed may lag or omit older entries. Keep a previously observed active incident
  // until Google publishes its resolution instead of resolving it just because it disappeared.
  const omittedKnownActive = knownActiveIncidents.filter(
    (incident) => !incidentsById.has(incident.id),
  );
  const incidents = historyIncidents.filter(
    (incident) => incident.active || knownActiveById.has(incident.id),
  );
  incidents.push(
    ...omittedKnownActive.map((incident) => ({ ...incident, statusImpact: incident.sourceImpact })),
  );
  if (incidents.length > INCIDENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "Google Workspace active incident list exceeded the supported limit",
    );
  }

  const activeByProductId = new Map<
    string,
    Array<{ status: NormalizedStatus; sourceStatus: string }>
  >();
  const resolvedProductIds = new Set<string>();
  for (const incident of historyIncidents) {
    for (const id of incident.componentIds) {
      if (incident.active) {
        const status = impactStatuses[incident.statusImpact ?? ""] ?? "unknown";
        addActiveProductStatus(activeByProductId, id, status, incident.statusImpact ?? "unknown");
      } else {
        // A resolved history entry is evidence that the product was available after that incident.
        resolvedProductIds.add(id);
      }
    }
  }
  for (const incident of omittedKnownActive) {
    for (const id of incident.componentIds) {
      const status = incident.severityStatus ?? "unknown";
      addActiveProductStatus(activeByProductId, id, status, incident.sourceImpact ?? "unknown");
    }
  }

  const components: NormalizedComponent[] = products.map(({ id, name }) => {
    const activeStatuses = activeByProductId.get(id) ?? [];
    const status = activeStatuses.length
      ? combineActiveStatuses(activeStatuses.map(({ status: componentStatus }) => componentStatus))
      : resolvedProductIds.has(id)
        ? "operational"
        : "unknown";
    const sourceStatus =
      status === "unknown"
        ? activeStatuses.find(({ status: impactStatus }) => impactStatus === "unknown")
            ?.sourceStatus
        : activeStatuses.toSorted(
            (left, right) => statusPriority[right.status] - statusPriority[left.status],
          )[0]?.sourceStatus;
    return {
      id,
      name,
      status,
      sourceStatus: activeStatuses.length
        ? (sourceStatus ?? "unknown")
        : resolvedProductIds.has(id)
          ? "AVAILABLE"
          : "no_incident_history",
    };
  });

  const activeIncidents = [
    ...historyIncidents.filter((incident) => incident.active),
    ...omittedKnownActive.map((incident) => ({ ...incident, statusImpact: incident.sourceImpact })),
  ];
  const activeStatuses = activeIncidents.map(
    (incident) => impactStatuses[incident.statusImpact ?? ""] ?? "unknown",
  );
  const incidentStatus = activeIncidents.length
    ? combineActiveStatuses(activeStatuses)
    : "operational";
  const hasUnknownComponents = components.some((component) => component.status === "unknown");
  const status =
    incidentStatus === "operational" && hasUnknownComponents ? "unknown" : incidentStatus;
  const sourceStatus = activeIncidents.length
    ? activeStatuses.includes("unknown")
      ? (activeIncidents.find(
          (incident) => impactStatuses[incident.statusImpact ?? ""] === "unknown",
        )?.statusImpact ?? "unknown")
      : status === "unknown"
        ? "incomplete_product_history"
        : (activeIncidents.toSorted(
            (left, right) =>
              statusPriority[impactStatuses[right.statusImpact ?? ""] ?? "unknown"] -
              statusPriority[impactStatuses[left.statusImpact ?? ""] ?? "unknown"],
          )[0]?.statusImpact ?? "unknown")
    : !hasUnknownComponents
      ? "no_active_incidents"
      : historyIncidents.length > 0
        ? "incomplete_product_history"
        : "no_incident_history";

  return {
    status,
    sourceStatus,
    summary: status === "unknown" ? "公式の履歴フィードから現在の状態を判断できません。" : null,
    components,
    incidents,
    // Google publishes a bounded history feed, so an incident omitted from it is not proof of recovery.
    incidentListComplete: false,
  };
}

function parseProducts(values: unknown[]): GoogleProduct[] {
  if (values.length === 0 || values.length > COMPONENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "Google Workspace product catalog is empty or too large",
    );
  }

  const products = values.map((value) => {
    const row = asRecord(value);
    if (!row) throw new ProviderError("invalid_payload", "Invalid Google Workspace product");
    return {
      id: requiredText(row.id, "Google Workspace product id", 200),
      name: requiredText(row.current_title ?? row.title, "Google Workspace product title", 100),
    };
  });
  if (new Set(products.map(({ id }) => id)).size !== products.length) {
    throw new ProviderError(
      "invalid_payload",
      "Google Workspace product catalog has duplicate ids",
    );
  }
  return products;
}

function parseIncident(
  value: unknown,
  service: GoogleWorkspaceService,
  productNames: Map<string, string>,
): ParsedIncident {
  const row = asRecord(value);
  if (!row) throw new ProviderError("invalid_payload", "Invalid Google Workspace incident");
  const id = requiredText(row.id, "Google Workspace incident id", 200);
  if (row.updates !== undefined && !Array.isArray(row.updates)) {
    throw new ProviderError("invalid_payload", "Google Workspace incident updates are invalid");
  }

  const update = latestUpdate(row);
  const updateStatus = boundedText(update?.status, 100);
  const statusImpact = boundedText(row.status_impact, 100);
  const endedAt = normalizeTimestamp(row.end);
  const active =
    !endedAt &&
    ![updateStatus, boundedText(row.status, 100)].some((status) =>
      ["AVAILABLE", "RESOLVED"].includes(status?.toUpperCase() ?? ""),
    );
  const affectedProducts = parseAffectedProducts(row, productNames);
  const externalDescription = boundedText(row.external_desc, 3_000);
  const latestText = statusText(update?.text);
  const title =
    incidentTitle(externalDescription) ??
    boundedText(row.title, 300) ??
    boundedText(row.service_name, 300) ??
    id;
  const sourceStatus = updateStatus ?? (active ? statusImpact : "AVAILABLE") ?? "unknown";
  const officialCreatedAt = normalizeTimestamp(row.begin) ?? normalizeTimestamp(row.created);
  const officialUpdatedAt = active
    ? normalizeTimestamp(update?.modified ?? update?.created ?? row.modified)
    : (endedAt ?? normalizeTimestamp(update?.modified ?? update?.created ?? row.modified));
  const rawUri = boundedText(row.uri, 500);
  const incidentUrl = rawUri
    ? safeIncidentUrl(new URL(rawUri, service.statusPageUrl).toString(), service)
    : safeIncidentUrl(
        new URL(`incidents/${encodeURIComponent(id)}`, service.statusPageUrl).toString(),
        service,
      );

  return {
    id,
    title,
    body: latestText ?? statusText(externalDescription),
    kind: "incident",
    state: active ? "investigating" : "resolved",
    sourceStatus,
    sourceType: "incident",
    sourceImpact: statusImpact,
    severityStatus: statusImpact ? (severityStatuses[statusImpact] ?? null) : null,
    componentIds: affectedProducts.map(({ id: productId }) => productId),
    components: affectedProducts.map(({ name }) => name),
    officialCreatedAt,
    officialUpdatedAt,
    url: incidentUrl,
    active,
    statusImpact,
  };
}

function parseAffectedProducts(
  row: Record<string, unknown>,
  productNames: Map<string, string>,
): Array<{ id: string; name: string }> {
  if (row.affected_products !== undefined && !Array.isArray(row.affected_products)) {
    throw new ProviderError("invalid_payload", "Google Workspace affected products are invalid");
  }
  const values = Array.isArray(row.affected_products) ? row.affected_products : [];
  const directProducts = values
    .map((value) => {
      const product = asRecord(value);
      const id = boundedText(product?.id, 200);
      if (!id || !productNames.has(id)) return null;
      return { id, name: productNames.get(id)! };
    })
    .filter((product): product is { id: string; name: string } => product !== null);
  if (directProducts.length > 0) {
    return uniqueProducts(directProducts);
  }

  const legacyId = boundedText(row.service_key, 200);
  const legacyName = legacyId ? productNames.get(legacyId) : null;
  return legacyId && legacyName ? [{ id: legacyId, name: legacyName }] : [];
}

function uniqueProducts(
  products: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  const seen = new Set<string>();
  return products.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function latestUpdate(row: Record<string, unknown>): Record<string, unknown> | null {
  const current = asRecord(row.most_recent_update);
  if (current) return current;
  const updates = Array.isArray(row.updates) ? row.updates : [];
  return (
    updates
      .map((value) => asRecord(value))
      .filter((value): value is Record<string, unknown> => value !== null)
      .toSorted((left, right) => {
        const leftTime = Date.parse(String(left.modified ?? left.created ?? left.when ?? "")) || 0;
        const rightTime =
          Date.parse(String(right.modified ?? right.created ?? right.when ?? "")) || 0;
        return rightTime - leftTime;
      })[0] ?? null
  );
}

function incidentTitle(description: string | null): string | null {
  if (!description) return null;
  const labeled = description.match(
    /(?:\*\*(?:title|summary)\s*:?\*\*|#{1,6}\s*(?:title|summary))\s*:?\s*\r?\n+([^\r\n]+)/i,
  );
  const firstLine = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line && !/^\*{1,2}(?:title|summary|description|symptoms|workaround)\*{1,2}/i.test(line),
    );
  return statusText(labeled?.[1] ?? firstLine, 300);
}

function maxKnownStatus(left: KnownStatus, right: KnownStatus): KnownStatus {
  return statusPriority[right] > statusPriority[left] ? right : left;
}

function combineActiveStatuses(statuses: NormalizedStatus[]): NormalizedStatus {
  const knownStatuses = statuses.filter((status): status is KnownStatus => status !== "unknown");
  if (knownStatuses.length === 0) return "unknown";
  const highest = knownStatuses.reduce(maxKnownStatus);
  return highest === "operational" && statuses.includes("unknown") ? "unknown" : highest;
}

function addActiveProductStatus(
  statusesByProductId: Map<string, Array<{ status: NormalizedStatus; sourceStatus: string }>>,
  productId: string,
  status: NormalizedStatus,
  sourceStatus: string,
): void {
  const statuses = statusesByProductId.get(productId) ?? [];
  statuses.push({ status, sourceStatus });
  statusesByProductId.set(productId, statuses);
}
