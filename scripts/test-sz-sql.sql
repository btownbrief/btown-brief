-- End-to-end check of the sz_ functions (the Habits tab) on the scratch
-- database that scripts/test-sz-sql.sh builds and seeds with
-- scripts/sz-seed.sql. Every reader call runs as the anon or authenticated
-- role, the way the app's publishable key arrives. The same cases run
-- against the fake backend in scripts/test-habits-core.mjs.
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
-- today in Burlington, as the server's own sz_today() says it (which readers may not call)
create function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create table pg_temp.ids (k text primary key, id uuid);
grant all on pg_temp.ids to anon, authenticated;

-- the seed's people
\set MAYA '''51000000-0000-4000-8000-000000000001'''
\set SAM '''51000000-0000-4000-8000-000000000002'''
\set KIM '''51000000-0000-4000-8000-000000000005'''
\set DANA '''59000000-0000-4000-8000-000000000001'''
\set MAYA_READ '''57000000-0000-4000-8000-000000000101'''
\set MAYA_WALK '''57000000-0000-4000-8000-000000000201'''
\set MAYA_GOAL '''56000000-0000-4000-8000-000000000001'''
insert into auth.users values (:DANA, 'dana@example.com') on conflict do nothing;

-- ----------------------------------------------------------- the seed
select pg_temp.ok((select count(*) from public.sz_seasons) = 1, 'one season');
select pg_temp.ok((select count(*) from public.sz_pods) = 3, 'three pods');
select pg_temp.ok((select count(*) from public.sz_members) = 12, 'twelve members');
select pg_temp.ok((select count(*) from public.sz_goals) = 12, 'twelve goals');
select pg_temp.ok((select count(*) from public.sz_habits where is_goal) = 12, 'one goal habit each');
select pg_temp.ok((select count(*) from public.sz_events) = 3, 'kickoff, midway, party');
select pg_temp.ok((select min(date) from public.sz_taps) = pg_temp.today() - 13 and (select max(date) from public.sz_taps) = pg_temp.today(), 'two weeks of taps, up to today');
select pg_temp.ok((select count(*) from public.sz_taps) > 200, 'and plenty of them');

-- ------------------------------------------------------------ the locks
set role anon; select pg_temp.who(null);
select pg_temp.expect_denied('select * from public.sz_members');
select pg_temp.expect_denied('select * from public.sz_habits');
select pg_temp.expect_denied('select * from public.sz_taps');
select pg_temp.expect_denied('select * from public.sz_seasons');
select pg_temp.expect_denied('select * from public.sz_goals');
select pg_temp.expect_denied('select * from public.sz_wall_cards');
select pg_temp.expect_denied('insert into public.sz_taps (habit_id, user_id, date) values (gen_random_uuid(), gen_random_uuid(), current_date)');
select pg_temp.expect_denied('select public.sz_today()');
select pg_temp.expect_denied('select public.sz_clean(''x'')');
select pg_temp.expect_denied('select public.sz_range_ok(current_date, current_date)');
select pg_temp.ok(public.sz_rules() -> 'limits' ->> 'habitsMax' = '5', 'anon can read the rules');
select pg_temp.expect_error('select public.sz_me_get()', 'not_signed_in');
select pg_temp.expect_error($q$select public.sz_me_set('Dana', '802-555-0199')$q$, 'not_signed_in');
select pg_temp.expect_error('select public.sz_habits_get()', 'not_signed_in');
select pg_temp.expect_error($q$select public.sz_habit_add('Stretch', 'daily')$q$, 'not_signed_in');
select pg_temp.expect_error('select public.sz_tap(' || quote_literal(:MAYA_READ) || ', pg_temp.today())', 'not_signed_in');
select pg_temp.expect_error('select public.sz_taps_get(current_date - 7, current_date)', 'not_signed_in');
select pg_temp.expect_error('select public.sz_pod_habits(current_date - 7, current_date)', 'not_signed_in');
select pg_temp.expect_error('select public.sz_delete_me()', 'not_signed_in');
-- the seed's season is live: no season to come
select pg_temp.ok(public.sz_season_next() is null, 'no season scheduled: null');

-- ------------------------------------------------- a new member, Dana
set role authenticated; select pg_temp.who(:DANA);
select pg_temp.ok(public.sz_me_get() is null, 'no member row before the two questions');
select pg_temp.ok(public.sz_habits_get() = '[]'::jsonb, 'no habits yet');
select pg_temp.expect_error($q$select public.sz_habit_add('Stretch', 'daily')$q$, 'no_member');
select pg_temp.expect_error($q$select public.sz_me_set('  ', '802-555-0199')$q$, 'bad_name');
select pg_temp.expect_error($q$select public.sz_me_set('dana@example.com', '802-555-0199')$q$, 'bad_name');
select pg_temp.expect_error($q$select public.sz_me_set(repeat('d', 33), '802-555-0199')$q$, 'bad_name');
select pg_temp.expect_error($q$select public.sz_me_set('Dana', 'call me')$q$, 'bad_phone');
select pg_temp.expect_error($q$select public.sz_me_set('Dana', '555-01')$q$, 'bad_phone');
select pg_temp.expect_error($q$select public.sz_me_set('Dana', '+1 (802) 555-0199 0000')$q$, 'bad_phone');
select pg_temp.ok(public.sz_me_set('  Dana   R. ', '+1 (802) 555-0199') @> '{"name":"Dana R.","phone":"+1 (802) 555-0199","city":"burlington","email_opt_out":false}', 'a name is tidied and saved');
select pg_temp.ok(public.sz_me_get() ->> 'name' = 'Dana R.', 'and read back');

-- what a habit must be
select pg_temp.expect_error($q$select public.sz_habit_add('   ', 'daily')$q$, 'bad_text');
select pg_temp.expect_error($q$select public.sz_habit_add(repeat('h', 61), 'daily')$q$, 'bad_text');
select pg_temp.expect_error($q$select public.sz_habit_add('Stretch', 'hourly')$q$, 'bad_frequency');
select pg_temp.expect_error($q$select public.sz_habit_add('Stretch', null)$q$, 'bad_frequency');
select pg_temp.expect_error($q$select public.sz_habit_add('Stretch', 'n_per_week')$q$, 'bad_n');
select pg_temp.expect_error($q$select public.sz_habit_add('Stretch', 'n_per_week', 0)$q$, 'bad_n');
select pg_temp.expect_error($q$select public.sz_habit_add('Stretch', 'n_per_week', 7)$q$, 'bad_n');
insert into pg_temp.ids select 'h1', (public.sz_habit_add('Stretch https://x.example', 'daily') ->> 'id')::uuid;
select pg_temp.ok((select h ->> 'text' from jsonb_array_elements(public.sz_habits_get()) h where h ->> 'id' = (select id::text from pg_temp.ids where k = 'h1')) = 'Stretch', 'links are taken out of a habit''s name');
select pg_temp.ok((public.sz_habit_add('Gym', 'n_per_week', 3, true) @> '{"frequency":"n_per_week","n":3,"shared":true,"position":2}'), 'an N-a-week habit, shared, goes second');
select pg_temp.ok(public.sz_habit_add('Floss', 'weekdays', 4) @> '{"frequency":"weekdays","shared":false}', 'private by default');
select pg_temp.ok((select (h ->> 'n') is null from jsonb_array_elements(public.sz_habits_get()) h where h ->> 'text' = 'Floss'), 'N is dropped for a habit that is not N-a-week');
select public.sz_habit_add('Journal', 'daily');
insert into pg_temp.ids select 'h5', (public.sz_habit_add('Water the plants', 'daily') ->> 'id')::uuid;
select pg_temp.expect_error($q$select public.sz_habit_add('A sixth', 'daily')$q$, 'too_many_habits');
select pg_temp.ok(jsonb_array_length(public.sz_habits_get()) = 5, 'five habits, the limit');

-- move, archive, bring back
select public.sz_habit_set(p_habit => (select id from pg_temp.ids where k = 'h5'), p_position => 1);
select pg_temp.ok((select string_agg(h ->> 'text', ',') from jsonb_array_elements(public.sz_habits_get()) h) = 'Water the plants,Stretch,Gym,Floss,Journal', 'moved to the top, the rest in order');
select public.sz_habit_set(p_habit => (select id from pg_temp.ids where k = 'h1'), p_position => 99);
select pg_temp.ok((select string_agg(h ->> 'text', ',') from jsonb_array_elements(public.sz_habits_get()) h) = 'Water the plants,Gym,Floss,Journal,Stretch', 'a place past the end is the end');
select pg_temp.ok(public.sz_habit_set(p_habit => (select id from pg_temp.ids where k = 'h1'), p_text => 'Stretch for ten minutes', p_frequency => 'n_per_week', p_n => 5)
  @> '{"text":"Stretch for ten minutes","frequency":"n_per_week","n":5}', 'renamed, and now five times a week');
select pg_temp.expect_error('select public.sz_habit_set(p_habit => (select id from pg_temp.ids where k = ''h1''), p_n => 9)', 'bad_n');
select pg_temp.ok(public.sz_habit_set(p_habit => (select id from pg_temp.ids where k = 'h1'), p_frequency => 'daily') ->> 'n' is null, 'back to daily drops N');
select public.sz_habit_set(p_habit => (select id from pg_temp.ids where k = 'h1'), p_archived => true);
select pg_temp.ok(jsonb_array_length(public.sz_habits_get()) = 4, 'archived: out of the list');
select public.sz_habit_add('Call home', 'n_per_week', 1);
select pg_temp.expect_error('select public.sz_habit_set(p_habit => (select id from pg_temp.ids where k = ''h1''), p_archived => false)', 'too_many_habits');
select pg_temp.expect_error('select public.sz_tap((select id from pg_temp.ids where k = ''h1''), pg_temp.today())', 'not_found');

-- taps: today only, from the app
select public.sz_tap((select id from pg_temp.ids where k = 'h5'), pg_temp.today());
select public.sz_tap((select id from pg_temp.ids where k = 'h5'), pg_temp.today());
select pg_temp.ok(jsonb_array_length(public.sz_taps_get(pg_temp.today(), pg_temp.today())) = 1, 'tapping twice is one tap');
select pg_temp.expect_error('select public.sz_tap((select id from pg_temp.ids where k = ''h5''), pg_temp.today() - 1)', 'not_today');
select pg_temp.expect_error('select public.sz_tap((select id from pg_temp.ids where k = ''h5''), pg_temp.today() + 1)', 'not_today');
select pg_temp.expect_error('select public.sz_tap((select id from pg_temp.ids where k = ''h5''), null)', 'not_today');
select pg_temp.expect_error('select public.sz_untap((select id from pg_temp.ids where k = ''h5''), pg_temp.today() - 1)', 'not_today');
select pg_temp.ok(public.sz_taps_get(pg_temp.today() - 1, pg_temp.today()) -> 0 @> jsonb_build_object('date', pg_temp.today(), 'source', 'app'), 'the tap is today''s, from the app');
select public.sz_untap((select id from pg_temp.ids where k = 'h5'), pg_temp.today());
select pg_temp.ok(public.sz_taps_get(pg_temp.today() - 1, pg_temp.today()) = '[]'::jsonb, 'un-tapping deletes the tap');
select public.sz_tap((select id from pg_temp.ids where k = 'h5'), pg_temp.today());
select pg_temp.expect_error('select public.sz_taps_get(current_date, current_date - 1)', 'bad_range');
select pg_temp.expect_error('select public.sz_taps_get(current_date - 371, current_date)', 'bad_range');
select pg_temp.expect_error('select public.sz_taps_get(null, current_date)', 'bad_range');
select pg_temp.ok(jsonb_array_length(public.sz_taps_get(current_date - 369, current_date + 1)) = 1, 'only your own taps: Dana has one');
select pg_temp.ok(public.sz_pod_habits(current_date - 7, current_date) = '[]'::jsonb, 'no pod, no podmates');

-- ------------------------------------------------- privacy, the seed
-- another member's habit: not yours to see, change or tap
select pg_temp.expect_error('select public.sz_habit_set(' || quote_literal(:MAYA_READ) || ', p_text => ''Mine now'')', 'not_found');
select pg_temp.expect_error('select public.sz_habit_set(' || quote_literal(:MAYA_READ) || ', p_archived => true)', 'not_found');
select pg_temp.expect_error('select public.sz_tap(' || quote_literal(:MAYA_READ) || ', pg_temp.today())', 'not_found');
select pg_temp.expect_error('select public.sz_untap(' || quote_literal(:MAYA_READ) || ', pg_temp.today())', 'not_found');
select pg_temp.ok(not (public.sz_habits_get()::text like '%Read twenty pages%'), 'Maya''s habits never come back to Dana');

-- Sam, Maya's podmate: her shared habit and her goal habit, never her private one
select pg_temp.who(:SAM);
select pg_temp.ok((select string_agg(p ->> 'name', ',') from jsonb_array_elements(public.sz_pod_habits(pg_temp.today() - 13, pg_temp.today())) p) = 'Maya,Priya,Theo', 'Sam sees his three podmates, by name');
select pg_temp.ok((select string_agg(h ->> 'text', ',') from jsonb_array_elements(public.sz_pod_habits(pg_temp.today() - 13, pg_temp.today())) p,
  jsonb_array_elements(p -> 'habits') h where p ->> 'name' = 'Maya') = 'Write 300 words,Walk to work', 'Maya''s goal habit and her shared habit, not her private one');
select pg_temp.ok((select jsonb_array_length(h -> 'taps') from jsonb_array_elements(public.sz_pod_habits(pg_temp.today() - 13, pg_temp.today())) p,
  jsonb_array_elements(p -> 'habits') h where h ->> 'id' = '57000000-0000-4000-8000-000000000201') > 0, 'with the shared habit''s taps');
select pg_temp.ok(not (public.sz_pod_habits(pg_temp.today() - 13, pg_temp.today())::text ~ 'phone|802-555|Read twenty pages|@'), 'no phone, no email, no private habit anywhere in it');
select pg_temp.ok(not (public.sz_taps_get(pg_temp.today() - 13, pg_temp.today())::text like '%' || '57000000-0000-4000-8000-000000000201' || '%'), 'Sam''s own taps never include Maya''s');
select pg_temp.expect_error('select public.sz_tap(' || quote_literal(:MAYA_WALK) || ', pg_temp.today())', 'not_found');
select pg_temp.expect_error('select public.sz_habit_set(' || quote_literal(:MAYA_WALK) || ', p_shared => false)', 'not_found');

-- Kim, another pod: nothing of Maya's at all
select pg_temp.who(:KIM);
select pg_temp.ok((select string_agg(p ->> 'name', ',') from jsonb_array_elements(public.sz_pod_habits(pg_temp.today() - 13, pg_temp.today())) p) = 'Ana,Ben,Lee', 'Kim sees her own pod');
select pg_temp.ok(not (public.sz_pod_habits(pg_temp.today() - 13, pg_temp.today())::text ~ 'Maya|000000000201|000000000101|Write 300 words'), 'and nothing of Maya''s');

-- Maya unshares: Sam stops seeing it at once
select pg_temp.who(:MAYA);
select pg_temp.ok(public.sz_habit_set(:MAYA_WALK, p_shared => false) ->> 'shared' = 'false', 'Maya unshares her walk');
select pg_temp.who(:SAM);
select pg_temp.ok((select count(*) from jsonb_array_elements(public.sz_pod_habits(pg_temp.today() - 13, pg_temp.today())) p, jsonb_array_elements(p -> 'habits') h
  where h ->> 'id' = '57000000-0000-4000-8000-000000000201') = 0, 'and Sam no longer sees it');

-- the goal habit: it stays, and its words are locked with the goal
select pg_temp.who(:MAYA);
select pg_temp.ok((public.sz_habits_get() -> 0 ->> 'is_goal')::boolean, 'the goal habit comes first');
select pg_temp.expect_error('select public.sz_habit_set(' || quote_literal(:MAYA_GOAL) || ', p_archived => true)', 'goal_habit');
select pg_temp.expect_error('select public.sz_habit_set(' || quote_literal(:MAYA_GOAL) || ', p_text => ''Write 100 words'')', 'locked');
select pg_temp.expect_error('select public.sz_habit_set(' || quote_literal(:MAYA_GOAL) || ', p_frequency => ''daily'')', 'locked');
select pg_temp.ok(public.sz_habit_set(:MAYA_GOAL, p_text => 'Write 300 words') ->> 'text' = 'Write 300 words', 'the same words are not a change');
select pg_temp.ok(public.sz_habit_set(:MAYA_GOAL, p_position => 1) ->> 'position' = '0', 'the goal habit does not move into the list');

-- ---------------------------------------------- the operator's guards
reset role;
select pg_temp.expect_error($q$insert into public.sz_habits (user_id, text, frequency) select '59000000-0000-4000-8000-000000000001', 'A sixth, by hand', 'daily'$q$, 'too_many_habits');
select pg_temp.expect_error($q$insert into public.sz_habits (user_id, goal_id, text, frequency, is_goal) values ('51000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', 'A second goal habit', 'daily', true)$q$,
  'duplicate key value violates unique constraint "sz_habits_goal_idx"');
select pg_temp.expect_error($q$insert into public.sz_habits (user_id, text, frequency, n, archived_at) values ('51000000-0000-4000-8000-000000000001', 'Seven a week', 'n_per_week', 7, now())$q$,
  'new row for relation "sz_habits" violates check constraint "sz_habits_n_check"');
select pg_temp.expect_error($q$insert into public.sz_seasons (city, name, kickoff_at, status) values ('burlington', 'A second live one', now(), 'live')$q$,
  'duplicate key value violates unique constraint "sz_seasons_live_idx"');
-- a tap filed under the wrong person goes to the habit's owner
insert into public.sz_taps (habit_id, user_id, date) values (:MAYA_READ, :KIM, pg_temp.today() - 30);
select pg_temp.ok((select user_id from public.sz_taps where habit_id = :MAYA_READ and date = pg_temp.today() - 30) = :MAYA, 'a tap belongs to its habit''s owner');
-- Stephen can fill in a day gone by; the app cannot
insert into public.sz_taps (habit_id, user_id, date) values (:MAYA_WALK, :MAYA, pg_temp.today() - 20);

-- ------------------------------------------------- the next season
insert into public.sz_seasons (city, name, signup_opens, kickoff_at, party_at, status, stripe_link) values
  ('burlington', 'Season 1', now() - interval '1 day', now() + interval '40 days', now() + interval '96 days', 'open', 'https://buy.stripe.com/example'),
  ('burlington', 'Season 2', now() + interval '60 days', now() + interval '120 days', now() + interval '176 days', 'upcoming', null),
  ('burlington', 'Season Gone', now() - interval '200 days', now() - interval '150 days', now() - interval '94 days', 'done', null),
  ('montpelier', 'Montpelier 0', now(), now() + interval '10 days', now() + interval '66 days', 'open', null);
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.sz_season_next() @> '{"name":"Season 1","status":"open","stripe_link":"https://buy.stripe.com/example"}', 'the next season is the soonest one still to kick off, in Burlington');
select pg_temp.ok(public.sz_season_next('montpelier') ->> 'name' = 'Montpelier 0', 'another city has its own');
select pg_temp.ok(public.sz_season_next('nowhere') is null, 'a city with none: null');

-- ------------------------------------------------- delete my account
set role authenticated; select pg_temp.who(:DANA);
select pg_temp.ok(public.sz_delete_me() ->> 'deleted' = 'true', 'Dana deletes her account');
reset role;
select pg_temp.ok(not exists (select 1 from public.sz_members where user_id = :DANA) and not exists (select 1 from public.sz_habits where user_id = :DANA)
  and not exists (select 1 from public.sz_taps where user_id = :DANA), 'her member row, habits and taps are gone');
select pg_temp.ok((select count(*) from public.sz_members) = 12, 'and nobody else''s');
