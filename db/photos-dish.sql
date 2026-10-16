-- The Weekly Bite: let the photo queue take a `dish`.
--
-- The All Day Food tab's "Feature a dish" form sends its photos through the
-- same queue as every other reader photo (btb_photos_submit, the consent
-- box, the 5-pending limit, photo-admin.html), with category 'dish'. The
-- table's CHECK did not know that category, so until this runs every dish
-- submission is refused with a constraint error and the form says so.
--
-- Run once: Supabase dashboard → the shared project → SQL Editor → paste →
-- Run. Safe to run twice. Nothing else changes: approval, voting and the
-- getters are category-blind.

alter table btb_photos drop constraint if exists btb_photos_category_check;
alter table btb_photos add constraint btb_photos_category_check check (category in
  ('sunsets','pets','gardens','food','wildlife','street','events','other','dish'));
