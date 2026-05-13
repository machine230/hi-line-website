-- ============================================================
-- Migration 017 — Remove overly-permissive flight_log SELECT policy
-- Safe to re-run
-- ============================================================
-- Migration 014 created "All members can view non-deleted flight logs"
-- which allows ANY authenticated user to read ALL flight logs (member_id IS NOT checked).
-- Migration 016 added the correct "flight_logs_select" policy, but because Supabase
-- RLS combines permissive policies with OR, the 014 policy makes the 016 restriction moot.
-- This migration drops the permissive 014 policy so only "flight_logs_select" (016) applies.

-- Also fixes the UPDATE policy from 014 which used get_my_role() = 'admin'
-- (excludes super_admin) and allowed members to update any log.
-- The correct UPDATE policy from 016 ("flight_logs_update") already exists;
-- this migration drops the 014 version to avoid OR-combining them.

-- ── Drop permissive SELECT policy from migration 014 ──────
DROP POLICY IF EXISTS "All members can view non-deleted flight logs" ON public.flight_logs;

-- ── Drop permissive UPDATE policy from migration 014 ──────
-- (migration 016's "flight_logs_update" is the correct replacement)
DROP POLICY IF EXISTS "Admin can soft-delete flight logs" ON public.flight_logs;

-- ── Ensure correct policies from migration 016 are in place ──
-- (idempotent: DROP IF EXISTS + CREATE)
DROP POLICY IF EXISTS "flight_logs_select" ON public.flight_logs;
CREATE POLICY "flight_logs_select"
    ON public.flight_logs FOR SELECT
    USING (
        (is_deleted IS NULL OR is_deleted = false)
        AND (
            member_id = auth.uid()
            OR public.get_my_role() IN ('admin', 'super_admin')
        )
    );

DROP POLICY IF EXISTS "flight_logs_update" ON public.flight_logs;
CREATE POLICY "flight_logs_update"
    ON public.flight_logs FOR UPDATE
    USING (
        member_id = auth.uid()
        OR public.get_my_role() IN ('admin', 'super_admin')
    );

SELECT 'Migration 017 complete — flight_log permissive policy removed' AS status;
