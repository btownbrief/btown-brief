-- ============================================================================
-- ALL DAY — the People tab's own pieces, one-time Supabase setup.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   nn_people_  (inside the New Nine's nn_ prefix)
-- Written:  2026-10-16
-- Needs:    all-day/supabase/nn-SETUP.sql pasted first (nn_profiles, nn_posts,
--           nn_bans, nn_mod_ok, nn_listable).
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: every
-- statement is "if not exists" or "create or replace", and nothing here
-- deletes a row you made. It only ADDS to nn-SETUP.sql; it changes none of
-- that file's tables, functions or rules.
--
-- What it holds, in plain words:
--   nn_people_dir    the readers who chose to be in the People directory,
--                    and what they said they are into (from a fixed list:
--                    running, games, live music...). Their first name,
--                    neighborhood and archetype are read from nn_profiles,
--                    so they change in one place. Leaving the directory,
--                    deleting the profile or "Delete my account" removes
--                    the row.
--   nn_people_plans  two things a People plan can say that the people
--                    board's fields (nn_rules: when, arch, spots) don't
--                    have yet: a rough age band for the group, and "I'm
--                    down to put this on Meetup". One row per plan, gone
--                    with the plan.
--
-- Security model, the fleet's and nn-SETUP.sql's: RLS on with NO policies,
-- the tables revoked from anon and authenticated, and every door a
-- security-definer function below. The directory never hands back an email
-- or an account id, and only readers who are in it themselves can read it;
-- anyone can read how many are in it.
-- ============================================================================

-- ---------------------------------------------------------------- the rules
-- The same JSON as PEOPLE_RULES in all-day/js/modes/people.js; the test
-- matrix (all-day/tests/allday.spec.mjs) fails when the two differ.
create or replace function public.nn_people_rules() returns jsonb
language sql immutable as $rules$ select $json${"version":1,"interests":["sports","running","outdoors","games","music","dance","books","making","languages","food"],"interestsMax":8,"ages":["twenties","thirties","forties","fifties","any"]}$json$::jsonb $rules$;

-- ------------------------------------------------------------------ tables

create table if not exists public.nn_people_dir (
  user_id    uuid primary key references public.nn_profiles(user_id) on delete cascade,
  interests  text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nn_people_dir_updated_idx on public.nn_people_dir (updated_at desc);

create table if not exists public.nn_people_plans (
  post_id    uuid primary key references public.nn_posts(id) on delete cascade,
  meetup     boolean not null default false,
  ages       text,
  created_at timestamptz not null default now()
);
create index if not exists nn_people_plans_meetup_idx on public.nn_people_plans (created_at desc) where meetup;

alter table public.nn_people_dir   enable row level security;
alter table public.nn_people_plans enable row level security;
revoke all on table public.nn_people_dir, public.nn_people_plans from anon, authenticated;

-- ---------------------------------------------------------------- directory

-- Join or leave the directory, signed in, with a first name. p_interests is
-- what you're into, from the list in nn_people_rules() (at most 8, each
-- once); joining again replaces it. Leaving deletes your row, and anyone
-- may leave, a banned reader included; a banned reader may not join.
create or replace function public.nn_people_optin(p_on boolean, p_interests text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  rules jsonb := public.nn_people_rules();
  v_out text[] := '{}';
  t text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not coalesce(p_on, false) then
    delete from public.nn_people_dir where user_id = u;
    return jsonb_build_object('on', false, 'interests', '[]'::jsonb);
  end if;
  if exists (select 1 from public.nn_bans where user_id = u) then raise exception 'banned'; end if;
  if not exists (select 1 from public.nn_profiles where user_id = u) then raise exception 'no_name'; end if;
  foreach t in array coalesce(p_interests, '{}') loop
    if t is null or not ((rules -> 'interests') ? t) then raise exception 'bad_interest'; end if;
    if not (t = any (v_out)) then v_out := v_out || t; end if;
  end loop;
  if coalesce(array_length(v_out, 1), 0) > (rules ->> 'interestsMax')::int then raise exception 'bad_interest'; end if;
  insert into public.nn_people_dir (user_id, interests) values (u, v_out)
  on conflict (user_id) do update set interests = excluded.interests, updated_at = now();
  return jsonb_build_object('on', true, 'interests', to_jsonb(v_out));
end $$;

-- The directory. Everyone gets the count of readers in it; a signed-in
-- reader who is in it (and not banned) also gets the people: first name,
-- neighborhood, archetype, interests, and `me` on their own row. Never an
-- email, never an account id. Banned readers drop out of it and can no
-- longer read it. Newest updates first, 200 at most.
create or replace function public.nn_people_directory() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  v_me boolean := u is not null and exists (select 1 from public.nn_people_dir where user_id = u)
                  and not exists (select 1 from public.nn_bans where user_id = u);
begin
  return jsonb_build_object(
    'count', (select count(*) from public.nn_people_dir d join public.nn_profiles pr on pr.user_id = d.user_id
               where not exists (select 1 from public.nn_bans b where b.user_id = d.user_id)),
    'me', v_me,
    'people', case when not v_me then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('name', x.display_name, 'neighborhood', x.neighborhood, 'archetype', x.archetype,
               'interests', to_jsonb(x.interests), 'me', x.user_id = u) order by x.updated_at desc)
        from (select pr.display_name, pr.neighborhood, pr.archetype, d.interests, d.user_id, d.updated_at
                from public.nn_people_dir d join public.nn_profiles pr on pr.user_id = d.user_id
               where not exists (select 1 from public.nn_bans b where b.user_id = d.user_id)
               order by d.updated_at desc limit 200) x), '[]'::jsonb) end);
end $$;

-- -------------------------------------------------------------------- plans

-- Your own People plan's age band and Meetup box. Only the plan's author,
-- signed in and not banned, on a plan that is still theirs. An empty age band is none;
-- no band and no box removes the row.
create or replace function public.nn_people_plan_set(p_post uuid, p_meetup boolean default false, p_ages text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  v_ages text := nullif(p_ages, '');
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.nn_bans where user_id = u) then raise exception 'banned'; end if;
  if not exists (select 1 from public.nn_posts where id = p_post and user_id = u and board = 'people' and status <> 'deleted') then
    raise exception 'not_found';
  end if;
  if v_ages is not null and not ((public.nn_people_rules() -> 'ages') ? v_ages) then raise exception 'bad_ages'; end if;
  if not coalesce(p_meetup, false) and v_ages is null then
    delete from public.nn_people_plans where post_id = p_post;
  else
    insert into public.nn_people_plans (post_id, meetup, ages) values (p_post, coalesce(p_meetup, false), v_ages)
    on conflict (post_id) do update set meetup = excluded.meetup, ages = excluded.ages;
  end if;
  return jsonb_build_object('meetup', coalesce(p_meetup, false), 'ages', v_ages);
end $$;

-- The extras of the plans the tab is drawing: {"<post id>": {"meetup": true,
-- "ages": "thirties"}}, only for plans everyone can see right now (the
-- foundation's nn_listable). Anyone may ask.
create or replace function public.nn_people_plan_extras(p_posts uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(x.post_id::text, jsonb_build_object('meetup', x.meetup, 'ages', x.ages)), '{}'::jsonb)
    from public.nn_people_plans x join public.nn_posts p on p.id = x.post_id
   where x.post_id = any (coalesce(p_posts, '{}'::uuid[])) and p.board = 'people' and public.nn_listable(p)
$$;

-- Stephen's list: live plans whose host ticked "put this on Meetup", soonest
-- posted first, behind the boards desk passphrase (nn_mod_ok, the same gate
-- and the same wrong-guess counter as the desk). Authors by first name only.
create or replace function public.nn_people_meetup_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.nn_mod_ok(p_secret) then return jsonb_build_object('error', 'bad_secret'); end if;
  return jsonb_build_object('plans', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'when', p.meta ->> 'when', 'place', p.place,
             'spots', p.meta -> 'spots', 'ages', x.ages, 'author', coalesce(pr.display_name, 'A neighbor'),
             'going', (select count(*) from public.nn_votes v where v.post_id = p.id),
             'created_at', p.created_at, 'expires_at', p.expires_at) order by p.created_at desc)
      from public.nn_people_plans x join public.nn_posts p on p.id = x.post_id
      left join public.nn_profiles pr on pr.user_id = p.user_id
     where x.meetup and p.board = 'people' and public.nn_listable(p)), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ grants
-- Take back the default grants, then hand out exactly the doors the app
-- uses. The signed-in-only ones refuse with not_signed_in themselves.
revoke all on function
  public.nn_people_rules(), public.nn_people_optin(boolean, text[]), public.nn_people_directory(),
  public.nn_people_plan_set(uuid, boolean, text), public.nn_people_plan_extras(uuid[]), public.nn_people_meetup_list(text)
from public, anon, authenticated;

grant execute on function
  public.nn_people_rules(), public.nn_people_optin(boolean, text[]), public.nn_people_directory(),
  public.nn_people_plan_set(uuid, boolean, text), public.nn_people_plan_extras(uuid[]), public.nn_people_meetup_list(text)
to anon, authenticated;
