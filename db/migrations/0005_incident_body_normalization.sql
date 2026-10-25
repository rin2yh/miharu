ALTER TABLE incidents
  ADD COLUMN body_normalized INTEGER NOT NULL DEFAULT 0;

-- Older Workers do not write the normalization marker. If one changes a body,
-- mark it as legacy so the API converts it before returning it.
CREATE TRIGGER incidents_body_normalization_compat_update
AFTER UPDATE OF body ON incidents
WHEN NEW.body IS NOT OLD.body
  AND NEW.body_normalized = OLD.body_normalized
BEGIN
  UPDATE incidents
  SET body_normalized = 0
  WHERE service_id = NEW.service_id AND id = NEW.id;
END;
