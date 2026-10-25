import { type KnownIncident, type NormalizedIncident } from "../../../domain";
import {
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
      const title = extractXmlTag(item, "title");
      if (!title) return null;
      const updatedAt = normalizeTimestamp(extractXmlTag(item, "pubDate"));
      const description = extractXmlTag(item, "description");
      const { sourceStatus, state } = parseIncidentFeedStatus(title, description);
      return {
        sourceStatus,
        state,
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

function parseIncidentFeedStatus(
  title: string,
  description: string | null,
): { sourceStatus: string; state: NormalizedIncident["state"] } {
  const descriptionStatus = description?.match(
    /<(?:b|strong)\b[^>]*>\s*Status:\s*([^<]+)<\/(?:b|strong)>/i,
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
