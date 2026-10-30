-- ============================================================================
-- ALL DAY — accounts and boards, round four (the New Nine). One paste.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   nn_
-- Written:  2026-10-17
-- Needs:    all-day/supabase/nn-SETUP.sql, nn-ROUND2.sql and nn-ROUND3.sql
--           pasted first. nn-people.sql, nn-watch.sql and the photo queue
--           (db/photos.sql) are used when they are there and skipped when
--           they are not.
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: it only
-- adds two columns and an index, and adds or replaces functions. It
-- deletes no table, no column and no row. SETUP-STEPHEN.md part F has the
-- steps.
--
-- If nn-SETUP.sql is ever pasted again, paste nn-ROUND2.sql, nn-ROUND3.sql
-- and then this file right after it: each older file puts back older rules.
-- If nn-ROUND2.sql alone is pasted again, paste this file after it.
--
-- What it adds, in plain words:
--   The rules (nn_rules, now version 3) gain three boards, taking nothing
--   away:
--     Games       "what I'm playing" (a game and a platform; 14 days) and
--                 "looking for a group" (the game, the platform and when;
--                 7 days). A vote on either means "me too".
--     The Square  the community square: a post (30 days), show and tell
--                 (photo needed, 30 days), a question (14 days), something
--                 free to a good home (14 days) and pets (photo needed,
--                 30 days), each with an optional topic.
--     Gatherings  events readers send in: when, where, what sort (pickup,
--                 league, board games, a run, social, music, other) and an
--                 optional link. Every one waits for Stephen on the boards
--                 desk before it shows. It ends the day after its date when
--                 `when` starts with one (2026-10-24, 7 pm), else after 30
--                 days, and its date must be from today to six months out.
--   (2026-10-19) Playlists  readers' playlists for On Air, a link each,
--                 waiting for Stephen like a gathering. Pasted on its own
--                 as nn-PLAYLISTS.sql; this file's rules carry it too.
--   Handles     a reader's name on Instagram, Spotify, Strava, Letterboxd,
--               Goodreads, Beli, Untappd, PlayStation, Xbox, Steam, Switch,
--               Discord, Epic, Riot, chess.com/lichess and LinkedIn, each
--               checked against its own pattern (never a link, never an @),
--               plus a "show my handles" switch. Kept on the profile, so
--               "Delete my account" already takes them.
--   nn_profile_set   a third version that also takes the handles and the
--                    switch. The two older versions are untouched.
--   nn_handles_recent  for signed-in readers, the most recently updated
--                    profiles with handles of the kinds asked for: first
--                    name, neighborhood, those handles and the day. Only
--                    readers who turned the switch on. Never an email,
--                    never an account id.
--   nn_post_create, nn_post_meta_set  the same calls, now ending a
--                    gathering by its date, and refusing a date in the past.
--
-- Security model, unchanged: RLS on, no table policies, every door a
-- security-definer function, grants revoked then granted. Links in reader
-- posts are still stripped everywhere, except a gathering's own link field,
-- which only Stephen-approved posts carry.
-- ============================================================================

-- ---------------------------------------------------------------- the rules
-- The same JSON as RULES in all-day/js/boards-core.js; this copy replaces
-- the ones nn-SETUP.sql and nn-ROUND2.sql installed.
-- scripts/test-boards-core.mjs fails when the two differ, or when a board,
-- kind or field from either older copy is missing.
create or replace function public.nn_rules() returns jsonb
language sql immutable as $rules$ select $json${"version":3,"limits":{"nameMax":32,"titleMax":80,"bodyMax":600,"placeMax":80,"metaKeysMax":8,"metaTextMax":80,"postsPerDay":20,"waitingMax":5,"reportsToHide":2,"reportsPerDay":10,"interestsMax":8,"weeksMax":26,"listDefault":30,"listMax":60,"expiredKeepDays":7,"deletedKeepDays":30,"handleMax":40,"aheadMaxDays":180},"neighborhoods":["downtown","old-north-end","new-north-end","south-end","hill","waterfront","winooski","south-burlington","essex","shelburne","colchester","elsewhere"],"archetypes":["new","regular","trail","games"],"reasons":["spam","unkind","unsafe","other"],"interests":["sports","running","outdoors","games","music","dance","books","making","languages","food"],"handles":{"instagram":"^[A-Za-z0-9._]{1,30}$","spotify":"^[A-Za-z0-9._-]{1,40}$","strava":"^[A-Za-z0-9_-]{1,40}$","letterboxd":"^[A-Za-z0-9_]{2,15}$","goodreads":"^[A-Za-z0-9_-]{1,40}$","beli":"^[A-Za-z0-9._]{1,30}$","untappd":"^[A-Za-z0-9._-]{1,40}$","psn":"^[A-Za-z][A-Za-z0-9_-]{2,15}$","xbox":"^[A-Za-z][A-Za-z0-9 ]{0,14}(#[0-9]{1,4})?$","steam":"^[A-Za-z0-9_-]{2,32}$","switch":"^SW-[0-9]{4}-[0-9]{4}-[0-9]{4}$","discord":"^[A-Za-z0-9_.]{2,32}$","epic":"^[A-Za-z0-9._ -]{3,16}$","riot":"^[A-Za-z0-9 ._]{3,16}#[A-Za-z0-9]{3,5}$","chess":"^[A-Za-z0-9_-]{2,25}$","linkedin":"^[A-Za-z0-9-]{3,40}$"},"handlesDeny":"^www[.]|[.](com|net|org|io|gg|tv|ly|xyz|dev|app|info|biz|site|online|link|page)$","urlPattern":"^https?://[A-Za-z0-9.-]+[.][A-Za-z]{2,}(:[0-9]{1,5})?([/?#][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$","boards":{"people":{"premod":false,"gallery":false,"kinds":{"plan":{"days":14,"photo":"none","needs":["when"]}},"meta":{"when":{"type":"text","max":60},"arch":{"type":"enum","values":["new","regular","trail","games"]},"spots":{"type":"int","min":1,"max":50},"meetup":{"type":"bool"},"ages":{"type":"enum","values":["twenties","thirties","forties","fifties","any"]}}},"vintage":{"premod":false,"gallery":false,"kinds":{"spotted":{"days":21,"photo":"optional","needs":["shop"]},"swap":{"days":21,"photo":"optional","needs":["want"]},"design":{"days":null,"photo":"required","needs":["thanks"]},"fit":{"days":60,"photo":"required","needs":[]}},"meta":{"shop":{"type":"text","max":60},"size":{"type":"text","max":12},"price":{"type":"int","min":0,"max":10000},"want":{"type":"text","max":80},"thanks":{"type":"enum","values":["shirts","credit"]},"got":{"type":"bool"}}},"art":{"premod":false,"gallery":true,"kinds":{"photo":{"days":null,"photo":"required","needs":[]},"art":{"days":null,"photo":"required","needs":[]},"notice":{"days":30,"photo":"none","needs":[]}},"meta":{"medium":{"type":"text","max":40},"shirt":{"type":"enum","values":["yes","no"]}}},"watch":{"premod":false,"gallery":false,"kinds":{"rating":{"days":null,"photo":"none","needs":["stars"]},"pick":{"days":30,"photo":"none","needs":[],"one_vote":true}},"meta":{"year":{"type":"int","min":1888,"max":2100},"stars":{"type":"int","min":1,"max":5},"where":{"type":"text","max":40},"film":{"type":"int","min":1,"max":99999999}}},"games":{"premod":false,"gallery":false,"kinds":{"playing":{"days":14,"photo":"none","needs":["game","platform"]},"lfg":{"days":7,"photo":"none","needs":["game","platform","when"]}},"meta":{"game":{"type":"text","max":60},"platform":{"type":"enum","values":["pc","ps5","xbox","switch","mobile","vr","board","tabletop"]},"when":{"type":"text","max":60}}},"square":{"premod":false,"gallery":false,"kinds":{"post":{"days":30,"photo":"none","needs":[]},"show":{"days":30,"photo":"required","needs":[]},"ask":{"days":14,"photo":"none","needs":[]},"free":{"days":14,"photo":"optional","needs":[]},"pets":{"days":30,"photo":"required","needs":[]}},"meta":{"topic":{"type":"enum","values":["food","outdoors","pets","events","home","lost-found","recommend","other"]}}},"gatherings":{"premod":true,"gallery":false,"kinds":{"gathering":{"days":30,"photo":"optional","needs":["when","place","kind"],"until":"when"}},"meta":{"when":{"type":"text","max":60},"place":{"type":"text","max":80},"link":{"type":"url","max":200},"kind":{"type":"enum","values":["pickup","league","board-games","run","social","music","other"]}}},"playlists":{"premod":true,"gallery":false,"kinds":{"playlist":{"days":null,"photo":"none","needs":["link"]}},"meta":{"link":{"type":"url","max":200}}},"nightlife":{"premod":false,"gallery":false,"kinds":{"open_tonight":{"days":1,"photo":"none","needs":["where","until"]}},"meta":{"where":{"type":"text","max":60},"until":{"type":"text","max":20},"spots":{"type":"int","min":1,"max":20},"ages":{"type":"enum","values":["twenties","thirties","forties","fifties","any"]}}},"sports":{"premod":false,"gallery":false,"kinds":{"session":{"days":2,"photo":"none","needs":["sport","where","when"]}},"meta":{"sport":{"type":"enum","values":["basketball","soccer","volleyball","tennis","pickleball","frisbee","hockey","run","ride","climb","workout","yoga","recovery","other"]},"where":{"type":"text","max":60},"when":{"type":"text","max":60},"spots":{"type":"int","min":1,"max":30},"level":{"type":"enum","values":["easy","any","competitive"]}}},"stage":{"premod":false,"gallery":false,"kinds":{"logged":{"days":null,"photo":"optional","needs":["venue","date"]}},"meta":{"venue":{"type":"text","max":60},"date":{"type":"text","max":20},"what":{"type":"enum","values":["show","play","comedy","film","talk","game","other"]},"stars":{"type":"int","min":1,"max":5}}},"neighbors":{"premod":false,"gallery":false,"kinds":{"borrow":{"days":14,"photo":"none","needs":["item"]},"free":{"days":14,"photo":"optional","needs":[]},"favor":{"days":7,"photo":"none","needs":[]},"lost":{"days":30,"photo":"optional","needs":["what","seen"]},"found":{"days":30,"photo":"optional","needs":["what","seen"]}},"meta":{"item":{"type":"text","max":60},"what":{"type":"enum","values":["pet","keys","phone","wallet","bike","bag","other"]},"seen":{"type":"text","max":60},"when":{"type":"text","max":60},"got":{"type":"bool"}}},"shifts":{"premod":true,"gallery":false,"kinds":{"shift":{"days":30,"photo":"none","needs":["org","when","hours"],"until":"when"}},"meta":{"org":{"type":"text","max":60},"when":{"type":"text","max":60},"hours":{"type":"int","min":1,"max":8},"slots":{"type":"int","min":1,"max":50},"link":{"type":"url","max":200}}},"clubs":{"premod":false,"gallery":false,"kinds":{"idea":{"days":60,"photo":"none","needs":["kind"]}},"meta":{"kind":{"type":"enum","values":["sport","outdoors","music","books","food","games","making","social","learning","other"]},"days":{"type":"text","max":40},"size":{"type":"int","min":2,"max":50}}},"streets":{"premod":true,"gallery":false,"kinds":{"report":{"days":90,"photo":"optional","needs":["what","where"]}},"meta":{"what":{"type":"enum","values":["pothole","streetlight","sidewalk","crosswalk","sign","graffiti","trash","tree","other"]},"where":{"type":"text","max":80},"fixed":{"type":"bool"}}},"rescue":{"premod":false,"gallery":false,"kinds":{"rescue":{"days":1,"photo":"optional","needs":["spot","until"]}},"meta":{"spot":{"type":"text","max":60},"until":{"type":"text","max":20},"price":{"type":"int","min":0,"max":100},"portions":{"type":"int","min":1,"max":100}}}}}$json$::jsonb $rules$;

-- ------------------------------------------------------------------ tables

-- a reader's handles, {"strava": "maya_runs"}; only nn_check_handles' output
-- is ever written here
alter table public.nn_profiles add column if not exists handles jsonb not null default '{}'::jsonb;
-- "show my handles": on, anyone may see them through nn_handles_recent
alter table public.nn_profiles add column if not exists handles_public boolean not null default false;
create index if not exists nn_profiles_updated_idx on public.nn_profiles (updated_at desc);

-- ----------------------------------------------------------------- helpers

-- Check a profile's handles (boards-core.js checkHandles, line for line):
-- an object whose keys are handle kinds from the rules, each a string that,
-- trimmed of spaces at either end, is 1 to handleMax characters, matches
-- its kind's pattern and is not plainly a web address (handlesDeny, any
-- case). A null or empty value drops that kind. Returns the cleaned
-- handles, or raises bad_handle.
create or replace function public.nn_check_handles(p_handles jsonb) returns jsonb
language plpgsql stable as $$
declare
  rules jsonb := public.nn_rules();
  h jsonb := p_handles;
  v_out jsonb := '{}'::jsonb;
  k text; v jsonb; pat text; t text;
begin
  if h is null or jsonb_typeof(h) <> 'object' then raise exception 'bad_handle'; end if;
  for k, v in select key, value from jsonb_each(h) loop
    pat := rules -> 'handles' ->> k;
    if pat is null then raise exception 'bad_handle'; end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'string' then raise exception 'bad_handle'; end if;
    t := btrim(v #>> '{}', ' ');
    if t = '' then continue; end if;
    if char_length(t) > (rules -> 'limits' ->> 'handleMax')::int or t !~ pat or t ~* (rules ->> 'handlesDeny') then
      raise exception 'bad_handle';
    end if;
    v_out := v_out || jsonb_build_object(k, t);
  end loop;
  return v_out;
end $$;

-- Check a post's meta against its board's fields, as nn-ROUND2.sql's did,
-- plus the `url` type: a link kept as typed (nn_clean would strip it),
-- matching the rules' urlPattern, and only on a board Stephen
-- pre-moderates. Returns the cleaned meta, or raises bad_meta / needs_meta
-- (boards-core.js checkMeta, line for line).
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
    elsif f ->> 'type' = 'bool' then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'bad_meta'; end if;
      v_out := v_out || jsonb_build_object(k, v);
    elsif f ->> 'type' = 'url' then
      if not coalesce((rules -> 'boards' -> p_board ->> 'premod')::boolean, false) or jsonb_typeof(v) <> 'string' then raise exception 'bad_meta'; end if;
      t := btrim(v #>> '{}', ' ');
      if char_length(t) > coalesce((f ->> 'max')::int, (rules -> 'limits' ->> 'metaTextMax')::int) or t !~ (rules ->> 'urlPattern') then
        raise exception 'bad_meta';
      end if;
      if t <> '' then v_out := v_out || jsonb_build_object(k, t); end if;
    else
      raise exception 'bad_meta';
    end if;
  end loop;
  for k in select jsonb_array_elements_text(coalesce(needs, '[]'::jsonb)) loop
    if not v_out ? k then raise exception 'needs_meta'; end if;
  end loop;
  return v_out;
end $$;

-- The date a kind with `until` ends by: the leading YYYY-MM-DD of that
-- meta field, or null when it starts with none (boards-core.js
-- leadingDate). One shaped like a date but not on the calendar
-- (2026-02-30, 2099-99-99) is bad_date, never "no date".
create or replace function public.nn_until_date(p_board text, p_kind text, p_meta jsonb) returns date
language plpgsql stable as $$
declare f text := public.nn_rules() -> 'boards' -> p_board -> 'kinds' -> p_kind ->> 'until'; s text; d date;
begin
  if f is null then return null; end if;
  s := substring(coalesce(p_meta ->> f, '') from '^([0-9]{4}-[0-9]{2}-[0-9]{2})');
  if s is null then return null; end if;
  begin
    d := s::date;
  exception when others then
    raise exception 'bad_date';
  end;
  return d;
end $$;

-- When a post of this kind, with this meta, made now, stops showing; null
-- for never (boards-core.js expiresAt). A kind with `until` ends at
-- midnight, Burlington time, at the end of the day after its date, and
-- raises bad_date when that date is before today or more than aheadMaxDays
-- out (boards-core.js dateError); without a date it lasts its `days`.
create or replace function public.nn_post_expiry(p_board text, p_kind text, p_meta jsonb) returns timestamptz
language plpgsql stable as $$
declare
  rules jsonb := public.nn_rules();
  kr jsonb := rules -> 'boards' -> p_board -> 'kinds' -> p_kind;
  d date := public.nn_until_date(p_board, p_kind, p_meta);
  today date := (now() at time zone 'America/New_York')::date;
begin
  if d is not null then
    if d < today or d > today + (rules -> 'limits' ->> 'aheadMaxDays')::int then raise exception 'bad_date'; end if;
    return (d + 2)::timestamp at time zone 'America/New_York';
  end if;
  if kr ->> 'days' is null then return null; end if;
  return now() + make_interval(days => (kr ->> 'days')::int);
end $$;

-- ---------------------------------------------------------------- profiles

-- Your profile, now with your handles and the switch. Signed-in only.
create or replace function public.nn_profile_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return (select jsonb_build_object('display_name', display_name, 'neighborhood', neighborhood, 'archetype', archetype,
                                    'interests', to_jsonb(interests), 'handles', handles, 'handles_public', handles_public)
            from public.nn_profiles where user_id = u);
end $$;

-- Round two's call, with your handles and the "show my handles" switch.
-- p_interests and p_handles have no default on purpose, so this never
-- overlaps the two older calls: a call without p_handles is one of them.
-- A null p_interests, p_handles or p_handles_public keeps what you have; a
-- list or a map replaces it; an empty one clears it. Checks, in order (the
-- order of boards-core.js checkProfile): signed in, the name, the
-- neighborhood, the archetype, the interests, the handles.
create or replace function public.nn_profile_set(p_display_name text, p_interests text[], p_handles jsonb,
  p_neighborhood text default null, p_archetype text default null, p_handles_public boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  rules jsonb := public.nn_rules();
  v_name text := public.nn_clean(p_display_name, false);
  hood text := nullif(p_neighborhood, '');
  arch text := nullif(p_archetype, '');
  v_int text[];
  v_h jsonb;
  t text;
  rec public.nn_profiles;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if v_name = '' or char_length(v_name) > (rules -> 'limits' ->> 'nameMax')::int or position('@' in v_name) > 0 then raise exception 'bad_name'; end if;
  if hood is not null and not ((rules -> 'neighborhoods') ? hood) then raise exception 'bad_neighborhood'; end if;
  if arch is not null and not ((rules -> 'archetypes') ? arch) then raise exception 'bad_archetype'; end if;
  if p_interests is not null then
    v_int := '{}';
    foreach t in array p_interests loop
      if t is null or not ((rules -> 'interests') ? t) then raise exception 'bad_interest'; end if;
      if not (t = any (v_int)) then v_int := v_int || t; end if;
    end loop;
    if coalesce(array_length(v_int, 1), 0) > (rules -> 'limits' ->> 'interestsMax')::int then raise exception 'bad_interest'; end if;
  end if;
  if p_handles is not null and jsonb_typeof(p_handles) <> 'null' then v_h := public.nn_check_handles(p_handles); end if;
  insert into public.nn_profiles (user_id, display_name, neighborhood, archetype, interests, handles, handles_public)
  values (u, v_name, hood, arch, coalesce(v_int, '{}'), coalesce(v_h, '{}'::jsonb), coalesce(p_handles_public, false))
  on conflict (user_id) do update set display_name = excluded.display_name, neighborhood = excluded.neighborhood,
    archetype = excluded.archetype, interests = coalesce(v_int, public.nn_profiles.interests),
    handles = coalesce(v_h, public.nn_profiles.handles),
    handles_public = coalesce(p_handles_public, public.nn_profiles.handles_public), updated_at = now()
  returning * into rec;
  return jsonb_build_object('display_name', rec.display_name, 'neighborhood', rec.neighborhood, 'archetype', rec.archetype,
    'interests', to_jsonb(rec.interests), 'handles', rec.handles, 'handles_public', rec.handles_public);
end $$;

-- Handles of the kinds asked for (p_kinds: handle kinds from the rules;
-- null or empty means every kind; one that is not a kind is bad_handle),
-- from the profiles most recently updated, p_limit of them (20 by default,
-- listMax at most): [{"display_name": "Maya", "neighborhood": "south-end",
-- "handles": {"strava": "maya_runs"}, "updated_at": "2026-10-17", "me": false}].
-- Signed-in readers only. Only a profile whose reader turned "show my
-- handles" on (handles_public), has at least one of those kinds and is not
-- banned. updated_at is the day (Burlington's calendar) the profile was
-- last saved, never the time. Never an email, never an account id.
create or replace function public.nn_handles_recent(p_kinds text[] default null, p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  rules jsonb := public.nn_rules();
  kinds text[];
  lim int := least(greatest(coalesce(p_limit, 20), 1), (rules -> 'limits' ->> 'listMax')::int);
  t text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_kinds is null or cardinality(p_kinds) = 0 then
    select array_agg(k) into kinds from jsonb_object_keys(rules -> 'handles') k;
  else
    kinds := '{}';
    foreach t in array p_kinds loop
      if t is null or not ((rules -> 'handles') ? t) then raise exception 'bad_handle'; end if;
      if not (t = any (kinds)) then kinds := kinds || t; end if;
    end loop;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('display_name', x.display_name, 'neighborhood', x.neighborhood, 'handles', x.h,
             'updated_at', to_char(x.updated_at at time zone 'America/New_York', 'YYYY-MM-DD'), 'me', x.user_id = u)
             order by x.updated_at desc), '[]'::jsonb)
    from (select pr.user_id, pr.display_name, pr.neighborhood, pr.updated_at,
                 (select jsonb_object_agg(e.key, e.value) from jsonb_each(pr.handles) e where e.key = any (kinds)) as h
            from public.nn_profiles pr
           where pr.handles_public and pr.handles ?| kinds
             and not exists (select 1 from public.nn_bans b where b.user_id = pr.user_id)
           order by pr.updated_at desc
           limit lim) x);
end $$;

-- ------------------------------------------------------------------ posting

-- Post to a board: nn-SETUP.sql's call, the same arguments, checks and
-- answer, with one change. A post's end now comes from nn_post_expiry, so
-- a gathering ends the day after its date, and a date in the past (or more
-- than six months out) is refused with bad_date, checked right after the
-- photo's shape and before the photo is claimed (the order of the fake in
-- boards-fake.js).
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
  v_ends timestamptz;
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
  v_ends := public.nn_post_expiry(p_board, p_kind, m);
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
  values (p_board, u, p_kind, t, bd, photo, kr ->> 'photo' = 'required', m, pl, v_ends,
          case when (b ->> 'premod')::boolean then 'pending' else 'approved' end)
  returning * into rec;
  return public.nn_post_json(rec, 'u:' || u::text, u) || jsonb_build_object('status', rec.status);
end $$;

-- Change the fields on your own post: nn-ROUND2.sql's call, unchanged but
-- for one thing. When a kind with `until` (a gathering) has that field
-- changed, its end moves with the new date, and a date in the past is
-- refused with bad_date; any other edit leaves the end where it was. On a
-- board Stephen pre-moderates, an edited live post waits for him again.
create or replace function public.nn_post_meta_set(p_post uuid, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); rec public.nn_posts; m jsonb; kr jsonb; f text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.nn_bans where user_id = u) then raise exception 'banned'; end if;
  select * into rec from public.nn_posts where id = p_post and user_id = u and status <> 'deleted' for update;
  if not found then raise exception 'not_found'; end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then raise exception 'bad_meta'; end if;
  m := public.nn_check_meta(rec.board, rec.kind, jsonb_strip_nulls(rec.meta || p_meta));
  kr := public.nn_rules() -> 'boards' -> rec.board -> 'kinds' -> rec.kind;
  f := kr ->> 'until';
  if f is not null and (m -> f) is distinct from (rec.meta -> f) then
    if public.nn_until_date(rec.board, rec.kind, m) is not null then
      rec.expires_at := public.nn_post_expiry(rec.board, rec.kind, m);
    else
      -- no date any more: the kind's days, counted from when it went up
      rec.expires_at := case when kr ->> 'days' is not null then rec.created_at + make_interval(days => (kr ->> 'days')::int) end;
    end if;
  end if;
  update public.nn_posts set meta = m, expires_at = rec.expires_at,
         status = case when coalesce((public.nn_rules() -> 'boards' -> rec.board ->> 'premod')::boolean, false) and status = 'approved'
                       then 'pending' else status end
   where id = p_post
  returning * into rec;
  return public.nn_post_json(rec, 'u:' || u::text, u) || jsonb_build_object('status', rec.status);
end $$;

-- ------------------------------------------------------------------ grants
-- Take back the default grants on everything this file made or replaced,
-- then hand out exactly the doors the app uses. The checks and the expiry
-- are helpers the doors call, never doors themselves.
revoke all on function
  public.nn_rules(), public.nn_check_handles(jsonb), public.nn_check_meta(text, text, jsonb),
  public.nn_until_date(text, text, jsonb), public.nn_post_expiry(text, text, jsonb),
  public.nn_profile_get(), public.nn_profile_set(text, text[], jsonb, text, text, boolean),
  public.nn_handles_recent(text[], int),
  public.nn_post_create(text, text, text, text, text, jsonb, text), public.nn_post_meta_set(uuid, jsonb)
from public, anon, authenticated;

-- Readers, signed in or not (the signed-in-only ones refuse with
-- not_signed_in themselves, so the app hears one clear answer).
grant execute on function
  public.nn_rules(), public.nn_profile_get(), public.nn_profile_set(text, text[], jsonb, text, text, boolean),
  public.nn_handles_recent(text[], int),
  public.nn_post_create(text, text, text, text, text, jsonb, text), public.nn_post_meta_set(uuid, jsonb)
to anon, authenticated;
