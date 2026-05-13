-- ============================================================
-- Migration 016 — Fix flight_logs RLS for super_admin
-- Safe to re-run
-- ============================================================
-- The original policy "fl_select" used get_role() = 'admin'
-- which returns false for super_admin (role = 'super_admin').
-- Previous migrations dropped policies by wrong names so
-- "fl_select" survived and restricted admin view to own flights only.

-- Drop ALL existing flight_log SELECT policies by every known name
DROP POLICY IF EXISTS "fl_select"                                ON public.flight_logs;
DROP POLICY IF EXISTS "Members can view own flight logs"         ON public.flight_logs;
DROP POLICY IF EXISTS "All members can view non-deleted flight logs" ON public.flight_logs;

-- Single clean SELECT policy:
-- Admins (admin + super_admin) see all non-deleted logs.
-- Regular members see only their own non-deleted logs.
CREATE POLICY "flight_logs_select"
    ON public.flight_logs FOR SELECT
    USING (
        (is_deleted IS NULL OR is_deleted = false)
        AND (
            member_id = auth.uid()
            OR public.get_my_role() IN ('admin', 'super_admin')
        )
    );

-- Also fix UPDATE policy so super_admin can soft-delete
DROP POLICY IF EXISTS "fl_update"                    ON public.flight_logs;
DROP POLICY IF EXISTS "Admin can soft-delete flight logs" ON public.flight_logs;

CREATE POLICY "flight_logs_update"
    ON public.flight_logs FOR UPDATE
    USING (
        member_id = auth.uid()
        OR public.get_my_role() IN ('admin', 'super_admin')
    );

SELECT 'Migration 016 complete — flight_log RLS fixed for super_admin' AS status;
