-- End-to-end check of the nn_ functions on the scratch database that
-- scripts/test-nn-sql.sh builds. Every reader call runs as the anon or
-- authenticated role, the way the app's publishable key arrives. The same
-- cases run against the fake backend in scripts/test-boards-core.mjs.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- who is calling: a user id (authenticated) or null (anon)
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
  ('submissions/aaaa-0001.jpg', 'pending', 'All Day · Art'), ('submissions/aaaa-0002.jpg', 'approved', 'All Day · Art'),
  ('submissions/aaaa-0003.jpg', 'rejected', 'All Day · Art'), ('submissions/gall-0004.jpg', 'pending', 'North Beach');
create table pg_temp.ids (k text primary key, id uuid);
grant all on pg_temp.ids to anon, authenticated;

-- ------------------------------------------------------------ the locks
set role anon; select pg_temp.who(null);
select pg_temp.expect_denied('select * from public.nn_posts');
select pg_temp.expect_denied('select * from public.nn_profiles');
select pg_temp.expect_denied('select * from public.nn_votes');
select pg_temp.expect_denied('select * from public.nn_reports');
select pg_temp.expect_denied('select * from public.nn_mod');
select pg_temp.expect_denied('insert into public.nn_bans values (gen_random_uuid())');
select pg_temp.expect_denied('select public.nn_sweep()');
select pg_temp.expect_denied('select public.nn_mod_ok(''x'')');
select pg_temp.expect_denied('select public.nn_check_meta(''vintage'', ''spotted'', ''{}'')');
select pg_temp.expect_denied('select public.nn_missions_done()');
select pg_temp.ok(public.nn_rules() -> 'boards' ? 'vintage', 'anon can read the rules');
select pg_temp.expect_error('select public.nn_profile_get()', 'not_signed_in');
select pg_temp.expect_error($q$select public.nn_profile_set('Maya')$q$, 'not_signed_in');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'x')$q$, 'not_signed_in');
select pg_temp.expect_error('select public.nn_post_mine()', 'not_signed_in');
select pg_temp.expect_error('select public.nn_delete_me()', 'not_signed_in');
select pg_temp.ok(public.nn_posts_list('vintage') = '[]'::jsonb, 'an empty board is an empty list');
select pg_temp.expect_error($q$select public.nn_posts_list('food')$q$, 'bad_board');

-- ------------------------------------------------------------ profiles
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(public.nn_profile_get() is null, 'no profile yet');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'A find', '', '', '{"shop":"Old Gold"}')$q$, 'no_name');
select pg_temp.expect_error($q$select public.nn_profile_set('   ')$q$, 'bad_name');
select pg_temp.expect_error($q$select public.nn_profile_set('maya@example.com')$q$, 'bad_name');
select pg_temp.expect_error($q$select public.nn_profile_set(repeat('m', 33))$q$, 'bad_name');
select pg_temp.expect_error($q$select public.nn_profile_set('Maya', 'mars')$q$, 'bad_neighborhood');
select pg_temp.expect_error($q$select public.nn_profile_set('Maya', null, 'wizard')$q$, 'bad_archetype');
select pg_temp.ok(public.nn_profile_set('  Maya   R. ', 'old-north-end', 'trail') ->> 'display_name' = 'Maya R.', 'a name is tidied');
select pg_temp.ok(public.nn_profile_get() @> '{"display_name":"Maya R.","neighborhood":"old-north-end","archetype":"trail"}'::jsonb, 'and read back');
select pg_temp.ok(public.nn_profile_set('Maya R.', '', '') ->> 'neighborhood' is null, 'empty means none');
select public.nn_profile_set('Maya R.', 'old-north-end', 'trail');

-- ----------------------------------------------------- what a post must be
select pg_temp.expect_error($q$select public.nn_post_create('food', 'dish', 'Pho')$q$, 'bad_board');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'review', 'Pho')$q$, 'bad_kind');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', '  ', '', '', '{"shop":"x"}')$q$, 'bad_title');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', repeat('t', 81), '', '', '{"shop":"x"}')$q$, 'bad_title');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', repeat('b', 601), '', '{"shop":"x"}')$q$, 'bad_body');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', '', repeat('p', 81), '{"shop":"x"}')$q$, 'bad_place');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', '', '', '{"shop":"x","colour":"red"}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', '', '', '{"shop":"x","price":"28"}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', '', '', '{"shop":"x","price":28.5}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', '', '', '{"shop":"x","price":-1}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', '', '', '[1]')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('art', 'photo', 'ok', '', '', '{"shirt":"maybe"}', 'submissions/aaaa-0002.jpg')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', '', '', '{"size":"M"}')$q$, 'needs_meta');
select pg_temp.expect_error($q$select public.nn_post_create('vintage', 'spotted', 'ok', '', '', '{"shop":"   "}')$q$, 'needs_meta');
select pg_temp.expect_error($q$select public.nn_post_create('people', 'plan', 'Run', '', '', '{"when":"Sun 9am"}', 'submissions/aaaa-0002.jpg')$q$, 'photo_not_allowed');
select pg_temp.expect_error($q$select public.nn_post_create('art', 'photo', 'Dawn')$q$, 'photo_required');
select pg_temp.expect_error($q$select public.nn_post_create('art', 'photo', 'Dawn', '', '', '{}', '../etc/passwd')$q$, 'bad_photo');
select pg_temp.expect_error($q$select public.nn_post_create('art', 'photo', 'Dawn', '', '', '{}', 'submissions/nope-9999.jpg')$q$, 'bad_photo');
select pg_temp.expect_error($q$select public.nn_post_create('art', 'photo', 'Dawn', '', '', '{}', 'submissions/aaaa-0003.jpg')$q$, 'bad_photo');
select pg_temp.expect_error($q$select public.nn_post_create('art', 'photo', 'Dawn', '', '', '{}', 'submissions/aaaa-0002.jpg')$q$, 'bad_photo');
select pg_temp.expect_error($q$select public.nn_post_create('art', 'photo', 'Dawn', '', '', '{}', 'submissions/gall-0004.jpg')$q$, 'bad_photo');
select pg_temp.ok(not (public.nn_photo_abandon('submissions/gall-0004.jpg') ->> 'removed')::boolean, 'a gallery photo cannot be abandoned from a board');

-- ------------------------------------------------------------- a real find
insert into pg_temp.ids select 'find', (public.nn_post_create('vintage', 'spotted',
  '1994 UVM crewneck see https://spam.example now', E'Back rack,\n\n\n\nby the boots.  www.spam.example', 'Battery St',
  '{"shop":" Battery Street Jeans ","size":"L","price":28,"want":""}') ->> 'id')::uuid;
reset role;
do $$ declare p public.nn_posts := (select p from public.nn_posts p where id = (select id from pg_temp.ids where k = 'find')); begin
  perform pg_temp.ok(p.title = '1994 UVM crewneck see now', 'links are stripped from the title: ' || p.title);
  perform pg_temp.ok(p.body = E'Back rack,\n\nby the boots.', 'and the body, with blank lines squeezed: ' || p.body);
  perform pg_temp.ok(p.meta = '{"shop":"Battery Street Jeans","size":"L","price":28}'::jsonb, 'meta is tidied, empty fields dropped: ' || p.meta::text);
  perform pg_temp.ok(p.status = 'approved', 'vintage does not pre-moderate');
  perform pg_temp.ok(p.expires_at between now() + interval '20 days 23 hours' and now() + interval '21 days 1 hour', 'a spotted post lasts 21 days');
end $$;

set role anon; select pg_temp.who(null);
do $$ declare l jsonb := public.nn_posts_list('vintage', 30, null, '{}', 'p_reader01'); begin
  perform pg_temp.ok(jsonb_array_length(l) = 1, 'a signed-out reader sees the find');
  perform pg_temp.ok(l -> 0 ->> 'author' = 'Maya R.' and l -> 0 ->> 'author_arch' = 'trail', 'by first name');
  perform pg_temp.ok(not (l -> 0 ? 'user_id') and l::text !~ '@', 'with no account id and no email anywhere');
  perform pg_temp.ok((l -> 0 ->> 'votes')::int = 0 and (l -> 0 ->> 'voted')::boolean = false and (l -> 0 ->> 'mine')::boolean = false, 'no votes, not mine');
  perform pg_temp.ok(public.nn_posts_list('vintage', 30, null, '{"kind":"swap"}') = '[]'::jsonb, 'a kind filter narrows');
  perform pg_temp.ok(jsonb_array_length(public.nn_posts_list('vintage', 30, null, '{"meta":{"size":"L"}}')) = 1, 'a meta filter matches');
  perform pg_temp.ok(public.nn_posts_list('vintage', 30, null, '{"meta":{"size":"M"}}') = '[]'::jsonb, 'and refuses');
  perform pg_temp.ok(public.nn_posts_list('vintage', 30, now() - interval '1 day') = '[]'::jsonb, 'before pages back in time');
end $$;

-- --------------------------------------------------------- votes, signed out
select pg_temp.expect_error($q$select public.nn_vote((select id from pg_temp.ids where k = 'find'), 'x')$q$, 'bad_voter');
select pg_temp.expect_error($q$select public.nn_vote(gen_random_uuid(), 'p_reader01')$q$, 'not_found');
select pg_temp.ok((public.nn_vote((select id from pg_temp.ids where k = 'find'), 'p_reader01') ->> 'votes')::int = 1, 'an anonymous device votes');
select pg_temp.ok((public.nn_vote((select id from pg_temp.ids where k = 'find'), 'p_reader01') ->> 'votes')::int = 1, 'twice is still one vote');
select pg_temp.ok((public.nn_posts_list('vintage', 30, null, '{}', 'p_reader01') -> 0 ->> 'voted')::boolean, 'and sees its own vote');
select pg_temp.ok(not (public.nn_posts_list('vintage', 30, null, '{}', 'p_reader02') -> 0 ->> 'voted')::boolean, 'another device does not');
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((public.nn_vote((select id from pg_temp.ids where k = 'find'), 'p_reader01') ->> 'votes')::int = 2, 'a signed-in vote is the account''s, not the device''s');
set role anon; select pg_temp.who(null);
select pg_temp.ok((public.nn_unvote((select id from pg_temp.ids where k = 'find'), 'p_reader01') ->> 'votes')::int = 1, 'unvote takes one back');
select pg_temp.ok((public.nn_unvote((select id from pg_temp.ids where k = 'find'), 'p_reader01') ->> 'votes')::int = 1, 'unvoting twice is harmless');

-- ------------------------------------------------------- photos and the queue
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
insert into pg_temp.ids select 'art', (public.nn_post_create('art', 'photo', 'North Beach, 6:52 am', '', '', '{"shirt":"yes"}', 'submissions/aaaa-0001.jpg') ->> 'id')::uuid;
select pg_temp.expect_error($q$select public.nn_post_create('art', 'art', 'Again', '', '', '{}', 'submissions/aaaa-0001.jpg')$q$, 'bad_photo');
select pg_temp.ok(public.nn_posts_list('art') = '[]'::jsonb, 'an art post waits for its photo');
select pg_temp.ok(public.nn_post_mine() -> 0 ->> 'photo_state' = 'pending', 'the author sees the photo is waiting');
reset role; update public.btb_photos set status = 'approved' where storage_path = 'submissions/aaaa-0001.jpg';
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_posts_list('art') -> 0 ->> 'photo' = 'submissions/aaaa-0001.jpg', 'once the queue approves it, it shows with its photo');
select pg_temp.ok((public.nn_posts_list('art', 30, null, '{}', null, 'top') -> 0 ->> 'votes')::int = 0, 'top sort works');

-- ------------------------------------------------------------------ reports
select pg_temp.expect_error($q$select public.nn_report((select id from pg_temp.ids where k = 'find'), 'spam')$q$, 'not_signed_in');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_error($q$select public.nn_report((select id from pg_temp.ids where k = 'find'), 'spam')$q$, 'own_post');
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_error($q$select public.nn_report((select id from pg_temp.ids where k = 'find'), 'meh')$q$, 'bad_reason');
select pg_temp.ok(not (public.nn_report((select id from pg_temp.ids where k = 'find'), 'spam') ->> 'hidden')::boolean, 'one report does not hide');
select pg_temp.expect_error($q$select public.nn_report((select id from pg_temp.ids where k = 'find'), 'unkind')$q$, 'already_reported');
select pg_temp.who('33333333-3333-3333-3333-333333333333');
select pg_temp.ok((public.nn_report((select id from pg_temp.ids where k = 'find'), 'unsafe') ->> 'hidden')::boolean, 'the second report hides it');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_posts_list('vintage') = '[]'::jsonb, 'a hidden post is not listed');
select pg_temp.expect_error($q$select public.nn_vote((select id from pg_temp.ids where k = 'find'), 'p_reader01')$q$, 'not_found');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select p ->> 'status' from jsonb_array_elements(public.nn_post_mine()) p where p ->> 'title' like '1994%') = 'pending', 'its author sees it is waiting');

-- --------------------------------------------------------------- moderation
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_mod_list('anything') ->> 'error' = 'bad_secret', 'no passphrase set: the gate is shut');
reset role;
insert into public.nn_mod (id, pass_hash) values (true, extensions.crypt('test-secret', extensions.gen_salt('bf', 4)))
  on conflict (id) do update set pass_hash = excluded.pass_hash;
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_mod_list('wrong') ->> 'error' = 'bad_secret', 'a wrong passphrase is refused');
reset role; select pg_temp.ok((select count(*) from public.nn_mod_fails) = 1, 'and the wrong guess is counted'); delete from public.nn_mod_fails;
set role anon; select pg_temp.who(null);
do $$ declare m jsonb := public.nn_mod_list('test-secret'); begin
  perform pg_temp.ok(jsonb_array_length(m -> 'waiting') = 1 and (m -> 'waiting' -> 0 ->> 'reports')::int = 2, 'the reported post waits, with its two reports');
  perform pg_temp.ok(m -> 'waiting' -> 0 -> 'reasons' @> '["spam","unsafe"]', 'and their reasons');
  perform pg_temp.ok(m::text !~ '@example', 'the mod list carries no email');
end $$;
select pg_temp.ok(public.nn_mod_act('test-secret', (select id from pg_temp.ids where k = 'find'), 'approve') ->> 'ok' = 'true', 'approve');
select pg_temp.ok(jsonb_array_length(public.nn_posts_list('vintage')) = 1, 'an approved post is back');
reset role; select pg_temp.ok((select reports from public.nn_posts where id = (select id from pg_temp.ids where k = 'find')) = 0, 'with its count cleared');
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_error($q$select public.nn_report((select id from pg_temp.ids where k = 'find'), 'spam')$q$, 'already_reported');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_mod_act('test-secret', (select id from pg_temp.ids where k = 'find'), 'shrug') ->> 'error' = 'bad_action', 'an unknown action is refused');
select pg_temp.ok(public.nn_mod_act('test-secret', gen_random_uuid(), 'hide') ->> 'error' = 'not_found', 'an unknown post is refused');

-- --------------------------------------------------------------- the clock
reset role; update public.nn_posts set expires_at = now() - interval '1 hour' where id = (select id from pg_temp.ids where k = 'find');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_posts_list('vintage') = '[]'::jsonb, 'an expired post is not listed');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select (p ->> 'ended')::boolean from jsonb_array_elements(public.nn_post_mine()) p where p ->> 'title' like '1994%'), 'its author sees it ended');
reset role; update public.nn_posts set expires_at = now() - interval '8 days' where id = (select id from pg_temp.ids where k = 'find');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
insert into pg_temp.ids select 'swap', (public.nn_post_create('vintage', 'swap', 'M crewneck for an L flannel', '', '', '{"want":"L flannel"}') ->> 'id')::uuid;
reset role;
select pg_temp.ok(not exists (select 1 from public.nn_posts where id = (select id from pg_temp.ids where k = 'find')), 'a week past its end, the next post sweeps it away');
select pg_temp.ok(not exists (select 1 from public.nn_votes v where v.post_id = (select id from pg_temp.ids where k = 'find')), 'with its votes');
select pg_temp.ok((select expires_at from public.nn_posts where id = (select id from pg_temp.ids where k = 'swap')) > now() + interval '20 days', 'a swap lasts 21 days');

-- -------------------------------------------------------------- the limits
set role authenticated; select pg_temp.who('44444444-4444-4444-4444-444444444444');
select public.nn_profile_set('Lee');
do $$ begin for i in 1..20 loop perform public.nn_post_create('watch', 'pick', 'Pick ' || i); end loop; end $$;
select pg_temp.expect_error($q$select public.nn_post_create('watch', 'pick', 'One too many')$q$, 'rate_day');
select pg_temp.ok((public.nn_posts_list('watch') -> 0 -> 'expires_at') is not null, 'a pick lasts 30 days');
reset role;
do $$ declare j jsonb := public.nn_rules(); begin
  execute format('create or replace function public.nn_rules() returns jsonb language sql immutable as %L',
    'select ' || quote_literal(jsonb_set(j, '{boards,people,premod}', 'true')::text) || '::jsonb');
end $$;
set role authenticated; select pg_temp.who('33333333-3333-3333-3333-333333333333');
select public.nn_profile_set('Kim', 'south-end', 'games');
do $$ begin for i in 1..5 loop perform pg_temp.ok(public.nn_post_create('people', 'plan', 'Pickup soccer ' || i, '', 'Leddy', '{"when":"Sunday 10 am","spots":4}') ->> 'status' = 'pending', 'a pre-moderated board holds posts'); end loop; end $$;
select pg_temp.expect_error($q$select public.nn_post_create('people', 'plan', 'Sixth', '', '', '{"when":"Sat"}')$q$, 'rate_waiting');
select pg_temp.ok(public.nn_posts_list('people') = '[]'::jsonb, 'held posts are not listed');
reset role;
do $$ declare j jsonb := public.nn_rules(); begin
  execute format('create or replace function public.nn_rules() returns jsonb language sql immutable as %L',
    'select ' || quote_literal(jsonb_set(j, '{boards,people,premod}', 'false')::text) || '::jsonb');
end $$;

-- -------------------------------------------------------------------- bans
reset role; insert into pg_temp.ids select 'kim1', id from public.nn_posts where user_id = '33333333-3333-3333-3333-333333333333' limit 1;
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_mod_act('test-secret', (select id from pg_temp.ids where k = 'kim1'), 'ban') ->> 'ok' = 'true', 'ban');
set role authenticated; select pg_temp.who('33333333-3333-3333-3333-333333333333');
select pg_temp.expect_error($q$select public.nn_post_create('watch', 'pick', 'Back again')$q$, 'banned');
select pg_temp.expect_error($q$select public.nn_report((select id from pg_temp.ids where k = 'art'), 'spam')$q$, 'banned');
select pg_temp.ok((select bool_and(p ->> 'status' = 'hidden') from jsonb_array_elements(public.nn_post_mine()) p), 'every post of theirs is hidden');
set role anon; select pg_temp.who(null);
select pg_temp.ok(jsonb_array_length(public.nn_mod_list('test-secret') -> 'bans') = 1, 'the ban list shows them');
select public.nn_mod_unban('test-secret', '33333333-3333-3333-3333-333333333333');
set role authenticated; select pg_temp.who('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(public.nn_post_create('watch', 'rating', 'Winter Light', '', '', '{"stars":5,"year":2024}') ->> 'kind' = 'rating', 'unbanned, they can post again');

-- ------------------------------------------------------------- delete own
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_error($q$select public.nn_post_delete_own((select id from pg_temp.ids where k = 'art'))$q$, 'not_found');
select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((public.nn_post_delete_own((select id from pg_temp.ids where k = 'art')) ->> 'deleted')::boolean, 'an author deletes their own post');
select pg_temp.ok(public.nn_posts_list('art') = '[]'::jsonb, 'and it is gone');
reset role;
select pg_temp.ok((select status from public.btb_photos where storage_path = 'submissions/aaaa-0001.jpg') = 'removed', 'its photo leaves the gallery');

-- ---------------------------------------------------------------- missions
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select public.nn_mission_set('m7', true);
select public.nn_mission_set('m9', true);
select public.nn_mission_set('m9', false);
select pg_temp.ok((select array_agg(key) from public.nn_missions_done()) = array['m7'], 'missions sync for a signed-in reader');
set role anon; select pg_temp.who(null);
select pg_temp.expect_denied($q$select public.nn_mission_set('m7', true)$q$);

-- -------------------------------------------------------- delete everything
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select public.nn_profile_set('Sam');
insert into pg_temp.ids select 'sam', (public.nn_post_create('watch', 'rating', 'Causeway', '', '', '{"stars":4}') ->> 'id')::uuid;
select public.nn_vote((select id from pg_temp.ids where k = 'swap'));
select public.nn_report((select id from pg_temp.ids where k = 'swap'), 'other');
select pg_temp.ok((public.nn_delete_me() ->> 'deleted')::boolean, 'delete me');
select pg_temp.ok(public.nn_profile_get() is null and public.nn_post_mine() = '[]'::jsonb, 'their profile and posts are gone');
select pg_temp.ok(not exists (select 1 from public.nn_missions_done()), 'and their missions');
reset role;
select pg_temp.ok(not exists (select 1 from public.nn_votes where voter = 'u:22222222-2222-2222-2222-222222222222'), 'and their votes');
select pg_temp.ok(not exists (select 1 from public.nn_reports where reporter = '22222222-2222-2222-2222-222222222222'), 'and their reports');
select pg_temp.ok(exists (select 1 from auth.users where id = '22222222-2222-2222-2222-222222222222'), 'the shared email sign-in itself stays');
select pg_temp.ok((select reports from public.nn_posts where id = (select id from pg_temp.ids where k = 'swap')) = 0, 'and their report no longer counts against the post');
-- an old report Stephen already cleared must not erase a newer one
set role authenticated; select pg_temp.who('33333333-3333-3333-3333-333333333333');
insert into pg_temp.ids select 'p2', (public.nn_post_create('art', 'notice', 'Free easel, Old North End porch') ->> 'id')::uuid;
select pg_temp.who('11111111-1111-1111-1111-111111111111'); select public.nn_report((select id from pg_temp.ids where k = 'p2'), 'spam');
set role anon; select pg_temp.who(null);
select public.nn_mod_act('test-secret', (select id from pg_temp.ids where k = 'p2'), 'approve');
reset role; update public.nn_posts set cleared_at = now() - interval '1 second' where id = (select id from pg_temp.ids where k = 'p2');
update public.nn_reports set created_at = now() - interval '2 seconds' where post_id = (select id from pg_temp.ids where k = 'p2');
set role authenticated; select pg_temp.who('44444444-4444-4444-4444-444444444444'); select public.nn_report((select id from pg_temp.ids where k = 'p2'), 'unkind');
select pg_temp.who('11111111-1111-1111-1111-111111111111'); select public.nn_delete_me();
reset role;
select pg_temp.ok((select reports from public.nn_posts where id = (select id from pg_temp.ids where k = 'p2')) = 1, 'a cleared old report goes; the newer one still counts');
reset role; insert into public.btb_photos (storage_path, status, spot) values ('submissions/left-0006.jpg', 'pending', 'All Day · Vintage');
set role anon; select pg_temp.who(null);
select pg_temp.ok((public.nn_photo_abandon('submissions/left-0006.jpg') ->> 'removed')::boolean, 'a board photo whose post never happened leaves the queue');
reset role; select pg_temp.ok((select status from public.btb_photos where storage_path = 'submissions/left-0006.jpg') = 'removed', 'marked removed');

-- ------------------------------------------- board photos and the gallery
reset role;
insert into public.btb_photos (storage_path, status, decided_at, spot, category) values
  ('submissions/vint-0001.jpg', 'approved', now(), 'All Day · Vintage', 'board'),
  ('submissions/art0-0001.jpg', 'approved', now(), 'All Day · Art', 'other');
set role anon; select pg_temp.who(null);
select pg_temp.ok(not exists (select 1 from public.btb_photos_get() where storage_path = 'submissions/vint-0001.jpg'), 'a Vintage photo stays out of the community gallery');
select pg_temp.ok(exists (select 1 from public.btb_photos_get() where storage_path = 'submissions/art0-0001.jpg'), 'an Art photo joins it');
select pg_temp.ok(not exists (select 1 from public.btb_photos_potw() where category = 'board'), 'and a board photo is never photo of the week');
reset role;
select pg_temp.ok(public.nn_photo_state('submissions/vint-0001.jpg') = 'approved', 'while the board post still sees its photo approved');

\echo 'test-nn-sql.sql: every case passed'
