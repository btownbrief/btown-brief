# feat/photos-telegram — Telegram launch page + community photo system

Branch: `feat/photos-telegram` (worktree `btown-brief-worktrees/photos-telegram`).
Nothing is deployed; nothing is linked from existing pages yet. Review, run the
one-time Supabase setup, then merge when you're happy.

## What's on the branch

| File | What it is |
| --- | --- |
| `telegram.html` + `css/telegram.css` | The buffer page for the group invite — send people HERE instead of the raw t.me link |
| `photos.html` + `js/photos.js` + `css/photos.css` | Public gallery: filters, hearts, photo of the week, submission form, lightbox |
| `photo-admin.html` + `js/photo-admin.js` | Your phone-first moderation queue (passphrase-gated, not linked anywhere) |
| `js/photos-lib.js` | The one shared way any page gets photos (`window.BTBP`) |
| `db/photos.sql` + `db/PHOTOS-SETUP.md` | One-time Supabase setup (edit the passphrase placeholder first!) |
| `scripts/export_photos.py` + `data/photos/` | Static manifest export for the newsletter + fallback |

## Part A — Telegram launch page (`telegram.html`)

Everything the brief asked for: what the group is, five example posts styled as
chat bubbles, download-Telegram-first steps (App Store / Google Play / Desktop),
exact mute instructions, how Topics and replies work, four house rules, two join
buttons (`https://t.me/+pULrkkS4vjBiZjEx`), and an email fallback with the live
beehiiv embed (`embeds.beehiiv.com/d130f553…`, verified reachable) plus a plain
btownbrief.com link under it. Standard support strip auto-injects via
`community.js`. Join clicks are tracked as `telegram-join` in `btb_events`.

**To launch:** start using `https://…/telegram.html` as the link you share in
the newsletter, on Meetup, etc. The raw invite still works for people who have
Telegram.

## Part B — Community photo system

### Storage decision

Reused the **existing shared Supabase project** (`jnouvwxomrcffqwilqkq`) — the
same one behind the games, playlist, and click tracking. Confirmed live from
`js/community.js` / `js/playlist.js`. Same security model as Caption This and
quick-wins: RLS locks every table; the public anon key can only call the
security-definer RPCs in `db/photos.sql`; the admin passphrase is stored only
as a bcrypt hash. Photos live in a new public `btb-photos` storage bucket
(3 MB cap, jpeg-only, anon can only INSERT under `submissions/`).

### Submission paths — status

| Path | Status | How it works |
| --- | --- | --- |
| **Web form** (photos.html) | Built, needs `db/photos.sql` run once | Client resizes to ≤1600px jpeg (~300 KB), uploads, registers as `pending`. Permission checkbox is required by the form AND re-checked server-side — no permission, no row. Rate limits: 5 pending/visitor, 100 global. Until the SQL runs (or if Supabase is down) the form degrades to a pre-filled email to BtownBrief@gmail.com. |
| **Email** | Live now | photos.html has a mailto template (caption/where/when/credit/"OK to publish: YES"). You add it via photo-admin's "Add a photo I was sent," recording who said yes in the permission note. |
| **Telegram** | Live now | Same flow: reader posts in the group + says OK to publish; you add it from photo-admin on your phone. |

Contributors keep ownership; the permission checkbox/note records a grant to
publish on the site + newsletter. Anonymous is the default when name is blank.

### Moderation runbook (photo-admin.html)

1. Open `photo-admin.html`, enter the passphrase (remembered on your device).
2. The five checks are pinned at the top of the queue: **kids** (parent-submitted
   only), **private property** (street OK, windows/yards not), **bad days** (no
   accidents/emergencies/people in crisis), **would they expect publication?**,
   **AI/heavy edits → label, don't reject**. When in doubt, reject.
3. Each card: pick a label if needed (AI-generated / heavily edited), then
   **Approve** or **Reject**. One tap each, thumb-sized.
4. Wrong tap? It's under **Recent decisions** — flip it back.
5. **Removal request** (email): find it under Recent decisions → **Remove**.
   Comes down immediately; the row is kept for the record.
6. Email/Telegram submissions: "Add a photo I was sent" — goes straight to
   approved, with a permission note ("Jane R., email 7/10").
7. Queue-size check without opening the page: the `btb_photos_pending_count`
   RPC is public — a Caption-This-style GitHub-issue notification Action can
   be added later (see open questions).

### Gallery

Filterable by the 8 subjects (sunsets, pets, gardens, food, wildlife, street
scenes, events, everything else) and by neighborhood (same taxonomy as
things.json). Hearts: one per visitor per photo, same identity as the playlist.
**Photo of the week is fully automatic**: most-hearted photo approved in the
last 7 days (30-day fallback), surfaces on the page and in the manifest for
the newsletter. Photos never expire.

### Caption This

Not rebuilt — you already have the full game (btown-games/caption-this, same
Supabase project, own admin + weekly lifecycle). photos.html cross-links to it
("Feeling funny instead?"). If a gallery submission would make a great caption
photo, upload it to the Caption This queue from its own admin.

### Hooks for other pages (`data/photos/`)

- Live: include `js/photos-lib.js`, call `BTBP.getApproved()` / `BTBP.getPotw()`.
- Static: `data/photos/manifest.json` via `python3 scripts/export_photos.py`
  (keeps last good file on failure, like the other refresh scripts).
- Recipes in `data/photos/README.md` — sunset tracker filters
  `category === 'sunsets'`, events coverage `'events'`, newsletter uses
  `photo_of_the_week`.

## To go live (one-time, ~5 min)

1. Edit `CHOOSE_YOUR_ADMIN_PASSPHRASE` in `db/photos.sql`, run the file in the
   Supabase SQL editor (details: `db/PHOTOS-SETUP.md`).
2. Verify the `btb-photos` bucket exists (the SQL usually creates it).
3. Merge the branch, share `telegram.html`, link `photos.html` where you want it.

## Verification performed

- Local render at `http://localhost:8013`: photos.html and photo-admin.html
  inspected in Chrome (mobile + desktop); found and fixed a real bug (the
  lightbox overlay dimmed the page on load) and an empty-state layout glitch.
- telegram.html: built by Codex (GPT-5.6), inspected line-by-line by me
  (structure, links, voice, and every CSS variable checked against style.css).
  NOT visually rendered: the Chrome automation session kept dropping tabs and
  the Codex CLI here has no browser backend — worth a 30-second look in your
  own browser before sharing the link.
- `scripts/export_photos.py` run against the not-yet-created RPCs: fails
  gracefully and keeps the existing manifest (expected until step 1 runs).
- Independent Codex (GPT-5.6) security/XSS review of the whole diff; findings
  triaged and fixes applied on this branch.
- Not verified (needs the SQL run first): live submit → moderate → gallery →
  photo-of-week round trip. The RPC layer mirrors the proven playlist +
  caption-this patterns.

## Known limitations (accepted, same honor-system as playlist/caption-this)

An independent Codex security review confirmed: no moderation bypass, no XSS,
no injection, no RPC escalation. It flagged these honor-system limits, kept
deliberately because fixing them needs an Edge Function/CAPTCHA layer:

- **Hearts are honor-system** — a determined script could inflate votes (same
  as playlist upvotes). You pick what actually runs in the newsletter, so the
  practical blast radius is "the potw suggestion is wrong."
- **A determined abuser could flood the storage bucket** with orphan uploads
  (3 MB cap, jpeg-only). Same exposure caption-this has had since launch. If
  it ever happens: dashboard → Storage → empty `submissions/`, and we add an
  Edge Function gate then.
- **Rejected/removed photos stay at their unguessable URL** until you delete
  the object in the dashboard. For privacy-sensitive removals, delete the
  storage object too (noted in photo-admin).
- **Pick a long passphrase** — the check is anonymous-callable, so a weak one
  is brute-forceable. The admin page keeps it only in sessionStorage now
  (re-enter once per visit).

## Open questions (for Stephen)

1. **Passphrase hygiene:** the Caption This schema on the USB has what looks
   like your real admin passphrase committed in `schema.sql`. If that repo is
   public on GitHub, consider rotating it (re-run the one insert statement).
   `db/photos.sql` here ships only a placeholder.
2. **Where should photos.html and telegram.html be linked?** I left every
   existing page untouched. Natural spots: the mode-nav on the community pages,
   the index community section, and the newsletter.
3. **Pending-photo notifications:** want the Caption-This-style GitHub Action
   (checks `btb_photos_pending_count` every 2h, opens/closes an issue so you
   get emailed)? Easy add once this merges.
4. **Manifest refresh cadence:** run `export_photos.py` manually before each
   edition, or add it to the hourly refresh-data workflow? (Manual keeps the
   repo quiet; hourly keeps the fallback fresh.)
5. **Meetup group:** the brief mentions it — want the Telegram page (or a
   variant) linked from Meetup's description, or a mention of the Meetup group
   on telegram.html?
