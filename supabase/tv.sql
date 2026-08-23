-- Btown TV — reader reactions (Supabase / Postgres)
-- ==============================================================================
-- Backs the two RPCs used by js/tv.js (the page) and scripts/curate_tv.py (the
-- nightly editor), same project + anon-key pattern as pulse.sql:
--   tv_react(p_player, p_kind, p_vid, p_title, p_channel)   a reader tapped
--       watched / skip ("not for me") / more ("more like this") on a card
--   tv_signals(p_days)                                      aggregated counts the
--       editor reads before picking: skipped videos, watched videos, and the
--       channels readers want more of
--
-- Design notes:
--  * No accounts. Each browser mints a random player uuid in localStorage
--    ('btown-player-id', shared with the Pulse and the games). Reactions are
--    additive counters, capped per player per day.
--  * The PAGE hides what YOU watched via localStorage; the EDITOR only ever sees
--    aggregates (distinct-player counts), so one person can't steer the page.
--    curate_tv.py drops a video only when >= 2 distinct players said "not for me".
--  * Tables are locked (RLS on, no policies). The anon key reaches the data only
--    through the SECURITY DEFINER functions below.
--  * Safe to run more than once (idempotent). Paste into the Supabase SQL editor.
--    Until it's run, the page and the editor both fail soft (no signals, no error).

-- ------------------------------------------------------------------ tables
create table if not exists public.tv_reactions (
  id       bigint generated always as identity primary key,
  created  timestamptz not null default now(),
  day      date        not null default (now() at time zone 'America/New_York')::date,
  player   uuid        not null,
  kind     text        not null check (kind in ('watched', 'skip', 'more')),
  vid      text        not null check (vid ~ '^[A-Za-z0-9_-]{11}$'),
  title    text        not null default '',
  channel  text        not null default '',
  unique (player, kind, vid, day)
);

create index if not exists tv_reactions_recent_idx
  on public.tv_reactions (kind, created desc);

-- --------------------------------------------------------------------- lock
alter table public.tv_reactions enable row level security;

-- -------------------------------------------------------------------- RPCs
create or replace function public.tv_react(
  p_player uuid, p_kind text, p_vid text, p_title text, p_channel text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('watched', 'skip', 'more') then
    raise exception 'bad kind';
  end if;
  if p_vid is null or p_vid !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'bad video id';
  end if;
  if (select count(*) from tv_reactions
      where player = p_player
        and day = (now() at time zone 'America/New_York')::date) >= 100 then
    return;
  end if;
  insert into tv_reactions (player, kind, vid, title, channel)
  values (p_player, p_kind, p_vid,
          left(coalesce(p_title, ''), 300), left(coalesce(p_channel, ''), 80))
  on conflict do nothing;
end;
$$;

-- One row per (kind, vid, channel) for watched/skip and per (kind, channel)
-- for more, with n = distinct players. The editor reads this once a night and
-- also sums skips per channel (a channel readers keep passing on is flagged).
create or replace function public.tv_signals(
  p_days integer default 21
) returns table (kind text, vid text, channel text, n bigint)
language sql
security definer
set search_path = public
stable
as $$
  select r.kind,
         case when r.kind = 'more' then null else r.vid end as vid,
         r.channel,
         count(distinct r.player) as n
  from tv_reactions r
  where r.created > now() - make_interval(days => least(greatest(p_days, 1), 90))
  group by r.kind,
           case when r.kind = 'more' then null else r.vid end,
           r.channel
  order by n desc
  limit 500;
$$;

-- ------------------------------------------------------------------- grants
revoke all on function public.tv_react(uuid, text, text, text, text) from public;
revoke all on function public.tv_signals(integer)                    from public;
grant execute on function public.tv_react(uuid, text, text, text, text) to anon;
grant execute on function public.tv_signals(integer)                    to anon;

-- ------------------------------------------------- handy operator queries
-- What readers are skipping most this month:
--   select vid, max(title), count(distinct player) from tv_reactions
--   where kind = 'skip' and created > now() - interval '30 days'
--   group by vid order by 3 desc limit 20;
