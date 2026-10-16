# All Day accounts and boards: what Stephen does in Supabase

Three short jobs in the Supabase dashboard, about ten minutes in all. Do them in order. Until
each one is done, All Day keeps working and says so plainly; nothing breaks.

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

**Before part B is done**, signed-in readers see:

- In Settings, under Your account: "Signed in · Posting is coming soon."
- Wherever a tab offers to post: "Posting is coming soon. Everything else here works."
- What Now's Mark done keeps working on the phone; it just does not sync yet.

Reading every tab, saving, muting and voting on the Wire all work as before.

## C. Set the moderator passphrase (2 minutes)

The passphrase opens `https://guide.btownbrief.com/all-day/mod.html`, the boards desk, where you
approve, hide, delete or ban. Photos on board posts are checked where every reader photo is, in
the photo desk (`photo-admin.html`), so a board post's picture shows once you approve it there.

1. Pick a long passphrase (your password manager's "generate" is perfect) and save it there.
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

## What readers see, step by step

| State | Settings, Your account | Posting | Voting on a board post |
|---|---|---|---|
| Today (email on, nothing else) | Email field and "Send link" | "Posting is coming soon." | Shows no boards yet |
| After A | Same; the link now lands in All Day | "Posting is coming soon." | Shows no boards yet |
| After A and B | "Signed in as Maya" (or "Add your first name before you post"), Your profile, Your posts, Sign out, Delete my account and posts | Works; a reader names themselves once | Works signed in or out |
| After C | Same | Same | Same; reported posts wait for you on the desk |

"Delete my account and posts" removes the reader's profile, posts, votes, reports and missions,
and signs them out. It does not delete their email sign-in, because that sign-in is shared with
Small Talk and the other apps; if someone asks for that too, delete them under **Authentication**,
then **Users**, the **⋯** on their row, **Delete user**.
