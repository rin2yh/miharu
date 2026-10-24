DROP TRIGGER IF EXISTS incidents_lifecycle_compat_active_update;

CREATE TRIGGER incidents_lifecycle_compat_active_update
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
