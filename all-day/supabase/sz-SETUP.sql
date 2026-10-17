-- ============================================================================
-- ALL DAY — the Habits tab (the accountability club), one-time Supabase setup.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   sz_  (the season club; every table and function here wears it)
-- Written:  2026-10-17, phase one (the habit tracker)
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: every
-- statement is "if not exists" or "create or replace", and nothing here
-- deletes a row you made. all-day/supabase/SETUP-HABITS.md has the steps.
--
-- Needs, already in this project: Supabase Auth (auth.users, auth.uid()).
-- Nothing here reads or changes another app's tables.
--
-- What it holds, in plain words (the data model in Stephen's build notes,
-- every table, with the sz_ prefix):
--   sz_members     one row per signed-in member: first name, phone, city,
--                  their pod, and whether they turned the daily email off.
--                  Keyed by the account id; the email stays in Supabase Auth.
--   sz_seasons     one row per season: dates, links, status. One live
--                  season per city.
--   sz_pods        a season's small groups. Stephen puts a member in a pod
--                  by setting sz_members.pod_id.
--   sz_goals       one goal per member per season, locked at kickoff.
--   sz_milestones  up to three per goal.
--   sz_habits      a member's habits: one goal habit per goal, and as many
--                  of their own as they keep. Personal habits are private
--                  unless shared, and shared ones are seen by the pod only.
--   sz_taps        one row per habit per day it was done. Deleting a tap
--                  un-does it. Dates are Burlington dates.
--   sz_reviews     the Sunday review, one per goal per week (1 to 8).
--   sz_events      a season's kickoff, midway and party.
--   sz_attendance  who came to which event, marked by Stephen.
--   sz_wall_cards  a finisher's public card, public once published.
-- Streaks and the show-up rate are worked out from these, never stored.
--
-- Security model, the fleet's: RLS is on for every table with NO policies,
-- and the tables are revoked from anon and authenticated, so the public key
-- reaches data only through the security-definer functions below. Every
-- rule the app checks before sending (js/habits-core.js) is checked again
-- here. The privacy rules live in the function bodies: a member reads and
-- writes only their own rows; a podmate sees only shared and goal habits;
-- nobody else sees a habit at all.
--
-- Phase one uses the habit doors (sz_me_*, sz_habit*, sz_tap, sz_untap,
-- sz_taps_get, sz_season_next, sz_rules) and adds the podmate door
-- (sz_pod_habits) so the pod rule is enforced from day one. Goals,
-- reviews, the city board, the email and the wall get their doors in later
-- phases, as more of this same file.
-- ============================================================================

-- ---------------------------------------------------------------- the rules
-- The same JSON as HABIT_RULES in all-day/js/habits-core.js, and as the
-- copy in sz-ROUND2.sql (the newest rules paste; a live project gets rule
-- changes from that file). scripts/test-habits-core.mjs fails when they
-- differ.
create or replace function public.sz_rules() returns jsonb
language sql immutable as $rules$ select $json${"version":1,"tz":"America/New_York","frequencies":["daily","weekdays","n_per_week"],"categories":["fitness","creative","business","life_admin","learn"],"seasonStatuses":["upcoming","open","live","done"],"limits":{"habitsMax":100,"habitTextMax":60,"nameMax":32,"phoneMin":7,"phoneMax":20,"nMin":1,"nMax":6,"tapsRangeMaxDays":370}}$json$::jsonb $rules$;

-- ------------------------------------------------------------------ tables

create table if not exists public.sz_seasons (
  id            uuid primary key default gen_random_uuid(),
  city          text not null default 'burlington',
  name          text not null,
  signup_opens  timestamptz,
  kickoff_at    timestamptz not null,
  midway_at     timestamptz,
  party_at      timestamptz,
  stripe_link   text,
  luma_kickoff  text,
  luma_midway   text,
  luma_party    text,
  status        text not null default 'upcoming' check (status in ('upcoming', 'open', 'live', 'done')),
  created_at    timestamptz not null default now()
);
-- one live season per city
create unique index if not exists sz_seasons_live_idx on public.sz_seasons (city) where status = 'live';

create table if not exists public.sz_pods (
  id              uuid primary key default gen_random_uuid(),
  season_id       uuid not null references public.sz_seasons(id) on delete cascade,
  category        text,
  captain_user_id uuid references auth.users(id) on delete set null,
  chat_url        text,
  meets_on        text,
  created_at      timestamptz not null default now()
);
create index if not exists sz_pods_season_idx on public.sz_pods (season_id);

create table if not exists public.sz_members (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 32 and position('@' in name) = 0),
  phone         text not null check (char_length(phone) between 7 and 20),
  city          text not null default 'burlington',
  pod_id        uuid references public.sz_pods(id) on delete set null,
  email_opt_out boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sz_members_pod_idx on public.sz_members (pod_id);

create table if not exists public.sz_goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  season_id   uuid not null references public.sz_seasons(id) on delete cascade,
  text        text not null default '',
  finish_line text not null default '',
  proof       text not null default '',
  category    text check (category in ('fitness', 'creative', 'business', 'life_admin', 'learn')),
  paid        boolean not null default false,
  locked_at   timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, season_id)
);

create table if not exists public.sz_milestones (
  id       uuid primary key default gen_random_uuid(),
  goal_id  uuid not null references public.sz_goals(id) on delete cascade,
  text     text not null default '',
  position int not null check (position between 1 and 3),
  hit_at   timestamptz,
  unique (goal_id, position)
);

create table if not exists public.sz_habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  goal_id     uuid references public.sz_goals(id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 60),
  frequency   text not null check (frequency in ('daily', 'weekdays', 'n_per_week')),
  n           int,
  is_goal     boolean not null default false,
  shared      boolean not null default false,
  position    int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  -- N is for N-times-a-week habits only, 1 to 6 (seven a week is daily)
  constraint sz_habits_n_check check ((frequency = 'n_per_week' and n between 1 and 6) or (frequency <> 'n_per_week' and n is null)),
  -- a goal habit belongs to a goal
  constraint sz_habits_goal_check check (not is_goal or goal_id is not null)
);
-- exactly one goal habit per goal: at most one here, and the goal's own
-- door (phase two) makes the one
create unique index if not exists sz_habits_goal_idx on public.sz_habits (goal_id) where is_goal;
create index if not exists sz_habits_user_idx on public.sz_habits (user_id, position);

create table if not exists public.sz_taps (
  id         uuid primary key default gen_random_uuid(),
  habit_id   uuid not null references public.sz_habits(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  source     text not null default 'app' check (source in ('app', 'email')),
  note       text,
  created_at timestamptz not null default now(),
  unique (habit_id, date)
);
create index if not exists sz_taps_user_idx on public.sz_taps (user_id, date);

create table if not exists public.sz_reviews (
  id           uuid primary key default gen_random_uuid(),
  goal_id      uuid not null references public.sz_goals(id) on delete cascade,
  week         int not null check (week between 1 and 8),
  said         text not null default '',
  did          text not null default '',
  next         text not null default '',
  photo_url    text,
  submitted_at timestamptz not null default now(),
  unique (goal_id, week)
);

create table if not exists public.sz_events (
  id        uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.sz_seasons(id) on delete cascade,
  type      text not null check (type in ('kickoff', 'midway', 'party')),
  starts_at timestamptz not null,
  venue     text,
  luma_url  text
);

create table if not exists public.sz_attendance (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  event_id  uuid not null references public.sz_events(id) on delete cascade,
  marked_at timestamptz not null default now(),
  marked_by text,
  unique (user_id, event_id)
);

create table if not exists public.sz_wall_cards (
  id           uuid primary key default gen_random_uuid(),
  goal_id      uuid not null references public.sz_goals(id) on delete cascade,
  photo_url    text,
  line1        text not null default '',
  line2        text not null default '',
  line3        text not null default '',
  published_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.sz_seasons    enable row level security;
alter table public.sz_pods       enable row level security;
alter table public.sz_members    enable row level security;
alter table public.sz_goals      enable row level security;
alter table public.sz_milestones enable row level security;
alter table public.sz_habits     enable row level security;
alter table public.sz_taps       enable row level security;
alter table public.sz_reviews    enable row level security;
alter table public.sz_events     enable row level security;
alter table public.sz_attendance enable row level security;
alter table public.sz_wall_cards enable row level security;
revoke all on table public.sz_seasons, public.sz_pods, public.sz_members, public.sz_goals, public.sz_milestones,
  public.sz_habits, public.sz_taps, public.sz_reviews, public.sz_events, public.sz_attendance, public.sz_wall_cards
  from anon, authenticated;

-- ----------------------------------------------------------- table guards
-- These hold for Stephen's dashboard edits too, not only for the app.

-- A ceiling on habits of your own (archived ones and the goal habit do not
-- count): 100, from the rules, which no one keeping habits by hand comes
-- near. It is there so a script cannot make habits by the million, and the
-- app never mentions it. One member's adds are taken one at a time, so two
-- phones adding at once cannot both slip under it.
create or replace function public.sz_habits_cap() returns trigger
language plpgsql as $$
begin
  if new.is_goal or new.archived_at is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('sz_habits:' || new.user_id::text));
  if (select count(*) from public.sz_habits
       where user_id = new.user_id and not is_goal and archived_at is null and id <> new.id)
     >= (public.sz_rules() -> 'limits' ->> 'habitsMax')::int then
    raise exception 'too_many_habits';
  end if;
  return new;
end $$;
drop trigger if exists sz_habits_cap on public.sz_habits;
create trigger sz_habits_cap before insert or update of archived_at, is_goal, user_id on public.sz_habits
  for each row execute function public.sz_habits_cap();

-- A tap always belongs to its habit's owner.
create or replace function public.sz_taps_owner() returns trigger
language plpgsql as $$
begin
  new.user_id := (select user_id from public.sz_habits where id = new.habit_id);
  return new;
end $$;
drop trigger if exists sz_taps_owner on public.sz_taps;
create trigger sz_taps_owner before insert or update of habit_id, user_id on public.sz_taps
  for each row execute function public.sz_taps_owner();

-- ----------------------------------------------------------------- helpers

-- Tidy a member's words the way habits-core.js clean() does, in the same
-- order: drop control characters, drop links, squeeze the spaces.
create or replace function public.sz_clean(s text) returns text
language plpgsql immutable as $$
declare t text;
begin
  t := regexp_replace(coalesce(s, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g');
  t := regexp_replace(t, 'https?://\S+|www\.\S+', '', 'gi');
  t := regexp_replace(t, '\s+', ' ', 'g');
  return btrim(t);
end $$;

-- Today in Burlington. A day starts at midnight New York, not UTC.
create or replace function public.sz_today() returns date
language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;

create or replace function public.sz_habit_json(h public.sz_habits) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', h.id, 'text', h.text, 'frequency', h.frequency, 'n', h.n, 'is_goal', h.is_goal,
    'shared', h.shared, 'position', h.position, 'created_at', h.created_at)
$$;

-- A stretch of dates the app may ask for: both ends, in order, a year and a
-- bit at most.
create or replace function public.sz_range_ok(p_from date, p_to date) returns void
language plpgsql immutable as $$
begin
  if p_from is null or p_to is null or p_to < p_from
     or p_to - p_from > (public.sz_rules() -> 'limits' ->> 'tapsRangeMaxDays')::int then
    raise exception 'bad_range';
  end if;
end $$;

-- ------------------------------------------------------------------ you

-- Your member row, or null before the first sign-in's two questions.
-- Signed-in only. Your phone comes back to you and to nobody else.
create or replace function public.sz_me_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return (select jsonb_build_object('name', name, 'phone', phone, 'city', city, 'email_opt_out', email_opt_out)
            from public.sz_members where user_id = u);
end $$;

-- The first sign-in asks a first name and a phone, once; this saves them,
-- and changes them later. Checks in habits-core.js checkMe()'s order.
create or replace function public.sz_me_set(p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  L jsonb := public.sz_rules() -> 'limits';
  v_name text := public.sz_clean(p_name);
  v_phone text := public.sz_clean(p_phone);
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if v_name = '' or char_length(v_name) > (L ->> 'nameMax')::int or position('@' in v_name) > 0 then raise exception 'bad_name'; end if;
  if char_length(v_phone) > (L ->> 'phoneMax')::int or v_phone !~ '^\+?[0-9 ().-]+$'
     or char_length(regexp_replace(v_phone, '\D', '', 'g')) < (L ->> 'phoneMin')::int then
    raise exception 'bad_phone';
  end if;
  insert into public.sz_members (user_id, name, phone) values (u, v_name, v_phone)
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone, updated_at = now();
  return public.sz_me_get();
end $$;

-- "Delete my account and posts" in Settings also takes this: your member
-- row, goals (with their milestones, reviews and wall card), habits, taps
-- and attendance, all gone. A pod you captained loses its captain.
create or replace function public.sz_delete_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  delete from public.sz_taps where user_id = u;
  delete from public.sz_habits where user_id = u;
  delete from public.sz_attendance where user_id = u;
  delete from public.sz_goals where user_id = u;
  update public.sz_pods set captain_user_id = null where captain_user_id = u;
  delete from public.sz_members where user_id = u;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------- habits

-- Your habits that are not archived: the goal habit first, then yours in
-- your order. Only ever your own.
create or replace function public.sz_habits_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return coalesce((select jsonb_agg(public.sz_habit_json(h) order by h.is_goal desc, h.position, h.created_at, h.id)
                     from public.sz_habits h where h.user_id = u and h.archived_at is null), '[]'::jsonb);
end $$;

-- Add a habit of your own. Signed in is enough: no name or phone is asked
-- for the tracker (that comes when you join a season). Checks in
-- habits-core.js checkHabit()'s order, then the ceiling (sz_habits_cap).
-- Shared with your pod only when you say so. It goes to the bottom.
-- sz-ROUND3.sql carries the same function, word for word.
create or replace function public.sz_habit_add(p_text text, p_frequency text, p_n int default null, p_shared boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  L jsonb := public.sz_rules() -> 'limits';
  v_text text := public.sz_clean(p_text);
  v_n int := null;
  h public.sz_habits;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if v_text = '' or char_length(v_text) > (L ->> 'habitTextMax')::int then raise exception 'bad_text'; end if;
  if p_frequency is null or not ((public.sz_rules() -> 'frequencies') ? p_frequency) then raise exception 'bad_frequency'; end if;
  if p_frequency = 'n_per_week' then
    if p_n is null or p_n < (L ->> 'nMin')::int or p_n > (L ->> 'nMax')::int then raise exception 'bad_n'; end if;
    v_n := p_n;
  end if;
  insert into public.sz_habits (user_id, text, frequency, n, shared, position)
  values (u, v_text, p_frequency, v_n, coalesce(p_shared, false),
          coalesce((select max(position) from public.sz_habits where user_id = u and not is_goal and archived_at is null), 0) + 1)
  returning * into h;
  return public.sz_habit_json(h);
end $$;

-- Change one of your habits: rename it, change how often, share or unshare
-- it, move it to a place in your list (1 is the top), or archive it (and
-- bring it back). Anything left null stays as it is. The goal habit cannot
-- be archived, and once its goal is locked its words and frequency stay.
create or replace function public.sz_habit_set(
  p_habit uuid, p_text text default null, p_frequency text default null, p_n int default null,
  p_shared boolean default null, p_position int default null, p_archived boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  L jsonb := public.sz_rules() -> 'limits';
  h public.sz_habits;
  v_text text;
  v_freq text;
  v_n int;
  v_ids uuid[];
  k int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into h from public.sz_habits where id = p_habit and user_id = u for update;
  if not found then raise exception 'not_found'; end if;

  if p_text is not null or p_frequency is not null or p_n is not null then
    v_text := case when p_text is null then h.text else public.sz_clean(p_text) end;
    v_freq := coalesce(p_frequency, h.frequency);
    v_n := case when v_freq = 'n_per_week' then coalesce(p_n, h.n) else null end;
    if v_text = '' or char_length(v_text) > (L ->> 'habitTextMax')::int then raise exception 'bad_text'; end if;
    if not ((public.sz_rules() -> 'frequencies') ? v_freq) then raise exception 'bad_frequency'; end if;
    if v_freq = 'n_per_week' and (v_n is null or v_n < (L ->> 'nMin')::int or v_n > (L ->> 'nMax')::int) then raise exception 'bad_n'; end if;
    if h.is_goal and (v_text, v_freq, v_n) is distinct from (h.text, h.frequency, h.n)
       and exists (select 1 from public.sz_goals g where g.id = h.goal_id and g.locked_at is not null) then
      raise exception 'locked';
    end if;
    update public.sz_habits set text = v_text, frequency = v_freq, n = v_n where id = h.id returning * into h;
  end if;

  if p_shared is not null then
    update public.sz_habits set shared = p_shared where id = h.id returning * into h;
  end if;

  if p_archived is true and h.archived_at is null then
    if h.is_goal then raise exception 'goal_habit'; end if;
    update public.sz_habits set archived_at = now() where id = h.id returning * into h;
  elsif p_archived is false and h.archived_at is not null then
    -- back at the bottom; the ceiling (sz_habits_cap) says no at 100
    update public.sz_habits set archived_at = null,
      position = coalesce((select max(position) from public.sz_habits where user_id = u and not is_goal and archived_at is null), 0) + 1
     where id = h.id returning * into h;
  end if;

  if p_position is not null and h.archived_at is null and not h.is_goal then
    v_ids := array(select id from public.sz_habits where user_id = u and not is_goal and archived_at is null and id <> h.id
                    order by position, created_at, id);
    k := greatest(1, least(p_position, coalesce(array_length(v_ids, 1), 0) + 1));
    v_ids := v_ids[1:k - 1] || h.id || v_ids[k:];
    update public.sz_habits s set position = o.i from unnest(v_ids) with ordinality as o(id, i) where s.id = o.id;
    select * into h from public.sz_habits where id = h.id;
  end if;

  return public.sz_habit_json(h);
end $$;

-- ------------------------------------------------------------------ taps

-- Mark one of your habits done today. Only today, in Burlington: a day
-- gone by cannot be filled in from the app (Stephen can, in the database).
-- Tapping twice is one tap.
create or replace function public.sz_tap(p_habit uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.sz_habits where id = p_habit and user_id = u and archived_at is null) then raise exception 'not_found'; end if;
  if p_date is null or p_date <> public.sz_today() then raise exception 'not_today'; end if;
  insert into public.sz_taps (habit_id, user_id, date, source) values (p_habit, u, p_date, 'app')
  on conflict (habit_id, date) do nothing;
  return jsonb_build_object('habit', p_habit, 'date', p_date, 'tapped', true);
end $$;

-- Un-mark today. Deleting the tap un-does it; a day gone by stays as it is.
create or replace function public.sz_untap(p_habit uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.sz_habits where id = p_habit and user_id = u and archived_at is null) then raise exception 'not_found'; end if;
  if p_date is null or p_date <> public.sz_today() then raise exception 'not_today'; end if;
  delete from public.sz_taps where habit_id = p_habit and date = p_date;
  return jsonb_build_object('habit', p_habit, 'date', p_date, 'tapped', false);
end $$;

-- Your taps between two dates, both included: what the streaks and the dots
-- are worked out from. Only ever your own habits' taps.
create or replace function public.sz_taps_get(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform public.sz_range_ok(p_from, p_to);
  return coalesce((select jsonb_agg(jsonb_build_object('habit', t.habit_id, 'date', t.date, 'source', t.source) order by t.date, t.habit_id)
                     from public.sz_taps t join public.sz_habits h on h.id = t.habit_id
                    where h.user_id = u and t.date between p_from and p_to), '[]'::jsonb);
end $$;

-- Your podmates' shared and goal habits, with their taps between two
-- dates. A first name and the habits, never a phone. Nobody outside your
-- pod, and no habit its owner kept private, ever comes back. No pod, no
-- podmates.
create or replace function public.sz_pod_habits(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); v_pod uuid;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform public.sz_range_ok(p_from, p_to);
  select pod_id into v_pod from public.sz_members where user_id = u;
  if v_pod is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', m.name, 'habits', coalesce((
             select jsonb_agg(public.sz_habit_json(h) || jsonb_build_object('taps', coalesce((
                      select jsonb_agg(t.date order by t.date) from public.sz_taps t
                       where t.habit_id = h.id and t.date between p_from and p_to), '[]'::jsonb))
                    order by h.is_goal desc, h.position, h.created_at, h.id)
               from public.sz_habits h
              where h.user_id = m.user_id and h.archived_at is null and (h.shared or h.is_goal)), '[]'::jsonb))
           order by m.name, m.user_id)
      from public.sz_members m
     where m.pod_id = v_pod and m.user_id <> u), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- seasons

-- The next season in a city that has not kicked off yet, for the tile that
-- says "Next season starts in N days". Null when none is scheduled. Public:
-- a season's name, dates and sign-up link are on the poster anyway.
create or replace function public.sz_season_next(p_city text default 'burlington') returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'status', s.status, 'signup_opens', s.signup_opens,
           'kickoff_at', s.kickoff_at, 'party_at', s.party_at, 'stripe_link', s.stripe_link)
    from public.sz_seasons s
   where s.city = coalesce(p_city, 'burlington') and s.status in ('upcoming', 'open') and s.kickoff_at > now()
   order by s.kickoff_at, s.id
   limit 1
$$;

-- ------------------------------------------------------------------ grants
-- Postgres lets everyone run a new function, and Supabase also grants new
-- functions to anon and authenticated by default; take that back first,
-- then hand out exactly the doors the app uses.
revoke all on function
  public.sz_rules(), public.sz_habits_cap(), public.sz_taps_owner(), public.sz_clean(text), public.sz_today(),
  public.sz_habit_json(public.sz_habits), public.sz_range_ok(date, date),
  public.sz_me_get(), public.sz_me_set(text, text), public.sz_delete_me(),
  public.sz_habits_get(), public.sz_habit_add(text, text, int, boolean),
  public.sz_habit_set(uuid, text, text, int, boolean, int, boolean),
  public.sz_tap(uuid, date), public.sz_untap(uuid, date), public.sz_taps_get(date, date), public.sz_pod_habits(date, date),
  public.sz_season_next(text)
from public, anon, authenticated;

-- Readers, signed in or not (the signed-in-only ones refuse with
-- not_signed_in themselves, so the app hears one clear answer).
grant execute on function
  public.sz_rules(), public.sz_me_get(), public.sz_me_set(text, text), public.sz_delete_me(),
  public.sz_habits_get(), public.sz_habit_add(text, text, int, boolean),
  public.sz_habit_set(uuid, text, text, int, boolean, int, boolean),
  public.sz_tap(uuid, date), public.sz_untap(uuid, date), public.sz_taps_get(date, date), public.sz_pod_habits(date, date),
  public.sz_season_next(text)
to anon, authenticated;
