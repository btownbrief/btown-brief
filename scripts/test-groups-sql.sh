#!/usr/bin/env bash
# Applies db/groups-submit.sql to scratch LOCAL Postgres databases and runs
# scripts/test-groups-sql.sql against them as the anon role, the way
# clubs.html's publishable key reaches Supabase. It never touches the live
# project.
#
#   bash scripts/test-groups-sql.sh
#
# Two scratch databases:
#   1. all-day/supabase/nn-SETUP.sql (for nn_mod_ok, the shared moderator
#      passphrase), then db/groups-submit.sql TWICE (it must be safe to paste
#      again), then the checks.
#   2. db/groups-submit.sql twice with nothing else installed: it still
#      applies, and submitting still works (only the moderator calls need
#      nn-SETUP.sql).
#
# Needs a local Postgres you can reach with psql (Homebrew's postgresql@17).
# When there is none, it says so and exits 0. Supabase's own pieces are
# stood in for the same way scripts/test-nn-sql.sh does it.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-groups_scratch}
export PGOPTIONS="-c client_min_messages=warning"

if ! command -v psql >/dev/null 2>&1 || ! psql -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
  echo "test-groups-sql: SKIPPED — no local Postgres reachable with psql (try: brew services start postgresql@17)."
  exit 0
fi

apply() { psql -v ON_ERROR_STOP=1 -d "$DB" -q -f "$1" >/dev/null; }

fresh() {
psql -v ON_ERROR_STOP=1 -d postgres -qc "drop database if exists $DB" -qc "create database $DB" >/dev/null
psql -v ON_ERROR_STOP=1 -d "$DB" -q <<'SQL'
set client_min_messages = warning;
create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create table public.btb_photos (id uuid primary key default gen_random_uuid(), storage_path text unique not null,
  status text not null default 'pending', decided_at timestamptz, spot text not null default '', created_at timestamptz not null default now(),
  caption text not null default '', category text not null default 'other', area text not null default 'Elsewhere',
  taken_on text not null default '', credit text not null default '', display_label text);
create table public.btb_photo_votes (photo_id uuid references public.btb_photos(id) on delete cascade, voter text, primary key (photo_id, voter));
revoke all on table public.btb_photos, public.btb_photo_votes from anon, authenticated;
SQL
}

# 1. with the All Day moderator passphrase installed
fresh
apply all-day/supabase/nn-SETUP.sql
apply db/groups-submit.sql
apply db/groups-submit.sql
psql -v ON_ERROR_STOP=1 -d "$DB" -q -o /dev/null -f scripts/test-groups-sql.sql

# 2. on its own: applies twice, and a reader can still submit
fresh
apply db/groups-submit.sql
apply db/groups-submit.sql
psql -v ON_ERROR_STOP=1 -d "$DB" -q -o /dev/null <<'SQL'
set role anon;
do $$ begin
  if public.groups_submit('Tuesday Chess', 'games', 'Tuesdays 7pm', 'Fletcher Free', '', 'a@b.co', '', 'device-abcdef12') <> '{"ok": true}'::jsonb then
    raise exception 'FAILED: submitting without nn-SETUP.sql';
  end if;
end $$;
SQL

psql -d postgres -qc "drop database if exists $DB" >/dev/null
echo "test-groups-sql: OK"
