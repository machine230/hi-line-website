-- ============================================================
-- Migration 003: BasicMed support + member self-edit RLS
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Allow BasicMed (class = 4) in medical_class column
--    Drop the existing check constraint and add a new one that includes 4.
ALTER TABLE members
  DROP CONSTRAINT IF EXISTS members_medical_class_check;

ALTER TABLE members
  ADD CONSTRAINT members_medical_class_check
  CHECK (medical_class IN (1, 2, 3, 4));

-- 2. Allow members to INSERT their own documents into member_documents
--    (Admin policy for ALL already covers insert; this adds member self-insert)
DROP POLICY IF EXISTS "members_insert_own_docs" ON member_documents;
CREATE POLICY "members_insert_own_docs" ON member_documents
  FOR INSERT WITH CHECK (member_id = auth.uid());

-- 3. Allow members to DELETE their own documents
DROP POLICY IF EXISTS "members_delete_own_docs" ON member_documents;
CREATE POLICY "members_delete_own_docs" ON member_documents
  FOR DELETE USING (member_id = auth.uid());

-- 4. Supabase Storage — allow members to upload files to their own folder
--    Bucket: member-docs  |  Folder: <member_uuid>/...
DROP POLICY IF EXISTS "members_upload_own_docs" ON storage.objects;
CREATE POLICY "members_upload_own_docs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'member-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "members_delete_own_storage_docs" ON storage.objects;
CREATE POLICY "members_delete_own_storage_docs" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'member-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
