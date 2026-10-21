-- End-to-end check of bd-SETUP.sql (The Build) on the scratch database
-- scripts/test-bd-sql.sh builds. Four invented neighbours (Alex, Dev, Kate,
-- Ann) go through the app's own doors as the anon or authenticated role, the
-- way the publishable key arrives. scripts/test-build-core.mjs runs the same
-- cases against the fake. :others is 1 when the boards, Habits and the photo
-- queue are installed too.
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
create table pg_temp.ids (k text primary key, id uuid);
grant all on pg_temp.ids to anon, authenticated;

\set ALEX '''bd000000-0000-4000-8000-0000000a1e00'''
\set DEV '''bd000000-0000-4000-8000-0000000de500'''
\set KATE '''bd000000-0000-4000-8000-0000000ca7e0'''
\set ANN '''bd000000-0000-4000-8000-0000000a2200'''
insert into auth.users values (:ALEX, 'alex@example.com'), (:DEV, 'dev@example.com'), (:KATE, 'kate@example.com'), (:ANN, 'ann@example.com')
  on conflict do nothing;

-- -------------------------------------------------------------- the locks
set role anon; select pg_temp.who(null);
select pg_temp.expect_denied('select * from public.' || t) from unnest(array['bd_builder', 'bd_things', 'bd_shifts', 'bd_posts', 'bd_nice',
  'bd_help', 'bd_presence', 'bd_reports', 'bd_blocks']) t;
select pg_temp.expect_denied('select public.bd_post_json(p, null) from public.bd_posts p');
select pg_temp.expect_denied('select public.bd_name(gen_random_uuid())');
select pg_temp.expect_denied('select public.bd_photo_remove(''x'')');
select pg_temp.expect_error('select public.bd_thing_get()', 'not_signed_in');
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''x'')', 'not_signed_in');
select pg_temp.expect_error('select public.bd_help_offer(gen_random_uuid(), ''x'')', 'not_signed_in');
select pg_temp.expect_error('select public.bd_presence_beat(''haul'')', 'not_signed_in');
select pg_temp.ok(public.bd_rules() ->> 'version' = '1', 'the rules are public');
select pg_temp.ok(public.bd_feed() = '[]'::jsonb, 'an empty feed, signed out');
select pg_temp.ok((public.bd_town() ->> 'total_minutes')::int = 0, 'an empty town');
select pg_temp.ok(public.bd_public_things() = '[]'::jsonb, 'no public things yet');
set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.expect_denied('insert into public.bd_shifts (user_id, client_id, kind, day, minutes) values (' || quote_literal(:ALEX) || ', ''abcdefgh'', ''logged'', current_date, 9)');
reset role;

-- ------------------------------------------------------- builder and thing
set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.ok(public.bd_builder_get() is null, 'no builder yet');
select pg_temp.expect_error('select public.bd_builder_set(''plaid'')', 'bad_look');
select pg_temp.expect_error('select public.bd_builder_set(null, null, ''alex@example.com'')', 'bad_name');
select pg_temp.ok(public.bd_builder_set(null, 'lime') = '{"hat":"yellow","vest":"lime","first_name":"","first_name_public":false}', 'defaults fill in');
select pg_temp.ok(public.bd_thing_get() = '{"thing":null,"done":[]}', 'no thing yet');
select pg_temp.expect_error('select public.bd_thing_set()', 'bad_title');
select pg_temp.expect_error('select public.bd_thing_set(''T'', repeat(''w'', 281))', 'bad_why');
select pg_temp.expect_error('select public.bd_thing_set(''T'', null, null, null, ''2026-02-30'')', 'bad_date');
select pg_temp.expect_error('select public.bd_thing_status(''done'')', 'no_thing');
select pg_temp.ok(public.bd_thing_set('  Fix up   the old Raleigh https://x.co ', 'It was my mom''s.', 'my niece', '', '2026-12-01') @>
  '{"title":"Fix up the old Raleigh","why":"It was my mom''s.","for_whom":"my niece","target_date":"2026-12-01","status":"active","why_public":false,"has_posts":false}',
  'made: tidied, link dropped');
select pg_temp.ok(public.bd_thing_set(null, null, null, null, '') ->> 'target_date' is null, ''''' clears the date, null keeps the rest');
select pg_temp.ok(public.bd_thing_get() -> 'thing' ->> 'title' = 'Fix up the old Raleigh', 'one thing, kept');
select pg_temp.ok(public.bd_thing_status('paused') ->> 'status' = 'paused', 'paused');
select pg_temp.expect_error('select public.bd_thing_status(''lost'')', 'bad_status');
select pg_temp.ok(public.bd_thing_status('active') ->> 'status' = 'active', 'back on');
insert into pg_temp.ids select 'raleigh', (public.bd_thing_get() -> 'thing' ->> 'id')::uuid;
reset role;

-- ------------------------------------------------------------------ hours
set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.expect_error('select public.bd_shift_add(''bad id!'', now() - interval ''1 hour'', now(), 30)', 'bad_shift');
select pg_temp.expect_error('select public.bd_shift_add(''shift-0001'', now(), now() - interval ''1 hour'', 30)', 'bad_shift');
select pg_temp.expect_error('select public.bd_shift_add(''shift-0001'', now() - interval ''20 days'', now() - interval ''19 days'', 30)', 'bad_shift');
select pg_temp.expect_error('select public.bd_shift_add(''shift-0001'', now() - interval ''20 minutes'', now(), 30)', 'bad_minutes');
select pg_temp.expect_error('select public.bd_shift_add(''shift-0001'', now() - interval ''13 hours'', now(), 721)', 'bad_minutes');
insert into pg_temp.ids select 'shift1', (public.bd_shift_add('shift-0001', now() - interval '50 minutes', now(), 45, ' true the wheel ', 'trued it',
  (select id from pg_temp.ids where k = 'raleigh')) ->> 'id')::uuid;
select pg_temp.ok((public.bd_shift_add('shift-0001', now() - interval '50 minutes', now(), 45) ->> 'id')::uuid = (select id from pg_temp.ids where k = 'shift1'),
  'the same client id answers the first shift');
select pg_temp.ok(public.bd_shift_add('shift-0002', now() - interval '20 minutes', now(), 10, '', '', gen_random_uuid()) ->> 'thing' is null,
  'a thing that is not yours is dropped, the hours kept');
select pg_temp.expect_error('select public.bd_log_add(''log-00001'', 0)', 'bad_minutes');
select pg_temp.expect_error('select public.bd_log_add(''log-00001'', 30, '''', ((now() at time zone ''America/New_York'')::date) - 8)', 'bad_day');
select pg_temp.expect_error('select public.bd_log_add(''log-00001'', 30, '''', ((now() at time zone ''America/New_York'')::date) + 1)', 'bad_day');
select pg_temp.ok(public.bd_log_add('log-00001', 120, 'a run', ((now() at time zone 'America/New_York')::date) - 2) @> '{"kind":"logged","minutes":120}', 'logged');
select public.bd_log_add('log-00002', 720, '', ((now() at time zone 'America/New_York')::date) - 3);
select public.bd_log_add('log-00003', 700, '', ((now() at time zone 'America/New_York')::date) - 3);
select pg_temp.expect_error('select public.bd_log_add(''log-00004'', 30, '''', ((now() at time zone ''America/New_York'')::date) - 3)', 'too_much');
select pg_temp.expect_error('select public.bd_my_record(((now() at time zone ''America/New_York'')::date), ((now() at time zone ''America/New_York'')::date) - 1)', 'bad_range');
select pg_temp.expect_error('select public.bd_my_record(((now() at time zone ''America/New_York'')::date) - 370, ((now() at time zone ''America/New_York'')::date))', 'bad_range');
select pg_temp.ok(jsonb_array_length(public.bd_my_record(((now() at time zone 'America/New_York')::date) - 369, ((now() at time zone 'America/New_York')::date)) -> 'days') = 3, 'three days with hours');
select pg_temp.ok((select sum((d ->> 'minutes')::int) from jsonb_array_elements(public.bd_my_record(((now() at time zone 'America/New_York')::date) - 369, ((now() at time zone 'America/New_York')::date)) -> 'days') d) = 1595,
  'every minute on your record');
reset role;
select pg_temp.ok((select step from public.bd_shifts where client_id = 'shift-0001') = 'true the wheel', 'the step kept, tidied');

-- ------------------------------------------------------------------ posts
set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''Tires off.'')', 'no_name');
select public.bd_builder_set(null, null, 'Alex', true);
select pg_temp.expect_error('select public.bd_post_create(''brag'', ''x'')', 'bad_kind');
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''   '')', 'bad_line');
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''x'', null, null, ''unclear'')', 'bad_stuck');
select pg_temp.expect_error('select public.bd_post_create(''stuck'', ''x'', null, null, null, ''money'')', 'bad_stuck');
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''x'', null, 0)', 'bad_minutes');
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''x'', ''../etc/passwd'')', 'bad_photo');
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''x'', ''submissions/abc-1.jpg'')', 'bad_photo');
insert into pg_temp.ids select 'prog', (public.bd_post_create('progress', 'Got the old tires off.', null, 45, null, null, true,
  (select id from pg_temp.ids where k = 'shift1')) ->> 'id')::uuid;
insert into pg_temp.ids select 'stuck', (public.bd_post_create('stuck', 'The rear caliper is seized.', null, null, 'missing', 'tool') ->> 'id')::uuid;
select pg_temp.ok(public.bd_thing_get() -> 'thing' ->> 'has_posts' = 'true', 'the thing has posts now');
select pg_temp.ok(jsonb_array_length(public.bd_shelf()) = 2 and public.bd_shelf() -> 0 ->> 'line' = 'Got the old tires off.', 'the shelf, oldest first');
select pg_temp.ok(public.bd_feed() -> 0 @> '{"kind":"stuck","author":"Alex","thing":"Fix up the old Raleigh","mine":true,"offers_waiting":0}', 'the feed, newest first');
select pg_temp.ok(jsonb_array_length(public.bd_feed(null, 30, null, true)) = 1, 'the Brief''s yes');
select pg_temp.expect_error('select public.bd_nice(' || quote_literal((select id from pg_temp.ids where k = 'prog')) || ')', 'own_post');
reset role;
select pg_temp.ok((select posted from public.bd_shifts where client_id = 'shift-0001'), 'the shift is marked posted');

set role authenticated; select pg_temp.who(:DEV);
select public.bd_builder_set('blue', 'pink', 'Dev', false);
select pg_temp.ok(public.bd_nice((select id from pg_temp.ids where k = 'prog')) = '{"nice":1,"niced":true}', 'Nice');
select pg_temp.ok(public.bd_nice((select id from pg_temp.ids where k = 'prog')) = '{"nice":0,"niced":false}', 'and back');
select public.bd_nice((select id from pg_temp.ids where k = 'prog'));
select pg_temp.expect_error('select public.bd_help_offer(' || quote_literal((select id from pg_temp.ids where k = 'prog')) || ', ''I can'')', 'not_stuck');
select pg_temp.expect_error('select public.bd_help_offer(' || quote_literal((select id from pg_temp.ids where k = 'stuck')) || ', '' '')', 'bad_help_line');
insert into pg_temp.ids select 'offer', (public.bd_help_offer((select id from pg_temp.ids where k = 'stuck'), 'I restore old Raleighs. Saturday?') ->> 'id')::uuid;
select pg_temp.expect_error('select public.bd_help_offer(' || quote_literal((select id from pg_temp.ids where k = 'stuck')) || ', ''again'')', 'already_offered');
select pg_temp.expect_error('select public.bd_help_respond(' || quote_literal((select id from pg_temp.ids where k = 'offer')) || ', true)', 'not_found');
select pg_temp.ok(public.bd_feed(null, 30, 'stuck') -> 0 ->> 'offered' = 'true', 'you offered');
reset role;

set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.ok(public.bd_feed(null, 30, 'stuck') -> 0 ->> 'offers_waiting' = '1', 'one offer waits');
select pg_temp.ok(public.bd_help_list() -> 'incoming' -> 0 @> '{"name":"Dev","line":"I restore old Raleighs. Saturday?","status":"offered","post_line":"The rear caliper is seized."}',
  'the poster sees a first name and a line');
select pg_temp.ok(public.bd_help_respond((select id from pg_temp.ids where k = 'offer'), true) ->> 'status' = 'accepted', 'Yes');
select pg_temp.expect_error('select public.bd_help_respond(' || quote_literal((select id from pg_temp.ids where k = 'offer')) || ', false)', 'already_answered');
reset role;
select pg_temp.ok((select status = 'accepted' and intro_sent_at is null from public.bd_help where id = (select id from pg_temp.ids where k = 'offer')),
  'accepted, waiting for bd-intro to send');

-- the email path never leaves the server: no answer anyone gets carries an email or an account id
set role authenticated; select pg_temp.who(:DEV);
select pg_temp.ok(public.bd_help_list() -> 'outgoing' -> 0 @> '{"name":"Alex","status":"accepted"}', 'the helper sees the Yes');
create temp table answers as select (public.bd_help_list() || jsonb_build_object('feed', public.bd_feed(), 'town', public.bd_town(), 'things', public.bd_public_things()))::text as j;
reset role;
select pg_temp.ok((select j from answers) !~ '@|bd000000', 'no email and no account id in anything a reader sees');

-- ------------------------------------------------------ reports and blocks
set role authenticated; select pg_temp.who(:KATE);
select public.bd_builder_set(null, null, 'Kate');
insert into pg_temp.ids select 'creepy', (public.bd_help_offer((select id from pg_temp.ids where k = 'stuck'), 'call me') ->> 'id')::uuid;
insert into pg_temp.ids select 'spam', (public.bd_post_create('found', 'buy my stuff') ->> 'id')::uuid;
select pg_temp.expect_error('select public.bd_report(''post'', ' || quote_literal((select id from pg_temp.ids where k = 'spam')) || ', ''spam'')', 'own_post');
reset role;
set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.expect_error('select public.bd_report(''post'', gen_random_uuid(), ''rude'')', 'bad_reason');
select pg_temp.expect_error('select public.bd_report(''thing'', gen_random_uuid(), ''spam'')', 'bad_target');
select pg_temp.ok(public.bd_report('help', (select id from pg_temp.ids where k = 'creepy'), 'unsafe') = '{"hidden":true}', 'a poster''s report declines the offer');
select pg_temp.ok(public.bd_report('post', (select id from pg_temp.ids where k = 'spam'), 'spam') = '{"hidden":false}', 'one report');
select pg_temp.expect_error('select public.bd_report(''post'', ' || quote_literal((select id from pg_temp.ids where k = 'spam')) || ', ''spam'')', 'already_reported');
reset role;
set role authenticated; select pg_temp.who(:DEV);
select pg_temp.ok(public.bd_report('post', (select id from pg_temp.ids where k = 'spam'), 'spam') = '{"hidden":true}', 'two hide it');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.bd_feed()) p where p ->> 'line' = 'buy my stuff'), 'gone from the feed');
reset role;
select pg_temp.ok((select status from public.bd_help where id = (select id from pg_temp.ids where k = 'creepy')) = 'declined', 'declined');

set role authenticated; select pg_temp.who(:ANN);
select public.bd_builder_set(null, null, 'Ann');
insert into pg_temp.ids select 'ann_offer', (public.bd_help_offer((select id from pg_temp.ids where k = 'stuck'), 'happy to help') ->> 'id')::uuid;
insert into pg_temp.ids select 'ann_post', (public.bd_post_create('progress', 'ann was here') ->> 'id')::uuid;
reset role;
set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.ok(public.bd_block('help', (select id from pg_temp.ids where k = 'ann_offer')) = '{"blocked":true}', 'blocked');
select pg_temp.ok(public.bd_block('post', (select id from pg_temp.ids where k = 'ann_post')) = '{"blocked":true}', 'twice is fine');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.bd_feed()) p where p ->> 'line' = 'ann was here'), 'you no longer see them');
select pg_temp.expect_error('select public.bd_nice(' || quote_literal((select id from pg_temp.ids where k = 'ann_post')) || ')', 'not_found');
select pg_temp.ok(public.bd_blocks_get() -> 0 ->> 'name' = 'Ann' and jsonb_array_length(public.bd_blocks_get()) = 1, 'your blocks, by first name');
reset role;
select pg_temp.ok((select status from public.bd_help where id = (select id from pg_temp.ids where k = 'ann_offer')) = 'declined', 'a block declines what waits');
set role authenticated; select pg_temp.who(:ANN);
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.bd_feed()) p where p ->> 'mine' = 'false' and p ->> 'author' = 'Alex'), 'nor they you');
reset role;
set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.ok(public.bd_unblock((select (b ->> 'id')::uuid from jsonb_array_elements(public.bd_blocks_get()) b limit 1)) = '{"unblocked":true}', 'unblocked');
select pg_temp.expect_error('select public.bd_unblock(gen_random_uuid())', 'not_found');
reset role;

-- --------------------------------------------------- the town and presence
set role authenticated; select pg_temp.who(:ALEX);
select pg_temp.expect_error('select public.bd_presence_beat(''nap'')', 'bad_task');
select public.bd_presence_beat('brick');
reset role;
set role authenticated; select pg_temp.who(:DEV);
select public.bd_presence_beat('wire');
reset role;
set role anon; select pg_temp.who(null);
create temp table town as select public.bd_town() as t;
reset role;
select pg_temp.ok((select (t ->> 'on_shift_count')::int from town) = 2, 'two on shift');
select pg_temp.ok((select t -> 'on_shift' -> 0 from town) @> '{"look":{"hat":"yellow","vest":"lime"},"task":"brick","name":"Alex","me":false}', 'Alex shows her name');
select pg_temp.ok((select (t -> 'on_shift' -> 1 -> 'name') = 'null'::jsonb from town), 'Dev does not');
select pg_temp.ok((select t -> 'on_shift' -> 0 ->> 'id' from town) <> :ALEX, 'a public id, never the account');
select pg_temp.ok((select (t ->> 'total_minutes')::int from town) = 1595, 'every minute in the town');
select pg_temp.ok((select (t ->> 'posts_lit')::int from town) = 3, 'three lit windows (the hidden post is dark)');
select pg_temp.ok((public.bd_town(((now() at time zone 'America/New_York')::date) - 2) ->> 'total_minutes')::int = 175, 'since a season start');
set role authenticated; select pg_temp.who(:DEV);
select pg_temp.ok(public.bd_town() -> 'on_shift' -> 1 ->> 'me' = 'true', 'you are marked to yourself');
reset role;
update public.bd_presence set heartbeat = now() - interval '4 minutes' where user_id = :DEV;
select pg_temp.ok((public.bd_town() ->> 'on_shift_count')::int = 1, 'three quiet minutes and you are off the site');
insert into pg_temp.ids select 'dev_public', public_id from public.bd_presence where user_id = :DEV;
set role authenticated; select pg_temp.who(:DEV);
select public.bd_presence_beat('roof');
reset role;
select pg_temp.ok((select public_id from public.bd_presence where user_id = :DEV) <> (select id from pg_temp.ids where k = 'dev_public'), 'a new shift, a new public id');
set role authenticated; select pg_temp.who(:ALEX);
select public.bd_presence_end();
reset role;
select pg_temp.ok((public.bd_town() ->> 'on_shift_count')::int = 1, 'ending takes you off');

-- ----------------------------------------------------- the starter door
set role authenticated; select pg_temp.who(:DEV);
select public.bd_thing_set('Build a canoe', 'The lake is right there.', null, null, null, true);
select public.bd_post_create('found', 'The ONE community center has a woodshop.');
select public.bd_thing_set('Build a canoe');
reset role;
set role anon; select pg_temp.who(null);
select pg_temp.ok(jsonb_array_length(public.bd_public_things()) = 2, 'two things with posts');
select pg_temp.ok(public.bd_public_things() -> 0 @> '{"title":"Build a canoe","why":"The lake is right there.","last_kind":"found"}'
  and public.bd_public_things() -> 0 -> 'name' = 'null'::jsonb, 'why shown (opted in), name hidden (Dev hides it)');
select pg_temp.ok(public.bd_public_things() -> 1 @> '{"title":"Fix up the old Raleigh","name":"Alex","last_kind":"stuck"}'
  and public.bd_public_things() -> 1 -> 'why' = 'null'::jsonb, 'why hidden (not opted in), name shown');
select pg_temp.ok(public.bd_public_things() -> 0 ->> 'last_at' = to_char(((now() at time zone 'America/New_York')::date), 'YYYY-MM-DD'), 'a day, not a time');
reset role;
set role authenticated; select pg_temp.who(:DEV);
select pg_temp.ok(jsonb_array_length(public.bd_public_things()) = 1, 'not your own');
reset role;

-- ------------------------------------------------- moving a phone's hours
set role authenticated; select pg_temp.who(:KATE);
select pg_temp.expect_error('select public.bd_import_local(''{"extra":1}'')', 'bad_import');
select pg_temp.expect_error('select public.bd_import_local(''{"thing":{"title":""}}'')', 'bad_import');
select pg_temp.expect_error($q$select public.bd_import_local(jsonb_build_object('shifts', jsonb_build_array(jsonb_build_object('client_id','abcdefgh-1','kind','shift','day',to_char(((now() at time zone 'America/New_York')::date) + 1,'YYYY-MM-DD'),'minutes',30))))$q$, 'bad_import');
select pg_temp.expect_error($q$select public.bd_import_local(jsonb_build_object('shifts', jsonb_build_array(jsonb_build_object('client_id','abcdefgh-1','kind','shift','day',to_char(((now() at time zone 'America/New_York')::date),'YYYY-MM-DD'),'minutes',720), jsonb_build_object('client_id','abcdefgh-2','kind','shift','day',to_char(((now() at time zone 'America/New_York')::date),'YYYY-MM-DD'),'minutes',721))))$q$, 'bad_import');
select pg_temp.expect_error($q$select public.bd_import_local(jsonb_build_object('shifts', jsonb_build_array(jsonb_build_object('client_id','abcdefgh-1','kind','shift','day',to_char(((now() at time zone 'America/New_York')::date),'YYYY-MM-DD'),'minutes',30.5))))$q$, 'bad_import');
select pg_temp.expect_error($q$select public.bd_import_local(jsonb_build_object('builder', jsonb_build_object('hat','plaid')))$q$, 'bad_import');
select pg_temp.ok(public.bd_import_local(jsonb_build_object('thing', jsonb_build_object('title', 'Knit a sweater', 'why', 'cold', 'why_public', true),
  'shifts', jsonb_build_array(jsonb_build_object('client_id', 'loc-00000001', 'kind', 'shift', 'day', to_char(((now() at time zone 'America/New_York')::date) - 1, 'YYYY-MM-DD'), 'minutes', 40, 'on_thing', true),
                              jsonb_build_object('client_id', 'loc-00000002', 'kind', 'logged', 'day', to_char(((now() at time zone 'America/New_York')::date), 'YYYY-MM-DD'), 'minutes', 15)),
  'builder', jsonb_build_object('hat', 'green', 'vest', 'blue', 'first_name', 'Kate'))) = '{"moved":true,"shifts":2}', 'moved once');
select pg_temp.ok(public.bd_thing_get() -> 'thing' @> '{"title":"Knit a sweater","why_public":true}', 'the thing came');
select pg_temp.ok(public.bd_builder_get() ->> 'hat' = 'yellow', 'a builder the account already had is kept');
select pg_temp.expect_error('select public.bd_import_local(''{}'')', 'already_synced');
reset role;
select pg_temp.ok((select count(*) from public.bd_shifts where user_id = :KATE and thing_id is not null) = 1, 'the shift on the thing is on it');

-- ------------------------------------------------- deleting an account
set role authenticated; select pg_temp.who(:ANN);
select public.bd_report('post', (select id from pg_temp.ids where k = 'prog'), 'other');
select pg_temp.ok(public.bd_delete_me() = '{"deleted":true}', 'deleted');
reset role;
select pg_temp.ok(not exists (select 1 from public.bd_posts where user_id = :ANN) and not exists (select 1 from public.bd_help where helper_id = :ANN)
  and not exists (select 1 from public.bd_builder where user_id = :ANN) and not exists (select 1 from public.bd_reports where by_user = :ANN)
  and not exists (select 1 from public.bd_blocks where blocked_id = :ANN), 'nothing of Ann''s is left');
select pg_temp.ok((select reports from public.bd_posts where id = (select id from pg_temp.ids where k = 'prog')) = 0, 'her report stopped counting');

-- --------------------------------------------- the other apps' tables, when there
\if :others
insert into public.btb_photos (storage_path, status, spot) values ('submissions/build-1.jpg', 'pending', 'All Day · Build'),
  ('submissions/church-1.jpg', 'pending', 'Church St');
set role authenticated; select pg_temp.who(:DEV);
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''x'', ''submissions/church-1.jpg'')', 'bad_photo');
insert into pg_temp.ids select 'photo_post', (public.bd_post_create('progress', 'ribs', 'submissions/build-1.jpg') ->> 'id')::uuid;
select pg_temp.ok(public.bd_feed() -> 0 -> 'photo' = 'null'::jsonb, 'the photo waits for the queue');
reset role;
update public.btb_photos set status = 'approved' where storage_path = 'submissions/build-1.jpg';
select pg_temp.ok(public.bd_feed() -> 0 ->> 'photo' = 'submissions/build-1.jpg', 'then shows');
set role authenticated; select pg_temp.who(:DEV);
select public.bd_post_delete((select id from pg_temp.ids where k = 'photo_post'));
reset role;
select pg_temp.ok((select status from public.btb_photos where storage_path = 'submissions/build-1.jpg') = 'removed', 'and leaves the gallery with its post');

insert into public.nn_bans (user_id) values (:DEV);
set role authenticated; select pg_temp.who(:DEV);
select pg_temp.expect_error('select public.bd_post_create(''progress'', ''x'')', 'banned');
reset role;
delete from public.nn_bans where user_id = :DEV;

insert into public.sz_habits (id, user_id, text, frequency) values ('bd000000-0000-4000-8000-00000000ab17', :ALEX, 'Walk', 'daily');
insert into public.sz_taps (habit_id, user_id, date) select 'bd000000-0000-4000-8000-00000000ab17', :ALEX, ((now() at time zone 'America/New_York')::date) - d from generate_series(0, 4) d;
select pg_temp.ok((public.bd_town() ->> 'habit_drops')::int = 5 and (public.bd_town(((now() at time zone 'America/New_York')::date) - 1) ->> 'habit_drops')::int = 2, 'habit taps drop pallets');
\else
select pg_temp.ok((public.bd_town() ->> 'habit_drops')::int = 0, 'no Habits, no pallets');
\endif
