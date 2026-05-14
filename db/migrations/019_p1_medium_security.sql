-- ============================================================
-- Migration 019 — P1 Medium security fixes
-- Safe to re-run
-- ============================================================

-- ── FIX 1: Role self-escalation prevention ────────────────
-- Drop all existing members UPDATE policies (various names across migrations)
DROP POLICY IF EXISTS "members_update"                ON public.members;
DROP POLICY IF EXISTS "Members can update own profile" ON public.members;
DROP POLICY IF EXISTS "members_self_update"            ON public.members;

-- Recreate with WITH CHECK that locks role, membership_active, and pic_status.
-- A member can update their own name, phone, bfr_date, medical_date, etc.
-- but cannot change their role, membership status, or pic approval via the API.
CREATE POLICY "members_self_update" ON public.members
    FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (
        id = auth.uid()
        -- Role must remain unchanged (get_my_role() is SECURITY DEFINER — no recursion)
        AND role              = public.get_my_role()
        -- membership_active and pic_status must remain unchanged
        AND membership_active = (SELECT membership_active FROM public.members WHERE id = auth.uid())
        AND pic_status        IS NOT DISTINCT FROM (SELECT pic_status FROM public.members WHERE id = auth.uid())
    );

-- ── FIX 2: Double-booking race condition ──────────────────
-- Enable btree_gist (required for timestamp range EXCLUDE constraints).
-- Safe to run even if already enabled.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Drop constraint if it exists (idempotent)
ALTER TABLE public.reservations
    DROP CONSTRAINT IF EXISTS no_overlapping_reservations;

-- Add EXCLUDE constraint: two confirmed reservations for the same airplane
-- cannot have overlapping time ranges. The '[)' half-open range means a
-- booking ending at 14:00 does NOT conflict with one starting at 14:00.
ALTER TABLE public.reservations
    ADD CONSTRAINT no_overlapping_reservations
    EXCLUDE USING gist (
        airplane_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (status = 'confirmed');

SELECT 'Migration 019 complete — role escalation + double-booking race fixed' AS status;
