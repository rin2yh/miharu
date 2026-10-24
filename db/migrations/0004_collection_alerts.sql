CREATE TABLE IF NOT EXISTS collection_failures (
  service_id TEXT PRIMARY KEY NOT NULL,
  consecutive_failures INTEGER NOT NULL,
  first_failed_at TEXT NOT NULL,
  last_failed_at TEXT NOT NULL,
  error_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_alert_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  error_code TEXT NOT NULL,
  first_failed_at TEXT NOT NULL,
  failure_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS collection_alert_notifications_pending_idx
  ON collection_alert_notifications (delivered_at, lease_until, created_at);
