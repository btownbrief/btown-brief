#!/usr/bin/env bash
# Applies all-day/supabase/bd-SETUP.sql (The Build) to a scratch LOCAL
# Postgres database and runs scripts/test-bd-sql.sql against it as the anon
# and authenticated roles, the way the app's publishable key reaches
# Supabase. It never touches the live project.
#
#   bash scripts/test-bd-sql.sh
#
# Twice: once on a bare database (the file must install with no other app's
# tables), and once over the boards, Habits and the photo queue (nn-SETUP.sql,
# sz-SETUP.sql, btb_photos), where it reads nn_bans, sz_taps and btb_photos.
# bd-SETUP.sql is applied twice each time: it must be safe to paste again.
#
# Needs a local Postgres you can reach with psql (Homebrew's postgresql@17).
# When there is none, it says so and exits 0. Supabase's own pieces are stood
# in for as scripts/test-sz-sql.sh does.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-bd_scratch}
export PGOPTIONS="-c client_min_messages=warning"

if ! command -v psql >/dev/null 2>&1 || ! psql -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
  echo "test-bd-sql: SKIPPED — no local Postgres reachable with psql (try: brew services start postgresql@17)."
  exit 0
fi

apply() { psql -v ON_ERROR_STOP=1 -d "$DB" -q -f "$1" >/dev/null; }
check() { psql -v ON_ERROR_STOP=1 -d "$DB" -q -o /dev/null -v others="$2" -f scripts/test-bd-sql.sql; }

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
SQL
}

# 1. alone
fresh
apply all-day/supabase/bd-SETUP.sql
apply all-day/supabase/bd-SETUP.sql
check alone 0

# 2. over the boards, Habits and the photo queue
fresh
psql -v ON_ERROR_STOP=1 -d "$DB" -q >/dev/null <<'SQL'
create table public.btb_photos (id uuid primary key default gen_random_uuid(), storage_path text unique not null,
  status text not null default 'pending', decided_at timestamptz, spot text not null default '', created_at timestamptz not null default now());
SQL
apply all-day/supabase/nn-SETUP.sql
apply all-day/supabase/sz-SETUP.sql
apply all-day/supabase/bd-SETUP.sql
apply all-day/supabase/bd-SETUP.sql
check others 1

psql -d postgres -qc "drop database if exists $DB" >/dev/null
echo "test-bd-sql: OK"
