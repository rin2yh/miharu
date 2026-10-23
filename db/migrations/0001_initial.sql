CREATE TABLE IF NOT EXISTS service_status (
  service_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  source_status TEXT,
  summary TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS incidents (
  service_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  source_status TEXT NOT NULL,
  source_type TEXT,
  source_impact TEXT,
  severity_status TEXT,
  components_json TEXT NOT NULL,
  official_created_at TEXT,
  official_updated_at TEXT,
  url TEXT,
  active INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  resolved_detected_at TEXT,
  fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL,
  last_observed_at TEXT NOT NULL,
  PRIMARY KEY (service_id, id)
);

CREATE INDEX IF NOT EXISTS incidents_active_service_idx
  ON incidents (active, service_id);
CREATE INDEX IF NOT EXISTS incidents_resolved_detected_idx
  ON incidents (resolved_detected_at);

CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY NOT NULL,
  service_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL,
  source_status TEXT NOT NULL,
  source_type TEXT,
  source_impact TEXT,
  severity_status TEXT,
  components_json TEXT NOT NULL,
  url TEXT,
  official_event_at TEXT,
  detected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS incident_events_detected_idx
  ON incident_events (detected_at);
CREATE INDEX IF NOT EXISTS incident_events_service_detected_idx
  ON incident_events (service_id, detected_at);
