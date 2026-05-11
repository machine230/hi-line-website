-- ============================================================
-- Migration 011: Add missing audit columns to squawks table
--
-- squawks.html saveUpdate() writes status_updated_at,
-- admin_response_at, and admin_response_by but these columns
-- were never defined in schema.sql, causing PostgREST to return
-- a 400 "column not found" error on every status update.
--
-- This migration adds the three missing columns so the full
-- squawk lifecycle (open → in_progress → resolved) saves correctly.
-- ============================================================

ALTER TABLE public.squawks
    ADD COLUMN IF NOT EXISTS status_updated_at  timestamptz,
    ADD COLUMN IF NOT EXISTS admin_response_at  timestamptz,
    ADD COLUMN IF NOT EXISTS admin_response_by  uuid REFERENCES public.members(id) ON DELETE SET NULL;

-- Back-fill status_updated_at for existing resolved squawks
-- (use resolved_at as a reasonable proxy)
UPDATE public.squawks
    SET status_updated_at = resolved_at
    WHERE resolved_at IS NOT NULL AND status_updated_at IS NULL;

SELECT 'Migration 011 applied — squawk audit columns added' AS status;
