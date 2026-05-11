-- ============================================================
-- Migration 010: Member Privacy
-- Restricts sensitive columns (date_of_birth, bfr_date,
-- medical_class, medical_date, basicmed_*) to the member's
-- own row only. Creates a member_directory view that exposes
-- only contact-safe columns to all active members.
--
-- What changes:
--   BEFORE: "members_select" lets any active member SELECT
--           any row with any columns (includes DOB/medical)
--   AFTER:  "members_read_own_row" lets a member SELECT only
--           their own row (all columns still available to them)
--           Admin "members_admin" FOR ALL already covers admins.
--
-- The member_directory view (security_invoker = off) runs as
-- its owner (postgres), bypassing the row restriction so all
-- active members appear in the directory — but ONLY the safe
-- columns are ever exposed through this view.
--
-- schedule.html and directory.html are updated to use
-- member_directory for cross-member lookups.
-- ============================================================

-- ── 1. Drop the broad SELECT policy ──────────────────────────
DROP POLICY IF EXISTS "members_select" ON public.members;

-- ── 2. Own-row SELECT policy ──────────────────────────────────
-- Any authenticated user can read all columns of their own row.
-- Admins can read all rows via the existing "members_admin" FOR ALL policy.
DROP POLICY IF EXISTS "members_read_own_row" ON public.members;
CREATE POLICY "members_read_own_row" ON public.members
    FOR SELECT USING (id = auth.uid());

-- ── 3. Safe directory view ────────────────────────────────────
-- Exposes only non-sensitive columns for all active members.
-- security_invoker = off → runs as view owner (postgres/superuser),
-- bypassing the restrictive members_read_own_row RLS so all
-- active members appear. Safe because no sensitive columns are
-- included in the view definition.
CREATE OR REPLACE VIEW public.member_directory
WITH (security_invoker = off)
AS
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

-- ── 4. Grant SELECT on the view to authenticated users ────────
-- PostgREST queries as the 'authenticated' role.
GRANT SELECT ON public.member_directory TO authenticated;

-- ── Verification ──────────────────────────────────────────────
DO $$
BEGIN
  -- Ensure own-row policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'members' AND policyname = 'members_read_own_row'
  ) THEN
    RAISE EXCEPTION 'SAFETY CHECK FAILED: members_read_own_row policy not found.';
  END IF;

  -- Ensure broad policy is gone
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'members' AND policyname = 'members_select'
  ) THEN
    RAISE EXCEPTION 'SAFETY CHECK FAILED: members_select policy still exists.';
  END IF;
END $$;

SELECT 'Migration 010 applied — member privacy enforced at DB level' AS status;
