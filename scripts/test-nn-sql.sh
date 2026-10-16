#!/usr/bin/env bash
# Applies all-day/supabase/nn-SETUP.sql to a scratch LOCAL Postgres and runs
# scripts/test-nn-sql.sql against it as the anon and authenticated roles,
# the way the app's publishable key reaches Supabase. It never touches the
# live project.
#
#   bash scripts/test-nn-sql.sh
#
# Needs a local Postgres you can reach with psql (Homebrew's postgresql@17:
# brew services start postgresql@17). When there is none, it says so and
# exits 0: this script does not install anything.
#
# Supabase's own pieces are stood in for: an auth schema with auth.users and
# auth.uid() reading request.jwt.claims, the anon/authenticated roles, the
# extensions schema with pgcrypto, and a minimal btb_photos (the reader
# photo queue from db/photos.sql) holding only what nn_ reads.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-nn_scratch}
export PGOPTIONS="-c client_min_messages=warning"

if ! command -v psql >/dev/null 2>&1 || ! psql -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
  echo "test-nn-sql: SKIPPED — no local Postgres reachable with psql (try: brew services start postgresql@17)."
  exit 0
fi

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
-- Supabase grants new tables and functions to anon and authenticated by
-- default; do the same here so the file's own revokes are what is tested.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create table public.btb_photos (id uuid primary key default gen_random_uuid(), storage_path text unique not null,
  status text not null default 'pending', decided_at timestamptz);
revoke all on table public.btb_photos from anon, authenticated;
SQL
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f all-day/supabase/nn-SETUP.sql >/dev/null
# Twice: the file must be safe to paste again.
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f all-day/supabase/nn-SETUP.sql >/dev/null
psql -v ON_ERROR_STOP=1 -d "$DB" -q -o /dev/null -f scripts/test-nn-sql.sql
psql -d postgres -qc "drop database if exists $DB" >/dev/null
echo "test-nn-sql: OK"
