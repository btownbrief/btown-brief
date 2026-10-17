-- ============================================================================
-- All Day — the Watch tab's seen-dots, for a signed-in reader.
--
-- Paste this AFTER nn-SETUP.sql (it uses nn_clean from there), in the same
-- Supabase SQL Editor, and Run. Idempotent: safe to run again; it never
-- deletes a reader's dots.
--
-- What it is for. The Watch tab marks every film with two dots: seen by me,
-- seen by my person (a partner, a roommate: whoever the reader watches
-- with). The dots live on the phone. A signed-in reader's dots also live
-- here, so they follow the reader to another phone or laptop. The partner
-- is a first name the reader typed, kept as a label on the reader's own
-- account; it is never a second account and never linked to anyone.
--
--   nn_watch_seen     one row per reader per film they have marked: the
--                     TMDB film id and the two dots. A row with both dots
--                     off is deleted, not kept.
--   nn_watch_partner  the partner's first name, one per reader.
--
-- Same security model as nn-SETUP.sql: RLS on with no policies, tables
-- revoked from anon and authenticated, and two security-definer functions
-- as the only doors, both signed-in only. Nothing here is public; nobody
-- can read another reader's dots.
--
--   nn_watch_seen_set(film, me, partner, partner_name)  set one film's dots
--   nn_watch_seen_get()                                  the reader's dots
--
-- Deleting a reader: the rows go when their Supabase account is deleted
-- (on delete cascade). All Day's "Delete my account and posts"
-- (nn_delete_me in nn-SETUP.sql) does not delete the account itself, so it
-- needs one more line to clear these too; the Watch PR asks the foundation
-- for it. Until then, nn_watch_forget() clears them on request.
-- ============================================================================

create table if not exists public.nn_watch_seen (
  user_id    uuid not null references auth.users(id) on delete cascade,
  film       integer not null check (film > 0),
  me         boolean not null default false,
  partner    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, film),
  check (me or partner)
);

create table if not exists public.nn_watch_partner (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 32 and position('@' in name) = 0),
  updated_at timestamptz not null default now()
);

alter table public.nn_watch_seen    enable row level security;
alter table public.nn_watch_partner enable row level security;
revoke all on table public.nn_watch_seen, public.nn_watch_partner from anon, authenticated;

-- A reader marks a lot of films over the years, but not this many; past it
-- the call refuses with 'too_many' rather than letting one account grow
-- without end.
create or replace function public.nn_watch_cap() returns integer language sql immutable as $$ select 5000 $$;

-- Set one film's two dots for the signed-in reader. Both off deletes the
-- row. p_partner_name, when given, also saves the partner's first name
-- (tidied the way a post's words are; '' forgets it). Answers the row as
-- saved: {"film": 603, "me": true, "partner": false}.
create or replace function public.nn_watch_seen_set(p_film integer, p_me boolean, p_partner boolean, p_partner_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  nm text;
  m boolean := coalesce(p_me, false);
  p boolean := coalesce(p_partner, false);
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_film is null or p_film < 1 then raise exception 'bad_film'; end if;
  -- one reader's calls queue behind each other, so the cap cannot be raced
  perform pg_advisory_xact_lock(hashtext('nn_watch:' || u::text));

  if p_partner_name is not null then
    nm := public.nn_clean(p_partner_name);
    if nm = '' then
      delete from nn_watch_partner where user_id = u;
    elsif char_length(nm) > 32 or position('@' in nm) > 0 then
      raise exception 'bad_name';
    else
      insert into nn_watch_partner (user_id, name) values (u, nm)
        on conflict (user_id) do update set name = excluded.name, updated_at = now();
    end if;
  end if;

  if not m and not p then
    delete from nn_watch_seen where user_id = u and film = p_film;
  else
    if not exists (select 1 from nn_watch_seen where user_id = u and film = p_film)
       and (select count(*) from nn_watch_seen where user_id = u) >= public.nn_watch_cap() then
      raise exception 'too_many';
    end if;
    insert into nn_watch_seen (user_id, film, me, partner) values (u, p_film, m, p)
      on conflict (user_id, film) do update set me = excluded.me, partner = excluded.partner, updated_at = now();
  end if;
  return jsonb_build_object('film', p_film, 'me', m, 'partner', p);
end $$;

-- The signed-in reader's dots and partner name:
-- {"partner": "Sam" or null, "seen": [[603, true, false], [278, true, true], ...]}
-- Each film is [TMDB id, seen by me, seen by the partner].
create or replace function public.nn_watch_seen_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return jsonb_build_object(
    'partner', (select name from nn_watch_partner where user_id = u),
    'seen', coalesce((select jsonb_agg(jsonb_build_array(film, me, partner) order by updated_at desc)
                        from nn_watch_seen where user_id = u), '[]'::jsonb));
end $$;

-- Clear the signed-in reader's dots and partner name.
create or replace function public.nn_watch_forget()
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  delete from nn_watch_seen where user_id = u;
  delete from nn_watch_partner where user_id = u;
  return jsonb_build_object('forgotten', true);
end $$;

-- Grants: take back what Postgres and Supabase hand out by default, then
-- open exactly the three doors, to signed-in readers only.
revoke all on function public.nn_watch_cap(), public.nn_watch_seen_set(integer, boolean, boolean, text),
  public.nn_watch_seen_get(), public.nn_watch_forget() from public, anon, authenticated;
grant execute on function public.nn_watch_seen_set(integer, boolean, boolean, text), public.nn_watch_seen_get(),
  public.nn_watch_forget() to authenticated;
