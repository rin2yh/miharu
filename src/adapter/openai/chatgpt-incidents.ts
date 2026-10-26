import { type KnownIncident, type NormalizedIncident } from "../../domain";
import { stableFallbackId } from "../id";
import {
  COMPONENTS_PER_SERVICE_LIMIT,
  INCIDENTS_PER_SERVICE_LIMIT,
} from "../../shared/config/services";
import {
  asRecord,
  boundedText,
  normalizeTimestamp,
  parseIncidentState,
  requiredText,
  safeIncidentUrl,
  statusFromImpact,
  statusText,
  uniqueNames,
  type FetchLike,
  ProviderError,
} from "../shared";
import type { OpenAIChatGPTService } from "./chatgpt-components";
import { recheckOmittedIncident, selectOmittedIncidentsForRecheck } from "./chatgpt-rss";

export async function parseOpenAIChatGPTIncidents(
  service: OpenAIChatGPTService,
  values: unknown[],
  knownActiveIncidents: KnownIncident[],
  signal: AbortSignal,
  fetcher: FetchLike,
): Promise<{ incidents: NormalizedIncident[]; unverifiedIncidentIds: string[] }> {
  if (values.length > INCIDENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError("invalid_payload", "OpenAI incident list exceeded the supported limit");
  }

  const componentNames = new Map(service.components.map(({ id, name }) => [id, name]));
  const incidents = values
    .map((incident) => parseOpenAIIncident(incident, service, componentNames))
    .filter((incident): incident is NormalizedIncident => incident !== null);
  const listedIncidentIds = new Set(incidents.map((incident) => incident.id));
  const omittedActiveIncidents = knownActiveIncidents.filter(
    (incident) => incident.lifecycle !== "closed" && !listedIncidentIds.has(incident.id),
  );
  const selectedForRecheck = selectOmittedIncidentsForRecheck(omittedActiveIncidents);
  const recheckedIncidents = await Promise.all(
    selectedForRecheck.map((incident) =>
      recheckOmittedIncident(incident, service, signal, fetcher),
    ),
  );
  return {
    incidents: [...incidents, ...recheckedIncidents.filter((incident) => incident !== null)],
    unverifiedIncidentIds: selectedForRecheck.flatMap((incident, index) =>
      recheckedIncidents[index] === null ? [incident.id] : [],
    ),
  };
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
      /\b(?:not|never|no|without|unrelated to|does not affect|doesn't affect|does not impact|doesn't impact|do not impact|don't impact|will not affect|won't affect|not affecting|not impacting|excluding|except)\b[^.!?;\n]{0,40}$/i.test(
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
