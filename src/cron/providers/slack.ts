import { normalizeStatus, type NormalizedIncident, type ProviderSnapshot } from "../../domain";
import { stableFallbackId } from "../../domain/id";
import { INCIDENTS_PER_SERVICE_LIMIT, type ServiceConfig } from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import {
  asRecord,
  boundedText,
  fetchJson,
  normalizeTimestamp,
  parseIncidentState,
  ProviderError,
  requiredText,
  safeIncidentUrl,
  uniqueNames,
} from "./shared";

type SlackService = Extract<ServiceConfig, { provider: "slack" }>;

export async function fetchSlackSnapshot(
  service: SlackService,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  const { signal, fetcher } = context;
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
    components: normalizeSlackComponents(service, incidents),
    incidents,
  };
}

function normalizeSlackComponents(
  service: SlackService,
  incidents: NormalizedIncident[],
): ProviderSnapshot["components"] {
  const reportByComponentId = new Map<string, "affected" | "scheduled" | "under_maintenance">();
  const now = Date.now();

  for (const incident of incidents) {
    if (incident.state === "resolved") continue;

    for (const name of incident.components) {
      const component = findSlackComponent(service, name);
      if (!component) continue;

      const status = slackComponentReport(incident, now);
      const current = reportByComponentId.get(component.id);
      if (slackComponentReportPriority(status) > slackComponentReportPriority(current)) {
        reportByComponentId.set(component.id, status);
      }
    }
  }

  return service.components.map(({ id, name }) => {
    const report = reportByComponentId.get(id);
    if (report === "under_maintenance") {
      return { id, name, status: "under_maintenance", sourceStatus: "scheduled" };
    }
    if (report === "affected") {
      // Slack identifies affected features but does not return a per-feature impact level.
      return { id, name, status: "unknown", sourceStatus: "affected" };
    }
    if (report === "scheduled") {
      // The scheduled maintenance is shown on its incident; its current feature state is unknown.
      return { id, name, status: "unknown", sourceStatus: "scheduled" };
    }
    return { id, name, status: "unknown", sourceStatus: "not_reported" };
  });
}

function slackComponentReport(
  incident: NormalizedIncident,
  now: number,
): "affected" | "scheduled" | "under_maintenance" {
  if (incident.state !== "scheduled") return "affected";

  // Slack defines date_created as when maintenance begins; a future or missing time is not active yet.
  const startsAt = incident.officialCreatedAt ? Date.parse(incident.officialCreatedAt) : Number.NaN;
  return Number.isFinite(startsAt) && startsAt <= now ? "under_maintenance" : "scheduled";
}

function slackComponentReportPriority(
  report: "affected" | "scheduled" | "under_maintenance" | undefined,
): number {
  switch (report) {
    case "affected":
      return 3;
    case "under_maintenance":
      return 2;
    case "scheduled":
      return 1;
    default:
      return 0;
  }
}

function findSlackComponent(
  service: SlackService,
  name: string,
): SlackService["components"][number] | undefined {
  const normalizedName = normalizeServiceName(name);
  return service.components.find(
    ({ name: featureName }) => normalizeServiceName(featureName) === normalizedName,
  );
}

function normalizeServiceName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
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
  const services = Array.isArray(row.services)
    ? uniqueNames(row.services).map((name) => findSlackComponent(service, name)?.name ?? name)
    : [];

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
    components: services,
    officialCreatedAt: createdAt,
    officialUpdatedAt: updatedAt,
    url,
  };
}
