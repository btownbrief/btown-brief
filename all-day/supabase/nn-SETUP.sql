-- ============================================================================
-- ALL DAY — accounts and boards (the New Nine), one-time Supabase setup.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   nn_  (claimed for the New Nine in the fleet's Supabase prefix map)
-- Written:  2026-10-16
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: every
-- statement is "if not exists" or "create or replace", and nothing here
-- deletes a row you made. all-day/supabase/SETUP-STEPHEN.md has the steps.
--
-- Needs, already in this project: Supabase Auth (auth.users, auth.uid()),
-- pgcrypto, and the reader photo queue from db/photos.sql (btb_photos).
-- Nothing here changes another app's tables; the one cross-prefix write is
-- marking a reader's own board photo 'removed' in btb_photos when they
-- delete that post or their account.
--
-- What it holds, in plain words:
--   nn_profiles      a signed-in reader's first name, and optionally their
--                    neighborhood and People archetype. Never an email.
--   nn_posts         reader posts on the tab boards (Vintage "spotted", Art
--                    wall, People plans, Watchlist ratings), each with the
--                    tab's own small fields in `meta`, an optional photo
--                    from the photo queue, and an expiry.
--   nn_votes         one vote per voter per post. A voter is a signed-in
--                    reader (u:<id>) or a device's anonymous btown-player-id.
--   nn_reports       one report per reader per post. Two hide the post until
--                    Stephen looks.
--   nn_bans          readers who may no longer post.
--   nn_mission_done  What Now's missions marked done (from PR #277).
--   nn_mod, nn_mod_fails   the moderator's passphrase (bcrypt hash only) and
--                    a count of wrong guesses.
--
-- Security model, the fleet's: RLS is on for every table with NO policies,
-- and the tables are revoked from anon and authenticated, so the public key
-- reaches data only through the security-definer functions below. Every
-- rule the app checks before sending (js/boards-core.js) is checked again
-- here, because the anon key is public by design. Rows self-expire: expired
-- posts are swept a week after they end, mod-deleted ones after 30 days,
-- whenever someone posts or Stephen opens the moderation page.
--
-- Honest threat model: anyone can mint a btown-player-id, so anonymous vote
-- counts stop casual stuffing, not a determined script. Posting needs a
-- signed-in email account, rate limits (20 posts a day, 5 waiting), link
-- stripping and the report threshold; those stop casual mischief, not a
-- determined Sybil with many inboxes. Nothing here is integrity-protected.
--
-- The moderator passphrase is set separately, by one line Stephen runs
-- himself (SETUP-STEPHEN.md, part C). Until then every nn_mod_* call answers
-- {"error":"bad_secret"} and the moderation page stays shut.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- the rules
-- The same JSON as RULES in all-day/js/boards-core.js. Boards, kinds, the
-- fields each kind takes, how long a post lasts, the limits. Change both
-- together; scripts/test-boards-core.mjs fails when they differ.
create or replace function public.nn_rules() returns jsonb
language sql immutable as $rules$ select $json${"version":1,"limits":{"nameMax":32,"titleMax":80,"bodyMax":600,"placeMax":80,"metaKeysMax":8,"metaTextMax":80,"postsPerDay":20,"waitingMax":5,"reportsToHide":2,"reportsPerDay":10,"listDefault":30,"listMax":60,"expiredKeepDays":7,"deletedKeepDays":30},"neighborhoods":["downtown","old-north-end","new-north-end","south-end","hill","waterfront","winooski","south-burlington","essex","shelburne","colchester","elsewhere"],"archetypes":["new","regular","trail","games"],"reasons":["spam","unkind","unsafe","other"],"boards":{"people":{"premod":false,"gallery":false,"kinds":{"plan":{"days":14,"photo":"none","needs":["when"]}},"meta":{"when":{"type":"text","max":60},"arch":{"type":"enum","values":["new","regular","trail","games"]},"spots":{"type":"int","min":1,"max":50}}},"vintage":{"premod":false,"gallery":false,"kinds":{"spotted":{"days":21,"photo":"optional","needs":["shop"]},"swap":{"days":21,"photo":"optional","needs":["want"]}},"meta":{"shop":{"type":"text","max":60},"size":{"type":"text","max":12},"price":{"type":"int","min":0,"max":10000},"want":{"type":"text","max":80}}},"art":{"premod":false,"gallery":true,"kinds":{"photo":{"days":null,"photo":"required","needs":[]},"art":{"days":null,"photo":"required","needs":[]},"notice":{"days":30,"photo":"none","needs":[]}},"meta":{"medium":{"type":"text","max":40},"shirt":{"type":"enum","values":["yes","no"]}}},"watch":{"premod":false,"gallery":false,"kinds":{"rating":{"days":null,"photo":"none","needs":["stars"]},"pick":{"days":30,"photo":"none","needs":[]}},"meta":{"year":{"type":"int","min":1888,"max":2100},"stars":{"type":"int","min":1,"max":5},"where":{"type":"text","max":40}}}}}$json$::jsonb $rules$;

-- ------------------------------------------------------------------ tables

create table if not exists public.nn_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32 and position('@' in display_name) = 0),
  neighborhood text,
  archetype    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.nn_posts (
  id          uuid primary key default gen_random_uuid(),
  board       text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null default '' check (char_length(body) <= 600),
  photo_path  text,
  photo_req   boolean not null default false,   -- the kind needs its photo approved before it shows
  meta        jsonb not null default '{}'::jsonb,
  place       text not null default '' check (char_length(place) <= 80),
  expires_at  timestamptz,
  status      text not null default 'approved' check (status in ('pending', 'approved', 'hidden', 'deleted')),
  reports     int not null default 0,           -- reports since Stephen last approved it
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
-- when Stephen last approved it: reports from before then no longer count
alter table public.nn_posts add column if not exists cleared_at timestamptz;
create index if not exists nn_posts_board_idx on public.nn_posts (board, status, created_at desc);
create index if not exists nn_posts_user_idx on public.nn_posts (user_id, created_at desc);
create unique index if not exists nn_posts_photo_idx on public.nn_posts (photo_path) where photo_path is not null;

create table if not exists public.nn_votes (
  post_id    uuid not null references public.nn_posts(id) on delete cascade,
  voter      text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, voter)
);
create index if not exists nn_votes_voter_idx on public.nn_votes (voter);

create table if not exists public.nn_reports (
  post_id    uuid not null references public.nn_posts(id) on delete cascade,
  reporter   uuid not null references auth.users(id) on delete cascade,
  reason     text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, reporter)
);
create index if not exists nn_reports_reporter_idx on public.nn_reports (reporter, created_at desc);

create table if not exists public.nn_bans (
  user_id    uuid primary key,
  created_at timestamptz not null default now()
);

-- What Now's missions marked done, exactly as PR #277 described them.
create table if not exists public.nn_mission_done (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key ~ '^m[0-9]{1,3}$'),
  done_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.nn_mod (
  id        boolean primary key default true check (id),   -- one row
  pass_hash text not null
);
create table if not exists public.nn_mod_fails (at timestamptz not null default now());

alter table public.nn_profiles     enable row level security;
alter table public.nn_posts        enable row level security;
alter table public.nn_votes        enable row level security;
alter table public.nn_reports      enable row level security;
alter table public.nn_bans         enable row level security;
alter table public.nn_mission_done enable row level security;
alter table public.nn_mod          enable row level security;
alter table public.nn_mod_fails    enable row level security;
revoke all on table public.nn_profiles, public.nn_posts, public.nn_votes, public.nn_reports, public.nn_bans,
  public.nn_mission_done, public.nn_mod, public.nn_mod_fails from anon, authenticated;

-- ----------------------------------------------------------------- helpers

-- Tidy a reader's words the way boards-core.js clean() does, in the same
-- order: drop control characters, drop links, squeeze the spaces.
create or replace function public.nn_clean(s text, multiline boolean default false) returns text
language plpgsql immutable as $$
declare t text;
begin
  t := replace(replace(coalesce(s, ''), E'\r\n', E'\n'), E'\r', E'\n');
  t := regexp_replace(t, '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g');
  t := regexp_replace(t, 'https?://\S+|www\.\S+', '', 'gi');
  if multiline then
    t := regexp_replace(t, '[ \t]+', ' ', 'g');
    t := regexp_replace(t, ' *\n *', E'\n', 'g');
    t := regexp_replace(t, '\n{3,}', E'\n\n', 'g');
  else
    t := regexp_replace(t, '\s+', ' ', 'g');
  end if;
  return btrim(t, E' \n');
end $$;

-- Where a post's photo stands in the fleet's photo queue: 'none' (no photo),
-- 'pending', 'approved', 'rejected', or 'missing' (not in the queue at all).
-- The queue's table is looked up by name so this file still installs in a
-- project that has not run db/photos.sql; then every photo is 'missing'.
create or replace function public.nn_photo_state(p_path text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  if p_path is null then return 'none'; end if;
  if to_regclass('public.btb_photos') is null then return 'missing'; end if;
  execute 'select status from public.btb_photos where storage_path = $1' into s using p_path;
  if s is null then return 'missing'; end if;
  return case s when 'approved' then 'approved' when 'pending' then 'pending' else 'rejected' end;
end $$;

-- May a board post take this photo? Only a photo that came from an All Day
-- board (photos-lib.js files it with spot "All Day · <board>"), is still
-- waiting in the queue, and arrived in the last day. A photo the queue has
-- already approved is public, path and all (btb_photos_get lists it), so it
-- can never be claimed: a pending path is a random id only its uploader
-- has seen, which is what ties the photo to the reader posting it.
create or replace function public.nn_photo_claimable(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ok boolean;
begin
  if p_path is null or to_regclass('public.btb_photos') is null then return false; end if;
  execute 'select exists (select 1 from public.btb_photos where storage_path = $1 and status = ''pending''
             and spot like ''All Day · %'' and created_at > now() - interval ''1 day'')' into ok using p_path;
  return coalesce(ok, false);
end $$;

-- A reader's own board photo leaves the public gallery with the post it was
-- for. Only ever a photo a board filed (see nn_photo_claimable).
create or replace function public.nn_photo_remove(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_path is null or to_regclass('public.btb_photos') is null then return; end if;
  execute 'update public.btb_photos set status = ''removed'', decided_at = now()
            where storage_path = $1 and status <> ''removed'' and spot like ''All Day · %''' using p_path;
end $$;

-- Who is voting: the signed-in reader as u:<id>, or the device's
-- btown-player-id, or nobody (null) when the id is malformed.
create or replace function public.nn_voter(p_uid uuid, p_player text) returns text
language sql immutable as $$
  select case when p_uid is not null then 'u:' || p_uid::text
              when coalesce(p_player, '') ~ '^[A-Za-z0-9_-]{6,64}$' then p_player
              else null end
$$;

-- Can everyone see this post right now? Approved, not expired, and, when
-- its kind needs a photo, with that photo approved by the photo queue.
create or replace function public.nn_listable(p public.nn_posts) returns boolean
language sql stable security definer set search_path = public as $$
  select p.status = 'approved'
     and (p.expires_at is null or p.expires_at > now())
     and (not p.photo_req or public.nn_photo_state(p.photo_path) = 'approved')
$$;

-- One post as the app draws it. The author is a first name and nothing else:
-- no account id, never an email. `mine` says whether the caller wrote it.
create or replace function public.nn_post_json(p public.nn_posts, p_voter text, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'board', p.board, 'kind', p.kind, 'title', p.title, 'body', p.body, 'place', p.place, 'meta', p.meta,
    'photo', case when public.nn_photo_state(p.photo_path) = 'approved' then p.photo_path end,
    'author', coalesce(pr.display_name, 'A neighbor'), 'author_arch', pr.archetype,
    'created_at', p.created_at, 'expires_at', p.expires_at,
    'votes', (select count(*) from public.nn_votes v where v.post_id = p.id),
    'voted', p_voter is not null and exists (select 1 from public.nn_votes v where v.post_id = p.id and v.voter = p_voter),
    'mine', p_uid is not null and p.user_id = p_uid)
  from (select 1) one left join public.nn_profiles pr on pr.user_id = p.user_id
$$;

-- The opportunistic sweep: posts a week past their end, and posts Stephen
-- deleted more than 30 days ago, go for good (their votes and reports go
-- with them). Called when someone posts and when the mod page opens.
create or replace function public.nn_sweep() returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb := public.nn_rules() -> 'limits';
begin
  delete from public.nn_posts
   where (expires_at is not null and expires_at < now() - make_interval(days => (r ->> 'expiredKeepDays')::int))
      or (status = 'deleted' and coalesce(decided_at, created_at) < now() - make_interval(days => (r ->> 'deletedKeepDays')::int));
end $$;

-- Check a post's meta against its board's fields. Returns the cleaned meta,
-- or raises bad_meta / needs_meta (boards-core.js checkMeta, line for line).
create or replace function public.nn_check_meta(p_board text, p_kind text, p_meta jsonb) returns jsonb
language plpgsql stable as $$
declare
  rules jsonb := public.nn_rules();
  v_schema jsonb := rules -> 'boards' -> p_board -> 'meta';
  needs jsonb := rules -> 'boards' -> p_board -> 'kinds' -> p_kind -> 'needs';
  m jsonb := coalesce(p_meta, '{}'::jsonb);
  v_out jsonb := '{}'::jsonb;
  k text; v jsonb; f jsonb; t text; n numeric;
begin
  if jsonb_typeof(m) = 'null' then m := '{}'::jsonb; end if;
  if jsonb_typeof(m) <> 'object' then raise exception 'bad_meta'; end if;
  if (select count(*) from jsonb_object_keys(m)) > (rules -> 'limits' ->> 'metaKeysMax')::int then raise exception 'bad_meta'; end if;
  for k, v in select key, value from jsonb_each(m) loop
    f := v_schema -> k;
    if f is null then raise exception 'bad_meta'; end if;
    if jsonb_typeof(v) = 'null' or v = '""'::jsonb then continue; end if;
    if f ->> 'type' = 'text' then
      if jsonb_typeof(v) <> 'string' then raise exception 'bad_meta'; end if;
      t := public.nn_clean(v #>> '{}', false);
      if char_length(t) > coalesce((f ->> 'max')::int, (rules -> 'limits' ->> 'metaTextMax')::int) then raise exception 'bad_meta'; end if;
      if t <> '' then v_out := v_out || jsonb_build_object(k, t); end if;
    elsif f ->> 'type' = 'int' then
      if jsonb_typeof(v) <> 'number' then raise exception 'bad_meta'; end if;
      n := (v #>> '{}')::numeric;
      if n <> trunc(n) or n < (f ->> 'min')::numeric or n > (f ->> 'max')::numeric then raise exception 'bad_meta'; end if;
      v_out := v_out || jsonb_build_object(k, n::int);
    elsif f ->> 'type' = 'enum' then
      if jsonb_typeof(v) <> 'string' or not ((f -> 'values') ? (v #>> '{}')) then raise exception 'bad_meta'; end if;
      v_out := v_out || jsonb_build_object(k, v);
    else
      raise exception 'bad_meta';
    end if;
  end loop;
  for k in select jsonb_array_elements_text(coalesce(needs, '[]'::jsonb)) loop
    if not v_out ? k then raise exception 'needs_meta'; end if;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- profiles

-- Your profile, or null when you have not made one. Signed-in only.
create or replace function public.nn_profile_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return (select jsonb_build_object('display_name', display_name, 'neighborhood', neighborhood, 'archetype', archetype)
            from public.nn_profiles where user_id = u);
end $$;

-- Make or change your profile. A first name is required (it is what
-- neighbors see on your posts); neighborhood and archetype are optional,
-- and an empty one means none. You can only ever edit your own.
create or replace function public.nn_profile_set(p_display_name text, p_neighborhood text default null, p_archetype text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  rules jsonb := public.nn_rules();
  v_name text := public.nn_clean(p_display_name, false);
  hood text := nullif(p_neighborhood, '');
  arch text := nullif(p_archetype, '');
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if v_name = '' or char_length(v_name) > (rules -> 'limits' ->> 'nameMax')::int or position('@' in v_name) > 0 then raise exception 'bad_name'; end if;
  if hood is not null and not ((rules -> 'neighborhoods') ? hood) then raise exception 'bad_neighborhood'; end if;
  if arch is not null and not ((rules -> 'archetypes') ? arch) then raise exception 'bad_archetype'; end if;
  insert into public.nn_profiles (user_id, display_name, neighborhood, archetype)
  values (u, v_name, hood, arch)
  on conflict (user_id) do update set display_name = excluded.display_name, neighborhood = excluded.neighborhood,
    archetype = excluded.archetype, updated_at = now();
  return jsonb_build_object('display_name', v_name, 'neighborhood', hood, 'archetype', arch);
end $$;

-- ------------------------------------------------------------------ posting

-- Post to a board. Signed-in readers with a first name only. Checks, in
-- this order (boards-core.js checkPost is the same order): banned, a name,
-- the board, the kind, title, body, place, the kind's fields, the photo,
-- then the limits (20 posts in 24 hours; 5 waiting for a look), counted
-- after old posts are swept, so an ended one never counts. A post
-- starts approved unless its board pre-moderates. Its end date comes from
-- its kind (21 days for a Vintage find; never for an Art piece). A photo
-- must be one this reader just put in the photo queue from a board
-- (nn_photo_claimable), and shows only once that queue approves it.
create or replace function public.nn_post_create(
  p_board text, p_kind text, p_title text, p_body text default '', p_place text default '',
  p_meta jsonb default '{}'::jsonb, p_photo text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  rules jsonb := public.nn_rules();
  b jsonb := rules -> 'boards' -> p_board;
  kr jsonb;
  t text := public.nn_clean(p_title, false);
  bd text := public.nn_clean(p_body, true);
  pl text := public.nn_clean(p_place, false);
  m jsonb;
  photo text := nullif(p_photo, '');
  today int; waiting int;
  rec public.nn_posts;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  -- one post at a time per reader, so parallel calls cannot all count
  -- under the limits before any of them inserts
  perform pg_advisory_xact_lock(hashtext('nn_post:' || u::text));
  if exists (select 1 from public.nn_bans where user_id = u) then raise exception 'banned'; end if;
  if not exists (select 1 from public.nn_profiles where user_id = u) then raise exception 'no_name'; end if;
  if b is null then raise exception 'bad_board'; end if;
  kr := b -> 'kinds' -> p_kind;
  if kr is null then raise exception 'bad_kind'; end if;
  if t = '' or char_length(t) > (rules -> 'limits' ->> 'titleMax')::int then raise exception 'bad_title'; end if;
  if char_length(bd) > (rules -> 'limits' ->> 'bodyMax')::int then raise exception 'bad_body'; end if;
  if char_length(pl) > (rules -> 'limits' ->> 'placeMax')::int then raise exception 'bad_place'; end if;
  m := public.nn_check_meta(p_board, p_kind, p_meta);
  if photo is not null and kr ->> 'photo' = 'none' then raise exception 'photo_not_allowed'; end if;
  if photo is null and kr ->> 'photo' = 'required' then raise exception 'photo_required'; end if;
  if photo is not null and photo !~ '^submissions/[A-Za-z0-9-]+\.jpg$' then raise exception 'bad_photo'; end if;
  -- one claim per photo at a time; nn_photo_abandon takes the same lock
  if photo is not null then perform pg_advisory_xact_lock(hashtext('nn_photo:' || photo)); end if;
  if photo is not null and (not public.nn_photo_claimable(photo)
                            or exists (select 1 from public.nn_posts where photo_path = photo)) then raise exception 'bad_photo'; end if;
  perform public.nn_sweep();
  select count(*) into today from public.nn_posts where user_id = u and created_at > now() - interval '24 hours';
  select count(*) into waiting from public.nn_posts p
   where p.user_id = u and (p.status = 'pending' or (p.photo_path is not null and public.nn_photo_state(p.photo_path) = 'pending'));
  if today >= (rules -> 'limits' ->> 'postsPerDay')::int then raise exception 'rate_day'; end if;
  if waiting >= (rules -> 'limits' ->> 'waitingMax')::int then raise exception 'rate_waiting'; end if;
  insert into public.nn_posts (board, user_id, kind, title, body, photo_path, photo_req, meta, place, expires_at, status)
  values (p_board, u, p_kind, t, bd, photo, kr ->> 'photo' = 'required', m, pl,
          case when kr ->> 'days' is not null then now() + make_interval(days => (kr ->> 'days')::int) end,
          case when (b ->> 'premod')::boolean then 'pending' else 'approved' end)
  returning * into rec;
  return public.nn_post_json(rec, 'u:' || u::text, u) || jsonb_build_object('status', rec.status);
end $$;

-- A board's posts, newest first (or most-voted first with p_sort 'top'),
-- only the ones everyone may see: approved, not ended, photo approved where
-- the kind needs one. p_before pages back by time. p_filter narrows by kind
-- and by the tab's fields: {"kind":"spotted","meta":{"size":"M"}}. Pass the
-- device's player id so `voted` is right for a signed-out reader.
create or replace function public.nn_posts_list(
  p_board text, p_limit int default 30, p_before timestamptz default null, p_filter jsonb default '{}'::jsonb,
  p_player text default null, p_sort text default 'new'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  rules jsonb := public.nn_rules();
  u uuid := auth.uid();
  v_voter text := public.nn_voter(u, p_player);
  lim int := least(greatest(coalesce(p_limit, (rules -> 'limits' ->> 'listDefault')::int), 1), (rules -> 'limits' ->> 'listMax')::int);
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_out jsonb;
begin
  if rules -> 'boards' -> p_board is null then raise exception 'bad_board'; end if;
  if jsonb_typeof(f) <> 'object' then f := '{}'::jsonb; end if;
  select coalesce(jsonb_agg(public.nn_post_json(x.p, v_voter, u) order by x.ord1 desc, x.created_at desc), '[]'::jsonb) into v_out
  from (
    select p, p.created_at, case when p_sort = 'top' then (select count(*) from public.nn_votes v where v.post_id = p.id) else 0 end as ord1
      from public.nn_posts p
     where p.board = p_board
       and public.nn_listable(p)
       and (f ->> 'kind' is null or p.kind = f ->> 'kind')
       and (jsonb_typeof(f -> 'meta') is distinct from 'object' or p.meta @> (f -> 'meta'))
       and (p_before is null or p_sort = 'top' or p.created_at < p_before)
     order by ord1 desc, p.created_at desc
     limit lim
  ) x;
  return v_out;
end $$;

-- Everything you have posted that has not been deleted, newest first, with
-- where each stands: status (approved, pending, hidden), the photo's state
-- in the photo queue, and whether it has ended. For "Your posts".
create or replace function public.nn_post_mine() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return (select coalesce(jsonb_agg(public.nn_post_json(p, 'u:' || u::text, u) || jsonb_build_object(
            'status', p.status, 'photo_state', public.nn_photo_state(p.photo_path),
            'photo_path', p.photo_path, 'ended', p.expires_at is not null and p.expires_at <= now())
          order by p.created_at desc), '[]'::jsonb)
            from public.nn_posts p where p.user_id = u and p.status <> 'deleted');
end $$;

-- Delete one of your own posts, for good, with its votes and reports. Its
-- photo leaves the public gallery too.
create or replace function public.nn_post_delete_own(p_post uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_path text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  delete from public.nn_posts where id = p_post and user_id = u returning photo_path into v_path;
  if not found then raise exception 'not_found'; end if;
  perform public.nn_photo_remove(v_path);
  return jsonb_build_object('deleted', true);
end $$;

-- A board photo whose post never happened (refused, offline, the reader
-- gave up) leaves the photo queue, so it can never be approved into the
-- gallery by mistake. Same capability as claiming it: only a recent,
-- waiting, board-filed photo no post has taken.
create or replace function public.nn_photo_abandon(p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_path is null then return jsonb_build_object('removed', false); end if;
  perform pg_advisory_xact_lock(hashtext('nn_photo:' || p_path));   -- waits out a post claiming it right now
  if public.nn_photo_claimable(p_path) and not exists (select 1 from public.nn_posts where photo_path = p_path) then
    perform public.nn_photo_remove(p_path);
    return jsonb_build_object('removed', true);
  end if;
  return jsonb_build_object('removed', false);
end $$;

-- ------------------------------------------------------------------- votes

-- Vote for a post anyone can see. Signed in, the vote is your account's;
-- signed out, it is this device's player id. Once per voter per post;
-- voting twice is not an error, it just stays one vote. Returns the count.
create or replace function public.nn_vote(p_post uuid, p_player text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_voter text := public.nn_voter(auth.uid(), p_player); p public.nn_posts;
begin
  if v_voter is null then raise exception 'bad_voter'; end if;
  select * into p from public.nn_posts where id = p_post;
  if not found or not public.nn_listable(p) then raise exception 'not_found'; end if;
  insert into public.nn_votes (post_id, voter) values (p_post, v_voter) on conflict do nothing;
  return jsonb_build_object('votes', (select count(*) from public.nn_votes where post_id = p_post), 'voted', true);
end $$;

-- Take your vote back. Not having voted is not an error.
create or replace function public.nn_unvote(p_post uuid, p_player text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_voter text := public.nn_voter(auth.uid(), p_player); p public.nn_posts;
begin
  if v_voter is null then raise exception 'bad_voter'; end if;
  select * into p from public.nn_posts where id = p_post;
  if not found or not public.nn_listable(p) then raise exception 'not_found'; end if;
  delete from public.nn_votes v where v.post_id = p_post and v.voter = v_voter;
  return jsonb_build_object('votes', (select count(*) from public.nn_votes where post_id = p_post), 'voted', false);
end $$;

-- ----------------------------------------------------------------- reports

-- Report a post. Signed-in readers only, once per post, not your own, at
-- most 10 a day. The second report since Stephen last cleared it takes the
-- post down (status 'pending') until he approves or removes it.
create or replace function public.nn_report(p_post uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); rules jsonb := public.nn_rules(); p public.nn_posts; n int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtext('nn_report:' || u::text));   -- the daily limit holds under parallel calls
  if exists (select 1 from public.nn_bans where user_id = u) then raise exception 'banned'; end if;
  if not ((rules -> 'reasons') ? coalesce(p_reason, '')) then raise exception 'bad_reason'; end if;
  select * into p from public.nn_posts where id = p_post;
  if not found or not public.nn_listable(p) then raise exception 'not_found'; end if;
  if p.user_id = u then raise exception 'own_post'; end if;
  if exists (select 1 from public.nn_reports where post_id = p_post and reporter = u) then raise exception 'already_reported'; end if;
  if (select count(*) from public.nn_reports where reporter = u and created_at > now() - interval '24 hours')
     >= (rules -> 'limits' ->> 'reportsPerDay')::int then raise exception 'rate_reports'; end if;
  insert into public.nn_reports (post_id, reporter, reason) values (p_post, u, p_reason);
  update public.nn_posts set reports = reports + 1 where id = p_post returning reports into n;
  if n >= (rules -> 'limits' ->> 'reportsToHide')::int then
    update public.nn_posts set status = 'pending' where id = p_post;
  end if;
  return jsonb_build_object('hidden', n >= (rules -> 'limits' ->> 'reportsToHide')::int);
end $$;

-- ----------------------------------------------------------- your account

-- "Delete my account and posts": your posts (with their votes and reports),
-- the votes and reports you made, your missions and your profile, all gone.
-- Board photos you posted leave the public gallery. Your email sign-in
-- itself is NOT deleted, because it is the fleet's shared sign-in (Small
-- Talk and others use the same one); Stephen can remove it on request.
create or replace function public.nn_delete_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_path text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  for v_path in select photo_path from public.nn_posts where user_id = u and photo_path is not null loop
    perform public.nn_photo_remove(v_path);
  end loop;
  delete from public.nn_posts where user_id = u;
  delete from public.nn_votes where voter = 'u:' || u::text;
  -- their reports stop counting: each post they reported is recounted from
  -- the reports that remain since Stephen last cleared it
  delete from public.nn_reports where reporter = u;
  update public.nn_posts p set reports = (select count(*) from public.nn_reports r
     where r.post_id = p.id and (p.cleared_at is null or r.created_at > p.cleared_at))
   where p.reports > 0;
  delete from public.nn_mission_done where user_id = u;
  delete from public.nn_profiles where user_id = u;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------- missions
-- What Now's "Mark done", synced for a signed-in reader (from PR #277).

create or replace function public.nn_mission_set(p_key text, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_done then
    insert into nn_mission_done (user_id, key) values (auth.uid(), p_key) on conflict do nothing;
  else
    delete from nn_mission_done where user_id = auth.uid() and key = p_key;
  end if;
end $$;

create or replace function public.nn_missions_done()
returns table (key text) language sql security definer set search_path = public as $$
  select key from nn_mission_done where user_id = auth.uid()
$$;

-- -------------------------------------------------------------- moderation
-- Stephen's back room (all-day/mod.html). The passphrase never enters the
-- repo: only its bcrypt hash sits in nn_mod, put there by the one line in
-- SETUP-STEPHEN.md part C. Wrong guesses are counted; 20 in 15 minutes
-- shuts the gate for everyone until they age out. The nn_mod_* functions
-- RETURN {"error":"bad_secret"} instead of raising, so the counted guess is
-- not rolled back with the error (the fleet's pattern, from whos-playing).

create or replace function public.nn_mod_ok(p_secret text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text; good boolean;
begin
  select pass_hash into h from public.nn_mod where id;
  if coalesce(p_secret, '') = '' or h is null or h not like '$2%' then return false; end if;
  delete from public.nn_mod_fails where at < now() - interval '15 minutes';
  if (select count(*) from public.nn_mod_fails) >= 20 then return false; end if;
  good := extensions.crypt(p_secret, h) = h;
  if not good then insert into public.nn_mod_fails default values; end if;
  return good;
end $$;

-- What needs a look: reported posts, posts waiting (pre-moderated boards,
-- or taken down by two reports), hidden ones, the 50 newest live ones, and
-- the ban list. Authors appear by first name and account id, never email.
create or replace function public.nn_mod_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare one jsonb;
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  perform public.nn_sweep();
  return jsonb_build_object(
    'waiting', (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
       select p.created_at, public.nn_post_json(p, null, null) || jsonb_build_object('status', p.status, 'reports', p.reports, 'user_id', p.user_id,
         'photo_path', p.photo_path, 'photo_state', public.nn_photo_state(p.photo_path),
         'reasons', (select coalesce(jsonb_agg(r.reason), '[]'::jsonb) from public.nn_reports r where r.post_id = p.id)) j
         from public.nn_posts p where p.status = 'pending') x),
    'reported', (select coalesce(jsonb_agg(x.j order by x.reports desc, x.created_at desc), '[]'::jsonb) from (
       select p.created_at, p.reports, public.nn_post_json(p, null, null) || jsonb_build_object('status', p.status, 'reports', p.reports, 'user_id', p.user_id,
         'photo_path', p.photo_path, 'photo_state', public.nn_photo_state(p.photo_path),
         'reasons', (select coalesce(jsonb_agg(r.reason), '[]'::jsonb) from public.nn_reports r where r.post_id = p.id)) j
         from public.nn_posts p where p.status = 'approved' and p.reports > 0) x),
    'hidden', (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
       select p.created_at, public.nn_post_json(p, null, null) || jsonb_build_object('status', p.status, 'user_id', p.user_id) j
         from public.nn_posts p where p.status = 'hidden' order by p.created_at desc limit 50) x),
    'recent', (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
       select p.created_at, public.nn_post_json(p, null, null) || jsonb_build_object('status', p.status, 'reports', p.reports, 'user_id', p.user_id,
         'photo_path', p.photo_path, 'photo_state', public.nn_photo_state(p.photo_path)) j
         from public.nn_posts p where p.status = 'approved' order by p.created_at desc limit 50) x),
    'bans', (select coalesce(jsonb_agg(jsonb_build_object('user_id', b.user_id, 'created_at', b.created_at,
         'name', (select display_name from public.nn_profiles where user_id = b.user_id)) order by b.created_at desc), '[]'::jsonb)
         from public.nn_bans b));
end $$;

-- Act on one post: 'approve' (it shows again; its report count resets),
-- 'hide' (off the boards, kept), 'delete' (off for good after 30 days), or
-- 'ban' (its author can no longer post or report, and every post of theirs
-- is hidden).
create or replace function public.nn_mod_act(p_secret text, p_post uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  select user_id into who from public.nn_posts where id = p_post;
  if who is null then return jsonb_build_object('error', 'not_found'); end if;
  if p_action = 'approve' then
    update public.nn_posts set status = 'approved', reports = 0, decided_at = now(), cleared_at = now() where id = p_post;
  elsif p_action = 'hide' then
    update public.nn_posts set status = 'hidden', decided_at = now() where id = p_post;
  elsif p_action = 'delete' then
    update public.nn_posts set status = 'deleted', decided_at = now() where id = p_post;
  elsif p_action = 'ban' then
    insert into public.nn_bans (user_id) values (who) on conflict do nothing;
    update public.nn_posts set status = 'hidden', decided_at = now() where user_id = who and status in ('approved', 'pending');
  else
    return jsonb_build_object('error', 'bad_action');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Lift a ban. Their hidden posts stay hidden; approve the ones that were fine.
create or replace function public.nn_mod_unban(p_secret text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  delete from public.nn_bans where user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------ grants
-- Postgres lets everyone run a new function, and Supabase also grants new
-- functions to anon and authenticated by default; take that back first,
-- then hand out exactly the doors the app uses.
revoke all on function
  public.nn_rules(), public.nn_clean(text, boolean), public.nn_photo_state(text), public.nn_photo_remove(text),
  public.nn_photo_claimable(text), public.nn_photo_abandon(text),
  public.nn_voter(uuid, text), public.nn_listable(public.nn_posts), public.nn_post_json(public.nn_posts, text, uuid),
  public.nn_sweep(), public.nn_check_meta(text, text, jsonb),
  public.nn_profile_get(), public.nn_profile_set(text, text, text),
  public.nn_post_create(text, text, text, text, text, jsonb, text),
  public.nn_posts_list(text, int, timestamptz, jsonb, text, text), public.nn_post_mine(), public.nn_post_delete_own(uuid),
  public.nn_vote(uuid, text), public.nn_unvote(uuid, text), public.nn_report(uuid, text), public.nn_delete_me(),
  public.nn_mission_set(text, boolean), public.nn_missions_done(),
  public.nn_mod_ok(text), public.nn_mod_list(text), public.nn_mod_act(text, uuid, text), public.nn_mod_unban(text, uuid)
from public, anon, authenticated;

-- Readers, signed in or not (the signed-in-only ones refuse with
-- not_signed_in themselves, so the app hears one clear answer).
grant execute on function
  public.nn_rules(), public.nn_profile_get(), public.nn_profile_set(text, text, text),
  public.nn_post_create(text, text, text, text, text, jsonb, text),
  public.nn_posts_list(text, int, timestamptz, jsonb, text, text), public.nn_post_mine(), public.nn_post_delete_own(uuid),
  public.nn_photo_abandon(text),
  public.nn_vote(uuid, text), public.nn_unvote(uuid, text), public.nn_report(uuid, text), public.nn_delete_me(),
  public.nn_mod_list(text), public.nn_mod_act(text, uuid, text), public.nn_mod_unban(text, uuid)
to anon, authenticated;

-- What Now's two, signed-in readers only, as PR #277 set them.
grant execute on function public.nn_mission_set(text, boolean), public.nn_missions_done() to authenticated;
