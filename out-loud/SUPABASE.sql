-- Btown Out Loud — anonymous play/walk counters.
-- Paste into the Supabase SQL editor for the shared Btown project
-- (same project the game leaderboards use). The app calls rpc/out_loud_event
-- with the anon key and fails soft if this isn't installed yet.

create table if not exists public.out_loud_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('walk_start','play','share')),
  story text,
  day date not null default (now() at time zone 'America/New_York')::date,
  created_at timestamptz not null default now()
);
create index if not exists out_loud_events_day_idx on public.out_loud_events (day, kind, story);

alter table public.out_loud_events enable row level security;
-- No direct access for anon; only through the function below.
revoke all on public.out_loud_events from anon, authenticated;

create or replace function public.out_loud_event(p_kind text, p_story text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('walk_start','play','share') then return; end if;
  if p_story is not null and length(p_story) > 64 then return; end if;
  insert into public.out_loud_events (kind, story) values (p_kind, p_story);
end;
$$;
grant execute on function public.out_loud_event(text, text) to anon, authenticated;

-- Read side for the newsletter / a future dashboard (not used by the app):
create or replace view public.out_loud_daily as
  select day, kind, story, count(*) as n
  from public.out_loud_events group by day, kind, story;
grant select on public.out_loud_daily to authenticated;
