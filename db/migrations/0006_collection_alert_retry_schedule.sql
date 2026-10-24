ALTER TABLE collection_alert_notifications
  ADD COLUMN next_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS collection_alert_notifications_retry_idx
  ON collection_alert_notifications (delivered_at, next_attempt_at, lease_until, created_at);
