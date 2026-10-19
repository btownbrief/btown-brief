# Habits tab: decisions the notes and the brief left open (phase one)

The build notes (newsletter repo, `reference/drafts/new-nine-2026-10/habits-build-notes.md`)
are the product, and the brief beside them (`briefs/habits-tab.md`) moves it onto All Day.
These are the calls phase one had to make where neither said. Each is cheap to change.

## Rules

- **N times a week runs 1 to 6.** Seven a week is a daily habit. (`HABIT_RULES.limits`,
  `sz_habits_n_check`.)
- **A weekend tap on a weekdays habit counts.** The notes say weekends are "skipped, not
  broken"; a skipped day never breaks the run, and if you did it anyway it adds one, so the
  number still ticks up when you tap.
- **The current week of an N-a-week habit adds one only once it reaches N.** Until then it
  "counts as on target" in the sense that it does not break the run, as long as it can
  still reach N. Otherwise a habit never tapped would show a streak of 1, the same way
  today untapped does not add to a daily streak.
- **The dots.** Filled for a tap, a ring for a due day gone by without one, a faint dot for
  a day that was not due (weekends on a weekdays habit, every untapped day on an N-a-week
  habit, which has no set days) and for days still to come, and an accent ring on today.
  So an N-a-week habit never shows a "missed" ring.
- **Un-tapping a personal habit has no confirm.** The notes ask for a confirm on the goal
  habit's Done button (phase two). A personal habit toggles; it is today only, and tapping
  again puts it back.
- **Today only, both ways.** `sz_tap` and `sz_untap` refuse any date but today in
  Burlington. A tap made at 11:59:59 pm that reaches the server after midnight is refused
  and taken back on screen, with "Only today can be marked."
- **A tap waiting on the phone is dropped after midnight.** It is kept on the phone
  (`allday-habits-pending`) and re-sent until the server answers, but the server would
  refuse it as a day gone by, so at midnight it is let go.
- **Joining a season asks for a first name and a phone, and both are required; the tracker
  asks for neither** (Stephen, 2026-10-17: "can't they just not sign in and still use it?").
  Tapping Sign up, signed in, opens a "Join Season 0" sheet the first time; pods meet on a
  group chat Stephen sets up. The form says one line, "Only Stephen sees your phone number." A
  phone is 7 to 20 characters of digits, spaces, `+ ( ) - .`, with at least seven digits.
- **Signed out, it just works on the phone.** `habits-local.js` answers the tracker's doors
  with the fake's own code (so the rules are the server's), kept in `allday-habits-local`,
  versioned. It keeps 400 days of taps. The demo keeps it in memory only.
- **Signing in moves the phone's habits once.** `sz_import_local` (sz-ROUND3.sql) takes them,
  with their past taps, into an account that is still empty; the phone then forgets them.
  An account that already has habits (a second phone) gets the phone's habits added one by
  one, matched by name and how often so nothing is doubled, with today's tap. That phone's
  earlier taps and archived habits cannot come across (the app cannot tap a day gone by), so
  then the phone keeps its whole copy, seen when signed out, and remembers which habits that
  account has had so they are never sent twice. The phone only ever lets go of exactly what an
  account took. Offline, or signed out on the way, nothing is let go: it moves next visit.
- **Signing out leaves the habits on the account** and shows the phone's own list, empty.
- **The history the streak counts back over is 370 days**, one `sz_taps_get` call. A streak
  longer than a year shows as a year.
- **Archive keeps the taps**, and Undo brings the habit back at the bottom of the list.
  Archiving the goal habit is refused (`goal_habit`).
- **Reorder is "move to place k"** (`sz_habit_set(p_position => k)`); the server renumbers
  the rest, so one call per drag. The grip also answers the arrow keys.

## Round two: more to it (Stephen, 2026-10-18: "really pretty bare")

Looked at what Streaks, Habitify, Loop and Done share, and took the four that matter most
and need nothing new on the server: every number is worked out on the phone from the 370
days of taps the tab already loads (`habits-core.js`), so signed out and signed in work
the same, and no SQL changed.

- **Today on top.** "2 of 3" with a bar, and "Last 7 days 86%". A habit is one of today's
  when it is daily, a weekdays habit Monday to Friday, or an N-a-week habit whose week
  has not got its N yet; any habit tapped today is one of today's. Nothing due is
  "Rest day"; everything done is "All done today". No confetti.
- **The last seven (or thirty) days, as a percent.** Done of due. Today counts once it is
  tapped (it is not over yet), and nothing before the habit started counts. An N-a-week
  habit is due N for every seven days, rounded, and never less than its taps.
- **Best streak**, beside the streak, in a habit's sheet: the longest run the taps hold, by
  the same rules as the streak, so a year is the most it can show.
- **A month calendar per habit** in its sheet (tap the name), back a month at a time to
  the month it started or the history's start. And on Today, **the last sixteen weeks as
  a heat map**, a square a day, darker the more of that day's habits were done (an N-a-
  week habit has no set days, so only its taps count there).
- **A day before a habit started is never a missed ring.** The start is the day it was
  made, or its first tap if earlier (habits moved from a phone keep older taps). This
  changes the seven dots too: a habit added Wednesday no longer shows Monday and Tuesday
  as missed.
- **The season tile moved under the tracker.** Between seasons it changes once a season,
  and the things that change every day go on top (Stephen, the same morning, about On
  Air). When phase two puts a live goal and its Done button in the tile, it goes back on
  top, because then it is the day's main thing.
- **Not built, on purpose:** a growth picture that grows with the streak (the notes: "no
  illustrations, no badges"; the bar and the heat map are the visible progress), and
  reminders (the app has no notifications; the notes' daily email is phase two).
- **The habit sheet's title is the habit's name**; it used to say "Edit habit". Editing
  is under the numbers, under a small "Edit" heading.

## Screens and words

- **Signed out:** the tracker, one quiet line under it, "Sync across devices",
  that opens Settings' sign-in (only once there is a habit to sync). A first visit is "No habits
  yet.", Add habit and the tile. The tile's Sign up opens the sign-in too, with a toast, "Sign
  in to join a season.": the season is the one thing that needs an account.
- **Sign up, signed in:** opens the season's `stripe_link` when it has one; otherwise a
  toast, "Sign-up opens Oct 30." (from `signup_opens`) or "Sign-up opens soon."
- **Goal, Season, Wall** are chips that say "Season 0 is coming" until phase two, and
  `#habits/goal|season|wall` lands on them.
- **The meta line** is the streak ("12 days", "3 weeks"; nothing at zero), how often, and
  "Shared" when the pod can see it. No streak-break words anywhere.
- **Typeface.** The notes ask for one typeface; the tab uses Archivo for everything it
  draws, including the 24px tile line. The shell's mast wordmark and section titles stay
  Lora, as in every tab.
- **The accent** is `--habit` in `tokens.css` (a warm green, `#4F7A28` light, `#A3CF72`
  dark), used only by this tab: done dots and taps, today's ring, Sign up.
- **Habit rows are not feed cards.** The shell's swipe means save and mute, so the rows
  have their own swipe (left only, 72px commits, as the shell's) and drag; the tap target
  is a 48px circle.

## The data model

- Exactly the notes' tables with `sz_`. `users` became `sz_members` keyed by the account
  id, without an email column (the email stays in Supabase Auth). `created_at` columns were
  added where the notes had none; no other column was added or dropped.
- "Exactly one goal habit per live goal" is enforced as at most one (a unique index); the
  goal's own door in phase two makes the one.
- "Max 5 others per user" is a trigger, so it holds for dashboard edits too, and counts
  only habits that are not archived.
- A tap's `user_id` is always set from its habit by a trigger.
- Phase one also adds `sz_pod_habits` (your podmates' shared and goal habits with their
  taps) so the pod rule is enforced, and tested, from day one; the tab does not draw it
  yet. And `sz_delete_me`, which the Settings account deletion now calls.
- Goal locking at kickoff (the scheduled function and the database-level refusal) is phase
  two, as the brief says. The goal habit's words already refuse a change once its goal has
  `locked_at`.

## The Art fold

- Art's tab is gone and Habits has its slot. Community photos are not: Stephen wants them
  in the Wire as a Photo mode later, so the photo queue, the `art` board and its kinds and
  votes, `data/demo/art.json` and the boards demo's art posts all stay, and the wall's
  drawing code moved to `js/photo-wall.js`, which nothing imports yet.
- `#art`, `#art/<key>` and the older `#photos` land on the Wire until the Photo mode takes
  them.
- Art's sunset line moved into What Now's weather line, kept short:
  "6:05 sunset tomorrow, 7.4/10", the score only when it is a real one.
- Vintage's shirt sheet lost its "Vote for it on the Art wall" button; old shirt links
  still open the piece.

## Round three: a forest (Stephen, 2026-10-19)

"I want there to be visual already there for people. Basically I want people to add a habit and
then a tree or branch appears. Then as they check off the habit that day then another leaf grows."
That reverses the build notes' "no illustrations" (round two kept to it); his words win.

- **A habit is a tree** (`js/forest.js`). Its shape comes from a seed, a hash of the habit's id
  (FNV-1a, so the server can work out the same number); its size and leaves from the days it was
  done in the last 370, the window the tab already loads; its flowers from its best streak in that
  window. Those three numbers draw the same tree anywhere: Today, the habit's sheet, or someone
  else's phone in Forests. No picture is stored.
- **A leaf per day done, each in its own spot.** The shape has at least 380 leaf spots and leaf k
  always takes spot k, so a tap adds exactly one leaf, which grows in (not with reduced motion), and
  moves none of the others. The tree grows a little with every leaf, full size at 120. A day older
  than the window drops its leaf, as the streaks already drop days older than the window.
- **Flowers for the best streak, not the running one**, so a missed day never takes a flower away
  (no streak-break shaming). Days: 7, 21, 50, 100, 200, 300. Weeks (N a week): 2, 4, 8, 16, 26, 40.
- **A habit moved from the phone to an account changes shape once**: it gets a new id there. Its
  leaves, which come from its taps, stay.
- **The forest stands over the list**, right under today's numbers, so the leaf that grows is on
  screen when you tap. With no habits it is a ghost sapling. Tapping a tree opens its habit.
- **Sharing** (`sz-FOREST.sql`, Part D): public or not, any name (no `@`, so never an email),
  habit names or only the trees, which habits. Default when first opened: public, every habit,
  just the trees, the member's first name if they gave one. A public forest shows, for each shared
  habit, its seed, how often, leaves, streak and best streak, and its name only when chosen; never
  a tap date. The server works the streaks out with the same rules (`sz_forest_tree`), and
  `scripts/test-sz-forest.mjs` checks 360 random habits agree with `habits-core.js`.
- **Forests** is a chip, newest-tended first, 40 forests, 24 trees each. Stephen can hide one
  (`hidden_at`). A cohort field is kept for later; nothing shows it.
- **Before the paste** sharing hides itself (the gallery's function is missing, so the chip and
  Share are left out); the trees work regardless.
- **A first visit opens on four lines of what the page does**, with "Got it"; the "?" by the
  forest shows them again any time. **An empty Today offers three starter habits**, one tap each
  (Walk outside daily, Read the Brief 3 a week, Try a new Burlington place once a week), and **the
  season box is gone when there is no season** (three outside reviews: an empty tab gave "no
  reason to begin").
