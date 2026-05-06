-- ============================================================
-- Migration 005: Hi-Line MVP additions
-- Run AFTER schema.sql + migrations 002, 003, 004
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ============================================================

-- ── 1. Hourly rate on airplanes ──────────────────────────
-- Stores the dry rate in the DB for accurate cost tracking.
-- Drives future billing reports independent of club-config.js.
ALTER TABLE airplanes
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(6,2);

-- Set N2134Y rate (update this once client confirms the rate)
-- UPDATE airplanes SET hourly_rate = 95.00 WHERE tail_number = 'N2134Y';

-- ── 2. Tach conflict tracking on flight_logs ─────────────
-- Soft warning: flagged when tach_start doesn't match the
-- airplane's current_tach. Submission is still allowed.
ALTER TABLE flight_logs
  ADD COLUMN IF NOT EXISTS tach_conflict      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tach_conflict_note text;

-- ── 3. Max booking duration constraint (7 days) ──────────
-- Prevents accidental multi-week bookings.
ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS max_booking_duration;

ALTER TABLE reservations
  ADD CONSTRAINT max_booking_duration
  CHECK (end_time - start_time <= interval '7 days');

-- ── 4. Auto-update airplane current_tach after flight log ─
-- Keeps airplanes.current_tach in sync with the latest
-- submitted tach_end. Only updates if the new value is higher
-- (guards against out-of-order log submissions).
CREATE OR REPLACE FUNCTION fn_update_airplane_tach()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tach_end IS NOT NULL THEN
    UPDATE airplanes
    SET
      current_tach = NEW.tach_end,
      updated_at   = now()
    WHERE id = NEW.airplane_id
      AND (current_tach IS NULL OR NEW.tach_end > current_tach);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_airplane_tach ON flight_logs;

CREATE TRIGGER trg_update_airplane_tach
AFTER INSERT ON flight_logs
FOR EACH ROW
EXECUTE FUNCTION fn_update_airplane_tach();

-- ── 5. Helper function: detect tach conflict ─────────────
-- Called by the post-flight Netlify function before insert.
-- Returns true if tach_start differs from airplane's current_tach
-- by more than 0.1 hours (rounding tolerance).
CREATE OR REPLACE FUNCTION fn_check_tach_conflict(
  p_airplane_id  uuid,
  p_tach_start   numeric
)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT CASE
    WHEN current_tach IS NULL        THEN false
    WHEN ABS(current_tach - p_tach_start) > 0.1 THEN true
    ELSE false
  END
  FROM airplanes
  WHERE id = p_airplane_id;
$$;
