-- ============================================================
-- BTOWN COMMUNITY PHOTOS — one-time Supabase setup
-- Run this ONCE in the SQL Editor of the shared project
-- (jnouvwxomrcffqwilqkq — same one the games and playlist use).
--
-- ⚠️ ONE THING TO EDIT FIRST: search for CHOOSE_YOUR_ADMIN_PASSPHRASE
-- below and replace it with a passphrase you'll remember (keep the
-- quotes). It unlocks photo-admin.html on your phone. Using the same
-- passphrase as the Caption This admin is fine. Only the bcrypt hash
-- is stored; to change it later, re-run just that insert statement.
--
-- Security model matches quick-wins.sql and the caption-this schema:
-- RLS locks every table completely; the public anon key can ONLY go
-- through the security-definer functions below. Nothing publishes
-- without moderation — every submission lands as status 'pending'.
--
-- STORAGE: this file also creates the public 'btb-photos' bucket and
-- an anon INSERT policy (jpegs under submissions/ only, nothing else —
-- no public list/update/delete). If the LAST two statements fail with
-- "must be owner of table objects", everything else worked; create the
-- bucket + policy in the dashboard instead (see db/PHOTOS-SETUP.md).
-- ============================================================

-- Supabase installs extensions into the "extensions" schema
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------ tables

create table if not exists btb_photos (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  storage_path  text not null unique
                check (storage_path ~ '^submissions/[A-Za-z0-9-]+\.jpg$'),
  caption       text not null default '' check (length(caption) <= 280),
  category      text not null check (category in
                  ('sunsets','pets','gardens','food','wildlife',
                   'street','events','other')),
  area          text not null check (area in
                  ('Downtown / Church St','Old North End','New North End',
                   'South End','Hill Section','UVM / University','Waterfront',
                   'Winooski','South Burlington','Essex / Essex Jct',
                   'Williston','Shelburne','Colchester','Greater Burlington',
                   'Elsewhere')),
  spot          text not null default '' check (length(spot) <= 120),
  taken_on      text not null default '' check (length(taken_on) <= 40),
  credit        text not null default '' check (length(credit) <= 60),
  -- contributors keep ownership; this records they granted the
  -- Burlington Brief permission to publish (site + newsletter)
  permission    boolean not null default false,
  ai_disclosed  boolean not null default false,  -- submitter self-report
  display_label text,                            -- admin-set, e.g. 'AI-generated'
  submitted_via text not null default 'web'
                check (submitted_via in ('web','email','telegram','editor')),
  submitter     text not null default '',        -- visitor id (rate limiting only)
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','removed')),
  decided_at    timestamptz,
  mod_note      text                             -- editor's private note
);
alter table btb_photos enable row level security;
revoke all on table btb_photos from anon, authenticated;

create table if not exists btb_photo_votes (
  photo_id   uuid not null references btb_photos(id) on delete cascade,
  voter      text not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, voter)
);
alter table btb_photo_votes enable row level security;
revoke all on table btb_photo_votes from anon, authenticated;

create table if not exists btb_photo_admin (
  id boolean primary key default true check (id),  -- single row
  pass_hash text not null
);
alter table btb_photo_admin enable row level security;
revoke all on table btb_photo_admin from anon, authenticated;

-- ⚠️⚠️⚠️ EDIT THIS LINE: set your admin passphrase, then run the file ⚠️⚠️⚠️
insert into btb_photo_admin (pass_hash)
values (crypt('CHOOSE_YOUR_ADMIN_PASSPHRASE', gen_salt('bf')))
on conflict (id) do update set pass_hash = excluded.pass_hash;

-- ----------------------------------------------------------- helpers

-- search_path includes "extensions" so crypt() resolves on Supabase,
-- where pgcrypto lives in the extensions schema (works either way)
create or replace function btb_photo_is_admin(p_pass text) returns boolean
language sql security definer stable set search_path = public, extensions as $$
  select exists (
    select 1 from btb_photo_admin
    where pass_hash = crypt(coalesce(p_pass, ''), pass_hash)
  );
$$;
revoke all on function btb_photo_is_admin(text) from public, anon, authenticated;

create or replace function btb_photo_require_admin(p_pass text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not btb_photo_is_admin(p_pass) then
    raise exception 'bad admin passphrase' using errcode = '28000';
  end if;
end $$;
revoke all on function btb_photo_require_admin(text) from public, anon, authenticated;

-- ------------------------------------------------------- public RPCs

-- Submit: the jpeg was already uploaded to storage; this registers it
-- as 'pending' (invisible everywhere until approved). The permission
-- box is required — no permission, no row. Rate limits: 5 pending per
-- visitor, 100 global.
create or replace function btb_photos_submit(
  p_path text, p_caption text, p_category text, p_area text, p_spot text,
  p_taken text, p_name text, p_permission boolean, p_ai boolean, p_voter text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_permission, false) is not true then
    raise exception 'permission to publish is required' using errcode = 'P0001';
  end if;
  if p_path !~ '^submissions/[A-Za-z0-9-]+\.jpg$' then
    raise exception 'bad photo path' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_voter), '') = '' or length(p_voter) > 80 then
    raise exception 'bad visitor id' using errcode = 'P0001';
  end if;
  if (select count(*) from btb_photos
      where submitter = p_voter and status = 'pending') >= 5 then
    raise exception 'you already have 5 photos waiting for review'
      using errcode = 'P0001';
  end if;
  if (select count(*) from btb_photos where status = 'pending') >= 100 then
    raise exception 'review queue is full — try again tomorrow'
      using errcode = 'P0001';
  end if;
  insert into btb_photos
    (storage_path, caption, category, area, spot, taken_on, credit,
     permission, ai_disclosed, submitter)
  values
    (p_path,
     left(trim(coalesce(p_caption, '')), 280),
     p_category,                             -- CHECK constraint validates
     p_area,                                 -- CHECK constraint validates
     left(trim(coalesce(p_spot, '')), 120),
     left(trim(coalesce(p_taken, '')), 40),
     left(trim(coalesce(p_name, '')), 60),
     true, coalesce(p_ai, false), trim(p_voter));
end $$;
grant execute on function btb_photos_submit(text, text, text, text, text, text, text, boolean, boolean, text) to anon;

-- Gallery: every approved photo with its vote count, newest first.
-- Category/area filtering happens client-side (the whole set is small).
create or replace function btb_photos_get()
returns table (
  id uuid, storage_path text, caption text, category text, area text,
  spot text, taken_on text, credit text, display_label text,
  approved_on date, votes bigint
)
language sql security definer stable set search_path = public as $$
  select p.id, p.storage_path, p.caption, p.category, p.area,
         p.spot, p.taken_on, p.credit, p.display_label,
         p.decided_at::date as approved_on,
         count(v.voter) as votes
  from btb_photos p
  left join btb_photo_votes v on v.photo_id = p.id
  where p.status = 'approved'
  group by p.id
  order by p.decided_at desc nulls last, p.created_at desc;
$$;
grant execute on function btb_photos_get() to anon;

-- Vote: one heart per visitor per photo; returns the new count.
create or replace function btb_photos_vote(p_photo uuid, p_voter text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if coalesce(trim(p_voter), '') = '' or length(p_voter) > 80 then
    raise exception 'bad voter' using errcode = 'P0001';
  end if;
  if not exists (select 1 from btb_photos
                 where id = p_photo and status = 'approved') then
    raise exception 'unknown photo' using errcode = 'P0001';
  end if;
  insert into btb_photo_votes (photo_id, voter) values (p_photo, trim(p_voter))
  on conflict do nothing;
  select count(*) into n from btb_photo_votes where photo_id = p_photo;
  return n;
end $$;
grant execute on function btb_photos_vote(uuid, text) to anon;

-- Photo of the week, fully automatic: the most-hearted photo approved in
-- the last 7 days; if that window is empty, the last 30. Ties go to the
-- photo that's been up longest. Null when the gallery is brand new.
create or replace function btb_photos_potw()
returns table (
  id uuid, storage_path text, caption text, category text, area text,
  spot text, taken_on text, credit text, display_label text,
  approved_on date, votes bigint
)
language sql security definer stable set search_path = public as $$
  with ranked as (
    select p.*, count(v.voter) as n_votes
    from btb_photos p
    left join btb_photo_votes v on v.photo_id = p.id
    where p.status = 'approved' and p.decided_at is not null
    group by p.id
  )
  select r.id, r.storage_path, r.caption, r.category, r.area,
         r.spot, r.taken_on, r.credit, r.display_label,
         r.decided_at::date, r.n_votes
  from ranked r
  where r.decided_at >= now() - case
    when exists (select 1 from ranked
                 where decided_at >= now() - interval '7 days')
    then interval '7 days' else interval '30 days' end
  order by r.n_votes desc, r.decided_at asc
  limit 1;
$$;
grant execute on function btb_photos_potw() to anon;

-- Queue size — used by the admin badge (and a notification Action later).
create or replace function btb_photos_pending_count() returns integer
language sql security definer stable set search_path = public as $$
  select count(*)::int from btb_photos where status = 'pending';
$$;
grant execute on function btb_photos_pending_count() to anon;

-- -------------------------------------------------------- admin RPCs

-- Everything the moderation queue needs in one call: the pending queue
-- (oldest first) plus the 50 most recently decided photos so a wrong
-- tap can be undone.
create or replace function btb_photos_admin_list(p_pass text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform btb_photo_require_admin(p_pass);
  return json_build_object(
    'pending', coalesce((select json_agg(row_to_json(t)) from (
      select id, storage_path, caption, category, area, spot, taken_on,
             credit, ai_disclosed, submitted_via, created_at
      from btb_photos where status = 'pending'
      order by created_at) t), '[]'::json),
    'recent', coalesce((select json_agg(row_to_json(t)) from (
      select p.id, p.storage_path, p.caption, p.category, p.area, p.credit,
             p.status, p.display_label, p.decided_at,
             (select count(*) from btb_photo_votes v where v.photo_id = p.id) as votes
      from btb_photos p where p.status in ('approved','rejected','removed')
      order by p.decided_at desc nulls last limit 50) t), '[]'::json),
    'approved_count', (select count(*) from btb_photos where status = 'approved')
  );
end $$;
grant execute on function btb_photos_admin_list(text) to anon;

-- Approve / reject / remove (also un-approve — any direction works).
-- p_label optionally sets the public label ('AI-generated', 'Heavily
-- edited'); pass '' to clear it, null to leave it alone.
create or replace function btb_photos_moderate(
  p_pass text, p_photo uuid, p_status text, p_label text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform btb_photo_require_admin(p_pass);
  if p_status not in ('pending','approved','rejected','removed') then
    raise exception 'bad status' using errcode = 'P0001';
  end if;
  update btb_photos
  set status = p_status,
      decided_at = case when p_status = 'pending' then null else now() end,
      display_label = case
        when p_label is null then display_label
        when trim(p_label) = '' then null
        else left(trim(p_label), 40) end
  where id = p_photo;
end $$;
grant execute on function btb_photos_moderate(text, uuid, text, text) to anon;

-- Editor add: for photos that arrive by email or Telegram. The jpeg is
-- uploaded from photo-admin.html first; this registers it. Only add a
-- photo when the sender said it's OK to publish — that yes IS the
-- permission record (note who/where in p_note).
create or replace function btb_photos_add(
  p_pass text, p_path text, p_caption text, p_category text, p_area text,
  p_spot text, p_taken text, p_credit text, p_via text, p_ai boolean,
  p_note text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform btb_photo_require_admin(p_pass);
  if p_path !~ '^submissions/[A-Za-z0-9-]+\.jpg$' then
    raise exception 'bad photo path' using errcode = 'P0001';
  end if;
  if p_via not in ('email','telegram','editor') then
    raise exception 'bad source' using errcode = 'P0001';
  end if;
  insert into btb_photos
    (storage_path, caption, category, area, spot, taken_on, credit,
     permission, ai_disclosed, submitted_via, submitter, status, decided_at,
     mod_note)
  values
    (p_path,
     left(trim(coalesce(p_caption, '')), 280),
     p_category, p_area,
     left(trim(coalesce(p_spot, '')), 120),
     left(trim(coalesce(p_taken, '')), 40),
     left(trim(coalesce(p_credit, '')), 60),
     true, coalesce(p_ai, false), p_via, 'editor', 'approved', now(),
     left(trim(coalesce(p_note, '')), 500));
end $$;
grant execute on function btb_photos_add(text, text, text, text, text, text, text, text, text, boolean, text) to anon;

-- ------------------------------------------------------------ storage
-- Public bucket for the photos themselves. Pending photos have
-- unguessable UUID filenames and are linked from nowhere until approved.
-- If either statement fails with "must be owner", do it in the
-- dashboard instead — see db/PHOTOS-SETUP.md step 2.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('btb-photos', 'btb-photos', true, 3145728, '{image/jpeg}')
on conflict (id) do nothing;

drop policy if exists "btb photos anon upload" on storage.objects;
create policy "btb photos anon upload"
on storage.objects for insert to anon
with check (
  bucket_id = 'btb-photos'
  and name ~ '^submissions/[A-Za-z0-9-]+\.jpg$'
);
