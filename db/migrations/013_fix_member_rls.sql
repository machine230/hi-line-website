-- ============================================================
-- Migration 013 — Fix member RLS: restore admin full read access
-- Safe to re-run
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Helper function (avoids recursive policy lookups) ──
-- SECURITY DEFINER runs as postgres superuser, bypasses RLS
-- so it can safely read the members table to get the role.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.members WHERE id = auth.uid();
$$;

-- ── 2. Fix members table SELECT policies ──────────────────
-- Problem: migration 012 dropped the broad select policy and
-- only left "members_read_own_row", breaking admin.html which
-- does SELECT * to list all members.

-- Drop both old policies to start clean
DROP POLICY IF EXISTS "members_select"       ON public.members;
DROP POLICY IF EXISTS "members_read_own_row" ON public.members;

-- Admins can read all member rows (uses helper fn, no recursion)
CREATE POLICY "admin_read_all_members"
    ON public.members FOR SELECT
    USING (public.get_my_role() = 'admin');

-- Every member can read their own row (for profile, auth checks)
CREATE POLICY "members_read_own_row"
    ON public.members FOR SELECT
    USING (id = auth.uid());

-- ── 3. Recreate member_directory view cleanly ─────────────
-- Used by directory.html and schedule.html contact popovers.
-- security_invoker=off means it runs as view owner (postgres),
-- bypassing RLS on members so all authenticated users can see
-- safe columns (no DOB, no medical details).
DROP VIEW IF EXISTS public.member_directory;

CREATE VIEW public.member_directory
    WITH (security_invoker = off) AS
SELECT
    id,
    name,
    email,
    phone,
    role,
    membership_active,
    profile_completed,
    pic_status,
    joined_at
FROM public.members
WHERE membership_active = true
ORDER BY name;

GRANT SELECT ON public.member_directory TO authenticated;

-- ── 4. Verify flight_logs columns exist ──────────────────
-- These should exist after migration 012, but double-check
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS flight_hours              float,
    ADD COLUMN IF NOT EXISTS flight_cost               float,
    ADD COLUMN IF NOT EXISTS is_deleted                boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS needs_fuel                boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS fuel_added_gallons        float,
    ADD COLUMN IF NOT EXISTS fuel_estimate_left_tank   float,
    ADD COLUMN IF NOT EXISTS fuel_estimate_right_tank  float,
    ADD COLUMN IF NOT EXISTS oil_qty_start_quarts      float,
    ADD COLUMN IF NOT EXISTS oil_added_quarts          float DEFAULT 0,
    ADD COLUMN IF NOT EXISTS oil_qty_end_quarts        float;

-- ── 5. Airplanes: add missing grounded_from / grounded_until ─
-- These exist in db/schema.sql but were never added via a migration.
-- Without them the admin airplane query fails → airplaneId = null
-- → flight log returns nothing.
ALTER TABLE public.airplanes
    ADD COLUMN IF NOT EXISTS grounded_from  timestamptz,
    ADD COLUMN IF NOT EXISTS grounded_until timestamptz,
    ADD COLUMN IF NOT EXISTS hourly_rate    numeric(6,2),
    ADD COLUMN IF NOT EXISTS notes         text;

SELECT 'Migration 013 complete — member RLS fixed, directory view recreated, grounded columns added' AS status;
