import { XMLParser, XMLValidator } from "fast-xml-parser";
import { type KnownIncident, type NormalizedIncident } from "../../domain";
import {
  asRecord,
  fetchText,
  normalizeTimestamp,
  parseIncidentState,
  ProviderError,
  safeIncidentUrl,
  statusText,
  type FetchLike,
} from "../shared";
import type { OpenAIChatGPTService } from "./chatgpt-components";
const OMITTED_INCIDENT_RECHECKS_PER_POLL = 5;
const rssParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  processEntities: {
    enabled: true,
    maxEntitySize: 256,
    maxExpansionDepth: 5,
    maxTotalExpansions: 100,
  },
  trimValues: true,
});

export async function recheckOmittedIncident(
  incident: KnownIncident,
  service: OpenAIChatGPTService,
  signal: AbortSignal,
  fetcher: FetchLike,
): Promise<NormalizedIncident | null> {
  if (incident.id.startsWith("generated_")) return null;
  const feedUrl = safeIncidentUrl(
    new URL(
      `incidents/${encodeURIComponent(incident.id)}/feed.rss`,
      service.statusPageUrl,
    ).toString(),
    service,
  );
  if (!feedUrl) return null;

  try {
    const feed = await fetchText(feedUrl, signal, fetcher);
    const update = parseIncidentFeed(feed, incident.id, service);
    const {
      lifecycle: _lifecycle,
      closureReason: _closureReason,
      lastObservedAt: _lastObservedAt,
      ...officialIncident
    } = incident;
    return {
      ...officialIncident,
      state: update.state,
      sourceStatus: update.sourceStatus,
      body: update.body ?? incident.body,
      officialUpdatedAt: update.updatedAt ?? incident.officialUpdatedAt,
    };
  } catch {
    return null;
  }
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
  if (XMLValidator.validate(xml) !== true) {
    throw new ProviderError("invalid_payload", "OpenAI incident feed is invalid");
  }
  const rss = asRecord(asRecord(rssParser.parse(xml))?.rss);
  const channel = asRecord(rss?.channel);
  if (!channel) throw new ProviderError("invalid_payload", "OpenAI incident feed is invalid");

  const expectedPath = `/incidents/${encodeURIComponent(incidentId)}`;
  const items = asArray(channel.item).map(asRecord).filter(isRecord);
  const feedLinks = [
    ...asStringArray(channel.link),
    ...items.flatMap((item) => asStringArray(item.link)),
  ];
  const linksToIncident = feedLinks.some((link) => {
    const safeUrl = safeIncidentUrl(link, service);
    return safeUrl ? new URL(safeUrl).pathname.replaceAll("//", "/") === expectedPath : false;
  });
  if (!linksToIncident) {
    throw new ProviderError("invalid_payload", "OpenAI incident feed did not match the incident");
  }

  const updates = items
    .map((item) => {
      const title = asString(item.title)?.trim() || null;
      if (!title) return null;
      const updatedAt = normalizeTimestamp(item.pubDate);
      // XML parsing handles XML entities; html-to-text handles embedded HTML entities.
      const description = asString(item.description);
      const body = statusText(description);
      const { sourceStatus, state } = parseIncidentFeedStatus(title, body);
      return {
        sourceStatus,
        state,
        updatedAt,
        body,
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

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function parseIncidentFeedStatus(
  title: string,
  description: string | null,
): { sourceStatus: string; state: NormalizedIncident["state"] } {
  const descriptionStatus = description?.match(
    /(?:^|\n)\s*Status:\s*(in[\s_-]*progress[\s_-]*maintenance|in[\s_-]*progress|resolved|closed|complete(?:d)?|cancell?ed|postmortem|scheduled|monitoring|identified|investigating|active|open)\b/i,
  )?.[1];
  const titleParts = title.split(/\s*(?:-|–|—|:)\s*/).filter(Boolean);
  const candidates = [descriptionStatus, titleParts[0], titleParts.at(-1), title];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const sourceStatus = candidate.trim();
    const state = parseIncidentState(sourceStatus);
    if (state !== "unknown") return { sourceStatus, state };
  }
  return { sourceStatus: title, state: "unknown" };
}

export function selectOmittedIncidentsForRecheck(incidents: KnownIncident[]): KnownIncident[] {
  if (incidents.length <= OMITTED_INCIDENT_RECHECKS_PER_POLL) return incidents;
  const currentMinute = Math.floor(Date.now() / 60_000);
  const firstIndex = currentMinute % incidents.length;
  // Bound request fanout while rotating the starting point to cover every omitted incident.
  return Array.from(
    { length: OMITTED_INCIDENT_RECHECKS_PER_POLL },
    (_, offset) => incidents[(firstIndex + offset) % incidents.length]!,
  );
}
