import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  IncidentEventKind,
  IncidentClosureReason,
  IncidentKind,
  IncidentLifecycle,
  IncidentState,
  NormalizedStatus,
} from "../src/domain";

// Keep this schema aligned with the final shape of db/migrations/*.sql.
export const serviceStatus = sqliteTable("service_status", {
  serviceId: text("service_id").primaryKey().notNull(),
  status: text("status").$type<NormalizedStatus>().notNull().default("unknown"),
  sourceStatus: text("source_status"),
  summary: text("summary"),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessAt: text("last_success_at"),
  lastErrorAt: text("last_error_at"),
  errorCode: text("error_code"),
});

export const incidents = sqliteTable(
  "incidents",
  {
    serviceId: text("service_id").notNull(),
    id: text("id").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    bodyNormalized: integer("body_normalized", { mode: "boolean" }).notNull().default(false),
    kind: text("kind").$type<IncidentKind>().notNull(),
    state: text("state").$type<IncidentState>().notNull(),
    sourceStatus: text("source_status").notNull(),
    sourceType: text("source_type"),
    sourceImpact: text("source_impact"),
    severityStatus: text("severity_status").$type<NormalizedStatus>(),
    componentsJson: text("components_json").notNull(),
    officialCreatedAt: text("official_created_at"),
    officialUpdatedAt: text("official_updated_at"),
    url: text("url"),
    active: integer("active", { mode: "boolean" }).notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    resolvedDetectedAt: text("resolved_detected_at"),
    closureReason: text("closure_reason").$type<IncidentClosureReason>(),
    recheckUnavailable: integer("recheck_unavailable", { mode: "boolean" })
      .notNull()
      .default(false),
    fingerprint: text("fingerprint").notNull(),
    revision: integer("revision").notNull(),
    lastObservedAt: text("last_observed_at").notNull(),
    componentIdsJson: text("component_ids_json").notNull().default("[]"),
    lifecycle: text("lifecycle")
      .$type<IncidentLifecycle | "resolved">()
      .notNull()
      .default("active"),
  },
  (table) => [
    primaryKey({ columns: [table.serviceId, table.id] }),
    index("incidents_active_service_idx").on(table.active, table.serviceId),
    index("incidents_resolved_detected_idx").on(table.resolvedDetectedAt),
    index("incidents_lifecycle_service_idx").on(table.serviceId, table.lifecycle),
  ],
);

export const incidentEvents = sqliteTable(
  "incident_events",
  {
    id: text("id").primaryKey().notNull(),
    serviceId: text("service_id").notNull(),
    incidentId: text("incident_id").notNull(),
    kind: text("kind").$type<IncidentKind>().notNull(),
    eventKind: text("event_kind").$type<IncidentEventKind>().notNull(),
    title: text("title").notNull(),
    body: text("body"),
    state: text("state").$type<IncidentState>().notNull(),
    sourceStatus: text("source_status").notNull(),
    sourceType: text("source_type"),
    sourceImpact: text("source_impact"),
    severityStatus: text("severity_status").$type<NormalizedStatus>(),
    componentsJson: text("components_json").notNull(),
    url: text("url"),
    officialEventAt: text("official_event_at"),
    detectedAt: text("detected_at").notNull(),
    componentIdsJson: text("component_ids_json").notNull().default("[]"),
    closureReason: text("closure_reason").$type<IncidentClosureReason>(),
  },
  (table) => [
    index("incident_events_detected_idx").on(table.detectedAt),
    index("incident_events_service_detected_idx").on(table.serviceId, table.detectedAt),
  ],
);

export const serviceComponents = sqliteTable(
  "service_components",
  {
    serviceId: text("service_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    status: text("status").$type<NormalizedStatus>().notNull(),
    sourceStatus: text("source_status").notNull(),
    lastChangedAt: text("last_changed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.serviceId, table.id] })],
);

export type ServiceStatusRow = typeof serviceStatus.$inferSelect;
export type ServiceComponentRow = typeof serviceComponents.$inferSelect;
export type IncidentRow = Omit<
  typeof incidents.$inferSelect,
  "active" | "recheckUnavailable" | "lifecycle" | "resolvedDetectedAt"
> & {
  lifecycle: IncidentLifecycle;
  closedDetectedAt: string | null;
};
export type IncidentEventRow = typeof incidentEvents.$inferSelect;

export interface DashboardRows {
  statusRows: ServiceStatusRow[];
  componentRows: ServiceComponentRow[];
  incidentRows: IncidentRow[];
  eventRows: IncidentEventRow[];
}
