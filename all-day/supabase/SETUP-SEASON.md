# The season (Body · Today · Season): one paste

The season screen in the Body app needs one paste in Supabase. Until then it shows the next season's countdown (from what the habit tracker already reads) and a Sign in button, and nothing breaks.

1. Supabase dashboard, the shared project (`jnouvwxomrcffqwilqkq`), then SQL Editor, then New query.
2. Make sure `sz-SETUP.sql` was pasted once already (the habit tracker needs it too).
3. Paste the whole of `all-day/supabase/sz-SEASON.sql` and press Run. Running it again later is safe.
4. Check it: `select public.sz_season_get('burlington');` returns the season (or null if there is none yet).

## Running a season from the dashboard

Everything below is a row you add or edit in the Table Editor. The app never asks you for any of it.

- **A season**: a row in `sz_seasons` (name, `kickoff_at`, `midway_at`, `party_at`, `status` = `open` while people sign up, `live` from kickoff, `done` after the party; a Stripe link if people pay).
- **Its events**: three rows in `sz_events` (`kickoff`, `midway`, `party`) with the time, the venue and the Luma link.
- **Pods**: rows in `sz_pods` (category, meets-on, the WhatsApp link); put a member in a pod by setting `pod_id` on their `sz_members` row.
- **Paid**: tick `paid` on their `sz_goals` row.
- **Who came**: a row in `sz_attendance` for each person at each event. It counts toward their show-up rate.

At kickoff a goal locks by itself: from `kickoff_at` on, the app can't change a goal's words or its goal habit. You still can, from the dashboard.
