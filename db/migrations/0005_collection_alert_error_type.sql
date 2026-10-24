ALTER TABLE collection_failures
  ADD COLUMN error_type TEXT NOT NULL DEFAULT 'UnknownError';

ALTER TABLE collection_alert_notifications
  ADD COLUMN error_type TEXT NOT NULL DEFAULT 'UnknownError';
