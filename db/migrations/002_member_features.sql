-- ═══════════════════════════════════════════════════════════════
--  Migration 002 — Member Features
--  Run once in: Supabase → SQL Editor → Run
--  Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ═══════════════════════════════════════════════════════════════

-- ── 1. BFR + Medical fields on members ──────────────────────
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS bfr_date      DATE,
  ADD COLUMN IF NOT EXISTS medical_class SMALLINT CHECK (medical_class IN (1,2,3)),
  ADD COLUMN IF NOT EXISTS medical_date  DATE;

-- ── 2. Landings on flight_logs (90-day currency tracking) ───
ALTER TABLE flight_logs
  ADD COLUMN IF NOT EXISTS landings       SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS night_landings SMALLINT NOT NULL DEFAULT 0;

-- ── 3. Member documents table ───────────────────────────────
CREATE TABLE IF NOT EXISTS member_documents (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id    UUID NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
  doc_type     TEXT NOT NULL CHECK (doc_type IN ('medical','rating','endorsement','other')),
  label        TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by  UUID REFERENCES members(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE member_documents ENABLE ROW LEVEL SECURITY;

-- Members see their own docs
CREATE POLICY "mdoc_member_select" ON member_documents
  FOR SELECT USING (member_id = auth.uid());

-- Admins/APs see all docs
CREATE POLICY "mdoc_admin_select" ON member_documents
  FOR SELECT USING (get_role() IN ('admin','ap'));

-- Only admins/APs can insert/update/delete
CREATE POLICY "mdoc_admin_all" ON member_documents
  FOR ALL USING (get_role() IN ('admin','ap'));

-- ── 4. Aircraft waitlist table ──────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  airplane_id UUID NOT NULL REFERENCES airplanes(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES members(id)   ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (airplane_id, member_id)
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Members manage their own waitlist entries
CREATE POLICY "wl_member_all" ON waitlist
  FOR ALL USING (member_id = auth.uid());

-- Admins/APs can read all waitlist entries
CREATE POLICY "wl_admin_read" ON waitlist
  FOR SELECT USING (get_role() IN ('admin','ap'));

-- ── 5. Storage RLS policies (run after creating bucket) ─────
-- Run these AFTER creating the 'member-docs' bucket in Supabase Storage UI:
--
-- CREATE POLICY "storage_member_read" ON storage.objects
--   FOR SELECT USING (
--     bucket_id = 'member-docs'
--     AND auth.uid()::text = (storage.foldername(name))[1]
--   );
--
-- CREATE POLICY "storage_admin_all" ON storage.objects
--   FOR ALL USING (
--     bucket_id = 'member-docs'
--     AND get_role() IN ('admin','ap')
--   );
