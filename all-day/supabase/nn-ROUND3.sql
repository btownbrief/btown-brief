-- ============================================================================
-- ALL DAY — accounts and boards, round three (the New Nine). One paste.
--
-- Project:  jnouvwxomrcffqwilqkq (the fleet's one shared project)
-- Prefix:   nn_
-- Written:  2026-10-17
-- Needs:    all-day/supabase/nn-SETUP.sql and nn-ROUND2.sql pasted first.
--           nn-people.sql, nn-watch.sql and the photo queue (db/photos.sql)
--           are used when they are there and skipped when they are not.
--
-- How to run: Supabase dashboard -> the shared project -> SQL Editor ->
-- New query -> paste this WHOLE file -> Run. Safe to run again: it only
-- replaces two functions. It deletes no table and no row by itself.
-- SETUP-STEPHEN.md part E has the steps.
--
-- If nn-SETUP.sql is ever pasted again, paste nn-ROUND2.sql and then this
-- file right after it: nn-SETUP.sql puts back the round-one delete.
--
-- What it changes, in plain words:
--   nn_delete_me   "Delete my account and posts" now clears everything a
--                  reader left anywhere in All Day, not just the boards:
--                    their profile (with what they're into)
--                    every post, and the votes, reports and People plan
--                      details hanging off those posts
--                    every vote and report they made (the posts they
--                      reported are recounted, as before)
--                    their What Now missions
--                    their place in the People directory
--                    their Watch seen-dots and their partner's first name
--                      (round one missed these two)
--                    the photos on their posts: out of the gallery
--                      ('removed' in the photo queue, as before), and now
--                      the post's words and their first name are wiped from
--                      the queue row too
--                  It still keeps their email sign-in (shared with Small
--                  Talk and the other apps) and a ban, if Stephen banned
--                  them, so deleting an account is never a way around one.
--   nn_photo_orphan  a board photo marked 'removed' more than a day ago,
--                  with no post using it, now counts as a stray picture
--                  file, so the boards desk's existing cleanup clears the
--                  file from the bucket. Before, any queue row at all kept
--                  the file forever. Photos sent from the gallery form and
--                  photos Stephen rejected are left exactly as they were.
--
-- Security model, unchanged: RLS on, no table policies, every door a
-- security-definer function. Nothing here opens a new door.
-- ============================================================================

-- ----------------------------------------------------------- your account

-- "Delete my account and posts", for the signed-in reader only. Same name,
-- same call, same answer ({"deleted": true}) as round one, so the app needs
-- no change. Each optional table is looked up by name first, so this
-- installs and runs whether or not People, Watch or the photo queue is in
-- the project.
create or replace function public.nn_delete_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_paths text[];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  -- wait out this reader's post, report or seen-dot already in flight
  perform pg_advisory_xact_lock(hashtext('nn_post:' || u::text));
  perform pg_advisory_xact_lock(hashtext('nn_report:' || u::text));
  perform pg_advisory_xact_lock(hashtext('nn_watch:' || u::text));

  -- their posts' photos leave the gallery, and the queue row forgets the
  -- post's words and their first name (only rows a board filed)
  select coalesce(array_agg(photo_path), '{}') into v_paths
    from public.nn_posts where user_id = u and photo_path is not null;
  perform public.nn_photo_remove(p) from unnest(v_paths) p;
  if to_regclass('public.btb_photos') is not null and cardinality(v_paths) > 0 then
    execute 'update public.btb_photos set caption = '''', credit = ''''
              where storage_path = any ($1) and spot like ''All Day · %''' using v_paths;
  end if;

  -- People plan details go with their posts (named here, not left to the
  -- cascade alone), then the posts, with everyone's votes and reports on them
  if to_regclass('public.nn_people_plans') is not null then
    execute 'delete from public.nn_people_plans x using public.nn_posts p where p.id = x.post_id and p.user_id = $1' using u;
  end if;
  delete from public.nn_posts where user_id = u;

  -- the votes they cast while signed in
  delete from public.nn_votes where voter = 'u:' || u::text;

  -- their reports stop counting: each post they reported is recounted from
  -- the reports that remain since Stephen last cleared it
  delete from public.nn_reports where reporter = u;
  update public.nn_posts p set reports = (select count(*) from public.nn_reports r
     where r.post_id = p.id and (p.cleared_at is null or r.created_at > p.cleared_at))
   where p.reports > 0;

  delete from public.nn_mission_done where user_id = u;

  if to_regclass('public.nn_people_dir') is not null then
    execute 'delete from public.nn_people_dir where user_id = $1' using u;
  end if;
  -- the partner is a first name on the reader's own row, never another
  -- account, so their row is the only side there is
  if to_regclass('public.nn_watch_seen') is not null then
    execute 'delete from public.nn_watch_seen where user_id = $1' using u;
  end if;
  if to_regclass('public.nn_watch_partner') is not null then
    execute 'delete from public.nn_watch_partner where user_id = $1' using u;
  end if;

  delete from public.nn_profiles where user_id = u;
  return jsonb_build_object('deleted', true);
end $$;

-- ------------------------------------------------------- stray photo files

-- Is this picture file a stray? In the photo bucket, under submissions/,
-- more than a day old, used by no post, and either in no photo-queue row
-- (its filing failed) or in a row a board filed and marked 'removed' more
-- than a day ago (its post was deleted, never went up, or its reader
-- deleted their account; the day gives Stephen time to undo a wrong tap
-- in photo-admin.html). Rejected photos, and every photo from the gallery
-- form, keep their files as before. With no photo queue installed, nothing
-- is a stray. The storage policies from nn-ROUND2.sql ask this.
create or replace function public.nn_photo_orphan(p_name text, p_bucket text, p_created timestamptz) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare kept boolean;
begin
  if p_bucket is distinct from 'btb-photos' or coalesce(p_name, '') !~ '^submissions/[A-Za-z0-9-]+\.jpg$'
     or p_created is null or p_created > now() - interval '1 day' then return false; end if;
  if to_regclass('public.btb_photos') is null then return false; end if;
  if exists (select 1 from public.nn_posts where photo_path = p_name) then return false; end if;
  execute 'select exists (select 1 from public.btb_photos where storage_path = $1
             and not (status = ''removed'' and spot like ''All Day · %''
                      and decided_at is not null and decided_at < now() - interval ''1 day''))' into kept using p_name;
  return not coalesce(kept, true);
end $$;

-- ------------------------------------------------------------------ grants
-- Take back the default grants on both, then hand them out exactly as
-- before: the delete to every reader (it refuses not_signed_in itself),
-- the stray check to every reader because the storage policies ask it as
-- the reader calling Storage.
revoke all on function public.nn_delete_me(), public.nn_photo_orphan(text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.nn_delete_me(), public.nn_photo_orphan(text, text, timestamptz) to anon, authenticated;
