-- ============================================================================
-- BODY — the season (Today · Season), one-time Supabase setup.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   sz_  (the season club, the same family as sz-SETUP.sql)
-- Written:  2026-10-30, wave 1 of the Body app (all-day/js/modes/season.js)
-- Needs:    sz-SETUP.sql pasted first (its tables are the season's tables).
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: every
-- statement is "create or replace" or "drop ... if exists" first, and
-- nothing here deletes a row. all-day/supabase/SETUP-SEASON.md has the steps.
--
-- sz-SETUP.sql made every table in Stephen's build notes and said that
-- goals, reviews, the city board and the wall "get their doors in later
-- phases, as more of this same file". These are those doors:
--   sz_season_get    public: the season now (live, else the next one), with
--                    its three events and how many have joined
--   sz_goal_get      your goal this season: the goal, its milestones, its
--                    goal habit, your reviews, your wall card
--   sz_goal_set      declare it, field by field, until kickoff
--   sz_milestone_hit tick a milestone (any time; it is the one thing that
--                    stays open after kickoff)
--   sz_review_set    this week's Sunday review: said, did, next
--   sz_goal_finish   you finished (after kickoff), or take it back
--   sz_board         the city board: every member's first name, goal-habit
--                    taps and show-up counts, nothing else; your pod
--   sz_wall_list     public: the finisher cards that were published
--   sz_wall_card_set your card: three lines, published or not
-- The email tap and photos on cards wait for keys only Stephen can add.
--
-- Locking at kickoff (the build notes' rule): from kickoff_at on, a goal's
-- words, finish line, proof and category, and its goal habit's words and
-- frequency, refuse every change made through the app, at the table, not
-- only in the functions. Stephen's own dashboard edits are not blocked
-- (they carry no signed-in reader).
--
-- Same security model as sz-SETUP.sql: the tables are closed, and the
-- public key reaches them only through these security-definer functions.
-- ============================================================================

-- ------------------------------------------------------------- the lock

-- The season a goal belongs to has kicked off.
create or replace function public.sz_goal_locked(p_goal uuid) returns boolean
language sql stable as $$
  select coalesce((select s.kickoff_at <= now() from public.sz_goals g join public.sz_seasons s on s.id = g.season_id where g.id = p_goal), false)
$$;

create or replace function public.sz_goals_lock() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;   -- Stephen, in the dashboard
  if public.sz_goal_locked(old.id)
     and (new.text, new.finish_line, new.proof, new.category) is distinct from (old.text, old.finish_line, old.proof, old.category) then
    raise exception 'locked';
  end if;
  return new;
end $$;
drop trigger if exists sz_goals_lock on public.sz_goals;
create trigger sz_goals_lock before update on public.sz_goals
  for each row execute function public.sz_goals_lock();

create or replace function public.sz_goal_habit_lock() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or not old.is_goal or old.goal_id is null then return new; end if;
  if public.sz_goal_locked(old.goal_id)
     and (new.text, new.frequency, new.n, new.is_goal, new.goal_id, new.archived_at) is distinct from (old.text, old.frequency, old.n, old.is_goal, old.goal_id, old.archived_at) then
    raise exception 'locked';
  end if;
  return new;
end $$;
drop trigger if exists sz_goal_habit_lock on public.sz_habits;
create trigger sz_goal_habit_lock before update on public.sz_habits
  for each row execute function public.sz_goal_habit_lock();

-- --------------------------------------------------------------- helpers

-- The season the app is about in a city: the live one, else the next one
-- that has not kicked off, else the one that ended last.
create or replace function public.sz_season_now(p_city text default 'burlington') returns public.sz_seasons
language sql stable as $$
  select s.* from public.sz_seasons s
   where s.city = coalesce(p_city, 'burlington')
   order by (s.status = 'live') desc,
            (s.status in ('upcoming', 'open') and s.kickoff_at > now()) desc,
            case when s.kickoff_at > now() then s.kickoff_at end asc nulls last,
            s.kickoff_at desc, s.id
   limit 1
$$;

-- The week of the season, 1 to 8, from kickoff; 0 before it, 9 after.
create or replace function public.sz_week(p_kickoff timestamptz) returns int
language sql stable as $$
  select case when now() < p_kickoff then 0 else least(9, floor(extract(epoch from now() - p_kickoff) / 604800)::int + 1) end
$$;

create or replace function public.sz_season_json(s public.sz_seasons) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'status', s.status, 'signup_opens', s.signup_opens,
    'kickoff_at', s.kickoff_at, 'midway_at', s.midway_at, 'party_at', s.party_at, 'stripe_link', s.stripe_link,
    'week', public.sz_week(s.kickoff_at),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'starts_at', e.starts_at, 'venue', e.venue, 'luma_url', e.luma_url)
                          order by e.starts_at) from public.sz_events e where e.season_id = s.id), '[]'::jsonb),
    'joined', (select count(*) from public.sz_goals g where g.season_id = s.id))
$$;

-- Your goal in a season, all of it, or null.
create or replace function public.sz_goal_json(p_user uuid, p_season uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', g.id, 'text', g.text, 'finish_line', g.finish_line, 'proof', g.proof, 'category', g.category,
    'paid', g.paid, 'locked', public.sz_goal_locked(g.id), 'finished_at', g.finished_at,
    'habit', (select public.sz_habit_json(h) from public.sz_habits h where h.goal_id = g.id and h.is_goal and h.archived_at is null limit 1),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('position', m.position, 'text', m.text, 'hit_at', m.hit_at) order by m.position)
                              from public.sz_milestones m where m.goal_id = g.id), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('week', r.week, 'said', r.said, 'did', r.did, 'next', r.next, 'submitted_at', r.submitted_at) order by r.week)
                           from public.sz_reviews r where r.goal_id = g.id), '[]'::jsonb),
    'card', (select jsonb_build_object('id', c.id, 'line1', c.line1, 'line2', c.line2, 'line3', c.line3, 'published_at', c.published_at)
               from public.sz_wall_cards c where c.goal_id = g.id order by c.created_at limit 1))
    from public.sz_goals g where g.user_id = p_user and g.season_id = p_season
$$;

-- ----------------------------------------------------------------- doors

create or replace function public.sz_season_get(p_city text default 'burlington') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.sz_seasons;
begin
  s := public.sz_season_now(p_city);
  if s.id is null then return null; end if;
  return public.sz_season_json(s);
end $$;

create or replace function public.sz_goal_get(p_city text default 'burlington') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.sz_seasons;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := public.sz_season_now(p_city);
  if s.id is null then return null; end if;
  return public.sz_goal_json(u, s.id);
end $$;

-- Declare (or keep declaring) your goal for the season now, before it
-- kicks off. Every field is optional while you write; the goal habit is
-- made once it has words. p_milestones: up to three strings, in order.
create or replace function public.sz_goal_set(
  p_text text, p_finish_line text, p_proof text, p_category text,
  p_habit_text text, p_habit_frequency text, p_habit_n int, p_milestones jsonb,
  p_city text default 'burlington'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.sz_seasons; v_goal uuid; v_habit uuid; v_ht text; i int; v_m text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.sz_members where user_id = u) then raise exception 'no_member'; end if;
  s := public.sz_season_now(p_city);
  if s.id is null or s.status = 'done' then raise exception 'no_season'; end if;
  if s.kickoff_at <= now() and not exists (select 1 from public.sz_goals where user_id = u and season_id = s.id) then raise exception 'locked'; end if;
  if p_category is not null and p_category not in ('fitness', 'creative', 'business', 'life_admin', 'learn') then raise exception 'bad_category'; end if;
  insert into public.sz_goals (user_id, season_id) values (u, s.id) on conflict (user_id, season_id) do nothing;
  select id into v_goal from public.sz_goals where user_id = u and season_id = s.id;
  update public.sz_goals set text = left(public.sz_clean(p_text), 120), finish_line = left(public.sz_clean(p_finish_line), 160),
         proof = left(public.sz_clean(p_proof), 160), category = p_category
   where id = v_goal;
  -- the goal habit: one, made when it has words
  v_ht := left(public.sz_clean(p_habit_text), 60);
  select id into v_habit from public.sz_habits where goal_id = v_goal and is_goal;
  if v_ht <> '' then
    if p_habit_frequency not in ('daily', 'weekdays', 'n_per_week') then raise exception 'bad_frequency'; end if;
    if v_habit is null then
      insert into public.sz_habits (user_id, goal_id, text, frequency, n, is_goal, position)
      values (u, v_goal, v_ht, p_habit_frequency, case when p_habit_frequency = 'n_per_week' then p_habit_n end, true, -1);
    else
      update public.sz_habits set text = v_ht, frequency = p_habit_frequency,
             n = case when p_habit_frequency = 'n_per_week' then p_habit_n end, archived_at = null
       where id = v_habit;
    end if;
  end if;
  -- milestones: three slots
  if s.kickoff_at > now() then
    for i in 1..3 loop
      v_m := left(public.sz_clean(coalesce(p_milestones ->> (i - 1), '')), 80);
      insert into public.sz_milestones (goal_id, text, position) values (v_goal, v_m, i)
      on conflict (goal_id, position) do update set text = excluded.text;
    end loop;
  end if;
  return public.sz_goal_json(u, s.id);
end $$;

create or replace function public.sz_milestone_hit(p_position int, p_hit boolean, p_city text default 'burlington') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.sz_seasons; v_goal uuid;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := public.sz_season_now(p_city);
  select id into v_goal from public.sz_goals where user_id = u and season_id = s.id;
  if v_goal is null then raise exception 'not_found'; end if;
  update public.sz_milestones set hit_at = case when p_hit then coalesce(hit_at, now()) end
   where goal_id = v_goal and position = p_position and text <> '';
  if not found then raise exception 'not_found'; end if;
  return public.sz_goal_json(u, s.id);
end $$;

-- This week's review, weeks 1 to 8 from kickoff. Saving again changes it;
-- a week gone by stays as it was.
create or replace function public.sz_review_set(p_said text, p_did text, p_next text, p_city text default 'burlington') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.sz_seasons; v_goal uuid; v_week int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := public.sz_season_now(p_city);
  select id into v_goal from public.sz_goals where user_id = u and season_id = s.id;
  if v_goal is null then raise exception 'not_found'; end if;
  v_week := public.sz_week(s.kickoff_at);
  if v_week < 1 or v_week > 8 then raise exception 'no_review_week'; end if;
  insert into public.sz_reviews (goal_id, week, said, did, next)
  values (v_goal, v_week, left(public.sz_clean(p_said), 280), left(public.sz_clean(p_did), 280), left(public.sz_clean(p_next), 280))
  on conflict (goal_id, week) do update set said = excluded.said, did = excluded.did, next = excluded.next, submitted_at = now();
  return public.sz_goal_json(u, s.id);
end $$;

create or replace function public.sz_goal_finish(p_done boolean, p_city text default 'burlington') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.sz_seasons;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := public.sz_season_now(p_city);
  if s.kickoff_at > now() then raise exception 'not_started'; end if;
  update public.sz_goals set finished_at = case when p_done then coalesce(finished_at, now()) end
   where user_id = u and season_id = s.id;
  if not found then raise exception 'not_found'; end if;
  return public.sz_goal_json(u, s.id);
end $$;

-- The city board for the season now: for every member with a goal, a first
-- name, their goal habit's frequency and its taps since kickoff, how many
-- reviews they sent and events they came to. Streaks and the show-up rate
-- are worked out from these in the app, never stored. Your row says so,
-- and so do your podmates'. Signed-in only. No goal words, no milestones,
-- no personal habits, no phone, ever.
create or replace function public.sz_board(p_city text default 'burlington') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.sz_seasons; v_pod uuid;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := public.sz_season_now(p_city);
  if s.id is null then return null; end if;
  select pod_id into v_pod from public.sz_members where user_id = u;
  return jsonb_build_object(
    'season', s.id,
    'week', public.sz_week(s.kickoff_at),
    'events_held', (select count(*) from public.sz_events e where e.season_id = s.id and e.starts_at <= now()),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', m.name, 'me', g.user_id = u, 'pod', v_pod is not null and m.pod_id = v_pod,
               'frequency', h.frequency, 'n', h.n,
               'taps', coalesce((select jsonb_agg(t.date order by t.date) from public.sz_taps t
                                  where t.habit_id = h.id and t.date >= (s.kickoff_at at time zone 'America/New_York')::date), '[]'::jsonb),
               'reviews', (select count(*) from public.sz_reviews r where r.goal_id = g.id),
               'attended', (select count(*) from public.sz_attendance a join public.sz_events e on e.id = a.event_id
                             where a.user_id = g.user_id and e.season_id = s.id and e.starts_at <= now()))
             order by m.name, g.user_id)
        from public.sz_goals g
        join public.sz_members m on m.user_id = g.user_id
        left join public.sz_habits h on h.goal_id = g.id and h.is_goal and h.archived_at is null
       where g.season_id = s.id), '[]'::jsonb),
    'pod', (select jsonb_build_object('category', p.category, 'meets_on', p.meets_on, 'chat_url', p.chat_url,
                     'names', coalesce((select jsonb_agg(m2.name order by m2.name) from public.sz_members m2 where m2.pod_id = p.id and m2.user_id <> u), '[]'::jsonb))
              from public.sz_pods p where p.id = v_pod and p.season_id = s.id));
end $$;

-- Public: the published finisher cards, newest first. A first name, the
-- goal in one line, three short lines, the season.
create or replace function public.sz_wall_list(p_limit int default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'name', m.name, 'goal', g.text, 'line1', c.line1, 'line2', c.line2, 'line3', c.line3,
             'season', s.name, 'published_at', c.published_at) j, c.published_at at
      from public.sz_wall_cards c
      join public.sz_goals g on g.id = c.goal_id
      join public.sz_seasons s on s.id = g.season_id
      join public.sz_members m on m.user_id = g.user_id
     where c.published_at is not null
     order by c.published_at desc
     limit least(greatest(coalesce(p_limit, 60), 1), 200)) x
$$;

-- Your card, from a finished goal: three lines, and whether it is on the
-- Wall. Publishing again keeps the first date.
create or replace function public.sz_wall_card_set(p_line1 text, p_line2 text, p_line3 text, p_publish boolean, p_city text default 'burlington') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s public.sz_seasons; v_goal uuid; v_card uuid;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := public.sz_season_now(p_city);
  select id into v_goal from public.sz_goals where user_id = u and season_id = s.id and finished_at is not null;
  if v_goal is null then raise exception 'not_finished'; end if;
  select id into v_card from public.sz_wall_cards where goal_id = v_goal order by created_at limit 1;
  if v_card is null then
    insert into public.sz_wall_cards (goal_id) values (v_goal) returning id into v_card;
  end if;
  update public.sz_wall_cards set line1 = left(public.sz_clean(p_line1), 80), line2 = left(public.sz_clean(p_line2), 80),
         line3 = left(public.sz_clean(p_line3), 80),
         published_at = case when p_publish then coalesce(published_at, now()) end
   where id = v_card;
  return public.sz_goal_json(u, s.id);
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function
  public.sz_goal_locked(uuid), public.sz_goals_lock(), public.sz_goal_habit_lock(), public.sz_season_now(text), public.sz_week(timestamptz),
  public.sz_season_json(public.sz_seasons), public.sz_goal_json(uuid, uuid),
  public.sz_season_get(text), public.sz_goal_get(text), public.sz_goal_set(text, text, text, text, text, text, int, jsonb, text),
  public.sz_milestone_hit(int, boolean, text), public.sz_review_set(text, text, text, text), public.sz_goal_finish(boolean, text),
  public.sz_board(text), public.sz_wall_list(int), public.sz_wall_card_set(text, text, text, boolean, text)
from public, anon, authenticated;

grant execute on function
  public.sz_season_get(text), public.sz_goal_get(text), public.sz_goal_set(text, text, text, text, text, text, int, jsonb, text),
  public.sz_milestone_hit(int, boolean, text), public.sz_review_set(text, text, text, text), public.sz_goal_finish(boolean, text),
  public.sz_board(text), public.sz_wall_list(int), public.sz_wall_card_set(text, text, text, boolean, text)
to anon, authenticated;
