-- The Pulse — reader reactions + anonymous return-rate pings (Supabase / Postgres)
-- ==============================================================================
-- Backs the four RPCs js/pulse.js calls (same project + anon-key pattern as the
-- games' leaderboards):
--   pulse_react(p_player, p_kind, p_url, p_title, p_source)   swipe right/left
--   pulse_popular(p_hours, p_min, p_limit)                    the POPULAR tab
--   pulse_dig_leaders(p_day)                                  nightly topic-page workflow
--   pulse_ping(p_player, p_day)                               once-a-day anonymous ping
--
-- Design notes:
--  * No accounts. Each browser mints a random player uuid in localStorage
--    ('btown-player-id'). There is nothing to steal: reactions are additive
--    counters, capped per player per day.
--  * kind = 'save'  → the reader swiped a headline into Read Later.
--    kind = 'dig'   → the reader voted for a deep-dive page on this topic.
--  * Tables are locked (RLS on, no policies). The anon key can only reach the
--    data through the SECURITY DEFINER functions below.
--  * pulse_popular requires at least p_min DISTINCT savers so one person
--    can't trend a story. The main feed is never ranked — this feeds a
--    separate tab only.
--  * Return-rate math (D1/D7) is run by hand in the SQL editor off
--    pulse_pings; nothing in the client reads it.
--
-- Safe to run more than once (idempotent). Paste into the Supabase SQL editor.

-- ------------------------------------------------------------------ tables
create table if not exists public.pulse_reactions (
  id       bigint generated always as identity primary key,
  created  timestamptz not null default now(),
  day      date        not null default (now() at time zone 'America/New_York')::date,
  player   uuid        not null,
  kind     text        not null check (kind in ('save', 'dig')),
  url      text        not null check (url like 'http%'),
  title    text        not null,
  source   text        not null default '',
  unique (player, kind, url, day)
);

create index if not exists pulse_reactions_recent_idx
  on public.pulse_reactions (kind, created desc);
create index if not exists pulse_reactions_day_idx
  on public.pulse_reactions (kind, day);

create table if not exists public.pulse_pings (
  player uuid not null,
  day    date not null,
  primary key (player, day)
);

-- --------------------------------------------------------------------- lock
alter table public.pulse_reactions enable row level security;
alter table public.pulse_pings     enable row level security;

-- -------------------------------------------------------------------- RPCs
create or replace function public.pulse_react(
  p_player uuid, p_kind text, p_url text, p_title text, p_source text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('save', 'dig') then
    raise exception 'bad kind';
  end if;
  if p_url is null or p_url not like 'http%' or length(p_url) > 600 then
    raise exception 'bad url';
  end if;
  if (select count(*) from pulse_reactions
      where player = p_player
        and day = (now() at time zone 'America/New_York')::date) >= 200 then
    return;
  end if;
  insert into pulse_reactions (player, kind, url, title, source)
  values (p_player, p_kind, p_url,
          left(coalesce(p_title, ''), 300), left(coalesce(p_source, ''), 80))
  on conflict do nothing;
end;
$$;

create or replace function public.pulse_popular(
  p_hours integer default 48, p_min integer default 2, p_limit integer default 40
) returns table (url text, title text, source text, saves bigint)
language sql
security definer
set search_path = public
stable
as $$
  select r.url,
         max(r.title)  as title,
         max(r.source) as source,
         count(distinct r.player) as saves
  from pulse_reactions r
  where r.kind = 'save'
    and r.created > now() - make_interval(hours => least(greatest(p_hours, 1), 168))
  group by r.url
  having count(distinct r.player) >= greatest(p_min, 1)
  order by saves desc, max(r.created) desc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.pulse_dig_leaders(
  p_day date default (now() at time zone 'America/New_York')::date
) returns table (url text, title text, source text, votes bigint)
language sql
security definer
set search_path = public
stable
as $$
  select r.url,
         max(r.title)  as title,
         max(r.source) as source,
         count(distinct r.player) as votes
  from pulse_reactions r
  where r.kind = 'dig' and r.day = p_day
  group by r.url
  order by votes desc, max(r.created) desc
  limit 20;
$$;

create or replace function public.pulse_ping(
  p_player uuid, p_day text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into pulse_pings (player, day)
  values (p_player, to_date(p_day, 'YYYY-MM-DD'))
  on conflict do nothing;
end;
$$;

-- ------------------------------------------------------------------- grants
revoke all on function public.pulse_react(uuid, text, text, text, text) from public;
revoke all on function public.pulse_popular(integer, integer, integer)  from public;
revoke all on function public.pulse_dig_leaders(date)                   from public;
revoke all on function public.pulse_ping(uuid, text)                    from public;

grant execute on function public.pulse_react(uuid, text, text, text, text) to anon;
grant execute on function public.pulse_popular(integer, integer, integer)  to anon;
grant execute on function public.pulse_dig_leaders(date)                   to anon;
grant execute on function public.pulse_ping(uuid, text)                    to anon;

-- ------------------------------------------------- handy operator queries
-- Daily uniques:
--   select day, count(*) from pulse_pings group by day order by day desc;
-- D1 return rate (of people first seen yesterday, how many came back today):
--   with firsts as (select player, min(day) d0 from pulse_pings group by player)
--   select f.d0, count(*) filter (where p.day = f.d0 + 1)::float / count(distinct f.player)
--   from firsts f left join pulse_pings p using (player) group by f.d0 order by f.d0 desc;
