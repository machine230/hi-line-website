-- ============================================================
-- Migration 015 — Add super_admin role
-- Safe to re-run
-- Run in Supabase SQL Editor
-- ============================================================

-- Expand the role CHECK constraint to include super_admin.
-- super_admin = all admin permissions + flight log delete.
-- Regular admin cannot delete flight records (audit/fraud protection).

ALTER TABLE public.members
    DROP CONSTRAINT IF EXISTS members_role_check,
    DROP CONSTRAINT IF EXISTS members_check;

ALTER TABLE public.members
    ADD CONSTRAINT members_role_check
    CHECK (role IN ('member', 'ap', 'admin', 'super_admin'));

-- Update admin_read_all_members policy to include super_admin
DROP POLICY IF EXISTS "admin_read_all_members" ON public.members;
CREATE POLICY "admin_read_all_members" ON public.members
    FOR SELECT
    USING (public.get_my_role() IN ('admin', 'super_admin'));

-- Update get_my_role to still return the actual role value (no change needed)
-- super_admin is returned as-is and checked in JS with isSuperAdmin()

-- To promote yourself to super_admin, run:
-- UPDATE public.members SET role = 'super_admin' WHERE email = 'your@email.com';

SELECT 'Migration 015 complete — super_admin role added' AS status;
