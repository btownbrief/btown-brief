-- All Day — upvotes.
--
-- Paste this whole file into the Supabase SQL editor once, on project
-- jnouvwxomrcffqwilqkq. Until you do, the app runs exactly as it does now:
-- every call returns null, the arrows stay hidden, and the Popular view says
-- so rather than erroring. Nothing else depends on it.
--
-- Design notes, so this is maintainable later:
--
--   * `ad_` prefix, per the project's prefix map (wp_ Who's Playing,
--     uf_ Up For It, party_/bp_, lb_, st_). Nothing here touches pulse_* or
--     tv_*, which keep doing their own jobs.
--   * RLS is ON with no policies, which means the anon key cannot read or
--     write these tables directly. Everything goes through the SECURITY
--     DEFINER functions below, which is the same pattern the rest of the
--     site uses. That is what stops someone with the publishable key from
--     dumping or rewriting the vote table.
--   * The vote is keyed to `btown-player-id`, the anonymous id already
--     shared with pulse.html and the games. No login, no email, no account.
--   * One row per (player, item). Voting twice is idempotent; unvoting a
--     thing you never voted for is a no-op.
--   * Item metadata (title, source, href) is denormalised onto the row on
--     purpose: a headline falls off the wire after a day or two, but the
--     votes it earned should still render in Popular.

create table if not exists public.ad_votes (
  player   text        not null,
  item_key text        not null,
  kind     text        not null default 'wire',
  title    text        not null default '',
  src      text        not null default '',
  href     text        not null default '',
  voted_at timestamptz not null default now(),
  primary key (player, item_key)
);

create index if not exists ad_votes_item_idx on public.ad_votes (item_key);
create index if not exists ad_votes_recent_idx on public.ad_votes (voted_at desc);

alter table public.ad_votes enable row level security;
-- deliberately no policies: the functions below are the only way in

-- Cast a vote. Returns the item's new count.
create or replace function public.ad_vote(
  p_player text, p_key text, p_kind text,
  p_title text, p_from text, p_href text
) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_player is null or length(p_player) < 3 or p_key is null or length(p_key) = 0 then
    return 0;
  end if;
  insert into ad_votes (player, item_key, kind, title, src, href)
  values (p_player, left(p_key, 600), coalesce(nullif(p_kind, ''), 'wire'),
          left(coalesce(p_title, ''), 300), left(coalesce(p_from, ''), 120),
          left(coalesce(p_href, ''), 600))
  on conflict (player, item_key) do nothing;
  select count(*) into n from ad_votes where item_key = left(p_key, 600);
  return n;
end $$;

-- Take it back. Returns the item's new count.
create or replace function public.ad_unvote(
  p_player text, p_key text, p_kind text,
  p_title text, p_from text, p_href text
) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from ad_votes where player = p_player and item_key = left(p_key, 600);
  select count(*) into n from ad_votes where item_key = left(p_key, 600);
  return n;
end $$;

-- Counts for a screenful of items, in one request rather than one per card.
create or replace function public.ad_counts(p_keys text[])
returns table (k text, n integer)
language sql security definer set search_path = public as $$
  select item_key, count(*)::integer
  from ad_votes
  where item_key = any(p_keys[1:300])
  group by item_key
$$;

-- The Popular view. Recent votes only, so the list stays a picture of what
-- people care about now rather than an all-time hall of fame.
create or replace function public.ad_top(p_limit integer default 60)
returns table (k text, n integer, kind text, title text, "from" text, href text)
language sql security definer set search_path = public as $$
  select item_key,
         count(*)::integer,
         (array_agg(kind order by voted_at desc))[1],
         (array_agg(title order by voted_at desc))[1],
         (array_agg(src order by voted_at desc))[1],
         (array_agg(href order by voted_at desc))[1]
  from ad_votes
  where voted_at > now() - interval '14 days'
  group by item_key
  order by count(*) desc, max(voted_at) desc
  limit least(coalesce(p_limit, 60), 200)
$$;

grant execute on function public.ad_vote(text, text, text, text, text, text) to anon;
grant execute on function public.ad_unvote(text, text, text, text, text, text) to anon;
grant execute on function public.ad_counts(text[]) to anon;
grant execute on function public.ad_top(integer) to anon;
