#!/usr/bin/env bash
# Applies nn-SETUP.sql and then all-day/supabase/nn-watch.sql (twice, as a
# paste-again check) to a scratch LOCAL Postgres and runs
# scripts/test-nn-watch-sql.sql against it as anon and authenticated. It
# never touches the live project. The scratch database is built the way
# scripts/test-nn-sql.sh builds it; when there is no local Postgres it says
# so and exits 0.
#
#   bash scripts/test-nn-watch-sql.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-nn_watch_scratch}
export PGOPTIONS="-c client_min_messages=warning"

if ! command -v psql >/dev/null 2>&1 || ! psql -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
  echo "test-nn-watch-sql: SKIPPED — no local Postgres reachable with psql (try: brew services start postgresql@17)."
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
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
SQL
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f all-day/supabase/nn-SETUP.sql >/dev/null
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f all-day/supabase/nn-watch.sql >/dev/null
psql -v ON_ERROR_STOP=1 -d "$DB" -q -f all-day/supabase/nn-watch.sql >/dev/null
psql -v ON_ERROR_STOP=1 -d "$DB" -q -o /dev/null -f scripts/test-nn-watch-sql.sql
psql -d postgres -qc "drop database if exists $DB" >/dev/null
echo "test-nn-watch-sql: OK"
