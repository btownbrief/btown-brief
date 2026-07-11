# Burlington Pulse — build summary (feat/chatter)

**What shipped:** `chatter.html` ("What Burlington Is Talking About") — the neighborhood-chatter
page: a separate information economy from the journalism side. It's the community talking,
always linked back to the original threads, with rumor-vs-fact separation built into the UI.
It extends the newsletter's Wednesday **Burlington City Pulse** section (the weekly r/burlington
roundup) into an always-on view, and cross-links it rather than duplicating it. The existing
r/GoodBurlington "From the community" block on index.html is untouched.

## The page (chatter.html + js/chatter.js + css/style.css additions)

- **Today** — trending topics over a rolling 72-hour window with direction arrows:
  🔥 hot · ↗ rising · ↘ fading (steady topics get a quiet dot). Every topic expands to
  its source threads; every link is a reddit permalink (always link back — hard rule).
- **The good stuff** — rotating highlight slots, positive-first: Most useful neighbor
  question · Funniest local post · Most debated · Someone needs help · Something people
  keep recommending · Emerging rumor. The rumor card is ALWAYS badged "Unverified" with
  dashed-coral styling — separating chatter from established fact is the brand. Slots
  simply don't render when nothing qualifies (no forced weak picks).
- **Around the groups** — Facebook groups and Craigslist appear ONLY as clean link-out
  cards. Nothing is scraped from either (Craigslist actively blocks fetches; Facebook is
  off-limits). Slots are plain HTML in chatter.html — Stephen can edit freely.
- **The rougher stuff** — complaints/crime chatter in a `<details>` collapsed by default.
  The page reads positive-first; the grit is one tap away, not gone.
- Standard page chrome: site header + dark toggle, newsletter bar, note-card tying into
  the Wednesday City Pulse + tip email, auto-injected Ko-fi/newsletter/about strip
  (community.js), site footer. Mobile-first, matches existing tokens/classes throughout.
- Index gets a fifth "💬 Burlington Pulse" card under "Get into Burlington life".

## The pipeline (scripts/refresh_chatter.py)

- **Sources**: r/burlington + r/vermont. Reddit's JSON listings are tried first
  (www/old/api hosts) but currently 403 from BOTH this machine and GitHub Actions —
  the reliable primary is Stephen's public Inoreader streams (`?n=100`, ~13 days of
  history, full post bodies). Reddit metadata (scores/comments) enriches when reachable.
- **Topics**: deterministic keyless clustering (weighted token/bigram overlap on
  titles+bodies), stable topic ids, labels from the representative post.
- **Direction**: `data/chatter-seen.json` keeps 7 days of per-topic activity snapshots
  (ids/metrics only — no content); each run compares activity vs ~24h ago. Arrows start
  differentiating after the first day of snapshots — a fresh checkout shows "steady".
- **Safety filter**: posts pairing accusation language with a private individual's name
  (public officials whitelisted) or doxx-y address/phone patterns are excluded from ALL
  public output and routed to the private tips inbox instead.
- **Optional LLM polish**: with the `ANTHROPIC_API_KEY` repo secret set (same pattern as
  the weather read drafts; model `CHATTER_MODEL`, default claude-sonnet-5) one call
  rewrites topic labels into headline style and re-judges slot picks/safety flags
  (flags can only be added, never removed). Without the key the deterministic
  heuristics run alone — the page never depends on the LLM.
- Failure behavior matches the repo pattern: any fetch/parse failure keeps the last good
  files; the page never goes blank. `--fixtures`, `--selftest`, `--dry-run` for dev.
- **Automation**: `.github/workflows/refresh-chatter.yml`, 4x daily (≈6:40/10:40/14:40/18:40 ET),
  commits `data/chatter.json` + `data/chatter-seen.json` only.

## The private tip line (NOT part of the public page)

The repo is **public**, so all private paths are gitignored and local-only:
`data/tips-inbox.md`, `data/fpf-digests/`, `data/fpf-dropbox/`, `.chatter-dev/`.

- `data/tips-inbox.md` — newsletter leads, never auto-published: safety-flagged posts,
  high-engagement rough threads, every rumor candidate, newsworthiness matches (fire,
  lawsuit, layoffs, closings…). Deduped by URL; written only on local runs (skipped in CI).
- **Front Porch Forum is a tip line only.** Two intake paths, both local:
  (a) drop digest emails Stephen receives into `data/fpf-digests/` (.eml/.txt/.html);
  (b) the newsletter workflow's in-browser session reads can drop notes into
  `data/fpf-dropbox/`. `scripts/ingest_fpf.py` parses both into tips-inbox leads, each
  stamped "PRIVATE tip line — never quote, link, or summarize publicly; verify
  independently." FPF content never touches chatter.json, the page, or git. Per
  Stephen's ruling the public page doesn't even link to FPF.

## What a compliant Facebook integration could look like later

No scraping under any realistic reading of FB's ToS. Legitimate options, in order of effort:
1. Keep link-out slots (current state) — zero risk, real value.
2. Stephen (as a group member) manually drops notable-post notes into `data/fpf-dropbox/`-style
   local notes → tips inbox → City Pulse writeups with permission from posters.
3. A "community correspondents" pattern: group admins email a weekly highlight to
   BtownBrief@gmail.com (the tip email is already on the page).
4. Meta's Graph API only exposes groups the app administers — if Stephen ever runs his own
   BTown Brief FB group, its posts could be ingested legitimately via a page/app token.

## Codex's role + review

- `scripts/refresh_chatter.py` and `scripts/ingest_fpf.py` were implemented by GPT-5.6 Sol
  (Codex) against a written spec, then I reviewed all 614 lines, tightened two slot
  heuristics after a live run (generic words like "missing"/"heard" deep in post bodies
  were mis-slotting posts), and re-ran everything.
- A second, independent Codex read-only review of the whole branch found 2 critical +
  2 high findings, all verified and fixed: Unicode/overlapping-name bypasses of the
  safety filter, LLM output trusted too much (labels now must be name-free and share
  cluster vocabulary; flag additions capped), suppressed post ids leaking into the
  committed chatter-seen.json, and gitignore-only protection (the workflow now has a
  tripwire that fails if private paths ever become tracked). Plus: URL-scheme guard in
  chatter.js, trend-baseline window (18–30h), mode-label bug, <5-posts ingestion guard,
  focus-visible outlines, badge contrast.

## Verification performed

- `refresh_chatter.py --selftest` and `ingest_fpf.py --selftest` pass; `py_compile` and
  `node --check js/chatter.js` clean.
- Fixture runs are idempotent (no duplicate tips; snapshots grow by one per run).
- **Live run against real sources**: 27 r/burlington posts ingested via Inoreader
  (Reddit JSON 403s from this machine AND GitHub's IPs — the existing hourly Action's
  reddit.json has been empty for the same reason). Output: 8 topics, 2 honest highlight
  slots ("lost chicken!" → Someone needs help; piña-colada hunt → recommendation),
  3 rough items, 4 private tips including one safety-filter catch (a post naming and
  insulting a private individual — absent from every public file, present in tips).
- Safety matrix (9 cases: accented/ALL-CAPS names, person-seeking phrasing, public
  officials, business names, phone-number doxx) all pass.
- **Browser (observed)**: desktop render, topic expansion with reddit-permalink source
  rows, all dynamic links reddit-only, 8 group cards correct, rough section collapsed
  by default with 3 items, dark toggle flips `data-theme` with dark background applied,
  Ko-fi/newsletter/about-me strip auto-injected, zero console errors, zero horizontal
  overflow at desktop.
- **Mobile (verified)**: measured at a true 390px viewport via a same-origin iframe
  probe rendered headless — `clientWidth 390 / scrollWidth 390 / overflow 0`, no element
  exceeds the viewport. (Direct headless `--window-size=390` screenshots clip on every
  site page including shipped ones — that was a screenshot-crop artifact, now ruled out.)
- **Not exercised live**: the optional LLM refinement path was code-reviewed and
  schema-validated (labels must be name-free + share cluster vocabulary; flags capped)
  but not run against the API — no `ANTHROPIC_API_KEY` on this machine.

## Model provenance (for a later Fable review)

Stephen is rationing Fable 5 weekly usage; this branch was **built and Codex-reviewed by
Claude Fable 5** (commits `717621b`→`b5682fd`) and **finished by Claude Opus 4.8**
(final mobile verification, the last green pipeline run, and these docs — commits after
`b5682fd`, tagged with the Opus co-author trailer). Fable's weekly quota resets Sunday
~4pm; Stephen may have Fable review the Opus-era commits then. `git log` records which
model authored each commit.

## Decisions on the open questions (resolved by Opus 4.8, best judgment)

1. **Name policy → tightened, resolved.** A named person now stays off the public page
   whenever the post reads as accusing, hostile, crime/complaint (theft, police, eviction,
   harassment, …), or person-seeking ("has anyone seen Jane Doe"), OR includes a
   phone/address. Those become private tips. Positive/neutral mentions ("thanks to Sarah
   Chen for the plant sale") and whitelisted public figures stay public — flagging *all*
   names gutted the page because Burlington business names (Taco Gordo, Original Skiff)
   look like person names. On live data this moved 2 more named crime/complaint posts to
   the tip line (rough 3→1, tips 4→6) while the page stayed healthy (8 topics, 2
   highlights). Regression cases are in the selftest. The optional LLM pass can only *add*
   flags, never remove them.
2. **Foodies FB group → deliberately omitted, resolved.** No Burlington-VT foodies
   *group* is confirmable (the indexed "Burlington Foodies" is Burlington, MA; VT food
   communities that exist — Eat Vermont, Foodies of Vermont — are Pages, not chatter
   groups). The 6 verified neighborhood/housing/pets/Buy-Nothing groups + 2 Craigslist
   sections already cover every category the brief named except food, and restaurant
   chatter surfaces through the Reddit topics/recommendation slot anyway. Linking a shaky
   Page would undercut the "verified only" bar, so the food slot stays out. Revisit if a
   real BTV foodies *group* turns up.
3. **Wednesday City Pulse tie-in → deferred to the newsletter repo, resolved.** Good idea,
   but it's a change to `~/Desktop/newsletter` (a different repo + workflow), not this
   page. Left as a recommendation for the next newsletter session: have the weekly roundup
   start from this page + `data/tips-inbox.md` instead of re-reading Reddit cold.
4. **First-day arrows → working as intended.** Directions differentiate only after ~24h of
   snapshots (≈4 Action runs); until then topics read "rising"/"steady". Expected, no fix.

## For Stephen (only you can do these)

1. **Fix the Inoreader r/Vermont rule.** Re-checked 2026-07-10: still stale (newest item
   Jul 4), so r/vermont contributes 0 posts. r/burlington alone is carrying the page fine;
   the pipeline picks r/vermont back up automatically once the Inoreader stream refreshes.
2. **Front Porch Forum digests** — see "How to feed FPF" below; that's the one input the
   page/tip-line still needs from you regularly.
3. *(optional)* Set the `ANTHROPIC_API_KEY` repo secret to turn on the label/slot polish
   pass; without it the deterministic heuristics run alone (already good).

## How to feed FPF (the private tip line)

FPF never appears publicly — it only becomes private newsletter leads in
`data/tips-inbox.md`. Two ways in, both local-only:
- **Digest emails** → save the FPF email into `data/fpf-digests/` (as `.eml`, `.txt`, or
  `.html`), then run `python3 scripts/ingest_fpf.py`. It appends deduped leads and never
  re-processes the same file.
- **Browser-session reads** → your newsletter workflow's logged-in FPF reads can drop
  notes into `data/fpf-dropbox/` (`.md`/`.txt`); same script picks them up.
The easiest sustainable path, since Claude has Gmail access, is to let a session pull the
latest FPF digests straight from your Gmail into the tip inbox on demand — just ask
("pull my FPF"). Nothing is auto-read without you asking.

## Not touched (pre-existing, flagged for awareness — not part of this branch)

- `css/style.css` ~line 3112: the "BURLINGTON RIGHT NOW" section-banner comment looks
  malformed (missing its opening `/*`). It's on `main` already and the pages render fine,
  so it's cosmetic; left alone to avoid an unrelated change.
- index's `reddit.json` / "From the community" block has been empty since Reddit began
  blocking GitHub runners. The Inoreader approach this page uses could revive that section
  too — a separate small enhancement if you want it later.
