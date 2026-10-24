import type {
  NormalizedComponent,
  NormalizedIncident,
  NormalizedStatus,
  ProviderSnapshot,
} from "../../domain";
import { INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS } from "../../domain";
import {
  COMPONENTS_PER_SERVICE_LIMIT,
  FRESHNESS_WARNING_SECONDS,
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

// The JSON catalog still includes these retired products, but the current dashboard does not.
const historicalOnlyProductIds = new Set([
  "8qvqBSzo9ksVXYtWwe5g", // Classic Hangouts
  "dmLd9pmXmkuNNFZXo8a5", // Currents
]);
const dashboardTimestampPrecisionMs = 60_000;

export async function fetchGoogleWorkspaceSnapshot(
  service: GoogleWorkspaceService,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  const [catalogPayload, historyPayload, dashboardHtml] = await Promise.all([
    fetchJson(service.productsUrl, context.signal, context.fetcher),
    fetchJson(service.incidentsUrl, context.signal, context.fetcher),
    fetchHtml(service.dashboardUrl, context.signal, context.fetcher),
  ]);
  const catalog = asRecord(catalogPayload);
  const history = historyPayload;
  if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(history)) {
    throw new ProviderError("invalid_payload", "Google Workspace JSON feed shape changed");
  }

  const products = parseProducts(catalog.products);
  const productNames = new Map(products.map(({ id, name }) => [id, name]));
  const dashboardProducts = parseCurrentDashboard(dashboardHtml, products);
  const historyIncidents = history.map((value) => parseIncident(value, service, productNames));
  const knownUnresolvedIncidents = await context.getUnresolvedIncidents();
  const incidentsById = new Map(historyIncidents.map((incident) => [incident.id, incident]));
  const knownUnresolvedById = new Map(
    knownUnresolvedIncidents.map((incident) => [incident.id, incident]),
  );

  // The history feed can omit older incidents. Preserve them as unverifiable instead of
  // implying recovery or treating their last reported impact as current.
  const omittedKnownIncidents = knownUnresolvedIncidents.filter(
    (incident) => incident.lifecycle !== "resolved" && !incidentsById.has(incident.id),
  );
  const incidents: ParsedIncident[] = historyIncidents.filter(
    (incident) => incident.lifecycle !== "resolved" || knownUnresolvedById.has(incident.id),
  );
  for (const incident of omittedKnownIncidents) {
    incidents.push(unverifiableIncident(incident));
  }
  if (incidents.length > INCIDENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "Google Workspace active incident list exceeded the supported limit",
    );
  }

  const activeByProductId = new Map<string, StatusObservation[]>();
  for (const incident of incidents) {
    if (incident.lifecycle === "resolved") continue;
    const status = statusForUnresolvedIncident(incident);
    const sourceStatus =
      incident.lifecycle === "unverified"
        ? INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS
        : (incident.statusImpact ?? "unknown");
    for (const id of incident.componentIds) {
      const observations = activeByProductId.get(id) ?? [];
      observations.push({ status, sourceStatus });
      activeByProductId.set(id, observations);
    }
  }

  const components: NormalizedComponent[] = dashboardProducts.map((product) => {
    const status = combineObservations([
      { status: product.status, sourceStatus: product.sourceStatus },
      ...(activeByProductId.get(product.id) ?? []),
    ]);
    return {
      id: product.id,
      name: product.name,
      status: status.status,
      sourceStatus: status.sourceStatus,
    };
  });

  const unresolvedIncidents = incidents.filter((incident) => incident.lifecycle !== "resolved");
  const overallStatus = combineObservations([
    ...components.map(({ status, sourceStatus }) => ({ status, sourceStatus })),
    ...unresolvedIncidents.map((incident) => ({
      status: statusForUnresolvedIncident(incident),
      sourceStatus:
        incident.lifecycle === "unverified"
          ? INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS
          : (incident.statusImpact ?? "unknown"),
    })),
  ]);

  return {
    status: overallStatus.status,
    sourceStatus: overallStatus.sourceStatus,
    summary:
      overallStatus.status === "unknown"
        ? "公式ダッシュボードの現在状態を確認できない製品または障害があります。"
        : null,
    components,
    incidents,
    // Google publishes a bounded history feed, so an incident omitted from it is not proof of recovery.
    incidentListComplete: false,
  };
}

interface GoogleProductStatus extends GoogleProduct {
  status: NormalizedStatus;
  sourceStatus: string;
}

interface StatusObservation {
  status: NormalizedStatus;
  sourceStatus: string;
}

function parseCurrentDashboard(html: string, products: GoogleProduct[]): GoogleProductStatus[] {
  const updatedText = html.match(/Last updated time:\s*([^<]+)/i)?.[1];
  const updatedAt = updatedText ? Date.parse(decodeHtmlText(updatedText)) : Number.NaN;
  const ageMs = Date.now() - updatedAt;
  if (
    !Number.isFinite(updatedAt) ||
    ageMs < -dashboardTimestampPrecisionMs ||
    ageMs > FRESHNESS_WARNING_SECONDS * 1_000 + dashboardTimestampPrecisionMs
  ) {
    throw new ProviderError(
      "invalid_payload",
      "Google Workspace dashboard data is missing or stale",
    );
  }

  const table = html.match(
    /<table\b(?=[^>]*\bclass=["'][^"']*\bmain-dashboard-table\b[^"']*["'])[^>]*>([\s\S]*?)<\/table>/i,
  )?.[1];
  if (!table) {
    throw new ProviderError("invalid_payload", "Google Workspace current status table is missing");
  }

  const productsByName = new Map(
    products.map((product) => [normalizeProductName(product.name), product]),
  );
  if (productsByName.size !== products.length) {
    throw new ProviderError("invalid_payload", "Google Workspace product names are ambiguous");
  }

  const rows = [
    ...table.matchAll(
      /<tr\b[^>]*\bclass=["'][^"']*\bproduct-row\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi,
    ),
  ];
  if (rows.length === 0 || rows.length > COMPONENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError("invalid_payload", "Google Workspace current product list is invalid");
  }

  const seenProductIds = new Set<string>();
  const currentProducts = rows.map(([, row]) => {
    const rawName = row.match(
      /<td\b(?=[^>]*\bclass=["'][^"']*\bproduct-name\b[^"']*["'])[^>]*>([\s\S]*?)<\/td>/i,
    )?.[1];
    const name = rawName ? decodeHtmlText(rawName.replace(/<[^>]*>/g, " ")) : "";
    const product = productsByName.get(normalizeProductName(name));
    if (!product || seenProductIds.has(product.id)) {
      throw new ProviderError(
        "invalid_payload",
        "Google Workspace current product is unknown or duplicated",
      );
    }

    const endMarker = row.match(
      /<div\b(?=[^>]*\bclass=["'][^"']*\bend-marker\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i,
    )?.[1];
    const label = endMarker?.match(/\baria-label=["']([^"']+)["']/i)?.[1];
    const observation = dashboardStatus(label);
    if (!observation) {
      throw new ProviderError(
        "invalid_payload",
        "Google Workspace current product status is missing or unknown",
      );
    }

    seenProductIds.add(product.id);
    return { ...product, ...observation };
  });

  const missingCurrentProducts = products.filter(
    ({ id }) => !historicalOnlyProductIds.has(id) && !seenProductIds.has(id),
  );
  if (missingCurrentProducts.length > 0) {
    throw new ProviderError(
      "invalid_payload",
      "Google Workspace current product list is incomplete",
    );
  }
  return currentProducts;
}

function dashboardStatus(label: string | undefined): StatusObservation | null {
  if (!label) return null;
  const rawStatus = label
    .replace(/\s+status$/i, "")
    .trim()
    .toLowerCase();
  switch (rawStatus) {
    case "available":
    case "service information":
      return { status: "operational", sourceStatus: rawStatus.replaceAll(" ", "_").toUpperCase() };
    case "service disruption":
      return { status: "degraded_performance", sourceStatus: "SERVICE_DISRUPTION" };
    case "service outage":
      return { status: "major_outage", sourceStatus: "SERVICE_OUTAGE" };
    default:
      return null;
  }
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProductName(value: string): string {
  return decodeHtmlText(value).toLocaleLowerCase("en-US");
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
    lifecycle: active ? "active" : "resolved",
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

function unverifiableIncident(incident: NormalizedIncident): ParsedIncident {
  return {
    ...incident,
    lifecycle: "unverified",
    statusImpact: incident.sourceImpact,
  };
}

function statusForActiveIncident(incident: ParsedIncident): NormalizedStatus {
  return impactStatuses[incident.statusImpact ?? ""] ?? "unknown";
}

function statusForUnresolvedIncident(incident: ParsedIncident): NormalizedStatus {
  return incident.lifecycle === "unverified" ? "unknown" : statusForActiveIncident(incident);
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

function combineObservations(observations: StatusObservation[]): StatusObservation {
  const known = observations.filter(
    (observation): observation is StatusObservation & { status: KnownStatus } =>
      observation.status !== "unknown",
  );
  if (known.length === 0) {
    return {
      status: "unknown",
      sourceStatus: observations[0]?.sourceStatus ?? "unknown",
    };
  }

  const highest = known.reduce((left, right) =>
    statusPriority[right.status] > statusPriority[left.status] ? right : left,
  );
  if (highest.status === "operational" && observations.some(({ status }) => status === "unknown")) {
    return {
      status: "unknown",
      sourceStatus:
        observations.find(({ status }) => status === "unknown")?.sourceStatus ?? "unknown",
    };
  }
  return highest;
}
