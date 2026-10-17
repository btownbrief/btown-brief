-- The Watch tab's seen-dots (all-day/supabase/nn-watch.sql) on the scratch
-- database scripts/test-nn-watch-sql.sh builds, called as anon and as
-- signed-in readers, the way the app's publishable key arrives.
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
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com');

-- the locks: nobody reads the tables, anon reaches no door
set role anon; select pg_temp.who(null);
select pg_temp.expect_denied('select * from public.nn_watch_seen');
select pg_temp.expect_denied('select * from public.nn_watch_partner');
select pg_temp.expect_denied('select public.nn_watch_seen_get()');
select pg_temp.expect_denied('select public.nn_watch_seen_set(603, true, false)');
select pg_temp.expect_denied('select public.nn_watch_forget()');
reset role;

set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_denied('select * from public.nn_watch_seen');
select pg_temp.expect_denied('select public.nn_watch_cap()');
-- a signed-in role with no account id still hears the app's own word
select pg_temp.who(null);
select pg_temp.expect_error('select public.nn_watch_seen_get()', 'not_signed_in');
select pg_temp.expect_error('select public.nn_watch_seen_set(603, true, false)', 'not_signed_in');
select pg_temp.who('11111111-1111-1111-1111-111111111111');

-- set, read back, change, clear
select pg_temp.ok(public.nn_watch_seen_get() = '{"partner": null, "seen": []}'::jsonb, 'empty to start');
select pg_temp.ok(public.nn_watch_seen_set(603, true, false) = '{"film": 603, "me": true, "partner": false}'::jsonb, 'set answers the row');
select public.nn_watch_seen_set(278, true, true, '  Sam   ');
select pg_temp.ok((public.nn_watch_seen_get() ->> 'partner') = 'Sam', 'the partner name, tidied');
select pg_temp.ok(jsonb_array_length(public.nn_watch_seen_get() -> 'seen') = 2, 'two films');
select pg_temp.ok((public.nn_watch_seen_get() -> 'seen' -> 0) = '[278, true, true]'::jsonb, 'newest first, [id, me, partner]');
select public.nn_watch_seen_set(603, false, true);
select pg_temp.ok((select s from jsonb_array_elements(public.nn_watch_seen_get() -> 'seen') s where s ->> 0 = '603') = '[603, false, true]'::jsonb, 'changed in place');
select public.nn_watch_seen_set(603, false, false);
select pg_temp.ok(jsonb_array_length(public.nn_watch_seen_get() -> 'seen') = 1, 'both off deletes the row');
select public.nn_watch_seen_set(278, null, true);
select pg_temp.ok((public.nn_watch_seen_get() -> 'seen' -> 0) = '[278, false, true]'::jsonb, 'null is off');
select pg_temp.ok((public.nn_watch_seen_get() ->> 'partner') = 'Sam', 'no name given keeps the name');

-- refusals
select pg_temp.expect_error('select public.nn_watch_seen_set(0, true, false)', 'bad_film');
select pg_temp.expect_error('select public.nn_watch_seen_set(null, true, false)', 'bad_film');
select pg_temp.expect_error('select public.nn_watch_seen_set(5, true, false, ''sam@example.com'')', 'bad_name');
select pg_temp.expect_error('select public.nn_watch_seen_set(5, true, false, repeat(''x'', 33))', 'bad_name');
select public.nn_watch_seen_set(5, true, false, '');
select pg_temp.ok((public.nn_watch_seen_get() ->> 'partner') is null, 'an empty name forgets it');

-- another reader sees only their own
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(public.nn_watch_seen_get() = '{"partner": null, "seen": []}'::jsonb, 'Sam sees none of Maya''s dots');
select public.nn_watch_seen_set(603, true, false);
select pg_temp.who('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(jsonb_array_length(public.nn_watch_seen_get() -> 'seen') = 2, 'and Maya none of Sam''s');

-- the cap
reset role;
create or replace function public.nn_watch_cap() returns integer language sql immutable as $$ select 3 $$;
revoke all on function public.nn_watch_cap() from public, anon, authenticated;
set role authenticated; select pg_temp.who('11111111-1111-1111-1111-111111111111');
select public.nn_watch_seen_set(6, true, false);
select pg_temp.expect_error('select public.nn_watch_seen_set(7, true, false)', 'too_many');
select pg_temp.ok((public.nn_watch_seen_set(6, true, true) ->> 'partner')::boolean, 'a film already marked can still change at the cap');

-- forget
select public.nn_watch_forget();
select pg_temp.ok(public.nn_watch_seen_get() = '{"partner": null, "seen": []}'::jsonb, 'forget clears dots and name');
select pg_temp.who('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(jsonb_array_length(public.nn_watch_seen_get() -> 'seen') = 1, 'and only the reader''s own');

-- an account deleted from Supabase takes its rows with it
reset role;
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok(not exists (select 1 from public.nn_watch_seen where user_id = '22222222-2222-2222-2222-222222222222'), 'cascade on account delete');
