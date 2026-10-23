ALTER TABLE incidents
  ADD COLUMN component_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE incident_events
  ADD COLUMN component_ids_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS service_components (
  service_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  source_status TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  PRIMARY KEY (service_id, id)
);
