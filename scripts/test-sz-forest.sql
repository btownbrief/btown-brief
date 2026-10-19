-- End-to-end check of sz-FOREST.sql (share your forest) on the scratch
-- database scripts/test-sz-sql.sh builds. Two invented members, Fern and
-- Gus, make their habits through the app's own doors; every reader call
-- runs as the anon or authenticated role, the way the publishable key
-- arrives. The same cases run against the fake in scripts/test-sz-forest.mjs.
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

\set FERN '''5f000000-0000-4000-8000-00000000f001'''
\set GUS '''5f000000-0000-4000-8000-00000000f002'''
insert into auth.users values (:FERN, 'fern@example.com'), (:GUS, 'gus@example.com') on conflict do nothing;

-- -------------------------------------------------------------- the locks
set role anon; select pg_temp.who(null);
select pg_temp.expect_denied('select * from public.sz_forests');
select pg_temp.expect_denied('select * from public.sz_forest_habits');
select pg_temp.expect_denied('insert into public.sz_forests (user_id, name) values (gen_random_uuid(), ''x'')');
select pg_temp.expect_denied('select public.sz_forest_tree(gen_random_uuid(), current_date)');
select pg_temp.expect_denied('select public.sz_forest_seed(gen_random_uuid())');
select pg_temp.expect_error('select public.sz_forest_get()', 'not_signed_in');
select pg_temp.expect_error('select public.sz_forest_set(''Fern'', true, true, null, null)', 'not_signed_in');
select pg_temp.ok(public.sz_forests_public() = '[]'::jsonb, 'nobody has shared yet: an empty gallery');
set role authenticated; select pg_temp.who(:FERN);
select pg_temp.expect_denied('select * from public.sz_forests');
select pg_temp.expect_denied('select public.sz_forest_json(f) from public.sz_forests f');
reset role;

-- ---------------------------------------------------- Fern plants three
set role authenticated; select pg_temp.who(:FERN);
insert into pg_temp.ids select 'run', (public.sz_habit_add('Run', 'daily') ->> 'id')::uuid;
insert into pg_temp.ids select 'journal', (public.sz_habit_add('Journal', 'weekdays') ->> 'id')::uuid;
insert into pg_temp.ids select 'secret', (public.sz_habit_add('Secret habit', 'n_per_week', 2) ->> 'id')::uuid;
select pg_temp.ok(public.sz_forest_get() is null, 'no forest saved yet: null');
reset role;
-- ten days of runs up to today, journal on the 3rd to 5th day back (the operator's hand)
insert into public.sz_taps (habit_id, date) select (select id from pg_temp.ids where k = 'run'), public.sz_today() - d from generate_series(0, 9) d;
insert into public.sz_taps (habit_id, date) select (select id from pg_temp.ids where k = 'journal'), public.sz_today() - d from generate_series(3, 5) d;
select pg_temp.ok((select count(*) from public.sz_taps where user_id = :FERN) = 13, 'the taps belong to Fern');

-- ------------------------------------------------------------ the checks
set role authenticated; select pg_temp.who(:FERN);
select pg_temp.expect_error('select public.sz_forest_set('''', true, false, null, null)', 'bad_forest_name');
select pg_temp.expect_error('select public.sz_forest_set(''   '', true, false, null, null)', 'bad_forest_name');
select pg_temp.expect_error('select public.sz_forest_set(''fern@example.com'', true, false, null, null)', 'bad_forest_name');
select pg_temp.expect_error('select public.sz_forest_set(repeat(''a'', 33), true, false, null, null)', 'bad_forest_name');
select pg_temp.expect_error('select public.sz_forest_set(''Fern'', true, false, null, repeat(''c'', 33))', 'bad_cohort');
select pg_temp.expect_error('select public.sz_forest_set(''Fern'', true, false, array[gen_random_uuid()], null)', 'not_found');
select pg_temp.ok(public.sz_forest_get() is null, 'a refused share saves nothing');

-- shared: the run and the journal, trees only
select pg_temp.ok(public.sz_forest_set(' Fern   the Runner ', true, false,
  array[(select id from pg_temp.ids where k = 'run'), (select id from pg_temp.ids where k = 'journal')], '') @> '{"name":"Fern the Runner","public":true,"show_names":false,"cohort":null}',
  'saved: the name tidied, public, trees only, no cohort');
select pg_temp.ok(jsonb_array_length(public.sz_forest_get() -> 'habits') = 2, 'two habits in it');
reset role;

-- ---------------------------------------------------- what anyone sees
set role anon; select pg_temp.who(null);
create temp table g as select public.sz_forests_public() as j;
select pg_temp.ok(jsonb_array_length((select j from g)) = 1, 'one forest in the gallery');
select pg_temp.ok((select j -> 0 ->> 'name' from g) = 'Fern the Runner', 'under the name Fern chose');
select pg_temp.ok((select (select array_agg(k order by k) from jsonb_object_keys(j -> 0) k) from g) = array['cohort', 'id', 'name', 'show_names', 'trees'],
  'a forest carries its id, name, cohort, show_names and trees, nothing more');
select pg_temp.ok((select (select array_agg(k order by k) from jsonb_object_keys(j -> 0 -> 'trees' -> 0) k) from g)
  = array['best', 'frequency', 'leaves', 'n', 'name', 'seed', 'streak'], 'a tree carries its numbers and seed, nothing more');
select pg_temp.ok((select j -> 0 -> 'trees' -> 0 from g) @> '{"name":null,"frequency":"daily","leaves":10,"streak":10,"best":10}', 'the run: ten leaves, a ten-day streak, no name');
select pg_temp.ok((select j -> 0 -> 'trees' -> 1 from g) @> '{"name":null,"frequency":"weekdays","leaves":3}', 'the journal: three leaves');
select pg_temp.ok((select jsonb_array_length(j -> 0 -> 'trees') from g) = 2, 'the private habit is not there');
select pg_temp.ok((select position(lower(:FERN) in j::text) = 0 and position('fern@' in j::text) = 0
  and position((select id::text from pg_temp.ids where k = 'run') in j::text) = 0
  and position('Secret' in j::text) = 0 and position('"Run"' in j::text) = 0 and position('Journal' in j::text) = 0 from g), 'no account id, email, habit id or habit name');
select pg_temp.ok(public.sz_forest_public((select (j -> 0 ->> 'id')::uuid from g)) = (select j -> 0 from g), 'the single forest by its public id is the same');
select pg_temp.ok(public.sz_forest_public(gen_random_uuid()) is null, 'an unknown id: null');
reset role;
select pg_temp.ok((select (j -> 0 -> 'trees' -> 0 ->> 'seed')::bigint from g) = public.sz_forest_seed((select id from pg_temp.ids where k = 'run')), 'the seed is the habit''s');
drop table g;

-- names on
set role authenticated; select pg_temp.who(:FERN);
select pg_temp.ok(public.sz_forest_set('Fern', true, true, null, null) -> 'habits' is not null, 'names shown; the habits kept (null keeps them)');
select pg_temp.ok(jsonb_array_length(public.sz_forest_get() -> 'habits') = 2, 'still the same two');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.sz_forests_public() -> 0 -> 'trees' -> 0 ->> 'name' = 'Run', 'now the tree''s name shows');

-- Gus cannot touch it, and has none of his own
set role authenticated; select pg_temp.who(:GUS);
select pg_temp.ok(public.sz_forest_get() is null, 'Gus has no forest');
select pg_temp.expect_error(format('select public.sz_forest_set(%L, true, true, array[%L::uuid], null)', 'Gus', (select id from pg_temp.ids where k = 'run')), 'not_found');
insert into pg_temp.ids select 'gus', (public.sz_habit_add('Stretch', 'daily') ->> 'id')::uuid;
select pg_temp.ok(public.sz_forest_set('Gus', true, false, array[(select id from pg_temp.ids where k = 'gus')], 'Season 0') ->> 'cohort' = 'Season 0', 'Gus shares his, with a cohort');
set role anon; select pg_temp.who(null);
select pg_temp.ok(jsonb_array_length(public.sz_forests_public()) = 2, 'two forests');
select pg_temp.ok(public.sz_forests_public() -> 0 ->> 'name' = 'Fern', 'the one tended most recently first (Gus has no taps yet)');
select pg_temp.ok(public.sz_forests_public() -> 1 -> 'trees' -> 0 @> '{"leaves":0,"streak":0,"best":0}', 'a new tree: no leaves');
select pg_temp.ok(jsonb_array_length(public.sz_forests_public(1)) = 1 and jsonb_array_length(public.sz_forests_public(1000)) = 2, 'the limit holds');

-- archiving takes a tree out; a forest with none leaves the gallery
set role authenticated; select pg_temp.who(:GUS);
select public.sz_habit_set((select id from pg_temp.ids where k = 'gus'), p_archived => true);
select pg_temp.ok(public.sz_forest_get() -> 'habits' = '[]'::jsonb, 'an archived habit is not in the forest');
set role anon; select pg_temp.who(null);
select pg_temp.ok(jsonb_array_length(public.sz_forests_public()) = 1, 'Gus''s empty forest is not in the gallery');
-- Stephen hides one
reset role;
update public.sz_forests set hidden_at = now() where user_id = :FERN;
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.sz_forests_public() = '[]'::jsonb, 'a hidden forest leaves the gallery');
reset role;
update public.sz_forests set hidden_at = null where user_id = :FERN;

-- private again
set role authenticated; select pg_temp.who(:FERN);
create temp table fid as select (public.sz_forest_get() ->> 'id')::uuid as id;
grant select on fid to anon, authenticated;
select pg_temp.ok(public.sz_forest_set('Fern', false, true, null, null) ->> 'public' = 'false', 'Fern stops sharing');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.sz_forests_public() = '[]'::jsonb and public.sz_forest_public((select id from fid)) is null, 'and it is gone from everywhere');
set role authenticated; select pg_temp.who(:FERN);
select pg_temp.ok(public.sz_forest_set('Fern', true, true, null, null) ->> 'id' = (select id::text from fid), 'sharing again keeps the same link');

-- deleting the account takes the forest
select pg_temp.ok(public.sz_delete_me() ->> 'deleted' = 'true', 'Fern deletes her account');
reset role;
select pg_temp.ok(not exists (select 1 from public.sz_forests where user_id = :FERN) and not exists (select 1 from public.sz_forest_habits where user_id = :FERN),
  'her forest is gone with it');
select pg_temp.ok(exists (select 1 from public.sz_forests where user_id = :GUS), 'and Gus''s is not');
