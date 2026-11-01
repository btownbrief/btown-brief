#!/usr/bin/env python3
"""Build all-day/data/instagram.json — local Instagram, minus the algorithm.

Three places read this payload: the Wire's Photos view (every post, filtered
by the `category` chips), Food's "Their food" (by handle, plus `f`), and
Vintage's "New in" (by handle). The accounts come from one hand-curated
roster, data/instagram-handles.json, and nobody else's posts get in except
the tagged shelf (below).

EVERY ACCOUNT HAS A TIER AND A CATEGORY, and they answer different questions.

  tier      how often we PAY to check it. 1 = every run (the workflow runs
            twice a day), 2 = once a Burlington day, 3 = once a week, in a
            rotation that takes an even slice of the tier each day.
  category  what kind of picture it is, for the Photos chips: food, venue
            (bars, cafes, music venues: the vibe checks), events (posters
            and the accounts that post them), shop (vintage), pets, scenic
            (photographers and city accounts), other.

THE CREDIT BUDGET. Every request costs one Scrape Creators credit, whatever it
returns. MONTHLY_CREDIT_BUDGET is the ceiling, and the builder enforces it
pro rata: by the end of day d of a D-day month it may have spent at most
budget * d / D, counted in data/instagram-ledger.json (credits spent this
month, and when each account was last fetched). Tier 1 is served first, then
the tagged shelf, then tier 2, then tier 3, and whatever does not fit waits
for tomorrow. Credits are written to the ledger BEFORE the requests go out,
so a run that dies halfway has already counted them. In the workflow that is
two steps: `--reserve` writes the run's credits and its accounts into the
ledger and stops, the workflow pushes the ledger, and only then does
`--execute` fetch exactly what was reserved. A run that cannot push its
reservation spends nothing, so no later run can read a ledger that is
missing credits. A missing or unreadable ledger fails CLOSED: the run
assumes today's whole share is spent, fetches nothing, and writes a fresh
ledger so tomorrow starts normally.

THREE FACTS ABOUT INSTAGRAM'S CDN SHAPE EVERYTHING HERE.

  1. Image URLs expire. The `oe` parameter is a hex epoch. Measured against a
     live payload on 2026-08-30 it sits 4.3-4.5 DAYS out, not the three days
     this file used to claim — and `carry_ok()` re-reads the real `oe` on
     every record rather than trusting any constant.

  2. The obvious image URL is enormous. The `image` field the newsletter's
     fetcher keeps is the full-size original — 1.29 MB for a single post,
     which is 30 MB for a screenful. The API actually returns FOURTEEN signed
     resolutions in image_versions2.candidates; the 320px one is 20 KB, the
     same picture 64x smaller. Editing the size out of the big URL does not
     work — `stp` is inside the signature and rewriting it returns 403. You
     have to pick the candidate.

  3. Because those URLs stay good for four days, a run does not have to
     re-fetch an account to keep showing it. THIS IS THE WHOLE REASON THE
     ROSTER CAN BE BIG. The old builder started from an empty list every
     morning, so the payload only ever held the handles that run happened to
     scrape — 26 accounts out of a rostered 79. Now each run carries forward
     yesterday's still-signed posts and layers today's scrape on top. A
     tier 3 account fetched once a week therefore shows for about four days
     of every seven, for one credit.

  4. Reels carry a playable MP4 as well, and it lives a much shorter life.
     `video_versions` holds the signed candidates (on 2026-10-16 all three
     were the same 720p progressive file, about 65 KB a second); its `oe`
     sat 35 HOURS out, not four days. So a video post keeps its picture as
     the poster (`i`) and adds `vu` (the smallest candidate), `ve` (that
     URL's own expiry, read from its `oe`) and `vd` (seconds). A carried
     post whose video is about to lapse keeps its picture and loses only
     the video fields: it shows as a photo rather than a dead player.

FOOD. A post gets `f: 1` when its account's category is `food`, or when the
account carries `"food": true` (a bar, a brewery or a market that belongs on
the Food tab too). Food reads it.

NATIONAL. An account with `"national": true` is from away. It takes the
category `national` whatever else its entry says and never `f`, so nothing
that reads a category or the food flag can pick it up; its posts carry `n: 1`,
which the switch (Local, National, Everything) reads. It has its own cap, so
it cannot push a local post out.

NAMES. A post's `nm` is its account's name ("UVM Men's Basketball", not
@uvmmbb), one per handle, stamped on every post on every run. A post's `user`
can be a collab's other party, so a name is taken only from a post the account
itself owns, and it costs nothing: it comes with the read already paid for, and
the ledger's `names` remembers it. A roster `name` wins, for a handle that
cannot wait for its next read or whose own profile name says little. A local
profile that reads as a person's name is left on the handle.

KIND. Every post also carries `kind`, what the PICTURE is, for the Photos
chips: vibe (a room, a crowd, a night out), poster (a flyer for a dated
event), food, pets, scenic, other. The account's category is only the first
guess: a cat cafe's latte is food, not pets, and a restaurant's trivia flyer
is a poster, not food. So once a run, Claude Haiku 5.5 reads the account,
its category and the caption of every post that has no kind yet, in one
batched call, and says which kind each is, whether it is sure, and for a
national post whether it is an ad (ADS below) and whether it is sad (SAD
below). The posts it is not sure about (up to IMAGE_LOOK_MAX) get a second call that
shows it the 480px thumbnail itself. A kind is decided once per post and
carried with it, so a post is never paid for twice. Without a key, past
AI_MONTH_CAP_USD, or when a call fails, a post gets its category's kind
with `kd: 1` (defaulted) and is asked about again next run; an unsure post
whose picture could not be looked at this run ships the caption's guess,
also with `kd: 1`. The spend is
kept in the ledger's `ai` block; AI COST below has the measured numbers.

CAPTIONS. Videos do not autoplay in the grid, so the line under a tile has to
say what the post is, and the post usually says so itself. mark_captions runs
on every post in the payload, for nothing: clean_caption takes off hashtags,
@handles and emoji and keeps the first sentence, and that ships as `cp`, in the
account's own words. On the live payload that is about 50 of every 100 posts,
and no model ever sees them. `c` stays whole, except on a post that ends up with
`hx`: see TITLES. The two accounts in CAPTION_SAYS_NOTHING never get a `cp`.

TITLES. The rest are gaps: a line of three words or fewer or a run-on, not
English, only hashtags, a question, a call to action, a sentence cut off or with
a hole where a handle or the object of a sentence was, a relative day on a post
over a day old, or a local line that names a private person. A gap goes to
Claude Sonnet 5.5 with its caption AND its thumbnail, in batches after the kinds,
and comes back as one of three: `hd`, 3 to 8 plain words; `ad: 1`, a national
paid or selling post, which never needs a title; or `hx: 1`, asked, with nothing
worth saying. A post with no real words and nothing clear in its picture gets
`hx` and no line, because a guess is worse than a blank. Why the picture and why
Sonnet: measured 2026-11-01 on 475 gaps, read against the pictures, Haiku from
the caption alone got about 9 in 100 wrong or invented, Haiku with the picture
about 6 ("Bellie Jean", "Low ticket prices" for a nearly sold-out show), and
Sonnet with the picture under 2. Decided once per post and carried, like `kind`,
unless a carried title no longer passes clean_hd. A post whose thumbnail will not
download waits for the next run. The account goes by its name, never its handle.
Each post goes out under a code made from its identity and an answer counts only
under a code from its own batch, so a model that loses its place loses that post
until the next run, never labels the wrong picture. A title that breaks the rules
gets one more try in the same run, then `hx`. A batch whose answer is no use is
halved until the post that broke it is alone, and only that post gets `hx`. A run
with no key, past the cap or out of time leaves the rest for the next run. A
stalled call gives up after MODEL_TIMEOUT_S, and SIGTERM during any of this still
writes the payload and records what was spent. A post with `hx` ships without `c`:
the page rebuilds a line from `c` when it finds no `hd` or `cp`, so a caption the
build turned down (a phone number, "LIMITED TIME ONLY") would come back under the
tile. The sheet then shows the picture and the link.

DATES. A date in a line goes stale as surely as "tonight", so any `cp` or `hd` whose
last date has passed is a gap and is titled again, told today's date. A holiday is a
date when nothing else is given: "Happy Halloween" goes on Nov 1. A poster is
another matter: the picture itself still says the show is on. A poster whose last
date has passed, in its line or its caption, gets `gone: 1` and stops asking anyone
for anything; so does one over a week old whose caption only says "this Friday".
A poster's line has to say when, so one whose caption has the date and whose first
sentence does not is a gap: "Unconventional pairings tend to hit the palate" was a
rap night on Nov 21.

A local line can go stale with no date in it: "Last Burlington farmers market of the
season" was true on Oct 31, and only the caption's "today" says so. So when a local
caption's day has gone by (caption_passed), its `cp` is a gap and its `hd` is asked
about once more, told the day it was posted and today's date, and comes back with
`hs: 1` so it is not asked a third time. The caption alone proves nothing: "Open today
til 5" under a new rack is still a new rack, and the title says so.

ADS. `ad: 1` marks a paid post, and a post carrying it has no `cp` or `hd`. The
API's is_paid_partnership and a caption's own declaration (#ad, #sponsored,
#paidpartnership, #gifted, #BrandPartner, a leading "Ad:", "paid partnership")
count on any account; a discount code, "sponsored by", "presented by" or "Buy ... NOW"
counts off a local account only, because a Burlington shop selling its own goods is news for its
neighbors, not an ad. The rules read the whole caption when the post is first
read, before `c` is cut to 1,000 characters. They caught 11 of the 59 posts a
model flagged on the live payload, so a national post also gets a yes or no
inside its kind call, which costs no extra call and reads the end of a long
caption as well as its start. Local posts never take a model's word for it.

SAD. The feeds under the Wire's pill exist for fun. A national post in one of
them gets a second yes or no in that same call: `sad: 1` for a death, grief, an
injury, abuse or politics, and SAD_WORDS catches for nothing what that call misses
on a joke, along with a dog's upset stomach, which is nobody's idea of a good tile. Like `ad` it is said once and carried. A local post gets `sad` for one
thing only, an election, from that same call or ELECTION_WORDS: "How we can protect
this election" is not what a wall of the town is for, and a neighbor's other bad
news is still news. The post keeps its line.

HELD. A `sad` or `gone` post is left out of `posts` and written to `held` instead,
so the page never meets it and the next run still knows what was decided about it.
Nothing in `held` costs a model call again.

PERSISTENCE. Each category's cap is filled one post per account at a time
(every account's newest, then every account's second newest, ...), not
newest-first, so a weekly account's posts are not pushed out by an account
that posts daily. They still lapse when their signature does (about four
days), which is the one limit carrying cannot lift.

TAGGED is the one thing here that is not a roster. It is every post by anyone
that tags @btownbrief — the route onto the wall for a reader who is not an
account we follow. One credit per run (`/v1/instagram/user/tagged-posts`, by
numeric user id). That endpoint returns no `taken_at`, so the timestamp is
decoded from the post's `pk` — Instagram media ids are snowflakes (ms since
2011-08-24 in the high bits), and the decode checks out to within minutes
against posts that do carry `taken_at`. A handle listed in the roster file's
`tagged_block` array never lands, whatever it tags. A tagged post takes its
account's category when that account is rostered, else `other`.

Env: SCRAPECREATORS_API_KEY (or SCRAPE_CREATORS_API_KEY), or
     ~/.config/btownbrief/secrets.env.

Run: python3 scripts/build_instagram.py [--dry-run | --reserve | --execute]
                                        [--only h1,h2] [--no-carry] [--no-tagged]
                                        [--out PATH] [--ledger PATH]
     With no step flag it reserves and fetches in one go, and only for --only
     (a small local test): otherwise main's ledger would never see the credits.
     --dry-run prints what this run would fetch and what that costs. It makes
     no request and needs no key.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import pathlib
import re
import signal
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zlib
from zoneinfo import ZoneInfo

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from town.title_guard import CONTACT, FIRST, NOT_SURNAME, names_person

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROSTER = ROOT / "data" / "instagram-handles.json"
LEDGER = ROOT / "data" / "instagram-ledger.json"
OUT = ROOT / "all-day" / "data" / "instagram.json"
SECRETS = pathlib.Path.home() / ".config" / "btownbrief" / "secrets.env"
TZ = ZoneInfo("America/New_York")

ENDPOINT = "https://api.scrapecreators.com/v2/instagram/user/posts"
POSTS_PER_HANDLE = 6          # newest few per account; the tab is a mixed feed
KEEP_DAYS = 21                # older than this is not "what is happening"
INTEREST_KEEP_DAYS = 60       # a feed's account has no news to go stale and some post monthly, but a 149-day-old post in a fresh feed reads as a stuck feed
WANT_W = 480                  # candidate width to prefer for the grid

# THE ONE NUMBER. Credits this builder may spend in a calendar month. Set
# 2026-10-17 at twice what it spent before the tiered roster: 87 handles + 1
# tagged = 88 credits a day, 2,640 in a 30-day month. At the Freelance pack's
# price ($47 for 25,000 credits, $0.00188 each) the ceiling is about $9.93 a
# month. Raise it and the tier 3 rotation is the only thing that grows.
# Raised 2026-11-01 from 5400 for the Wire's feeds: 59 national accounts cost
# about 27 credits a day, about $1.50 a month. Raised 2026-11-01 from 6200 for
# 21 more dog and home accounts: 10 credits a day, about $0.58 a month.
MONTHLY_CREDIT_BUDGET = 6510

RUNS_PER_DAY = 2              # refresh-allday.yml's two crons; for the projection only
TIER3_PERIOD_DAYS = 7         # tier 3: each account once a week
INTEREST_PERIOD_DAYS = 3      # a tier 3 account in one of the Wire's feeds: pictures last ~4 days, so a feed never goes blank
TIERS = (1, 2, 3)
PENDING_MAX_H = 6             # a --reserve older than this is not executed
# Wall-clock budget for the account requests in one --execute. The workflow's
# Build Instagram step is killed at 30 minutes, and a kill before the payload
# is written loses every post this run paid for: the 154-account morning runs
# of 2026-10-26, -28 and -29 hit that (Oct 27's finished in 28 minutes). Past
# this budget the run stops asking, gives the unasked accounts their rotation
# places back, and writes what it has, leaving ~10 minutes for the tagged
# shelf, the kind and title calls and the write. 23 minutes is RUN_MAX at 13
# seconds each; the title step is bounded by HD_TIME_S.
FETCH_BUDGET_S = 23 * 60
# What one run reserves. A run gets through about 100 accounts inside
# FETCH_BUDGET_S (about 13 seconds each, 2026-10-30), and credits reserved past
# that stay spent with no request behind them. Two runs a day at this cap cover
# the roster's 210 a day: tier 2 daily, tier 3 about weekly.
RUN_MAX = 105
ONLY_MAX = 5                  # --only is a small local test, never a second schedule
CATEGORIES = ("food", "venue", "events", "shop", "pets", "scenic", "other", "national")
# The feeds under the Wire's pill (all-day/js/modes/wire-interests.js). A roster
# account's `interest` is one of these and rides on its posts as `t`; `breed`
# as `br`, because Ashley wants beagles and labs, not every dog (2026-11-01).
INTERESTS = ("dogs", "home", "plants", "laughs", "sports", "wild")
BREEDS = ("beagle", "lab")
LINK_IN_BIO = re.compile(r"\blink in (?:my |our |the )?bio\b", re.I)

# One cap per category, so a chip never comes up empty because another kind
# of account posts more. About 1.5 KB a post, with signed video links: about
# 1,150 posts and 1.75 MB. National is the 101 accounts at POSTS_PER_HANDLE, so
# the feeds show every post a read paid for; the local caps are what they were.
CAP = {"food": 150, "venue": 90, "events": 100, "shop": 60, "pets": 50,
       "scenic": 90, "other": 90, "national": 606}
TAGGED_CAP = 12

# @btownbrief's numeric id (the tagged-posts endpoint takes ids, not handles).
# Checked 2026-09-02 via /v1/instagram/profile?handle=btownbrief.
TAGGED_ENDPOINT = "https://api.scrapecreators.com/v1/instagram/user/tagged-posts"
TAGGED_USER_ID = "71971306251"
TAGGED_DAYS = 120             # nobody has been asked to tag yet; a 3-week window would be empty
IG_EPOCH_MS = 1314220021721   # media-id snowflake epoch

# How long a carried post may live is not a constant here: it is whatever its
# own signature says, read per URL by carry_ok(). The measured life is 4.3-4.5
# days. This is the only knob — refuse anything that close to expiring, so a
# reader who opens the tab late in the day still gets pictures.
CARRY_MARGIN_H = 8

# What a picture is, for the Photos chips (the contract with the Wire's
# Photos view: it reads `kind` when present). A post nobody has judged yet
# takes its account's category's kind.
KINDS = ("vibe", "poster", "food", "pets", "scenic", "other")
KIND_OF_CATEGORY = {"food": "food", "venue": "vibe", "events": "poster", "pets": "pets",
                    "scenic": "scenic", "shop": "other", "other": "other"}
KIND_BATCH = 150              # posts per caption call; a steady-state run is one call
CAPTION_CHARS = 300           # of each caption the model reads
CAPTION_TAIL = 120            # and of a national caption's end, where a plug sits
IMAGE_LOOK_MAX = 60           # unsure posts per run that get their thumbnail looked at
IMAGE_MAX_BYTES = 1_500_000   # a 480px thumbnail is ~20-60 KB; anything bigger is skipped
# AI COST. Claude Haiku 5.5, $0.10 / $0.50 per million tokens in / out
# (platform.claude.com pricing, checked 2026-10-18; under 100K-token prompts).
# An image is ceil(w/28) * ceil(h/28) tokens: a 480x600 thumbnail is 396.
# Measured 2026-10-18 on the live payload, every one of its 433 posts treated
# as new: captions 47,922 in / 8,165 out tokens over three calls = $0.0089
# ($0.00002 a post); 60 thumbnails 31,431 in / 904 out = $0.0036 ($0.00006 a
# post). The roster brings ~150 new posts a day, about half unsure, so a
# steady month is roughly $0.10 of captions and $0.13 of looks, about $0.25.
# Titles are Claude Sonnet 5.5, $2 / $10 per million, for the gaps only: measured
# 2026-11-01 on the live payload, the 475 gaps with their thumbnails over 60 calls
# and 105 second tries, 375,427 in / 22,083 out tokens = $0.97 ($0.002 a post).
# Haiku on the same run cost $0.05 and got three times as many wrong (TITLES
# above). At about 75 gaps a day that is about $4.50 a month, so the whole month
# is about $4.75 and this is the backstop.
AI_MONTH_CAP_USD = 7.0

CP_CHARS = (12, 140)          # a first sentence outside this is a gap: too little to say, or a run-on
CP_MIN_WORDS = 4              # "Two scientists" says nothing, and neither does a bare date
SHORT_LINE_WORDS = CP_MIN_WORDS    # a line this short has to show an English word
STALE_S = 86400               # "tonight" on a post older than this is wrong
WEEK_S = 7 * 86400            # and so is "Friday" on one older than this
NEXT_YEAR_DAYS = 60           # a date this far before its post is next year's: December's "Jan 3"
HD_FIELDS = ("hd", "ad", "hx", "gone", "hs")
HD_WORDS = (3, 8)             # a title outside this is not a title
HD_BATCH = 12                 # posts per title call: each one carries a picture
HD_CAPTION_CHARS = 400        # of each caption the model reads
HD_TOKENS_EACH = 100          # output room per post, thinking included
HD_TIME_S = 90                # no new title call past this: the kinds, the titles and the write share the last minutes of the step
HD_LEAVES_USD = 0.50          # titles stop this far short of the cap, so they can never starve the kinds
MODEL_TIMEOUT_S = 45          # one model attempt: a batch answers in 10 to 20 seconds, and a stall must not eat the step


class Stopped(BaseException):
    """SIGTERM during the model calls. Not an Exception, so nothing on the way
    up (the kind call's catch, ask_json's retry) can take it for a bad answer."""


def log(m: str) -> None:
    print(m, file=sys.stderr, flush=True)


def api_key() -> str | None:
    for var in ("SCRAPECREATORS_API_KEY", "SCRAPE_CREATORS_API_KEY"):
        v = os.environ.get(var)
        if v:
            return v.strip()
    if SECRETS.exists():
        for line in SECRETS.read_text().splitlines():
            m = re.match(r"\s*(SCRAPE_?CREATORS_API_KEY)\s*=\s*(.+)", line)
            if m:
                return m.group(2).strip().strip('"\'')
    return None


def fetch_handle(handle: str, key: str) -> list[dict]:
    url = ENDPOINT + "?" + urllib.parse.urlencode({"handle": handle})
    req = urllib.request.Request(url, headers={"x-api-key": key})
    with urllib.request.urlopen(req, timeout=45) as r:
        doc = json.load(r)
    items = doc.get("items")
    if not isinstance(items, list):
        for k in ("data", "posts", "results"):
            if isinstance(doc.get(k), list):
                items = doc[k]
                break
    return items or []


STP_SIZE = re.compile(r"_([ps])(\d{2,4})x(\d{2,4})(?:_|$)")


def with_size(c: dict) -> dict:
    """A candidate with its width, read from its own URL when the API left it
    off. On 2026-10-16 most photo posts came back with no sizes at all, and
    without one every candidate was skipped and the post was dropped. The
    size is written in the signed `stp` token: `p1080x1080` is the picture
    fitted inside that box (its own shape kept, so no height is claimed),
    `s480x480` a square crop."""
    if not isinstance(c, dict) or c.get("width") or not isinstance(c.get("url"), str):
        return c if isinstance(c, dict) else {}
    try:
        stp = (urllib.parse.parse_qs(urllib.parse.urlparse(c["url"]).query).get("stp") or [""])[0]
    except Exception:
        return c
    m = STP_SIZE.search(stp)
    if not m:
        return c
    out = dict(c, width=int(m.group(2)))
    if m.group(1) == "s":
        out["height"] = int(m.group(3))
    return out


def pick_thumb(item: dict) -> tuple[str | None, int | None]:
    """The smallest candidate at or above WANT_W — a 20 KB picture instead of
    a 1.3 MB one. Falls back to whatever single URL is on offer.

    A reel offers a 9:16 and a square crop at the same width; the one in the
    post's own shape wins, so a reel's poster is the reel's frame."""
    cands = ((item.get("image_versions2") or {}).get("candidates")) or []
    sized = [c for c in (with_size(c) for c in cands) if c.get("url") and c.get("width")]
    ow, oh = item.get("original_width"), item.get("original_height")
    shape = (oh / ow) if isinstance(ow, (int, float)) and isinstance(oh, (int, float)) and ow > 0 else None

    def off_shape(c: dict) -> float:
        if not shape or not c.get("height"):
            return 0.0
        return abs(c["height"] / c["width"] - shape)

    if sized:
        at_or_above = sorted((c for c in sized if c["width"] >= WANT_W),
                             key=lambda c: (c["width"], off_shape(c) > 0.02))
        chosen = at_or_above[0] if at_or_above else max(sized, key=lambda c: c["width"])
        return chosen["url"], chosen.get("width")
    for k in ("display_url", "thumbnail_url", "image"):
        if item.get(k):
            return item[k], None
    return None, None


def caption_of(item: dict) -> str:
    c = item.get("caption")
    if isinstance(c, dict):
        c = c.get("text")
    if not isinstance(c, str):
        c = item.get("edge_media_to_caption", {})
        try:
            c = c["edges"][0]["node"]["text"]
        except Exception:
            c = ""
    return " ".join((c or "").split())


def taken_at(item: dict) -> int | None:
    for k in ("taken_at", "taken_at_timestamp", "device_timestamp"):
        v = item.get(k)
        if isinstance(v, (int, float)) and v > 1_000_000_000:
            return int(v)
    # No timestamp on the record (the tagged-posts endpoint): decode the
    # media id. Verified against posts carrying both: within ~6 minutes.
    pk = item.get("pk") or item.get("id")
    try:
        pk = int(str(pk).split("_")[0])
    except (TypeError, ValueError):
        return None
    if pk <= 0:
        return None
    ts = ((pk >> 23) + IG_EPOCH_MS) // 1000
    return ts if ts > 1_300_000_000 else None


def fetch_tagged(key: str) -> list[dict]:
    """Newest page of posts that tag @btownbrief — ten or so, one credit."""
    url = TAGGED_ENDPOINT + "?" + urllib.parse.urlencode({"user_id": TAGGED_USER_ID})
    req = urllib.request.Request(url, headers={"x-api-key": key})
    with urllib.request.urlopen(req, timeout=45) as r:
        doc = json.load(r)
    items = doc.get("posts")
    if not isinstance(items, list):
        items = doc.get("items") if isinstance(doc.get("items"), list) else []
    return items or []


def tagged_record(it: dict, cutoff: float, now: float | None = None, national: bool = False) -> dict | None:
    handle = ((it.get("user") or {}).get("username") or "").strip().lstrip("@").lower()
    if not handle:
        return None
    ts = taken_at(it)
    if not ts or ts < cutoff:
        return None
    thumb, w = pick_thumb(it)
    if not thumb:
        return None
    code = code_of(it)
    rec = {
        "h": handle,
        "ts": ts,
        "i": thumb,
        "u": f"https://www.instagram.com/p/{code}/" if code
             else f"https://www.instagram.com/{handle}/",
        "s": "tagged",
    }
    if w:
        rec["w"] = w
    cap = caption_of(it)
    if cap:
        rec["c"] = cap[:1000]
    if it.get("media_type") == 2 or it.get("is_video"):
        rec["v"] = 1
        add_video(rec, it, now if now is not None else time.time())
    if it.get("is_paid_partnership") is True or is_ad({"c": cap, "n": national}):
        rec["ad"] = 1
    return rec


def code_of(item: dict) -> str | None:
    return item.get("code") or item.get("shortcode") or None


def pick_video(item: dict) -> str | None:
    """The smallest playable candidate. Instagram lists them biggest first
    and has been seen sending three copies of one file with no sizes at all,
    so an unsized candidate sorts after every sized one and ties keep the
    list's order."""
    cands = [c for c in (item.get("video_versions") or [])
             if isinstance(c, dict) and isinstance(c.get("url"), str) and c["url"].startswith("https://")]
    if not cands:
        return None
    big = float("inf")
    best = min(enumerate(cands), key=lambda ic: (
        (ic[1].get("width") or big) * (ic[1].get("height") or 1), ic[0]))
    return best[1]["url"]


def add_video(rec: dict, item: dict, now: float) -> None:
    """Give a video post its MP4: `vu`, `ve` and `vd`. Fails closed: a video
    URL whose expiry cannot be read, or that lapses inside the carry margin,
    is left off, and the post stays a photo (it is still marked `v` so the
    tab can say it is a reel)."""
    url = pick_video(item)
    exp = signature_expiry(url) if url else None
    if not url or not exp or exp - now < CARRY_MARGIN_H * 3600:
        return
    rec["vu"] = url
    rec["ve"] = exp
    dur = item.get("video_duration")
    if isinstance(dur, (int, float)) and dur > 0:
        rec["vd"] = round(float(dur), 1)


def video_ok(rec: dict, now: float) -> bool:
    """Is a post's video still worth shipping? The same margin as a carried
    picture: refuse anything about to lapse."""
    exp = rec.get("ve")
    return (isinstance(rec.get("vu"), str) and isinstance(exp, (int, float))
            and exp - now >= CARRY_MARGIN_H * 3600)


def drop_video(rec: dict) -> dict:
    for k in ("vu", "ve", "vd"):
        rec.pop(k, None)
    return rec


def signature_expiry(url: str) -> int | None:
    """When Instagram's CDN stops serving this URL, as an epoch second.

    Every signed URL carries `oe`, a hex epoch. Reading it is better than
    assuming a lifetime: it is the CDN's own answer, per image, and it is what
    makes carrying posts forward safe rather than hopeful."""
    try:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    except Exception:
        return None
    oe = (q.get("oe") or [None])[0]
    if not oe:
        return None
    try:
        return int(oe, 16)
    except ValueError:
        return None


def carry_ok(rec: dict, now: float, cutoff: float) -> bool:
    """Is a post from a previous payload still worth shipping?

    Four ways to fail: the record is malformed, the post itself aged out of
    the window, the signature is about to expire (a grid of 403s is worse
    than a shorter grid), or the signature cannot be READ at all.

    That last one fails CLOSED, which is the opposite of what a fresh post
    gets. A fresh URL was just handed to us and works; a carried one is a
    claim about the future, and a URL whose `oe` we cannot parse is a claim
    we cannot check. Every post in the live payload carries a parseable `oe`,
    so this costs nothing today and stops a signing-format change from
    quietly shipping a wall of expired images."""
    if not isinstance(rec, dict) or not rec.get("h"):
        return False
    img = rec.get("i")
    if not isinstance(img, str) or not img:
        return False
    ts = rec.get("ts")
    if not isinstance(ts, (int, float)) or ts < cutoff:
        return False
    exp = signature_expiry(img)
    if exp is None or exp - now < CARRY_MARGIN_H * 3600:
        return False
    return True


def post_record(h: str, it: dict, cutoff: float, now: float | None = None, national: bool = False) -> dict | None:
    """One rostered account's post as the payload keeps it, or None when it
    is too old or has no picture. The ad rules read the whole caption here:
    `c` is cut to 1,000 characters and a #ad often sits at the very end."""
    ts = taken_at(it)
    if not ts or ts < cutoff:
        return None
    thumb, w = pick_thumb(it)
    if not thumb:
        return None
    code = code_of(it)
    rec = {
        "h": h,
        "ts": ts,
        "i": thumb,
        "u": f"https://www.instagram.com/p/{code}/" if code
             else f"https://www.instagram.com/{h}/",
    }
    if w:
        rec["w"] = w
    cap = caption_of(it)
    if cap:
        rec["c"] = cap[:1000]
    likes = it.get("like_count")
    if isinstance(likes, int) and likes > 0:
        rec["l"] = likes        # the Wire's feeds lead with an account's best, not its latest
    if it.get("media_type") == 2 or it.get("is_video"):
        rec["v"] = 1
        add_video(rec, it, now if now is not None else time.time())
    if it.get("is_paid_partnership") is True or is_ad({"c": cap, "n": national}):
        rec["ad"] = 1
    return rec


def own_name(h: str, items: list[dict], national: bool) -> str:
    """The account's profile name, from the first post it owns, or "". A
    collab comes back under the other party, and a person's name on a local
    account stays off the page."""
    for it in items:
        user = it.get("user") or it.get("owner") or {}
        if norm_handle(user.get("username")) == h:
            name = clean_name(user.get("full_name"))
            return "" if not national and names_private(name) else name
    return ""


def clean_name(raw: object) -> str:
    """A profile name as a reader should see it: plain letters, no emoji, and
    no tagline after a bar or a bullet ("Michelle Kolbeck | DIY • IKEAHACK").
    Anything still past 40 characters stops at a whole word."""
    t = "".join(ch for ch in plain_letters(str(raw or ""))
                if unicodedata.category(ch) not in ("So", "Sk", "Cs", "Co", "Cf", "Me"))
    t = NAME_BREAK.split(" ".join(t.split()))[0]
    if len(t) > 40:
        t = t[:41].rsplit(" ", 1)[0]
    words = t.strip(" .,;:&+-\u2013\u2014").split()
    while words and words[-1].lower() in DANGLES:
        words.pop()
    return " ".join(words) if any(ch.isalpha() for ch in t) else ""


def norm_handle(h: object) -> str:
    return str(h or "").strip().lstrip("@").lower()


def merch_post(rec: dict) -> bool:
    """A breed page's "link in bio" is a tee or a mug, not a dog. Bigger
    accounts link to their stories that way, so this is for Beagles and Labs."""
    return bool(LINK_IN_BIO.search(rec.get("c") or ""))


def load_block() -> set[str]:
    """Handles whose tagged posts never land. Same file as the roster, so
    there is one place to look."""
    try:
        raw = json.loads(ROSTER.read_text(encoding="utf-8"))
        got = raw.get("tagged_block") or []
        return {norm_handle(h) for h in got if norm_handle(h)}
    except Exception:
        return set()


def load_hints(accounts: list[dict]) -> dict[str, set[str]]:
    """The roster's second opinions about an account, for the kind prompt:
    `photo_categories` (a cat cafe is also pets and a vibe check) and the
    `food` flag on a bar or a brewery."""
    out: dict[str, set[str]] = {}
    try:
        tags = json.loads(ROSTER.read_text(encoding="utf-8")).get("photo_categories") or {}
    except Exception:
        tags = {}
    for tag, hs in tags.items() if isinstance(tags, dict) else ():
        if tag.startswith("_") or not isinstance(hs, list):
            continue
        for h in hs:
            if norm_handle(h):
                out.setdefault(norm_handle(h), set()).add(tag)
    for a in accounts:
        if a["food"] and a["category"] != "food":
            out.setdefault(a["h"], set()).add("food")
    return out


def fair_cap(recs: list[dict], n: int) -> list[dict]:
    """At most `n` posts, filled one per account at a time: every account's
    newest, then every account's second newest, and so on, newest first
    within a round. Newest-first alone let a daily account push a weekly
    one's still-good posts out of the payload."""
    rank: dict[str, int] = {}
    ranked = []
    for r in sorted(recs, key=lambda r: -r["ts"]):
        k = rank.get(r["h"], 0)
        rank[r["h"]] = k + 1
        ranked.append((k, -r["ts"], r))
    ranked.sort(key=lambda t: (t[0], t[1]))
    return [r for _, _, r in ranked[:n]]


def load_roster(path: pathlib.Path | None = None) -> list[dict]:
    """The roster's `accounts`, cleaned: one dict per handle with `h`, `tier`,
    `category`, `s` (`do` or `see`, kept on posts for older readers), `food`,
    `national`, and the optional `interest`, `breed` and `name`.

    A typo must not stop a build or cost money, so bad values fail CHEAP: an
    unknown tier becomes 3 (the least often fetched), an unknown category
    becomes `other`, and a handle listed twice keeps its first entry. Each is
    warned about."""
    doc = json.loads((path or ROSTER).read_text(encoding="utf-8"))
    out, seen, dupes, fixed = [], set(), [], []
    for a in doc.get("accounts") or []:
        if not isinstance(a, dict):
            continue
        h = norm_handle(a.get("h"))
        if not h or not re.fullmatch(r"[a-z0-9_.]{1,30}", h):
            fixed.append(f"bad handle {a.get('h')!r} dropped")
            continue
        if h in seen:
            dupes.append(h)
            continue
        seen.add(h)
        tier = a.get("tier")
        if tier not in TIERS or isinstance(tier, bool):
            fixed.append(f"{h}: tier {tier!r} -> 3")
            tier = 3
        cat = a.get("category")
        if cat not in CATEGORIES:
            fixed.append(f"{h}: category {cat!r} -> other")
            cat = "other"
        national = a.get("national") is True or cat == "national"
        if national:
            cat = "national"
        out.append({"h": h, "tier": tier, "category": cat,
                    "s": "see" if a.get("s") == "see" else "do",
                    "food": not national and (cat == "food" or a.get("food") is True),
                    "national": national,
                    "interest": a["interest"] if a.get("interest") in INTERESTS else None,
                    "breed": a["breed"] if a.get("breed") in BREEDS else None,
                    "name": " ".join(str(a.get("name") or "").split())[:40] or None})
    if dupes:
        log(f"WARNING: {len(dupes)} duplicate handle(s), first entry kept: {', '.join(dupes[:6])}")
    if fixed:
        log(f"WARNING: {len(fixed)} roster fix(es): {'; '.join(fixed[:6])}")
    return out


# -------------------------------------------------------------------- kind

KIND_RULES = """You sort Instagram posts from Burlington, Vermont accounts into the kind of
PICTURE each one is, for a photo wall with these filters:

vibe    what a place or a night looks like right now: a bar, a cafe or a venue's
        room, a crowd, a band on stage, people out, a patio, a storefront
poster  a flyer or graphic announcing a dated event: a lineup, a show, a market
        day, a class, trivia night, with the date or time usually in the picture
food    food or drink is the subject: a plate, a pastry, a coffee, a pour, a special
pets    an animal is the subject: a cat, a dog, an adoptable pet
scenic  the lake, a sunset, the mountains, foliage, streets, buildings, weather
other   anything else: clothing and goods for sale, portraits, merch, hiring
        notices, announcements with no event, memes, text that is not an event

The account's category is a hint, not the answer. A cat cafe's latte is food, a
restaurant's trivia flyer is a poster, a brewery's crowded taproom is vibe. A
caption describes the post but not always the picture: "join us Friday" may sit
on a flyer or on a photo of last week's crowd. Say sure=false whenever the
caption does not settle what the picture shows.

ad, for a national post only (category national): true when it is mostly selling
something, the account's own prints, books, merch, courses or products included, or
is a paid partnership, a gifted post, a discount code or a brand's plug. "Presented by"
a brand, "Buy ... NOW" at a site, and thanks to a clothing label for an outfit are all
ads. A recipe, a clip or a story with one plug at the end is not an ad. Any other post:
false.

sad, for a national post only (category national): true when the post touches a death,
grief, an injury, abuse, or politics, even as a joke or an aside. A pet that died or was
hurt, a stray found in a bad way, a fundraiser for a vet bill, a tribute, a fan mocking a
tragedy, an elected leader, a law, an election, ballots or a reminder to vote, ICE, MAGA
and a satire of any of these all count. A sports knock that is only a moment in a game
does not, nor does a dog that looks sad for a treat. A Burlington post: true only for an
election, a candidate, a ballot question or a reminder to vote. Nothing else counts there."""

LOOK_RULES = KIND_RULES + """

Now you can see each picture. Judge by the picture itself; use the caption only
to break a tie."""


def kind_schema(sure: bool) -> dict:
    props = {"i": {"type": "integer"}, "kind": {"type": "string", "enum": list(KINDS)}}
    if sure:
        props["sure"] = {"type": "boolean"}
        props["ad"] = {"type": "boolean"}
        props["sad"] = {"type": "boolean"}
    return {"type": "object", "additionalProperties": False, "required": ["kinds"],
            "properties": {"kinds": {"type": "array", "items": {
                "type": "object", "properties": props, "required": list(props),
                "additionalProperties": False}}}}


def kind_line(i: int, rec: dict, hints: dict) -> str:
    also = sorted(hints.get(rec["h"], ()))
    what = "reel" if rec.get("v") else "photo"
    c = rec.get("c") or ""
    cap = c[:CAPTION_CHARS] or "(no caption)"
    if rec.get("n") and len(c) > CAPTION_CHARS:       # a plug sits at the end
        cap += " \u2026 " + c[max(CAPTION_CHARS, len(c) - CAPTION_TAIL):]
    return (f"{i}. @{rec['h']} · {rec.get('category') or 'other'}"
            + (f" (also {', '.join(also)})" if also else "") + f" · {what} · {cap}")


def read_kinds(raw: object, n: int, sure: bool) -> dict[int, tuple[str, bool, bool, bool]]:
    """The model's answer -> {index: (kind, sure, ad, sad)}. A bad index, a repeat
    or an unknown kind is dropped, and that post simply keeps its default."""
    out = {}
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict):
            continue
        i = e.get("i")
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < n or i in out:
            continue
        if e.get("kind") not in KINDS:
            continue
        out[i] = (e["kind"], e.get("sure") is True if sure else True, e.get("ad") is True, e.get("sad") is True)
    return out


def sniff_image(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def fetch_thumb(url: str) -> tuple[str, str] | None:
    """(media type, base64) of a thumbnail, or None. Sent as bytes rather
    than a URL so the answer never depends on who else Instagram's CDN will
    serve."""
    import base64
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read(IMAGE_MAX_BYTES + 1)
    except Exception:
        return None
    mt = sniff_image(data) if len(data) <= IMAGE_MAX_BYTES else None
    return (mt, base64.b64encode(data).decode("ascii")) if mt else None


def post_key(rec: dict) -> str:
    """A post's identity: its post URL, or (no shortcode) handle and time."""
    u = rec.get("u") or ""
    return "u:" + u if "/p/" in u else f"t:{rec.get('h')}:{rec.get('ts')}"


def ai_spent(ledger: dict | None, now: float) -> float:
    ai = (ledger or {}).get("ai") or {}
    return float(ai.get("usd") or 0) if ai.get("month") == month_key(local_day(now)) else 0.0


def record_ai(ledger: dict, now: float, run: dict, usd: float) -> None:
    """Add one run's model spend to the ledger's `ai` block."""
    month = month_key(local_day(now))
    ai = ledger.get("ai")
    if not isinstance(ai, dict) or ai.get("month") != month:
        ai = {"month": month, "usd": 0.0, "runs": []}
    ai["usd"] = round(ai["usd"] + usd, 6)
    ai["runs"].append({"at": dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(timespec="seconds"), **run})
    ledger["ai"] = ai


def assign_kinds(posts: list[dict], prev_kinds: dict, hints: dict,
                 ledger: dict | None, now: float, look: bool = True) -> dict:
    """Give every post a `kind`. Returns what the run did and spent.

    A post keeps a kind it already has, or the one it had in the last
    payload (`prev_kinds`, by post_key: a tier 2 account's posts come back
    every day; they are judged once). The rest start at their category's
    kind, marked `kd`, and are sent to the model, one question per post even
    when it ships twice (a rostered account's post that also tags the
    Brief); a valid answer replaces the default and clears `kd`."""
    todo, twins = [], {}
    for rec in posts:
        known = rec.get("kind") if not rec.get("kd") else None
        known = known or prev_kinds.get(post_key(rec))
        if known in KINDS:
            rec["kind"] = known
            rec.pop("kd", None)
            continue
        rec["kind"] = KIND_OF_CATEGORY.get(rec.get("category"), "other")
        rec["kd"] = 1
        k = post_key(rec)
        if k in twins:
            twins[k].append(rec)
        else:
            twins[k] = [rec]
            todo.append(rec)
    report = {"asked": 0, "looked": 0, "decided": 0, "usd": 0.0}
    if not todo:
        return report
    try:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import wire_common as wc
    except Exception as e:
        log(f"kind: wire_common unavailable ({str(e)[:60]}); {len(todo)} post(s) keep their category's kind")
        return report
    engine = wc.pick_engine("tag")
    if engine is None:
        log(f"kind: no model key; {len(todo)} post(s) keep their category's kind")
        return report
    if ai_spent(ledger, now) >= AI_MONTH_CAP_USD:
        log(f"kind: ${ai_spent(ledger, now):.2f} spent this month (cap ${AI_MONTH_CAP_USD:.2f}); "
            f"{len(todo)} post(s) keep their category's kind")
        return report

    usage = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "calls": 0}

    def over_cap(what):
        spent = ai_spent(ledger, now) + wc.cost_usd(engine["model"], usage)
        if spent >= AI_MONTH_CAP_USD:
            log(f"kind: the month's cap (${AI_MONTH_CAP_USD:.2f}) reached; no {what} call")
            return True
        return False

    def ask(system, user, schema, n, sure, label):
        try:
            answer, got = wc.ask_json(engine, system, user, schema, max_tokens=60 * n + 500,
                                      log_prefix="kind", timeout=MODEL_TIMEOUT_S)
        except Exception as e:  # noqa: BLE001 — SDK missing, network, a bad answer
            got = getattr(e, "usage", {}) or {}
            answer = None
            log(f"kind: {label} call failed ({str(e)[:80]})")
        for k in usage:
            usage[k] += got.get(k, 0)
        return read_kinds(answer.get("kinds") if isinstance(answer, dict) else None, n, sure)

    try:
        # The picture itself settles what a caption cannot. Claude only: the
        # OpenRouter fallback reads text, so there a caption's guess is final.
        can_look = look and engine["provider"] == "anthropic"
        unsure = []
        for start in range(0, len(todo), KIND_BATCH):
            if over_cap("caption"):
                break
            batch = todo[start:start + KIND_BATCH]
            text = "POSTS:\n" + "\n".join(kind_line(i, r, hints) for i, r in enumerate(batch))
            got = ask(KIND_RULES, text, kind_schema(True), len(batch), True, "caption")
            report["asked"] += len(batch)
            for i, rec in enumerate(batch):
                if i not in got:
                    continue
                kind, sure, ad, sad = got[i]
                rec["kind"] = kind          # unsure: the caption's best guess while it waits for a look
                if ad and rec.get("n"):
                    rec["ad"] = 1
                if sad and (rec.get("t") or not rec.get("n")):
                    rec["sad"] = 1
                if sure or not can_look:
                    rec.pop("kd", None)
                else:
                    unsure.append(rec)

        if unsure and not over_cap("image"):
            # At most IMAGE_LOOK_MAX downloads, newest first, inside a deadline:
            # a CDN that hangs must not eat the step's timeout before the
            # payload is written.
            shown, content = [], []
            deadline = time.monotonic() + 90
            for rec in sorted(unsure, key=lambda r: -r["ts"])[:IMAGE_LOOK_MAX]:
                if time.monotonic() > deadline:
                    log("kind: thumbnail downloads ran out of time")
                    break
                pic = fetch_thumb(rec["i"])
                if not pic:
                    continue
                content.append({"type": "text", "text": "Image " + kind_line(len(shown), rec, hints)})
                content.append({"type": "image", "source": {"type": "base64",
                                                            "media_type": pic[0], "data": pic[1]}})
                shown.append(rec)
            if shown:
                content.append({"type": "text", "text": f"Give the kind of each of the {len(shown)} images."})
                got = ask(LOOK_RULES, content, kind_schema(False), len(shown), False, "image")
                report["looked"] = len(shown)
                for i, rec in enumerate(shown):
                    if i in got:
                        rec["kind"] = got[i][0]
                        rec.pop("kd", None)
    finally:
        # A post nobody looked at (past IMAGE_LOOK_MAX, a thumbnail that would
        # not download, the cap) keeps the caption's guess, still marked `kd`,
        # and is asked again next run. The spend lands here however the calls
        # ended: SIGTERM must not lose what has been paid for.
        for rec in todo:
            for twin in twins[post_key(rec)][1:]:
                twin["kind"] = rec["kind"]
                for flag in ("ad", "sad"):
                    if rec.get(flag):
                        twin[flag] = 1
                if rec.get("kd"):
                    twin["kd"] = 1
                else:
                    twin.pop("kd", None)

        report["decided"] = sum(1 for r in todo if not r.get("kd"))
        usd = wc.cost_usd(engine["model"], usage)
        report["usd"] = usd
        if ledger is not None and (usage["calls"] or usage["in"]):
            record_ai(ledger, now, {"model": engine["model"], "asked": report["asked"], "looked": report["looked"],
                                    "in": usage["in"], "out": usage["out"], "usd": round(usd, 6)}, usd)
        log(f"kind: {report['decided']} of {len(todo)} new post(s) decided ({report['asked']} by caption, "
            f"{report['looked']} looked at) · {usage['in']:,} in / {usage['out']:,} out tokens · "
            f"${usd:.4f} this run · ${ai_spent(ledger, now) if ledger else usd:.2f} this month")
    return report


# ----------------------------------------------------------------- caption

HANDLE = re.compile(r"(?<![\w&.])@[\w.]*\w")
HASHTAG = re.compile(r"(?<![\w&])#\w*[^\W\d]\w*")   # "#1 in the league" is a number
AT_HOLE, TAG_HOLE = "\x00", "\x01"   # where each stood, until the sentence is known
SENTENCE_END = re.compile(r"[.!?\u2026]+[\"'\u201d\u2019)]*(?=\s|$)")
NOT_THE_END = set("st mt ft dr mr mrs ms jr sr no vs ave rd jan feb mar apr jun jul aug sep sept oct nov dec "
                  "mon tue tues wed thu thur thurs fri sat sun inc co am pm pres feat prod dept gov sen rep prof "
                  "capt sgt lt gen col blvd hwy ste apt bros corp ltd".split())
INITIALS = re.compile(r"(?:[a-z]\.)+[a-z]")     # D.C., U.S., a.m.
# A line that stops on one of these lost what came after: "Pack the Gut pres".
WANTS_A_NAME = set("pres feat ft vs mr mrs ms dr mt".split())
# A line cannot stop on these: the emoji or the tag that ended it cut it off.
DANGLES = set("a an the and or of at in on to for with from by w/ & are is was were be been am but that which who "
              "whose because starting until till including featuring plus as if when while than your our my their "
              "his her its this these those will can would should could have has had not very next".split())
# ...and these want the object a stripped hashtag took with it.
WANTS_OBJECT = DANGLES | set("support supporting love loving visit visiting thank thanks welcome welcoming meet join "
                             "joining try trying celebrate celebrating honor honoring congrats congratulations "
                             "shoutout".split())
ENGLISH = set("the a an and of to in is it for on with at this that you we i my our your are was be have has from "
              "by not but so just all new who what when how they he she his her its as or if me out up can will "
              "get got".split())
FOREIGN = set("le les des du et est avec une dans sur que qui nous vous pas tr\u00e8s mais \u00eatre ce cette il elle "
              "quand au aux hein tout el los las es para una por del pero como esta este m\u00e1s ich und der das ist "
              "nicht mit ein eine f\u00fcr auf aus einem euch wir hai hain nahi nahin kya kyu kyun aur liye bhi yaar kaise kuch "
              "hoon tha thi wala wali bhai mera meri tera teri apna apni ka ke ko mein hum humare hamare tum aap yeh woh "
              "ek se toh bahut accha acha pyar dost ghar feliz navidad todos todas nuestros nuestras amigos amigas gracias muy hola natal nossos nossas obrigado "
              "obrigada voc\u00ea uma joyeux no\u00ebl tous nos amis merci bonjour frohe weihnachten alle unsere freunde "
              "danke".split())
# A brand's "#AcmePartner" is declared; a life partner is not.
AD_DECLARED = re.compile(r"(?<!\w)#(?:ads?|paidad|sponsored|sponsoredpost|sponsor|gifted(?:by\w*)?|paidpartnership|"
                         r"(?!(?:life|dance|dancing|business|work|gym|training|running|hiking|climbing|study|crime|"
                         r"sparring|tennis|pickleball|golf|doubles|soul)partner\b)\w+partner)\b|"
                         r"\[ ?a ?d ?\]|\bpaid partnership\b|^\s*(?:paid )?(?:ad|sponsored)\s*:", re.I)
AD_PLUGGED = re.compile(r"(?i:\buse (?:my |our )?code\b|\bsponsored by\b|\bpresented by\b)|(?i:\bbuy\b).{0,60}\bNOW\b|"
                        r"(?i:\bcomment\s+)[\"'\u2018\u201c]?[A-Z]{3,}\b(?i:.{0,30}\b(?:send|link|dm)\b)")   # "comment SHOP and I'll send the link"
NAME_BREAK = re.compile(r"\s*[|\u2022\u00b7/,]\s*|\s+[-\u2013\u2014:]\s+")
# Asks instead of says. A venue's "Join us Friday" is neither: it says what is on.
CALL_TO_ACTION = re.compile(
    r"\b(?:dm (?:us|me)|message (?:us|me)|link in (?:my |our |the )?bio|check (?:the )?caption|comment [\"'\u2018\u201c]|"
    r"tag (?:a|your) \w+|save this|shop now|order now|buy now|in the comments|scroll (?:if|down|to|for))\b", re.I)
# A caption that opens on the order. A title may: its "Shop" is a noun.
OPENS_ON_AN_ORDER = re.compile(
    r"^(?:comment|dm|tag|follow|save|share|click|tap|swipe|subscribe|sign up|register|shop|order|buy|drop your|"
    r"grab your|get your|check (?:out|the caption)|don['\u2019]?t miss|see (?:the )?link|link in)\b", re.I)
# A first sentence that could sit under any picture.
SAYS_NOTHING = re.compile(r"^(?:it['\u2019]?s that time|that time of (?:the )?year|came for\b|you know what (?:time|day)|"
                          r"guess wh(?:at|o)\b|big news\b|we have news\b|the wait is over\b|here we go\b)", re.I)
# What the kind call's `sad` can miss on a joke or a stray tag: it read past the
# Onion's "ICE Agent..." and a comic's #maga on 2026-11-01.
SAD_WORDS = re.compile(r"\b(?:ice agents?|ice raids?|trump|biden|maga|ballots?|election day|oval office|white house|"
                       r"washington,? d\.?c\b\.?|congress|republicans?|democrats?|"
                       r"rest in peace|rest easy|we mourn|passed away|diarrh?ea|vomit\w*)(?!\w)", re.I)
# The same for a local post, which only an election makes unfit for the wall.
ELECTION_WORDS = re.compile(r"\b(?:elections?|ballots?|voters?|candidates?|midterms?|early voting|get out the vote|go vote)\b", re.I)
# Accounts whose caption is not about the picture: Dad Says Jokes opens every joke
# on a paragraph of filler ("Star Wars became hugely popular..." under an ultrasound
# gag) and a serial's caption is only its number. Their line comes from the picture.
CAPTION_SAYS_NOTHING = {"dadsaysjokes", "shencomix"}
WEEKDAY = r"(?:mon|tues|wednes|thurs|fri|satur|sun)(?:day)?"
RELATIVE_DAY = re.compile(rf"\b(?:tonight|tonite|today|tomorrow|tmrw|yesterday|last night|this (?:{WEEKDAY}|morning|"
                          rf"afternoon|evening|weekend|week|month)|next (?:{WEEKDAY}|week|weekend|month))\b", re.I)
# A title stays up for days, so a day of the week is as relative as "tonight".
# "every Thursday" and a name are not.
NAMED_DAY = re.compile(r"\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b", re.I)
A_NAME_NOT_A_DAY = re.compile(r"\b(?:every|black|cyber|super|good|ash|palm|easter|new music)\s+\w+day\b|"
                              r"\b\w+day night (?:live|football|raw|baseball)\b|\bfriday the 13th\b", re.I)
MONTH = (r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
         r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)")
MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split()
DAY_OF_MONTH = r"(\d{1,2})(?:st|nd|rd|th)?(?![\d/]|:\d)(?!\s*(?:am|pm)\b)"     # "Oct 30:" is a date, "Oct 3:30" is not
# "Oct 23", "October 28-31", "Oct 26 to Nov 1", "Oct 29 and 30", "Thursday, October 29, 2026"
NAMED_DATE = re.compile(rf"\b{MONTH}\b\.?\s+{DAY_OF_MONTH}(?:\s*(?:-|\u2013|\u2014|to|through|thru|and|&)\s*"
                        rf"(?:{MONTH}\b\.?\s+)?{DAY_OF_MONTH})?(?:,?\s+(20\d\d)\b)?", re.I)
# A bare 10/16 needs a weekday or the like in front of it: 3/4 is a cup and 10/10 a good dog.
SLASH_DATE = re.compile(r"(?:\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?[.,!]*\s*\(?|\(|\bon\s+|"
                        r"\b(?:tonight|today|only)\b[!:,\s-]*)(\d{1,2})/(\d{1,2})\b", re.I)
FULL_DATE = re.compile(r"\b(\d{1,2})[-./](\d{1,2})[-./](20\d\d|2\d)\b")      # 10-31-2026, 10/29/26
# A holiday is the date when nothing else gives one, and Thanksgiving's is worked out.
HOLIDAYS = ((re.compile(r"\bhall\w*ween\b|\btrick[- ]or[- ]treat", re.I), 10, 31),
            (re.compile(r"\bchristmas\b|\bxmas\b", re.I), 12, 25),
            (re.compile(r"\bnew year['\u2019]?s eve\b|\bnye\b", re.I), 12, 31),
            (re.compile(r"\bvalentine['\u2019]?s\b", re.I), 2, 14))
THANKSGIVING = re.compile(r"\bthanksgiving\b", re.I)


ROSTER_TEXT: str | None = None    # every handle, read once: see rostered()
PLACE_WORDS = NOT_SURNAME - {"night", "day", "week", "show"}      # "Pam McDonald Day" is still Pam
# title_guard reads a first name and a capitalized word as a person. These are
# the ones that are not: "Ethan Allen Park", "the Seth Yacovone Band", "Penny
# Cluse Cafe", and a few names that only ever mean a place, a brand or a job.
NAMED_PLACE = re.compile(
    r"\b[A-Z][\w\u2019'-]+\s+[A-Z][\w\u2019'-]+\s+(?:" + "|".join(sorted(w.title() for w in PLACE_WORDS)) + r"|"
    r"Band|Trio|Quartet|Orchestra|Bakery|Bistro|Boutique|Brewing|Cafe|Collective|Company|Co|Coffee|Distillery|"
    r"Foundation|Gallery|Grill|Homestead|Institute|Lounge|Museum|Orchard|Photography|Restaurant|Salon|Studio|"
    r"Studios|Tavern|Vineyard|Vintage|Winery)\b(?!\s+(?:Manager|Owner|Director|Chef|Captain|Coordinator|Assistant|Lead)\b)")
NOT_NEIGHBORS = re.compile(r"\b(?:Ethan Allen|Ira Allen|Elijah Craig|Norman Rockwell|Shirley Temple|Deputy Mayor)\b")
# title_guard knows a list of first names, and Burlington's are not all on it. So
# a full name is also read from how it is used: thanked, introduced, credited,
# listed, or doing what a shop does not do. Two capitalized words alone prove
# nothing here: half of Church Street reads that way, and a miss on a shop costs
# its line. A first name alone is fine, except a customer's (FOR_SOMEONE).
NAME_WORD = r"[A-Z\u00c0-\u00de][\w'\u2019-]*[a-z\u00df-\u00ff]"
FULL_NAME = rf"({NAME_WORD})\s+({NAME_WORD})"
CREDIT = (r"(?i:\b(?:meet|thanks? to|thank you|congrats(?: to)?|congratulations(?: to)?|shout ?outs? to|"
          r"(?:art|work|photos?|words|led|hosted|taught|painted|made) by|runner|player|captain|student|teacher|barista|bartender)\s+)")
CREDITED = re.compile(CREDIT + FULL_NAME + r"\b")
ACTS_LIKE_A_PERSON = re.compile(FULL_NAME + r"\s+(?:(?:discuss|talk|retire|graduate|level|commit|recall|reflect)\w*\b|"
                                r"[a-z]+\s+(?:her|his)\b)")
LISTED = re.compile(rf"{NAME_WORD}\s+{NAME_WORD}(?:(?:,\s+|,?\s+and\s+){NAME_WORD}\s+{NAME_WORD}){{2,}}")   # two is a band bill
LOWER_CREDITED = re.compile(r"(?i:\b(?:thanks? to|thank you|congrats(?: to)?|congratulations(?: to)?|shout ?outs? to|meet)\s+)"
                            r"([a-z]+)\s+([a-z]+)\b")
# A shop's customer goes by a first name, and that is still a neighbor: "Flying fish
# for Oliver". A title can say what was made; a line ending on who it was for cannot.
FOR_SOMEONE = re.compile(rf"\bfor\s+({NAME_WORD})(?:['\u2019]s\b.*)?\W*$")
NOT_A_PERSON = PLACE_WORDS | ENGLISH | WANTS_OBJECT | set(
    "our my your all everyone everybody team crew staff friends family club society league group union bank credit "
    "brewers brewing brewery company consulting creative design designs media press records books bikes cycles farm "
    "farms market foods food kitchen coffee tea wine cider beer spirits arts art music theatre theater dance community "
    "city town county state vermont burlington winooski shelburne stowe montpelier williston essex middlebury "
    "champlain green mountain mountains new old north south east west big little great good best santa claus "
    "halloween christmas thanksgiving january february march april may june july august september october november "
    "december monday tuesday wednesday thursday friday saturday sunday uvm".split())


def is_english(text: str) -> bool:
    """A cheap read of a caption's language: its script, then its small words.
    Two of a foreign list's words, outnumbering the English ones, say it is
    not; a plain noun phrase has neither and stands, and "Main Street" or "Big
    Sur" is one word short of tripping it. Measured on the live payload's
    French, German and Hindi-English accounts, 2026-11-01."""
    letters = [ch for ch in text if ch.isalpha()]
    if sum(ord(ch) > 0x24F for ch in letters) > 0.3 * len(letters):
        return False
    words = re.findall(r"[^\W\d_]+", text.lower())
    foreign = sum(w in FOREIGN for w in words)
    return foreign < 2 or sum(w in ENGLISH for w in words) >= foreign


def unproved(line: str) -> bool:
    """A line of bare minimum length with not one small English word: "Ek se
    bhale do". A plain noun phrase lands here too, and all that costs is a title."""
    words = re.findall(r"[^\W\d_]+", line.lower())
    return len(words) <= SHORT_LINE_WORDS and not any(w in ENGLISH for w in words)


def foreign_script(text: str) -> bool:
    return any(ch.isalpha() and ord(ch) > 0x24F for ch in text)


def first_sentence(text: str) -> str:
    pos = 0
    while True:
        m = SENTENCE_END.search(text, pos)
        if not m:
            return text
        word = re.search(r"[\w.]*$", text[:m.start()]).group(0).lower()
        if m.group(0) != "." or not (word in NOT_THE_END or len(word) == 1 or INITIALS.fullmatch(word)):
            return text[:m.end()]
        pos = m.end()


def plain_letters(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", ch) if 0x1D400 <= ord(ch) <= 0x1D7FF else ch for ch in text)


def cut_off(line: str) -> bool:
    """A line that stops mid-thought: on a small word, on an abbreviation whose
    full stop has gone, inside a bracket."""
    last = re.sub(r"^\W+|\W+$", "", line.split()[-1]).lower()
    return (last in DANGLES or last in WANTS_A_NAME or bool(INITIALS.fullmatch(last))
            or line.count("(") != line.count(")") or line.count("[") != line.count("]"))


def clean_caption(text: object) -> str:
    """A caption's first sentence, as the line under its tile, or "" when the
    post is a gap and the title step has to fill it. Free, and the first thing
    any post meets.

    Off come hashtags, @handles and emoji. Styled letters (\U0001D5DA\U0001D5EE\U0001D5FA\U0001D5F2)
    become plain ones, and an emoji or a bullet ends a thought as a full stop
    does, because a caption's line breaks are gone by the time it gets here.
    It is a gap with under CP_CHARS[0] characters or CP_MIN_WORDS words left,
    over CP_CHARS[1], in another language or another script, when it asks a
    question or gives an order instead of saying what the post is, when it is
    cut off, or when a tag leaves a hole: "We had a blast at
    @thepipelineproject's event" cannot lose its handle and stay a sentence,
    and "Proud to support #VermontFoodbank" cannot lose what it supports."""
    if not isinstance(text, str):
        return ""
    t = HASHTAG.sub(f" {TAG_HOLE} ", HANDLE.sub(f" {AT_HOLE} ", plain_letters(text)))
    if not is_english(t):
        return ""
    kept = []
    for ch in t:
        kind = unicodedata.category(ch)
        if kind == "So" and ord(ch) >= 0x2300 or ch in "|\u2022\u00b7":
            kept.append("\n")
        elif kind not in ("Sk", "Cs", "Co", "Cf", "Me") and ch != "\ufe0f":
            kept.append(ch)
    part = next((p for p in "".join(kept).split("\n") if re.search(r"\w", p)), "")
    line = first_sentence(" ".join(part.split()))
    tail = re.search(rf"(\S+)[\s{TAG_HOLE}]*{TAG_HOLE}[\s{TAG_HOLE}]*[.!?\u2026]*$", line)
    if tail and tail.group(1).lower() in WANTS_OBJECT or re.match(rf"[\s{TAG_HOLE}]*{TAG_HOLE}[\s{TAG_HOLE}]*[a-z]", line):
        return ""
    line = re.sub(rf"[\s{TAG_HOLE}]+(?=[.!?\u2026]*$)", "", line).lstrip(f" {TAG_HOLE}")
    # a bilingual caption's label, a press office's
    line = re.sub(r"^(?:EN:|\(news release\))\s*", "", line.strip(" ,:;-\u2013\u2014").rstrip(". "), flags=re.I)
    if line.count("\u201c") != line.count("\u201d") or line.count('"') % 2:
        line = line.strip('"\u201c\u201d')     # the quote ran on past the sentence
    if AT_HOLE in line or TAG_HOLE in line or not CP_CHARS[0] <= len(line) <= CP_CHARS[1]:
        return ""
    if sum(any(ch.isalpha() for ch in w) for w in line.split()) < CP_MIN_WORDS or re.search(r"\?\W*$", line):
        return ""
    if cut_off(line) or OPENS_ON_AN_ORDER.search(line) or CALL_TO_ACTION.search(line) or SAYS_NOTHING.search(line):
        return ""
    if not is_english(line) or foreign_script(line) or unproved(line):
        return ""
    return line


def is_ad(rec: dict) -> bool:
    """Does the caption say it is paid for? The API's own flag is read in
    post_record. Off a local account a discount code counts too; on one it is
    a Burlington shop selling its own goods, or a venue's presale."""
    cap = rec.get("c") or ""
    return bool(AD_DECLARED.search(cap) or (rec.get("n") and AD_PLUGGED.search(cap)))


def last_date(text: str, ts: float) -> dt.date | None:
    """The latest date a line or a caption gives, read from the day of its post.
    A date with no year is that year's, unless that puts it long before the post."""
    posted = local_day(ts)
    found = []

    def add(month: int, day: int, year: int | None) -> None:
        try:
            date = dt.date(year or posted.year, month, day)
        except ValueError:
            return
        if not year and date < posted - dt.timedelta(days=NEXT_YEAR_DAYS):
            date = date.replace(year=date.year + 1)
        found.append(date)

    for m in NAMED_DATE.finditer(text):
        first, day, second, end, year = m.groups()
        add(MONTHS.index(first[:3].lower()) + 1, int(day), int(year) if year else None)
        if end:
            add(MONTHS.index((second or first)[:3].lower()) + 1, int(end), int(year) if year else None)
    for m in SLASH_DATE.finditer(text):
        add(int(m.group(1)), int(m.group(2)), None)
    for m in FULL_DATE.finditer(text):
        add(int(m.group(1)), int(m.group(2)), int(m.group(3)[-2:]) + 2000)
    if not found:
        for word, month, day in HOLIDAYS:
            if word.search(text):
                add(month, day, None)
        if THANKSGIVING.search(text):
            add(11, 22 + (3 - dt.date(posted.year, 11, 22).weekday()) % 7, None)
    return max(found) if found else None


def date_passed(text: str, rec: dict, now: float) -> bool:
    last = last_date(text, rec.get("ts") or now)
    return last is not None and last < local_day(now)


def days_said(text: str) -> bool:
    return bool(NAMED_DAY.search(A_NAME_NOT_A_DAY.sub(" ", text)))


def caption_passed(rec: dict, now: float) -> bool:
    """Has the day a local caption is about gone by? A date from before the post
    is a memory and says nothing. National captions are not about a day here."""
    cap, ts = rec.get("c") or "", rec.get("ts") or now
    if rec.get("n"):
        return False
    last = last_date(cap, ts)
    if last:
        return local_day(ts) <= last < local_day(now)
    return (bool(RELATIVE_DAY.search(cap)) and now - ts > STALE_S) or (days_said(cap) and now - ts > WEEK_S)


def stale(line: str, rec: dict, now: float) -> bool:
    """"Tonight at 5pm" stops being true the day after the post, "Friday" the
    week after, and "Oct 23" on Oct 24."""
    age = now - (rec.get("ts") or now)
    return (bool(RELATIVE_DAY.search(line)) and age > STALE_S) or (days_said(line) and age > WEEK_S) or \
        date_passed(line, rec, now)


def still_ahead(rec: dict, now: float) -> bool:
    """Does the caption give a date that has not come yet?"""
    last = last_date(rec.get("c") or "", rec.get("ts") or now)
    return last is not None and last >= local_day(now)


def missing_date(line: str, rec: dict) -> bool:
    """A poster's line that leaves out the date its caption gives."""
    ts = rec.get("ts") or 0
    return bool(line) and rec.get("kind") == "poster" and not last_date(line, ts) and \
        last_date(rec.get("c") or "", ts) is not None


def over(rec: dict, old: dict, now: float) -> bool:
    """Has the event on this poster happened? Its line and caption together
    give the last date, so a caption's "Oct 23 and Nov 6" stays up. With no date
    at all, "this Friday" over a week ago is the same answer."""
    if rec.get("kind") != "poster":
        return False
    words = " ".join(filter(None, (rec.get("hd"), old.get("hd"), rec.get("cp"), rec.get("c"))))
    if last_date(words, rec.get("ts") or now):
        return date_passed(words, rec, now)
    return now - (rec.get("ts") or now) > WEEK_S and (bool(RELATIVE_DAY.search(words)) or days_said(words))


def carried_line(rec: dict, old: dict | None, now: float | None = None) -> dict:
    """What a gap already has from this post or the last payload: a title that
    still passes today's checks, or `hx`. A title the rules have since turned
    against is asked about again."""
    old = old or {}
    if old.get("ad"):
        return {"ad": 1}
    if old.get("gone"):
        return {"gone": 1}
    hd = rec.get("hd") or old.get("hd")
    if hd:
        settled = rec.get("hs") or old.get("hs")
        if now is not None and not settled and caption_passed(rec, now):
            return {}
        hd = clean_hd(hd, bool(rec.get("n")), rec, now)
        return ({"hd": hd, "hs": 1} if settled else {"hd": hd}) if hd else {}
    return {"hx": 1} if rec.get("hx") or old.get("hx") else {}


def mark_captions(posts: list[dict], prev_hd: dict | None = None, now: float | None = None) -> None:
    """Sort every post, for nothing: `ad`, or `cp` and no model ever, or a gap
    left for assign_titles. `c` stays as it is. A local line that names a
    private person or gives a phone number is a gap too, so it gets the
    title's rules, and so is any line whose "tonight" or "Oct 23" has passed:
    its `cp` gives way to a title. A gap keeps what it was already given, so a
    run cut short loses no title it has paid for. A poster whose event is over
    is no gap: it gets `gone` and no line."""
    now = time.time() if now is None else now
    for rec in posts:
        old = (prev_hd or {}).get(post_key(rec)) or {}
        words = " ".join(filter(None, (rec.get("c"), rec.get("hd"), old.get("hd"))))
        if rec.get("ad") or old.get("ad") or is_ad(rec):
            rec["ad"] = 1
            line = ""
        elif rec.get("gone") or old.get("gone") or over(rec, old, now):
            rec["gone"] = 1
            line = ""
        else:
            line = "" if rec.get("h") in CAPTION_SAYS_NOTHING else clean_caption(rec.get("c"))
            if (stale(line, rec, now) or caption_passed(rec, now) or missing_date(line, rec)
                    or (not rec.get("n") and (names_private(line, rec) or CONTACT.search(line)))):
                line = ""
        if line:
            rec["cp"] = line
        else:
            rec.pop("cp", None)
        if not rec.get("n"):
            sad = ELECTION_WORDS.search(words)
        else:
            sad = rec.get("t") and SAD_WORDS.search(words)
        if sad:
            rec["sad"] = 1
        kept = {} if line or rec.get("ad") or rec.get("gone") else carried_line(rec, old, now)
        rec.pop("hd", None)
        rec.pop("hx", None)
        rec.pop("hs", None)
        rec.update(kept)


# ------------------------------------------------------------------- title

HD_RULES = """You write the short line shown under a picture in a phone app's grid. Videos
there do not play by themselves, so this line is how a reader knows what the post is.

Each post comes as a line, code · account name · national or Burlington · reel or photo ·
the day it was posted · caption, and then its picture. A caption's "today" or "this
Friday" counts from the day it was posted. Answer for every post, repeating its code exactly. The
account name is exact: write it as given, or leave it out. An account shown as "unnamed"
has no name you can use.

title: what the post is, 3 to 8 plain English words, in sentence case. Count them: nine
words is too many, and a title that long is thrown away.
- Say only what the caption says or the picture plainly shows, and check each against the
  other. Words printed in the picture count. Good: "Beagle steals a sandwich off the
  counter", "Jazz trio plays Radio Bean Oct 23", "Renter paints a checkerboard kitchen floor".
- Never guess. A caption of a word or two, emoji or bare tags on a picture with no clear
  subject gets an empty string. "nap" under a sleeping cat is "Cat asleep on a sunny
  windowsill"; "nap" under a picture you cannot make out is an empty string.
- Get the who right. Do not swap an owner and a pet, do not take a tagged sponsor for a
  place, and copy a name letter for letter or leave it out. With two subjects, give each
  only what you can see on it: do not hand the baby's costume to the dog. Do not say how
  two people are related unless the caption does. On a joke, say what the picture shows,
  not what the caption chats about.
- No relative days and no days of the week: no tonight, tomorrow, this Saturday, next week
  or Thursday, because the line stays up for days. Give a date only as the caption gives it
  ("Oct 23"), and never work out a weekday from it. A habit is fine: "every Thursday".
  Today's date comes after the posts, and a date or a holiday that has passed never goes in
  a title. A post that only announces something now over, a show, a sale, a market day or a
  closure, gets an empty string; one with something still worth seeing, a sunset or a band,
  says that, undated, and never as if it were still to come. A poster's title gives its date.
- A fact, never a sales line, a question or an order. No "don't miss", "shop now", "you'll love".
- A whole phrase: never stop on a word like "for", "a" or "next".
- No hashtags, emoji, @handles or quotation marks, and no period at the end.
- Translate anything not in English, by what it means in that language.
- No private person's full name. A first name, a job ("the new chef"), a pet's name or a
  public figure's name is fine, but never a customer's: "Flying fish tattoo", not "for Oliver".
- Nothing about a sick stomach, vomit or diarrhea, and an empty string if that is all there is.
- A joke, a greeting or a question still has a subject, so say it plainly: "Beagle begs
  the moment dinner sits down", "Jax the Lab says happy birthday".

ad: true for a paid partnership, a sponsored or gifted post, a discount code or an
affiliate link, or a post that is mostly selling a product, the account's own merch,
courses and books included. "Presented by" a brand, "Buy ... NOW" at a site and thanks to
a clothing label for an outfit are ads. An ad's title is an empty string. Judge the post
by what it is mostly about: a recipe or a clip with one plug at the end is not an ad. A
Burlington business saying what it has on (the special, a new batch, a show, the week's
rack) is news for its neighbors, not an ad."""

HD_AGAIN = """

Each of these came back with a title that broke a rule: too long, cut off, a question, a
private person's name, a phone number, a relative day or a date or holiday that has passed. Write it
again: 6 words at most, no day of the week, a date only if it is still to come, with the
person's job or group instead of their name. Something still to come is still worth a title."""

HD_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["items"],
             "properties": {"items": {"type": "array", "items": {
                 "type": "object", "additionalProperties": False, "required": ["code", "title", "ad"],
                 "properties": {"code": {"type": "string"}, "title": {"type": "string"},
                                "ad": {"type": "boolean"}}}}}}


def hd_code(rec: dict) -> str:
    """The name a post goes by in a title call, from its identity, not its place."""
    return f"{zlib.crc32(post_key(rec).encode()):08x}"


def hd_line(code: str, rec: dict) -> str:
    """One post for a title call. The account goes by its name and never its
    handle, which a model will split into a business that does not exist
    (@barkeatersvt came back as "Bar Eaters")."""
    day = local_day(rec["ts"]) if rec.get("ts") else None
    posted = f"posted {day:%b} {day.day}" if day else "posted when unknown"
    return (f"{code} · {rec.get('nm') or 'unnamed'} · {'national' if rec.get('n') else 'Burlington'} · "
            f"{'reel' if rec.get('v') else 'photo'} · {posted} · {(rec.get('c') or '(no caption)')[:HD_CAPTION_CHARS]}")


def title_content(batch: dict[str, dict], pics: dict[str, tuple[str, str]], note: str) -> list[dict]:
    """A title call: each post's line and then its picture, so nothing depends
    on the model counting pictures."""
    content: list[dict] = []
    for code, rec in batch.items():
        content.append({"type": "text", "text": hd_line(code, rec)})
        content.append({"type": "image", "source": {"type": "base64", "media_type": pics[code][0], "data": pics[code][1]}})
    content.append({"type": "text", "text": f"Give the title of each of the {len(batch)} posts." + note})
    return content


def rostered(words: str) -> bool:
    """Is this the name in one of our own accounts' handles? "Stay Gold" is
    @staygoldvintage, and no list of shop words would know it."""
    global ROSTER_TEXT
    if ROSTER_TEXT is None:
        try:
            doc = json.loads(ROSTER.read_text(encoding="utf-8"))
            ROSTER_TEXT = " ".join(re.sub(r"[._]", "", norm_handle(a.get("h")))
                                   for a in doc.get("accounts") or [] if isinstance(a, dict))
        except (OSError, ValueError, AttributeError):
            ROSTER_TEXT = ""
    return re.sub(r"\W", "", words).lower() in ROSTER_TEXT


def a_person(first: str, last: str) -> bool:
    return not ({first.lower(), last.lower()} & NOT_A_PERSON or rostered(first + last))


def names_by_use(text: str) -> bool:
    """A full name read from how the line uses it, whatever the first name."""
    pairs = [m.groups() for pat in (CREDITED, ACTS_LIKE_A_PERSON) for m in pat.finditer(text)]
    for m in LISTED.finditer(text):
        names = [g.groups() for g in re.finditer(FULL_NAME, m.group(0))]
        if all(a_person(*n) for n in names):
            return True
    someone = FOR_SOMEONE.search(text)
    return any(a_person(*p) for p in pairs) or bool(someone and a_person(someone.group(1), "")) or any(
        m.group(1).lower() in FIRST and a_person(*m.groups()) for m in LOWER_CREDITED.finditer(text))


def names_private(text: str, rec: dict | None = None) -> bool:
    """names_person, less what only looks like a neighbor (the account's own
    name, a name on a place or a business), plus names_by_use."""
    for own in ((rec or {}).get("nm"),):
        text = text.replace(own, " ") if own else text
    return names_by_use(text) or names_person(NAMED_PLACE.sub(" ", NOT_NEIGHBORS.sub(" ", text)))


def clean_hd(raw: object, national: bool, rec: dict | None = None, now: float | None = None) -> str | None:
    """A title the code will put in front of a reader, or None. The model is
    told every one of these; this is what holds if it forgets. A local post
    gets the same name check as a local account: the national feeds are full
    of public figures, and the check cannot tell them from a neighbor."""
    t = " ".join(str(raw or "").split()).rstrip(".!")
    if not HD_WORDS[0] <= len(t.split()) <= HD_WORDS[1]:
        return None
    if re.search(r"[#@\"“”?]", t) or t[0].islower() or t.isupper() or cut_off(t) or CONTACT.search(t):
        return None
    if RELATIVE_DAY.search(t) or NAMED_DAY.search(A_NAME_NOT_A_DAY.sub(" ", t)) or CALL_TO_ACTION.search(t):
        return None
    if any(unicodedata.category(ch) in ("So", "Sk", "Cs", "Co", "Cf") for ch in t):
        return None
    if now is not None and date_passed(t, rec or {}, now):
        return None
    return None if not national and names_private(t, rec) else t


def read_hd(raw: object, batch: dict[str, dict], last: bool = True, now: float | None = None) -> dict[str, dict]:
    """The model's answer -> {code: fields}, for the posts of `batch` (by
    code) it really answered. A code outside the batch, or one given twice,
    says the model lost its place, so nothing under it counts and those posts
    wait for the next run. A title that breaks the rules is still an answer
    for that post: empty fields ask for another try, and on the `last` try it
    gets `hx` and is not paid for again."""
    items = [e for e in (raw if isinstance(raw, list) else []) if isinstance(e, dict)]
    said = [e.get("code") for e in items]
    out = {}
    for e in items:
        code = e.get("code")
        if not isinstance(code, str) or code not in batch or said.count(code) > 1:
            continue
        # An ad's title is empty, so an ad with a title is a model hedging. And
        # a local shop selling its own goods is news.
        if e.get("ad") is True and batch[code].get("n") and not e.get("title"):
            out[code] = {"ad": 1}
            continue
        hd = clean_hd(e.get("title"), bool(batch[code].get("n")), batch[code], now)
        if hd:
            out[code] = {"hd": hd}
            if now is not None and caption_passed(batch[code], now):
                out[code]["hs"] = 1
        elif now is not None and still_ahead(batch[code], now):
            out[code] = {}          # no title for an event still to come is a slip: asked again, next run if need be
        else:
            out[code] = {"hx": 1} if last or not e.get("title") else {}
    return out


def assign_titles(posts: list[dict], prev_hd: dict, ledger: dict | None, now: float) -> dict:
    """Give every gap its `hd`, `ad` or `hx`. Returns what the run did and
    spent. A post with a `cp` or an `ad` is no gap and never gets here; a gap
    keeps what it has, or what it had in the last payload (`prev_hd`, by
    post_key); a rostered post that also tags the Brief is asked about once
    and both copies get the answer. The model reads the caption and looks at
    the picture: a post whose thumbnail will not download waits for the next
    run rather than have its title guessed from the words alone."""
    todo, twins = [], {}
    for rec in posts:
        if rec.get("cp") or rec.get("ad") or rec.get("gone"):
            continue
        k = post_key(rec)
        known = carried_line(rec, prev_hd.get(k), now)
        if known:
            rec.update(known)
        else:
            if k not in twins:
                twins[k] = []
                todo.append(rec)
            twins[k].append(rec)
    report = {"asked": 0, "decided": 0, "no_picture": 0, "in": 0, "out": 0, "usd": 0.0}
    if not todo:
        return report
    try:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import wire_common as wc
    except Exception as e:
        log(f"title: wire_common unavailable ({str(e)[:60]}); {len(todo)} post(s) wait")
        return report
    engine = wc.pick_engine("title")
    if engine is None:
        log(f"title: no Anthropic key; {len(todo)} post(s) wait")
        return report
    usage = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "calls": 0}
    cap = AI_MONTH_CAP_USD - HD_LEAVES_USD
    started = time.monotonic()
    queue, note, stopped = todo, "", False
    day = local_day(now)
    today = f" Today is {day:%b} {day.day}, {day.year}."
    pics: dict[str, tuple[str, str]] = {}

    def settle(rec, fields):
        report["decided"] += 1
        for twin in twins[post_key(rec)]:
            twin.update(fields)

    try:
        for last in (False, True):
            again = []
            shards = [queue[i:i + HD_BATCH] for i in range(0, len(queue), HD_BATCH)]
            while shards:
                shard = shards.pop(0)
                spent = ai_spent(ledger, now) + wc.cost_usd(engine["model"], usage)
                if spent >= cap or time.monotonic() - started > HD_TIME_S:
                    log(f"title: stopped at ${spent:.2f} after {time.monotonic() - started:.0f}s "
                        f"(cap ${cap:.2f}, {HD_TIME_S}s); {len(shard) + sum(map(len, shards))} post(s) wait")
                    stopped = True
                    break
                batch = {}
                for rec in shard:
                    code = hd_code(rec)
                    if code not in pics and time.monotonic() - started <= HD_TIME_S:
                        pic = fetch_thumb(rec.get("i") or "")
                        if pic:
                            pics[code] = pic
                        else:
                            report["no_picture"] += 1
                    if code in pics:
                        batch[code] = rec
                if not batch:
                    continue
                try:
                    answer, got = wc.ask_json(engine, HD_RULES, title_content(batch, pics, today + note), HD_SCHEMA,
                                              max_tokens=HD_TOKENS_EACH * len(batch) + 500,
                                              log_prefix="title", timeout=MODEL_TIMEOUT_S)
                except Exception as e:  # noqa: BLE001 — SDK missing, network, a bad answer
                    got = getattr(e, "usage", {}) or {}
                    answer = None
                    log(f"title: call failed ({str(e)[:80]})")
                    for k in usage:
                        usage[k] += got.get(k, 0)
                    if not got.get("calls"):        # no answer at all: the model is out, and every post waits
                        stopped = True
                        break
                    # It answered and the answer was no use, so one post is
                    # choking the batch. Halve until that post is alone: it
                    # gets `hx`, and the rest get their titles.
                    if len(batch) > 1:
                        recs = list(batch.values())
                        shards[:0] = [recs[:len(recs) // 2], recs[len(recs) // 2:]]
                    else:
                        settle(shard[0], {"hx": 1})
                    continue
                for k in usage:
                    usage[k] += got.get(k, 0)
                report["asked"] += len(batch)
                decided = read_hd(answer.get("items") if isinstance(answer, dict) else None, batch, last, now)
                for code, fields in decided.items():
                    if fields:
                        settle(batch[code], fields)
                    else:
                        again.append(batch[code])
            if stopped:
                break
            queue, note = again, HD_AGAIN
    finally:
        # However the calls ended: SIGTERM must not lose what has been paid for.
        usd = wc.cost_usd(engine["model"], usage)
        report.update({"in": usage["in"], "out": usage["out"], "usd": usd})
        if ledger is not None and (usage["calls"] or usage["in"]):
            record_ai(ledger, now, {"model": engine["model"], "asked": report["asked"], "in": usage["in"],
                                    "out": usage["out"], "usd": round(usd, 6)}, usd)
        log(f"title: {report['decided']} of {report['asked']} asked decided, {len(todo)} wanted, "
            f"{report['no_picture']} with no picture · {usage['in']:,} in / {usage['out']:,} out tokens · "
            f"${usd:.4f} this run")
    return report


BUSY_DAYS = 14
BUSY_MIN = 3


def busy_tier3(accounts: list[dict], payload: pathlib.Path, now: float) -> list[tuple]:
    """Tier 3 accounts whose shipped posts say they post often enough to be
    worth a daily check: candidates to move to tier 2 by hand. Read from the
    payload, so it costs nothing and only knows accounts already fetched."""
    try:
        posts = json.loads(payload.read_text(encoding="utf-8")).get("posts") or []
    except Exception:
        return []
    t3 = {a["h"]: a["category"] for a in accounts if a["tier"] == 3}
    n: dict[str, int] = {}
    for r in posts:
        if (isinstance(r, dict) and r.get("h") in t3 and r.get("s") != "tagged"
                and isinstance(r.get("ts"), (int, float)) and r["ts"] >= now - BUSY_DAYS * 86400):
            n[r["h"]] = n.get(r["h"], 0) + 1
    return sorted(((h, t3[h], k) for h, k in n.items() if k >= BUSY_MIN), key=lambda t: (-t[2], t[0]))


# ------------------------------------------------------------------ budget

def local_day(ts: float) -> dt.date:
    """The Burlington calendar day an epoch second falls on."""
    return dt.datetime.fromtimestamp(ts, TZ).date()


def month_key(day: dt.date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def days_in_month(day: dt.date) -> int:
    nxt = (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return (nxt - dt.timedelta(days=1)).day


def share_through(day: dt.date, budget: int, through: int | None = None) -> int:
    """Credits the month may have spent by the end of day `through` (default:
    `day` itself). Rounded down, so the month's shares never add to more than
    the budget."""
    d = day.day if through is None else through
    return (budget * max(0, d)) // days_in_month(day)


def load_ledger(path: pathlib.Path, now: float, budget: int) -> tuple[dict, bool]:
    """This month's ledger, and whether it was actually read.

    A ledger from last month starts this one at zero spent and keeps the
    fetch times (the rotation does not care about months). A missing or
    unreadable ledger, or one whose numbers do not make sense, fails CLOSED:
    the whole of today's share is assumed spent, so this run fetches nothing,
    and the ledger it writes lets tomorrow's run start from a known number.
    A missing ledger cannot be told apart from a lost one, and a lost one
    could hide a run that already spent today's credits."""
    today = local_day(now)
    month = month_key(today)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            raise ValueError("not an object")
        last = doc.get("last") if isinstance(doc.get("last"), dict) else {}
        last = {norm_handle(h): int(t) for h, t in last.items()
                if isinstance(t, (int, float)) and not isinstance(t, bool) and 0 < t <= now + 86400}
        spent = doc.get("spent")
        if doc.get("month") == month:
            if not isinstance(spent, int) or isinstance(spent, bool) or spent < 0:
                raise ValueError(f"spent is {spent!r}")
        elif isinstance(doc.get("month"), str) and doc["month"] < month:
            spent = 0
        else:
            raise ValueError(f"month is {doc.get('month')!r}")
        runs = [r for r in (doc.get("runs") or []) if isinstance(r, dict)]
        out = {"month": month, "spent": spent, "last": last, "runs": runs}
        names = doc.get("names") if isinstance(doc.get("names"), dict) else {}
        out["names"] = {norm_handle(h): n for h, n in names.items() if n and isinstance(n, str)}
        ai = doc.get("ai")
        if (isinstance(ai, dict) and ai.get("month") == month
                and isinstance(ai.get("usd"), (int, float)) and not isinstance(ai.get("usd"), bool)):
            out["ai"] = {"month": month, "usd": float(ai["usd"]),
                         "runs": [r for r in (ai.get("runs") or []) if isinstance(r, dict)]}
        pend = doc.get("pending")
        if (isinstance(pend, dict) and isinstance(pend.get("handles"), list)
                and isinstance(pend.get("at"), (int, float))):
            prev = pend.get("prev") if isinstance(pend.get("prev"), dict) else {}
            out["pending"] = {
                "handles": [norm_handle(h) for h in pend["handles"] if norm_handle(h)],
                "tagged": pend.get("tagged") is True, "at": int(pend["at"]),
                "month": pend.get("month"),
                "prev": {norm_handle(h): int(t) for h, t in prev.items()
                         if isinstance(t, (int, float)) and not isinstance(t, bool) and t >= 0},
            }
        return out, True
    except FileNotFoundError:
        why = "no ledger"
    except Exception as e:  # corrupt, hand-edited, from the future
        why = f"unreadable ledger ({str(e)[:60]})"
    assumed = share_through(today, budget)
    log(f"WARNING: {why} — assuming {assumed} credits already spent this month "
        f"(today's whole share), so this run fetches nothing")
    return {"month": month, "spent": assumed, "last": {}, "runs": []}, False


def allowance(ledger: dict, now: float, budget: int) -> int:
    """What this run may spend: today's running share, less what is spent."""
    return max(0, share_through(local_day(now), budget) - ledger["spent"])


def tier3_quota(n: int) -> int:
    """Tier 3 accounts to take each day so the whole tier turns over once a
    period."""
    return math.ceil(n / TIER3_PERIOD_DAYS) if n else 0


def plan(accounts: list[dict], last: dict, now: float, credits: int,
         tagged: bool = True) -> tuple[list[dict], bool, list[str]]:
    """Which accounts this run fetches, whether it fetches the tagged shelf,
    and what it had to leave for later — all inside `credits`.

    Order of claim: tier 1 (every run), the tagged shelf, tier 2 (any not yet
    fetched this Burlington day), then tier 3 (those not fetched for
    TIER3_PERIOD_DAYS, longest-waiting first, up to today's slice of the tier
    less any already taken today). The total never exceeds `credits`."""
    today = local_day(now)

    def day_of(h: str) -> dt.date | None:
        t = last.get(h)
        return local_day(t) if t else None

    # Every tier is served longest-waiting first, so when credits run short
    # the same accounts are not the ones left out every time. Ties (every
    # account the first week, or after a lost ledger) break on a hash of the
    # handle, not roster order, so a day's slice mixes categories instead of
    # being all `events` one day and all `shop` another.
    def oldest_first(group):
        return sorted(group, key=lambda a: (last.get(a["h"], 0), zlib.crc32(a["h"].encode()), a["h"]))

    t1 = oldest_first(a for a in accounts if a["tier"] == 1)
    t2 = oldest_first(a for a in accounts if a["tier"] == 2 and day_of(a["h"]) != today)
    t3_all = [a for a in accounts if a["tier"] == 3 and not a.get("interest")]
    fed = [a for a in accounts if a["tier"] == 3 and a.get("interest")]
    room_fed = max(0, math.ceil(len(fed) / INTEREST_PERIOD_DAYS) - sum(1 for a in fed if day_of(a["h"]) == today))
    due_fed = oldest_first(a for a in fed if day_of(a["h"]) is None
                           or (today - day_of(a["h"])).days >= INTEREST_PERIOD_DAYS)[:room_fed]
    taken_today = sum(1 for a in t3_all if day_of(a["h"]) == today)
    room3 = max(0, tier3_quota(len(t3_all)) - taken_today)
    due3 = oldest_first(a for a in t3_all
                        if day_of(a["h"]) is None
                        or (today - day_of(a["h"])).days >= TIER3_PERIOD_DAYS)[:room3]

    left = max(0, credits)
    picked, skipped, want_tagged = [], [], False
    for group in (t1, ["tagged"] if tagged else [], t2, due_fed, due3):
        for a in group:
            if left <= 0:
                skipped.append("tagged" if a == "tagged" else a["h"])
                continue
            left -= 1
            if a == "tagged":
                want_tagged = True
            else:
                picked.append(a)
    return picked, want_tagged, skipped


def projection(accounts: list[dict], tagged: bool = True) -> dict:
    """Steady-state cost of a roster: credits a day and a 31-day month."""
    n = {t: sum(1 for a in accounts if a["tier"] == t) for t in TIERS}
    fed = sum(1 for a in accounts if a["tier"] == 3 and a.get("interest"))
    day = (RUNS_PER_DAY * (n[1] + (1 if tagged else 0)) + n[2] + tier3_quota(n[3] - fed)
           + math.ceil(fed / INTEREST_PERIOD_DAYS))
    return {"tiers": n, "per_day": day, "per_month": day * 31}


def save_ledger(path: pathlib.Path, ledger: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "_comment": "Written by scripts/build_instagram.py; read back by it. "
                    "spent = Scrape Creators credits this builder spent this "
                    "Burlington month (one per request, failures included). "
                    "last = when each account was last requested. names = "
                    "each account's own profile name. Do not hand-edit spent "
                    "downward.",
        "month": ledger["month"],
        "budget": MONTHLY_CREDIT_BUDGET,
        "spent": ledger["spent"],
        "runs": ledger["runs"][-62:],
        "last": dict(sorted(ledger["last"].items())),
    }
    if ledger.get("names"):
        doc["names"] = dict(sorted(ledger["names"].items()))
    if ledger.get("pending"):
        doc["pending"] = ledger["pending"]
    if ledger.get("ai"):
        doc["ai"] = dict(ledger["ai"], runs=ledger["ai"]["runs"][-62:])
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


# -------------------------------------------------------------------- main

def payload_counts(posts: list[dict]) -> dict:
    """The payload's top-level numbers, always counted from the posts it ships."""
    segs = ("do", "see", "tagged")
    return {
        # Accounts represented in THIS payload, not the whole roster.
        "handles": sorted({p["h"] for p in posts}),
        "segments": {s: {"posts": sum(1 for r in posts if r["s"] == s),
                         "accounts": len({r["h"] for r in posts if r["s"] == s})} for s in segs},
        "categories": {c: sum(1 for r in posts if r.get("category") == c) for c in CATEGORIES},
        # What the pictures are (`kind` on each post); `kd` marks a post still
        # on its category's default, to be judged next run.
        "kinds": {k: sum(1 for r in posts if r.get("kind") == k) for k in KINDS},
        "kinds_defaulted": sum(1 for r in posts if r.get("kd")),
        # Posts with a line for their tile, their own or a model's; the ones
        # marked as ads, and the ones the fun feeds leave out.
        "captioned": sum(1 for r in posts if r.get("cp")),
        "titled": sum(1 for r in posts if r.get("hd")),
        "ads": sum(1 for r in posts if r.get("ad")),
        "sad": sum(1 for r in posts if r.get("sad")),
        # Posts that carry a playable MP4 right now, and the food-tagged ones.
        "videos": sum(1 for r in posts if r.get("vu")),
        "food": sum(1 for r in posts if r.get("f")),
        "national": sum(1 for r in posts if r.get("n")),
    }


def payload(posts: list[dict]) -> dict:
    """The file: what the page shows in `posts`, and in `held` what it must not
    but the next run has to remember. A post the build gave no line goes out
    without its caption, or the page would make a line of it."""
    for rec in posts:
        if rec.get("hx"):
            rec.pop("c", None)
    held = [r for r in posts if r.get("sad") or r.get("gone")]
    shown = [r for r in posts if not (r.get("sad") or r.get("gone"))]
    return {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        # These URLs stop working, and saying when is better than showing a
        # grid of broken frames. Measured at 4.3-4.5 days.
        "expires_hint_days": 4,
        **payload_counts(shown),
        "sad": sum(1 for r in held if r.get("sad")),
        "gone": sum(1 for r in held if r.get("gone")),
        "posts": shown,
        "held": held,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-carry", action="store_true",
                    help="ignore the previous payload; scrape-only")
    ap.add_argument("--no-tagged", action="store_true",
                    help="skip the one-credit tagged-posts fetch")
    ap.add_argument("--only", default="",
                    help="comma-separated rostered handles: fetch just these and "
                         "nothing else (no tagged shelf), still inside the budget")
    ap.add_argument("--no-look", action="store_true",
                    help="judge kinds from captions only; never send a thumbnail to the model")
    ap.add_argument("--out", type=pathlib.Path, default=None,
                    help="write the payload here instead of all-day/data/instagram.json")
    ap.add_argument("--ledger", type=pathlib.Path, default=None,
                    help="read and write the ledger here instead of data/instagram-ledger.json")
    step = ap.add_mutually_exclusive_group()
    step.add_argument("--dry-run", action="store_true",
                      help="print this run's plan and its cost; no request, no key, no write")
    step.add_argument("--reserve", action="store_true",
                      help="plan this run and write its credits and its accounts to the "
                           "ledger, then stop; no request (the workflow pushes it first)")
    step.add_argument("--execute", action="store_true",
                      help="fetch exactly what the last --reserve wrote to the ledger")
    args = ap.parse_args()
    ledger_path = args.ledger or LEDGER

    accounts = load_roster()
    cat_of = {a["h"]: a["category"] for a in accounts}
    now = time.time()
    budget = MONTHLY_CREDIT_BUDGET

    ledger, ledger_ok = load_ledger(ledger_path, now, budget)
    if args.execute:
        return execute(args, ledger, ledger_path, accounts, now)
    # A reservation still on the ledger was never executed (--execute clears
    # it before its first request). Its credits stay counted, which is the
    # safe side if it did run and its push was lost, but its accounts get
    # their places in the rotation back, so they are not skipped for a day
    # (tier 2) or a week (tier 3) without ever having been fetched.
    old = ledger.pop("pending", None)
    if old:
        for h in old["handles"]:
            if old["prev"].get(h):
                ledger["last"][h] = old["prev"][h]
            else:
                ledger["last"].pop(h, None)
        log(f"an unexecuted reservation of {len(old['handles'])} account(s) from "
            f"{dt.datetime.fromtimestamp(old['at'], dt.timezone.utc):%Y-%m-%d %H:%M} UTC: "
            f"credits kept as spent, rotation places restored")
    credits = allowance(ledger, now, budget)
    if args.only:
        want = {norm_handle(h) for h in args.only.split(",") if norm_handle(h)}
        if len(want) > ONLY_MAX:
            # Its credits land only in this checkout's ledger, so it has to
            # stay small enough not to matter to the month.
            log(f"refusing: --only takes at most {ONLY_MAX} handles")
            return 2
        stray = sorted(want - set(cat_of))
        if stray:
            log(f"--only: not in the roster, ignored: {', '.join(stray)}")
        pool = [a for a in accounts if a["h"] in want]
        picked = pool[:credits]
        skipped = [a["h"] for a in pool[credits:]]
        want_tagged = False         # "just these": never the tagged shelf
    else:
        credits = min(credits, RUN_MAX)
        picked, want_tagged, skipped = plan(accounts, ledger["last"], now, credits,
                                            tagged=not args.no_tagged)

    proj = projection(accounts, tagged=not args.no_tagged)
    n = proj["tiers"]
    log(f"roster: {len(accounts)} accounts (tier 1 {n[1]}, tier 2 {n[2]}, tier 3 {n[3]}); "
        f"steady state ~{proj['per_day']} credits/day, ~{proj['per_month']}/month "
        f"against a budget of {budget}")
    log(f"ledger: {ledger['spent']} spent in {ledger['month']}"
        + ("" if ledger_ok else " (assumed)") + f"; this run may spend {credits}")
    spend = len(picked) + (1 if want_tagged else 0)
    log(f"plan: {len(picked)} account(s)" + (" + tagged" if want_tagged else "")
        + f" = {spend} credits"
        + (f"; {len(skipped)} left for later: {', '.join(skipped[:8])}" if skipped else ""))
    if proj["per_month"] > budget:
        log(f"WARNING: the roster's steady state ({proj['per_month']}/month) is over the "
            f"budget; tier 3 will turn over slower than every {TIER3_PERIOD_DAYS} days")

    if args.dry_run:
        for t in TIERS:
            hs = [f"{a['h']} ({a['category']})" for a in picked if a["tier"] == t]
            if hs:
                print(f"tier {t} · {len(hs)}: " + ", ".join(hs))
        if want_tagged:
            print("tagged shelf · 1")
        print(f"total {spend} credits this run")
        busy = busy_tier3(accounts, args.out or OUT, now)
        if busy:
            print("tier 3 accounts posting like daily ones (posts in the last "
                  f"{BUSY_DAYS} days, from the payload): "
                  + ", ".join(f"{h} ({c}, {n})" for h, c, n in busy))
        return 0

    if not (args.reserve or args.only):
        # Reserving and spending in one go writes the credits only to THIS
        # checkout's ledger; main's never hears of them and the workflow
        # would spend the same allowance again. So the one-step mode is only
        # for an --only test of a handful of accounts, whose credits are
        # small and printed.
        log("refusing: run --reserve then --execute (the workflow does), --dry-run to "
            "see the plan, or --only h1,h2 for a small local test")
        return 2

    if not picked and not want_tagged:
        if not ledger_ok:
            save_ledger(ledger_path, ledger)    # tomorrow starts from a known number
        log("nothing to fetch inside the budget — payload left as it is")
        return 0

    if not api_key():
        log("no Scrape Creators key — set SCRAPECREATORS_API_KEY. Nothing written.")
        return 1

    # Every request is a credit, whatever comes back. The whole run's spend is
    # written to the ledger BEFORE the first request: a run killed halfway
    # has then over-counted, never under-counted, and a ledger that cannot be
    # written stops the run before it costs anything. With --reserve that is
    # all this run does: the workflow pushes the ledger, and only a push that
    # landed lets --execute spend it, so the next run can never read a ledger
    # that is missing these credits.
    ledger["spent"] += spend
    prev_last = {a["h"]: ledger["last"].get(a["h"], 0) for a in picked}
    for a in picked:
        ledger["last"][a["h"]] = int(now)
    roster_h = {a["h"] for a in accounts}
    ledger["last"] = {h: t for h, t in ledger["last"].items() if h in roster_h}
    ledger["runs"].append({"at": dt.datetime.fromtimestamp(now, dt.timezone.utc)
                           .isoformat(timespec="seconds"), "credits": spend})
    if args.reserve:
        ledger["pending"] = {"handles": [a["h"] for a in picked], "tagged": want_tagged,
                             "at": int(now), "month": ledger["month"], "prev": prev_last}
    save_ledger(ledger_path, ledger)
    log(f"ledger: {spend} reserved for this run, {ledger['spent']} of {budget} this month")
    if args.reserve:
        return 0
    log(f"--only: these {spend} credits are on this checkout's ledger only; "
        f"commit it to main or they go uncounted")
    return fetch_and_build(args, picked, want_tagged, accounts, now,
                           ledger=ledger, ledger_path=ledger_path)


def execute(args, ledger: dict, ledger_path: pathlib.Path, accounts: list[dict], now: float) -> int:
    """Spend what --reserve wrote, and nothing else. The credits were counted
    when they were reserved, so this changes `spent` not at all; it clears
    the reservation first, so it can never be spent twice."""
    pend = ledger.get("pending")
    if not pend:
        log("--execute: no reservation in the ledger — nothing fetched")
        return 0
    # Only a reservation made this Burlington month, in the last few hours,
    # is spent: last month's credits were counted against last month, and
    # spending them now would be spending this month's money uncounted. A
    # refused one stays on the ledger for the next --reserve to unwind.
    age = now - pend["at"]
    if pend.get("month") != ledger["month"] or not 0 <= age <= PENDING_MAX_H * 3600:
        log(f"--execute: the reservation is from {pend.get('month')}, "
            f"{age / 3600:.1f} hours ago — not spent")
        return 0
    if not api_key():
        log("no Scrape Creators key — set SCRAPECREATORS_API_KEY. Nothing written.")
        return 1
    by_h = {a["h"]: a for a in accounts}
    picked = [by_h[h] for h in dict.fromkeys(pend["handles"]) if h in by_h]
    want_tagged = pend["tagged"] and not args.no_tagged
    ledger.pop("pending", None)
    save_ledger(ledger_path, ledger)
    log(f"--execute: {len(picked)} account(s)" + (" + tagged" if want_tagged else "")
        + " as reserved")
    if not picked and not want_tagged:
        return 0

    def give_back(unattempted: list[str]) -> None:
        """Cut off partway (a crash, the step's timeout): the accounts never
        asked for get their rotation places back. Their credits stay
        counted; the run may have reached the API for the one in flight."""
        for h in unattempted:
            if pend["prev"].get(h):
                ledger["last"][h] = pend["prev"][h]
            else:
                ledger["last"].pop(h, None)
        save_ledger(ledger_path, ledger)
        log(f"--execute: stopped with {len(unattempted)} account(s) not asked for; "
            f"their rotation places restored")

    return fetch_and_build(args, picked, want_tagged, accounts, now, on_stop=give_back,
                           ledger=ledger, ledger_path=ledger_path)


def fetch_and_build(args, picked: list[dict], want_tagged: bool,
                    accounts: list[dict], now: float, on_stop=None,
                    ledger: dict | None = None, ledger_path: pathlib.Path | None = None) -> int:
    """Fetch `picked` (and the tagged shelf), carry forward what is still
    good, give every post its kind, and write the payload. The credits are
    already on the ledger; the kind call's dollars are added to it."""
    out_path = args.out or OUT
    key = api_key()
    cat_of = {a["h"]: a["category"] for a in accounts}
    seg_of = {a["h"]: a["s"] for a in accounts}
    food = {a["h"] for a in accounts if a["food"]}
    national = {a["h"] for a in accounts if a["national"]}
    interest = {a["h"]: a["interest"] for a in accounts if a["interest"]}
    breed = {a["h"]: a["breed"] for a in accounts if a["breed"]}
    known = {h: n for h, n in ((h, clean_name(n)) for h, n in ((ledger or {}).get("names") or {}).items())
             if n and h in cat_of}
    names = dict(known)
    cutoff = now - KEEP_DAYS * 86400
    fed_cutoff = now - INTEREST_KEEP_DAYS * 86400

    # Read the previous payload. Which of its posts we KEEP is decided after
    # the scrape, not before: a handle scheduled for today whose request fails
    # must keep yesterday's posts, or one API hiccup deletes the account from
    # the tab. Only a handle that actually answered gets its old posts
    # replaced.
    prev_posts = []
    if not args.no_carry and out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8"))
            prev_posts = [r for f in ("posts", "held") if isinstance(prev.get(f), list) for r in prev[f]]
        except Exception as e:
            log(f"could not read the previous payload ({str(e)[:60]}) — "
                f"building from this run alone")

    fresh, failed, answered = [], [], set()
    # A step timeout sends SIGTERM; make it an exception so on_stop runs.
    def _term(signum, frame):
        raise SystemExit(143)
    old_term = None
    try:
        old_term = signal.signal(signal.SIGTERM, _term)
    except ValueError:
        pass                    # not the main thread (a test harness)
    i = 0
    started = time.monotonic()
    try:
        for i, a in enumerate(picked):
            if time.monotonic() - started > FETCH_BUDGET_S:
                log(f"fetch budget ({FETCH_BUDGET_S // 60} min) spent after {i} of "
                    f"{len(picked)} account(s); writing what this run has")
                if on_stop:
                    on_stop([x["h"] for x in picked[i:]])
                break
            h = a["h"]
            try:
                items = fetch_handle(h, key)
            except Exception as e:
                failed.append(f"{h}: {str(e)[:50]}")
                continue
            # It answered. Even an empty list is an answer — the account posted
            # nothing recent — so its stale posts are now genuinely stale.
            answered.add(h)
            name = own_name(h, items, a["national"])
            if name:
                names[h] = name
            kept = 0
            for it in items:
                if kept >= POSTS_PER_HANDLE:
                    break
                rec = post_record(h, it, fed_cutoff if a.get("interest") else cutoff, now, a["national"])
                if not rec or (a.get("breed") and merch_post(rec)):
                    continue
                fresh.append(rec)
                kept += 1
            time.sleep(0.4)
    except BaseException:
        if on_stop:
            on_stop([a["h"] for a in picked[i + 1:]])
        raise
    finally:
        if old_term is not None:
            signal.signal(signal.SIGTERM, old_term)
    log(f"asked {len(answered) + len(failed)} account(s) in "
        f"{(time.monotonic() - started) / 60:.1f} min")

    # The tagged shelf: anyone's posts, so it is judged by its own window
    # and blocklist, and carried on its own — a rostered account that
    # tagged the Brief appears in both places, and the two must not fold.
    block = load_block()
    tagged_cutoff = now - TAGGED_DAYS * 86400
    tagged, tagged_ok = [], False
    if want_tagged:
        try:
            for it in fetch_tagged(key):
                rec = tagged_record(it, tagged_cutoff, now, norm_handle((it.get("user") or {}).get("username")) in national)
                if rec and rec["h"] not in block:
                    tagged.append(rec)
            tagged_ok = True
        except Exception as e:
            failed.append(f"tagged: {str(e)[:50]}")

    if not tagged_ok:
        for rec in prev_posts:
            if (isinstance(rec, dict) and rec.get("s") == "tagged"
                    and rec.get("h") not in block
                    and carry_ok(rec, now, tagged_cutoff)):
                tagged.append(rec if video_ok(rec, now) else drop_video(rec))

    carried = []
    for rec in prev_posts:
        # One malformed record must not cost every good one, so each is judged
        # on its own rather than inside a single try around the whole loop.
        if not isinstance(rec, dict):
            continue
        if rec.get("s") == "tagged":
            continue            # handled above, on its own terms
        h = rec.get("h")
        if h in answered:
            continue            # today's fetch replaces it wholesale
        if h not in cat_of:
            continue            # dropped from the roster since that run
        if not carry_ok(rec, now, fed_cutoff if h in interest else cutoff):
            continue
        if h in breed and merch_post(rec):
            continue
        carried.append(rec if video_ok(rec, now) else drop_video(rec))

    if carried:
        held = {r["h"] for r in carried} & {a["h"] for a in picked}
        log(f"carried {len(carried)} still-signed post(s) from "
            f"{len({r['h'] for r in carried})} account(s)"
            + (f", {len(held)} of them because today's fetch failed" if held else ""))

    if failed:
        log(f"{len(failed)} request(s) failed: {'; '.join(failed[:5])}")
    if not fresh:
        # Carried posts alone are yesterday's file with a new timestamp on it.
        # Better to leave the good payload in place and let the next run try.
        log("no posts collected — refusing to overwrite a good payload")
        return 1

    # Stamp segment, category and the food flag on every record, carried ones
    # included: the payload follows the roster as it is now, not the copy of
    # it that was current when the post was first seen.
    shown = {**names, **{a["h"]: a["name"] for a in accounts if a["name"]}}
    by_key = {}
    for rec in carried + fresh:
        rec["s"] = seg_of.get(rec["h"], "do")
        rec["category"] = cat_of.get(rec["h"], "other")
        if rec["h"] in food:
            rec["f"] = 1
        else:
            rec.pop("f", None)
        if rec["h"] in national:
            rec["n"] = 1
        else:
            rec.pop("n", None)
        for field, value in (("t", interest.get(rec["h"])), ("br", breed.get(rec["h"])),
                             ("nm", shown.get(rec["h"]))):
            if value:
                rec[field] = value
            else:
                rec.pop(field, None)
        # A post URL identifies a post. The account URL does not — it is the
        # fallback for a post with no shortcode, and keying on it would fold
        # every shortcode-less post from that handle into one.
        u = rec.get("u") or ""
        by_key["u:" + u if "/p/" in u else f"t:{rec['h']}:{rec['ts']}"] = rec

    tagged_by_key = {}
    for rec in tagged:
        rec["category"] = cat_of.get(rec["h"], "other")
        if rec["h"] in national:
            rec["n"] = 1
        tagged_by_key[rec.get("u") or f"{rec['h']}:{rec['ts']}"] = rec

    # Cap each category on its own, one post per account at a time, then
    # interleave back into one clock-ordered list.
    posts = []
    for cat, cap_n in CAP.items():
        half = [r for r in by_key.values() if r["category"] == cat]
        if len(half) > cap_n:
            log(f"{cat}: capped {len(half)} -> {cap_n}")
        posts.extend(fair_cap(half, cap_n))
    posts.extend(sorted(tagged_by_key.values(), key=lambda r: -r["ts"])[:TAGGED_CAP])
    posts.sort(key=lambda r: -r["ts"])

    # What each picture is. Only the shipped posts are judged, and a post the
    # last payload already judged keeps that answer.
    prev_kinds = {post_key(r): r["kind"] for r in prev_posts
                  if isinstance(r, dict) and r.get("kind") in KINDS and not r.get("kd")}
    before = ai_spent(ledger, now)
    if ledger is not None:
        ledger["names"] = names
    # The line under each tile, the same way: decided once and carried.
    prev_hd = {post_key(r): {f: r[f] for f in HD_FIELDS if r.get(f)} for r in prev_posts
               if isinstance(r, dict) and any(r.get(f) for f in HD_FIELDS)}

    # A post is judged once, so a kept kind keeps what was said with it.
    prev_sad = {post_key(r) for r in prev_posts if isinstance(r, dict) and r.get("sad")}
    for rec in posts:
        if post_key(rec) in prev_sad:
            rec["sad"] = 1

    # From here the posts are paid for, so the step's timeout must not lose
    # them: SIGTERM ends the model calls and the payload is still written.
    def _stop(signum, frame):
        raise Stopped()
    old_stop = None
    try:
        old_stop = signal.signal(signal.SIGTERM, _stop)
    except ValueError:
        pass                    # not the main thread (a test harness)
    try:
        try:
            assign_kinds(posts, prev_kinds, load_hints(accounts), ledger, now,
                         look=not getattr(args, "no_look", False))
        except Exception as e:  # noqa: BLE001 — a kind is never worth the payload
            log(f"kind: classification failed ({type(e).__name__}); unjudged posts keep their category's kind")
        mark_captions(posts, prev_hd, now)
        try:
            assign_titles(posts, prev_hd, ledger, now)
        except Exception as e:  # noqa: BLE001 — a title is never worth the payload
            log(f"title: failed ({type(e).__name__}); unjudged posts wait for the next run")
    except Stopped:
        log("the step's timeout came during the model calls; writing what this run has")
        mark_captions(posts, prev_hd, now)
    finally:
        if old_stop is not None:
            signal.signal(signal.SIGTERM, old_stop)
    for rec in posts:
        if rec.get("kind") not in KINDS:
            rec["kind"] = KIND_OF_CATEGORY.get(rec.get("category"), "other")
            rec["kd"] = 1
    if (ledger is not None and ledger_path is not None
            and (ai_spent(ledger, now) != before or names != known)):
        save_ledger(ledger_path, ledger)

    out = payload(posts)
    cats, kinds = out["categories"], out["kinds"]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    log(f"wrote {out_path}  {len(out['posts'])} posts, {len(out['held'])} held, from {len(out['handles'])} accounts · "
        + " · ".join(f"{c} {n}" for c, n in cats.items() if n)
        + " · kinds " + " ".join(f"{k} {n}" for k, n in kinds.items() if n)
        + f" · {out['videos']} with video, {out['food']} food · "
        f"{out_path.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
