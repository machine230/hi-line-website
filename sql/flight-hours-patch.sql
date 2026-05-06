-- ============================================================
-- PNWAV8R — Flight Hours & Cost Columns
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS flight_hours float,
    ADD COLUMN IF NOT EXISTS flight_cost  float;

-- Backfill existing rows that have both tach values
UPDATE public.flight_logs
SET
    flight_hours = ROUND((tach_end - tach_start)::numeric, 1),
    flight_cost  = ROUND(((tach_end - tach_start) * 65)::numeric, 2)
WHERE tach_start IS NOT NULL
  AND tach_end   IS NOT NULL
  AND flight_hours IS NULL;

SELECT 'Flight hours/cost columns added' AS status;
