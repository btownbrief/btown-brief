# The eight apps' boards: one paste (2026-10-29)

1. Open the Supabase dashboard for project `jnouvwxomrcffqwilqkq`, then SQL Editor, then New query.
2. Paste the whole of `all-day/supabase/nn-APPS.sql` and press Run. It should say "Success. No rows returned".
3. Check it took: run `select jsonb_object_keys(public.nn_rules() -> 'boards');` and look for `nightlife`, `sports`, `stage`, `neighbors`, `shifts`, `clubs`, `streets` and `rescue` in the list.

It changes one function and nothing else; running it twice is fine. Nothing in the apps posts to these boards yet.
