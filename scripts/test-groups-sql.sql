-- End-to-end check of db/groups-submit.sql on the scratch database that
-- scripts/test-groups-sql.sh builds. Reader calls run as the anon role, the
-- way clubs.html's publishable key arrives.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAILED: %', what; end if; end $$;
create function pg_temp.expect_denied(q text) returns void language plpgsql as $$
begin
  begin execute q; raise exception 'expected permission denied but it succeeded: %', q;
  exception when insufficient_privilege then null;
  end;
end $$;
create function pg_temp.sub(name text, kind text, wh text, wr text, url text, email text, note text, dev text) returns jsonb
language sql as $$ select public.groups_submit(name, kind, wh, wr, url, email, note, dev) $$;
create function pg_temp.err(j jsonb) returns text language sql as $$ select j ->> 'error' $$;
create function pg_temp.addr(ip text) returns void language sql as $$
  select set_config('request.headers', case when ip is null then '' else json_build_object('x-forwarded-for', ip)::text end, false) $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

insert into public.nn_mod (id, pass_hash) values (true, extensions.crypt('test-secret', extensions.gen_salt('bf', 4)))
  on conflict (id) do update set pass_hash = excluded.pass_hash;

-- ------------------------------------------------------------ the locks
set role anon;
select pg_temp.expect_denied('select * from public.groups_submissions');
select pg_temp.expect_denied($q$insert into public.groups_submissions (name, kind, when_text, where_text, email, device_hash) values ('x','games','x','x','x','x')$q$);
select pg_temp.expect_denied($q$select public.groups_row_json(null::public.groups_submissions)$q$);
select pg_temp.ok(public.groups_public() = '[]'::jsonb, 'nothing approved yet');
select pg_temp.ok(public.groups_mod_list('wrong') = '{"error":"bad_secret"}'::jsonb, 'the queue is behind the passphrase');
select pg_temp.ok(public.groups_mod_list('') = '{"error":"bad_secret"}'::jsonb, 'an empty passphrase opens nothing');
select pg_temp.ok(public.groups_mod_act('wrong', gen_random_uuid(), 'approve') = '{"error":"bad_secret"}'::jsonb, 'acting is behind it too');
select pg_temp.ok((public.groups_rules() -> 'kinds') ? 'pickup', 'anon can read the rules');

-- ------------------------------------------------------------ validation
select pg_temp.addr(null);
select pg_temp.ok(pg_temp.err(pg_temp.sub('ab', 'games', 'Tuesdays', 'Here', '', 'a@b.co', '', 'device-0000001')) = 'bad_name', 'name too short');
select pg_temp.ok(pg_temp.err(pg_temp.sub(repeat('x', 81), 'games', 'Tuesdays', 'Here', '', 'a@b.co', '', 'device-0000001')) = 'bad_name', 'name too long');
select pg_temp.ok(pg_temp.err(pg_temp.sub('<script>x</script>', 'games', 'Tuesdays', 'Here', '', 'a@b.co', '', 'device-0000001')) = 'bad_name', 'no angle brackets');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'casino', 'Tuesdays', 'Here', '', 'a@b.co', '', 'device-0000001')) = 'bad_kind', 'unknown kind');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', '', 'Here', '', 'a@b.co', '', 'device-0000001')) = 'bad_when', 'when is required');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', '', '', 'a@b.co', '', 'device-0000001')) = 'bad_where', 'where is required');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', 'Here', 'javascript:alert(1)', 'a@b.co', '', 'device-0000001')) = 'bad_url', 'javascript: links are refused');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', 'Here', 'https://x.org/"onmouseover=1', 'a@b.co', '', 'device-0000001')) = 'bad_url', 'quotes in a link are refused');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', 'Here', 'ftp://x.org', 'a@b.co', '', 'device-0000001')) = 'bad_url', 'only http and https');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', 'Here', '', 'not-an-email', '', 'device-0000001')) = 'bad_email', 'email must look like one');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', 'Here', '', '', '', 'device-0000001')) = 'bad_email', 'email is required');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', 'Here', '', 'a@b.co', repeat('y', 501), 'device-0000001')) = 'bad_note', 'note has a cap');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', 'Here', '', 'a@b.co', '', 'x')) = 'bad_device', 'device id must look like one');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Chess club', 'games', 'Tuesdays', 'Here', '', 'a@b.co', 'buy at https://a.ru and www.b.com', 'device-0000001')) = 'too_many_links', 'links in the text fields are spam');

-- ------------------------------------------------------------ submitting
select pg_temp.ok(pg_temp.sub('  Tuesday   Night Chess ', 'Games', E'Tuesdays\t7pm', 'Fletcher Free Library', 'https://example.org/chess?x=1#a',
  'Organizer@Example.org', 'We are friendly.', 'device-0000001') = '{"ok": true}'::jsonb, 'a good submission');
select pg_temp.ok(pg_temp.sub('Tuesday night chess', 'games', 'Tuesdays 7pm', 'Somewhere', '', 'b@c.co', '', 'device-0000099')
  = '{"ok": true, "repeat": true}'::jsonb, 'the same group twice is a quiet success');
select pg_temp.ok(public.groups_public() = '[]'::jsonb, 'nothing shows before Stephen approves it');

-- per device: three a day
select pg_temp.sub('Group two', 'pickup', 'Sundays', 'Park', '', 'a@b.co', '', 'device-0000001');
select pg_temp.sub('Group three', 'pickup', 'Sundays', 'Park', '', 'a@b.co', '', 'device-0000001');
select pg_temp.ok(pg_temp.err(pg_temp.sub('Group four', 'pickup', 'Sundays', 'Park', '', 'a@b.co', '', 'device-0000001')) = 'slow_down', 'a fourth from one device in a day is refused');
-- per address: six a day, whatever device id is sent
select pg_temp.addr('203.0.113.9, 10.0.0.1');
select pg_temp.sub('Addr ' || g, 'social', 'Fridays', 'Bar', '', 'a@b.co', '', 'device-addr-' || g) from generate_series(1, 6) g;
select pg_temp.ok(pg_temp.err(pg_temp.sub('Addr 7', 'social', 'Fridays', 'Bar', '', 'a@b.co', '', 'device-addr-7')) = 'slow_down', 'a seventh from one address is refused');
select pg_temp.addr('198.51.100.7');
select pg_temp.ok(pg_temp.sub('Other address', 'social', 'Fridays', 'Bar', '', 'a@b.co', '', 'device-addr-8') = '{"ok": true}'::jsonb, 'another address is fine');

-- everyone: thirty an hour
select pg_temp.addr(null);
select pg_temp.sub('Flood ' || g, 'other', 'Daily', 'Here', '', 'a@b.co', '', 'device-flood-' || g) from generate_series(1, 25) g;
select pg_temp.ok(pg_temp.err(pg_temp.sub('Flood 99', 'other', 'Daily', 'Here', '', 'a@b.co', '', 'device-flood-99')) = 'busy', 'thirty an hour from everyone, then busy');

-- ------------------------------------------------------------ moderating
reset role;
update public.groups_submissions set created_at = created_at - interval '2 hours';
set role anon;
select pg_temp.ok(jsonb_array_length(public.groups_mod_list('test-secret') -> 'waiting') = 30, 'thirty waiting');
select pg_temp.ok((public.groups_mod_list('test-secret') #>> '{waiting,0,email}') = 'organizer@example.org', 'the moderator sees the email, lower-cased');
select pg_temp.ok((public.groups_mod_list('test-secret') #>> '{waiting,0,name}') = 'Tuesday Night Chess', 'text is trimmed and folded');
select pg_temp.ok((public.groups_mod_list('test-secret') #>> '{waiting,0,when}') = 'Tuesdays 7pm', 'tabs fold to spaces');
create temp table chess as select (public.groups_mod_list('test-secret') #>> '{waiting,0,id}')::uuid id;
select pg_temp.ok(public.groups_mod_act('test-secret', (select id from chess), 'publish') = '{"error":"bad_action"}'::jsonb, 'unknown action');
select pg_temp.ok(public.groups_mod_act('test-secret', gen_random_uuid(), 'approve') = '{"error":"not_found"}'::jsonb, 'unknown id');
select pg_temp.ok(public.groups_mod_act('test-secret', (select id from chess), 'approve') = '{"ok":true}'::jsonb, 'approve');
select pg_temp.ok(jsonb_array_length(public.groups_public()) = 1, 'approved shows publicly');
select pg_temp.ok(not (public.groups_public() -> 0 ? 'email') and not (public.groups_public() -> 0 ? 'note'), 'the public read never has the email or the note');
select pg_temp.ok(public.groups_public() #>> '{0,url}' = 'https://example.org/chess?x=1#a', 'the link survives');
select pg_temp.ok(public.groups_mod_act('test-secret', (select id from chess), 'reject') = '{"ok":true}'::jsonb, 'reject');
select pg_temp.ok(public.groups_public() = '[]'::jsonb, 'rejected leaves the page');
select pg_temp.ok(public.groups_mod_act('test-secret', (select id from chess), 'pending') = '{"ok":true}'::jsonb, 'back to the queue');
select pg_temp.ok(public.groups_mod_act('test-secret', (select id from chess), 'delete') = '{"ok":true}'::jsonb, 'delete');
select pg_temp.ok(jsonb_array_length(public.groups_mod_list('test-secret') -> 'waiting') = 29, 'deleted is gone');
-- the queue cap
reset role;
insert into public.groups_submissions (name, kind, when_text, where_text, email, device_hash, created_at)
  select 'Old ' || g, 'other', 'x', 'x', 'a@b.co', 'h' || g, now() - interval '3 days' from generate_series(1, 171) g;
set role anon;
select pg_temp.ok(pg_temp.err(pg_temp.sub('One too many', 'other', 'Daily', 'Here', '', 'a@b.co', '', 'device-cap-1')) = 'queue_full', 'two hundred waiting is the cap');
