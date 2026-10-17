# All Day: the New Nine cutover

What happens when `new-nine` is merged into `main`, what to check afterwards, and how to undo
it. Written 2026-10-16 for Stephen. Nothing here needs a terminal.

## The one step

On GitHub, open a pull request from `new-nine` into `main` (or open the one Fable prepared),
read the summary, and click **Merge**. That is the cutover. GitHub Pages rebuilds the site in a
minute or two.

## What changes the moment it is on main

**Readers.** guide.btownbrief.com/all-day/ becomes the new app: nine tabs (Wire, Watch, Food,
People, What Now, Vintage, Art, On Air, Games). Phones that already have All Day saved pick up
the new version the next time they open it, because the app always asks the network first and
only falls back to its saved copy offline. Old links still work and land on the nearest new
tab: `#reddit` opens the Wire on its Reddit chip, `#ig` the Wire, `#music` What Now's Tonight,
`#wander` What Now, `#photos` Art, `#listen` and old Btown TV video links On Air. The site's
"Playlist" links now say "Live music" and open What Now's Tonight: the community mixtape went
with the old Music tab.

**Schedules start.** GitHub only runs a workflow's timer from the default branch, so these
begin on their own once the merge lands (times are Burlington time):

| Job (Actions tab name) | When | What it does | Where it writes |
|---|---|---|---|
| Curate the Wire | every hour at :07 | tags new items, ranks up to 25 picks (the page leads with ten local ones), writes the day's paper | the `wire-data` branch |
| The Brief, out loud | 7 am every day | Opus writes a three-minute script from the Wire's local picks; ElevenLabs reads it | the `wire-audio` branch |
| Refresh games catalog | 6:35 am every day (5:35 am in winter) | the arcade's list of games for the Games tab | `data/games-catalog.json` on main |
| Refresh the Watch tab's films | Mondays, 6:20 am (5:20 am in winter) | the Watch tab's film list from TMDB | the `films-data` branch |
| Refresh Reddit intake | every hour at :41 | the Reddit bridge for when Reddit's RSS ends on Nov 13 | the `reddit-data` branch |

The Pulse refresh (already running) starts reading the X and Facebook inbox, because the
`WIRE_INBOX_TOKEN` secret now exists. The **Wander pool** job is gone: the Wander tab was
retired and nothing else read its file.

**Money.** The Wire's tagging and curation share a $60-a-month cap and stop for the month if
they reach it (the page keeps showing the last good paper). The audio brief has its own $8 cap
for the script; the voice uses ElevenLabs' Starter allowance (150,000 characters a month, $6;
a day's clip is about 2,500 characters). Roughly $0.20 a clip.

## Secrets (checked 2026-10-16)

Present in the repo: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`,
`TMDB_API_KEY`, `WIRE_INBOX_TOKEN`, `YOUTUBE_API_KEY` and the `YT_OAUTH_*` set.

Missing, and fine to leave missing:

- `ELEVENLABS_VOICE_ID`: optional. Without it the brief uses the default voice (Wyatt).
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`: optional. The Reddit bridge turns on Reddit's own
  API by itself if these are ever added; without them it uses the other routes.

(A few older jobs that are not part of the New Nine also name secrets that do not exist:
Google Weather, Spotify, ScrapeCreators. They behave today exactly as they did before.)

## Your Supabase steps, and what readers see before each

The steps themselves are in `all-day/supabase/SETUP-STEPHEN.md` (A, B, C) and
`all-day/supabase/SETUP-PEOPLE.md`. Do A before the merge if you can.

| Not done yet | What a reader sees |
|---|---|
| A (redirect URLs) | Sign-in emails arrive, but the link opens Small Talk instead of All Day. Do this one first. |
| B (paste `nn-SETUP.sql`, then `db/photos-board.sql`) | Signed in: "Posting is coming soon." Every tab reads normally, and posting, board votes and synced missions wait. Without `photos-board.sql` only, a Vintage post with a photo is refused. |
| C (moderator passphrase) | Posts still go up and two reports still take one down; the mod desk just will not open. |
| People (`nn-people.sql`) | Plans post and people can say they'd go; the People directory waits. |
| `db/photos-dish.sql` | Food's "Feature a dish" refuses the photo. |

Reading every tab, saving, muting, and voting on the Wire work at every step.

## After the merge: five checks

1. Open guide.btownbrief.com/all-day/ on your phone and tap through the nine tabs.
2. Within the hour, the Actions tab shows a green **Curate the Wire** run, and the Wire's
   dateline says it was updated today.
3. The next morning after 7, On Air shows today's audio brief.
4. The next morning, **Refresh games catalog** has run green (it only commits when the list of
   games changed).
5. On Monday, **Refresh the Watch tab's films** runs green and Watch shows the new list.

A red run is not an outage: every one of these keeps the last good file up, so the tab keeps
showing it (the Wire and On Air say which day theirs is from; Games and Watch just show the last list).

## The hub (separate repo)

The hub's All Day copy still lists the old tabs. The exact text change is in this cutover's
pull request description; it is a separate change to the `btownbrief/hub` repo, after the merge.

## How to undo it

On GitHub, open the merged pull request (new-nine into main) and click **Revert**, then merge the
revert pull request it opens. That puts main back exactly as it was before: the old All Day
returns, and the new schedules stop because their workflow files leave main with it. The data
branches (`wire-data`, `wire-audio`, `films-data`, `reddit-data`) stay where they are; nothing
reads them once reverted, and they do no harm. Readers' phones swap back to the old app the next
time they open it. Supabase is unaffected either way: the boards' tables sit unused.

(For whoever does it from a terminal: `git revert -m 1 <the merge commit>` on main, then push.)
