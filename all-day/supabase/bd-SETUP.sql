-- ============================================================================
-- ALL DAY — The Build, one-time Supabase setup (one paste).
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   bd_
-- Written:  2026-10-21
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: tables are
-- "if not exists", functions "create or replace", and nothing here deletes
-- a row you made. all-day/supabase/SETUP-BUILD.md has the steps; from the
-- newsletter repo, `bash scripts/setup_boards.sh build` copies it for you.
--
-- Needs: Supabase Auth (auth.users, auth.uid()) and pgcrypto, which every
-- project has. It READS three other apps' tables when they exist and works
-- without them: btb_photos (the photo queue, for a post's photo), nn_bans
-- (a reader banned from the boards cannot post here either) and sz_taps
-- (each habit tap drops a pallet on the building). It writes to none of
-- them, except marking a reader's own Build photo 'removed' in btb_photos
-- when they delete that post or their account, as the boards do.
--
-- What it holds, in plain words:
--   bd_builder   your builder: hat colour, vest colour, a first name, and
--                whether that name shows over your builder on the site.
--   bd_things    the one thing you are working on (and the ones you
--                finished): a title, why it matters, who it's for, who's in
--                it with you, a date, and whether the why may show on the
--                starter door (why_public, off unless you turn it on).
--   bd_shifts    your hours: a shift (phone down) or a logged stretch, with
--                the Burlington day, the minutes, and your private step and
--                note. Nobody but you ever reads a row of it.
--   bd_posts     what you chose to post: Made progress, Stuck, Found
--                something, Finished. One line, maybe a photo, maybe hours.
--   bd_nice      one Nice per reader per post.
--   bd_help      "I can help" offers on Stuck posts, and the poster's Yes or
--                No thanks. Only after a Yes does the bd-intro Edge Function
--                email each of the two the other's address (it alone reads
--                emails, with the service role). Nothing here ever does.
--   bd_presence  who is on shift right now, for the site: a random id per
--                shift, the job their builder is on, and a heartbeat.
--   bd_reports   reports on posts and on offers. Two on a post hide it.
--   bd_blocks    who you blocked: you stop seeing each other's posts, and
--                neither can offer the other help.
--
-- Security, the fleet's model: RLS on, NO policies, every table revoked
-- from anon and authenticated, so the publishable key reaches data only
-- through the security-definer functions below, which check everything
-- js/build-core.js checks, again. Privacy by construction: no function
-- returns an email, an account id, a heartbeat, or a shift's times. The
-- town is counts and first names people chose to show; your record, your
-- thing and your shelf are yours alone.
--
-- Stephen's hand: hide a post by setting bd_posts.hidden_at in the Table
-- Editor (clear it, and set reports to 0, to bring it back).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- the rules
-- The same JSON as BUILD_RULES in all-day/js/build-core.js. Change both;
-- scripts/test-build-core.mjs fails when they differ (--write-sql copies it).
create or replace function public.bd_rules() returns jsonb
language sql immutable as $rules$ select $json${"version":1,"tz":"America/New_York","postKinds":["progress","stuck","found","finished"],"thingStatuses":["active","paused","done"],"shiftKinds":["shift","logged"],"stuckReasons":["unclear","too_big","missing","unsure"],"helpNeeds":["hand","tool","smaller","different"],"helpStatuses":["offered","accepted","declined"],"reasons":["spam","unkind","unsafe","other"],"hats":["yellow","white","orange","blue","red","green"],"vests":["orange","lime","yellow","pink","blue"],"tasks":["haul","frame","brick","wire","window","roof","lunch"],"limits":{"titleMax":80,"whyMax":280,"forMax":80,"partnerMax":80,"stepMax":80,"noteMax":200,"lineMax":200,"helpLineMax":140,"nameMax":32,"shiftMaxMinutes":720,"logMaxMinutes":720,"logBackDays":7,"dayMaxMinutes":1440,"shiftLateDays":14,"postMinutesMax":100000,"postsPerDay":20,"offersPerDay":10,"reportsPerDay":10,"reportsToHide":2,"feedDefault":30,"feedMax":60,"onShiftMax":120,"publicThingsMax":20,"doneShown":20,"recordDays":370,"staleSeconds":180,"importShiftsMax":1000,"importDays":400}}$json$::jsonb $rules$;

-- ------------------------------------------------------------------ tables

create table if not exists public.bd_builder (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  hat               text not null,
  vest              text not null,
  first_name        text not null default '' check (char_length(first_name) <= 32 and position('@' in first_name) = 0),
  first_name_public boolean not null default false,
  updated_at        timestamptz not null default now()
);

create table if not exists public.bd_things (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  why         text not null default '' check (char_length(why) <= 280),
  for_whom    text not null default '' check (char_length(for_whom) <= 80),
  partner     text not null default '' check (char_length(partner) <= 80),
  target_date date,
  status      text not null default 'active' check (status in ('active', 'paused', 'done')),
  why_public  boolean not null default false,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
-- one thing at a time: at most one that is not done
create unique index if not exists bd_things_current_idx on public.bd_things (user_id) where status <> 'done';

create table if not exists public.bd_shifts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  client_id  text not null,
  thing_id   uuid references public.bd_things(id) on delete set null,
  kind       text not null check (kind in ('shift', 'logged')),
  started    timestamptz,
  ended      timestamptz,
  day        date not null,
  minutes    int not null check (minutes between 1 and 720),
  step       text not null default '',
  note       text not null default '',
  posted     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists bd_shifts_day_idx on public.bd_shifts (day);
create index if not exists bd_shifts_user_day_idx on public.bd_shifts (user_id, day);

create table if not exists public.bd_posts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  thing_id     uuid references public.bd_things(id) on delete set null,
  shift_id     uuid references public.bd_shifts(id) on delete set null,
  kind         text not null check (kind in ('progress', 'stuck', 'found', 'finished')),
  line         text not null check (char_length(line) between 1 and 200),
  photo_path   text unique,
  minutes      int check (minutes between 1 and 100000),
  stuck_reason text,
  help_need    text,
  brief_ok     boolean not null default false,
  reports      int not null default 0,
  created_at   timestamptz not null default now(),
  hidden_at    timestamptz
);
create index if not exists bd_posts_feed_idx on public.bd_posts (created_at desc, id desc) where hidden_at is null;
create index if not exists bd_posts_user_idx on public.bd_posts (user_id, created_at desc);
create index if not exists bd_posts_thing_idx on public.bd_posts (thing_id);

create table if not exists public.bd_nice (
  post_id    uuid not null references public.bd_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.bd_help (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.bd_posts(id) on delete cascade,
  helper_id        uuid not null references auth.users(id) on delete cascade,
  line             text not null check (char_length(line) between 1 and 140),
  status           text not null default 'offered' check (status in ('offered', 'accepted', 'declined')),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  intro_claimed_at timestamptz,   -- bd-intro is sending it (cleared again if the send fails)
  intro_sent_at    timestamptz,   -- the two emails went; never again
  unique (post_id, helper_id)
);
create index if not exists bd_help_helper_idx on public.bd_help (helper_id, created_at desc);
create index if not exists bd_help_intro_idx on public.bd_help (decided_at) where status = 'accepted' and intro_sent_at is null;

create table if not exists public.bd_presence (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  public_id  uuid not null default gen_random_uuid(),
  task       text not null,
  started_at timestamptz not null default now(),
  heartbeat  timestamptz not null default now()
);

create table if not exists public.bd_reports (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('post', 'help')),
  target_id  uuid not null,
  by_user    uuid not null references auth.users(id) on delete cascade,
  reason     text not null,
  created_at timestamptz not null default now(),
  unique (kind, target_id, by_user)
);
create index if not exists bd_reports_by_idx on public.bd_reports (by_user, created_at desc);

create table if not exists public.bd_blocks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, blocked_id)
);
create index if not exists bd_blocks_blocked_idx on public.bd_blocks (blocked_id);

alter table public.bd_builder  enable row level security;
alter table public.bd_things   enable row level security;
alter table public.bd_shifts   enable row level security;
alter table public.bd_posts    enable row level security;
alter table public.bd_nice     enable row level security;
alter table public.bd_help     enable row level security;
alter table public.bd_presence enable row level security;
alter table public.bd_reports  enable row level security;
alter table public.bd_blocks   enable row level security;
revoke all on table public.bd_builder, public.bd_things, public.bd_shifts, public.bd_posts, public.bd_nice, public.bd_help,
  public.bd_presence, public.bd_reports, public.bd_blocks from anon, authenticated;

-- ----------------------------------------------------------------- helpers

-- Tidy words the way build-core.js clean() does, in the same order.
create or replace function public.bd_clean(s text) returns text
language plpgsql immutable as $$
declare t text;
begin
  t := regexp_replace(coalesce(s, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g');
  t := regexp_replace(t, 'https?://\S+|www\.\S+', '', 'gi');
  t := regexp_replace(t, '\s+', ' ', 'g');
  return btrim(t);
end $$;

create or replace function public.bd_today() returns date
language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;
create or replace function public.bd_day(t timestamptz) returns date
language sql stable as $$ select (t at time zone 'America/New_York')::date $$;

-- A real calendar date written 'YYYY-MM-DD', as isKey() in build-core.js.
create or replace function public.bd_is_day(s text) returns boolean
language plpgsql immutable as $$
begin
  if s is null or s !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(s::date, 'YYYY-MM-DD') = s;
exception when others then return false;
end $$;

-- Blocked, either way round.
create or replace function public.bd_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (select 1 from public.bd_blocks
    where (user_id = a and blocked_id = b) or (user_id = b and blocked_id = a))
$$;

create or replace function public.bd_banned(u uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare hit boolean;
begin
  if u is null or to_regclass('public.nn_bans') is null then return false; end if;
  execute 'select exists (select 1 from public.nn_bans where user_id = $1)' into hit using u;
  return coalesce(hit, false);
end $$;

-- The photo queue, as the boards use it (nn-SETUP.sql): looked up by name,
-- so this file installs where db/photos.sql has not run.
create or replace function public.bd_photo_state(p_path text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  if p_path is null then return 'none'; end if;
  if to_regclass('public.btb_photos') is null then return 'missing'; end if;
  execute 'select status from public.btb_photos where storage_path = $1' into s using p_path;
  if s is null then return 'missing'; end if;
  return case s when 'approved' then 'approved' when 'pending' then 'pending' else 'rejected' end;
end $$;
create or replace function public.bd_photo_claimable(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ok boolean;
begin
  if p_path is null or to_regclass('public.btb_photos') is null then return false; end if;
  execute 'select exists (select 1 from public.btb_photos where storage_path = $1 and status = ''pending''
             and spot like ''All Day · %'' and created_at > now() - interval ''1 day'')' into ok using p_path;
  return coalesce(ok, false);
end $$;
create or replace function public.bd_photo_remove(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_path is null or to_regclass('public.btb_photos') is null then return; end if;
  execute 'update public.btb_photos set status = ''removed'', decided_at = now()
            where storage_path = $1 and status <> ''removed'' and spot like ''All Day · %''' using p_path;
end $$;

create or replace function public.bd_name(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(first_name, '') from public.bd_builder where user_id = u
$$;

create or replace function public.bd_current(u uuid) returns public.bd_things
language sql stable security definer set search_path = public as $$
  select * from public.bd_things where user_id = u and status <> 'done' order by created_at desc limit 1
$$;

create or replace function public.bd_thing_json(t public.bd_things) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when t.id is null then null else jsonb_build_object(
    'id', t.id, 'title', t.title, 'why', t.why, 'for_whom', t.for_whom, 'partner', t.partner,
    'target_date', to_char(t.target_date, 'YYYY-MM-DD'), 'status', t.status, 'why_public', t.why_public,
    'created_at', t.created_at, 'done_at', t.done_at,
    'has_posts', exists (select 1 from public.bd_posts p where p.thing_id = t.id and p.hidden_at is null)) end
$$;

create or replace function public.bd_shift_json(s public.bd_shifts) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', s.id, 'client_id', s.client_id, 'kind', s.kind, 'day', to_char(s.day, 'YYYY-MM-DD'),
    'minutes', s.minutes, 'thing', s.thing_id, 'posted', s.posted)
$$;

-- One post as the app draws it, for the reader u (null: signed out). The
-- author is a first name and nothing else.
create or replace function public.bd_post_json(p public.bd_posts, u uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'line', p.line,
    'photo', case when public.bd_photo_state(p.photo_path) = 'approved' then p.photo_path end,
    'minutes', p.minutes, 'stuck_reason', p.stuck_reason, 'help_need', p.help_need, 'brief_ok', p.brief_ok,
    'thing', (select title from public.bd_things where id = p.thing_id),
    'author', coalesce(public.bd_name(p.user_id), 'A neighbor'), 'created_at', p.created_at,
    'nice', (select count(*) from public.bd_nice n where n.post_id = p.id),
    'niced', u is not null and exists (select 1 from public.bd_nice n where n.post_id = p.id and n.user_id = u),
    'mine', u is not null and p.user_id = u,
    'offered', u is not null and p.user_id <> u and exists (select 1 from public.bd_help h where h.post_id = p.id and h.helper_id = u),
    'offers_waiting', case when u is not null and p.user_id = u then (select count(*) from public.bd_help h
        where h.post_id = p.id and h.status = 'offered' and not public.bd_blocked(u, h.helper_id)) else 0 end)
$$;

create or replace function public.bd_day_total(u uuid, d date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(minutes), 0)::int from public.bd_shifts where user_id = u and day = d
$$;

-- ---------------------------------------------------------------- builder

create or replace function public.bd_builder_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return (select jsonb_build_object('hat', hat, 'vest', vest, 'first_name', first_name, 'first_name_public', first_name_public)
            from public.bd_builder where user_id = u);
end $$;

-- A field left null keeps what you had (or the first hat and vest).
create or replace function public.bd_builder_set(p_hat text default null, p_vest text default null, p_first_name text default null,
  p_first_name_public boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); R jsonb := public.bd_rules(); b public.bd_builder;
  v_hat text; v_vest text; v_name text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into b from public.bd_builder where user_id = u;
  v_hat := coalesce(p_hat, b.hat, R -> 'hats' ->> 0);
  if not (R -> 'hats') ? v_hat then raise exception 'bad_look'; end if;
  v_vest := coalesce(p_vest, b.vest, R -> 'vests' ->> 0);
  if not (R -> 'vests') ? v_vest then raise exception 'bad_look'; end if;
  v_name := case when p_first_name is not null then public.bd_clean(p_first_name) else coalesce(b.first_name, '') end;
  if char_length(v_name) > 32 or position('@' in v_name) > 0 then raise exception 'bad_name'; end if;
  insert into public.bd_builder (user_id, hat, vest, first_name, first_name_public)
  values (u, v_hat, v_vest, v_name, coalesce(p_first_name_public, b.first_name_public, false))
  on conflict (user_id) do update set hat = excluded.hat, vest = excluded.vest, first_name = excluded.first_name,
    first_name_public = excluded.first_name_public, updated_at = now();
  return public.bd_builder_get();
end $$;

-- ------------------------------------------------------------------ thing

create or replace function public.bd_thing_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return jsonb_build_object('thing', public.bd_thing_json(public.bd_current(u)),
    'done', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'done_at', done_at) order by done_at desc, id desc)
                        from (select * from public.bd_things where user_id = u and status = 'done' order by done_at desc, id desc limit 20) d), '[]'::jsonb));
end $$;

-- Make your thing, or change it. null keeps a field, '' clears it (the
-- title cannot be cleared). Checks in build-core.js checkThing()'s order.
create or replace function public.bd_thing_set(p_title text default null, p_why text default null, p_for text default null,
  p_partner text default null, p_target text default null, p_why_public boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); cur public.bd_things;
  v_title text; v_why text; v_for text; v_partner text; v_target date;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtext('bd_thing:' || u::text));
  cur := public.bd_current(u);
  v_title := case when p_title is not null then public.bd_clean(p_title) else coalesce(cur.title, '') end;
  if v_title = '' or char_length(v_title) > 80 then raise exception 'bad_title'; end if;
  v_why := case when p_why is not null then public.bd_clean(p_why) else coalesce(cur.why, '') end;
  if char_length(v_why) > 280 then raise exception 'bad_why'; end if;
  v_for := case when p_for is not null then public.bd_clean(p_for) else coalesce(cur.for_whom, '') end;
  if char_length(v_for) > 80 then raise exception 'bad_for'; end if;
  v_partner := case when p_partner is not null then public.bd_clean(p_partner) else coalesce(cur.partner, '') end;
  if char_length(v_partner) > 80 then raise exception 'bad_partner'; end if;
  v_target := cur.target_date;
  if p_target is not null then
    if btrim(p_target) = '' then v_target := null;
    elsif not public.bd_is_day(btrim(p_target)) then raise exception 'bad_date';
    else v_target := btrim(p_target)::date; end if;
  end if;
  if cur.id is null then
    insert into public.bd_things (user_id, title, why, for_whom, partner, target_date, why_public)
    values (u, v_title, v_why, v_for, v_partner, v_target, coalesce(p_why_public, false)) returning * into cur;
  else
    update public.bd_things set title = v_title, why = v_why, for_whom = v_for, partner = v_partner, target_date = v_target,
      why_public = coalesce(p_why_public, why_public) where id = cur.id returning * into cur;
  end if;
  return public.bd_thing_json(cur);
end $$;

-- Pause it, pick it back up, or finish it (then name the next one).
create or replace function public.bd_thing_status(p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cur public.bd_things;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_status is null or p_status not in ('active', 'paused', 'done') then raise exception 'bad_status'; end if;
  cur := public.bd_current(u);
  if cur.id is null then raise exception 'no_thing'; end if;
  update public.bd_things set status = p_status, done_at = case when p_status = 'done' then now() else done_at end
   where id = cur.id returning * into cur;
  return public.bd_thing_json(cur);
end $$;

-- ----------------------------------------------------------------- shifts

-- A shift that ended (phone down). Sent again with the same client id, the
-- first one answers: a shift is never kept twice. A thing that is not
-- yours is dropped, not refused, so the hours always count.
create or replace function public.bd_shift_add(p_client_id text, p_started timestamptz, p_ended timestamptz, p_minutes int,
  p_step text default '', p_note text default '', p_thing uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.bd_shifts; v_day date;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_client_id is null or p_client_id !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'bad_shift'; end if;
  perform pg_advisory_xact_lock(hashtext('bd_shift:' || u::text));
  select * into s from public.bd_shifts where user_id = u and client_id = p_client_id;
  if found then return public.bd_shift_json(s); end if;
  if p_started is null or p_ended is null or p_ended < p_started or p_ended > now() + interval '5 minutes'
     or p_started < now() - interval '14 days' then raise exception 'bad_shift'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > least(720, ceil(extract(epoch from p_ended - p_started) / 60)::int) then raise exception 'bad_minutes'; end if;
  v_day := public.bd_day(p_started);
  if public.bd_day_total(u, v_day) + p_minutes > 1440 then raise exception 'too_much'; end if;
  insert into public.bd_shifts (user_id, client_id, thing_id, kind, started, ended, day, minutes, step, note)
  values (u, p_client_id, (select id from public.bd_things where id = p_thing and user_id = u), 'shift', p_started, p_ended, v_day, p_minutes,
          left(public.bd_clean(p_step), 80), left(public.bd_clean(p_note), 200))
  returning * into s;
  return public.bd_shift_json(s);
end $$;

-- Work done away from the phone: a day in the last week, up to 12 hours.
create or replace function public.bd_log_add(p_client_id text, p_minutes int, p_note text default '', p_day date default null,
  p_thing uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.bd_shifts; v_day date := coalesce(p_day, public.bd_today());
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_client_id is null or p_client_id !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'bad_shift'; end if;
  perform pg_advisory_xact_lock(hashtext('bd_shift:' || u::text));
  select * into s from public.bd_shifts where user_id = u and client_id = p_client_id;
  if found then return public.bd_shift_json(s); end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 720 then raise exception 'bad_minutes'; end if;
  if v_day > public.bd_today() or v_day < public.bd_today() - 7 then raise exception 'bad_day'; end if;
  if public.bd_day_total(u, v_day) + p_minutes > 1440 then raise exception 'too_much'; end if;
  insert into public.bd_shifts (user_id, client_id, thing_id, kind, day, minutes, note)
  values (u, p_client_id, (select id from public.bd_things where id = p_thing and user_id = u), 'logged', v_day, p_minutes, left(public.bd_clean(p_note), 200))
  returning * into s;
  return public.bd_shift_json(s);
end $$;

-- Your hours off the phone, by Burlington day, for up to 370 days.
create or replace function public.bd_my_record(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 369 then raise exception 'bad_range'; end if;
  return jsonb_build_object('days', coalesce((
    select jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'minutes', m, 'logged', l) order by day)
      from (select day, sum(minutes)::int as m, (sum(minutes) filter (where kind = 'logged'))::int as l
              from public.bd_shifts where user_id = u and day between p_from and p_to group by day) d), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ posts

create or replace function public.bd_post_create(p_kind text, p_line text, p_photo text default null, p_minutes int default null,
  p_stuck_reason text default null, p_help_need text default null, p_brief_ok boolean default false, p_shift uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); R jsonb := public.bd_rules();
  v_line text := public.bd_clean(p_line);
  v_reason text := nullif(p_stuck_reason, ''); v_need text := nullif(p_help_need, ''); v_photo text := nullif(p_photo, '');
  v_shift uuid; rec public.bd_posts;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtext('bd_post:' || u::text));
  if public.bd_banned(u) then raise exception 'banned'; end if;
  if public.bd_name(u) is null then raise exception 'no_name'; end if;
  if p_kind is null or not (R -> 'postKinds') ? p_kind then raise exception 'bad_kind'; end if;
  if v_line = '' or char_length(v_line) > 200 then raise exception 'bad_line'; end if;
  if (v_reason is not null or v_need is not null) and p_kind <> 'stuck' then raise exception 'bad_stuck'; end if;
  if v_reason is not null and not (R -> 'stuckReasons') ? v_reason then raise exception 'bad_stuck'; end if;
  if v_need is not null and not (R -> 'helpNeeds') ? v_need then raise exception 'bad_stuck'; end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 100000) then raise exception 'bad_minutes'; end if;
  if v_photo is not null and v_photo !~ '^submissions/[A-Za-z0-9-]+\.jpg$' then raise exception 'bad_photo'; end if;
  if v_photo is not null then perform pg_advisory_xact_lock(hashtext('bd_photo:' || v_photo)); end if;
  if v_photo is not null and (not public.bd_photo_claimable(v_photo) or exists (select 1 from public.bd_posts where photo_path = v_photo)) then
    raise exception 'bad_photo';
  end if;
  if (select count(*) from public.bd_posts where user_id = u and created_at > now() - interval '24 hours') >= 20 then raise exception 'rate_day'; end if;
  update public.bd_shifts set posted = true where id = p_shift and user_id = u returning id into v_shift;
  insert into public.bd_posts (user_id, thing_id, shift_id, kind, line, photo_path, minutes, stuck_reason, help_need, brief_ok)
  values (u, (public.bd_current(u)).id, v_shift, p_kind, v_line, v_photo, p_minutes, v_reason, v_need, coalesce(p_brief_ok, false))
  returning * into rec;
  return public.bd_post_json(rec, u);
end $$;

-- Delete your own post (its Nice, offers and reports go with it).
create or replace function public.bd_post_delete(p_post uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p public.bd_posts;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into p from public.bd_posts where id = p_post and user_id = u;
  if not found then raise exception 'not_found'; end if;
  perform public.bd_photo_remove(p.photo_path);
  delete from public.bd_reports where (kind = 'post' and target_id = p.id)
     or (kind = 'help' and target_id in (select id from public.bd_help where post_id = p.id));
  delete from public.bd_posts where id = p.id;
  return jsonb_build_object('deleted', true);
end $$;

-- The feed: posts everyone may see, newest first, minus anyone you blocked
-- or who blocked you. p_before pages back; p_kind and p_brief narrow it.
create or replace function public.bd_feed(p_before timestamptz default null, p_limit int default 30, p_kind text default null,
  p_brief boolean default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.bd_post_json(p, auth.uid()) order by p.created_at desc, p.id desc), '[]'::jsonb)
    from (select * from public.bd_posts p
           where p.hidden_at is null and not public.bd_blocked(auth.uid(), p.user_id)
             and (p_kind is null or p.kind = p_kind) and (p_brief is not true or p.brief_ok)
             and (p_before is null or p.created_at < p_before)
           order by p.created_at desc, p.id desc
           limit greatest(1, least(coalesce(p_limit, 30), 60))) p
$$;

-- Your posts for a thing (default: your current one), oldest first.
create or replace function public.bd_shelf(p_thing uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); v_thing uuid;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  v_thing := case when p_thing is not null then (select id from public.bd_things where id = p_thing and user_id = u) else (public.bd_current(u)).id end;
  if v_thing is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(public.bd_post_json(p, u) || jsonb_build_object('hidden', p.hidden_at is not null) order by p.created_at, p.id)
                     from public.bd_posts p where p.user_id = u and p.thing_id = v_thing), '[]'::jsonb);
end $$;

create or replace function public.bd_nice(p_post uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p public.bd_posts; v_on boolean;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into p from public.bd_posts where id = p_post;
  if not found or p.hidden_at is not null or public.bd_blocked(u, p.user_id) then raise exception 'not_found'; end if;
  if p.user_id = u then raise exception 'own_post'; end if;
  delete from public.bd_nice where post_id = p.id and user_id = u;
  v_on := not found;
  if v_on then insert into public.bd_nice (post_id, user_id) values (p.id, u); end if;
  return jsonb_build_object('nice', (select count(*) from public.bd_nice where post_id = p.id), 'niced', v_on);
end $$;

-- ------------------------------------------------------------------- help

create or replace function public.bd_help_offer(p_post uuid, p_line text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p public.bd_posts; v_line text := public.bd_clean(p_line); h public.bd_help;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtext('bd_help:' || u::text));
  if public.bd_banned(u) then raise exception 'banned'; end if;
  if public.bd_name(u) is null then raise exception 'no_name'; end if;
  select * into p from public.bd_posts where id = p_post;
  if not found or p.hidden_at is not null or public.bd_blocked(u, p.user_id) then raise exception 'not_found'; end if;
  if p.user_id = u then raise exception 'own_post'; end if;
  if p.kind <> 'stuck' then raise exception 'not_stuck'; end if;
  if v_line = '' or char_length(v_line) > 140 then raise exception 'bad_help_line'; end if;
  if exists (select 1 from public.bd_help where post_id = p.id and helper_id = u) then raise exception 'already_offered'; end if;
  if (select count(*) from public.bd_help where helper_id = u and created_at > now() - interval '24 hours') >= 10 then raise exception 'rate_offers'; end if;
  insert into public.bd_help (post_id, helper_id, line) values (p.id, u, v_line) returning * into h;
  return jsonb_build_object('id', h.id, 'status', h.status);
end $$;

-- The poster's Yes or No thanks. Yes is the second yes: the bd-intro Edge
-- Function may now email the two of them (the app pokes it; it checks
-- this row itself).
create or replace function public.bd_help_respond(p_help uuid, p_yes boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h public.bd_help;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select h2.* into h from public.bd_help h2 join public.bd_posts p on p.id = h2.post_id where h2.id = p_help and p.user_id = u for update of h2;
  if not found then raise exception 'not_found'; end if;
  if h.status <> 'offered' then raise exception 'already_answered'; end if;
  update public.bd_help set status = case when p_yes is true then 'accepted' else 'declined' end, decided_at = now()
   where id = h.id returning * into h;
  return jsonb_build_object('id', h.id, 'status', h.status);
end $$;

-- Offers on your posts (not the ones you declined, not from anyone you
-- blocked), and your own offers. First names only.
create or replace function public.bd_help_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'post', h.post_id, 'post_line', p.line,
        'name', coalesce(public.bd_name(h.helper_id), 'A neighbor'), 'line', h.line, 'status', h.status, 'created_at', h.created_at)
        order by h.created_at desc, h.id desc)
      from public.bd_help h join public.bd_posts p on p.id = h.post_id
     where p.user_id = u and h.status <> 'declined' and not public.bd_blocked(u, h.helper_id)), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'post', h.post_id, 'post_line', p.line,
        'name', coalesce(public.bd_name(p.user_id), 'A neighbor'), 'line', h.line, 'status', h.status, 'created_at', h.created_at)
        order by h.created_at desc, h.id desc)
      from public.bd_help h join public.bd_posts p on p.id = h.post_id where h.helper_id = u), '[]'::jsonb));
end $$;

-- ------------------------------------------------------ reports and blocks

-- Report a post (two reports hide it until Stephen looks) or an offer
-- (yours to answer, or one you made). A poster reporting an offer that
-- waits declines it at once.
create or replace function public.bd_report(p_kind text, p_target uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); R jsonb := public.bd_rules(); p public.bd_posts; h public.bd_help; n int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtext('bd_report:' || u::text));
  if p_reason is null or not (R -> 'reasons') ? p_reason then raise exception 'bad_reason'; end if;
  if p_kind is null or p_kind not in ('post', 'help') then raise exception 'bad_target'; end if;
  if p_kind = 'post' then
    select * into p from public.bd_posts where id = p_target;
    if not found or p.hidden_at is not null then raise exception 'not_found'; end if;
    if p.user_id = u then raise exception 'own_post'; end if;
  else
    select * into h from public.bd_help where id = p_target;
    if found then select * into p from public.bd_posts where id = h.post_id; end if;
    if h.id is null or p.id is null or (p.user_id <> u and h.helper_id <> u) then raise exception 'not_found'; end if;
  end if;
  if exists (select 1 from public.bd_reports where kind = p_kind and target_id = p_target and by_user = u) then raise exception 'already_reported'; end if;
  if (select count(*) from public.bd_reports where by_user = u and created_at > now() - interval '24 hours') >= 10 then raise exception 'rate_reports'; end if;
  insert into public.bd_reports (kind, target_id, by_user, reason) values (p_kind, p_target, u, p_reason);
  if p_kind = 'post' then
    update public.bd_posts set reports = reports + 1,
      hidden_at = case when reports + 1 >= 2 and hidden_at is null then now() else hidden_at end
     where id = p.id returning reports into n;
    return jsonb_build_object('hidden', n >= 2);
  end if;
  if p.user_id = u and h.status = 'offered' then
    update public.bd_help set status = 'declined', decided_at = now() where id = h.id;
    return jsonb_build_object('hidden', true);
  end if;
  return jsonb_build_object('hidden', false);
end $$;

-- Block the author of a post, or the other side of an offer.
create or replace function public.bd_block(p_kind text, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_other uuid;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_kind is null or p_kind not in ('post', 'help') then raise exception 'bad_target'; end if;
  if p_kind = 'post' then
    select user_id into v_other from public.bd_posts where id = p_target and hidden_at is null;
  else
    select case when p.user_id = u then h.helper_id when h.helper_id = u then p.user_id end into v_other
      from public.bd_help h join public.bd_posts p on p.id = h.post_id where h.id = p_target;
  end if;
  if v_other is null then raise exception 'not_found'; end if;
  if v_other = u then raise exception 'own_post'; end if;
  insert into public.bd_blocks (user_id, blocked_id) values (u, v_other) on conflict (user_id, blocked_id) do nothing;
  update public.bd_help h set status = 'declined', decided_at = now()
    from public.bd_posts p
   where p.id = h.post_id and h.status = 'offered'
     and ((p.user_id = u and h.helper_id = v_other) or (p.user_id = v_other and h.helper_id = u));
  return jsonb_build_object('blocked', true);
end $$;

create or replace function public.bd_blocks_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', coalesce(public.bd_name(b.blocked_id), 'A neighbor'))
                     order by b.created_at desc, b.id desc) from public.bd_blocks b where b.user_id = u), '[]'::jsonb);
end $$;

create or replace function public.bd_unblock(p_block uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  delete from public.bd_blocks where id = p_block and user_id = u;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object('unblocked', true);
end $$;

-- --------------------------------------------------------------- presence

-- On shift: every minute while the page is in front. A new public id for
-- each shift (after three quiet minutes), so a builder on the site can't be
-- followed from one shift to the next.
create or replace function public.bd_presence_beat(p_task text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_task is null or not (public.bd_rules() -> 'tasks') ? p_task then raise exception 'bad_task'; end if;
  insert into public.bd_presence (user_id, task) values (u, p_task)
  on conflict (user_id) do update set task = excluded.task, heartbeat = now(),
    public_id = case when bd_presence.heartbeat > now() - interval '180 seconds' then bd_presence.public_id else gen_random_uuid() end,
    started_at = case when bd_presence.heartbeat > now() - interval '180 seconds' then bd_presence.started_at else now() end;
  return jsonb_build_object('on', true);
end $$;

create or replace function public.bd_presence_end() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  delete from public.bd_presence where user_id = u;
  return jsonb_build_object('on', false);
end $$;

-- ----------------------------------------------------------------- the town

-- What everyone sees: the town's minutes since the season started (every
-- shift and log, posted or not), this week's (from Monday, Burlington),
-- habit taps as pallets, posts as lit windows, and who is on shift now:
-- a random id per shift, the look, the job, and a first name only when
-- they chose to show it. Counts and names, never an account or a time.
create or replace function public.bd_town(p_since date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  v_week date := date_trunc('week', public.bd_today()::timestamp)::date;
  v_drops int := 0;
begin
  if to_regclass('public.sz_taps') is not null then
    execute 'select count(*) from public.sz_taps where $1 is null or date >= $1' into v_drops using p_since;
  end if;
  return jsonb_build_object(
    'total_minutes', (select coalesce(sum(minutes), 0) from public.bd_shifts where p_since is null or day >= p_since),
    'week_minutes', (select coalesce(sum(minutes), 0) from public.bd_shifts where day >= greatest(v_week, coalesce(p_since, v_week))),
    'today_minutes', (select coalesce(sum(minutes), 0) from public.bd_shifts where day = public.bd_today()),
    'habit_drops', v_drops,
    'posts_lit', (select count(*) from public.bd_posts where hidden_at is null and (p_since is null or public.bd_day(created_at) >= p_since)),
    'on_shift_count', (select count(*) from public.bd_presence where heartbeat > now() - interval '180 seconds'),
    'on_shift', coalesce((select jsonb_agg(jsonb_build_object('id', x.public_id, 'look', jsonb_build_object('hat', x.hat, 'vest', x.vest),
                            'task', x.task, 'name', x.name, 'me', x.me) order by x.started_at, x.public_id)
      from (select pr.public_id, pr.task, pr.started_at, coalesce(b.hat, 'yellow') as hat, coalesce(b.vest, 'orange') as vest,
                   case when b.first_name_public and b.first_name <> '' then b.first_name end as name,
                   (u is not null and pr.user_id = u) as me
              from public.bd_presence pr left join public.bd_builder b on b.user_id = pr.user_id
             where pr.heartbeat > now() - interval '180 seconds'
             order by pr.started_at, pr.public_id limit 120) x), '[]'::jsonb));
end $$;

-- The starter door: neighbours' things with at least one post, newest
-- post first, at most 20. The why only when the owner turned why_public on
-- for that thing; a first name only when their builder shows it.
create or replace function public.bd_public_things(p_limit int default 20) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'why', x.why, 'name', x.name,
           'last_kind', x.last_kind, 'last_at', to_char(public.bd_day(x.last_at), 'YYYY-MM-DD')) order by x.last_at desc, x.id), '[]'::jsonb)
    from (select t.id, t.title, case when t.why_public and t.why <> '' then t.why end as why,
                 case when b.first_name_public and b.first_name <> '' then b.first_name end as name, lp.kind as last_kind, lp.created_at as last_at
            from public.bd_things t
            join lateral (select p.kind, p.created_at from public.bd_posts p where p.thing_id = t.id and p.hidden_at is null
                           order by p.created_at desc, p.id desc limit 1) lp on true
            left join public.bd_builder b on b.user_id = t.user_id
           where t.status <> 'done' and t.user_id is distinct from auth.uid()
             and not public.bd_banned(t.user_id) and not public.bd_blocked(auth.uid(), t.user_id)
           order by lp.created_at desc, t.id
           limit greatest(1, least(coalesce(p_limit, 20), 20))) x
$$;

-- ------------------------------------------------------------ your account

-- At first sign-in: the thing, hours and look this phone kept move to the
-- account, once, and only into an account with no thing and no hours yet.
-- Everything is checked before anything is written (build-fake.js
-- checkImport, line for line).
create or replace function public.bd_import_local(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); R jsonb := public.bd_rules();
  t jsonb := p_data -> 'thing'; b jsonb := p_data -> 'builder'; list jsonb := coalesce(p_data -> 'shifts', '[]'::jsonb);
  x jsonb; v_today date := public.bd_today(); v_thing uuid; v_n int := 0;
  v_title text; v_why text; v_for text; v_partner text; v_target date; v_status text; v_hat text; v_vest text; v_name text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtext('bd_thing:' || u::text));
  if exists (select 1 from public.bd_things where user_id = u) or exists (select 1 from public.bd_shifts where user_id = u) then
    raise exception 'already_synced';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_data) k where k not in ('thing', 'shifts', 'builder')) then raise exception 'bad_import'; end if;
  if t is not null and jsonb_typeof(t) <> 'null' then
    if jsonb_typeof(t) <> 'object' then raise exception 'bad_import'; end if;
    v_title := public.bd_clean(t ->> 'title'); v_why := public.bd_clean(t ->> 'why');
    v_for := public.bd_clean(t ->> 'for_whom'); v_partner := public.bd_clean(t ->> 'partner');
    if v_title = '' or char_length(v_title) > 80 or char_length(v_why) > 280 or char_length(v_for) > 80 or char_length(v_partner) > 80 then raise exception 'bad_import'; end if;
    if coalesce(btrim(t ->> 'target_date'), '') <> '' then
      if not public.bd_is_day(btrim(t ->> 'target_date')) then raise exception 'bad_import'; end if;
      v_target := btrim(t ->> 'target_date')::date;
    end if;
    v_status := coalesce(t ->> 'status', 'active');
    if v_status not in ('active', 'paused') then raise exception 'bad_import'; end if;
  else t := null;
  end if;
  if b is not null and jsonb_typeof(b) <> 'null' then
    if jsonb_typeof(b) <> 'object' then raise exception 'bad_import'; end if;
    v_hat := coalesce(b ->> 'hat', R -> 'hats' ->> 0); v_vest := coalesce(b ->> 'vest', R -> 'vests' ->> 0);
    v_name := public.bd_clean(b ->> 'first_name');
    if not (R -> 'hats') ? v_hat or not (R -> 'vests') ? v_vest or char_length(v_name) > 32 or position('@' in v_name) > 0 then raise exception 'bad_import'; end if;
  else b := null;
  end if;
  if jsonb_typeof(list) <> 'array' or jsonb_array_length(list) > 1000 then raise exception 'bad_import'; end if;
  for x in select * from jsonb_array_elements(list) loop
    if jsonb_typeof(x) <> 'object' or jsonb_typeof(x -> 'client_id') is distinct from 'string' or x ->> 'client_id' !~ '^[A-Za-z0-9-]{8,64}$'
       or x ->> 'kind' is null or x ->> 'kind' not in ('shift', 'logged')
       or jsonb_typeof(x -> 'minutes') is distinct from 'number' or (x ->> 'minutes')::numeric <> floor((x ->> 'minutes')::numeric)
       or (x ->> 'minutes')::numeric < 1 or (x ->> 'minutes')::numeric > 720
       or jsonb_typeof(x -> 'day') is distinct from 'string' or not public.bd_is_day(x ->> 'day')
       or (x ->> 'day')::date > v_today or (x ->> 'day')::date < v_today - 400 then raise exception 'bad_import'; end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(list) e group by e ->> 'client_id' having count(*) > 1)
     or exists (select 1 from jsonb_array_elements(list) e group by e ->> 'day' having sum((e ->> 'minutes')::int) > 1440) then raise exception 'bad_import'; end if;
  if t is not null then
    insert into public.bd_things (user_id, title, why, for_whom, partner, target_date, status, why_public)
    values (u, v_title, v_why, v_for, v_partner, v_target, v_status, coalesce((t -> 'why_public')::text = 'true', false)) returning id into v_thing;
  end if;
  if b is not null then
    insert into public.bd_builder (user_id, hat, vest, first_name, first_name_public)
    values (u, v_hat, v_vest, v_name, coalesce((b -> 'first_name_public')::text = 'true', false)) on conflict (user_id) do nothing;
  end if;
  insert into public.bd_shifts (user_id, client_id, thing_id, kind, day, minutes, step, note)
  select u, e ->> 'client_id', case when (e -> 'on_thing')::text = 'true' then v_thing end, e ->> 'kind', (e ->> 'day')::date, (e ->> 'minutes')::int,
         left(public.bd_clean(e ->> 'step'), 80), left(public.bd_clean(e ->> 'note'), 200)
    from jsonb_array_elements(list) e;
  get diagnostics v_n = row_count;
  return jsonb_build_object('moved', true, 'shifts', v_n);
end $$;

-- "Delete my account and posts" takes all of it: your builder, things,
-- hours, posts (their photos leave the gallery), Nice, offers, reports,
-- blocks and presence. Posts you reported are recounted without you.
create or replace function public.bd_delete_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_path text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  for v_path in select photo_path from public.bd_posts where user_id = u and photo_path is not null loop
    perform public.bd_photo_remove(v_path);
  end loop;
  delete from public.bd_reports where (kind = 'post' and target_id in (select id from public.bd_posts where user_id = u))
     or (kind = 'help' and target_id in (select h.id from public.bd_help h join public.bd_posts p on p.id = h.post_id where p.user_id = u or h.helper_id = u))
     or by_user = u;
  delete from public.bd_posts where user_id = u;
  delete from public.bd_nice where user_id = u;
  delete from public.bd_help where helper_id = u;
  update public.bd_posts p set reports = (select count(*) from public.bd_reports r where r.kind = 'post' and r.target_id = p.id) where p.reports > 0;
  delete from public.bd_blocks where user_id = u or blocked_id = u;
  delete from public.bd_presence where user_id = u;
  delete from public.bd_shifts where user_id = u;
  delete from public.bd_things where user_id = u;
  delete from public.bd_builder where user_id = u;
  return jsonb_build_object('deleted', true);
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function
  public.bd_rules(), public.bd_clean(text), public.bd_today(), public.bd_day(timestamptz), public.bd_is_day(text),
  public.bd_blocked(uuid, uuid), public.bd_banned(uuid), public.bd_photo_state(text), public.bd_photo_claimable(text),
  public.bd_photo_remove(text), public.bd_name(uuid), public.bd_current(uuid), public.bd_thing_json(public.bd_things),
  public.bd_shift_json(public.bd_shifts), public.bd_post_json(public.bd_posts, uuid), public.bd_day_total(uuid, date),
  public.bd_builder_get(), public.bd_builder_set(text, text, text, boolean), public.bd_thing_get(),
  public.bd_thing_set(text, text, text, text, text, boolean), public.bd_thing_status(text),
  public.bd_shift_add(text, timestamptz, timestamptz, int, text, text, uuid), public.bd_log_add(text, int, text, date, uuid),
  public.bd_my_record(date, date), public.bd_post_create(text, text, text, int, text, text, boolean, uuid), public.bd_post_delete(uuid),
  public.bd_feed(timestamptz, int, text, boolean), public.bd_shelf(uuid), public.bd_nice(uuid), public.bd_help_offer(uuid, text),
  public.bd_help_respond(uuid, boolean), public.bd_help_list(), public.bd_report(text, uuid, text), public.bd_block(text, uuid),
  public.bd_blocks_get(), public.bd_unblock(uuid), public.bd_presence_beat(text), public.bd_presence_end(), public.bd_town(date),
  public.bd_public_things(int), public.bd_import_local(jsonb), public.bd_delete_me()
from public, anon, authenticated;

grant execute on function
  public.bd_rules(), public.bd_builder_get(), public.bd_builder_set(text, text, text, boolean), public.bd_thing_get(),
  public.bd_thing_set(text, text, text, text, text, boolean), public.bd_thing_status(text),
  public.bd_shift_add(text, timestamptz, timestamptz, int, text, text, uuid), public.bd_log_add(text, int, text, date, uuid),
  public.bd_my_record(date, date), public.bd_post_create(text, text, text, int, text, text, boolean, uuid), public.bd_post_delete(uuid),
  public.bd_feed(timestamptz, int, text, boolean), public.bd_shelf(uuid), public.bd_nice(uuid), public.bd_help_offer(uuid, text),
  public.bd_help_respond(uuid, boolean), public.bd_help_list(), public.bd_report(text, uuid, text), public.bd_block(text, uuid),
  public.bd_blocks_get(), public.bd_unblock(uuid), public.bd_presence_beat(text), public.bd_presence_end(), public.bd_town(date),
  public.bd_public_things(int), public.bd_import_local(jsonb), public.bd_delete_me()
to anon, authenticated;
