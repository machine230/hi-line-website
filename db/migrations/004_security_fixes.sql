-- ============================================================
-- Migration 004: Security fixes
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Allow admins/APs to delete waitlist entries
--    (e.g. when removing a member from the club)
DROP POLICY IF EXISTS "wl_admin_delete" ON waitlist;
CREATE POLICY "wl_admin_delete" ON waitlist
  FOR DELETE USING (get_role() IN ('admin', 'ap'));

-- 2. Fix admin member row if missing (founding admin not invited via app)
--    Replace 'your-email@here.com' with your actual email before running.
-- INSERT INTO members (id, email, name, role, membership_active, profile_completed, pic_status)
-- SELECT id, email, email, 'admin', true, true, false
-- FROM auth.users
-- WHERE email = 'your-email@here.com'
-- ON CONFLICT (id) DO UPDATE
--   SET role = 'admin', membership_active = true;

-- 3. Ensure all existing members have membership_active = true
UPDATE members SET membership_active = true
WHERE membership_active IS NULL OR membership_active = false;
