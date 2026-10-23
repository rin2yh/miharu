import { Hono } from "hono";
import {
  FRESHNESS_WARNING_SECONDS,
  INCIDENT_HISTORY_DISPLAY_LIMIT,
  SERVICES,
} from "../../../shared/config/services";
import type {
  DashboardComponent,
  DashboardEvent,
  DashboardIncident,
  DashboardPayload,
} from "../../../domain";
import type { DashboardRows } from "../../../../db/schema";
import { createD1Store, parseComponents, type DashboardStore } from "../../../shared/store";
import { toPlainText } from "../../../domain/text";

export interface StatusBindings {
  DB: D1Database;
}

type DashboardReader = Pick<DashboardStore, "getDashboardRows">;
type StoreFactory = (database: D1Database) => DashboardReader;

export function createStatusRoutes(storeFactory: StoreFactory = createD1Store) {
  const app = new Hono<{ Bindings: StatusBindings }>();

  app.get("/api/status", async (context) => {
    try {
      const now = new Date();
      const rows = await storeFactory(context.env.DB).getDashboardRows();
      return context.json(buildDashboardPayload(rows, now), 200, {
        "Cache-Control": "public, max-age=10, s-maxage=10, stale-while-revalidate=10",
        "X-Content-Type-Options": "nosniff",
      });
    } catch {
      return context.json({ error: "dashboard_unavailable" }, 503, {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    }
  });

  return app;
}

export function buildDashboardPayload(rows: DashboardRows, now: Date): DashboardPayload {
  const statusById = new Map(rows.statusRows.map((row) => [row.serviceId, row]));
  const componentsByService = new Map<string, DashboardComponent[]>();
  const incidentsByService = new Map<string, DashboardIncident[]>();

  for (const row of rows.componentRows) {
    if (!SERVICES.some((service) => service.id === row.serviceId)) continue;
    const list = componentsByService.get(row.serviceId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      status: row.status,
      sourceStatus: row.sourceStatus,
      lastChangedAt: row.lastChangedAt,
    });
    componentsByService.set(row.serviceId, list);
  }

  for (const row of rows.activeRows) {
    if (!SERVICES.some((service) => service.id === row.serviceId)) continue;
    const list = incidentsByService.get(row.serviceId) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      body: toPlainText(row.body),
      kind: row.kind,
      state: row.state,
      sourceStatus: row.sourceStatus,
      sourceType: row.sourceType,
      sourceImpact: row.sourceImpact,
      severityStatus: row.severityStatus,
      componentIds: parseComponents(row.componentIdsJson),
      components: parseComponents(row.componentsJson),
      officialCreatedAt: row.officialCreatedAt,
      officialUpdatedAt: row.officialUpdatedAt,
      url: row.url,
    });
    incidentsByService.set(row.serviceId, list);
  }

  const services = SERVICES.map((service) => {
    const state = statusById.get(service.id);
    const lastSuccessAt = state?.lastSuccessAt ?? null;
    const checkedAt = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN;
    return {
      id: service.id,
      name: service.name,
      status: state?.status ?? "unknown",
      sourceStatus: state?.sourceStatus ?? null,
      summary: state?.summary ?? null,
      statusPageUrl: service.statusPageUrl,
      lastSuccessAt,
      hasFetchError: Boolean(state?.lastErrorAt),
      isStale:
        !Number.isFinite(checkedAt) ||
        now.getTime() - checkedAt > FRESHNESS_WARNING_SECONDS * 1_000,
      components: componentsByService.get(service.id) ?? [],
      incidents: incidentsByService.get(service.id) ?? [],
    } satisfies DashboardPayload["services"][number];
  });

  const serviceNames = new Map(SERVICES.map((service) => [service.id, service.name]));
  const recentEvents: DashboardEvent[] = rows.eventRows
    .filter((row) => serviceNames.has(row.serviceId))
    .slice(0, INCIDENT_HISTORY_DISPLAY_LIMIT)
    .map((row) => ({
      id: row.id,
      serviceId: row.serviceId,
      serviceName: serviceNames.get(row.serviceId) ?? row.serviceId,
      incidentId: row.incidentId,
      title: row.title,
      kind: row.kind,
      eventKind: row.eventKind,
      sourceStatus: row.sourceStatus,
      severityStatus: row.severityStatus,
      detectedAt: row.detectedAt,
      officialEventAt: row.officialEventAt,
      url: row.url,
    }));

  return {
    generatedAt: now.toISOString(),
    freshnessWarningSeconds: FRESHNESS_WARNING_SECONDS,
    services,
    recentEvents,
  };
}
