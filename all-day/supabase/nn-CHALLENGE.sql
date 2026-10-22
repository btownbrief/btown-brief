-- ============================================================================
-- ALL DAY — the No-algorithm challenge's feedback, one-time Supabase setup.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   nn_  (the New Nine's)
-- Written:  2026-10-22
--
-- How to run: from the newsletter repo, `bash scripts/setup_boards.sh
-- challenge` copies this file and opens the SQL editor; paste, Run. Safe to
-- run again: the table is "if not exists", the functions "create or
-- replace", and nothing here deletes a row.
--
-- Needs: pgcrypto and the boards' moderator gate (nn_mod_ok, from
-- nn-SETUP.sql), both already installed. The feedback form works without
-- the gate; only Stephen's reading view on the boards desk (mod.html) uses it.
--
-- What it holds, in plain words:
--   nn_challenge_feedback   one row per phone that sent the challenge's
--                           form: what they missed, what would make them
--                           switch, which kind of person they are, how far
--                           into the five days they were and how each day
--                           felt. A phone is a random id it made itself
--                           (cid); sending again from the same phone updates
--                           its row. No name, no email, no account id, no IP.
--
-- Who can read it: only Stephen. RLS is on with NO policies and the table is
-- revoked from anon and authenticated, so the public key cannot select,
-- update or delete a single row. Readers reach it through one door,
-- nn_challenge_send, which can only write the caller's own answers. Stephen
-- reads it in the Supabase table editor (Table Editor -> nn_challenge_feedback),
-- or on the boards desk behind his moderator passphrase (nn_challenge_list).
--
-- Honest threat model: anyone can mint ids, so a script could send many
-- made-up rows. A cap of 300 new rows an hour and 20 edits per id stop
-- casual flooding, not a determined one; the rows are opinions, nothing
-- acts on them.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.nn_challenge_feedback (
  cid             text primary key check (cid ~ '^[A-Za-z0-9-]{8,64}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  edits           int not null default 1,
  source          text not null default 'app' check (source in ('newsletter', 'link', 'app')),
  joined_on       date,
  day             int not null default 0 check (day between 0 and 6),
  feelings        text[] not null default '{}',
  feed_free_days  int not null default 0,
  missed          text[] not null default '{}',
  missed_other    text not null default '' check (char_length(missed_other) <= 300),
  switch_for      text not null default '' check (char_length(switch_for) <= 1000),
  archetype       text,
  archetype_words text not null default '' check (char_length(archetype_words) <= 120)
);
create index if not exists nn_challenge_feedback_created on public.nn_challenge_feedback (created_at);

alter table public.nn_challenge_feedback enable row level security;
revoke all on table public.nn_challenge_feedback from anon, authenticated;

-- ---------------------------------------------------------------- the lists
-- The same lists as all-day/js/challenge-core.js (FEELINGS, MISSED,
-- ARCHETYPES). The spec reads this file and fails when they differ.
create or replace function public.nn_challenge_lists() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'version', 1,
    'feelings', jsonb_build_array('great', 'calmer', 'same', 'itchy', 'caved'),
    'missed', jsonb_build_array('friends', 'messages', 'groups', 'events', 'news', 'creators', 'memes', 'video', 'market', 'sports', 'nothing'),
    'archetypes', jsonb_build_array('nightowl', 'foodie', 'newshound', 'joiner', 'outdoors', 'homebody', 'maker', 'parent', 'newcomer', 'student', 'other'))
$$;

-- Tidy a reader's words the way challenge-core.js clean() does: control
-- characters out (newlines kept when multiline), spaces squeezed, trimmed, cut.
create or replace function public.nn_challenge_clean(s text, max_len int, multiline boolean default false) returns text
language plpgsql immutable as $$
declare t text := coalesce(s, '');
begin
  if multiline then
    t := regexp_replace(t, E'[\\x01-\\x09\\x0B-\\x1F\\x7F]', ' ', 'g');
  else
    t := regexp_replace(t, E'[\\x01-\\x1F\\x7F]', ' ', 'g');
  end if;
  t := regexp_replace(t, E'[ \\t]+', ' ', 'g');
  t := regexp_replace(t, E'\\n{3,}', E'\n\n', 'g');
  return btrim(left(btrim(t), max_len));
end $$;

-- ----------------------------------------------------------------- the door
-- One phone's answers. Sending again from the same phone (same cid) updates
-- its row. Returns {"ok":true} or {"error": code}, never raises for a bad
-- answer, so the app always hears one clear word back.
create or replace function public.nn_challenge_send(
  p_cid text, p_source text, p_joined date, p_day int, p_feelings text[],
  p_missed text[], p_missed_other text, p_switch_for text, p_archetype text, p_archetype_words text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l jsonb := public.nn_challenge_lists();
  v_feel text[] := '{}';
  v_missed text[] := '{}';
  v_other text := public.nn_challenge_clean(p_missed_other, 300);
  v_switch text := public.nn_challenge_clean(p_switch_for, 1000, true);
  v_words text := public.nn_challenge_clean(p_archetype_words, 120);
  v_arch text := nullif(p_archetype, '');
  v_free int;
  x text;
begin
  if p_cid is null or p_cid !~ '^[A-Za-z0-9-]{8,64}$' then return jsonb_build_object('error', 'bad_input'); end if;
  if coalesce(p_source, 'app') not in ('newsletter', 'link', 'app') then return jsonb_build_object('error', 'bad_input'); end if;
  if p_day is not null and (p_day < 0 or p_day > 6) then return jsonb_build_object('error', 'bad_input'); end if;
  if p_joined is not null and (p_joined < date '2026-10-01' or p_joined > (now() at time zone 'America/New_York')::date + 1) then
    return jsonb_build_object('error', 'bad_input');
  end if;
  if v_arch is not null and not (l -> 'archetypes') ? v_arch then return jsonb_build_object('error', 'bad_input'); end if;
  if cardinality(coalesce(p_feelings, '{}')) > 5 or cardinality(coalesce(p_missed, '{}')) > 11 then return jsonb_build_object('error', 'bad_input'); end if;
  foreach x in array coalesce(p_feelings, '{}') loop
    if x !~ '^[1-5]:[a-z]+$' or not (l -> 'feelings') ? split_part(x, ':', 2) then return jsonb_build_object('error', 'bad_input'); end if;
    if not x = any (v_feel) then v_feel := v_feel || x; end if;
  end loop;
  foreach x in array coalesce(p_missed, '{}') loop
    if not (l -> 'missed') ? x then return jsonb_build_object('error', 'bad_input'); end if;
    if not x = any (v_missed) then v_missed := v_missed || x; end if;
  end loop;
  if cardinality(v_missed) = 0 and v_other = '' and v_switch = '' and v_arch is null and v_words = '' then
    return jsonb_build_object('error', 'empty');
  end if;
  select count(*) into v_free from unnest(v_feel) f where split_part(f, ':', 2) <> 'caved';

  -- one phone at a time, and the hourly cap on new rows
  perform pg_advisory_xact_lock(hashtext('nn_challenge:' || p_cid));
  if exists (select 1 from public.nn_challenge_feedback where cid = p_cid) then
    if (select edits from public.nn_challenge_feedback where cid = p_cid) >= 20 then return jsonb_build_object('error', 'busy'); end if;
    update public.nn_challenge_feedback set
      updated_at = now(), edits = edits + 1, source = coalesce(p_source, source), joined_on = p_joined,
      day = coalesce(p_day, 0), feelings = v_feel, feed_free_days = v_free, missed = v_missed,
      missed_other = v_other, switch_for = v_switch, archetype = v_arch, archetype_words = v_words
     where cid = p_cid;
  else
    perform pg_advisory_xact_lock(hashtext('nn_challenge:new'));
    if (select count(*) from public.nn_challenge_feedback where created_at > now() - interval '1 hour') >= 300 then
      return jsonb_build_object('error', 'busy');
    end if;
    insert into public.nn_challenge_feedback (cid, source, joined_on, day, feelings, feed_free_days, missed, missed_other, switch_for, archetype, archetype_words)
    values (p_cid, coalesce(p_source, 'app'), p_joined, coalesce(p_day, 0), v_feel, v_free, v_missed, v_other, v_switch, v_arch, v_words);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- --------------------------------------------------------- Stephen's view
-- Every row, newest first, plus the tallies, behind the boards desk's
-- passphrase (nn_mod_ok: the same gate and wrong-guess counter).
create or replace function public.nn_challenge_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  return jsonb_build_object(
    'count', (select count(*) from public.nn_challenge_feedback),
    'archetypes', (select coalesce(jsonb_object_agg(a, n), '{}'::jsonb) from (
       select archetype a, count(*) n from public.nn_challenge_feedback where archetype is not null group by archetype) t),
    'missed', (select coalesce(jsonb_object_agg(m, n), '{}'::jsonb) from (
       select m, count(*) n from public.nn_challenge_feedback, unnest(missed) m group by m) t),
    'feelings', (select coalesce(jsonb_object_agg(f, n), '{}'::jsonb) from (
       select split_part(f, ':', 2) f, count(*) n from public.nn_challenge_feedback, unnest(feelings) f group by 1) t),
    'rows', (select coalesce(jsonb_agg(to_jsonb(r) - 'cid' order by r.updated_at desc), '[]'::jsonb) from (
       select * from public.nn_challenge_feedback order by updated_at desc limit 500) r));
end $$;

-- ------------------------------------------------------------------ grants
-- Postgres lets everyone run a new function, and Supabase also grants new
-- functions to anon and authenticated by default; take that back first,
-- then hand out exactly the two doors the app and the desk use.
revoke all on function
  public.nn_challenge_lists(), public.nn_challenge_clean(text, int, boolean),
  public.nn_challenge_send(text, text, date, int, text[], text[], text, text, text, text),
  public.nn_challenge_list(text)
from public, anon, authenticated;

grant execute on function
  public.nn_challenge_send(text, text, date, int, text[], text[], text, text, text, text),
  public.nn_challenge_list(text)
to anon, authenticated;
