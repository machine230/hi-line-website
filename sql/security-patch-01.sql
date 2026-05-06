-- ============================================================
-- PNWAV8R — Security Patch 01
-- CRITICAL: Prevents members from escalating their own role
-- Run in Supabase SQL Editor immediately
-- ============================================================

-- Fix members UPDATE policy to block column-level privilege escalation.
-- Without this, a member can call:
--   supabase.from('members').update({ role: 'admin' }).eq('id', their_uuid)
-- and elevate themselves to admin.

DROP POLICY IF EXISTS "Members can update own profile" ON public.members;

CREATE POLICY "Members can update own profile"
    ON public.members FOR UPDATE
    USING (
        -- Admin can update any row
        EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'admin')
        -- Members can only update their own row
        OR id = auth.uid()
    )
    WITH CHECK (
        -- Admin can write any values
        EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'admin')
        -- Non-admins: own row only AND protected columns must remain unchanged
        OR (
            id = auth.uid()
            AND role             = (SELECT role             FROM public.members WHERE id = auth.uid())
            AND membership_active = (SELECT membership_active FROM public.members WHERE id = auth.uid())
            AND pic_status       = (SELECT pic_status       FROM public.members WHERE id = auth.uid())
        )
    );

SELECT 'Security patch 01 applied — role escalation blocked' AS status;
