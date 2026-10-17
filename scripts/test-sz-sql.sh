#!/usr/bin/env bash
# Applies all-day/supabase/sz-SETUP.sql (the Habits tab), then sz-ROUND2.sql
# (the rules with only the abuse ceiling of 100) over it, to a scratch LOCAL
# Postgres database, seeds it with scripts/sz-seed.sql, and runs the checks
# in scripts/test-sz-sql.sql against it as the anon and authenticated roles,
# the way the app's publishable key reaches Supabase. It never touches the
# live project.
#
#   bash scripts/test-sz-sql.sh
#
# sz-SETUP.sql is applied twice, then sz-ROUND2.sql twice, and the seed
# twice: each must be safe to paste again. Then once more on a database
# that already has the boards (nn-SETUP.sql), to show the two never step on
# each other. Then once more the way the live project got there:
# sz-SETUP.sql as first pasted (a ceiling of 5 habits), then sz-ROUND2.sql
# over it.
#
# Needs a local Postgres you can reach with psql (Homebrew's postgresql@17:
# brew services start postgresql@17). When there is none, it says so and
# exits 0: this script does not install anything.
#
# Supabase's own pieces are stood in for, as scripts/test-nn-sql.sh does: an
# auth schema with auth.users and auth.uid() reading request.jwt.claims, the
# anon/authenticated roles, and the extensions schema with pgcrypto.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-sz_scratch}
export PGOPTIONS="-c client_min_messages=warning"

if ! command -v psql >/dev/null 2>&1 || ! psql -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
  echo "test-sz-sql: SKIPPED — no local Postgres reachable with psql (try: brew services start postgresql@17)."
  exit 0
fi

apply() { psql -v ON_ERROR_STOP=1 -d "$DB" -q -f "$1" >/dev/null; }
check() { psql -v ON_ERROR_STOP=1 -d "$DB" -q -o /dev/null -f "$1"; }

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
-- Supabase grants new tables and functions to anon and authenticated by
-- default; do the same here so the file's own revokes are what is tested.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
SQL
}

# 1. the pastes alone, each twice, then the seed, twice
fresh
apply all-day/supabase/sz-SETUP.sql
apply all-day/supabase/sz-SETUP.sql
apply all-day/supabase/sz-ROUND2.sql
apply all-day/supabase/sz-ROUND2.sql
apply scripts/sz-seed.sql
apply scripts/sz-seed.sql
check scripts/test-sz-sql.sql

# 2. the same, on a database that already has the boards
fresh
psql -v ON_ERROR_STOP=1 -d "$DB" -q >/dev/null <<'SQL'
create table public.btb_photos (id uuid primary key default gen_random_uuid(), storage_path text unique not null,
  status text not null default 'pending', decided_at timestamptz, spot text not null default '', created_at timestamptz not null default now());
SQL
apply all-day/supabase/nn-SETUP.sql
apply all-day/supabase/sz-SETUP.sql
apply all-day/supabase/sz-SETUP.sql
apply all-day/supabase/sz-ROUND2.sql
apply all-day/supabase/sz-ROUND2.sql
apply scripts/sz-seed.sql
check scripts/test-sz-sql.sql

# 3. the live project's way: the first sz-SETUP.sql (ceiling 5), then sz-ROUND2.sql
fresh
FIRST=$(mktemp -t sz-first.XXXXXX)
trap 'rm -f "$FIRST"' EXIT
sed 's/"habitsMax":100,/"habitsMax":5,/' all-day/supabase/sz-SETUP.sql > "$FIRST"
grep -q '"habitsMax":5,' "$FIRST"
apply "$FIRST"
[ "$(psql -d "$DB" -Atqc "select public.sz_rules() -> 'limits' ->> 'habitsMax'")" = 5 ]
apply all-day/supabase/sz-ROUND2.sql
apply all-day/supabase/sz-ROUND2.sql
apply scripts/sz-seed.sql
check scripts/test-sz-sql.sql

psql -d postgres -qc "drop database if exists $DB" >/dev/null
echo "test-sz-sql: OK"
