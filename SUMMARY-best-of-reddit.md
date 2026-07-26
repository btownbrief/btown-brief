# Best of r/burlington — Build Summary

**Branch:** `feat/best-of-reddit` · **Built:** 2026-07-19

## What shipped

**Tier 1 only, by design** (Steve's decision): a categorized directory linking out to the
Reddit threads where Burlington has already answered every "best X?" question, twice.
No named-winner extraction — the crowd's actual answer lives in each thread's comments,
one click away. Tier 2 (reading 309 threads' comments to surface a real name per category)
is explicitly deferred; see "Open items" below.

- **`data/best-of-reddit.json`** — the runtime dataset: 18 categories, 310 entries, built by
  `scripts/seed_bestof.py` from `data/bestof-raw.json` (a frozen, checked-in copy of the
  research brief's merged output — the original research-dir file at
  `~/Desktop/newsletter/reference/research/02-bestof-data.json` was left untouched).
  Every entry (and every category) carries optional `sevendays_url`/`sevendays_note` fields,
  empty for now — the schema has room for the Seven Days comparison Steve wants to preserve,
  but no scraping happened; fill these in by hand whenever there's a Seven Days angle worth
  linking.
- **`best-of-reddit.html`** + **`js/best-of-reddit.js`** — the page itself:
  - 18 collapsible category cards (mirrors the `.pulse-topic`/`.pulse-rough` pattern
    already used on Burlington Pulse), each entry showing its Reddit thread link(s) with
    2025/2023 year badges. Entries that point at the same underlying thread from both
    editions (8 cases, mostly the 7 "present in both editions" duplicates) collapse into
    one link with a combined badge instead of two rows to the same URL.
  - **2023-only entries** (96 of 310, dropped from the 2025 refresh and not reconfirmed)
    are tucked into a nested "From the 2023 edition" expander inside each category, muted
    styling — visible on request, not competing with the current list.
  - The one **comment-suggestion** entry (Rasputins barbershop, mined from a 2025-thread
    reply) carries a "comment tip" badge.
  - **Food & Restaurants** (143 entries, the largest category by far — 94 active + 49
    2023-only) uses the same collapse/expander/search machinery as every other category
    rather than a special case; a global search box + category jump-chip row + expand-all/
    collapse-all button keep it navigable instead of one giant wall of cards.
  - A **"Recently on r/GoodBurlington"** strip at the bottom reads `data/reddit.json`
    (now fixed, see below) and reuses the existing `.reddit-list`/`.reddit-post` CSS from
    the "From the community" block — no new CSS needed for that part.
  - Seven Days secondary link: renders per-entry or per-category *only* when
    `sevendays_url` is set (currently never, everywhere).
- **`scripts/refresh_goodburlington.py`** — fixes the long-broken `data/reddit.json`
  pipeline (was `{"updated": null, "posts": []}` indefinitely, since Reddit started 403ing
  GitHub runners). Same proven shape as `refresh_chatter.py`: try direct Reddit JSON across
  a few hosts, fall back to Steve's public r/GoodBurlington Inoreader stream (no auth),
  keep the last good file on any failure. `--fixtures`/`--selftest`/`--dry-run` flags match
  the existing script's CLI.
- **`.github/workflows/refresh-data.yml`** now calls the new script instead of its old
  direct-Reddit-only inline fetch. Same hourly cron, same commit-only-on-change guard,
  already wired into `pages-deploy.yml`'s `workflow_run` trigger (as "Refresh community
  data") — no changes needed there.
- **`data/sources.json`** — documented the new `ino-reddit-goodburlington` Inoreader stream
  next to the existing r/burlington / r/vermont entries.
- **Nav**: added the `best-of-reddit.html` community-nav-card tile to `things-to-do.html`,
  and cross-linked `best-of-reddit.html` <-> `chatter.html` in each other's page nav (both
  are Reddit-sourced sibling pages).

## The r/GoodBurlington fix, concretely

The Inoreader stream Steve pointed me at
(`https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2FGoodBurlington%29`)
was **already live and public** — turns out the tag exists on his account (the research
brief assumed it might not yet). I fetched it directly and it returned real, current posts
with no auth needed, same as the r/burlington/r/vermont streams `refresh_chatter.py`
already depends on. Direct Reddit JSON (`www.reddit.com/r/GoodBurlington/hot.json`, tried
first per the existing pattern) still 403s from this machine, same as everywhere else in
this codebase — the script correctly falls through to Inoreader and reports
`"mode": "inoreader-only"`.

One quirk worth flagging: this subreddit is low-traffic enough that Inoreader's per-item
`pubDate` values cluster into the same crawl-batch timestamp rather than each post's real
submission time (confirmed by inspecting the raw XML). This is the same timestamp-precision
tradeoff the existing r/burlington/r/vermont Inoreader ingestion already accepts, not a bug
in the new script — sort order stays roughly chronological, just not to the minute.

## Verification performed — observed vs. inferred

**Observed (ran the actual commands / hit the actual network):**
- `python3 scripts/seed_bestof.py` — ran successfully, wrote 18 categories / 310 entries.
- `python3 -m py_compile scripts/*.py` — clean.
- `python3 scripts/refresh_goodburlington.py --selftest` — passed (stickied-post filtering,
  phone-number redaction, Inoreader/Reddit merge, reddit-id/url normalization).
- `python3 scripts/refresh_goodburlington.py --dry-run` and a real (non-dry) run — **hit the
  live Inoreader stream over the network** (confirmed via direct `curl` first), got HTTP 200,
  7 real current r/GoodBurlington posts, wrote a real `data/reddit.json`. Direct Reddit JSON
  genuinely 403s from this machine (all three hosts), confirming the fallback path is load-
  bearing, not just theoretical.
- `node --check js/best-of-reddit.js` — clean.
- Local server (`python3 -m http.server 8791`) served `best-of-reddit.html`,
  `data/best-of-reddit.json`, and `data/reddit.json` correctly (HTTP 200, valid JSON) —
  confirmed via `curl` against the running server, not just reading the files off disk.
- **Structural render verification in Node**, extracting the actual `categoryHTML`/
  `entryHTML`/`jumpChipHTML`/`groupSources` functions from `js/best-of-reddit.js` (not a
  rewrite — the real file) and running them against the real `data/best-of-reddit.json`:
  all 18 categories and all 310 entries render without `undefined`/`NaN`/malformed markup,
  every `<details>` tag balances, every entry links to a real `reddit.com` URL, entry/category
  ids are unique, the Food & Restaurants counts match exactly (94 active / 49 2023-only) with
  its 2023 expander present, and the same-thread-multi-source grouping collapses correctly
  (verified on "Best Creemee," which has both a 2025 and a 2023 source pointing at one URL).
- HTML structural checks (`best-of-reddit.html`, `chatter.html`, `things-to-do.html`): every
  local asset reference resolves to a real file, tag counts balance, every element `id` the
  JS references exists in the HTML.

**Not observed — inferred from code review, honestly flagged:**
- **Actual browser rendering and click-driven interactivity** (search-box filtering,
  expand/collapse toggling, jump-chip scroll-and-open) were **not** visually verified in a
  real browser. I attempted this twice: once via the `claude-in-chrome` MCP tools, which
  repeatedly failed with tab-context errors and "frame showing error page" — the tab group
  kept changing between calls, consistent with this machine currently running many other
  concurrent Claude sessions (per Steve's own standing note about concurrent-session
  contention) also driving the same Chrome extension. I also checked whether Codex
  (`codex-computer-use`) had a usable headless-browser path in this sandbox — no
  Playwright/Selenium/Chromium is installed locally, so it couldn't do it either. I did not
  fake a screenshot or claim a visual pass; the interactivity code was traced by hand instead
  (it uses the same `classList.toggle`/`details.open`/`querySelectorAll` patterns already
  proven out in `chatter.js`/`app.js` on this same site), which is reasonable confidence but
  genuinely different from having watched it work. **Recommend an actual click-through in
  your own browser before you consider this fully done** — that's the one thing that
  couldn't be closed out this session.

## Open items for Steve

1. **Tier 2 (named answers)** — deliberately not built. Getting from "here's the thread"
   to "here's who won" means reading comments in up to 309 individual threads; the research
   brief calls this out as ongoing, chip-away work, not a blocker. Nothing in this build
   makes that harder to add later — `data/best-of-reddit.json`'s schema has room, it's just
   not populated.
2. **Seven Days links** — the `sevendays_url`/`sevendays_note` fields exist on every entry
   and category but are all `null`. Fill in whichever ones are worth a comparison; the page
   already knows how to render them the moment they're set.
3. **A real browser click-through** — see "Not observed" above. Worth 5 minutes in your own
   browser to confirm search/expand/collapse feel right before considering this done.
4. **`refresh-data.yml` is unattended** — next scheduled run (hourly, `:15`) will refresh
   `data/reddit.json` for real on GitHub's runners; only a local run was verified this
   session. If GitHub's own IPs get 403'd on direct Reddit (likely, matching the rest of
   this codebase's experience) it'll fall through to Inoreader automatically — no secret/
   credential setup needed, same as the two existing Reddit streams.

---

## 2026-07-26 revision (feat/bestof-fixes)

Fixes from a page audit (research → data → render → live page):

1. **Same-question merge.** The source lists number repeat questions ("Best
   Burger 1"…"Best Burger 6") and list some questions several times; the
   original seed passed that through, so the page showed three cards all
   titled "Best Burger" plus "Best Burger 4/5/6" as separate cards. The seed
   now merges on (category, question-minus-trailing-number): 310 raw entries
   → 232 question cards, each showing all of its threads newest-first. A
   question with any 2025 ask counts as active; its 2023 thread joins the
   card with a 2023 badge (12 former "2023-only" cards folded in this way).
2. **Link labels from thread slugs.** Labels like "Best Burger 2" (bluepied's
   numbering) are replaced by the humanized Reddit slug ("Best burgers in
   town"), which mirrors the real thread title. Truncated slugs get an
   ellipsis; two different threads with identical slugs get "(asked again)".
3. **Reader-facing copy.** All 102 maintainer-facing notes from the raw data
   are dropped at transform time (raw stays frozen); the Rasputins
   comment-suggestion note is rewritten for readers. Hero no longer claims
   the subreddit "voted" (they're link indexes, not ballots) and no longer
   hardcodes the 310 count.
4. **Search box.** #bor-search is type="search" and has a custom clear
   button; WebKit's native cancel button is now hidden so there's one ×.
5. **Seven Days comparison actually shipped.** data/sevendays.json holds
   researched Seven Daysies readers' choice winners; the seed matches them to
   questions/categories and the page renders a "🏆 Seven Daysies YEAR:
   Winner" row under the Reddit threads — crowd's take vs ballot-box take.
   The category-level link moved out of <summary> (a link there both
   navigates and toggles).

Honest counts: 317 rendered thread links = 318 raw sources (317 list links +
1 comment-mined source) minus the one exact duplicate (the 2025 list linked
"Best Place for a Date" twice at the same URL — bluepied's own dupe,
verified against the Wayback snapshot).

Still deliberately not built: Tier 2 named answers, and the brief's
"Recently asked, not yet confirmed" auto-detection section (the
r/GoodBurlington strip remains a separate block rather than per-entry
corroboration — revisit if the page earns traffic).
