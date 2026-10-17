# All Day accounts and boards: what Stephen does in Supabase

Four short jobs in the Supabase dashboard, about fifteen minutes in all. Do them in order. Until
each one is done, All Day keeps working and says so plainly; nothing breaks. Parts A to C are
done (October 2026); part D is the new one.

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

**If you ever paste `nn-SETUP.sql` again**, paste `nn-ROUND2.sql` right after it. `nn-SETUP.sql`
on its own puts back the round-one rules (and posting a Vintage design or a Meetup plan would be
refused until round two goes back on).

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

"Delete my account and posts" removes the reader's profile, posts, votes, reports and missions,
and signs them out. It does not delete their email sign-in, because that sign-in is shared with
Small Talk and the other apps; if someone asks for that too, delete them under **Authentication**,
then **Users**, the **⋯** on their row, **Delete user**.
