-- ============================================================
-- Migration 012 — Consolidated missing columns + member_directory view
-- Safe to re-run (all use IF NOT EXISTS / OR REPLACE)
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Flight log: soft delete ────────────────────────────
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS is_deleted  boolean     DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_by  uuid        REFERENCES public.members(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;

-- ── 2. Flight log: fuel fields ────────────────────────────
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS needs_fuel                boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS fuel_added_gallons        float,
    ADD COLUMN IF NOT EXISTS fuel_estimate_left_tank   float,
    ADD COLUMN IF NOT EXISTS fuel_estimate_right_tank  float,
    ADD COLUMN IF NOT EXISTS fuel_comment              text;

-- ── 3. Flight log: oil fields ─────────────────────────────
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS oil_qty_start_quarts  float,
    ADD COLUMN IF NOT EXISTS oil_added_quarts       float DEFAULT 0,
    ADD COLUMN IF NOT EXISTS oil_qty_end_quarts     float;

-- ── 4. Flight log: hours + cost ───────────────────────────
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS flight_hours  float,
    ADD COLUMN IF NOT EXISTS flight_cost   float;

-- Backfill existing rows that have tach values but no flight_hours yet
UPDATE public.flight_logs
SET
    flight_hours = ROUND((tach_end - tach_start)::numeric, 1),
    flight_cost  = ROUND(((tach_end - tach_start) * 50)::numeric, 2)
WHERE tach_start   IS NOT NULL
  AND tach_end     IS NOT NULL
  AND flight_hours IS NULL;

-- ── 5. Flight log: RLS update ─────────────────────────────
DROP POLICY IF EXISTS "Members can insert flight logs"          ON public.flight_logs;
DROP POLICY IF EXISTS "Members can view own flight logs"        ON public.flight_logs;
DROP POLICY IF EXISTS "All members can view non-deleted flight logs" ON public.flight_logs;
DROP POLICY IF EXISTS "Admin can soft-delete flight logs"       ON public.flight_logs;

CREATE POLICY "All members can view non-deleted flight logs"
    ON public.flight_logs FOR SELECT
    USING (auth.uid() IS NOT NULL AND (is_deleted IS NULL OR is_deleted = false));

CREATE POLICY "Members can insert flight logs"
    ON public.flight_logs FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can soft-delete flight logs"
    ON public.flight_logs FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'admin'));

-- ── 6. Squawk columns (from migration 011) ────────────────
ALTER TABLE public.squawks
    ADD COLUMN IF NOT EXISTS status_updated_at  timestamptz,
    ADD COLUMN IF NOT EXISTS admin_response_at  timestamptz,
    ADD COLUMN IF NOT EXISTS admin_response_by  uuid REFERENCES public.members(id) ON DELETE SET NULL;

-- ── 7. Member directory view (from migration 010) ─────────
DROP POLICY IF EXISTS "members_select" ON public.members;

-- Members can only read their own row directly
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'members' AND policyname = 'members_read_own_row'
    ) THEN
        CREATE POLICY "members_read_own_row" ON public.members
            FOR SELECT USING (id = auth.uid());
    END IF;
END $$;

-- Safe public view of member contact info (used by schedule + directory)
CREATE OR REPLACE VIEW public.member_directory
    WITH (security_invoker = off) AS
SELECT
    id, name, email, phone, role,
    membership_active, profile_completed, pic_status, joined_at
FROM public.members
WHERE membership_active = true
ORDER BY name;

GRANT SELECT ON public.member_directory TO authenticated;

-- ── 8. Reservation RLS — admin can edit any reservation ───
DROP POLICY IF EXISTS "Role-based reservation update" ON public.reservations;
DROP POLICY IF EXISTS "Role-based reservation delete" ON public.reservations;

CREATE POLICY "Role-based reservation update"
    ON public.reservations FOR UPDATE
    USING (
        EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'admin')
        OR EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'ap')
        OR (member_id = auth.uid() AND start_time > now())
    );

CREATE POLICY "Role-based reservation delete"
    ON public.reservations FOR DELETE
    USING (
        EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'admin')
        OR EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'ap')
        OR (member_id = auth.uid() AND start_time > now())
    );

SELECT 'Migration 012 complete — all missing columns, view, and RLS applied' AS status;
