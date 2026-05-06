-- ============================================================
-- PNWAV8R — Fuel/Oil/Admin Update
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Soft delete for flight logs
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS is_deleted       boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_by       uuid REFERENCES public.members(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deleted_at       timestamptz;

-- 2. New fuel fields (replacing old fuel_added / fuel_level)
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS needs_fuel               boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS fuel_added_gallons        float,
    ADD COLUMN IF NOT EXISTS fuel_estimate_left_tank   float,
    ADD COLUMN IF NOT EXISTS fuel_estimate_right_tank  float,
    ADD COLUMN IF NOT EXISTS fuel_comment              text;

-- 3. New oil fields (replacing old oil_quarts_added / oil_status)
ALTER TABLE public.flight_logs
    ADD COLUMN IF NOT EXISTS oil_qty_start_quarts  float,
    ADD COLUMN IF NOT EXISTS oil_added_quarts       float DEFAULT 0,
    ADD COLUMN IF NOT EXISTS oil_qty_end_quarts     float;

-- 4. Fix reservation RLS — Admin must be able to edit ANY reservation
--    (the previous policy may only allow own-future edits for admin)
DROP POLICY IF EXISTS "Role-based reservation update" ON public.reservations;
DROP POLICY IF EXISTS "Role-based reservation delete" ON public.reservations;

CREATE POLICY "Role-based reservation update"
    ON public.reservations FOR UPDATE
    USING (
        EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'admin')
        OR EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'ap')
        OR (member_id = auth.uid() AND start_time > now())
    );

CREATE POLICY "Role-based reservation delete"
    ON public.reservations FOR DELETE
    USING (
        EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'admin')
        OR EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'ap')
        OR (member_id = auth.uid() AND start_time > now())
    );

-- 5. Flight log RLS — only admin can soft-delete (update is_deleted)
DROP POLICY IF EXISTS "Members can insert flight logs" ON public.flight_logs;
DROP POLICY IF EXISTS "Members can view own flight logs" ON public.flight_logs;

CREATE POLICY "All members can view non-deleted flight logs"
    ON public.flight_logs FOR SELECT
    USING (auth.uid() IS NOT NULL AND (is_deleted IS NULL OR is_deleted = false));

CREATE POLICY "Members can insert flight logs"
    ON public.flight_logs FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can soft-delete flight logs"
    ON public.flight_logs FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.members WHERE id = auth.uid() AND role = 'admin'));

SELECT 'Fuel/Oil/Admin update complete' AS status;
