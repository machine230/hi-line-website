-- ============================================================
-- Migration 006: Beta feedback table
-- Tracks in-app feedback from beta testers.
-- NOTE: This table was created manually in Supabase before this
-- migration file was added. If setting up a fresh instance,
-- run this SQL to create the table with correct RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS beta_feedback (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    member_id   uuid REFERENCES members(id) ON DELETE SET NULL,
    member_name text,
    page        text NOT NULL,
    category    text NOT NULL CHECK (category IN ('bug','confusing','idea','positive')),
    message     text NOT NULL,
    rating      integer CHECK (rating BETWEEN 1 AND 5),
    created_at  timestamptz DEFAULT now()
);

ALTER TABLE beta_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_insert_feedback" ON beta_feedback;
CREATE POLICY "members_insert_feedback" ON beta_feedback
    FOR INSERT TO authenticated
    WITH CHECK (member_id = auth.uid());

DROP POLICY IF EXISTS "admins_read_feedback" ON beta_feedback;
CREATE POLICY "admins_read_feedback" ON beta_feedback
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND role = 'admin')
    );
