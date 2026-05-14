-- ============================================================
-- Migration 018 — Add resolved status to beta_feedback
-- Safe to re-run
-- ============================================================

ALTER TABLE public.beta_feedback
    ADD COLUMN IF NOT EXISTS resolved    boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Allow admins to mark feedback resolved
DROP POLICY IF EXISTS "admins_update_feedback" ON public.beta_feedback;
CREATE POLICY "admins_update_feedback" ON public.beta_feedback
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND role IN ('admin','super_admin'))
    );

SELECT 'Migration 018 complete — beta_feedback resolved column added' AS status;
