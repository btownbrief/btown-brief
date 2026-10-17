-- All Day boards: let the photo queue take a `board` photo, and keep those
-- out of the community gallery.
--
-- Project jnouvwxomrcffqwilqkq. Touches only the reader photo queue from
-- db/photos.sql (btb_ prefix); the boards themselves are in
-- all-day/supabase/nn-SETUP.sql (nn_ prefix).
--
-- A photo on a board post goes through the same queue as every reader photo
-- (btb_photos_submit, the consent box, the 5-pending limit, photo-admin.html).
-- Art's photos are filed as 'other' and join the gallery, which is what the
-- Art wall replaces. A Vintage find photographed on a rack is not a
-- community photo, so boards file it as category 'board', and the two
-- gallery readers (btb_photos_get, btb_photos_potw, which also feed the
-- static manifest scripts/export_photos.py writes) leave 'board' out. The
-- board post still shows its photo once it is approved: nn_ reads the queue
-- directly.
--
-- Run once: Supabase dashboard -> the shared project -> SQL Editor -> paste
-- -> Run. Safe to run twice. Until it runs, a Vintage post with a photo is
-- refused (the category CHECK does not know 'board') and the compose sheet
-- says "That photo didn't go through"; Vintage posts without a photo, and
-- every Art post, work as before.

alter table btb_photos drop constraint if exists btb_photos_category_check;
alter table btb_photos add constraint btb_photos_category_check check (category in
  ('sunsets','pets','gardens','food','wildlife','street','events','other','dish','board'));

-- Gallery: every approved photo with its vote count, newest first, except
-- board photos.
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
  where p.status = 'approved' and p.category <> 'board'
  group by p.id
  order by p.decided_at desc nulls last, p.created_at desc;
$$;
grant execute on function btb_photos_get() to anon;

-- Photo of the week, as before, never a board photo.
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
    where p.status = 'approved' and p.decided_at is not null and p.category <> 'board'
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
