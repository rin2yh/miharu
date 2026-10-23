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
  uniqueNames,
  type FetchLike,
} from "./shared";

type SlackService = Extract<ServiceConfig, { provider: "slack" }>;

export async function fetchSlackSnapshot(
  service: SlackService,
  signal: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<ProviderSnapshot> {
  const data = asRecord(await fetchJson(service.currentUrl, signal, fetcher));
  if (!data || !Array.isArray(data.active_incidents)) {
    throw new ProviderError("invalid_payload", "Slack Status API response shape changed");
  }
  if (data.active_incidents.length > INCIDENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError("invalid_payload", "Slack incident list exceeded the supported limit");
  }

  const sourceStatus = requiredText(data.status, "Slack status", 100);
  const incidents = data.active_incidents.map((value) => parseSlackIncident(value, service));
  const normalizedStatus = normalizeStatus(sourceStatus);

  return {
    // Slack's `active` value describes incident lifecycle, not service-wide health.
    status: sourceStatus.toLowerCase() === "ok" ? "operational" : normalizedStatus,
    sourceStatus,
    summary: null,
    incidents,
  };
}

function parseSlackIncident(value: unknown, service: SlackService): NormalizedIncident {
  const row = asRecord(value);
  if (!row) throw new ProviderError("invalid_payload", "Invalid Slack incident");

  const title = requiredText(row.title, "Slack incident title");
  const sourceStatus = requiredText(row.status, "Slack incident status", 100);
  const state = parseIncidentState(sourceStatus);
  const createdAt = normalizeTimestamp(row.date_created);
  const notes = Array.isArray(row.notes) ? row.notes : [];
  const latestNote = [...notes]
    .map((note) => asRecord(note))
    .filter((note): note is Record<string, unknown> => note !== null)
    .toSorted((left, right) => {
      const leftTime = Date.parse(String(left.date ?? left.created_at ?? "")) || 0;
      const rightTime = Date.parse(String(right.date ?? right.created_at ?? "")) || 0;
      return rightTime - leftTime;
    })[0];
  const updatedAt =
    normalizeTimestamp(row.date_updated) ??
    normalizeTimestamp(latestNote?.date ?? latestNote?.created_at);
  const rawUrl = row.url;
  const url = safeIncidentUrl(rawUrl, service);
  const rawId = boundedText(row.id, 200);
  const fallbackIdentity = createdAt || url ? [createdAt, url] : [title];
  const id = rawId ?? stableFallbackId(service.id, fallbackIdentity);
  const sourceType = boundedText(row.type, 100);
  const services = Array.isArray(row.services) ? row.services : [];

  return {
    id,
    title,
    body: boundedText(latestNote?.body ?? latestNote?.text),
    kind: state === "scheduled" ? "maintenance" : "incident",
    state,
    sourceStatus,
    sourceType,
    sourceImpact: null,
    // Slack documents issue types, not a universal severity scale; keep severity unknown.
    severityStatus: null,
    componentIds: [],
    components: uniqueNames(services),
    officialCreatedAt: createdAt,
    officialUpdatedAt: updatedAt,
    url,
    active: isIncidentActive(state),
  };
}
