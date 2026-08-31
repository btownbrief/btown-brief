-- ============================================================
-- THE JAR — the suggestion box on every All Day tab
-- Run ONCE in the SQL Editor of the shared project (jnouvwxomrcffqwilqkq).
--
-- Prefix is ad_ (All Day) — see the prefix map: wp_ Who's Playing,
-- uf_ Up For It, party_/bp_ Btown Party, lb_ Lake Breath, st_ Small Talk.
--
-- Security model matches quick-wins.sql and photos.sql: RLS locks the
-- table completely and the anon key can only reach it through the
-- security-definer function below. Nothing here is ever read back by the
-- app — suggestions are read in the Supabase table editor. That is
-- deliberate: a public suggestion box that displays its own contents is
-- a moderation queue you did not ask for.
--
-- UNTIL THIS IS RUN the jar still opens, still shows the Ko-fi half, and
-- the send fails soft with "that didn't send — try again in a minute".
-- Nothing else breaks.
-- ============================================================

create table if not exists ad_suggestions (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  body       text not null check (length(body) between 4 and 600),
  -- what the person left so you can write back, if they left anything
  who        text not null default '' check (length(who) <= 120),
  -- which tab it was sent from: wire, reddit, watch, listen, whatnow,
  -- music, photos, ig, wander. Free text so a new tab never breaks the
  -- insert, and so this file does not have to be re-run to add one.
  tab        text not null default '' check (length(tab) <= 40),
  -- the browser's anonymous id, for rate limiting only
  sender     text not null default '' check (length(sender) <= 80),
  handled    boolean not null default false,
  note       text
);
alter table ad_suggestions enable row level security;

create index if not exists ad_suggestions_new on ad_suggestions (created_at desc);

-- ------------------------------------------------------------ insert

-- Security definer, so anon never touches the table directly. The rate
-- limit is per sender per hour: enough for someone with three thoughts,
-- not enough to fill the table from a phone.
create or replace function ad_suggest(
  p_text   text,
  p_who    text default '',
  p_tab    text default '',
  p_sender text default ''
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  recent int;
begin
  p_text := btrim(coalesce(p_text, ''));
  if length(p_text) < 4 or length(p_text) > 600 then
    return false;
  end if;

  if coalesce(p_sender, '') <> '' then
    select count(*) into recent
      from ad_suggestions
     where sender = p_sender
       and created_at > now() - interval '1 hour';
    if recent >= 6 then
      -- true, not false: a rate-limited sender is told it landed rather
      -- than being handed an error that invites a retry loop.
      return true;
    end if;
  end if;

  insert into ad_suggestions (body, who, tab, sender)
  values (p_text,
          left(btrim(coalesce(p_who, '')), 120),
          left(btrim(coalesce(p_tab, '')), 40),
          left(coalesce(p_sender, ''), 80));
  return true;
end;
$$;

revoke all on function ad_suggest(text, text, text, text) from public;
grant execute on function ad_suggest(text, text, text, text) to anon, authenticated;

-- ------------------------------------------------------------ reading them

-- In the SQL editor, newest first:
--   select created_at, tab, body, who from ad_suggestions
--    where not handled order by created_at desc;
-- and to tick one off:
--   update ad_suggestions set handled = true where id = '…';


-- ============================================================
-- ONE-OFF: the dog photo's caption says "he's" and she is a she.
-- Stephen's own photo, so no moderation question — just the fix.
-- Safe to run more than once; it matches on the exact current text.
-- ============================================================

update btb_photos
   set caption = 'Sunset on the waterfront path, and somebody knows she''s the main character.'
 where id = '9ab712da-0e72-40fc-93fb-c8fd0a0d654d'
   and caption like '%knows he''s the main character%';
