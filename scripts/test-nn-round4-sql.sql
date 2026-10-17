-- End-to-end check of nn-ROUND4.sql (handles, and the Games, Square and
-- Gatherings boards) on a scratch database scripts/test-nn-sql.sh builds.
-- It runs in two layouts: everything installed (People, Watch, the photo
-- queue and a storage stand-in), and nothing optional at all; the cases for
-- a missing piece are skipped. Every reader call runs as the anon or
-- authenticated role, the way the app's publishable key arrives. The same
-- cases run against the fake backend in scripts/test-boards-core.mjs
-- ("round four: ..."), and the handle table is the same file
-- (scripts/test-nn-handle-cases.json, passed in as :cases).
\set ON_ERROR_STOP on
set client_min_messages = warning;

create function pg_temp.who(u text) returns void language sql as $$
  select set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u, 'role', 'authenticated')::text end, false) $$;
create function pg_temp.expect_error(q text, code text) returns void language plpgsql as $$
begin
  begin execute q; raise exception 'expected % but it succeeded: %', code, q;
  exception when others then
    if sqlerrm <> code then raise exception 'expected % got "%" for %', code, sqlerrm, q; end if;
  end;
end $$;
create function pg_temp.expect_denied(q text) returns void language plpgsql as $$
begin
  begin execute q; raise exception 'expected permission denied but it succeeded: %', q;
  exception when insufficient_privilege then null;
  end;
end $$;
create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', what; end if; end $$;
-- the first names nn_handles_recent hands back, in its order
create function pg_temp.names(r jsonb) returns text language sql as $$
  select coalesce(string_agg(e ->> 'display_name', ',' order by n), '') from jsonb_array_elements(r) with ordinality x(e, n) $$;
-- a day in Burlington, n days from today, as YYYY-MM-DD
create function pg_temp.day(n int) returns text language sql as $$
  select to_char((now() at time zone 'America/New_York')::date + n, 'YYYY-MM-DD') $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

select to_regclass('public.btb_photos') is not null as has_photos,
       to_regclass('public.nn_people_dir') is not null as has_people \gset

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'maya@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'kim@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'lee@example.com');
insert into public.nn_mod (id, pass_hash) values (true, extensions.crypt('test-secret', extensions.gen_salt('bf', 4)))
  on conflict (id) do update set pass_hash = excluded.pass_hash;
\if :has_photos
insert into public.btb_photos (storage_path, status, spot) values
  ('submissions/pet0-0001.jpg', 'pending', 'All Day · The Square'), ('submissions/show-0002.jpg', 'pending', 'All Day · The Square');
\endif
create table pg_temp.ids (k text primary key, id uuid);
grant all on pg_temp.ids to anon, authenticated;
create table pg_temp.cases as select key as k, value as v from jsonb_each(:'cases'::jsonb);

-- ------------------------------------------------------------ the locks
set role anon; select pg_temp.who(null);
select pg_temp.expect_error('select public.nn_handles_recent()', 'not_signed_in');
select pg_temp.ok((public.nn_rules() ->> 'version')::int = 3, 'the round-four rules are the live ones');
select pg_temp.ok(public.nn_rules() -> 'boards' -> 'vintage' -> 'kinds' ? 'design' and public.nn_rules() -> 'boards' -> 'watch' -> 'kinds' -> 'pick' ->> 'one_vote' = 'true',
  'round two''s kinds are still there, as they were');
select pg_temp.ok((select count(*) from jsonb_object_keys(public.nn_rules() -> 'handles')) = 16, 'sixteen handle kinds');
select pg_temp.expect_denied($q$select public.nn_check_handles('{}')$q$);
select pg_temp.expect_denied($q$select public.nn_until_date('gatherings', 'gathering', '{}')$q$);
select pg_temp.expect_denied($q$select public.nn_post_expiry('gatherings', 'gathering', '{}')$q$);
select pg_temp.expect_denied('select handles from public.nn_profiles');
select pg_temp.expect_error($q$select public.nn_profile_set(p_display_name => 'Maya', p_interests => null, p_handles => '{}')$q$, 'not_signed_in');
reset role;
select pg_temp.ok(has_function_privilege('anon', 'public.nn_profile_set(text, text[], jsonb, text, text, boolean)', 'execute')
              and has_function_privilege('anon', 'public.nn_profile_set(text, text[], text, text)', 'execute')
              and has_function_privilege('anon', 'public.nn_profile_set(text, text, text)', 'execute')
              and has_function_privilege('anon', 'public.nn_handles_recent(text[], int)', 'execute')
              and has_function_privilege('anon', 'public.nn_post_create(text, text, text, text, text, jsonb, text)', 'execute')
              and has_function_privilege('anon', 'public.nn_post_meta_set(uuid, jsonb)', 'execute')
              and not has_function_privilege('anon', 'public.nn_check_handles(jsonb)', 'execute')
              and not has_function_privilege('authenticated', 'public.nn_post_expiry(text, text, jsonb)', 'execute'),
  'the doors are granted, the helpers are not');
select pg_temp.ok((select count(*) from pg_proc where proname = 'nn_profile_set' and pronamespace = 'public'::regnamespace) = 3, 'three nn_profile_set calls, the two older ones left alone');

-- --------------------------------------------- every handle kind, good and bad
-- (as the table owner: the check is a helper, called by nn_profile_set)
do $$
declare c record; val text; got jsonb;
begin
  for c in select x.k, x.v from pg_temp.cases x loop
    for val in select jsonb_array_elements_text(c.v -> 0) loop
      got := public.nn_check_handles(jsonb_build_object(c.k, val));
      if got <> jsonb_build_object(c.k, btrim(val, ' ')) then raise exception 'FAILED: % should take "%", got %', c.k, val, got; end if;
    end loop;
    for val in select jsonb_array_elements_text(c.v -> 1) loop
      perform pg_temp.expect_error(format('select public.nn_check_handles(%L::jsonb)', jsonb_build_object(c.k, val)), 'bad_handle');
    end loop;
  end loop;
end $$;
select pg_temp.ok((select count(*) from pg_temp.cases) = 16, 'the table covers every kind');
select pg_temp.ok(public.nn_check_handles('{"instagram":" maya.r ","strava":"","psn":null}') = '{"instagram":"maya.r"}', 'trimmed; empty or null drops the kind');
select pg_temp.expect_error($q$select public.nn_check_handles('{"myspace":"tom"}')$q$, 'bad_handle');
select pg_temp.expect_error($q$select public.nn_check_handles('{"instagram":7}')$q$, 'bad_handle');
select pg_temp.expect_error($q$select public.nn_check_handles('["maya"]')$q$, 'bad_handle');
select pg_temp.expect_error($q$select public.nn_check_handles('"maya"')$q$, 'bad_handle');
select pg_temp.expect_error($q$select public.nn_check_handles(E'{"instagram":"\\tmaya"}')$q$, 'bad_handle');
select pg_temp.expect_error($q$select public.nn_check_handles('{"instagram":"SPAM.COM"}')$q$, 'bad_handle');

-- ------------------------------------------------------ handles on a profile
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(public.nn_profile_set('Maya') ->> 'display_name' = 'Maya', 'the round-one call, positional, still works');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Maya', p_interests => array['running']) -> 'interests' = '["running"]', 'and round two''s');
select pg_temp.ok(public.nn_profile_get() -> 'handles' = '{}' and public.nn_profile_get() -> 'handles_public' = 'false', 'no handles yet, switch off');
select pg_temp.expect_error($q$select public.nn_profile_set(p_display_name => 'Maya', p_interests => null, p_handles => '{"strava":"@maya"}')$q$, 'bad_handle');
select pg_temp.expect_error($q$select public.nn_profile_set(p_display_name => 'Maya', p_interests => array['women'], p_handles => '{"strava":"@maya"}')$q$, 'bad_interest');
select pg_temp.expect_error($q$select public.nn_profile_set(p_display_name => 'maya@example.com', p_interests => null, p_handles => '{}')$q$, 'bad_name');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Maya', p_interests => null, p_handles => '{"strava":" maya_runs ","psn":"","instagram":"maya.r"}',
                                        p_neighborhood => 'south-end', p_handles_public => true)
  = '{"display_name":"Maya","neighborhood":"south-end","archetype":null,"interests":["running"],"handles":{"strava":"maya_runs","instagram":"maya.r"},"handles_public":true}',
  'saved, trimmed, the interests kept');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Maya', p_interests => null, p_handles => null, p_neighborhood => 'south-end') -> 'handles' = '{"strava":"maya_runs","instagram":"maya.r"}'
              and public.nn_profile_get() -> 'handles_public' = 'true', 'a null keeps them, and a null switch keeps it');
select pg_temp.ok(not (public.nn_profile_set('Maya', 'south-end') ? 'handles'), 'the round-one call answers as it always did');
select pg_temp.ok(public.nn_profile_get() -> 'handles' = '{"strava":"maya_runs","instagram":"maya.r"}', 'and keeps them');
select pg_temp.ok(not (public.nn_profile_set(p_display_name => 'Maya', p_interests => array['running'], p_neighborhood => 'south-end') ? 'handles')
              and public.nn_profile_get() -> 'handles' <> '{}', 'so does round two''s');
select pg_temp.who('44444444-4444-4444-4444-444444444444');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Lee', p_interests => null, p_handles => '{"switch":"SW-1234-5678-9012"}') -> 'handles_public' = 'false',
  'a new profile can start with handles, switch off');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Lee', p_interests => null, p_handles => '{}') -> 'handles' = '{}', 'an empty map clears them');

-- --------------------------------------------- who nn_handles_recent shows
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select public.nn_profile_set(p_display_name => 'Sam', p_interests => null, p_handles => '{"strava":"sam_rides"}', p_handles_public => false);   -- off
\if :has_people
select public.nn_people_optin(true, array['running']);   -- Sam is in the People directory: that alone shows nothing
\endif
select pg_temp.who('33333333-3333-3333-3333-333333333333');
select public.nn_profile_set(p_display_name => 'Kim', p_interests => null, p_handles => '{"strava":"kim_k"}', p_handles_public => true);   -- on
select pg_temp.who('44444444-4444-4444-4444-444444444444');
select public.nn_profile_set(p_display_name => 'Lee', p_interests => null, p_handles => '{"psn":"LeePlays"}', p_handles_public => true);  -- on, another kind
set role anon; select pg_temp.who(null);
select pg_temp.expect_error($q$select public.nn_handles_recent(array['strava'])$q$, 'not_signed_in');
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(pg_temp.names(public.nn_handles_recent(array['strava'])) = 'Kim,Maya', 'only the switch, newest first; Sam, off, not even to himself');
select pg_temp.ok(public.nn_handles_recent(array['strava']) -> 1 = jsonb_build_object('display_name', 'Maya', 'neighborhood', 'south-end', 'handles', '{"strava":"maya_runs"}'::jsonb,
                    'updated_at', to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD'), 'me', false), 'first name, neighborhood, only the kinds asked for, the day, me');
select pg_temp.ok(public.nn_handles_recent()::text !~ '@|1111|2222|user_id|T[0-9]{2}:', 'never an email, an account id or a time');
select pg_temp.ok(pg_temp.names(public.nn_handles_recent(null)) = 'Lee,Kim,Maya' and pg_temp.names(public.nn_handles_recent('{}', 1)) = 'Lee', 'null or empty asks for every kind; the limit holds');
select pg_temp.expect_error($q$select public.nn_handles_recent(array['myspace'])$q$, 'bad_handle');
select pg_temp.expect_error($q$select public.nn_handles_recent(array['strava', null])$q$, 'bad_handle');
select pg_temp.who('33333333-3333-3333-3333-333333333333');
select pg_temp.ok((select jsonb_agg(e -> 'me') from jsonb_array_elements(public.nn_handles_recent(array['strava'])) e) = '[true,false]', 'your own row says so');
-- a banned reader drops out; the switch turned off takes them back
select pg_temp.who('11111111-1111-1111-1111-111111111111');
insert into pg_temp.ids select 'maya-post', (public.nn_post_create('square', 'post', 'Hello') ->> 'id')::uuid;
set role anon; select pg_temp.who(null);
select public.nn_mod_act('test-secret', (select id from pg_temp.ids where k = 'maya-post'), 'ban');
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(pg_temp.names(public.nn_handles_recent(array['strava'])) = 'Kim', 'a banned reader drops out');
select pg_temp.who('33333333-3333-3333-3333-333333333333');
select public.nn_profile_set(p_display_name => 'Kim', p_interests => null, p_handles => null, p_handles_public => false);
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(pg_temp.names(public.nn_handles_recent(array['strava'])) = '', 'the switch turned off takes them back');
reset role;
delete from public.nn_bans;
delete from pg_temp.ids;

-- ---------------------------------------------------------------- Games
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_error($q$select public.nn_post_create('games', 'playing', 'Silksong', '', '', '{"game":"Hollow Knight"}')$q$, 'needs_meta');
select pg_temp.expect_error($q$select public.nn_post_create('games', 'playing', 'Silksong', '', '', '{"game":"Hollow Knight","platform":"gameboy"}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('games', 'lfg', 'Ranked', '', '', '{"game":"Valorant","platform":"pc"}')$q$, 'needs_meta');
select pg_temp.expect_error($q$select public.nn_post_create('games', 'playing', 'x', '', '', '{"game":"g","platform":"pc"}', 'submissions/pet0-0001.jpg')$q$, 'photo_not_allowed');
insert into pg_temp.ids select 'playing', (public.nn_post_create('games', 'playing', 'Silksong', '', '', '{"game":"Hollow Knight: Silksong","platform":"switch"}') ->> 'id')::uuid;
insert into pg_temp.ids select 'lfg', (public.nn_post_create('games', 'lfg', 'Ranked', '', '', '{"game":"Valorant","platform":"pc","when":"Weeknights"}') ->> 'id')::uuid;
-- (a post's days are calendar days, so compare by adding them: a span across the clocks changing is an hour off 24 x days)
create function pg_temp.lasts(e jsonb, n int) returns boolean language sql as $$
  select (e ->> 'expires_at')::timestamptz = (e ->> 'created_at')::timestamptz + make_interval(days => n) $$;
grant execute on function pg_temp.lasts(jsonb, int) to anon, authenticated;
select pg_temp.ok((select bool_and(pg_temp.lasts(e, case e ->> 'kind' when 'playing' then 14 else 7 end)) and count(*) = 2
                     from jsonb_array_elements(public.nn_post_mine()) e where e ->> 'board' = 'games'), 'playing lasts 14 days, looking for a group 7');
set role anon; select pg_temp.who(null);
select public.nn_vote((select id from pg_temp.ids where k = 'lfg'), 'p_reader01');
select pg_temp.ok(public.nn_vote((select id from pg_temp.ids where k = 'lfg'), 'p_reader02') ->> 'votes' = '2', 'me too, from anyone');
select pg_temp.ok(jsonb_array_length(public.nn_posts_list('games', 30, null, '{"meta":{"platform":"switch"}}')) = 1, 'the board filters by platform');

-- ----------------------------------------------------------- the Square
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
insert into pg_temp.ids select 'sq-post', (public.nn_post_create('square', 'post', 'The maples are peaking', '', '', '{"topic":"outdoors"}') ->> 'id')::uuid;
insert into pg_temp.ids select 'sq-ask', (public.nn_post_create('square', 'ask', 'Dinner for eight?') ->> 'id')::uuid;
insert into pg_temp.ids select 'sq-free', (public.nn_post_create('square', 'free', 'Kids bike') ->> 'id')::uuid;
select pg_temp.expect_error($q$select public.nn_post_create('square', 'post', 'x', '', '', '{"topic":"gossip"}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('square', 'show', 'Bench')$q$, 'photo_required');
select pg_temp.expect_error($q$select public.nn_post_create('square', 'pets', 'Biscuit')$q$, 'photo_required');
select pg_temp.expect_error($q$select public.nn_post_create('square', 'ask', 'x', '', '', '{}', 'submissions/pet0-0001.jpg')$q$, 'photo_not_allowed');
select pg_temp.ok((select bool_and(pg_temp.lasts(e, case e ->> 'kind' when 'post' then 30 else 14 end)) and count(*) = 4
                     from jsonb_array_elements(public.nn_post_mine()) e where e ->> 'board' = 'square'), 'a post lasts 30 days, a question and a giveaway 14');
\if :has_photos
insert into pg_temp.ids select 'sq-pet', (public.nn_post_create('square', 'pets', 'Biscuit', '', '', '{"topic":"pets"}', 'submissions/pet0-0001.jpg') ->> 'id')::uuid;
insert into pg_temp.ids select 'sq-show', (public.nn_post_create('square', 'show', 'Bench', '', '', '{}', 'submissions/show-0002.jpg') ->> 'id')::uuid;
set role anon; select pg_temp.who(null);
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.nn_posts_list('square')) e where e ->> 'kind' in ('pets', 'show')), 'a pet waits for its photo');
reset role;
update public.btb_photos set status = 'approved' where storage_path in ('submissions/pet0-0001.jpg', 'submissions/show-0002.jpg');
set role anon; select pg_temp.who(null);
select pg_temp.ok((select count(*) from jsonb_array_elements(public.nn_posts_list('square')) e where e ->> 'kind' = 'pets') = 1, 'and shows once it is approved');
\endif

-- ------------------------------------------------------------ Gatherings
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_error($q$select public.nn_post_create('gatherings', 'gathering', 'Run', '', '', '{"when":"Sat","place":"Leddy"}')$q$, 'needs_meta');
select pg_temp.expect_error($q$select public.nn_post_create('gatherings', 'gathering', 'Run', '', '', '{"when":"Sat","place":"Leddy","kind":"rave"}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('gatherings', 'gathering', 'Run', '', '', '{"when":"Sat","kind":"run"}')$q$, 'needs_meta');
select pg_temp.expect_error(format($q$select public.nn_post_create('gatherings', 'gathering', 'Run', '', '', %L)$q$,
  jsonb_build_object('when', 'Sat', 'place', 'Leddy', 'kind', 'run', 'link', l)), 'bad_meta')
  from unnest(array['example.com', 'javascript:alert(1)', 'https://x', 'https://ex ample.com', 'https://example.com/"><b>', 'ftp://example.com',
                    'https://' || repeat('a', 200) || '.com']) l;
select pg_temp.expect_error(format($q$select public.nn_post_create('gatherings', 'gathering', 'Run', '', '', %L)$q$,
  jsonb_build_object('when', pg_temp.day(-1) || ', 7 pm', 'place', 'Leddy', 'kind', 'run')), 'bad_date');
select pg_temp.expect_error(format($q$select public.nn_post_create('gatherings', 'gathering', 'Run', '', '', %L)$q$,
  jsonb_build_object('when', pg_temp.day(181), 'place', 'Leddy', 'kind', 'run')), 'bad_date');
\if :has_photos
select pg_temp.expect_error(format($q$select public.nn_post_create('gatherings', 'gathering', 'Run', '', '', %L, 'submissions/nope-0000.jpg')$q$,
  jsonb_build_object('when', pg_temp.day(-1), 'place', 'Leddy', 'kind', 'run')), 'bad_date');
\endif
insert into pg_temp.ids select 'g-dated', (public.nn_post_create('gatherings', 'gathering', 'Ultimate', 'All levels', '',
  jsonb_build_object('when', pg_temp.day(3) || ', 5:30 pm', 'place', 'Leddy Park', 'kind', 'pickup', 'link', ' https://example.com/ultimate?x=1 ')) ->> 'id')::uuid;
insert into pg_temp.ids select 'g-today', (public.nn_post_create('gatherings', 'gathering', 'Today', '', '',
  jsonb_build_object('when', pg_temp.day(0), 'place', 'Oakledge', 'kind', 'social')) ->> 'id')::uuid;
insert into pg_temp.ids select 'g-ahead', (public.nn_post_create('gatherings', 'gathering', 'Far off', '', '',
  jsonb_build_object('when', pg_temp.day(180), 'place', 'Oakledge', 'kind', 'social')) ->> 'id')::uuid;
insert into pg_temp.ids select 'g-nodate', (public.nn_post_create('gatherings', 'gathering', 'Jam', '', '', '{"when":"Every Tuesday","place":"Radio Bean","kind":"music"}') ->> 'id')::uuid;
select pg_temp.expect_error($q$select public.nn_post_create('gatherings', 'gathering', 'Leap', '', '', '{"when":"2026-02-30","place":"Radio Bean","kind":"music"}')$q$, 'bad_date');
select pg_temp.expect_error($q$select public.nn_post_create('gatherings', 'gathering', 'Leap', '', '', '{"when":"2099-99-99, late","place":"Radio Bean","kind":"music"}')$q$, 'bad_date');
reset role;
select pg_temp.ok((select status from public.nn_posts where id = (select id from pg_temp.ids where k = 'g-dated')) = 'pending', 'a gathering waits for Stephen');
select pg_temp.ok((select meta ->> 'link' from public.nn_posts where id = (select id from pg_temp.ids where k = 'g-dated')) = 'https://example.com/ultimate?x=1', 'its link kept as typed, trimmed');
select pg_temp.ok((select expires_at from public.nn_posts where id = (select id from pg_temp.ids where k = 'g-dated'))
  = ((now() at time zone 'America/New_York')::date + 5)::timestamp at time zone 'America/New_York', 'it ends at midnight, Burlington time, at the end of the day after its date');
select pg_temp.ok((select expires_at = created_at + interval '30 days' from public.nn_posts where id = (select id from pg_temp.ids where k = 'g-nodate')), 'no date: 30 days');
select pg_temp.ok((select count(*) from public.nn_posts where board = 'gatherings' and status = 'pending') = 4, 'today and six months out are both fine');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_posts_list('gatherings') = '[]', 'nothing shows until approved');
select pg_temp.expect_error($q$select public.nn_vote((select id from pg_temp.ids where k = 'g-dated'), 'p_reader01')$q$, 'not_found');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.nn_mod_list('test-secret') -> 'waiting') e where e ->> 'board' = 'gatherings') = 4, 'they wait on the boards desk');
select public.nn_mod_act('test-secret', (select id from pg_temp.ids where k = 'g-dated'), 'approve');
select pg_temp.ok((select jsonb_agg(e -> 'meta' ->> 'link') from jsonb_array_elements(public.nn_posts_list('gatherings', 30, null, '{"meta":{"kind":"pickup"}}')) e)
  = '["https://example.com/ultimate?x=1"]', 'approved, it shows, findable by its sort');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_error(format($q$select public.nn_post_meta_set((select id from pg_temp.ids where k = 'g-dated'), %L)$q$, jsonb_build_object('when', pg_temp.day(-2))), 'bad_date');
select pg_temp.ok((public.nn_post_meta_set((select id from pg_temp.ids where k = 'g-dated'), jsonb_build_object('when', pg_temp.day(10) || ', noon')) ->> 'status') = 'pending',
  'a new date waits for Stephen again');
reset role;
select pg_temp.ok((select expires_at from public.nn_posts where id = (select id from pg_temp.ids where k = 'g-dated'))
  = ((now() at time zone 'America/New_York')::date + 12)::timestamp at time zone 'America/New_York', 'and moves the end with it');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_post_meta_set((select id from pg_temp.ids where k = 'g-dated'), '{"place":"Oakledge"}');
reset role;
select pg_temp.ok((select expires_at from public.nn_posts where id = (select id from pg_temp.ids where k = 'g-dated'))
  = ((now() at time zone 'America/New_York')::date + 12)::timestamp at time zone 'America/New_York', 'another edit leaves the end alone');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_post_meta_set((select id from pg_temp.ids where k = 'g-dated'), '{"when":"Saturdays"}');
reset role;
select pg_temp.ok((select expires_at = created_at + interval '30 days' from public.nn_posts where id = (select id from pg_temp.ids where k = 'g-dated')),
  'no date any more: 30 days from when it went up');
-- a link field anywhere Stephen does not see every post first is refused
select pg_temp.ok(not exists (select 1 from jsonb_each(public.nn_rules() -> 'boards') b, jsonb_each(b.value -> 'meta') f
                               where f.value ->> 'type' = 'url' and (b.value ->> 'premod')::boolean is not true), 'only a pre-moderated board has a link field');

-- ------------------------------------------------- the account takes them
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_delete_me();
reset role;
select pg_temp.ok(not exists (select 1 from public.nn_profiles where user_id = '11111111-1111-1111-1111-111111111111')
              and not exists (select 1 from public.nn_posts where user_id = '11111111-1111-1111-1111-111111111111'), 'Delete my account takes the handles with the profile');

\echo 'test-nn-round4-sql.sql: every case passed'
