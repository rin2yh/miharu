import {
  normalizeStatus,
  INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
  type KnownIncident,
  type NormalizedComponent,
  type NormalizedIncident,
  type NormalizedStatus,
  type ProviderSnapshot,
} from "../../domain";
import { stableFallbackId } from "../../domain/id";
import {
  COMPONENTS_PER_SERVICE_LIMIT,
  INCIDENTS_PER_SERVICE_LIMIT,
  type ServiceConfig,
} from "../../shared/config/services";
import {
  asRecord,
  boundedText,
  fetchJson,
  fetchText,
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
const OMITTED_INCIDENT_RECHECKS_PER_POLL = 5;

const statusPriority: Record<NormalizedStatus, number> = {
  unknown: -1,
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};

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
  if (data.components.length > COMPONENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "OpenAI component list exceeded the supported limit",
    );
  }

  const expectedComponents = new Map(
    service.components.map((component) => [component.id, component]),
  );
  const componentsById = new Map<string, NormalizedComponent>();
  for (const value of data.components) {
    const row = asRecord(value);
    const id = boundedText(row?.id, 200);
    if (!id || !expectedComponents.has(id)) continue;
    const sourceStatus = requiredText(row?.status, "component status", 100);
    componentsById.set(id, {
      id,
      name: requiredText(row?.name, "component name", 100),
      status: normalizeStatus(sourceStatus),
      sourceStatus,
    });
  }
  if (componentsById.size === 0) {
    throw new ProviderError("invalid_payload", "OpenAI ChatGPT components were not found");
  }

  const components = service.components.map(
    ({ id, name }) =>
      componentsById.get(id) ?? {
        id,
        name,
        status: "unknown" as const,
        sourceStatus: "missing",
      },
  );
  const missingComponents = components.some((component) => component.sourceStatus === "missing");

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

  const componentNames = new Map(service.components.map(({ id, name }) => [id, name]));
  const normalizedIncidents = incidents
    .map((incident) => parseOpenAIIncident(incident, service, componentNames))
    .filter((incident): incident is NormalizedIncident => incident !== null);
  const listedIncidentIds = new Set(normalizedIncidents.map((incident) => incident.id));
  const omittedActiveIncidents = knownActiveIncidents.filter(
    (incident) => incident.active && !listedIncidentIds.has(incident.id),
  );
  const recheckedIncidents = await Promise.all(
    selectOmittedIncidentsForRecheck(omittedActiveIncidents).map((incident) =>
      recheckOmittedIncident(incident, service, signal, fetcher),
    ),
  );
  normalizedIncidents.push(...recheckedIncidents);

  const overall = components.toSorted(
    (left, right) => statusPriority[right.status] - statusPriority[left.status],
  )[0]!;

  return {
    status:
      missingComponents || components.some((component) => component.status === "unknown")
        ? "unknown"
        : overall.status,
    sourceStatus: missingComponents
      ? "incomplete_components"
      : components.some((component) => component.status === "unknown")
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
  const updateBodies = parsedUpdates
    .map((update) => statusText(update.body ?? update.update_text))
    .filter((body): body is string => body !== null);
  const componentEvidence = extractIncidentComponents(row, parsedUpdates, componentNames);
  if (!incidentBelongsToChatGPT(title, updateBodies, componentEvidence)) return null;

  const rawId = boundedText(row.id, 200);
  const createdAt = normalizeTimestamp(row.created_at);
  const updatedAt =
    normalizeTimestamp(row.updated_at) ??
    normalizeTimestamp(latestUpdate?.display_at ?? latestUpdate?.created_at);
  const rawUrl = row.url ?? row.shortlink ?? row.short_link;
  const url = safeIncidentUrl(rawUrl, service);
  const fallbackIdentity = createdAt || url ? [createdAt, url] : [title];
  const id = rawId ?? stableFallbackId(service.id, fallbackIdentity);
  const incidentUrl =
    url ??
    (rawId
      ? safeIncidentUrl(
          new URL(`incidents/${encodeURIComponent(rawId)}`, service.statusPageUrl).toString(),
          service,
        )
      : null);
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
    componentIds: componentEvidence.componentIds,
    components: componentEvidence.components,
    officialCreatedAt: createdAt,
    officialUpdatedAt: updatedAt,
    url: incidentUrl,
    active: isIncidentActive(state),
  };
}

interface IncidentComponentEvidence {
  componentIds: string[];
  components: string[];
  hasOfficialIds: boolean;
  hasOfficialNames: boolean;
}

function extractIncidentComponents(
  row: Record<string, unknown>,
  updates: Record<string, unknown>[],
  selectedComponents: Map<string, string>,
): IncidentComponentEvidence {
  const componentRows = Array.isArray(row.components) ? row.components : [];
  const affectedRows = updates.flatMap((update) =>
    Array.isArray(update.affected_components) ? update.affected_components : [],
  );
  const allRows = [...componentRows, ...affectedRows];
  const directIds = Array.isArray(row.component_ids) ? row.component_ids : [];
  const rowIds = allRows.map((value) => {
    const component = asRecord(value);
    return component?.id ?? component?.component_id;
  });
  const rawIds = uniqueNames([...directIds, ...rowIds], COMPONENTS_PER_SERVICE_LIMIT);
  const rawNames = uniqueNames(
    allRows.map((value) => {
      const component = asRecord(value);
      return component?.name ?? (typeof value === "string" ? value : null);
    }),
  );
  const componentIds = rawIds.filter((id) => selectedComponents.has(id));
  const selectedNames = new Set(selectedComponents.values());
  const components = uniqueNames([
    ...componentIds.map((id) => selectedComponents.get(id)),
    ...rawNames.filter((name) => selectedNames.has(name)),
  ]);

  return {
    componentIds,
    components,
    hasOfficialIds: rawIds.length > 0,
    hasOfficialNames: rawNames.length > 0,
  };
}

function incidentBelongsToChatGPT(
  title: string,
  updateBodies: string[],
  evidence: IncidentComponentEvidence,
): boolean {
  if (evidence.hasOfficialIds) return evidence.componentIds.length > 0;
  if (evidence.hasOfficialNames) return evidence.components.length > 0;
  return [title, ...updateBodies].some(explicitlyMentionsChatGPT);
}

function explicitlyMentionsChatGPT(text: string): boolean {
  const mention = /\bchatgpt\b/gi;
  for (const match of text.matchAll(mention)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const sentenceStart = Math.max(
      text.lastIndexOf(".", start - 1),
      text.lastIndexOf("!", start - 1),
      text.lastIndexOf("?", start - 1),
      text.lastIndexOf(";", start - 1),
      text.lastIndexOf("\n", start - 1),
    );
    const sentenceEnd = [".", "!", "?", ";", "\n"]
      .map((separator) => text.indexOf(separator, end))
      .filter((position) => position >= 0)
      .reduce((nearest, position) => Math.min(nearest, position), text.length);
    const before = text.slice(sentenceStart + 1, start);
    const after = text.slice(end, sentenceEnd);
    if (
      /\b(?:not|never|no|without|unrelated to|does not affect|doesn't affect|will not affect|won't affect|not affecting|not impacting|excluding|except)\b[^.!?;\n]{0,40}$/i.test(
        before,
      ) ||
      /^\s*(?:(?:is|are|was|were)\s+)?(?:not|never|no longer)\s+(?:currently\s+)?(?:affected|impacted|experiencing|degraded|down)\b/i.test(
        after,
      ) ||
      /^\s*(?:(?:is|are|was|were)\s+)?unaffected\b/i.test(after)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function selectOmittedIncidentsForRecheck(incidents: KnownIncident[]): KnownIncident[] {
  if (incidents.length <= OMITTED_INCIDENT_RECHECKS_PER_POLL) return incidents;
  const currentMinute = Math.floor(Date.now() / 60_000);
  const firstIndex = currentMinute % incidents.length;
  // Bound request fanout while rotating the starting point to cover every omitted incident.
  return Array.from(
    { length: OMITTED_INCIDENT_RECHECKS_PER_POLL },
    (_, offset) => incidents[(firstIndex + offset) % incidents.length]!,
  );
}

async function recheckOmittedIncident(
  incident: KnownIncident,
  service: OpenAIChatGPTService,
  signal: AbortSignal,
  fetcher: FetchLike,
): Promise<NormalizedIncident> {
  if (incident.id.startsWith("generated_")) return unknownIncident(incident);
  const feedUrl = safeIncidentUrl(
    new URL(
      `incidents/${encodeURIComponent(incident.id)}/feed.rss`,
      service.statusPageUrl,
    ).toString(),
    service,
  );
  if (!feedUrl) return unknownIncident(incident);

  try {
    const feed = await fetchText(feedUrl, signal, fetcher);
    const update = parseIncidentFeed(feed, incident.id, service);
    return {
      ...incident,
      state: update.state,
      sourceStatus: update.sourceStatus,
      body: update.body ?? incident.body,
      officialUpdatedAt: update.updatedAt ?? incident.officialUpdatedAt,
      active: isIncidentActive(update.state),
    };
  } catch {
    return unknownIncident(incident);
  }
}

function unknownIncident(incident: KnownIncident): NormalizedIncident {
  return {
    ...incident,
    state: "unknown",
    sourceStatus: INCIDENT_RECHECK_UNAVAILABLE_SOURCE_STATUS,
    active: true,
  };
}

interface IncidentFeedUpdate {
  state: NormalizedIncident["state"];
  sourceStatus: string;
  body: string | null;
  updatedAt: string | null;
}

function parseIncidentFeed(
  xml: string,
  incidentId: string,
  service: OpenAIChatGPTService,
): IncidentFeedUpdate {
  const channel = xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1];
  if (!channel) throw new ProviderError("invalid_payload", "OpenAI incident feed is invalid");

  const expectedPath = `/incidents/${encodeURIComponent(incidentId)}`;
  const feedLinks = [...channel.matchAll(/<link\b[^>]*>([\s\S]*?)<\/link>/gi)].map((match) =>
    decodeXmlText(match[1] ?? ""),
  );
  const linksToIncident = feedLinks.some((link) => {
    const safeUrl = safeIncidentUrl(link, service);
    return safeUrl ? new URL(safeUrl).pathname.replaceAll("//", "/") === expectedPath : false;
  });
  if (!linksToIncident) {
    throw new ProviderError("invalid_payload", "OpenAI incident feed did not match the incident");
  }

  const items = [...channel.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(
    (match) => match[1] ?? "",
  );
  const updates = items
    .map((item) => {
      const sourceStatus = extractXmlTag(item, "title");
      if (!sourceStatus) return null;
      const updatedAt = normalizeTimestamp(extractXmlTag(item, "pubDate"));
      const description = extractXmlTag(item, "description");
      return {
        sourceStatus,
        state: parseIncidentState(sourceStatus),
        updatedAt,
        body: statusText(description),
      } satisfies IncidentFeedUpdate;
    })
    .filter((update): update is IncidentFeedUpdate => update !== null);
  const latest = updates.toSorted(
    (left, right) =>
      (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0),
  )[0];
  if (!latest) throw new ProviderError("invalid_payload", "OpenAI incident feed has no updates");
  return latest;
}

function extractXmlTag(value: string, tag: string): string | null {
  const match = value.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlText(match[1] ?? "") : null;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .trim();
}
