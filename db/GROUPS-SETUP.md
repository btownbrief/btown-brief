# Clubs & groups: turning on "Add your group" (about 3 minutes)

The Clubs & groups page (`clubs.html`) works without this. Until it is done, the form at the
bottom answers "That didn't go through... email BtownBrief@gmail.com", and nothing readers send
is saved. After it, what they send waits in your queue, and anything you approve shows on the
page right away.

Project: the shared one, **jnouvwxomrcffqwilqkq**. It needs the All Day boards setup
(`all-day/supabase/nn-SETUP.sql`, part B of `SETUP-STEPHEN.md`) already in, because it uses the
same moderator passphrase as the boards desk (part C).

## 1. Install it

1. Sign in at https://supabase.com/dashboard and open the shared project.
2. In the left sidebar, click **SQL Editor**, then **New query**.
3. Open **`db/groups-submit.sql`** from the repo, copy the **whole** file, paste it in.
4. Click **Run**. It should end with "Success. No rows returned."

It is safe to run again later. It only adds its own table and functions (all named `groups_`)
and never deletes a submission.

## 2. Try it

1. Open https://guide.btownbrief.com/clubs.html#add and send a test group with your own email.
   It should say "Thanks! It's in my queue."
2. Open https://guide.btownbrief.com/groups-mod.html and type the boards desk passphrase.
   Your test is under **Waiting**, with the email and note.
3. Click **Approve**, reload clubs.html, and it shows under its kind, marked "Added by a reader".
   Then click **Delete (spam)** on the desk to take the test down.

## What the buttons do

- **Approve**: it shows on clubs.html at once, as plain text with the reader's link. Open their
  link first. The email and the note are never shown to anyone but you.
- **Reject**: it stays off the page. Rejected ones clear themselves after 90 days.
- **Back to waiting**: undo either of the above.
- **Delete (spam)**: gone for good.

If a submission is a real group worth a full entry (a weekly time, a cost, a "how to join"),
add it to `data/groups.json` the usual way, checked on its own page, and then reject or delete
the reader copy so it isn't listed twice.

## Limits, in plain words

- One device can send 3 a day, one network address 6 a day, everyone together 30 an hour, and
  at most 200 can wait at once. Repeats of something already waiting are accepted quietly and
  not stored twice.
- Links can only go in the Link box, and only `http(s)://` links are accepted. Text with `<` or
  `>` is refused, and everything is shown as plain text anyway.
- These stop casual spam, not a determined script; nothing shows until you approve it, so the
  worst case is a messy queue. Delete is the fix.
