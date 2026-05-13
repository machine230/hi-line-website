-- ============================================================
-- Migration 014 — Idempotent fix (safe to re-run anytime)
-- Adds all missing columns + recreates policies cleanly
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Helper function ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.members WHERE id = auth.uid();
$$;

-- ── 2. Members SELECT policies (drop first, then recreate) ─
DROP POLICY IF EXISTS "members_select"           ON public.members;
DROP POLICY IF EXISTS "members_read_own_row"     ON public.members;
DROP POLICY IF EXISTS "admin_read_all_members"   ON public.members;

CREATE POLICY "admin_read_all_members" ON public.members
    FOR SELECT USING (public.get_my_role() = 'admin');

CREATE POLICY "members_read_own_row" ON public.members
    FOR SELECT USING (id = auth.uid());

-- ── 3. Member directory view ──────────────────────────────
DROP VIEW IF EXISTS public.member_directory;
CREATE VIEW public.member_directory WITH (security_invoker = off) AS
SELECT id, name, email, phone, role, membership_active, profile_completed, pic_status, joined_at
FROM public.members WHERE membership_active = true ORDER BY name;
GRANT SELECT ON public.member_directory TO authenticated;

-- ── 4. Airplanes — missing columns ───────────────────────
ALTER TABLE public.airplanes
    ADD COLUMN IF NOT EXISTS grounded_from  timestamptz,
    ADD COLUMN IF NOT EXISTS grounded_until timestamptz,
    ADD COLUMN IF NOT EXISTS hourly_rate    numeric(6,2),
    ADD COLUMN IF NOT EXISTS notes          text;

-- ── 5. Flight logs — missing columns ─────────────────────
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS flight_hours              float,
    ADD COLUMN IF NOT EXISTS flight_cost               float,
    ADD COLUMN IF NOT EXISTS is_deleted                boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_by                uuid REFERENCES public.members(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deleted_at                timestamptz,
    ADD COLUMN IF NOT EXISTS needs_fuel                boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS fuel_added_gallons        float,
    ADD COLUMN IF NOT EXISTS fuel_estimate_left_tank   float,
    ADD COLUMN IF NOT EXISTS fuel_estimate_right_tank  float,
    ADD COLUMN IF NOT EXISTS fuel_comment              text,
    ADD COLUMN IF NOT EXISTS oil_qty_start_quarts      float,
    ADD COLUMN IF NOT EXISTS oil_added_quarts          float DEFAULT 0,
    ADD COLUMN IF NOT EXISTS oil_qty_end_quarts        float;

-- Backfill flight_hours from tach where missing
UPDATE public.flight_logs
SET flight_hours = ROUND((tach_end - tach_start)::numeric, 1)
WHERE tach_start IS NOT NULL AND tach_end IS NOT NULL AND flight_hours IS NULL;

-- ── 6. Flight logs RLS (drop first, then recreate) ───────
DROP POLICY IF EXISTS "Members can insert flight logs"               ON public.flight_logs;
DROP POLICY IF EXISTS "Members can view own flight logs"             ON public.flight_logs;
DROP POLICY IF EXISTS "All members can view non-deleted flight logs" ON public.flight_logs;
DROP POLICY IF EXISTS "Admin can soft-delete flight logs"            ON public.flight_logs;

CREATE POLICY "All members can view non-deleted flight logs"
    ON public.flight_logs FOR SELECT
    USING (auth.uid() IS NOT NULL AND (is_deleted IS NULL OR is_deleted = false));

CREATE POLICY "Members can insert flight logs"
    ON public.flight_logs FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can soft-delete flight logs"
    ON public.flight_logs FOR UPDATE
    USING (public.get_my_role() = 'admin');

-- ── 7. Squawk columns ────────────────────────────────────
ALTER TABLE public.squawks
    ADD COLUMN IF NOT EXISTS status_updated_at  timestamptz,
    ADD COLUMN IF NOT EXISTS admin_response_at  timestamptz,
    ADD COLUMN IF NOT EXISTS admin_response_by  uuid REFERENCES public.members(id) ON DELETE SET NULL;

-- ── 8. Reservation RLS (drop first, then recreate) ───────
DROP POLICY IF EXISTS "Role-based reservation update" ON public.reservations;
DROP POLICY IF EXISTS "Role-based reservation delete" ON public.reservations;

CREATE POLICY "Role-based reservation update" ON public.reservations FOR UPDATE
    USING (
        public.get_my_role() IN ('admin', 'ap')
        OR (member_id = auth.uid() AND start_time > now())
    );

CREATE POLICY "Role-based reservation delete" ON public.reservations FOR DELETE
    USING (
        public.get_my_role() IN ('admin', 'ap')
        OR (member_id = auth.uid() AND start_time > now())
    );

SELECT 'Migration 014 complete — all columns, policies, and view applied cleanly' AS status;
