-- ============================================================================
-- ALL DAY — accounts and boards, round two (the New Nine). One paste.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   nn_
-- Written:  2026-10-16
-- Needs:    all-day/supabase/nn-SETUP.sql pasted first. nn-people.sql,
--           nn-watch.sql, db/photos.sql and db/photos-board.sql are used
--           when they are there and skipped when they are not.
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: it only
-- adds a column, adds or replaces functions, and replaces two storage
-- policies of its own. It deletes no reader's row and no table.
-- SETUP-STEPHEN.md part D has the steps.
--
-- If nn-SETUP.sql is ever pasted again, paste this file again right after
-- it: nn-SETUP.sql puts back the round-one rules and the round-one vote.
--
-- What it adds, in plain words:
--   The rules (nn_rules) gain, without taking anything away:
--     Vintage   a `design` kind (a design sent in for a tee: photo needed,
--               never ends, and how the artist is thanked: free shirts or
--               store credit) and a `fit` kind (a fit check: photo needed,
--               60 days); a `got` box a poster ticks when someone got
--               their find.
--     People    a plan's "down to put it on Meetup" box and its rough age
--               band, which lived in nn-people.sql's side table until now.
--     Watch     a film's TMDB number on a rating or a pick, and one vote
--               per reader on the screening ballot.
--     Profiles  what a reader is into, from the People tab's activity list
--               (running, games, live music...). Never who they are.
--   nn_post_meta_set   change the small fields on your own post.
--   nn_votes_by_week   each post's votes counted by the week they were
--                      cast, so Art's winners stop changing at Sunday
--                      midnight.
--   nn_vote            the same vote, plus the one-vote rule where a kind
--                      has it: voting for another pick moves your vote.
--   The photo sweep    a board photo nobody posted (the post was refused,
--                      the phone went offline) leaves the photo queue after
--                      a day, and a picture file that never made it into
--                      the queue at all is cleared from the bucket when
--                      Stephen opens the boards desk.
--   nn_people_meetup_list  now also lists plans whose Meetup box is in the
--                      plan itself.
--
-- Security model, unchanged: RLS on, no table policies, every door a
-- security-definer function. The one new kind of door is two storage
-- policies on the photo bucket that let anyone remove a picture file only
-- when it is a stray: older than a day, under submissions/, and referenced
-- by no photo-queue row and no post. Nothing else in the bucket can be
-- listed or removed through them.
-- ============================================================================

-- ---------------------------------------------------------------- the rules
-- The same JSON as RULES in all-day/js/boards-core.js; this copy replaces
-- the one nn-SETUP.sql installed. scripts/test-boards-core.mjs fails when
-- the two differ, or when a kind or field from nn-SETUP.sql is missing.
create or replace function public.nn_rules() returns jsonb
language sql immutable as $rules$ select $json${"version":2,"limits":{"nameMax":32,"titleMax":80,"bodyMax":600,"placeMax":80,"metaKeysMax":8,"metaTextMax":80,"postsPerDay":20,"waitingMax":5,"reportsToHide":2,"reportsPerDay":10,"interestsMax":8,"weeksMax":26,"listDefault":30,"listMax":60,"expiredKeepDays":7,"deletedKeepDays":30},"neighborhoods":["downtown","old-north-end","new-north-end","south-end","hill","waterfront","winooski","south-burlington","essex","shelburne","colchester","elsewhere"],"archetypes":["new","regular","trail","games"],"reasons":["spam","unkind","unsafe","other"],"interests":["sports","running","outdoors","games","music","dance","books","making","languages","food"],"boards":{"people":{"premod":false,"gallery":false,"kinds":{"plan":{"days":14,"photo":"none","needs":["when"]}},"meta":{"when":{"type":"text","max":60},"arch":{"type":"enum","values":["new","regular","trail","games"]},"spots":{"type":"int","min":1,"max":50},"meetup":{"type":"bool"},"ages":{"type":"enum","values":["twenties","thirties","forties","fifties","any"]}}},"vintage":{"premod":false,"gallery":false,"kinds":{"spotted":{"days":21,"photo":"optional","needs":["shop"]},"swap":{"days":21,"photo":"optional","needs":["want"]},"design":{"days":null,"photo":"required","needs":["thanks"]},"fit":{"days":60,"photo":"required","needs":[]}},"meta":{"shop":{"type":"text","max":60},"size":{"type":"text","max":12},"price":{"type":"int","min":0,"max":10000},"want":{"type":"text","max":80},"thanks":{"type":"enum","values":["shirts","credit"]},"got":{"type":"bool"}}},"art":{"premod":false,"gallery":true,"kinds":{"photo":{"days":null,"photo":"required","needs":[]},"art":{"days":null,"photo":"required","needs":[]},"notice":{"days":30,"photo":"none","needs":[]}},"meta":{"medium":{"type":"text","max":40},"shirt":{"type":"enum","values":["yes","no"]}}},"watch":{"premod":false,"gallery":false,"kinds":{"rating":{"days":null,"photo":"none","needs":["stars"]},"pick":{"days":30,"photo":"none","needs":[],"one_vote":true}},"meta":{"year":{"type":"int","min":1888,"max":2100},"stars":{"type":"int","min":1,"max":5},"where":{"type":"text","max":40},"film":{"type":"int","min":1,"max":99999999}}}}}$json$::jsonb $rules$;

-- ------------------------------------------------------------------ tables

-- what a reader is into, on their profile (from rules.interests only)
alter table public.nn_profiles add column if not exists interests text[] not null default '{}';
-- votes are counted by the week they were cast
create index if not exists nn_votes_created_idx on public.nn_votes (created_at);

-- ----------------------------------------------------------------- helpers

-- Check a post's meta against its board's fields, as nn-SETUP.sql's did,
-- plus the `bool` type (true or false). Returns the cleaned meta, or raises
-- bad_meta / needs_meta (boards-core.js checkMeta, line for line).
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

-- Your profile, now with what you're into. Signed-in only.
create or replace function public.nn_profile_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return (select jsonb_build_object('display_name', display_name, 'neighborhood', neighborhood, 'archetype', archetype,
                                    'interests', to_jsonb(interests))
            from public.nn_profiles where user_id = u);
end $$;

-- The round-one call, unchanged in what it takes and does: it leaves your
-- interests as they are, and now also says what they are.
create or replace function public.nn_profile_set(p_display_name text, p_neighborhood text default null, p_archetype text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  rules jsonb := public.nn_rules();
  v_name text := public.nn_clean(p_display_name, false);
  hood text := nullif(p_neighborhood, '');
  arch text := nullif(p_archetype, '');
  v_int text[];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if v_name = '' or char_length(v_name) > (rules -> 'limits' ->> 'nameMax')::int or position('@' in v_name) > 0 then raise exception 'bad_name'; end if;
  if hood is not null and not ((rules -> 'neighborhoods') ? hood) then raise exception 'bad_neighborhood'; end if;
  if arch is not null and not ((rules -> 'archetypes') ? arch) then raise exception 'bad_archetype'; end if;
  insert into public.nn_profiles (user_id, display_name, neighborhood, archetype)
  values (u, v_name, hood, arch)
  on conflict (user_id) do update set display_name = excluded.display_name, neighborhood = excluded.neighborhood,
    archetype = excluded.archetype, updated_at = now()
  returning interests into v_int;
  return jsonb_build_object('display_name', v_name, 'neighborhood', hood, 'archetype', arch, 'interests', to_jsonb(v_int));
end $$;

-- The same, with what you're into. p_interests is a list from
-- rules.interests (each once, eight at most); a null keeps the ones you
-- have and an empty list clears them. Anything off the list is refused
-- with bad_interest: activities only, never who someone is.
-- p_interests has no default on purpose, so the two calls never overlap:
-- a call without p_interests is the round-one one above.
create or replace function public.nn_profile_set(p_display_name text, p_interests text[], p_neighborhood text default null, p_archetype text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  rules jsonb := public.nn_rules();
  v_name text := public.nn_clean(p_display_name, false);
  hood text := nullif(p_neighborhood, '');
  arch text := nullif(p_archetype, '');
  v_int text[];
  t text;
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
  insert into public.nn_profiles (user_id, display_name, neighborhood, archetype, interests)
  values (u, v_name, hood, arch, coalesce(v_int, '{}'))
  on conflict (user_id) do update set display_name = excluded.display_name, neighborhood = excluded.neighborhood,
    archetype = excluded.archetype, interests = coalesce(v_int, public.nn_profiles.interests), updated_at = now()
  returning interests into v_int;
  return jsonb_build_object('display_name', v_name, 'neighborhood', hood, 'archetype', arch, 'interests', to_jsonb(v_int));
end $$;

-- ------------------------------------------------------------------ posting

-- Change the small fields on one of your own posts: a Vintage find someone
-- got, a plan's Meetup box. p_meta goes over the fields the post has, a
-- null takes one away, and the result is checked exactly like a new post's
-- (nn_check_meta: the board's fields, the kind's required ones). Signed in,
-- not banned, your own post, not deleted. On a board Stephen pre-moderates,
-- an edited live post waits for him again. Returns the post.
create or replace function public.nn_post_meta_set(p_post uuid, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); rec public.nn_posts; m jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.nn_bans where user_id = u) then raise exception 'banned'; end if;
  select * into rec from public.nn_posts where id = p_post and user_id = u and status <> 'deleted' for update;
  if not found then raise exception 'not_found'; end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then raise exception 'bad_meta'; end if;
  m := public.nn_check_meta(rec.board, rec.kind, jsonb_strip_nulls(rec.meta || p_meta));
  update public.nn_posts set meta = m,
         status = case when coalesce((public.nn_rules() -> 'boards' -> rec.board ->> 'premod')::boolean, false) and status = 'approved'
                       then 'pending' else status end
   where id = p_post
  returning * into rec;
  return public.nn_post_json(rec, 'u:' || u::text, u) || jsonb_build_object('status', rec.status);
end $$;

-- ------------------------------------------------------------------- votes

-- Vote for a post anyone can see, as before. Where the post's kind has
-- `one_vote` (the Watch screening ballot), a voter has one vote among that
-- kind's posts on the board that have not ended: voting for another one
-- moves it, in one step, and `moved` lists the posts it left. A pick that
-- is hidden right now counts too, so putting it back can never leave a
-- voter with two. Votes on ended posts stay as they were counted.
create or replace function public.nn_vote(p_post uuid, p_player text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_voter text := public.nn_voter(auth.uid(), p_player); p public.nn_posts; v_moved jsonb := '[]'::jsonb;
begin
  if v_voter is null then raise exception 'bad_voter'; end if;
  select * into p from public.nn_posts where id = p_post;
  if not found or not public.nn_listable(p) then raise exception 'not_found'; end if;
  if coalesce((public.nn_rules() -> 'boards' -> p.board -> 'kinds' -> p.kind ->> 'one_vote')::boolean, false) then
    -- one voter's ballot votes queue behind each other, so two at once still leave one
    perform pg_advisory_xact_lock(hashtext('nn_vote:' || v_voter || ':' || p.board || ':' || p.kind));
    with gone as (
      delete from public.nn_votes v using public.nn_posts o
       where v.voter = v_voter and v.post_id = o.id and o.id <> p_post and o.board = p.board and o.kind = p.kind
         and (o.expires_at is null or o.expires_at > now())
      returning v.post_id)
    select coalesce(jsonb_agg(post_id), '[]'::jsonb) into v_moved from gone;
  end if;
  insert into public.nn_votes (post_id, voter) values (p_post, v_voter) on conflict do nothing;
  return jsonb_build_object('votes', (select count(*) from public.nn_votes where post_id = p_post), 'voted', true, 'moved', v_moved);
end $$;

-- A board's votes counted by the week they were cast, Burlington time, for
-- this week and the p_weeks - 1 before it (26 at most): one row per post
-- per week, {"post": id, "week": "2026-W42", "votes": 7}, newest week
-- first, most votes first. Weeks are ISO weeks, Monday to Sunday, so a past
-- week's count never changes again. Only posts everyone can see count.
create or replace function public.nn_votes_by_week(p_board text, p_weeks int default 8) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rules jsonb := public.nn_rules();
  n int := least(greatest(coalesce(p_weeks, 8), 1), (rules -> 'limits' ->> 'weeksMax')::int);
  v_from timestamptz := (date_trunc('week', now() at time zone 'America/New_York') - make_interval(weeks => n - 1)) at time zone 'America/New_York';
begin
  if rules -> 'boards' -> p_board is null then raise exception 'bad_board'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('post', x.post_id, 'week', x.week, 'votes', x.n)
                                    order by x.week desc, x.n desc, x.post_id), '[]'::jsonb)
            from (select v.post_id, to_char(v.created_at at time zone 'America/New_York', 'IYYY-"W"IW') as week, count(*) as n
                    from public.nn_votes v join public.nn_posts p on p.id = v.post_id
                   where p.board = p_board and v.created_at >= v_from and public.nn_listable(p)
                   group by 1, 2) x);
end $$;

-- ---------------------------------------------------------- the photo sweep

-- Board photos nobody posted: still waiting in the queue, filed from a
-- board, more than a day old (past the day nn_photo_claimable allows, plus
-- an hour so a post in flight always wins) and taken by no post. They are
-- marked 'removed', so they can never be approved into the gallery by
-- mistake. Returns how many. Runs with nn_sweep and from the boards desk.
create or replace function public.nn_photo_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if to_regclass('public.btb_photos') is null then return 0; end if;
  execute 'with gone as (
             update public.btb_photos b set status = ''removed'', decided_at = now()
              where b.status = ''pending'' and b.spot like ''All Day · %'' and b.created_at < now() - interval ''25 hours''
                and not exists (select 1 from public.nn_posts p where p.photo_path = b.storage_path)
             returning 1)
           select count(*) from gone' into n;
  return n;
end $$;

-- The round-one sweep, plus the photo sweep above.
create or replace function public.nn_sweep() returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb := public.nn_rules() -> 'limits';
begin
  delete from public.nn_posts
   where (expires_at is not null and expires_at < now() - make_interval(days => (r ->> 'expiredKeepDays')::int))
      or (status = 'deleted' and coalesce(decided_at, created_at) < now() - make_interval(days => (r ->> 'deletedKeepDays')::int));
  perform public.nn_photo_sweep();
end $$;

-- Is this picture file a stray? In the photo bucket, under submissions/,
-- more than a day old, and referenced by no photo-queue row (rejected and
-- removed rows still count as references) and no post. Every uploader in
-- this repo files its picture in the queue seconds after uploading it, so
-- a day-old file with no row is one whose filing failed. With no photo
-- queue installed, nothing is a stray. The storage policies below ask this.
create or replace function public.nn_photo_orphan(p_name text, p_bucket text, p_created timestamptz) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare hit boolean;
begin
  if p_bucket is distinct from 'btb-photos' or coalesce(p_name, '') !~ '^submissions/[A-Za-z0-9-]+\.jpg$'
     or p_created is null or p_created > now() - interval '1 day' then return false; end if;
  if to_regclass('public.btb_photos') is null then return false; end if;
  if exists (select 1 from public.nn_posts where photo_path = p_name) then return false; end if;
  execute 'select exists (select 1 from public.btb_photos where storage_path = $1)' into hit using p_name;
  return not coalesce(hit, true);
end $$;

-- The boards desk's sweep, behind the passphrase: runs the photo sweep and
-- lists up to 100 stray picture files, oldest first, for the desk to remove
-- through the Storage API (deleting storage rows from SQL would leave the
-- files behind, and Supabase refuses it). {"abandoned": 2, "strays": [...]}
create or replace function public.nn_mod_photo_sweep(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; v_strays jsonb := '[]'::jsonb;
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  n := public.nn_photo_sweep();
  if to_regclass('storage.objects') is not null then
    begin
      execute 'select coalesce(jsonb_agg(o.name order by o.created_at), ''[]''::jsonb) from (
                 select name, created_at from storage.objects
                  where bucket_id = ''btb-photos'' and name like ''submissions/%'' and created_at < now() - interval ''1 day''
                    and public.nn_photo_orphan(name, bucket_id, created_at)
                  order by created_at limit 100) o' into v_strays;
    exception when others then
      v_strays := '[]'::jsonb;   -- the bucket could not be read; the queue part still ran
    end;
  end if;
  return jsonb_build_object('abandoned', n, 'strays', v_strays);
end $$;

-- Let the Storage API remove a stray, and only a stray. Supabase's remove
-- call needs both a select and a delete policy on the rows it removes. If
-- this project will not let the SQL Editor add policies to the bucket, the
-- rest of this file still installs and the desk says strays are waiting.
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists "nn stray photos read" on storage.objects';
  execute 'create policy "nn stray photos read" on storage.objects for select to anon, authenticated
             using (bucket_id = ''btb-photos'' and public.nn_photo_orphan(name, bucket_id, created_at))';
  execute 'drop policy if exists "nn stray photos remove" on storage.objects';
  execute 'create policy "nn stray photos remove" on storage.objects for delete to anon, authenticated
             using (bucket_id = ''btb-photos'' and public.nn_photo_orphan(name, bucket_id, created_at))';
exception when others then
  raise notice 'nn-ROUND2: the two stray-photo policies were not added (%). Everything else installed.', sqlerrm;
end $$;

-- ---------------------------------------------------------- People's list

-- Stephen's list of Meetup hosts (first in nn-people.sql), behind the
-- desk passphrase: live plans whose host ticked "put this on Meetup",
-- whether the box is in the plan itself (from round two) or in
-- nn-people.sql's side table (plans posted before it, read for as long as
-- they last). Authors by first name only. Works with or without
-- nn-people.sql installed.
create or replace function public.nn_people_meetup_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_side boolean := to_regclass('public.nn_people_plans') is not null; v_out jsonb;
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  execute format($q$
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'when', p.meta ->> 'when', 'place', p.place,
             'spots', p.meta -> 'spots', 'ages', coalesce(p.meta ->> 'ages', %s), 'author', coalesce(pr.display_name, 'A neighbor'),
             'going', (select count(*) from public.nn_votes v where v.post_id = p.id),
             'created_at', p.created_at, 'expires_at', p.expires_at) order by p.created_at desc), '[]'::jsonb)
      from public.nn_posts p left join public.nn_profiles pr on pr.user_id = p.user_id %s
     where p.board = 'people' and public.nn_listable(p) and (p.meta @> '{"meetup": true}'::jsonb %s)$q$,
    case when v_side then 'x.ages' else 'null' end,
    case when v_side then 'left join public.nn_people_plans x on x.post_id = p.id' else '' end,
    case when v_side then 'or coalesce(x.meetup, false)' else '' end) into v_out;
  return jsonb_build_object('plans', v_out);
end $$;

-- ------------------------------------------------------------------ grants
-- Take back the default grants on everything this file made or replaced,
-- then hand out exactly the doors the app uses.
revoke all on function
  public.nn_rules(), public.nn_check_meta(text, text, jsonb), public.nn_profile_get(),
  public.nn_profile_set(text, text, text), public.nn_profile_set(text, text[], text, text),
  public.nn_post_meta_set(uuid, jsonb), public.nn_vote(uuid, text), public.nn_votes_by_week(text, int),
  public.nn_photo_sweep(), public.nn_sweep(), public.nn_photo_orphan(text, text, timestamptz),
  public.nn_mod_photo_sweep(text), public.nn_people_meetup_list(text)
from public, anon, authenticated;

-- The storage policies call this as the reader asking Storage, so readers
-- may run it. It answers one yes or no about one file.
grant execute on function public.nn_photo_orphan(text, text, timestamptz) to anon, authenticated;

-- Readers, signed in or not (the signed-in-only ones refuse with
-- not_signed_in themselves, so the app hears one clear answer).
grant execute on function
  public.nn_rules(), public.nn_profile_get(),
  public.nn_profile_set(text, text, text), public.nn_profile_set(text, text[], text, text),
  public.nn_post_meta_set(uuid, jsonb), public.nn_vote(uuid, text), public.nn_votes_by_week(text, int),
  public.nn_mod_photo_sweep(text), public.nn_people_meetup_list(text)
to anon, authenticated;
