-- ============================================================================
-- CLUBS & GROUPS — "Add your group or gathering", one-time Supabase setup.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   groups_
-- Page:     clubs.html (js/clubs.js) posts here; groups-mod.html approves.
-- Written:  2026-10-17
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: every
-- statement is "if not exists" or "create or replace", and nothing here
-- deletes a submission. db/GROUPS-SETUP.md has the steps.
--
-- Needs, already in this project: pgcrypto, and the moderator passphrase
-- check public.nn_mod_ok(text) from all-day/supabase/nn-SETUP.sql. The
-- approve page uses the SAME passphrase as the All Day boards desk.
--
-- What it holds, in plain words:
--   groups_submissions   what a reader sent: the group's name, kind, when,
--                        where, a link, a contact email and a note, with its
--                        status (pending, approved, rejected). The email is
--                        for Stephen only and never leaves through the public
--                        read. A hashed device id and a hashed network
--                        address are kept for the rate limits, never shown.
--
-- Security model, the fleet's: RLS is on with NO policies and the table is
-- revoked from anon and authenticated, so the public key reaches it only
-- through the four security-definer functions below:
--   groups_submit(...)          anyone; validated and rate limited
--   groups_public()             anyone; approved rows only, no email
--   groups_mod_list(secret)     the moderator; everything waiting
--   groups_mod_act(secret, id, action)   approve, reject, pending, delete
--
-- Honest threat model: anyone can mint a device id, and the network address
-- comes from the x-forwarded-for header Supabase's gateway passes on, which
-- a script can pad. So the per-device (3 a day) and per-address (6 a day)
-- limits stop casual repeats, and the global limits (30 an hour, 200
-- waiting) are what stop a flood. Nothing a reader sends is shown anywhere
-- until Stephen approves it, and the page renders approved text as text.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.groups_submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  status      text not null default 'pending',
  decided_at  timestamptz,
  name        text not null,
  kind        text not null,
  when_text   text not null,
  where_text  text not null,
  url         text not null default '',
  email       text not null,
  note        text not null default '',
  device_hash text not null,
  addr_hash   text not null default ''
);
-- "spam" is a deleted row kept as a tombstone: its text is wiped, but its
-- hashes and time stay so the rate limits below still count it.
alter table public.groups_submissions drop constraint if exists groups_submissions_status_check;
alter table public.groups_submissions add constraint groups_submissions_status_check
  check (status in ('pending', 'approved', 'rejected', 'spam'));
create index if not exists groups_submissions_status_idx on public.groups_submissions (status, created_at);
create index if not exists groups_submissions_device_idx on public.groups_submissions (device_hash, created_at);
create index if not exists groups_submissions_addr_idx on public.groups_submissions (addr_hash, created_at);

alter table public.groups_submissions enable row level security;
revoke all on table public.groups_submissions from public, anon, authenticated;

-- ---------------------------------------------------------------- the rules
-- The same kinds as KINDS in js/clubs.js and scripts/build_groups.py (plus
-- "run"); tests/test_build_groups.py fails when they differ.
create or replace function public.groups_rules() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'kinds', jsonb_build_array('run', 'league', 'pickup', 'games', 'trivia', 'books', 'language',
                               'music', 'dance', 'making', 'outdoors', 'social', 'other'),
    'max', jsonb_build_object('name', 80, 'when', 120, 'where', 120, 'url', 300, 'email', 200, 'note', 500),
    'perDevicePerDay', 3, 'perAddrPerDay', 6, 'perHour', 30, 'waiting', 200)
$$;

-- one line of plain text: control characters out, runs of space folded
create or replace function public.groups_clean(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------- submit
-- Returns {"ok":true} (also for a repeat of something already waiting or
-- listed, so a double tap does no harm) or {"error":"<code>"}:
--   bad_name, bad_kind, bad_when, bad_where, bad_url, bad_email, bad_note,
--   bad_device, too_many_links, slow_down (this device or address), busy
--   (everyone, this hour), queue_full.
create or replace function public.groups_submit(
  p_name text, p_kind text, p_when text, p_where text, p_url text,
  p_email text, p_note text, p_device text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r jsonb := public.groups_rules();
  v_name text := public.groups_clean(p_name);
  v_kind text := lower(public.groups_clean(p_kind));
  v_when text := public.groups_clean(p_when);
  v_where text := public.groups_clean(p_where);
  v_url text := public.groups_clean(p_url);
  v_email text := lower(public.groups_clean(p_email));
  v_note text := public.groups_clean(p_note);
  v_device text := public.groups_clean(p_device);
  v_addr text := '';
  v_dev_hash text;
  v_addr_hash text := '';
  v_links int;
begin
  if char_length(v_name) < 3 or char_length(v_name) > (r #>> '{max,name}')::int or v_name ~ '[<>]' then
    return jsonb_build_object('error', 'bad_name'); end if;
  if not (r -> 'kinds') ? v_kind then return jsonb_build_object('error', 'bad_kind'); end if;
  if char_length(v_when) < 3 or char_length(v_when) > (r #>> '{max,when}')::int or v_when ~ '[<>]' then
    return jsonb_build_object('error', 'bad_when'); end if;
  if char_length(v_where) < 2 or char_length(v_where) > (r #>> '{max,where}')::int or v_where ~ '[<>]' then
    return jsonb_build_object('error', 'bad_where'); end if;
  if v_url <> '' and (char_length(v_url) > (r #>> '{max,url}')::int
      or v_url !~* '^https?://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]<>"''`]*)?$') then
    return jsonb_build_object('error', 'bad_url'); end if;
  if char_length(v_email) > (r #>> '{max,email}')::int
      or v_email !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    return jsonb_build_object('error', 'bad_email'); end if;
  if char_length(v_note) > (r #>> '{max,note}')::int or v_note ~ '[<>]' then
    return jsonb_build_object('error', 'bad_note'); end if;
  if v_device !~ '^[A-Za-z0-9_-]{8,64}$' then return jsonb_build_object('error', 'bad_device'); end if;
  -- a link belongs in the link field; text fields with links in them are spam's shape
  select count(*) into v_links from regexp_matches(v_name || ' ' || v_when || ' ' || v_where || ' ' || v_note,
    '(https?://|www\.|\.(com|net|org|ru|xyz|top|io)\M)', 'gi');
  if v_links > 0 then return jsonb_build_object('error', 'too_many_links'); end if;

  v_dev_hash := encode(extensions.digest('groups:dev:' || v_device, 'sha256'), 'hex');
  begin
    v_addr := btrim(split_part(coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1));
  exception when others then v_addr := '';
  end;
  if v_addr <> '' then
    v_addr_hash := encode(extensions.digest('groups:addr:' || v_addr, 'sha256'), 'hex');
  end if;

  -- serialise the repeat and limit checks so parallel calls cannot all slip under them
  perform pg_advisory_xact_lock(hashtext('groups_submit'));

  if (select count(*) from public.groups_submissions
       where device_hash = v_dev_hash and created_at > now() - interval '1 day') >= (r ->> 'perDevicePerDay')::int then
    return jsonb_build_object('error', 'slow_down'); end if;
  if v_addr_hash <> '' and (select count(*) from public.groups_submissions
       where addr_hash = v_addr_hash and created_at > now() - interval '1 day') >= (r ->> 'perAddrPerDay')::int then
    return jsonb_build_object('error', 'slow_down'); end if;
  -- the very same submission again (a double tap, a retry) is a quiet
  -- success; it sits after the per-sender limits so a sender over them
  -- cannot keep replaying one. Every field and the sender's email must match, so nobody can
  -- pre-empt someone else's group by sending its name and night first.
  if exists (select 1 from public.groups_submissions s
              where s.status = 'pending' and s.email = v_email
                and lower(s.name) = lower(v_name) and lower(s.when_text) = lower(v_when)
                and lower(s.where_text) = lower(v_where) and s.url = v_url and s.note = v_note
                and s.created_at > now() - interval '1 day') then
    return jsonb_build_object('ok', true, 'repeat', true);
  end if;
  if (select count(*) from public.groups_submissions where created_at > now() - interval '1 hour') >= (r ->> 'perHour')::int then
    return jsonb_build_object('error', 'busy'); end if;
  if (select count(*) from public.groups_submissions where status = 'pending') >= (r ->> 'waiting')::int then
    return jsonb_build_object('error', 'queue_full'); end if;

  insert into public.groups_submissions (name, kind, when_text, where_text, url, email, note, device_hash, addr_hash)
  values (v_name, v_kind, v_when, v_where, v_url, v_email, v_note, v_dev_hash, v_addr_hash);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- public read
-- Approved groups only, newest approval first. Never the email, the note
-- (it is a message to Stephen), or the hashes.
create or replace function public.groups_public() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'name', x.name, 'kind', x.kind, 'when', x.when_text,
           'where', x.where_text, 'url', x.url, 'approved_at', x.decided_at)
         order by x.decided_at desc), '[]'::jsonb)
    from (select * from public.groups_submissions where status = 'approved'
           order by decided_at desc nulls last limit 300) x
$$;

-- ---------------------------------------------------------------- moderator
-- Everything waiting (oldest first) and the 60 most recent decisions, with
-- the contact email and note. Rejected rows older than 90 days are cleared,
-- and spam tombstones once the one-day rate-limit windows are past.
create or replace function public.groups_mod_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  delete from public.groups_submissions
   where (status = 'rejected' and decided_at < now() - interval '90 days')
      or (status = 'spam' and created_at < now() - interval '2 days');
  return jsonb_build_object(
    'waiting', (select coalesce(jsonb_agg(public.groups_row_json(s) order by s.created_at), '[]'::jsonb)
                  from public.groups_submissions s where s.status = 'pending'),
    'decided', (select coalesce(jsonb_agg(public.groups_row_json(x) order by x.decided_at desc), '[]'::jsonb)
                  from (select * from public.groups_submissions where status in ('approved', 'rejected')
                         order by decided_at desc nulls last limit 60) x));
end $$;

create or replace function public.groups_row_json(s public.groups_submissions) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', s.id, 'created_at', s.created_at, 'status', s.status,
    'decided_at', s.decided_at, 'name', s.name, 'kind', s.kind, 'when', s.when_text,
    'where', s.where_text, 'url', s.url, 'email', s.email, 'note', s.note)
$$;

-- approve (it shows on clubs.html), reject (it doesn't), pending (back in
-- the queue), delete (for spam: off every list and its text wiped, kept as
-- a tombstone for two days so the sender's rate limits still count it)
create or replace function public.groups_mod_act(p_secret text, p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  if not exists (select 1 from public.groups_submissions where id = p_id) then
    return jsonb_build_object('error', 'not_found'); end if;
  if p_action in ('approve', 'reject') then
    update public.groups_submissions
       set status = case p_action when 'approve' then 'approved' else 'rejected' end, decided_at = now()
     where id = p_id;
  elsif p_action = 'pending' then
    update public.groups_submissions set status = 'pending', decided_at = null where id = p_id;
  elsif p_action = 'delete' then
    update public.groups_submissions
       set status = 'spam', decided_at = now(), name = '', when_text = '', where_text = '',
           url = '', email = '', note = ''
     where id = p_id;
  else
    return jsonb_build_object('error', 'bad_action');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------ grants
-- Postgres lets everyone run a new function, and Supabase also grants new
-- functions to anon and authenticated by default; take that back first,
-- then hand out exactly the doors the page uses.
revoke all on function
  public.groups_rules(), public.groups_clean(text),
  public.groups_submit(text, text, text, text, text, text, text, text),
  public.groups_public(), public.groups_mod_list(text),
  public.groups_row_json(public.groups_submissions),
  public.groups_mod_act(text, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.groups_rules(),
  public.groups_submit(text, text, text, text, text, text, text, text),
  public.groups_public(), public.groups_mod_list(text),
  public.groups_mod_act(text, uuid, text)
  to anon, authenticated;
