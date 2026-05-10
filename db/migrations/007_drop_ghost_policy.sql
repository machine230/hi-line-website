-- ============================================================
-- Migration 007: SECURITY — Drop ghost members_update policy
-- ============================================================
-- CRITICAL: The original schema.sql created a "members_update"
-- policy with no WITH CHECK clause. PostgreSQL repeats the USING
-- clause as WITH CHECK when none is specified, meaning any member
-- could update any column on their own row — including 'role'.
--
-- The "Members can update own profile" policy (from security-patch-01)
-- has a proper WITH CHECK that blocks role/membership/pic escalation,
-- BUT PostgreSQL OR's permissive policies together. The weaker
-- "members_update" policy was winning, bypassing the protection.
--
-- Fix: drop the weaker policy. "Members can update own profile"
-- already covers the same rows with correct column restrictions.
-- ============================================================

DROP POLICY IF EXISTS "members_update" ON public.members;

-- Verify the protective policy still exists after the drop:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'members'
      AND policyname = 'Members can update own profile'
  ) THEN
    RAISE EXCEPTION 'SAFETY CHECK FAILED: "Members can update own profile" policy not found. '
      'Run security-patch-01.sql before this migration.';
  END IF;
END $$;

SELECT 'Migration 007 applied — role escalation ghost policy removed' AS status;
