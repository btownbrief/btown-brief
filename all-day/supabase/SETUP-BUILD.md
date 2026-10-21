# The Build: setup

Two parts. Part A (one paste, a minute) turns the tab on. Part B (the intro email) can wait until
you have made the first few introductions by hand, the way the spec wants.

## Part A: one paste

From the newsletter repo on your Mac:

    bash scripts/setup_boards.sh build

It copies `all-day/supabase/bd-SETUP.sql` and opens the Supabase SQL editor. Click in the big box,
press Cmd+V, click **Run**. It should end with "Success. No rows returned." Pasting it again
changes nothing and deletes nothing.

By hand instead: Supabase dashboard, the shared project (`jnouvwxomrcffqwilqkq`), **SQL Editor**,
**New query**, paste the whole of `all-day/supabase/bd-SETUP.sql`, **Run**.

Then `bash scripts/setup_boards.sh check` says "The Build installed: yes".

**Before the paste**, the tab still works for everyone on their own phone: their thing, shifts,
Log it, their hours (signed out, all of it lives on the phone). The building, the feed and "on
shift now" stay empty, and signed-in readers see "The Build opens soon." Their shifts and logged
hours are not lost: they wait on the phone and go up on the first visit after the paste.

## Part B: the intro email

When a neighbour taps **I can help** on a Stuck post and the poster taps **Yes**, both have said
yes. Only then does each of them get one email with the other's first name, the post, the offer,
and the other's email address (Reply-To is set to the other person). Nobody's email ever reaches
the app; only the email function reads it.

### First: by hand (no deploy needed)

Until the function is deployed, accepted offers simply wait. To see them with both addresses,
run this in the SQL editor (it runs as you, the owner, so it can read emails; the app never can):

    select h.id, h.decided_at, p.line as stuck_post, h.line as offer,
           pb.first_name as poster, pu.email as poster_email,
           hb.first_name as helper, hu.email as helper_email
      from bd_help h
      join bd_posts p on p.id = h.post_id
      join auth.users pu on pu.id = p.user_id
      join auth.users hu on hu.id = h.helper_id
      left join bd_builder pb on pb.user_id = p.user_id
      left join bd_builder hb on hb.user_id = h.helper_id
     where h.status = 'accepted' and h.intro_sent_at is null
     order by h.decided_at;

After you have introduced a pair yourself, mark it so the function never sends it again:

    update bd_help set intro_sent_at = now() where id = '<the id from the list>';

### Then: switch on the automatic email

From the btown-brief repo root, with the Supabase CLI logged in:

    supabase functions deploy bd-intro --no-verify-jwt --project-ref jnouvwxomrcffqwilqkq
    supabase secrets set BD_INTRO_FROM="The Build <hello@btownbrief.com>" --project-ref jnouvwxomrcffqwilqkq

`RESEND_API_KEY` is already on the project (Who's Playing and Up For It use it), so nothing else
is needed. Optional, to get a blind copy of every intro while the pilot runs:

    supabase secrets set BD_INTRO_BCC="your@address" --project-ref jnouvwxomrcffqwilqkq

Check it (K is the publishable key in `all-day/js/store.js`):

    curl -s -X POST https://jnouvwxomrcffqwilqkq.supabase.co/functions/v1/bd-intro \
      -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{}'

Expect `{"sent":false,"intros":0,"skipped":0}` when nothing is waiting. Called with `{}` it sends
every accepted offer from the last 14 days that has not had its email, so mark the ones you did
by hand first. The app calls it with one offer's id right after each Yes. It sends each pair once,
ever, and never for a hidden post or two people who have blocked each other.

## Looking after it

- **Hide a post:** Table Editor, `bd_posts`, set `hidden_at` to now. Two readers' reports do the
  same on their own. To put one back, clear `hidden_at` and set `reports` to 0.
- **Reports** (on posts and on offers) are in `bd_reports`, with the reason.
- **Banned from the boards** (`nn_bans`) means banned from posting here too.
- **Tune the building:** `all-day/data/build-config.json` holds the hours per floor (25 to start),
  the floors (6 plus the roof), the pallet a habit tap is worth (5 minutes), and the season: its
  start date (the town counts hours from then), the topping-out date and the party link. Edit it
  and push; no SQL needed. `node scripts/test-build-core.mjs` checks it matches the code's copy.

## What it holds, and who sees what

- **Your thing, your hours, your step and note, your shelf:** you alone.
- **The building:** everyone, as totals: the season's hours, this week's, pallets from habit taps,
  lit windows from posts, and who is on shift right now as a builder with a hat, a vest and the job
  they're on. A first name shows over a builder only if they turn it on. Each shift gets a fresh
  random id, so nobody can follow a builder from one shift to the next.
- **Posts:** everyone sees what was posted, with the poster's first name. Hours on a post only if
  they added them.
- **The starter door:** a neighbour's thing shows only once they've posted about it; its "why"
  only if they turn that on for the thing; their name only if their builder shows it.
- **Never sent to anyone:** an email (except in the one intro, after both say yes), an account id,
  a heartbeat, or when a shift started and ended.
- **Delete my account and posts** in Settings removes all of it (once the tab registers with it).

## Not for the live project

`scripts/test-bd-sql.sh` builds a scratch local database to test the paste. Never point it at
Supabase.
