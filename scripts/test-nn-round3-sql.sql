-- End-to-end check of nn-ROUND3.sql ("Delete my account and posts" clears
-- everything) on a scratch database scripts/test-nn-sql.sh builds. It runs
-- in two layouts: everything installed (People, Watch, the photo queue and
-- a storage stand-in), and nothing optional at all (no People, no Watch,
-- no photo queue, no storage). The cases for a missing piece are skipped.
-- Every reader call runs as the anon or authenticated role, the way the
-- app's publishable key arrives.
--
-- Maya deletes her account. Sam and Kim are the other readers: none of
-- their rows may change, including Sam's Watch partner, whose first name
-- is "Maya" (the partner is a name on Sam's own row, never a link to
-- Maya's account).
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
create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', what; end if; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- Every row tied to reader u, table by table, as jsonb: by account id, by
-- voter string (u:<id>), or by hanging off one of the posts in p_posts
-- (the reader's posts, listed before they were deleted). Rows on a post in
-- p_skip (another reader's, about to go with that reader) are left out, as
-- are tables that are not installed. `reports` (a count other readers'
-- reports change) is left off the posts.
create function pg_temp.rows_of(u uuid, p_posts uuid[], p_skip uuid[] default '{}') returns jsonb language plpgsql as $$
declare out jsonb := '{}'; t text; q text; r jsonb;
begin
  for t, q in values
    ('nn_profiles',      'select jsonb_agg(to_jsonb(x) order by x.user_id) from public.nn_profiles x where user_id = $1'),
    ('nn_posts',         'select jsonb_agg(to_jsonb(x) - ''reports'' order by x.id) from public.nn_posts x where user_id = $1 or id = any ($2)'),
    ('nn_votes',         'select jsonb_agg(to_jsonb(x) order by x.post_id, x.voter) from public.nn_votes x where (voter = ''u:'' || $1::text or post_id = any ($2)) and post_id <> all ($3)'),
    ('nn_reports',       'select jsonb_agg(to_jsonb(x) order by x.post_id, x.reporter) from public.nn_reports x where (reporter = $1 or post_id = any ($2)) and post_id <> all ($3)'),
    ('nn_mission_done',  'select jsonb_agg(to_jsonb(x) order by x.key) from public.nn_mission_done x where user_id = $1'),
    ('nn_people_dir',    'select jsonb_agg(to_jsonb(x)) from public.nn_people_dir x where user_id = $1'),
    ('nn_people_plans',  'select jsonb_agg(to_jsonb(x) order by x.post_id) from public.nn_people_plans x where post_id = any ($2)'),
    ('nn_watch_seen',    'select jsonb_agg(to_jsonb(x) order by x.film) from public.nn_watch_seen x where user_id = $1'),
    ('nn_watch_partner', 'select jsonb_agg(to_jsonb(x)) from public.nn_watch_partner x where user_id = $1')
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute q into r using u, coalesce(p_posts, '{}'), coalesce(p_skip, '{}');
    out := out || jsonb_build_object(t, coalesce(r, '[]'));
  end loop;
  return out;
end $$;

-- which optional pieces this layout has
select to_regclass('public.btb_photos') is not null as has_photos,
       to_regclass('public.nn_people_dir') is not null as has_people,
       to_regclass('public.nn_watch_seen') is not null as has_watch,
       to_regclass('storage.objects') is not null as has_storage \gset

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'maya@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'kim@example.com');
create table pg_temp.ids (k text primary key, id uuid);
grant all on pg_temp.ids to anon, authenticated;
insert into public.nn_mod (id, pass_hash) values (true, extensions.crypt('test-secret', extensions.gen_salt('bf', 4)))
  on conflict (id) do update set pass_hash = excluded.pass_hash;

-- ----------------------------------------------------------- the doors
set role anon; select pg_temp.who(null);
select pg_temp.expect_error('select public.nn_delete_me()', 'not_signed_in');
select pg_temp.ok(public.nn_photo_orphan('submissions/x.jpg', 'btb-photos', now() - interval '3 days') is not null,
  'anyone may still ask if a file is a stray (the storage policies do)');
reset role;
select pg_temp.ok(has_function_privilege('anon', 'public.nn_delete_me()', 'execute')
              and has_function_privilege('authenticated', 'public.nn_delete_me()', 'execute')
              and has_function_privilege('anon', 'public.nn_photo_orphan(text, text, timestamptz)', 'execute'),
  'the grants are what they were');
select pg_temp.ok(not exists (select 1 from information_schema.routine_privileges
                               where routine_name in ('nn_delete_me', 'nn_photo_orphan') and grantee = 'PUBLIC'),
  'and PUBLIC has none');

-- ------------------------------------------------- three readers' things
\if :has_photos
insert into public.btb_photos (storage_path, status, spot, caption, credit) values
  ('submissions/maya-0001.jpg', 'pending', 'All Day · Vintage', 'Red barn jacket', 'Maya'),
  ('submissions/maya-0002.jpg', 'pending', 'All Day · Art', 'Oakledge, low water', 'Maya'),
  ('submissions/samm-0001.jpg', 'pending', 'All Day · Vintage', 'Wool coat', 'Sam');
\endif

-- Maya: a profile, a find (with a photo when there is a queue), an Art
-- photo (likewise), a People plan, a Watch pick, a vote on Sam's post, a
-- report on Kim's, missions, the People directory, Watch dots and partner
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_profile_set(p_display_name => 'Maya', p_interests => array['running', 'books'], p_neighborhood => 'old-north-end');
\if :has_photos
insert into pg_temp.ids select 'm_find', (public.nn_post_create('vintage', 'spotted', 'Red barn jacket', '', '', '{"shop":"Old Gold"}', 'submissions/maya-0001.jpg') ->> 'id')::uuid;
insert into pg_temp.ids select 'm_art', (public.nn_post_create('art', 'photo', 'Oakledge, low water', '', '', '{}', 'submissions/maya-0002.jpg') ->> 'id')::uuid;
\else
insert into pg_temp.ids select 'm_find', (public.nn_post_create('vintage', 'spotted', 'Red barn jacket', '', '', '{"shop":"Old Gold"}') ->> 'id')::uuid;
insert into pg_temp.ids select 'm_art', (public.nn_post_create('art', 'notice', 'Free easel') ->> 'id')::uuid;
\endif
insert into pg_temp.ids select 'm_plan', (public.nn_post_create('people', 'plan', 'Trivia', '', 'Three Needs', '{"when":"Tue, 7 pm","meetup":true}') ->> 'id')::uuid;
insert into pg_temp.ids select 'm_pick', (public.nn_post_create('watch', 'pick', 'Heat', '', '', '{"film":949}') ->> 'id')::uuid;
select public.nn_mission_set('m3', true); select public.nn_mission_set('m7', true);
\if :has_people
select public.nn_people_plan_set((select id from pg_temp.ids where k = 'm_plan'), true, 'thirties');
select public.nn_people_optin(true, array['games']);
\endif
\if :has_watch
select public.nn_watch_seen_set(603, true, true, 'Sam');
select public.nn_watch_seen_set(278, true, false);
\endif

-- Sam: the same kinds of things, and a Watch partner named Maya
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select public.nn_profile_set(p_display_name => 'Sam', p_interests => array['games']);
\if :has_photos
insert into pg_temp.ids select 's_find', (public.nn_post_create('vintage', 'spotted', 'Wool coat', '', '', '{"shop":"Battery Street"}', 'submissions/samm-0001.jpg') ->> 'id')::uuid;
\else
insert into pg_temp.ids select 's_find', (public.nn_post_create('vintage', 'spotted', 'Wool coat', '', '', '{"shop":"Battery Street"}') ->> 'id')::uuid;
\endif
insert into pg_temp.ids select 's_plan', (public.nn_post_create('people', 'plan', 'Pickup soccer', '', 'Leddy Park', '{"when":"Sun, 10 am"}') ->> 'id')::uuid;
select public.nn_mission_set('m3', true);
\if :has_people
select public.nn_people_plan_set((select id from pg_temp.ids where k = 's_plan'), true, 'twenties');
select public.nn_people_optin(true, array['running']);
\endif
\if :has_watch
select public.nn_watch_seen_set(603, true, true, 'Maya');
\endif

-- Kim: one post
select pg_temp.who('33333333-3333-3333-3333-333333333333');
select public.nn_profile_set('Kim');
insert into pg_temp.ids select 'k_note', (public.nn_post_create('art', 'notice', 'Open studio Friday') ->> 'id')::uuid;

-- Stephen approves the three photos; then votes and reports every which way
reset role;
\if :has_photos
update public.btb_photos set status = 'approved', decided_at = now() - interval '3 days'
 where storage_path in ('submissions/maya-0001.jpg', 'submissions/maya-0002.jpg', 'submissions/samm-0001.jpg');
\endif
set role authenticated;
select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_vote((select id from pg_temp.ids where k = 's_find'));
select public.nn_vote((select id from pg_temp.ids where k = 'k_note'));
select public.nn_report((select id from pg_temp.ids where k = 'k_note'), 'spam');
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select public.nn_vote((select id from pg_temp.ids where k = 'm_find'));
select public.nn_vote((select id from pg_temp.ids where k = 'k_note'));
select public.nn_report((select id from pg_temp.ids where k = 'm_plan'), 'other');
select pg_temp.who('33333333-3333-3333-3333-333333333333');
select public.nn_vote((select id from pg_temp.ids where k = 's_find'));
select public.nn_vote((select id from pg_temp.ids where k = 'm_pick'));
select public.nn_report((select id from pg_temp.ids where k = 'm_find'), 'spam');
set role anon; select pg_temp.who(null);
select public.nn_vote((select id from pg_temp.ids where k = 'm_art'), 'p_reader01');
select public.nn_vote((select id from pg_temp.ids where k = 's_find'), 'p_reader01');

-- what everyone has right now
reset role;
-- a post Maya never reported keeps whatever count it has, even one the
-- recount would change (here, one left over from before cleared_at)
update public.nn_posts set reports = 5 where id = (select id from pg_temp.ids where k = 's_plan');
-- Stephen banned Maya before she deleted her account
insert into public.nn_bans (user_id) values ('11111111-1111-1111-1111-111111111111');
create temp table maya_posts as select array_agg(id) as ids from pg_temp.ids where k like 'm\_%';
create temp table before as select
  pg_temp.rows_of('11111111-1111-1111-1111-111111111111', (select ids from maya_posts)) as maya,
  pg_temp.rows_of('22222222-2222-2222-2222-222222222222', '{}', (select ids from maya_posts)) as sam,
  pg_temp.rows_of('33333333-3333-3333-3333-333333333333', '{}', (select ids from maya_posts)) as kim,
  (select jsonb_agg(to_jsonb(v) order by v.post_id, v.voter) from public.nn_votes v
    where v.voter <> 'u:11111111-1111-1111-1111-111111111111' and v.post_id <> all ((select ids from maya_posts)::uuid[])) as others_votes;
select pg_temp.ok((select (select count(*) from jsonb_each(maya) e where e.value <> '[]') = (select count(*) from jsonb_each(maya)) from before),
  'Maya has a row in every table there is, so the delete has something to clear');
select pg_temp.ok((select reports from public.nn_posts where id = (select id from pg_temp.ids where k = 'k_note')) = 1, 'Kim''s post carries Maya''s report');

-- ------------------------------------------------------------ the delete
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(public.nn_delete_me() = '{"deleted":true}'::jsonb, 'the same answer as round one');
select pg_temp.ok(public.nn_profile_get() is null and public.nn_post_mine() = '[]'::jsonb and not exists (select 1 from public.nn_missions_done()),
  'she sees nothing of hers');
reset role;
select pg_temp.ok((select jsonb_object_agg(e.key, e.value) from jsonb_each(pg_temp.rows_of('11111111-1111-1111-1111-111111111111', (select ids from maya_posts))) e)
  = (select jsonb_object_agg(e.key, '[]'::jsonb) from before, jsonb_each(before.maya) e), 'no row of Maya''s is left in any table');
select pg_temp.ok(pg_temp.rows_of('22222222-2222-2222-2222-222222222222', '{}', (select ids from maya_posts)) = (select sam from before), 'every row of Sam''s is as it was');
select pg_temp.ok(pg_temp.rows_of('33333333-3333-3333-3333-333333333333', '{}', (select ids from maya_posts)) = (select kim from before), 'every row of Kim''s is as it was');
select pg_temp.ok((select jsonb_agg(to_jsonb(v) order by v.post_id, v.voter) from public.nn_votes v) = (select others_votes from before),
  'every vote not Maya''s and not on her posts is as it was, signed in or not');
select pg_temp.ok((select reports from public.nn_posts where id = (select id from pg_temp.ids where k = 'k_note')) = 0, 'Kim''s post no longer counts Maya''s report');
select pg_temp.ok((select reports from public.nn_posts where id = (select id from pg_temp.ids where k = 's_plan')) = 5, 'a post she never reported is not recounted');
select pg_temp.ok(exists (select 1 from public.nn_bans where user_id = '11111111-1111-1111-1111-111111111111'), 'a ban stays: deleting is no way around one');
select pg_temp.ok(exists (select 1 from auth.users where id = '11111111-1111-1111-1111-111111111111'), 'the shared email sign-in stays');
\if :has_watch
select pg_temp.ok((select name from public.nn_watch_partner where user_id = '22222222-2222-2222-2222-222222222222') = 'Maya'
              and exists (select 1 from public.nn_watch_seen where user_id = '22222222-2222-2222-2222-222222222222' and film = 603 and partner),
  'Sam''s partner named Maya, and Sam''s dots for watching with her, are Sam''s and stay');
\endif
\if :has_people
select pg_temp.ok((public.nn_people_directory() ->> 'count')::int = 1, 'the directory counts Sam alone now');
\endif

-- ------------------------------------------------------------ her photos
\if :has_photos
select pg_temp.ok((select array_agg(status || '|' || caption || '|' || credit order by storage_path) from public.btb_photos
                    where storage_path in ('submissions/maya-0001.jpg', 'submissions/maya-0002.jpg', 'submissions/samm-0001.jpg'))
  = array['removed||', 'removed||', 'approved|Wool coat|Sam'], 'her photos leave the gallery and forget her words and name; Sam''s stays');
set role anon; select pg_temp.who(null);
select pg_temp.ok(not exists (select 1 from public.btb_photos_get() where storage_path like 'submissions/maya-%'), 'not in the gallery');
select pg_temp.ok(not public.nn_photo_orphan('submissions/maya-0002.jpg', 'btb-photos', now() - interval '3 days'),
  'her file is not a stray on the day it was removed (Stephen can still undo it)');
reset role;
update public.btb_photos set decided_at = now() - interval '25 hours' where storage_path like 'submissions/maya-%';
insert into public.btb_photos (storage_path, status, spot, decided_at, created_at) values
  ('submissions/gone-0001.jpg', 'removed', 'North Beach', now() - interval '3 days', now() - interval '4 days'),       -- a gallery photo Stephen removed
  ('submissions/rejd-0001.jpg', 'rejected', 'All Day · Art', now() - interval '3 days', now() - interval '4 days'),     -- a board photo Stephen rejected
  ('submissions/left-0001.jpg', 'pending', 'All Day · Vintage', null, now() - interval '2 hours');                    -- filed, its post not up yet
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_photo_orphan('submissions/maya-0001.jpg', 'btb-photos', now() - interval '3 days')
              and public.nn_photo_orphan('submissions/maya-0002.jpg', 'btb-photos', now() - interval '3 days'),
  'a day later her files are strays, so the desk''s cleanup clears them');
select pg_temp.ok(not public.nn_photo_orphan('submissions/samm-0001.jpg', 'btb-photos', now() - interval '3 days'), 'Sam''s photo is not');
select pg_temp.ok(not public.nn_photo_orphan('submissions/gone-0001.jpg', 'btb-photos', now() - interval '3 days'), 'a gallery photo Stephen removed keeps its file');
select pg_temp.ok(not public.nn_photo_orphan('submissions/rejd-0001.jpg', 'btb-photos', now() - interval '3 days'), 'a rejected board photo keeps its file');
select pg_temp.ok(not public.nn_photo_orphan('submissions/left-0001.jpg', 'btb-photos', now() - interval '3 days'), 'a photo waiting for its post keeps its file');
select pg_temp.ok(not public.nn_photo_orphan('submissions/maya-0001.jpg', 'btb-photos', now() - interval '1 hour'), 'a file less than a day old is never a stray');
select pg_temp.ok(not public.nn_photo_orphan('submissions/maya-0001.jpg', 'other-bucket', now() - interval '3 days'), 'nor one in another bucket');
reset role;
update public.btb_photos set status = 'approved' where storage_path = 'submissions/maya-0001.jpg';
select pg_temp.ok(not public.nn_photo_orphan('submissions/maya-0001.jpg', 'btb-photos', now() - interval '3 days'), 'a photo Stephen puts back keeps its file');
update public.btb_photos set status = 'removed' where storage_path = 'submissions/maya-0001.jpg';
\if :has_storage
insert into storage.objects (bucket_id, name, created_at) values
  ('btb-photos', 'submissions/maya-0001.jpg', now() - interval '3 days'), ('btb-photos', 'submissions/maya-0002.jpg', now() - interval '3 days'),
  ('btb-photos', 'submissions/samm-0001.jpg', now() - interval '3 days'), ('btb-photos', 'submissions/gone-0001.jpg', now() - interval '3 days'),
  ('btb-photos', 'submissions/rejd-0001.jpg', now() - interval '3 days'), ('btb-photos', 'submissions/left-0001.jpg', now() - interval '3 days');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_mod_photo_sweep('test-secret') -> 'strays' = '["submissions/maya-0001.jpg", "submissions/maya-0002.jpg"]'::jsonb,
  'the boards desk lists her two files as strays, and nothing else');
select pg_temp.ok((select array_agg(name order by name) from storage.objects) = array['submissions/maya-0001.jpg', 'submissions/maya-0002.jpg'],
  'a reader asking Storage sees only those two');
delete from storage.objects where bucket_id = 'btb-photos';
reset role;
select pg_temp.ok((select array_agg(name order by name) from storage.objects)
  = array['submissions/gone-0001.jpg', 'submissions/left-0001.jpg', 'submissions/rejd-0001.jpg', 'submissions/samm-0001.jpg'],
  'and the remove call clears only those two');
\endif
\endif

-- ------------------------------------------------------------ once more
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(public.nn_delete_me() = '{"deleted":true}'::jsonb, 'deleting again finds nothing and still says deleted');
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(public.nn_delete_me() = '{"deleted":true}'::jsonb, 'Sam deletes too');
reset role;
select pg_temp.ok((select array_agg(title) from public.nn_posts) = array['Open studio Friday'],
  'only Kim''s post is left');
select pg_temp.ok((select count(*) from public.nn_profiles) = 1, 'and only Kim''s profile');

\echo 'test-nn-round3-sql.sql: every case passed'
