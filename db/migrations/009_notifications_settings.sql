-- ============================================================
-- Migration 009: Notification preferences, club settings,
--                alert dedup log
-- Safe to re-run: uses IF NOT EXISTS / CREATE TABLE IF NOT EXISTS
-- ============================================================

-- ── 1. Member notification preferences ───────────────────────
-- One row per member. Created on first profile/prefs save (upsert).
-- All opt-in alerts default false. Reminder defaults true (opt-out).
CREATE TABLE IF NOT EXISTS notification_preferences (
    member_id             uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    cancellation_blast    boolean NOT NULL DEFAULT false,  -- opt-in: slot opened alert
    early_arrival_alert   boolean NOT NULL DEFAULT false,  -- opt-in: prev pilot back early
    late_return_alert     boolean NOT NULL DEFAULT false,  -- opt-in: prev pilot running late
    schedule_impact_alert boolean NOT NULL DEFAULT false,  -- opt-in: parent toggle for above two
    reservation_reminder  boolean NOT NULL DEFAULT true,   -- opt-out: next-day reminder
    updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_own_prefs"  ON notification_preferences;
DROP POLICY IF EXISTS "admin_read_prefs"  ON notification_preferences;

CREATE POLICY "member_own_prefs" ON notification_preferences
    FOR ALL USING (member_id = auth.uid());

CREATE POLICY "admin_read_prefs" ON notification_preferences
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND role = 'admin')
    );

-- ── 2. Club-level settings (per airplane) ────────────────────
-- Admin-controlled toggles. One row per airplane, auto-seeded.
CREATE TABLE IF NOT EXISTS club_settings (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    airplane_id                 uuid UNIQUE REFERENCES airplanes(id) ON DELETE CASCADE,
    admin_cancellation_notify   boolean NOT NULL DEFAULT false,
    blast_window_hours          integer NOT NULL DEFAULT 48,
    late_return_threshold_min   integer NOT NULL DEFAULT 30,
    updated_at                  timestamptz DEFAULT now(),
    updated_by                  uuid REFERENCES members(id) ON DELETE SET NULL
);

ALTER TABLE club_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_read_all"   ON club_settings;
DROP POLICY IF EXISTS "settings_admin_edit" ON club_settings;

CREATE POLICY "settings_read_all" ON club_settings
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND membership_active = true)
    );

CREATE POLICY "settings_admin_edit" ON club_settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND role = 'admin')
    );

-- Seed club_settings row for N2134Y if it doesn't exist
INSERT INTO club_settings (airplane_id)
SELECT id FROM airplanes WHERE tail_number = 'N2134Y'
ON CONFLICT (airplane_id) DO NOTHING;

-- ── 3. Alert dedup log ────────────────────────────────────────
-- Prevents the same alert firing twice for the same event + recipient.
-- Cleaned up by monthly cron (rows > 30 days old).
CREATE TABLE IF NOT EXISTS sent_alerts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type     text NOT NULL,  -- 'late_return' | 'early_arrival' | 'cancellation_blast'
    reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
    recipient_id   uuid REFERENCES members(id) ON DELETE CASCADE,
    sent_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (alert_type, reservation_id, recipient_id)
);

ALTER TABLE sent_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sent_alerts_admin" ON sent_alerts;

CREATE POLICY "sent_alerts_admin" ON sent_alerts
    FOR ALL USING (
        EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND role = 'admin')
    );

-- ── 4. Indexes for notification queries ──────────────────────
CREATE INDEX IF NOT EXISTS idx_notif_blast
    ON notification_preferences(cancellation_blast)
    WHERE cancellation_blast = true;

CREATE INDEX IF NOT EXISTS idx_notif_impact
    ON notification_preferences(schedule_impact_alert)
    WHERE schedule_impact_alert = true;

CREATE INDEX IF NOT EXISTS idx_sent_alerts_lookup
    ON sent_alerts(alert_type, reservation_id, recipient_id);

CREATE INDEX IF NOT EXISTS idx_reservations_status_time
    ON reservations(status, start_time, end_time);

-- ── 5. Destination field on reservations ─────────────────────
ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS destination text;

SELECT 'Migration 009 complete — notification preferences, club settings, alert dedup ready' AS status;
