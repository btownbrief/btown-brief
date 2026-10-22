# All Day accounts and boards: what Stephen does in Supabase

Six short jobs in the Supabase dashboard, about twenty-one minutes in all. Do them in order. Until
each one is done, All Day keeps working and says so plainly; nothing breaks. Parts A to D are
done (October 2026); parts E and F are the new ones.

Project: the shared one, **jnouvwxomrcffqwilqkq** (the same project Small Talk, Who's Playing,
the games and the photo queue use). Sign in at https://supabase.com/dashboard and open it.

## What is already true (checked 2026-10-16)

- **Email sign-in is already on** for the project, and it sends through Resend, so magic links
  reach anyone (Small Talk's setup turned both on). New sign-ups are allowed.
- **"Confirm email" is on.** That is fine for All Day: a brand-new reader's first email says
  "Confirm your signup" instead of "Magic link", and tapping it signs them in exactly the same
  way. Every later email is the plain magic link. Leave it on; Small Talk and the other apps
  share this switch.
- **The Site URL belongs to Small Talk.** Do not change it. All Day sends every sign-in link with
  its own return address, and Supabase honors that address once it is on the allow-list (part A).
  Changing the Site URL would change where Small Talk's emails land.
- **The boards are not installed yet** (part B), and the moderator passphrase is not set (part C).

## A. Let sign-in links come back to All Day (2 minutes)

1. In the left sidebar, click **Authentication**.
2. Under **Configuration**, click **URL Configuration**.
3. Leave **Site URL** as it is.
4. Under **Redirect URLs**, click **Add URL**, type `https://guide.btownbrief.com/all-day/` and
   click **Save URLs**.
5. Click **Add URL** again, type `http://localhost:*/**` and click **Save URLs**; then once more
   with `http://127.0.0.1:*/**`. These let a test copy on a laptop receive its link. (Small Talk
   may already have added the localhost one; skip any that are already in the list.)
6. Optional check: under **Configuration**, click **Sign In / Providers**, then **Email**. "Enable
   Email provider" should be on. Do not change anything else on that screen.

All Day never offers a password: the only way in is the emailed link. There is no separate
"no password" switch in Supabase; the Email provider covers both, and All Day simply never asks.

**Before part A is done:** a reader who asks for a link from All Day gets the email, but the
link opens Small Talk instead of All Day (Supabase sends unknown return addresses to the Site
URL). So do part A before the New Nine goes live.

## B. Install the boards (3 minutes)

1. In the left sidebar, click **SQL Editor**.
2. Click **New query** (the **+** at the top of the list).
3. Open `all-day/supabase/nn-SETUP.sql` from the repo, copy the **whole** file, and paste it in.
4. Click **Run** (bottom right). It should end with "Success. No rows returned."
5. It is safe to run again later: it only adds or replaces its own pieces and never deletes a
   reader's posts.

This also installs What Now's two mission functions (`nn_mission_set`, `nn_missions_done`), so a
signed-in reader's "Mark done" starts following them across devices.

6. Click **New query** again, open `db/photos-board.sql` from the repo, paste the whole file, and
   click **Run**. It should also end with "Success. No rows returned." This one teaches the reader
   photo queue a new kind of photo, `board`, and keeps those out of the community gallery
   (photos.html) and out of photo of the week. Vintage finds are filed that way: you still
   approve them in the photo desk, and they show on their Vintage post, but not in the gallery.
   Art photos join the gallery as before, since the Art wall is where the gallery is moving.

Before step 6 is done, a Vintage post **with a photo** is refused ("That photo didn't go through.
Try another one."); Vintage posts without a photo, and every Art post, work.

**Before part B is done**, signed-in readers see:

- In Settings, under Your account: "Signed in · Posting is coming soon."
- Wherever a tab offers to post: "Posting is coming soon. Everything else here works."
- What Now's Mark done keeps working on the phone; it just does not sync yet.

Reading every tab, saving, muting and voting on the Wire all work as before.

## C. Set the moderator passphrase (2 minutes)

The passphrase opens `https://guide.btownbrief.com/all-day/mod.html`, the boards desk, where you
approve, hide, delete or ban. Photos on board posts are checked where every reader photo is, in
the photo desk (`photo-admin.html`), so a board post's picture shows once you approve it there.

1. Have your password manager **generate** the passphrase (20 or more random characters) and save
   it there. Don't make one up. The desk shuts for everyone for 15 minutes after 20 wrong tries,
   and anyone can make those tries, so a stranger could keep the desk shut for a while by guessing
   badly on purpose; what they can't do is guess a generated passphrase. That trade is the same
   one Who's Playing and Up For It make.
2. In **SQL Editor**, click **New query**.
3. Paste this one line, put your passphrase between the single quotes in place of
   `YOUR-PASSPHRASE`, and click **Run**:

   ```sql
   insert into public.nn_mod (id, pass_hash) values (true, extensions.crypt('YOUR-PASSPHRASE', extensions.gen_salt('bf', 12))) on conflict (id) do update set pass_hash = excluded.pass_hash;
   ```

4. It should say "Success. No rows returned." Only a scrambled version (a bcrypt hash) is kept.
   To change the passphrase later, run the same line with the new one.
5. Delete the query from the SQL Editor list afterwards (the **⋯** next to it, then **Delete
   query**), so the passphrase is not left sitting in your saved snippets.

**Before part C is done:** the boards desk answers every passphrase with "That passphrase
didn't open it." Posts still go up, and two reports still take a post down; it simply waits for
you until the desk opens. Twenty wrong tries in 15 minutes shut the desk for everyone, you
included, until they age out.

## D. Round two of the boards (3 minutes)

This adds what the People, Vintage, Art and Watch tabs asked for after they were built. It is
one file, pasted once, and it only adds: no reader's post, vote or profile is touched.

1. In the left sidebar, click **SQL Editor**.
2. Click **New query** (the **+** at the top of the list).
3. Open `all-day/supabase/nn-ROUND2.sql` from the repo, copy the **whole** file, and paste it in.
4. Click **Run** (bottom right). It should end with "Success. No rows returned."
5. It is safe to run again later.

If the result also shows a line that starts **"nn-ROUND2: the two stray-photo policies were not
added"**, everything else still installed. That line means this project would not let the SQL
Editor give the photo bucket its two cleanup rules. Nothing is broken; stray picture files just
stay in the bucket, and the boards desk will say "stray picture files are waiting". Tell Claude
and it will walk you through adding the two rules in the Storage screen instead.

**If you ever paste `nn-SETUP.sql` again**, paste `nn-ROUND2.sql`, `nn-ROUND3.sql` and then
`nn-ROUND4.sql` right after it. `nn-SETUP.sql` on its own puts back the round-one rules (and posting a Vintage design or
a Meetup plan would be refused until round two goes back on).

What it turns on, tab by tab:

- **Vintage.** A design sent in for a tee and a fit check are now their own kinds of post (before,
  they were finds tagged "Make a tee" and "Fit check"; those still show until they end). "Someone
  got it" now ticks the find as gone instead of deleting it, so the thank-you line counts
  everyone's finds, not one phone's.
- **People.** A plan's "down to put it on Meetup" box and its rough age band are now part of the
  plan itself. Plans posted before keep theirs and still show them.
- **Art.** A week's photo of the week is now settled at Sunday midnight: votes cast after that no
  longer change who won.
- **Watch.** Ratings and picks remember the film's TMDB number, not just its title, and the
  screening ballot allows one vote per reader on the server (before, only the phone kept to it).
- **Profiles.** Settings → Your profile gains "What you're into" (running, games, live music and
  the rest of the People tab's list; never who someone is). Nobody sees it; the People tab uses it
  to suggest plans and clubs.
- **The boards desk** (`mod.html`) gains a **Show the Meetup list** button: every live plan whose
  host is down for Meetup, with the time, place, spots, age band, host's first name and how many
  are going, and a "Copy for Meetup" button for each. Opening the desk also cleans up stray
  photos: a board photo whose post never went up leaves the photo queue after a day, and a picture
  file that never made it into the queue at all is removed from the bucket. The desk says what it
  cleared.

**Before part D is done:** everything above keeps working the round-one way. Designs and fit
checks post as tagged finds, "Someone got it" takes the find down, a Meetup plan's box goes to the
People table, Art's past winners can still shift, the profile sheet saves everything but "What
you're into", and the desk's Meetup button lists the plans that saved their box in the People
table (which is every one, until part D).

## E. Make "Delete my account" delete everything (3 minutes)

One paste. It replaces the delete button's work on the server so it clears everything a reader
left in All Day. It removes nothing by itself: only a reader pressing "Delete my account and
posts" removes anything, and only their own.

1. In the left sidebar, click **SQL Editor**.
2. Click **New query** (the **+** at the top of the list).
3. Open `all-day/supabase/nn-ROUND3.sql` from the repo, copy the **whole** file, and paste it in.
4. Click **Run** (bottom right). It should end with "Success. No rows returned."
5. It is safe to run again later.

What changes:

- **Watch.** A deleted reader's seen-dots and their partner's first name now go too (before,
  they stayed on the server). The phone they deleted from forgets them as well. Another reader whose partner shares the deleted reader's name
  keeps theirs: the partner is only a name someone typed, never a link to another account.
- **People.** Their place in the People directory and their plans' Meetup details go, as before,
  and are now named in the delete itself rather than left to the database's tidy-up rules.
- **Photos.** Their board photos leave the gallery, as before, and the photo queue row also
  forgets the post's words and their first name. A day later the picture file itself counts as
  a stray, so the next time you open the boards desk it is cleared from the bucket. The day is
  your window to undo it in `photo-admin.html` if a photo was removed by mistake. This also
  applies to any board photo whose reader deleted the post, or whose post never went up (a post
  you delete from the desk keeps its photo file, as before). Gallery photos and photos
  you rejected keep their files exactly as before.
- **What stays.** Their email sign-in (shared with Small Talk and the other apps) and, if you
  banned them, the ban, so deleting an account is never a way around one.

**Before part E is done:** the delete clears the profile, posts, votes, reports, missions and
People rows, but a reader's Watch dots and partner name stay on the server. The Watch tab asks
the server to forget them right after the delete, but that is best effort; part E makes it certain.
A deleted reader's photo files stay in the bucket, out of sight.

## F. Handles, and the Games, Square and Gatherings boards (3 minutes)

One paste. It only adds: no reader's post, vote or profile is changed by pasting it.

1. In the left sidebar, click **SQL Editor**.
2. Click **New query** (the **+** at the top of the list).
3. Open `all-day/supabase/nn-ROUND4.sql` from the repo, copy the **whole** file, and paste it in.
4. Click **Run** (bottom right). It should end with "Success. No rows returned."
5. It is safe to run again later. If you ever paste `nn-ROUND2.sql` again on its own, paste this one
   after it, since round two's file carries the older rules.

What it turns on:

- **Handles.** Settings → Your profile gains a **Handles** section: a box each for Instagram,
  Spotify, Letterboxd, Goodreads, Beli, Untappd and LinkedIn (Social), Strava (Fitness), and
  PlayStation, Xbox, Steam, Switch, Discord, Epic, Riot and chess.com or lichess (Games), plus a
  **Show my handles in the directory** switch. Each box takes only that service's name shape: no
  links, no @ (the sheet drops a typed @ for them), a Switch friend code as SW-1234-5678-9012.
  The server checks them again, because the app's key is public.
- **Who sees handles.** Only the handles of readers who turned the switch on, and only to readers
  who are signed in. Switch off, nobody sees them, People directory or not. They come with a first
  name, a neighborhood and the day the profile was last saved (never the time), and never with an
  email. "Delete my account" already takes them, since they live on the profile.
- **Games.** "What I'm playing" (a game and a platform; two weeks) and "looking for a group"
  (the game, the platform and when; one week). A vote means "me too".
- **The Square.** A community board: posts (30 days), show and tell (photo needed, 30 days),
  questions (two weeks), free stuff (two weeks) and pets (photo needed, 30 days). Photos go
  through the photo desk like every other board photo.
- **Gatherings.** Events readers send in: when, where, what sort (pickup, league, board games, a
  run, social, music, other) and an optional link. **Every one waits for you on the boards desk**
  (`mod.html`, under Waiting) and shows only once you approve it; an edit to the date sends it back
  to you. It comes down the day after its date, and a date in the past or more than six months out
  is refused, as is a date that isn't on the calendar. This is the only place a reader can put a
  link, which is why you see each one first.

The tabs that use these come in their own updates; until then nothing on screen changes except the
Handles section.

**Before part F is done:** the Handles section still shows, but saving says "Your handles save
once the boards' next update is in." (the rest of the profile saves), and the new boards stay
closed.

## G. The No-algorithm challenge's feedback (2 minutes)

One paste, from the newsletter repo: `bash scripts/setup_boards.sh challenge` copies
`all-day/supabase/nn-CHALLENGE.sql` and opens the SQL editor. Click in the big box, press Cmd+V,
click **Run**. It should end with "Success. No rows returned." Safe to run again.

What it turns on: the challenge's **Send** button. Each phone that sends the form leaves one row
in `nn_challenge_feedback` (what they missed, what would make them switch, which kind of person
they are, how far into the five days they got and how each day felt). No name, email or account
goes with it, and nobody but you can read it: the table has row level security with no policies,
so the app's public key can only add a phone's own answers.

**Reading the answers:** the boards desk (`mod.html`) has a **No-algorithm challenge** section;
**Show the feedback** gives the tallies and every answer, newest first. Or open Supabase's
**Table Editor → nn_challenge_feedback**.

**Before part G is done:** everything in the challenge works on the phone (joining, the daily
check-in, the roundup); only Send says "Couldn’t send it just now. Your answers are kept here, so
try again later." and keeps what they wrote, so a reader can send it once you have pasted.

## One trade-off to know about: the saved sign-in

When a reader signs in, All Day keeps a **refresh token** in the browser so they stay signed in for
weeks without another email. It is a long random string, not their email or password. Anything
running inside the All Day page can read it, and two outside scripts do run there: GoatCounter
(the visit counter) and the Meta Pixel (Facebook's ad tracker). In plain words: if either company
ever served bad code, or someone broke into them, that code could copy the token and use it to act
as that reader on the boards (post, vote, report, delete their posts) until the reader signs out
or the token expires. It could not read their email from it, and it could not touch their inbox.

This is how the standard Supabase sign-in library works on every website too; the only way around
it is a small server of our own holding the token in a cookie scripts can't read, which All Day
doesn't have. The cheaper fix, if this ever worries you, is taking the Meta Pixel off the All Day
page (GoatCounter is a small, privacy-focused counter and the lower risk). Nothing to do today.

## What readers see, step by step

| State | Settings, Your account | Posting | Voting on a board post |
|---|---|---|---|
| Today (email on, nothing else) | Email field and "Send link" | "Posting is coming soon." | Shows no boards yet |
| After A | Same; the link now lands in All Day | "Posting is coming soon." | Shows no boards yet |
| After A and B | "Signed in as Maya" (or "Add your first name before you post"), Your profile, Your posts, Sign out, Delete my account and posts | Works; a reader names themselves once | Works signed in or out |
| After C | Same | Same | Same; reported posts wait for you on the desk |
| After D | Your profile also has "What you're into" | Designs, fit checks and Meetup plans post as their own kinds | One vote each on the Watch screening ballot |
| After E | "Delete my account and posts" also clears Watch dots and the partner's name | Same | Same |
| After F | Your profile also has Handles and the "show my handles" switch | Games, the Square and Gatherings open; gatherings wait for you | Same |

"Delete my account and posts" removes the reader's profile, posts, votes, reports, missions, People
directory listing and (after part E) Watch dots and partner name, takes their photos out of the
gallery, and signs them out. It does not delete their email sign-in, because that sign-in is shared with
Small Talk and the other apps; if someone asks for that too, delete them under **Authentication**,
then **Users**, the **⋯** on their row, **Delete user**.
