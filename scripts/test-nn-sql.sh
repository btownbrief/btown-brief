#!/usr/bin/env bash
# Applies all-day/supabase/nn-SETUP.sql (then nn-ROUND2.sql to nn-ROUND4.sql) to
# scratch LOCAL Postgres databases and runs the checks against them as the
# anon and authenticated roles, the way the app's publishable key reaches
# Supabase. It never touches the live project.
#
#   bash scripts/test-nn-sql.sh
#
# Twelve scratch databases, each built the way Stephen's project was:
#   1. nn-SETUP.sql alone: scripts/test-nn-sql.sql (round one).
#   2. nn-SETUP.sql, then nn-ROUND2.sql to nn-ROUND4.sql with nothing else
#      installed (no People, no Watch, no storage): round one's checks
#      still pass.
#   3. nn-SETUP.sql, nn-people.sql, nn-watch.sql, then the rounds: the
#      People and Watch tabs' own checks still pass (one database each).
#   4. the same plus a storage stand-in: scripts/test-nn-round2-sql.sql.
#   5. round three's own checks, scripts/test-nn-round3-sql.sql, twice:
#      with People, Watch, the photo queue and storage all installed, and
#      with none of them (no photo queue either).
#   6. round four's own checks, scripts/test-nn-round4-sql.sql, twice, the
#      same two ways.
#   7. round four pasted straight over round two, before round three, and
#      round three after it (the order Stephen might paste them in): round
#      two's, round three's and round four's checks still pass.
# Every round is applied twice every time: each must be safe to paste again.
#
# Needs a local Postgres you can reach with psql (Homebrew's postgresql@17:
# brew services start postgresql@17). When there is none, it says so and
# exits 0: this script does not install anything.
#
# Supabase's own pieces are stood in for: an auth schema with auth.users and
# auth.uid() reading request.jwt.claims, the anon/authenticated roles, the
# extensions schema with pgcrypto, a btb_photos / btb_photo_votes pair with
# db/photos.sql's columns, so db/photos-board.sql applies to it too, and
# (run 4) a storage.objects table with RLS on, as Supabase has it.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-nn_scratch}
export PGOPTIONS="-c client_min_messages=warning"

if ! command -v psql >/dev/null 2>&1 || ! psql -d postgres -Atqc 'select 1' >/dev/null 2>&1; then
  echo "test-nn-sql: SKIPPED — no local Postgres reachable with psql (try: brew services start postgresql@17)."
  exit 0
fi

apply() { psql -v ON_ERROR_STOP=1 -d "$DB" -q -f "$1" >/dev/null; }
check() { psql -v ON_ERROR_STOP=1 -d "$DB" -q -o /dev/null -f "$1"; }

# fresh [nophotos]: a new scratch database with round one on it; nophotos
# leaves out the photo queue stand-in (and db/photos-board.sql with it)
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
if [ "${1:-}" != nophotos ]; then
psql -v ON_ERROR_STOP=1 -d "$DB" -q <<'SQL'
create table public.btb_photos (id uuid primary key default gen_random_uuid(), storage_path text unique not null,
  status text not null default 'pending', decided_at timestamptz, spot text not null default '', created_at timestamptz not null default now(),
  caption text not null default '', category text not null default 'other' constraint btb_photos_category_check check (category in ('other')),
  area text not null default 'Elsewhere', taken_on text not null default '', credit text not null default '', display_label text);
create table public.btb_photo_votes (photo_id uuid references public.btb_photos(id) on delete cascade, voter text, primary key (photo_id, voter));
revoke all on table public.btb_photos, public.btb_photo_votes from anon, authenticated;
SQL
fi
apply all-day/supabase/nn-SETUP.sql
# Twice: the file must be safe to paste again.
apply all-day/supabase/nn-SETUP.sql
# the photo queue's gallery filter for board photos, also twice
if [ "${1:-}" != nophotos ]; then
  apply db/photos-board.sql
  apply db/photos-board.sql
fi
}

# rounds two, three and four over round one, each pasted twice
rounds() {
  apply all-day/supabase/nn-ROUND2.sql
  apply all-day/supabase/nn-ROUND2.sql
  apply all-day/supabase/nn-ROUND3.sql
  apply all-day/supabase/nn-ROUND3.sql
  apply all-day/supabase/nn-ROUND4.sql
  apply all-day/supabase/nn-ROUND4.sql
}

storage() {
psql -v ON_ERROR_STOP=1 -d "$DB" -q <<'SQL'
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to anon, authenticated;
SQL
}

# 1. round one
fresh
check scripts/test-nn-sql.sql

# 2. rounds two and three over round one, nothing else installed
fresh
rounds
check scripts/test-nn-sql.sql

# 3. rounds two and three over round one, People and Watch: their checks still pass
# (each on its own database, since both make the same test readers)
for tab in people watch; do
  fresh
  apply all-day/supabase/nn-people.sql
  apply all-day/supabase/nn-watch.sql
  rounds
  check scripts/test-nn-$tab-sql.sql
done

# 4. round two's own checks, with the storage stand-in
fresh
apply all-day/supabase/nn-people.sql
apply all-day/supabase/nn-watch.sql
storage
rounds
check scripts/test-nn-round2-sql.sql

# 5. round three's own checks: everything installed, then nothing optional
fresh
apply all-day/supabase/nn-people.sql
apply all-day/supabase/nn-watch.sql
storage
rounds
check scripts/test-nn-round3-sql.sql
fresh nophotos
rounds
check scripts/test-nn-round3-sql.sql

# 6. round four's own checks: everything installed, then nothing optional.
# The handle table is the one scripts/test-boards-core.mjs runs on the JS.
check4() { psql -v ON_ERROR_STOP=1 -d "$DB" -q -o /dev/null -v cases="$(cat scripts/test-nn-handle-cases.json)" -f scripts/test-nn-round4-sql.sql; }
fresh
apply all-day/supabase/nn-people.sql
apply all-day/supabase/nn-watch.sql
storage
rounds
check4
fresh nophotos
rounds
check4

# 7. round four straight after round two, then round three over it
for t in round2 round3 round4; do
  fresh
  apply all-day/supabase/nn-people.sql
  apply all-day/supabase/nn-watch.sql
  storage
  apply all-day/supabase/nn-ROUND2.sql
  apply all-day/supabase/nn-ROUND4.sql
  apply all-day/supabase/nn-ROUND4.sql
  apply all-day/supabase/nn-ROUND3.sql
  if [ $t = round4 ]; then check4; else check scripts/test-nn-$t-sql.sql; fi
done

psql -d postgres -qc "drop database if exists $DB" >/dev/null
echo "test-nn-sql: OK"
