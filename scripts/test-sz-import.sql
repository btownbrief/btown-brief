-- sz-ROUND3.sql's two changes, on the scratch database scripts/test-sz-sql.sh
-- builds (after scripts/test-sz-sql.sql has run on it): adding a habit needs
-- no name or phone, and sz_import_local moves a phone's habits into an empty
-- account once, refuses every other time, and never reaches anyone else's.
-- Every reader call runs as the anon or authenticated role. The same cases
-- run against the fake in scripts/test-habits-core.mjs.
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
create function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;
-- a refused import, and proof that it wrote nothing
create function pg_temp.refused(p text, code text) returns void language plpgsql as $$
begin
  perform pg_temp.expect_error('select public.sz_import_local(' || coalesce(quote_literal(p) || '::jsonb', 'null') || ')', code);
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

\set MAYA '''51000000-0000-4000-8000-000000000001'''
\set MAYA_READ '''57000000-0000-4000-8000-000000000101'''
\set ZOE '''59000000-0000-4000-8000-000000000002'''
\set OMAR '''59000000-0000-4000-8000-000000000003'''
\set IVY '''59000000-0000-4000-8000-000000000004'''
insert into auth.users values (:ZOE, 'zoe@example.com'), (:OMAR, 'omar@example.com'), (:IVY, 'ivy@example.com') on conflict do nothing;
create temporary table maya_before as select count(*) as n, max(date) as last from public.sz_taps where user_id = :MAYA;
grant select on maya_before to anon, authenticated;

-- ---------------------------------------------------------- the locks
set role anon; select pg_temp.who(null);
select pg_temp.refused('[]', 'not_signed_in');

-- --------------------------------------------- no name wall for the tracker
set role authenticated; select pg_temp.who(:ZOE);
select pg_temp.ok(public.sz_me_get() is null, 'Zoe never gave a name or a phone');
select pg_temp.ok(public.sz_habit_add('Stretch', 'daily') ->> 'text' = 'Stretch', 'and adds a habit anyway');
select pg_temp.ok(public.sz_tap((public.sz_habits_get() -> 0 ->> 'id')::uuid, pg_temp.today()) ->> 'tapped' = 'true', 'and taps it');
select pg_temp.ok(public.sz_me_get() is null, 'still no member row: none is made behind her back');
-- an account with a habit already: no import
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":[]}]', 'already_synced');

-- an account whose only habit is archived has had habits: no import either
select pg_temp.who(:OMAR);
select public.sz_habit_set((public.sz_habit_add('Floss', 'daily') ->> 'id')::uuid, p_archived => true);
select pg_temp.ok(public.sz_habits_get() = '[]'::jsonb, 'Omar''s list is empty');
select pg_temp.refused('[{"text":"Read","frequency":"daily"}]', 'already_synced');

-- -------------------------------------------------- bad lists, Ivy
select pg_temp.who(:IVY);
select pg_temp.refused(null, 'bad_import');
select pg_temp.refused('{}', 'bad_import');
select pg_temp.refused('"habits"', 'bad_import');
select pg_temp.refused('[1]', 'bad_import');
select pg_temp.refused('[[]]', 'bad_import');
select pg_temp.refused((select jsonb_agg(jsonb_build_object('text', 'Habit ' || i, 'frequency', 'daily'))::text from generate_series(1, 101) i), 'bad_import');
-- a list cannot name a habit or an owner, so it can never reach another member's
select pg_temp.refused('[{"id":' || to_json(:MAYA_READ::text) || ',"text":"Read twenty pages","frequency":"daily","taps":["' || pg_temp.today() || '"]}]', 'bad_import');
select pg_temp.refused('[{"habit_id":' || to_json(:MAYA_READ::text) || ',"text":"Read","frequency":"daily"}]', 'bad_import');
select pg_temp.refused('[{"user_id":' || to_json(:MAYA::text) || ',"text":"Read","frequency":"daily"}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","source":"email"}]', 'bad_import');
-- each habit as sz_habit_add checks it
select pg_temp.refused('[{"text":"  ","frequency":"daily"}]', 'bad_import');
select pg_temp.refused('[{"text":"' || repeat('h', 61) || '","frequency":"daily"}]', 'bad_import');
select pg_temp.refused('[{"text":42,"frequency":"daily"}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"hourly"}]', 'bad_import');
select pg_temp.refused('[{"text":"Read"}]', 'bad_import');
select pg_temp.refused('[{"text":"Gym","frequency":"n_per_week"}]', 'bad_import');
select pg_temp.refused('[{"text":"Gym","frequency":"n_per_week","n":7}]', 'bad_import');
select pg_temp.refused('[{"text":"Gym","frequency":"n_per_week","n":2.5}]', 'bad_import');
select pg_temp.refused('[{"text":"Gym","frequency":"n_per_week","n":"3"}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","shared":"yes"}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","archived":1}]', 'bad_import');
-- bad dates: the future, past the 400 days, not a date at all
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":["' || (pg_temp.today() + 1) || '"]}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":["' || (pg_temp.today() - 401) || '"]}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":["2026-02-30"]}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":["2026-2-3"]}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":["yesterday"]}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":[20261010]}]', 'bad_import');
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":"' || pg_temp.today() || '"}]', 'bad_import');
select pg_temp.refused((select jsonb_build_array(jsonb_build_object('text', 'Read', 'frequency', 'daily', 'taps', jsonb_agg(to_jsonb(pg_temp.today()::text))))::text from generate_series(1, 402)), 'bad_import');
-- one bad habit after good ones: the good ones are not kept either
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":["' || pg_temp.today() || '"]},{"text":"Gym","frequency":"weekly"}]', 'bad_import');
select pg_temp.ok(public.sz_habits_get() = '[]'::jsonb and public.sz_taps_get(pg_temp.today() - 369, pg_temp.today()) = '[]'::jsonb, 'every refusal wrote nothing');
reset role;
select pg_temp.ok(not exists (select 1 from public.sz_habits where user_id = :IVY) and not exists (select 1 from public.sz_taps where user_id = :IVY), 'not even an archived habit');
select pg_temp.ok((select n from maya_before) = (select count(*) from public.sz_taps where user_id = :MAYA), 'and Maya''s taps are as they were');
select pg_temp.ok(not exists (select 1 from public.sz_habits where user_id = :MAYA and text = 'Read twenty pages' and archived_at is not null), 'and her habit is untouched');

-- -------------------------------------------------- the import, once
set role authenticated; select pg_temp.who(:IVY);
select pg_temp.ok(jsonb_array_length(public.sz_import_local(jsonb_build_array(
  jsonb_build_object('text', '  Morning   walk ', 'frequency', 'daily', 'n', null, 'shared', false, 'archived', false,
    'taps', (select jsonb_agg(to_jsonb((pg_temp.today() - d)::text)) from generate_series(0, 9) d) || jsonb_build_array((pg_temp.today())::text, (pg_temp.today() - 400)::text)),
  jsonb_build_object('text', 'Gym', 'frequency', 'n_per_week', 'n', 3, 'shared', true, 'taps', jsonb_build_array((pg_temp.today() - 2)::text)),
  jsonb_build_object('text', 'Read', 'frequency', 'weekdays', 'n', 4),
  jsonb_build_object('text', 'Old habit', 'frequency', 'daily', 'archived', true, 'taps', jsonb_build_array((pg_temp.today() - 30)::text))
))) = 3, 'three habits in the list, the archived one kept out of it');
select pg_temp.ok((select string_agg(h ->> 'text', ',') from jsonb_array_elements(public.sz_habits_get()) h) = 'Morning walk,Gym,Read', 'in the phone''s order, tidied as sz_habit_add tidies');
select pg_temp.ok(public.sz_habits_get() -> 1 @> '{"frequency":"n_per_week","n":3,"shared":true}' and (public.sz_habits_get() -> 2 ->> 'n') is null, 'how often and sharing come across; N only for N-a-week');
select pg_temp.ok(jsonb_array_length(public.sz_taps_get(pg_temp.today() - 370, pg_temp.today())) = 12, 'the taps come across, a doubled date once');
select pg_temp.ok(public.sz_taps_get(pg_temp.today(), pg_temp.today()) -> 0 ->> 'date' = pg_temp.today()::text, 'today''s tap is today''s');
-- the second time: refused, whatever it carries
select pg_temp.refused('[{"text":"Again","frequency":"daily","taps":["' || pg_temp.today() || '"]}]', 'already_synced');
select pg_temp.refused('[]', 'already_synced');
select pg_temp.ok(jsonb_array_length(public.sz_habits_get()) = 3, 'nothing more was added');
-- the seed's Maya has habits: refused, and refused before her list is even read
select pg_temp.who(:MAYA);
select pg_temp.refused('[{"text":"Read","frequency":"daily","taps":["' || pg_temp.today() || '"]}]', 'already_synced');
select pg_temp.refused('{}', 'already_synced');
reset role;
select pg_temp.ok((select count(*) from public.sz_habits where user_id = :IVY) = 4, 'Ivy has four habits, one archived');
select pg_temp.ok((select count(*) from public.sz_taps where user_id = :IVY) = 13 and (select bool_and(note = 'imported' and source = 'app') from public.sz_taps where user_id = :IVY),
  'thirteen taps, each marked imported, the archived habit''s included');
select pg_temp.ok((select min(date) from public.sz_taps where user_id = :IVY) = pg_temp.today() - 400, 'the oldest is 400 days back, the edge of the window');
select pg_temp.ok((select archived_at is not null from public.sz_habits where user_id = :IVY and text = 'Old habit'), 'the archived habit stays archived');
select pg_temp.ok((select n from maya_before) = (select count(*) from public.sz_taps where user_id = :MAYA), 'Maya''s taps never moved');
