-- ============================================================
--  PNWAV8R Flying Club — Supabase Schema
--  Run this entire file in Supabase → SQL Editor → New query
-- ============================================================

-- Members (linked to Supabase auth users)
create table members (
  id                uuid references auth.users(id) on delete cascade primary key,
  name              text not null,
  email             text not null unique,
  phone             text,
  membership_active boolean default true,
  pic_status        boolean default false,
  role              text default 'member' check (role in ('admin','member')),
  created_at        timestamptz default now()
);

-- Airplanes
create table airplanes (
  id           uuid primary key default gen_random_uuid(),
  tail_number  text not null unique,
  make_model   text not null,
  status       text default 'available' check (status in ('available','flying','maintenance','squawk')),
  current_tach decimal(8,1),
  notes        text,
  updated_at   timestamptz default now()
);

-- Insert N7798E
insert into airplanes (tail_number, make_model, current_tach)
values ('N7798E', '1959 Cessna 150', 0.0);

-- Reservations
create table reservations (
  id          uuid primary key default gen_random_uuid(),
  airplane_id uuid references airplanes(id) on delete cascade,
  member_id   uuid references members(id) on delete cascade,
  start_time  timestamptz not null,
  end_time    timestamptz not null,
  status      text default 'scheduled' check (status in ('scheduled','flying','completed','cancelled')),
  created_at  timestamptz default now(),
  constraint min_two_hours check (end_time >= start_time + interval '2 hours')
);

-- Flight logs
create table flight_logs (
  id               uuid primary key default gen_random_uuid(),
  reservation_id   uuid references reservations(id) on delete set null,
  airplane_id      uuid references airplanes(id) on delete cascade,
  member_id        uuid references members(id) on delete cascade,
  tach_start       decimal(8,1),
  tach_end         decimal(8,1),
  fuel_added       decimal(5,1) default 0,
  oil_quarts_added decimal(3,1) default 0,
  notes            text,
  completed_at     timestamptz default now()
);

-- Squawks
create table squawks (
  id          uuid primary key default gen_random_uuid(),
  airplane_id uuid references airplanes(id) on delete cascade,
  reported_by uuid references members(id) on delete set null,
  description text not null,
  status      text default 'open' check (status in ('open','resolved')),
  reported_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references members(id) on delete set null
);

-- ============================================================
--  Row Level Security
-- ============================================================

alter table members     enable row level security;
alter table airplanes   enable row level security;
alter table reservations enable row level security;
alter table flight_logs  enable row level security;
alter table squawks      enable row level security;

-- Airplanes: all authenticated users can read
create policy "members read airplanes"
  on airplanes for select
  using (auth.role() = 'authenticated');

-- Airplanes: only admins can modify
create policy "admins modify airplanes"
  on airplanes for all
  using (exists (select 1 from members where id = auth.uid() and role = 'admin'));

-- Members: authenticated users can read all (needed for calendar names)
create policy "members read all members"
  on members for select
  using (auth.role() = 'authenticated');

-- Members: users can update their own row
create policy "members update own"
  on members for update
  using (auth.uid() = id);

-- Members: admins can do everything
create policy "admins manage members"
  on members for all
  using (exists (select 1 from members where id = auth.uid() and role = 'admin'));

-- Reservations: all authenticated users can read
create policy "members read reservations"
  on reservations for select
  using (auth.role() = 'authenticated');

-- Reservations: members can insert their own
create policy "members insert own reservation"
  on reservations for insert
  with check (auth.uid() = member_id);

-- Reservations: members can update (cancel) their own
create policy "members update own reservation"
  on reservations for update
  using (auth.uid() = member_id);

-- Reservations: admins can do everything
create policy "admins manage reservations"
  on reservations for all
  using (exists (select 1 from members where id = auth.uid() and role = 'admin'));

-- Flight logs: all members can read
create policy "members read flight logs"
  on flight_logs for select
  using (auth.role() = 'authenticated');

-- Flight logs: members can insert their own
create policy "members insert own log"
  on flight_logs for insert
  with check (auth.uid() = member_id);

-- Flight logs: admins full access
create policy "admins manage flight logs"
  on flight_logs for all
  using (exists (select 1 from members where id = auth.uid() and role = 'admin'));

-- Squawks: all members can read
create policy "members read squawks"
  on squawks for select
  using (auth.role() = 'authenticated');

-- Squawks: members can report (insert)
create policy "members insert squawks"
  on squawks for insert
  with check (auth.uid() = reported_by);

-- Squawks: admins can resolve/update
create policy "admins manage squawks"
  on squawks for all
  using (exists (select 1 from members where id = auth.uid() and role = 'admin'));

-- ============================================================
--  Real-time: enable publications for live calendar updates
-- ============================================================

alter publication supabase_realtime add table reservations;
alter publication supabase_realtime add table airplanes;
alter publication supabase_realtime add table squawks;

-- ============================================================
--  Auto-create member record when a user signs up via magic link
-- ============================================================

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into members (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1))
  )
  on conflict (email) do update set id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
