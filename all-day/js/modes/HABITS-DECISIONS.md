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
- **The first sign-in asks for both a first name and a phone, and both are required.**
  The notes say it asks for both; pods meet on a group chat Stephen sets up. The form says
  one line, "Only Stephen sees your phone number." A phone is 7 to 20 characters of digits,
  spaces, `+ ( ) - .`, with at least seven digits.
- **The history the streak counts back over is 370 days**, one `sz_taps_get` call. A streak
  longer than a year shows as a year.
- **Archive keeps the taps**, and Undo brings the habit back at the bottom of the list.
  Archiving the goal habit is refused (`goal_habit`).
- **Reorder is "move to place k"** (`sz_habit_set(p_position => k)`); the server renumbers
  the rest, so one call per drag. The grip also answers the arrow keys.

## Screens and words

- **Signed out:** the tile and a Sign in button that opens Settings' sign-in, nothing
  else. The tile's own Sign up button also opens the sign-in when signed out.
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
