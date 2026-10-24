ALTER TABLE incidents
  ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active';

UPDATE incidents
SET lifecycle = CASE
  WHEN source_status = 'recheck_unavailable' THEN 'unverified'
  WHEN active = 0 THEN 'resolved'
  WHEN state = 'unknown' THEN 'unverified'
  ELSE 'active'
END;

UPDATE incidents
SET active = 1
WHERE lifecycle = 'unverified';

CREATE INDEX IF NOT EXISTS incidents_lifecycle_service_idx
  ON incidents (service_id, lifecycle);

-- Older Workers only write the active flag. Preserve the explicit lifecycle when
-- new Workers write it, and translate legacy writes for safe staged deployments.
CREATE TRIGGER IF NOT EXISTS incidents_lifecycle_compat_insert
AFTER INSERT ON incidents
WHEN NEW.source_status = 'recheck_unavailable' OR NEW.active = 0
BEGIN
  UPDATE incidents
  SET
    active = CASE WHEN NEW.source_status = 'recheck_unavailable' THEN 1 ELSE NEW.active END,
    lifecycle = CASE
      WHEN NEW.source_status = 'recheck_unavailable' THEN 'unverified'
      WHEN NEW.active = 0 THEN 'resolved'
      ELSE 'active'
    END
  WHERE service_id = NEW.service_id AND id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS incidents_lifecycle_compat_active_update
AFTER UPDATE OF active, state, source_status ON incidents
WHEN NEW.lifecycle = OLD.lifecycle AND (
  NEW.active IS NOT OLD.active
  OR NEW.state IS NOT OLD.state
  OR NEW.source_status IS NOT OLD.source_status
)
BEGIN
  UPDATE incidents
  SET
    active = CASE
      WHEN NEW.state = 'resolved' THEN 0
      WHEN NEW.source_status = 'recheck_unavailable' OR NEW.state = 'unknown' THEN 1
      WHEN OLD.lifecycle = 'unverified' AND NEW.active = 0 THEN 1
      ELSE NEW.active
    END,
    lifecycle = CASE
      WHEN NEW.state = 'resolved' THEN 'resolved'
      WHEN NEW.source_status = 'recheck_unavailable' OR NEW.state = 'unknown' THEN 'unverified'
      WHEN OLD.lifecycle = 'unverified' AND NEW.active = 0 THEN 'unverified'
      WHEN NEW.active = 0 THEN 'resolved'
      ELSE 'active'
    END
  WHERE service_id = NEW.service_id AND id = NEW.id;
END;
