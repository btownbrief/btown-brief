# Habits tab: the pastes

Two pastes, a few minutes in all, each safe to run again. Part A sets the tab up; Part B lifts the
habit limit. Already did Part A? Do Part B only.

## Part A: set up Habits (one paste)

1. Open the Supabase dashboard and pick the shared project (`jnouvwxomrcffqwilqkq`).
2. Click **SQL Editor** in the left bar, then **New query**.
3. Open `all-day/supabase/sz-SETUP.sql` from this repository, copy the **whole** file, and
   paste it into the query box.
4. Click **Run**. It should finish with "Success. No rows returned."

That is all. Pasting it a second time changes nothing and deletes nothing: every table is
"create if not exists" and every function is "create or replace".

## What readers see before you paste it

The Habits tab works either way, it just has less to do:

- Everyone sees the season tile, reading "No season scheduled yet".
- Signed-out readers also see a Sign in button.
- Signed-in readers see the tile and one line, "Habits open soon." Nothing they tap is lost
  or half-saved, because nothing can be saved yet.

## What readers see after

- The tile still reads "No season scheduled yet" until a season exists (see below).
- A signed-in reader is asked a first name and a phone once, then gets the tracker: as many
  habits as they keep, a tap a day, the streak and this week's seven dots.

## Part B: lift the habit limit (one paste)

For a project that already has Part A. About a minute.

1. Supabase dashboard, the shared project (`jnouvwxomrcffqwilqkq`), **SQL Editor**, **New query**.
2. Open `all-day/supabase/sz-ROUND2.sql` from this repository, copy the **whole** file, paste it in.
3. Click **Run**. It should finish with "Success. No rows returned."

It replaces one function, `sz_rules()`, and changes nothing else; no row is touched. Readers can
then keep as many habits as they like. The only ceiling left is 100 habits a person, there so a
script cannot make millions; the app never mentions it, and someone who did reach it would read
"That's a lot of habits. Archive a few first."

A fresh project needs only Part A: `sz-SETUP.sql` already carries the same rules. If `sz-SETUP.sql`
is ever pasted again on the live project, nothing goes back; it has the same rules too.

## Putting a season on the tile

Until the Season desk arrives in phase two, add a season in the dashboard: **Table Editor**,
table `sz_seasons`, **Insert row**. Fill in `name` (for example "Season 0"), `kickoff_at`
(the kickoff date and time), `party_at`, and set `status` to `open` (or `upcoming` if
sign-up is not open yet). `stripe_link` is the sign-up payment link, if there is one;
leave it empty and the Sign up button says when sign-up opens (`signup_opens`). The tile
then reads "Next season starts in N days", counted in Burlington days.

## Not for the live project

`scripts/sz-seed.sql` makes twelve pretend members for the local test
(`bash scripts/test-sz-sql.sh`). Never paste it into Supabase.

## What it holds, and who can see what

Every table the build notes list, with the `sz_` prefix: members (first name, phone, city,
pod, email opt-out), seasons, pods, goals, milestones, habits, taps, reviews, events,
attendance and wall cards. No one can read a table directly; the app goes through
functions that enforce the privacy rules:

- your habits and taps are yours alone;
- a habit you share is seen by your pod only, never anyone else;
- your phone number is never sent to anyone but you (Stephen sees it in the dashboard);
- "Delete my account and posts" in Settings now also deletes your habits and taps.
