ALTER TABLE incidents ADD COLUMN closure_reason TEXT;
ALTER TABLE incidents ADD COLUMN recheck_unavailable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE incident_events ADD COLUMN closure_reason TEXT;

DROP TRIGGER IF EXISTS incidents_lifecycle_compat_insert;
DROP TRIGGER IF EXISTS incidents_lifecycle_compat_active_update;

-- Preserve why these rows were closed before restoring the last official
-- source status from event history.
UPDATE incidents
SET closure_reason = 'no_longer_listed'
WHERE lifecycle = 'resolved' AND source_status = 'not_listed';

-- The previous implementation replaced the last official state when an incident
-- disappeared. Recover it from the latest official event where possible.
UPDATE incidents
SET
  state = COALESCE((
    SELECT event.state
    FROM incident_events AS event
    WHERE event.service_id = incidents.service_id
      AND event.incident_id = incidents.id
      AND (
        event.event_kind IN ('opened', 'updated')
        OR (event.event_kind = 'resolved' AND event.source_status <> 'not_listed')
      )
    ORDER BY event.detected_at DESC
    LIMIT 1
  ), 'unknown'),
  source_status = COALESCE((
    SELECT event.source_status
    FROM incident_events AS event
    WHERE event.service_id = incidents.service_id
      AND event.incident_id = incidents.id
      AND (
        event.event_kind IN ('opened', 'updated')
        OR (event.event_kind = 'resolved' AND event.source_status <> 'not_listed')
      )
    ORDER BY event.detected_at DESC
    LIMIT 1
  ), 'unknown')
WHERE lifecycle = 'resolved' AND source_status = 'not_listed';

UPDATE incidents
SET
  state = COALESCE((
    SELECT event.state
    FROM incident_events AS event
    WHERE event.service_id = incidents.service_id
      AND event.incident_id = incidents.id
      AND event.event_kind IN ('opened', 'updated')
    ORDER BY event.detected_at DESC
    LIMIT 1
  ), 'unknown'),
  source_status = COALESCE((
    SELECT event.source_status
    FROM incident_events AS event
    WHERE event.service_id = incidents.service_id
      AND event.incident_id = incidents.id
      AND event.event_kind IN ('opened', 'updated')
    ORDER BY event.detected_at DESC
    LIMIT 1
  ), 'unknown')
WHERE lifecycle = 'unverified' AND source_status = 'recheck_unavailable';

UPDATE incident_events
SET
  event_kind = 'closed',
  closure_reason = 'no_longer_listed',
  state = COALESCE((
    SELECT previous.state
    FROM incident_events AS previous
    WHERE previous.service_id = incident_events.service_id
      AND previous.incident_id = incident_events.incident_id
      AND (
        previous.event_kind IN ('opened', 'updated')
        OR (previous.event_kind = 'resolved' AND previous.source_status <> 'not_listed')
      )
      AND previous.detected_at <= incident_events.detected_at
    ORDER BY previous.detected_at DESC
    LIMIT 1
  ), 'unknown'),
  source_status = COALESCE((
    SELECT previous.source_status
    FROM incident_events AS previous
    WHERE previous.service_id = incident_events.service_id
      AND previous.incident_id = incident_events.incident_id
      AND (
        previous.event_kind IN ('opened', 'updated')
        OR (previous.event_kind = 'resolved' AND previous.source_status <> 'not_listed')
      )
      AND previous.detected_at <= incident_events.detected_at
    ORDER BY previous.detected_at DESC
    LIMIT 1
  ), 'unknown')
WHERE event_kind = 'resolved' AND source_status = 'not_listed';

UPDATE incident_events
SET closure_reason = 'official_resolved'
WHERE event_kind = 'resolved';

UPDATE incidents
SET closure_reason = CASE
  WHEN state = 'resolved' THEN 'official_resolved'
  ELSE 'no_longer_listed'
END
WHERE lifecycle = 'resolved' AND closure_reason IS NULL;

-- Migration 0003 inferred "unverified" from an unknown official state. That
-- state is still useful official information and must remain actively tracked.
UPDATE incidents
SET
  lifecycle = 'active',
  active = 1,
  recheck_unavailable = 0
WHERE lifecycle = 'unverified'
  AND state = 'unknown'
  AND source_status <> 'recheck_unavailable';

UPDATE incidents
SET recheck_unavailable = 1
WHERE lifecycle = 'unverified'
  AND source_status = 'recheck_unavailable';

UPDATE incidents
SET recheck_unavailable = 1
WHERE lifecycle = 'unverified'
  AND state <> 'unknown';

-- Keep old lifecycle/source columns useful to a Worker deployed before this
-- migration while new Workers preserve explicit unknown official states.
CREATE TRIGGER incidents_lifecycle_compat_insert
AFTER INSERT ON incidents
WHEN (
  NEW.lifecycle = 'active'
  AND (
    NEW.source_status = 'recheck_unavailable'
    OR NEW.recheck_unavailable = 1
    OR NEW.active = 0
  )
)
  OR (NEW.lifecycle = 'unverified' AND NEW.closure_reason IS NULL)
  OR (NEW.lifecycle = 'resolved' AND NEW.closure_reason IS NULL)
BEGIN
  UPDATE incidents
  SET
    state = CASE
      WHEN NEW.source_status = 'not_listed' THEN COALESCE((
        SELECT event.state
        FROM incident_events AS event
        WHERE event.service_id = NEW.service_id
          AND event.incident_id = NEW.id
          AND event.event_kind IN ('opened', 'updated')
        ORDER BY event.detected_at DESC
        LIMIT 1
      ), 'unknown')
      ELSE NEW.state
    END,
    source_status = CASE
      WHEN NEW.source_status = 'not_listed' THEN COALESCE((
        SELECT event.source_status
        FROM incident_events AS event
        WHERE event.service_id = NEW.service_id
          AND event.incident_id = NEW.id
          AND event.event_kind IN ('opened', 'updated')
        ORDER BY event.detected_at DESC
        LIMIT 1
      ), 'unknown')
      ELSE NEW.source_status
    END,
    active = CASE
      WHEN NEW.state = 'resolved' OR NEW.active = 0 OR NEW.lifecycle = 'resolved' THEN 0
      ELSE 1
    END,
    lifecycle = CASE
      WHEN NEW.state = 'resolved' OR NEW.active = 0 OR NEW.lifecycle = 'resolved' THEN 'resolved'
      WHEN NEW.source_status = 'recheck_unavailable' OR NEW.recheck_unavailable = 1 THEN 'unverified'
      WHEN NEW.lifecycle = 'unverified' AND NEW.state <> 'unknown' THEN 'unverified'
      ELSE 'active'
    END,
    closure_reason = CASE
      WHEN NEW.state = 'resolved' AND NEW.source_status <> 'not_listed' THEN 'official_resolved'
      WHEN NEW.state = 'resolved' OR NEW.active = 0 OR NEW.lifecycle = 'resolved' THEN 'no_longer_listed'
      ELSE NULL
    END,
    recheck_unavailable = CASE
      WHEN NEW.source_status = 'recheck_unavailable'
        OR NEW.recheck_unavailable = 1
        OR (NEW.lifecycle = 'unverified' AND NEW.state <> 'unknown') THEN 1
      ELSE 0
    END,
    resolved_detected_at = CASE
      WHEN NEW.state = 'resolved' OR NEW.active = 0 OR NEW.lifecycle = 'resolved'
        THEN COALESCE(NEW.resolved_detected_at, NEW.last_observed_at)
      ELSE NULL
    END
  WHERE service_id = NEW.service_id AND id = NEW.id;
END;

CREATE TRIGGER incidents_lifecycle_compat_active_update
AFTER UPDATE OF active, state, source_status, lifecycle, recheck_unavailable ON incidents
WHEN NEW.closure_reason IS OLD.closure_reason
  AND (
    NEW.active IS NOT OLD.active
    OR NEW.state IS NOT OLD.state
    OR NEW.source_status IS NOT OLD.source_status
    OR NEW.lifecycle IS NOT OLD.lifecycle
    OR NEW.recheck_unavailable IS NOT OLD.recheck_unavailable
  )
BEGIN
  UPDATE incidents
  SET
    state = CASE
      WHEN NEW.source_status = 'not_listed' THEN COALESCE((
        SELECT event.state
        FROM incident_events AS event
        WHERE event.service_id = NEW.service_id
          AND event.incident_id = NEW.id
          AND event.event_kind IN ('opened', 'updated')
        ORDER BY event.detected_at DESC
        LIMIT 1
      ), 'unknown')
      ELSE NEW.state
    END,
    source_status = CASE
      WHEN NEW.source_status = 'not_listed' THEN COALESCE((
        SELECT event.source_status
        FROM incident_events AS event
        WHERE event.service_id = NEW.service_id
          AND event.incident_id = NEW.id
          AND event.event_kind IN ('opened', 'updated')
        ORDER BY event.detected_at DESC
        LIMIT 1
      ), 'unknown')
      ELSE NEW.source_status
    END,
    active = CASE
      WHEN NEW.lifecycle = 'active' AND OLD.lifecycle = 'unverified' THEN 1
      WHEN (NEW.source_status = 'recheck_unavailable' OR NEW.recheck_unavailable = 1)
        AND NEW.state <> 'resolved' THEN 1
      WHEN NEW.state = 'resolved' OR NEW.active = 0 OR NEW.lifecycle = 'resolved' THEN 0
      ELSE 1
    END,
    lifecycle = CASE
      WHEN (NEW.source_status = 'recheck_unavailable' OR NEW.recheck_unavailable = 1)
        AND NEW.state <> 'resolved' THEN 'unverified'
      WHEN NEW.state = 'resolved' OR NEW.active = 0 OR NEW.lifecycle = 'resolved' THEN 'resolved'
      WHEN NEW.lifecycle = 'active' AND OLD.lifecycle = 'unverified' THEN 'active'
      WHEN NEW.lifecycle = 'unverified' AND NEW.state <> 'unknown' THEN 'unverified'
      ELSE 'active'
    END,
    closure_reason = CASE
      WHEN NEW.state = 'resolved' AND NEW.source_status <> 'not_listed' THEN 'official_resolved'
      WHEN NEW.state = 'resolved' OR NEW.active = 0 OR NEW.lifecycle = 'resolved' THEN 'no_longer_listed'
      ELSE NULL
    END,
    recheck_unavailable = CASE
      WHEN NEW.lifecycle = 'active' AND OLD.lifecycle = 'unverified' THEN 0
      WHEN NEW.source_status = 'recheck_unavailable'
        OR NEW.recheck_unavailable = 1
        OR (NEW.lifecycle = 'unverified' AND NEW.state <> 'unknown') THEN 1
      ELSE 0
    END,
    resolved_detected_at = CASE
      WHEN NEW.state = 'resolved' OR NEW.active = 0 OR NEW.lifecycle = 'resolved'
        THEN COALESCE(NEW.resolved_detected_at, NEW.last_observed_at)
      ELSE NULL
    END
  WHERE service_id = NEW.service_id AND id = NEW.id;
END;

CREATE TRIGGER incident_events_closure_reason_compat_insert
AFTER INSERT ON incident_events
WHEN (
  NEW.closure_reason IS NULL
  AND NEW.event_kind IN ('resolved', 'closed')
)
  OR (NEW.event_kind = 'resolved' AND NEW.source_status = 'not_listed')
BEGIN
  UPDATE incident_events
  SET
    event_kind = CASE
      WHEN NEW.source_status = 'not_listed' THEN 'closed'
      ELSE NEW.event_kind
    END,
    closure_reason = CASE
      WHEN NEW.source_status = 'not_listed' OR NEW.event_kind = 'closed' THEN 'no_longer_listed'
      ELSE 'official_resolved'
    END,
    state = CASE
      WHEN NEW.source_status = 'not_listed' THEN COALESCE((
        SELECT previous.state
        FROM incident_events AS previous
        WHERE previous.service_id = NEW.service_id
          AND previous.incident_id = NEW.incident_id
          AND previous.id <> NEW.id
          AND previous.event_kind IN ('opened', 'updated')
        ORDER BY previous.detected_at DESC
        LIMIT 1
      ), 'unknown')
      ELSE NEW.state
    END,
    source_status = CASE
      WHEN NEW.source_status = 'not_listed' THEN COALESCE((
        SELECT previous.source_status
        FROM incident_events AS previous
        WHERE previous.service_id = NEW.service_id
          AND previous.incident_id = NEW.incident_id
          AND previous.id <> NEW.id
          AND previous.event_kind IN ('opened', 'updated')
        ORDER BY previous.detected_at DESC
        LIMIT 1
      ), 'unknown')
      ELSE NEW.source_status
    END
  WHERE id = NEW.id;
END;
