-- End-to-end check of the nn_people_ functions on the scratch database that
-- scripts/test-nn-people-sql.sh builds. Every reader call runs as the anon
-- or authenticated role, the way the app's publishable key arrives. The
-- same answers come from the demo mirror in all-day/js/modes/people.js.
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
  ('33333333-3333-3333-3333-333333333333', 'kim@example.com');
insert into public.nn_mod (id, pass_hash) values (true, extensions.crypt('test-secret', extensions.gen_salt('bf', 4)))
  on conflict (id) do update set pass_hash = excluded.pass_hash;
create table pg_temp.ids (k text primary key, id uuid);
grant all on pg_temp.ids to anon, authenticated;

-- ------------------------------------------------------------ the locks
set role anon; select pg_temp.who(null);
select pg_temp.expect_denied('select * from public.nn_people_dir');
select pg_temp.expect_denied('select * from public.nn_people_plans');
select pg_temp.expect_denied($q$insert into public.nn_people_dir (user_id) values ('11111111-1111-1111-1111-111111111111')$q$);
select pg_temp.ok(public.nn_people_rules() ->> 'interestsMax' = '8', 'anon can read the People rules');
select pg_temp.ok(public.nn_people_directory() = '{"count":0,"me":false,"people":[]}'::jsonb, 'an empty directory: no one, and no people for a stranger');
select pg_temp.expect_error('select public.nn_people_optin(true)', 'not_signed_in');
select pg_temp.expect_error($q$select public.nn_people_plan_set('00000000-0000-0000-0000-000000000000', true)$q$, 'not_signed_in');
select pg_temp.ok(public.nn_people_plan_extras('{}') = '{}'::jsonb, 'no plans, no extras');
select pg_temp.ok(public.nn_people_meetup_list('wrong') = '{"error":"bad_secret"}'::jsonb, 'the Meetup list is behind the desk passphrase');

-- ------------------------------------------------------------ joining
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_error('select public.nn_people_optin(true)', 'no_name');
select public.nn_profile_set('Maya R.', 'old-north-end', 'trail');
select pg_temp.expect_error($q$select public.nn_people_optin(true, '{hacking}')$q$, 'bad_interest');
select pg_temp.expect_error($q$select public.nn_people_optin(true, array['running', null])$q$, 'bad_interest');
select pg_temp.expect_error($q$select public.nn_people_optin(true, '{sports,running,outdoors,games,music,dance,books,making,languages}')$q$, 'bad_interest');
select pg_temp.ok(public.nn_people_optin(true, '{running,games,running}') = '{"on":true,"interests":["running","games"]}'::jsonb, 'join: interests once each');
select pg_temp.ok(public.nn_people_optin(true) -> 'interests' = '[]'::jsonb, 'joining again replaces them');
select public.nn_people_optin(true, '{running,outdoors}');
select pg_temp.ok((public.nn_people_directory() ->> 'count')::int = 1 and (public.nn_people_directory() ->> 'me')::boolean, 'in it: counted, and it says so');
select pg_temp.ok(public.nn_people_directory() -> 'people' = '[{"name":"Maya R.","neighborhood":"old-north-end","archetype":"trail","interests":["running","outdoors"],"me":true}]'::jsonb,
  'a row is first name, neighborhood, archetype, interests and me: nothing else');

set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select public.nn_profile_set('Sam P.', 'hill', 'regular');
select pg_temp.ok(public.nn_people_directory() = '{"count":1,"me":false,"people":[]}'::jsonb, 'signed in but not in it: the count, no people');
select public.nn_people_optin(true, '{music}');
select pg_temp.ok(jsonb_array_length(public.nn_people_directory() -> 'people') = 2, 'in it: everyone in it');
select pg_temp.ok(public.nn_people_directory()::text !~ '@|1111-1111|2222-2222|user_id|email', 'the directory never carries an email or an account id');
set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_people_directory() = '{"count":2,"me":false,"people":[]}'::jsonb, 'a stranger gets the count and nobody');

-- the profile is the one place a name lives
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_profile_set('Maya', 'old-north-end', 'new');
select pg_temp.ok(public.nn_people_directory() -> 'people' @> '[{"name":"Maya","archetype":"new"}]'::jsonb, 'a renamed profile shows renamed');

-- leaving
select pg_temp.ok(public.nn_people_optin(false) = '{"on":false,"interests":[]}'::jsonb, 'leave');
select pg_temp.ok(public.nn_people_directory() = '{"count":1,"me":false,"people":[]}'::jsonb, 'gone from it, and no longer reading it');

-- ------------------------------------------------------------ plans
select pg_temp.who('11111111-1111-1111-1111-111111111111');
insert into pg_temp.ids select 'plan', (public.nn_post_create('people', 'plan', 'Trivia at Three Needs', '', 'Three Needs', '{"when":"Sat, Oct 18, 7 pm","spots":2}') ->> 'id')::uuid;
insert into pg_temp.ids select 'find', (public.nn_post_create('vintage', 'spotted', 'A find', '', '', '{"shop":"Old Gold"}') ->> 'id')::uuid;
select pg_temp.expect_error($q$select public.nn_post_create('people', 'plan', 'x', '', '', '{"when":"tonight","meetup":"yes"}')$q$, 'bad_meta');
select pg_temp.expect_error($q$select public.nn_people_plan_set((select id from pg_temp.ids where k = 'plan'), true, 'teens')$q$, 'bad_ages');
select pg_temp.expect_error($q$select public.nn_people_plan_set((select id from pg_temp.ids where k = 'find'), true)$q$, 'not_found');
select pg_temp.expect_error($q$select public.nn_people_plan_set(gen_random_uuid(), true)$q$, 'not_found');
select pg_temp.ok(public.nn_people_plan_set((select id from pg_temp.ids where k = 'plan'), true, 'thirties') = '{"meetup":true,"ages":"thirties"}'::jsonb, 'the author sets the box and the band');

select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_error($q$select public.nn_people_plan_set((select id from pg_temp.ids where k = 'plan'), false)$q$, 'not_found');

set role anon; select pg_temp.who(null);
select pg_temp.ok(public.nn_people_plan_extras(array[(select id from pg_temp.ids where k = 'plan'), (select id from pg_temp.ids where k = 'find')])
  = jsonb_build_object((select id from pg_temp.ids where k = 'plan')::text, '{"meetup":true,"ages":"thirties"}'::jsonb), 'anyone reads a live plan''s extras');
select pg_temp.ok(jsonb_array_length(public.nn_people_meetup_list('test-secret') -> 'plans') = 1, 'Stephen''s Meetup list holds it');
select pg_temp.ok(public.nn_people_meetup_list('test-secret') -> 'plans' -> 0 ->> 'author' = 'Maya', 'by first name');
select pg_temp.ok(public.nn_people_meetup_list('test-secret')::text !~ '@|user_id|1111-1111', 'and never an email or account id');

-- a plan taken down drops out; deleting it takes its extras with it
reset role;
update public.nn_posts set status = 'hidden' where id = (select id from pg_temp.ids where k = 'plan');
set role anon;
select pg_temp.ok(public.nn_people_plan_extras(array[(select id from pg_temp.ids where k = 'plan')]) = '{}'::jsonb, 'a hidden plan''s extras are not shown');
select pg_temp.ok(jsonb_array_length(public.nn_people_meetup_list('test-secret') -> 'plans') = 0, 'nor listed for Meetup');
reset role;
update public.nn_posts set status = 'approved' where id = (select id from pg_temp.ids where k = 'plan');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_people_plan_set((select id from pg_temp.ids where k = 'plan'), false, '');
reset role;
select pg_temp.ok(not exists (select 1 from public.nn_people_plans), 'no box and no band leaves no row');
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_people_plan_set((select id from pg_temp.ids where k = 'plan'), true);
select public.nn_post_delete_own((select id from pg_temp.ids where k = 'plan'));
reset role;
select pg_temp.ok(not exists (select 1 from public.nn_people_plans), 'a deleted plan takes its extras');

-- ------------------------------------------------------------ bans and deleting
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_people_optin(true, '{games}');
reset role;
insert into public.nn_bans (user_id) values ('11111111-1111-1111-1111-111111111111');
set role authenticated; select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((public.nn_people_directory() ->> 'count')::int = 1 and jsonb_array_length(public.nn_people_directory() -> 'people') = 1, 'a banned reader drops out of the directory');
select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(public.nn_people_directory() -> 'people' = '[]'::jsonb and not (public.nn_people_directory() ->> 'me')::boolean, 'a banned reader still in it can no longer read it');
select pg_temp.expect_error('select public.nn_people_optin(true)', 'banned');
select pg_temp.expect_error($q$select public.nn_people_plan_set(gen_random_uuid(), true)$q$, 'banned');
select pg_temp.ok(public.nn_people_optin(false) ->> 'on' = 'false', 'but can always leave');
reset role;
select pg_temp.ok(not exists (select 1 from public.nn_people_dir where user_id = '11111111-1111-1111-1111-111111111111'), 'and leaving removes the row');
insert into public.nn_people_dir (user_id, interests) values ('11111111-1111-1111-1111-111111111111', '{games}');
set role authenticated;
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select public.nn_delete_me();
reset role;
select pg_temp.ok(not exists (select 1 from public.nn_people_dir where user_id = '22222222-2222-2222-2222-222222222222'), 'Delete my account removes the directory row');
select pg_temp.ok(exists (select 1 from public.nn_people_dir where user_id = '11111111-1111-1111-1111-111111111111'), 'and touches no one else''s');
