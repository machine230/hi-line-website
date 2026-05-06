-- ═══════════════════════════════════════════════════════════════
--  PNWAV8R — Full Database Schema (source of truth)
--  Last reconciled: 2026-04-21 — matches live Supabase tables
--  NOTE: This is documentation only; the live DB already has
--  these tables. Run migrations in db/migrations/ for changes.
-- ═══════════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ═══════════════════════════════════════════════════════════════
--  TABLES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS members (
  id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              text NOT NULL,
  name               text,
  phone              text,
  role               text NOT NULL DEFAULT 'member'
                       CHECK (role IN ('admin', 'ap', 'member')),
  membership_active  boolean NOT NULL DEFAULT false,
  profile_completed  boolean NOT NULL DEFAULT false,
  pic_status         boolean NOT NULL DEFAULT false,
  -- Added in migration 002:
  bfr_date           date,
  medical_class      smallint CHECK (medical_class IN (1,2,3)),
  medical_date       date,
  joined_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS airplanes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tail_number     text NOT NULL UNIQUE,
  type            text NOT NULL,
  year            int,
  status          text NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'flying', 'grounded', 'maintenance', 'squawk')),
  current_tach    numeric(8,1) DEFAULT 0,
  smoh_base       numeric(8,1),
  grounded_from   timestamptz,
  grounded_until  timestamptz,
  notes           text,
  updated_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  airplane_id  uuid NOT NULL REFERENCES airplanes(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members(id)   ON DELETE CASCADE,
  start_time   timestamptz NOT NULL,
  end_time     timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed', 'cancelled')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT end_after_start CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS squawks (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  airplane_id          uuid NOT NULL REFERENCES airplanes(id) ON DELETE CASCADE,
  reported_by          uuid NOT NULL REFERENCES members(id),
  description          text NOT NULL,
  status               text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'in_progress', 'resolved', 'deferred', 'grounded')),
  go_no_go             text CHECK (go_no_go IN ('go', 'caution', 'no_go')),
  admin_response       text,
  maintenance_notes    text,
  resolved_by          uuid REFERENCES members(id),
  status_updated_by    uuid REFERENCES members(id),
  resolved_at          timestamptz,
  reported_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flight_logs (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  airplane_id           uuid NOT NULL REFERENCES airplanes(id) ON DELETE CASCADE,
  member_id             uuid NOT NULL REFERENCES members(id)   ON DELETE CASCADE,
  reservation_id        uuid REFERENCES reservations(id),
  tach_start            numeric(8,1),
  tach_end              numeric(8,1),
  flight_hours          numeric(5,1),
  flight_cost           numeric(8,2),
  fuel_added_gallons    numeric(5,1),
  needs_fuel            boolean DEFAULT false,
  oil_qty_start_quarts  numeric(4,1),
  oil_added_quarts      numeric(4,1),
  oil_qty_end_quarts    numeric(4,1),
  notes                 text,
  -- Added in migration 002:
  landings              smallint NOT NULL DEFAULT 0,
  night_landings        smallint NOT NULL DEFAULT 0,
  completed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inspections (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  airplane_id    uuid NOT NULL REFERENCES airplanes(id) ON DELETE CASCADE,
  name           text NOT NULL,
  interval_days  int  NOT NULL,
  last_completed date,
  notes          text
);

CREATE TABLE IF NOT EXISTS maintenance_blocks (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  airplane_id  uuid REFERENCES airplanes(id) ON DELETE CASCADE,
  start_time   timestamptz,
  end_time     timestamptz,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Added in migration 002:
CREATE TABLE IF NOT EXISTS member_documents (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  doc_type     text NOT NULL CHECK (doc_type IN ('medical','rating','endorsement','other')),
  label        text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by  uuid REFERENCES members(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Added in migration 002:
CREATE TABLE IF NOT EXISTS waitlist (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  airplane_id uuid NOT NULL REFERENCES airplanes(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id)   ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (airplane_id, member_id)
);

-- ═══════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE airplanes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE squawks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections          ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist             ENABLE ROW LEVEL SECURITY;

-- ── Helper functions ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_active_member()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM members WHERE id = auth.uid() AND membership_active = true
  );
$$;

CREATE OR REPLACE FUNCTION get_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM members WHERE id = auth.uid();
$$;

-- ── Policies ─────────────────────────────────────────────────

-- members
CREATE POLICY "members_select"  ON members FOR SELECT USING (is_active_member());
CREATE POLICY "members_update"  ON members FOR UPDATE USING (id = auth.uid());
CREATE POLICY "members_admin"   ON members FOR ALL    USING (get_role() = 'admin');

-- airplanes
CREATE POLICY "airplanes_select" ON airplanes FOR SELECT USING (is_active_member());
CREATE POLICY "airplanes_update" ON airplanes FOR UPDATE USING (get_role() IN ('admin','ap'));
CREATE POLICY "airplanes_admin"  ON airplanes FOR ALL   USING (get_role() = 'admin');

-- reservations
CREATE POLICY "res_select"  ON reservations FOR SELECT USING (is_active_member());
CREATE POLICY "res_insert"  ON reservations FOR INSERT WITH CHECK (member_id = auth.uid() AND is_active_member());
CREATE POLICY "res_update"  ON reservations FOR UPDATE USING (member_id = auth.uid() OR get_role() = 'admin');

-- squawks
CREATE POLICY "sq_select"  ON squawks FOR SELECT USING (is_active_member());
CREATE POLICY "sq_insert"  ON squawks FOR INSERT WITH CHECK (reported_by = auth.uid() AND is_active_member());
CREATE POLICY "sq_update"  ON squawks FOR UPDATE USING (get_role() IN ('admin','ap'));

-- flight_logs
CREATE POLICY "fl_select"  ON flight_logs FOR SELECT USING (member_id = auth.uid() OR get_role() = 'admin');
CREATE POLICY "fl_insert"  ON flight_logs FOR INSERT WITH CHECK (member_id = auth.uid() AND is_active_member());
CREATE POLICY "fl_update"  ON flight_logs FOR UPDATE USING (member_id = auth.uid() OR get_role() = 'admin');

-- inspections
CREATE POLICY "insp_select" ON inspections FOR SELECT USING (is_active_member());
CREATE POLICY "insp_all"    ON inspections FOR ALL   USING (get_role() IN ('admin','ap'));

-- maintenance_blocks
CREATE POLICY "mb_select"   ON maintenance_blocks FOR SELECT USING (is_active_member());
CREATE POLICY "mb_admin"    ON maintenance_blocks FOR ALL   USING (get_role() IN ('admin','ap'));

-- member_documents
CREATE POLICY "mdoc_member_select" ON member_documents FOR SELECT USING (member_id = auth.uid());
CREATE POLICY "mdoc_admin_select"  ON member_documents FOR SELECT USING (get_role() IN ('admin','ap'));
CREATE POLICY "mdoc_admin_all"     ON member_documents FOR ALL   USING (get_role() IN ('admin','ap'));

-- waitlist
CREATE POLICY "wl_member_all"  ON waitlist FOR ALL    USING (member_id = auth.uid());
CREATE POLICY "wl_admin_read"  ON waitlist FOR SELECT USING (get_role() IN ('admin','ap'));

-- ═══════════════════════════════════════════════════════════════
--  SEED — N7798E + standard inspections
-- ═══════════════════════════════════════════════════════════════
INSERT INTO airplanes (tail_number, type, year, status, current_tach)
VALUES ('N7798E', 'Cessna 150', 1959, 'available', 0)
ON CONFLICT (tail_number) DO NOTHING;

INSERT INTO inspections (airplane_id, name, interval_days)
SELECT id, name, days FROM airplanes
CROSS JOIN (VALUES
  ('Annual',        365),
  ('100-Hour',      100),
  ('ELT Battery',   730),
  ('Transponder',   730),
  ('Pitot/Static',  730)
) AS t(name, days)
WHERE tail_number = 'N7798E'
ON CONFLICT DO NOTHING;
