-- End-to-end check of nn-ROUND2.sql on the scratch database that
-- scripts/test-nn-sql.sh builds with nn-SETUP.sql, nn-people.sql,
-- nn-watch.sql, db/photos-board.sql and a stand-in for Supabase's storage
-- schema. Every reader call runs as the anon or authenticated role, the
-- way the app's publishable key arrives. The same cases run against the
-- fake backend in scripts/test-boards-core.mjs ("round two: ...").
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
grant execute on all functions in schema pg_temp to anon, authenticated;

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'maya@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'kim@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'lee@example.com');
insert into public.btb_photos (storage_path, status, spot) values
  ('submissions/dsgn-0001.jpg', 'pending', 'All Day · Vintage'), ('submissions/fit0-0002.jpg', 'pending', 'All Day · Vintage'),
  ('submissions/art0-0003.jpg', 'pending', 'All Day · Art');
insert into public.nn_mod (id, pass_hash) values (true, extensions.crypt('test-secret', extensions.gen_salt('bf', 4)))
  on conflict (id) do update set pass_hash = excluded.pass_hash;
create table pg_temp.ids (k text primary key, id uuid);
grant all on pg_temp.ids to anon, authenticated;

-- ------------------------------------------------------------ the locks
set role anon; select pg_temp.who(null);
select pg_temp.ok((public.nn_rules() ->> 'version')::int = 2, 'the round-two rules are the live ones');
select pg_temp.ok(public.nn_rules() -> 'boards' -> 'vintage' -> 'kinds' ? 'spotted', 'and round one''s kinds are still there');
select pg_temp.expect_denied('select public.nn_photo_sweep()');
select pg_temp.expect_denied('select public.nn_sweep()');
select pg_temp.expect_denied($q$select public.nn_check_meta('vintage', 'spotted', '{}')$q$);
select pg_temp.expect_denied('select * from public.nn_profiles');
select pg_temp.ok(not public.nn_photo_orphan('submissions/x.jpg', 'btb-photos', now()), 'anyone may ask if a file is a stray (the storage policies do)');
select pg_temp.expect_error($q$select public.nn_post_meta_set(gen_random_uuid(), '{}')$q$, 'not_signed_in');
select pg_temp.expect_error($q$select public.nn_profile_set('Maya', array['running'])$q$, 'not_signed_in');
select pg_temp.expect_error($q$select public.nn_votes_by_week('food')$q$, 'bad_board');
select pg_temp.ok(public.nn_votes_by_week('art') = '[]'::jsonb, 'no votes, no weeks');

-- ------------------------------------------------- interests on a profile
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(public.nn_profile_set('Maya') ->> 'display_name' = 'Maya', 'the round-one call, positional, still works');
select pg_temp.ok(public.nn_profile_set('Maya', 'old-north-end') ->> 'neighborhood' = 'old-north-end', 'with a neighborhood too');
select pg_temp.ok(public.nn_profile_get() -> 'interests' = '[]'::jsonb, 'no interests yet');
select pg_temp.expect_error($q$select public.nn_profile_set(p_display_name => 'Maya', p_interests => array['running', 'lgbtq'])$q$, 'bad_interest');
select pg_temp.expect_error($q$select public.nn_profile_set(p_display_name => 'Maya', p_interests => array['running', null])$q$, 'bad_interest');
select pg_temp.expect_error($q$select public.nn_profile_set(p_display_name => 'Maya', p_interests => array['sports','running','outdoors','games','music','dance','books','making','languages'])$q$, 'bad_interest');
select pg_temp.expect_error($q$select public.nn_profile_set(p_display_name => 'Maya', p_interests => array['running'], p_neighborhood => 'mars')$q$, 'bad_neighborhood');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Maya', p_interests => array['running', 'books', 'running'], p_neighborhood => 'old-north-end', p_archetype => 'trail') -> 'interests'
  = '["running","books"]'::jsonb, 'a list, each once');
select pg_temp.ok(public.nn_profile_get() = '{"display_name":"Maya","neighborhood":"old-north-end","archetype":"trail","interests":["running","books"]}'::jsonb, 'and read back');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Maya R.', p_neighborhood => 'old-north-end', p_archetype => 'trail') -> 'interests' = '["running","books"]'::jsonb,
  'the round-one call keeps them');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Maya R.', p_interests => null, p_neighborhood => 'old-north-end') -> 'interests' = '["running","books"]'::jsonb, 'a null keeps them');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Maya R.', p_interests => '{}', p_neighborhood => 'old-north-end', p_archetype => 'trail') -> 'interests' = '[]'::jsonb, 'an empty list clears them');
select pg_temp.who('44444444-4444-4444-4444-444444444444');
select pg_temp.ok(public.nn_profile_set(p_display_name => 'Lee', p_interests => array['games']) -> 'interests' = '["games"]'::jsonb, 'a new profile can start with them');

-- ---------------------------------------------------- the new kinds and fields
select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'design', 'Rainy Church Street', '', '', '{"thanks":"shirts"}')$q$, 'photo_required');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'design', 'Rainy Church Street', '', '', '{}', 'submissions/dsgn-0001.jpg')$q$, 'needs_meta');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'design', 'Rainy Church Street', '', '', '{"thanks":"cash"}', 'submissions/dsgn-0001.jpg')$q$, 'bad_meta');
insert into pg_temp.ids select 'design', (public.nn_post_create('vintage', 'design', 'Rainy Church Street', 'Ink', '', '{"thanks":"credit"}', 'submissions/dsgn-0001.jpg') ->> 'id')::uuid;
insert into pg_temp.ids select 'fit', (public.nn_post_create('vintage', 'fit', 'All thrifted', '', '', '{}', 'submissions/fit0-0002.jpg') ->> 'id')::uuid;
select pg_temp.ok((select (e ->> 'expires_at') is null from jsonb_array_elements(public.nn_post_mine()) e where e ->> 'kind' = 'design'), 'a design never ends');
select pg_temp.ok((select (e ->> 'expires_at')::timestamptz = (e ->> 'created_at')::timestamptz + interval '60 days' from jsonb_array_elements(public.nn_post_mine()) e where e ->> 'kind' = 'fit'),
  'a fit check lasts 60 days');
select pg_temp.expect_error($q$select public.nn_post_create('people', 'plan', 'Run', '', '', '{"when":"Sun","meetup":"yes"}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('people', 'plan', 'Run', '', '', '{"when":"Sun","ages":"18"}')$q$, 'bad_meta');
insert into pg_temp.ids select 'plan', (public.nn_post_create('people', 'plan', 'Trivia at Three Needs', '', 'Three Needs', '{"when":"Tue, 7 pm","spots":2,"meetup":true,"ages":"thirties"}') ->> 'id')::uuid;
reset role;
select pg_temp.ok((select meta from public.nn_posts where id = (select id from pg_temp.ids where k = 'plan')) = '{"when":"Tue, 7 pm","spots":2,"meetup":true,"ages":"thirties"}'::jsonb,
  'a plan carries its box (a real true) and its band');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
insert into pg_temp.ids select 'walk', (public.nn_post_create('people', 'plan', 'A slow walk', '', '', '{"when":"Sat, 9 am","meetup":false}') ->> 'id')::uuid;
select pg_temp.expect_error($q$select public.nn_post_create('watch', 'pick', 'Heat', '', '', '{"film":0}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('watch', 'pick', 'Heat', '', '', '{"film":"949"}')$q$, 'bad_meta');
insert into pg_temp.ids select 'heat', (public.nn_post_create('watch', 'pick', 'Heat', '', '', '{"film":949,"year":1995}') ->> 'id')::uuid;
insert into pg_temp.ids select 'ran', (public.nn_post_create('watch', 'pick', 'Ran', '', '', '{"film":11645}') ->> 'id')::uuid;
insert into pg_temp.ids select 'rate1', (public.nn_post_create('watch', 'rating', 'Heat', '', '', '{"stars":5,"film":949}') ->> 'id')::uuid;
insert into pg_temp.ids select 'rate2', (public.nn_post_create('watch', 'rating', 'Ran', '', '', '{"stars":4,"film":11645}') ->> 'id')::uuid;
insert into pg_temp.ids select 'find', (public.nn_post_create('vintage', 'spotted', 'Red barn jacket', '', '', '{"shop":"Old Gold","size":"M"}') ->> 'id')::uuid;

-- ------------------------------------------------- change your own post
set role anon; select pg_temp.who(null);
select pg_temp.expect_error($q$select public.nn_post_meta_set((select id from pg_temp.ids where k = 'find'), '{"got":true}')$q$, 'not_signed_in');
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_error($q$select public.nn_post_meta_set((select id from pg_temp.ids where k = 'find'), '{"got":true}')$q$, 'not_found');
select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_error($q$select public.nn_post_meta_set((select id from pg_temp.ids where k = 'find'), '[1]')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_meta_set((select id from pg_temp.ids where k = 'find'), '{"got":"yes"}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_meta_set((select id from pg_temp.ids where k = 'find'), '{"stars":5}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_meta_set((select id from pg_temp.ids where k = 'find'), '{"shop":null}')$q$, 'needs_meta');
select pg_temp.ok(public.nn_post_meta_set((select id from pg_temp.ids where k = 'find'), '{"got":true,"size":null}') -> 'meta' = '{"shop":"Old Gold","got":true}'::jsonb,
  'merged; a null takes one away');
set role anon; select pg_temp.who(null);
select pg_temp.ok((select jsonb_agg(e ->> 'id') from jsonb_array_elements(public.nn_posts_list('vintage', 30, null, '{"meta":{"got":true}}')) e)
  = jsonb_build_array((select id from pg_temp.ids where k = 'find')::text), 'the board finds it by its box');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(public.nn_post_meta_set((select id from pg_temp.ids where k = 'walk'), '{"meetup":true,"ages":"any"}') -> 'meta' = '{"when":"Sat, 9 am","meetup":true,"ages":"any"}'::jsonb, 'a plan''s box ticked later');
select public.nn_post_meta_set((select id from pg_temp.ids where k = 'walk'), '{"meetup":false}');

-- ------------------------------------------------------- the one-vote ballot
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_vote((select id from pg_temp.ids where k = 'heat'), 'p_reader01') = '{"votes":1,"voted":true,"moved":[]}'::jsonb, 'a first ballot vote');
select pg_temp.ok(public.nn_vote((select id from pg_temp.ids where k = 'ran'), 'p_reader01') = jsonb_build_object('votes', 1, 'voted', true, 'moved', jsonb_build_array((select id from pg_temp.ids where k = 'heat'))),
  'voting for another pick moves the vote');
reset role;
select pg_temp.ok(not exists (select 1 from public.nn_votes where post_id = (select id from pg_temp.ids where k = 'heat')), 'it left the first pick');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_vote((select id from pg_temp.ids where k = 'ran'), 'p_reader01') -> 'moved' = '[]'::jsonb, 'again is still one vote');
select public.nn_vote((select id from pg_temp.ids where k = 'rate1'), 'p_reader01');
select pg_temp.ok(public.nn_vote((select id from pg_temp.ids where k = 'rate2'), 'p_reader01') -> 'moved' = '[]'::jsonb, 'ratings have no one-vote rule');
select pg_temp.ok((public.nn_unvote((select id from pg_temp.ids where k = 'rate1'), 'p_reader01') ->> 'votes')::int = 0, 'unvote as before');
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select public.nn_vote((select id from pg_temp.ids where k = 'heat'));
select pg_temp.ok(public.nn_vote((select id from pg_temp.ids where k = 'ran')) -> 'moved' = jsonb_build_array((select id from pg_temp.ids where k = 'heat')), 'a signed-in vote moves the same way');
select public.nn_vote((select id from pg_temp.ids where k = 'heat'), 'p_reader02');
reset role; update public.nn_posts set expires_at = now() - interval '1 minute' where id = (select id from pg_temp.ids where k = 'heat');
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(public.nn_vote((select id from pg_temp.ids where k = 'ran')) -> 'moved' = '[]'::jsonb, 'a vote on an ended pick stays as it was counted');
reset role;
select pg_temp.ok((select count(*) from public.nn_votes where post_id = (select id from pg_temp.ids where k = 'heat')) = 1, 'still there');
set role authenticated; select pg_temp.who('44444444-4444-4444-4444-444444444444');
insert into pg_temp.ids select 'kes', (public.nn_post_create('watch', 'pick', 'Kes', '', '', '{"film":13384}') ->> 'id')::uuid;
set role anon; select pg_temp.who(null);
select public.nn_vote((select id from pg_temp.ids where k = 'kes'), 'p_reader03');
reset role; update public.nn_posts set status = 'hidden' where id = (select id from pg_temp.ids where k = 'kes');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_vote((select id from pg_temp.ids where k = 'ran'), 'p_reader03') -> 'moved' = jsonb_build_array((select id from pg_temp.ids where k = 'kes')),
  'a vote on a hidden pick moves too, so putting it back never leaves two');

-- ------------------------------------------------- votes by the week cast
-- three votes on the Art post: two cast last week, one this week (Burlington weeks)
set role authenticated; select pg_temp.who('33333333-3333-3333-3333-333333333333');
select public.nn_profile_set('Kim');
insert into pg_temp.ids select 'dawn', (public.nn_post_create('art', 'photo', 'Dawn', '', '', '{}', 'submissions/art0-0003.jpg') ->> 'id')::uuid;
reset role; update public.btb_photos set status = 'approved' where storage_path = 'submissions/art0-0003.jpg';
set role anon; select pg_temp.who(null);
select public.nn_vote((select id from pg_temp.ids where k = 'dawn'), 'p_reader01');
select public.nn_vote((select id from pg_temp.ids where k = 'dawn'), 'p_reader02');
select public.nn_vote((select id from pg_temp.ids where k = 'dawn'), 'p_reader03');
reset role;
create temp table wk as select
  (date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York') as this_monday;
update public.nn_votes set created_at = (select this_monday from wk) - interval '1 second'
 where post_id = (select id from pg_temp.ids where k = 'dawn') and voter in ('p_reader01', 'p_reader02');
update public.nn_votes set created_at = (select this_monday from wk) + interval '1 second'
 where post_id = (select id from pg_temp.ids where k = 'dawn') and voter = 'p_reader03';
create temp table wl as select to_char(now() at time zone 'America/New_York', 'IYYY-"W"IW') as this_week,
  to_char(now() at time zone 'America/New_York' - interval '7 days', 'IYYY-"W"IW') as last_week;
grant select on wk, wl to anon;
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_votes_by_week('art', 2) = jsonb_build_array(
  jsonb_build_object('post', (select id from pg_temp.ids where k = 'dawn'), 'week', (select this_week from wl), 'votes', 1),
  jsonb_build_object('post', (select id from pg_temp.ids where k = 'dawn'), 'week', (select last_week from wl), 'votes', 2)),
  'a second before Monday midnight is last week; a second after is this week');
select pg_temp.ok(public.nn_votes_by_week('art', 1) = jsonb_build_array(
  jsonb_build_object('post', (select id from pg_temp.ids where k = 'dawn'), 'week', (select this_week from wl), 'votes', 1)), 'only the weeks asked for');
select pg_temp.ok(jsonb_array_length(public.nn_votes_by_week('art', 1000)) = 2 and jsonb_array_length(public.nn_votes_by_week('art', -3)) = 1, 'weeks are clamped');
select public.nn_unvote((select id from pg_temp.ids where k = 'dawn'), 'p_reader01');
select pg_temp.ok((public.nn_votes_by_week('art', 2) -> 1 ->> 'votes')::int = 1, 'a vote taken back is no vote');
select pg_temp.ok(public.nn_votes_by_week('vintage') = '[]'::jsonb, 'another board''s votes are its own');
reset role; update public.nn_posts set status = 'hidden' where id = (select id from pg_temp.ids where k = 'dawn');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_votes_by_week('art') = '[]'::jsonb, 'a hidden post''s votes do not count');
reset role; update public.nn_posts set status = 'approved' where id = (select id from pg_temp.ids where k = 'dawn');

-- ---------------------------------------------------------- the photo sweep
reset role;
insert into public.btb_photos (storage_path, status, spot, created_at) values
  ('submissions/left-0007.jpg', 'pending', 'All Day · Vintage', now() - interval '26 hours'),
  ('submissions/new0-0008.jpg', 'pending', 'All Day · Vintage', now() - interval '1 hour'),
  ('submissions/gall-0009.jpg', 'pending', 'North Beach', now() - interval '3 days');
insert into storage.objects (bucket_id, name, created_at) values
  ('btb-photos', 'submissions/lost-0010.jpg', now() - interval '2 days'),   -- uploaded, never filed
  ('btb-photos', 'submissions/lost-0011.jpg', now() - interval '1 hour'),   -- too new to call lost
  ('btb-photos', 'submissions/left-0007.jpg', now() - interval '2 days'),   -- has a queue row
  ('btb-photos', 'submissions/dsgn-0001.jpg', now() - interval '2 days'),   -- a post's photo
  ('btb-photos', 'elsewhere/lost-0012.jpg', now() - interval '2 days'),     -- not a submission
  ('other-bucket', 'submissions/lost-0013.jpg', now() - interval '2 days'); -- not this bucket
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_mod_photo_sweep('wrong') = '{"error":"bad_secret"}'::jsonb, 'the sweep is behind the passphrase');
select pg_temp.ok(public.nn_mod_photo_sweep('test-secret') = '{"abandoned":1,"strays":["submissions/lost-0010.jpg"]}'::jsonb, 'one abandoned queue photo, one stray file');
reset role;
select pg_temp.ok((select status from public.btb_photos where storage_path = 'submissions/left-0007.jpg') = 'removed', 'a day-old board photo nobody posted leaves the queue');
select pg_temp.ok((select status from public.btb_photos where storage_path = 'submissions/new0-0008.jpg') = 'pending', 'one inside its day stays');
select pg_temp.ok((select status from public.btb_photos where storage_path = 'submissions/gall-0009.jpg') = 'pending', 'a gallery photo is never a board''s to sweep');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'nn stray photos%') = 2, 'the two stray policies are on the bucket');
-- as Storage would run a reader's remove call: only the stray is visible, only the stray goes
set role anon; select pg_temp.who(null);
select pg_temp.ok((select array_agg(name) from storage.objects) = array['submissions/lost-0010.jpg'], 'a reader can see the stray and nothing else');
delete from storage.objects where bucket_id = 'btb-photos';
reset role;
select pg_temp.ok((select count(*) from storage.objects) = 5 and not exists (select 1 from storage.objects where name = 'submissions/lost-0010.jpg'), 'and remove only the stray');
-- the opportunistic sweep runs with every new post
insert into public.btb_photos (storage_path, status, spot, created_at) values ('submissions/left-0014.jpg', 'pending', 'All Day · Art', now() - interval '2 days');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_post_create('vintage', 'swap', 'Tee', '', '', '{"want":"free"}');
reset role;
select pg_temp.ok((select status from public.btb_photos where storage_path = 'submissions/left-0014.jpg') = 'removed', 'a new post sweeps abandoned queue photos too');

-- -------------------------------------------------- People's Meetup list
-- a plan from before round two keeps its box in nn-people.sql's side table
set role authenticated; select pg_temp.who('44444444-4444-4444-4444-444444444444');
insert into pg_temp.ids select 'oldplan', (public.nn_post_create('people', 'plan', 'Pickup soccer', '', 'Leddy Park', '{"when":"Sun, 10 am"}') ->> 'id')::uuid;
select public.nn_people_plan_set((select id from pg_temp.ids where k = 'oldplan'), true, 'twenties');
set role anon; select pg_temp.who(null);
select public.nn_vote((select id from pg_temp.ids where k = 'plan'), 'p_reader01');
select pg_temp.ok(public.nn_people_meetup_list('nope') = '{"error":"bad_secret"}'::jsonb, 'behind the passphrase');
select pg_temp.ok((select jsonb_agg(e ->> 'title' order by e ->> 'title') from jsonb_array_elements(public.nn_people_meetup_list('test-secret') -> 'plans') e)
  = '["Pickup soccer","Trivia at Three Needs"]'::jsonb, 'both: the box in the plan and the box in the side table; the walk took its box back');
select pg_temp.ok((select e from jsonb_array_elements(public.nn_people_meetup_list('test-secret') -> 'plans') e where e ->> 'title' = 'Trivia at Three Needs')
  - 'id' - 'created_at' - 'expires_at' = '{"title":"Trivia at Three Needs","when":"Tue, 7 pm","place":"Three Needs","spots":2,"ages":"thirties","author":"Maya R.","going":1}'::jsonb, 'with what Stephen needs');
select pg_temp.ok((select e ->> 'ages' from jsonb_array_elements(public.nn_people_meetup_list('test-secret') -> 'plans') e where e ->> 'title' = 'Pickup soccer') = 'twenties', 'and the side table''s band');

-- ------------------------------------------------------- deleting everything
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((public.nn_delete_me() ->> 'deleted')::boolean, 'delete me still works');
select pg_temp.ok(public.nn_profile_get() is null, 'profile, interests and all');

\echo 'test-nn-round2-sql.sql: every case passed'
