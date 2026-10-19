-- ============================================================================
-- ALL DAY — the Habits tab, part D: share your forest.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Needs:    sz-SETUP.sql (part A) already pasted. Parts B and C are not
--           needed for this one, but a live project has them anyway.
-- Written:  2026-10-19 (Stephen: "I want them to be able to share the Forest
--           to the public ... attach their real names to their Forest or a
--           fake name ... let others see the habit name specifically or just
--           the Forest growth").
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: tables are
-- "if not exists", functions "create or replace", and nothing here deletes
-- a row you made. all-day/supabase/SETUP-HABITS.md, Part D, has the steps.
--
-- Every habit on the tab is a tree: a leaf for each day it was done in the
-- last 370, a flower for each streak milestone (all-day/js/forest.js draws
-- it). Sharing adds two tables:
--   sz_forests        one row per member who has opened the share sheet: the
--                     name they chose (any name, real or not; never an
--                     email), whether the forest is public, whether habit
--                     names show or only the trees, and a cohort field kept
--                     for the accountability cohorts to come. Its own id is
--                     the public handle, so an account id never leaves the
--                     server. hidden_at is Stephen's: set it in the Table
--                     Editor and that forest leaves the gallery.
--   sz_forest_habits  which of a member's habits are in their shared forest.
--
-- Security, as in sz-SETUP.sql: RLS on with no policies, the tables revoked
-- from anon and authenticated, and every read and write through the
-- security-definer functions below. The owner alone writes their forest.
-- Anyone, signed in or not, can read a PUBLIC forest, and only this of it:
-- the chosen name, the cohort, and for each shared habit that is not
-- archived its tree's seed, how often it is meant to happen, its leaves,
-- its streak and its best streak, plus its name only when the owner chose
-- to show names. Never a tap date, an account id, a habit id or an email.
-- ============================================================================

-- ------------------------------------------------------------------ tables

create table if not exists public.sz_forests (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  id         uuid not null unique default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 32 and position('@' in name) = 0),
  public     boolean not null default false,
  show_names boolean not null default false,
  cohort     text check (cohort is null or char_length(cohort) between 1 and 32),
  hidden_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sz_forests_public_idx on public.sz_forests (updated_at desc) where public and hidden_at is null;

create table if not exists public.sz_forest_habits (
  habit_id uuid primary key references public.sz_habits(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade
);
create index if not exists sz_forest_habits_user_idx on public.sz_forest_habits (user_id);

alter table public.sz_forests       enable row level security;
alter table public.sz_forest_habits enable row level security;
revoke all on table public.sz_forests, public.sz_forest_habits from anon, authenticated;

-- A shared habit always belongs to its owner's forest.
create or replace function public.sz_forest_habits_owner() returns trigger
language plpgsql as $$
begin
  new.user_id := (select user_id from public.sz_habits where id = new.habit_id);
  return new;
end $$;
drop trigger if exists sz_forest_habits_owner on public.sz_forest_habits;
create trigger sz_forest_habits_owner before insert or update on public.sz_forest_habits
  for each row execute function public.sz_forest_habits_owner();

-- ----------------------------------------------------------------- the tree

-- A tree's shape comes from this number: FNV-1a over the habit id as text,
-- the same sum as seedOf() in all-day/js/forest.js.
create or replace function public.sz_forest_seed(p_id uuid) returns bigint
language plpgsql immutable as $$
declare h bigint := 2166136261; s text := p_id::text; i int;
begin
  for i in 1 .. length(s) loop
    h := ((h # ascii(substr(s, i, 1))) * 16777619) % 4294967296;
  end loop;
  return h;
end $$;

-- One habit's numbers, worked out from its taps in the 370 days that end on
-- p_today, by the rules in all-day/js/habits-core.js (streak, bestStreak):
--   leaves  days done in the window
--   streak  the streak running now
--   best    the longest streak the window holds, never less than streak
-- daily: consecutive days, from today if done today, else from yesterday.
-- weekdays: the same, but Saturday and Sunday never break it (a weekend tap
-- still counts). n_per_week: weeks with at least n taps; this week never
-- breaks the run while it can still reach n, and adds one once it does.
create or replace function public.sz_forest_tree(p_habit uuid, p_today date) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  h public.sz_habits;
  v_from date := p_today - 369;
  v_first date;
  v_leaves int;
  v_streak int := 0;
  v_best int := 0;
  v_n int;
  v_w0 date := date_trunc('week', p_today::timestamp)::date;
  v_now int;
  v_left int;
  v_past int;
begin
  select * into h from public.sz_habits where id = p_habit;
  if not found then return null; end if;
  select count(*), min(date) into v_leaves, v_first from public.sz_taps
   where habit_id = p_habit and date between v_from and p_today;
  if v_leaves = 0 then
    return jsonb_build_object('leaves', 0, 'streak', 0, 'best', 0);
  end if;

  if h.frequency = 'n_per_week' then
    v_n := greatest(1, least(7, coalesce(h.n, 1)));
    -- every week from the first tap's to this one, with its taps; a past week
    -- short of n ends a run, this week never does
    with weeks as (
      select g.w::date as w, (select count(*) from public.sz_taps t where t.habit_id = p_habit
                                and t.date between greatest(v_from, g.w::date) and least(p_today, g.w::date + 6))::int as c
        from generate_series(date_trunc('week', v_first::timestamp), v_w0::timestamp, interval '7 days') as g(w)
    ), runs as (
      select count(*) filter (where c >= v_n) as hits
        from (select w, c, sum(case when c < v_n and w <> v_w0 then 1 else 0 end) over (order by w) as grp from weeks) x
       group by grp
    )
    select (select c from weeks where w = v_w0),
           (select count(*) from weeks where w < v_w0
              and w > coalesce((select max(w) from weeks where w < v_w0 and c < v_n), '-infinity'::date))::int,
           (select coalesce(max(hits), 0) from runs)::int
      into v_now, v_past, v_best;
    v_left := (7 - extract(isodow from p_today)::int)
              + case when exists (select 1 from public.sz_taps where habit_id = p_habit and date = p_today) then 0 else 1 end;
    if not (v_now < v_n and v_now + v_left < v_n) then
      v_streak := (case when v_now >= v_n then 1 else 0 end) + v_past;
    end if;
  else
    -- every day from the first tap to today: done, or a day that breaks a
    -- run (any untapped day for a daily habit, an untapped weekday for weekdays)
    with days as (
      select g.d::date as d, t.date is not null as done,
             (t.date is null and (h.frequency = 'daily' or extract(isodow from g.d) < 6)) as breaks
        from generate_series(v_first::timestamp, p_today::timestamp, interval '1 day') as g(d)
        left join public.sz_taps t on t.habit_id = p_habit and t.date = g.d::date
    ), a as (
      select case when exists (select 1 from days where d = p_today and done) then p_today else p_today - 1 end as anchor
    ), b as (
      select max(d) as brk from days, a where d <= a.anchor and breaks
    ), runs as (
      select count(*) filter (where done) as hits
        from (select d, done, sum(case when breaks then 1 else 0 end) over (order by d) as grp from days) x
       group by grp
    )
    select (select count(*) from days, a, b where done and d <= a.anchor and d > coalesce(b.brk, v_first - 1))::int,
           (select coalesce(max(hits), 0) from runs)::int
      into v_streak, v_best;
  end if;
  return jsonb_build_object('leaves', v_leaves, 'streak', v_streak, 'best', greatest(v_best, v_streak));
end $$;

-- A public forest as anyone may see it (the header says exactly what): its
-- first 24 trees, in the owner's order, so one gallery page stays quick.
create or replace function public.sz_forest_json(f public.sz_forests) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', f.id, 'name', f.name, 'cohort', f.cohort, 'show_names', f.show_names,
    'trees', coalesce((
      select jsonb_agg(jsonb_build_object('seed', public.sz_forest_seed(h.id), 'name', case when f.show_names then h.text end,
               'frequency', h.frequency, 'n', h.n) || public.sz_forest_tree(h.id, public.sz_today())
             order by h.is_goal desc, h.position, h.created_at, h.id)
        from (select h.* from public.sz_forest_habits fh join public.sz_habits h on h.id = fh.habit_id
               where fh.user_id = f.user_id and h.user_id = f.user_id and h.archived_at is null
               order by h.is_goal desc, h.position, h.created_at, h.id
               limit 24) h), '[]'::jsonb))
$$;

-- -------------------------------------------------------------- the owner

-- Your forest's settings and which of your habits are in it, or null before
-- you first save one. Signed-in only.
create or replace function public.sz_forest_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return (select jsonb_build_object('id', f.id, 'name', f.name, 'public', f.public, 'show_names', f.show_names, 'cohort', f.cohort,
                   'habits', coalesce((select jsonb_agg(fh.habit_id order by fh.habit_id) from public.sz_forest_habits fh
                                        join public.sz_habits h on h.id = fh.habit_id
                                       where fh.user_id = u and h.archived_at is null), '[]'::jsonb))
            from public.sz_forests f where f.user_id = u);
end $$;

-- Save your forest: the name on it (any name you like, up to 32, no @, so
-- never an email), public or not, habit names shown or only the trees,
-- which of your habits are in it (null keeps the ones already in), and a
-- cohort (kept for later; empty is none). Checks in forest.js
-- checkForest()'s order. Change any of it, or stop sharing, any time.
create or replace function public.sz_forest_set(
  p_name text, p_public boolean, p_show_names boolean, p_habits uuid[] default null, p_cohort text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  v_name text := public.sz_clean(p_name);
  v_cohort text := nullif(public.sz_clean(p_cohort), '');
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if v_name = '' or char_length(v_name) > 32 or position('@' in v_name) > 0 then raise exception 'bad_forest_name'; end if;
  if v_cohort is not null and char_length(v_cohort) > 32 then raise exception 'bad_cohort'; end if;
  if p_habits is not null then
    if cardinality(p_habits) > 100 then raise exception 'bad_forest'; end if;
    if exists (select 1 from unnest(p_habits) as x(id)
                where not exists (select 1 from public.sz_habits h where h.id = x.id and h.user_id = u and h.archived_at is null)) then
      raise exception 'not_found';
    end if;
  end if;
  insert into public.sz_forests (user_id, name, public, show_names, cohort)
  values (u, v_name, coalesce(p_public, false), coalesce(p_show_names, false), v_cohort)
  on conflict (user_id) do update set name = excluded.name, public = excluded.public, show_names = excluded.show_names,
    cohort = excluded.cohort, updated_at = now();
  if p_habits is not null then
    delete from public.sz_forest_habits where user_id = u and habit_id <> all(p_habits);
    insert into public.sz_forest_habits (habit_id, user_id)
    select distinct x.id, u from unnest(p_habits) as x(id)
    on conflict (habit_id) do nothing;
  end if;
  return public.sz_forest_get();
end $$;

-- ----------------------------------------------------------- the gallery

-- Public forests with at least one tree, most recently tended first (the
-- newest tap on a shared habit), then by name. At most 40. Anyone may ask.
create or replace function public.sz_forests_public(p_limit int default 40) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.sz_forest_json(f) order by x.last desc nulls last, f.name, f.id), '[]'::jsonb)
    from (
      select f.user_id,
             (select max(t.date) from public.sz_forest_habits fh join public.sz_habits h on h.id = fh.habit_id
                join public.sz_taps t on t.habit_id = h.id
               where fh.user_id = f.user_id and h.user_id = f.user_id and h.archived_at is null) as last
        from public.sz_forests f
       where f.public and f.hidden_at is null
         and exists (select 1 from public.sz_forest_habits fh join public.sz_habits h on h.id = fh.habit_id
                      where fh.user_id = f.user_id and h.user_id = f.user_id and h.archived_at is null)
       order by 2 desc nulls last, f.name, f.id
       limit greatest(1, least(coalesce(p_limit, 40), 40))
    ) x join public.sz_forests f on f.user_id = x.user_id
$$;

-- One public forest, by its public id (a shared link). Null when it is not
-- public, hidden, gone, or has no tree to show (the same rule as the gallery).
create or replace function public.sz_forest_public(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.sz_forest_json(f) from public.sz_forests f
   where f.id = p_id and f.public and f.hidden_at is null
     and exists (select 1 from public.sz_forest_habits fh join public.sz_habits h on h.id = fh.habit_id
                  where fh.user_id = f.user_id and h.user_id = f.user_id and h.archived_at is null)
$$;

-- ------------------------------------------------- deleting your account
-- "Delete my account and posts" takes your forest too. The same function as
-- in sz-SETUP.sql, word for word, with the forest lines; sz-SETUP.sql's copy
-- checks the forest tables exist first, so pasting it again never undoes this.
create or replace function public.sz_delete_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if to_regclass('public.sz_forests') is not null then
    execute 'delete from public.sz_forest_habits where user_id = $1' using u;
    execute 'delete from public.sz_forests where user_id = $1' using u;
  end if;
  delete from public.sz_taps where user_id = u;
  delete from public.sz_habits where user_id = u;
  delete from public.sz_attendance where user_id = u;
  delete from public.sz_goals where user_id = u;
  update public.sz_pods set captain_user_id = null where captain_user_id = u;
  delete from public.sz_members where user_id = u;
  return jsonb_build_object('deleted', true);
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function
  public.sz_forest_habits_owner(), public.sz_forest_seed(uuid), public.sz_forest_tree(uuid, date),
  public.sz_forest_json(public.sz_forests), public.sz_forest_get(),
  public.sz_forest_set(text, boolean, boolean, uuid[], text),
  public.sz_forests_public(int), public.sz_forest_public(uuid), public.sz_delete_me()
from public, anon, authenticated;

grant execute on function
  public.sz_forest_get(), public.sz_forest_set(text, boolean, boolean, uuid[], text),
  public.sz_forests_public(int), public.sz_forest_public(uuid), public.sz_delete_me()
to anon, authenticated;
