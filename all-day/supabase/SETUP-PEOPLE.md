# The People tab: what Stephen does in Supabase

One short job, about two minutes, done **after** part B of `SETUP-STEPHEN.md` (pasting
`nn-SETUP.sql`). Until it is done the People tab still works: plans post and people can say
they'd go. Only the directory and two small things on a plan wait for it.

Project: the shared one, **jnouvwxomrcffqwilqkq**.

## Install the People pieces (2 minutes)

1. Sign in at https://supabase.com/dashboard and open the shared project.
2. In the left sidebar, click **SQL Editor**.
3. Click **New query** (the **+** at the top of the list).
4. Open `all-day/supabase/nn-people.sql` from the repo, copy the **whole** file, and paste it in.
5. Click **Run** (bottom right). It should end with "Success. No rows returned."
6. It is safe to run again later: it only adds or replaces its own pieces and never deletes
   anyone's directory entry or plan.

## What it turns on

- **The directory.** Signed-in readers can choose to be listed: first name, neighborhood, who
  they are here as, and what they're into. Never an email. A reader sees the list once they are
  in it themselves; everyone sees how many are in it. Leaving takes them out at once, and
  "Delete my account and posts" takes them out too.
- **Two things a plan can say:** a rough age band for the group ("Mostly 30s", "Any age") and
  "I'm down to put this on Meetup". Plans that ticked the Meetup box show "Down for Meetup" on
  the card, and the tab has a "Down for Meetup" chip that lists just those.
- **Your list of Meetup hosts**, behind the boards desk passphrase (part C of
  `SETUP-STEPHEN.md`): the function `nn_people_meetup_list` returns every live plan whose host
  ticked the box, with their first name, the time and place, and how many said they'd go. It
  is not on the desk page yet; see the pull request for that request.

**Before this is done**, readers see: in the directory, "The directory opens soon.
Everything else here works."; and after posting a plan with the Meetup box or an age band
ticked, "Posted. The Meetup box and age band didn't save" (the plan itself is up).

## Nothing to set up for the mixers

The Mixers section reads your Meetup group two ways: the events calendar the site already
builds, and Up For It's copy of your Meetup calendar (refreshed every six hours). Both are
already running.
