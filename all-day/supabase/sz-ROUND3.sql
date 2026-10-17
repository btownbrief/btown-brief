-- ============================================================================
-- ALL DAY — the Habits tab, round three: it works without signing in. One paste.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   sz_
-- Written:  2026-10-17
-- Needs:    all-day/supabase/sz-SETUP.sql pasted first (and sz-ROUND2.sql).
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: it replaces
-- one function and adds one. It deletes no row, no table and no column.
-- SETUP-HABITS.md part C has the steps.
--
-- What it changes, in plain words:
--   1. Adding a habit no longer needs a name and a phone first. A signed-in
--      reader can add habits straight away; the name and phone are asked
--      when they join a season. (sz_habit_add, the same as sz-SETUP.sql now
--      carries, so pasting that again loses nothing.)
--   2. A reader can now keep habits on their phone without signing in. When
--      they do sign in, the phone sends its habits and their taps here ONCE,
--      through sz_import_local. It only ever writes into the signed-in
--      reader's own account, and only while that account is still empty:
--      no habit, no tap, archived ones included. A second try is refused
--      ("already_synced"). Each habit is checked as sz_habit_add checks it;
--      at most 100 habits; a tap must be a real date, today or up to 400
--      days back, never a future one. The list cannot name a habit id or an
--      owner at all, so it can never touch anyone else's habits. Imported
--      taps carry the note 'imported' in sz_taps, so you can tell them apart.
-- ============================================================================

-- Add a habit of your own. Signed in is enough: no name or phone is asked
-- for the tracker (that comes when you join a season). Checks in
-- habits-core.js checkHabit()'s order, then the ceiling (sz_habits_cap).
-- Shared with your pod only when you say so. It goes to the bottom.
-- sz-ROUND3.sql carries the same function, word for word.
create or replace function public.sz_habit_add(p_text text, p_frequency text, p_n int default null, p_shared boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  L jsonb := public.sz_rules() -> 'limits';
  v_text text := public.sz_clean(p_text);
  v_n int := null;
  h public.sz_habits;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if v_text = '' or char_length(v_text) > (L ->> 'habitTextMax')::int then raise exception 'bad_text'; end if;
  if p_frequency is null or not ((public.sz_rules() -> 'frequencies') ? p_frequency) then raise exception 'bad_frequency'; end if;
  if p_frequency = 'n_per_week' then
    if p_n is null or p_n < (L ->> 'nMin')::int or p_n > (L ->> 'nMax')::int then raise exception 'bad_n'; end if;
    v_n := p_n;
  end if;
  insert into public.sz_habits (user_id, text, frequency, n, shared, position)
  values (u, v_text, p_frequency, v_n, coalesce(p_shared, false),
          coalesce((select max(position) from public.sz_habits where user_id = u and not is_goal and archived_at is null), 0) + 1)
  returning * into h;
  return public.sz_habit_json(h);
end $$;

-- The habits a reader kept on their phone before signing in, with their
-- taps, moved into their account at the first sign-in. p_habits is a list,
-- in the reader's order, of
--   { "text", "frequency", "n", "shared", "archived", "taps": ["YYYY-MM-DD", ...] }
-- and nothing else. Every check runs before the function returns, and one
-- refusal undoes the whole call, so an import lands whole or not at all.
-- Answers the reader's habits, as sz_habits_get does. habits-fake.js
-- sz_import_local() is the same function, for the demo and the tests.
create or replace function public.sz_import_local(p_habits jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  L jsonb := public.sz_rules() -> 'limits';
  v_today date := public.sz_today();
  x jsonb;
  t jsonb;
  i int := 0;
  v_text text;
  v_freq text;
  v_n int;
  v_d date;
  h public.sz_habits;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  -- one reader's writes one at a time (the same lock sz_habits_cap takes),
  -- so two phones signing in at once cannot both import
  perform pg_advisory_xact_lock(hashtext('sz_habits:' || u::text));
  if exists (select 1 from public.sz_habits where user_id = u) or exists (select 1 from public.sz_taps where user_id = u) then
    raise exception 'already_synced';
  end if;
  if p_habits is null or jsonb_typeof(p_habits) <> 'array' or jsonb_array_length(p_habits) > (L ->> 'habitsMax')::int then
    raise exception 'bad_import';
  end if;
  for x in select value from jsonb_array_elements(p_habits) loop
    if jsonb_typeof(x) <> 'object'
       or exists (select 1 from jsonb_object_keys(x) as k(k) where k.k not in ('text', 'frequency', 'n', 'shared', 'archived', 'taps')) then
      raise exception 'bad_import';
    end if;
    if jsonb_typeof(x -> 'text') is distinct from 'string' or jsonb_typeof(x -> 'frequency') is distinct from 'string' then raise exception 'bad_import'; end if;
    if coalesce(jsonb_typeof(x -> 'n'), 'null') not in ('null', 'number')
       or (jsonb_typeof(x -> 'n') = 'number' and (x ->> 'n') !~ '^[0-9]{1,9}$') then
      raise exception 'bad_import';
    end if;
    if coalesce(jsonb_typeof(x -> 'shared'), 'null') not in ('null', 'boolean')
       or coalesce(jsonb_typeof(x -> 'archived'), 'null') not in ('null', 'boolean')
       or coalesce(jsonb_typeof(x -> 'taps'), 'null') not in ('null', 'array') then
      raise exception 'bad_import';
    end if;
    v_text := public.sz_clean(x ->> 'text');
    v_freq := x ->> 'frequency';
    if v_text = '' or char_length(v_text) > (L ->> 'habitTextMax')::int then raise exception 'bad_import'; end if;
    if not ((public.sz_rules() -> 'frequencies') ? v_freq) then raise exception 'bad_import'; end if;
    v_n := null;
    if v_freq = 'n_per_week' then
      v_n := (x ->> 'n')::int;
      if v_n is null or v_n < (L ->> 'nMin')::int or v_n > (L ->> 'nMax')::int then raise exception 'bad_import'; end if;
    end if;
    if jsonb_array_length(coalesce(x -> 'taps', '[]'::jsonb)) > 401 then raise exception 'bad_import'; end if;
    i := i + 1;
    insert into public.sz_habits (user_id, text, frequency, n, shared, position, archived_at)
    values (u, v_text, v_freq, v_n, coalesce((x ->> 'shared')::boolean, false), i,
            case when coalesce((x ->> 'archived')::boolean, false) then now() end)
    returning * into h;
    for t in select value from jsonb_array_elements(coalesce(x -> 'taps', '[]'::jsonb)) loop
      if jsonb_typeof(t) <> 'string' or (t #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'bad_import'; end if;
      begin
        v_d := (t #>> '{}')::date;
      exception when others then
        raise exception 'bad_import';
      end;
      if to_char(v_d, 'YYYY-MM-DD') <> (t #>> '{}') or v_d > v_today or v_d < v_today - 400 then raise exception 'bad_import'; end if;
      insert into public.sz_taps (habit_id, user_id, date, source, note) values (h.id, u, v_d, 'app', 'imported')
      on conflict (habit_id, date) do nothing;
    end loop;
  end loop;
  return public.sz_habits_get();
end $$;

-- ------------------------------------------------------------------ grants
-- As sz-SETUP.sql gives them: take back the default, then let every reader
-- call them (both refuse not_signed_in themselves when nobody is signed in).
revoke all on function public.sz_habit_add(text, text, int, boolean), public.sz_import_local(jsonb) from public, anon, authenticated;
grant execute on function public.sz_habit_add(text, text, int, boolean), public.sz_import_local(jsonb) to anon, authenticated;
