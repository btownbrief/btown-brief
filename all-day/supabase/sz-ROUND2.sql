-- ============================================================================
-- ALL DAY — the Habits tab, round two: no habit limit. One paste.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   sz_
-- Written:  2026-10-17
-- Needs:    all-day/supabase/sz-SETUP.sql pasted first.
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: it replaces
-- one function and changes nothing else. It deletes no row and no table.
-- SETUP-HABITS.md part B has the steps.
--
-- If sz-SETUP.sql is ever pasted again, nothing is lost: it now carries the
-- same rules as this file.
--
-- What it changes, in plain words:
--   The rules (sz_rules) stop limiting how many habits of their own a
--   member keeps. The only ceiling left is 100, which no one keeping habits
--   by hand comes near; it is there so a script cannot make habits by the
--   million. The app never mentions it. Someone who did reach it would read "That's a
--   lot of habits. Archive a few first." Every other rule is unchanged.
--
-- The guard that counts habits (sz_habits_cap in sz-SETUP.sql) reads its
-- number from these rules, so it moves to 100 the moment this runs.
-- ============================================================================

-- ---------------------------------------------------------------- the rules
-- The same JSON as HABIT_RULES in all-day/js/habits-core.js; this copy
-- replaces the one sz-SETUP.sql installed. scripts/test-habits-core.mjs
-- fails when the two differ.
create or replace function public.sz_rules() returns jsonb
language sql immutable as $rules$ select $json${"version":1,"tz":"America/New_York","frequencies":["daily","weekdays","n_per_week"],"categories":["fitness","creative","business","life_admin","learn"],"seasonStatuses":["upcoming","open","live","done"],"limits":{"habitsMax":100,"habitTextMax":60,"nameMax":32,"phoneMin":7,"phoneMax":20,"nMin":1,"nMax":6,"tapsRangeMaxDays":370}}$json$::jsonb $rules$;

-- ------------------------------------------------------------------ grants
-- Exactly as sz-SETUP.sql gives them: take back the default, then let
-- every reader, signed in or not, read the rules.
revoke all on function public.sz_rules() from public, anon, authenticated;
grant execute on function public.sz_rules() to anon, authenticated;
