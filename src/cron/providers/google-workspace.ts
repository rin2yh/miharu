import type {
  KnownIncident,
  NormalizedComponent,
  NormalizedIncident,
  NormalizedStatus,
  ProviderSnapshot,
} from "../../domain";
import { INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS } from "../../domain";
import {
  COMPONENTS_PER_SERVICE_LIMIT,
  INCIDENTS_PER_SERVICE_LIMIT,
  type ServiceConfig,
} from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import {
  asRecord,
  boundedText,
  fetchHtml,
  fetchJson,
  normalizeTimestamp,
  ProviderError,
  requiredText,
  safeIncidentUrl,
  statusText,
} from "./shared";
import type { FetchLike } from "./shared";

type GoogleWorkspaceService = Extract<ServiceConfig, { provider: "google-workspace" }>;
type KnownStatus = Exclude<NormalizedStatus, "unknown">;
const OMITTED_INCIDENT_RECHECKS_PER_POLL = 5;

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
  SERVICE_INFORMATION: "unknown",
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

  // The history feed can omit older incidents. Recheck a bounded rotating sample on its official
  // detail page; an unavailable recheck remains explicitly unknown instead of implying recovery.
  const omittedKnownActive = knownActiveIncidents.filter(
    (incident) => incident.active && !incidentsById.has(incident.id),
  );
  const recheckedOmitted = await Promise.all(
    selectOmittedIncidentsForRecheck(omittedKnownActive).map((incident) =>
      recheckOmittedIncident(incident, service, context.signal, context.fetcher),
    ),
  );
  const recheckedById = new Map(recheckedOmitted.map((incident) => [incident.id, incident]));
  const incidents: ParsedIncident[] = historyIncidents.filter(
    (incident) => incident.active || knownActiveById.has(incident.id),
  );
  for (const incident of omittedKnownActive) {
    const rechecked = recheckedById.get(incident.id);
    incidents.push(rechecked ?? { ...incident, statusImpact: incident.sourceImpact });
  }
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
  for (const incident of incidents) {
    for (const id of incident.componentIds) {
      if (incident.active) {
        const status = statusForActiveIncident(incident);
        addActiveProductStatus(
          activeByProductId,
          id,
          status,
          incident.sourceStatus === INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS
            ? INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS
            : (incident.statusImpact ?? "unknown"),
        );
      }
    }
  }

  const components: NormalizedComponent[] = products.map(({ id, name }) => {
    const activeStatuses = activeByProductId.get(id) ?? [];
    const status = activeStatuses.length
      ? combineActiveStatuses(activeStatuses.map(({ status: componentStatus }) => componentStatus))
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
      sourceStatus: activeStatuses.length ? (sourceStatus ?? "unknown") : "no_current_status",
    };
  });

  const activeIncidents = incidents.filter((incident) => incident.active);
  const activeStatuses = activeIncidents.map(statusForActiveIncident);
  const incidentStatus = activeIncidents.length ? combineActiveStatuses(activeStatuses) : "unknown";
  const status = incidentStatus;
  const sourceStatus = activeIncidents.length
    ? incidentStatus === "unknown"
      ? (activeIncidents.find((incident) => statusForActiveIncident(incident) === "unknown")
          ?.sourceStatus ?? "unknown")
      : (activeIncidents.toSorted(
          (left, right) =>
            statusPriority[statusForActiveIncident(right)] -
            statusPriority[statusForActiveIncident(left)],
        )[0]?.statusImpact ?? "unknown")
    : historyIncidents.length > 0
      ? "no_active_incidents"
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
      if (!id) {
        throw new ProviderError(
          "invalid_payload",
          "Google Workspace affected product id is missing",
        );
      }
      return { id, name: productNames.get(id) ?? `不明な製品 (${id})` };
    })
    .filter((product): product is { id: string; name: string } => product !== null);
  if (directProducts.length > 0) {
    return uniqueProducts(directProducts);
  }

  const legacyId = boundedText(row.service_key, 200);
  const legacyName = legacyId ? (productNames.get(legacyId) ?? `不明な製品 (${legacyId})`) : null;
  return legacyId && legacyName ? [{ id: legacyId, name: legacyName }] : [];
}

async function recheckOmittedIncident(
  incident: KnownIncident,
  service: GoogleWorkspaceService,
  signal: AbortSignal,
  fetcher: FetchLike,
): Promise<ParsedIncident> {
  const parsedIncident: ParsedIncident = { ...incident, statusImpact: incident.sourceImpact };
  const detailUrl = safeIncidentUrl(
    new URL(`incidents/${encodeURIComponent(incident.id)}`, service.statusPageUrl).toString(),
    service,
  );
  if (!detailUrl) return unknownIncident(parsedIncident);

  try {
    const html = await fetchHtml(detailUrl, signal, fetcher);
    const detail = parseGoogleIncidentDetail(html, incident.officialCreatedAt);
    if (detail.endAt) {
      return {
        ...parsedIncident,
        state: "resolved",
        sourceStatus: "RESOLVED",
        officialUpdatedAt: detail.endAt,
        active: false,
      };
    }
    // A previous unavailable recheck has no trustworthy current impact to restore.
    if (incident.sourceStatus === INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS) {
      return unknownIncident(parsedIncident);
    }
    return parsedIncident;
  } catch {
    return unknownIncident(parsedIncident);
  }
}

function unknownIncident(incident: ParsedIncident): ParsedIncident {
  return {
    ...incident,
    body: null,
    state: "unknown",
    sourceStatus: INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
    active: true,
  };
}

function parseGoogleIncidentDetail(
  html: string,
  expectedStartTime: string | null,
): { endAt: string | null } {
  if (!elementTextByClass(html, "h2", "incident-header")) {
    throw new ProviderError("invalid_payload", "Google Workspace incident page is invalid");
  }
  const startText = elementTextByClass(html, "strong", "start-time");
  const timezone = elementTextByClass(html, "strong", "timezone");
  if (!startText || !timezone?.includes("UTC")) {
    throw new ProviderError(
      "invalid_payload",
      "Google Workspace incident page has no UTC start time",
    );
  }
  const startAt = parseGoogleUtcDateTime(startText);
  if (!startAt)
    throw new ProviderError("invalid_payload", "Google Workspace incident start time is invalid");
  if (expectedStartTime && startAt.slice(0, 16) !== expectedStartTime.slice(0, 16)) {
    throw new ProviderError(
      "invalid_payload",
      "Google Workspace incident page did not match the incident",
    );
  }

  const endText = elementTextByClass(html, "strong", "end-time");
  if (!endText) return { endAt: null };
  const endAt = parseGoogleUtcDateTime(endText);
  if (!endAt)
    throw new ProviderError("invalid_payload", "Google Workspace incident end time is invalid");
  return { endAt };
}

function elementTextByClass(html: string, tag: string, className: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escapedTag}\\b([^>]*)>([\\s\\S]*?)<\\/${escapedTag}>`, "gi");
  for (const match of html.matchAll(pattern)) {
    const classes = match[1]?.match(/\bclass=["']([^"']*)["']/i)?.[1]?.split(/\s+/) ?? [];
    if (!classes.includes(className)) continue;
    const text = (match[2] ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .trim();
    return text || null;
  }
  return null;
}

function parseGoogleUtcDateTime(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const timestamp = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00.000Z`;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp ? null : timestamp;
}

function selectOmittedIncidentsForRecheck(incidents: KnownIncident[]): KnownIncident[] {
  if (incidents.length <= OMITTED_INCIDENT_RECHECKS_PER_POLL) return incidents;
  const firstIndex = Math.floor(Date.now() / 60_000) % incidents.length;
  return Array.from(
    { length: OMITTED_INCIDENT_RECHECKS_PER_POLL },
    (_, offset) => incidents[(firstIndex + offset) % incidents.length]!,
  );
}

function statusForActiveIncident(incident: ParsedIncident): NormalizedStatus {
  if (incident.sourceStatus === INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS) return "unknown";
  return impactStatuses[incident.statusImpact ?? ""] ?? "unknown";
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
