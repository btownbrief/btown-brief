#!/usr/bin/env python3
"""The Wire, step two of two: the day's paper, updated hourly.

Reads pulse.json (the firehose, plus the X and Facebook inbox), the tags
tag_wire.py left in data/wire-tags.json, and the day so far, then asks the
editor model, with prompts/wire-taste.md as its doctrine, for:

  * "What matters today": 40 ranked picks, each with a one-line reason and a
    local flag, ranked as one list by importance with local and national
    interleaved, so the page shows the local picks on Local (in their relative
    order) and all of them, mixed, when the switch is on Everything. Re-ranked at most every PICKS_EVERY_HOURS
    (and at once when a score-9 local story lands); between re-ranks the
    picks stand. A day keeps every story the editor ranked: one that falls
    out of a re-rank moves to `picks_earlier` with its last rank, its reason
    and the time of that ranking, so the evening page can still show the
    morning's picks.
  * This hour's additions to the river ("The rest of today"), the lead of
    the current update with its reason, and which running items to drop if
    the day passes RIVER_MAX (300: the river is meant to feel almost endless).
    Inside an update the code sets the order: the lead, then this hour's
    additions in the editor's order of importance, local and national mixed
    (never more than KIND_RUN_MAX of one kind in a row), never two from one
    outlet back to back, and an X desk's bunch of posts spread out
    (order_update).

Output, data/wire-today.json:

  {"v": 1, "date": "2026-10-16", "tz": "America/New_York", "final": false,
   "updated": "...", "checked": "...", "count": 52,
   "counts": {"local": {"all": 40, "x": 3, ...}, "everything": {...}},
   "picks": [{"rank": 1, "why": "...", "ranked_at": "...", ...item}, ...],
   "picks_earlier": [{"rank": 4, "why": "...", "ranked_at": "...", ...item}, ...]
                     (ranked earlier today, out of the current ranking; newest
                     ranking first, then by rank; never also in `picks`)
   "brief": {...item, "own": true}            (only on days the Brief went out)
   "updates": [{"key": "afternoon", "label": "Afternoon", "time": "2:10 pm",
                "updated": "...", "lead": {"id": "...", "why": "..."},
                "items": [item, ...]}, ...newest first],
   "sources": {"x": {"paused": ..., "reason": ...}, "facebook": ..., "reddit": ...},
   "sport_chips": ["nba", "nfl", "nhl", "tennis", "mlb", "local", "college"],
                                   (the day's sport chips; mlb only in its postseason)
   "sports": {"nba": [item, ...], ...}   (every sports story of the day by chip,
                                   newest first: the river's few, marked "river": true,
                                   and the rest, which only the chips show)
   "sport_counts": {"local": {"nba": 2, ...}, "everything": {"nba": 9, ...}},
   "markets": [item, ...]          (every market story of the day, newest first; the
                                   river's few marked "river": true; the Markets chip)
   "markets_count": {"local": 0, "everything": 14},
   "photos_world": [photo, ...]    (the Photos tab's Everything view, newest first; see below)
   "recaps": [recap, ...]          (Grok's recaps posted today, newest first; see below)
   "recaps_latest": ["id", ...],   (the newest recap of each kind, newest first)
   "recap_kinds": [{"kind": "morning", "title": "Morning briefing"}, ...]}

A recap is {"id", "kind", "title", "posted_at", "intro", "basis", "label",
"bullets": [{"id", "text", "url", "note", "sport"?}, ...]}: `title` is the
kind's fixed title, `label` the small trust line ("From X trending
summaries" or "From posts on X"), and each bullet's `id` is the id a river
item with the same url would carry, so a page can show a bullet as its own
river item without showing one story twice. Recaps are copied verbatim from
the inbox (wire_inbox.py checks them); no model touches them here.

Sports items carry `sport` (wire_common.SPORTS: nba, nfl, nhl, tennis, mlb,
college, local, other) for the page's sport chips. Sports are kept light
(Stephen, 2026-10-19): the main river carries at most SPORTS_RIVER_MAX sports
stories a day, the biggest, plus a Vermont team's story only when it is big
here (tag score LOCAL_SPORTS_BIG or more). Every other sports story the editor
keeps goes to `sports` only, which the chips read; the daily Sports recap
covers the rest. MLB is a chip only in its postseason; otherwise an MLB story
sits under `other`, which is never a chip. Market stories (tag topic
`markets`) are kept light the same way: at most MARKETS_RIVER_MAX in the main
river a day, the rest in `markets` for the Markets chip, with Grok's Market
open and Market close recaps covering the day.

A photo is {"id", "kind", "src", "name", "title", "url", "posted_at", ...}:
kind "photo" is a picture feed's item (wire_photos.py: The Atlantic In Focus,
the Guardian's Photos of the day, NASA APOD, NASA Earth Observatory) with the
publisher's own `image` URL to hotlink, `credit` and `alt` where the feed
gives them; kind "x" is a bullet of Grok's "Pictures of the day" recap, an X
post whose picture is the point, with `why` and `embed: "x"` (the page shows
the link or X's official embed; nothing is re-hosted). News thumbnails never
enter this list.

Every item carries id, ch, local, src, name, title, url, posted_at, and
thumb / media / handle / discuss / site / topic where available. Picks are
always items of the river too; the page leaves the shown picks out of "The
rest of today" so nothing shows twice.

At the first run after midnight Eastern, yesterday is frozen as
data/wire/YYYY-MM-DD.json ("final": true), data/wire/index.json lists the
editions, and editions older than KEEP_DAYS are deleted.

Honesty rules, the house style of curate_top.py:

  * The model answers by INDEX into numbered lists. It never writes a
    headline: titles are copied verbatim from pulse.json.
  * Every pick, addition, lead and drop maps back to a real item; anything
    else is discarded. Reasons are clamped to WHY_MAX characters.
  * Nothing that ran on an earlier day's Wire (RESERVE_DAYS) comes back, and
    an item the editor passed on stays passed on for the day.

Failure posture: no key, the month cap (wire_common.MONTH_CAP_USD, $60), or
any API trouble logs and exits 0 without touching the day's file, so the
branch keeps the last good paper, UNLESS the paper has gone unchecked for
STALE_HOURS: then the run fails so it is seen. A quiet hour (nothing new
worth asking about) still stamps `checked`, so overnight silence is not
mistaken for a broken pipeline.

CLI:
  --data-dir DIR   wire-data working tree (default data/)
  --pulse PATH     read pulse.json from a file instead of the pulse-data branch
  --as-of ISO      run as if it were that moment (a labelled backfill)
  --selftest       run the offline checks and exit
"""

import argparse
import glob
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wire_common as wc  # noqa: E402
import wire_inbox  # noqa: E402  (the recap kinds and labels)

PULSE_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
             "pulse-data/data/pulse.json")
UA = "btown-wire/1.0"

WINDOW_HOURS = 26          # a story from last evening can still lead this morning
# A newsletter edition belongs to its own Burlington day. Inoreader stamps an
# email edition with the moment the email reached it, which is the moment it
# was sent, so "published" and "arrived" are one time. Only an edition from
# late the evening before (after EDITION_LATE_HOUR) can still open today's
# river: last night's last hourly run may have come before it. Without this
# guard the 26-hour window back-filled four Sunday editions into Monday
# morning (2026-10-19).
EDITION_LATE_HOUR = 21
RESERVE_DAYS = 7           # nothing in the last week's editions comes back
KEEP_DAYS = 30             # frozen editions kept on the branch
# Stephen, 2026-10-16: the river should feel almost endless, curated well down
# from the ~1,000 items a day, not a 40-to-80-item digest.
RIVER_MAX = 300
ADD_MAX = 60               # per hourly update (Stephen, 2026-10-17: the river runs to hundreds)
ADD_MAX_FIRST = 100        # the day's first update can catch up on the night
RIVER_SHOWN_HOURLY = 60    # between re-ranks the editor sees the newest river items only
PICK_COUNT = 40            # Stephen, 2026-10-17: 25 was too few
NATIONAL_PICKS = 25        # at most this many national picks in a ranking of 40
LOCAL_PICKS = 25           # and at most this many local: half and half on an ordinary day,
                           # the news deciding the split within the band (Stephen, 2026-10-17)
WHY_MAX = 90
NEW_MAX_LOCAL = 120        # candidates shown to the editor per run
NEW_MAX_WORLD = 80
WORLD_MIN_SCORE = 3        # national items the tagger scored lower never reach the editor
# Sports (Stephen, 2026-10-19: "better sports coverage ... select the specific
# sport"): national sports stories reach the editor from a lower score, in
# their own lane so the news never crowds them out (or they the news)
SPORTS_MIN_SCORE = 2
NEW_MAX_SPORTS = 30
# Stephen, later on 2026-10-19: "Sports: keep it light. Main feed shows only the
# biggest moments (cap ~3-5/day); everything else lives behind sport chips + the
# daily Sports recap."
SPORTS_RIVER_MAX = 4       # sports stories in the main river a day (picks count)
LOCAL_SPORTS_BIG = 7       # a Vermont team's story this big here is outside the cap
# Stephen, the same evening: "can we also add some stock news and RECAPS for
# it". Market stories (tag topic `markets`) get the same treatment: the big
# moves in the main river, the rest behind the Markets chip and the recaps.
MARKETS_RIVER_MAX = 3
LANE_MAX = {"sports": SPORTS_RIVER_MAX, "markets": MARKETS_RIVER_MAX}
LANE_SHELF_MAX = 200       # stories a day per lane that only its chip shows
LANE_ADD_MAX = 40          # to a lane's chip per hourly update
# The Photos tab's Everything view (wire_photos.py and Grok's Pictures recap)
PHOTOS_WORLD_DAYS = 7
PHOTOS_WORLD_MAX = 60
PICKS_EVERY_HOURS = 6      # re-rank cadence: about 6am, noon, 6pm (Stephen, 2026-10-17: one to three a day, not hourly)
PICKS_MIN_POOL = 8         # the first ranking of the day waits for this many items
URGENT_SCORE = 9           # a local story this big re-ranks the picks at once
QUIET_BEFORE_HOUR = 6      # overnight the editor sleeps unless something is urgent
MIN_NEW = 2                # fewer new items than this is a quiet hour
# The river's order inside an update (Stephen, 2026-10-17: local and national
# "get a little lost when it's all in a row ... websites tend to update in bunches")
KIND_RUN_MAX = 3           # never more local (or national) than this in a row while the other kind waits
POST_RUN_MAX = 2           # nor more posts than this from one of SPREAD_CHANNELS in a row
SPREAD_CHANNELS = ("x", "facebook", "reddit")   # an X desk posts five at a time
STALE_HOURS = 4
# The workflow's schedule has three slots an hour (:07, :27, :47) because
# GitHub sheds most scheduled ticks; whichever lands first does the hour's
# work. Additions wait this long after the last model call, so two ticks (or
# a tick and the Mac's dispatch) in one hour never pay twice. Picks that are
# due and urgent stories still go at once.
CALL_GAP_MINUTES = 50
ALREADY_RAN_PICKS = 15     # per earlier day, shown to the editor as "already ran"
MAX_TOKENS = {"openrouter": 6000, "anthropic": 16000}
LABELS = (("morning", "Morning", 0), ("midday", "Midday", 11),
          ("afternoon", "Afternoon", 14), ("evening", "Evening", 18))
ITEM_KEYS = ("id", "ch", "local", "src", "name", "title", "url", "posted_at",
             "thumb", "media", "handle", "discuss", "site", "topic", "kind", "own",
             "town", "comments", "sport")
REDDIT_INTAKE_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
                     "reddit-data/data/reddit-intake.json")
REDDIT_POST_ID_RE = re.compile(r"/comments/([a-z0-9]+)", re.I)
X_STATUS_RE = re.compile(r"^https://(?:www\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/\d+")

TASK = """

## Your job this hour

You are the editor of the Wire. Everything below is numbered. You answer only
with numbers from those lists and short reasons. You never write, shorten or
rewrite a headline: the page shows each one exactly as the outlet wrote it.

- `add`: numbers from NEW that earn a place in today's river this hour (at
  most 40, or 60 when the river is empty), the most important first. The river
  is meant to be long: add everything that earns a place, leave out what does
  not. A passed item does not come back later today. The page mixes local and
  national and spreads the outlets for you.
- `lead` and `lead_why`: the item that leads the current update, from what you
  add this hour or from the current update's items already in the river, with
  a reason in the style of the picks. Use -1 and an empty reason only when
  nothing is added and the current update has no items.
- `sports`: numbers from NEW that belong on the sport chips (see Sports below).
- `markets`: numbers from NEW that belong on the Markets chip (see Markets below).
- `drop`: numbers from TODAY'S RIVER to remove, only when the river would pass
  300 items. Otherwise an empty list.
- `picks`, only when asked for: the ranked "What matters today" list from the
  river and NEW together: 40 picks, about half local and half national (the
  news decides the split, fifteen to twenty-five each),
  fewer only when the day truly lacks them. Each has a reason under 90
  characters. A pick from NEW is added to the river for you.
  The ranking is a single list by importance, not two lists: local and
  national interleaved, the most important first, whichever kind it is.

Newsletter editions in NEW join the river on their own; leave them out of
`add` unless one should lead.

Sports are kept light. The main river carries at most four sports stories a
day, only the biggest moments: a title, a blockbuster trade, a star's career-
changing injury, a firing everyone talks about. Put those in `add`. A Vermont
team's story goes in `add` only when it is big here (a UVM title run, a state
final); the page counts it outside the four. Everything else worth knowing,
marked `sports/<sport>` in NEW (NBA, NFL, NHL, tennis, MLB, college, Vermont
teams), goes in `sports`: trades and signings, injuries, firings, results of
big games, league decisions, and every Vermont team's result. Those show only
on the page's sport chips. A few per sport each hour is plenty; leave out
betting, fantasy, power rankings and listicles. A sports story is a pick only
when it is the day's big news.

Markets are kept light the same way. Stories marked `markets` in NEW (stocks,
indexes, bonds, oil, gold, crypto prices, earnings reactions, what moved and
why) reach the main river at most three a day, only the big moves: a crash or
a record, a rate decision's market reaction, a giant company's earnings shock.
Put those in `add`. Everything else worth knowing goes in `markets`, which the
Markets chip shows: the day's biggest movers and why, earnings that moved a
stock, a data release that moved the market. Leave out stock picks, analysts'
buy and sell calls, "stocks to buy", price predictions and personal-finance
advice: plain facts about what moved, never investment advice.
"""


# ----------------------------------------------------------------------
# Files and days
# ----------------------------------------------------------------------

def paths(data_dir):
    return {
        "today": os.path.join(data_dir, "wire-today.json"),
        "state": os.path.join(data_dir, "wire-state.json"),
        "tags": os.path.join(data_dir, "wire-tags.json"),
        "archive": os.path.join(data_dir, "wire"),
    }


def label_for(et):
    key, label = LABELS[0][0], LABELS[0][1]
    for k, name, start in LABELS:
        if et.hour >= start:
            key, label = k, name
    return key, label


def clock(et):
    return et.strftime("%I:%M %p").lstrip("0").lower()


def empty_day(date):
    return {"v": 1, "date": date, "tz": "America/New_York", "final": False,
            "updated": None, "checked": None, "count": 0, "counts": {},
            "picks": [], "picks_earlier": [], "updates": [], "sources": {}}


def river(day):
    return [item for update in day.get("updates") or [] for item in update.get("items") or []]


def counts(items):
    out = {}
    for scope in ("local", "everything"):
        pool = [item for item in items if scope == "everything" or item.get("local")]
        tally = {chip: 0 for chip in wc.CHIPS}
        tally["all"] = len(pool)
        for item in pool:
            if item.get("ch") in tally:
                tally[item["ch"]] += 1
        out[scope] = tally
    return out


def freeze(day, data_dir):
    """Write yesterday as a final edition and refresh the index."""
    archive = paths(data_dir)["archive"]
    final = dict(day, final=True)
    final["counts"] = counts(river(final))
    final["count"] = len(river(final))
    wc.write_json(os.path.join(archive, f"{day['date']}.json"), final)
    return final


def prune_and_index(data_dir, today):
    """Delete editions older than KEEP_DAYS; write data/wire/index.json."""
    archive = paths(data_dir)["archive"]
    cutoff = (datetime.fromisoformat(today) - timedelta(days=KEEP_DAYS)).date().isoformat()
    editions = []
    for path in sorted(glob.glob(os.path.join(archive, "????-??-??.json")), reverse=True):
        date = os.path.basename(path)[:10]
        if date < cutoff:
            os.remove(path)
            continue
        day = wc.load_json(path, {})
        picks = len(day.get("picks") or [])
        editions.append({"date": date, "count": day.get("count", 0), "picks": picks,
                         "picks_total": picks + len(day.get("picks_earlier") or [])})
    if editions:
        wc.write_json(os.path.join(archive, "index.json"), {"v": 1, "editions": editions})
    return editions


def roll_over(day, state, today, data_dir):
    """At the first run of a new Eastern day: freeze the old one, start
    fresh. Returns (day, state, frozen_date_or_None)."""
    frozen = None
    if day.get("date") and day["date"] != today:
        if river(day):
            freeze(day, data_dir)
            frozen = day["date"]
        day = empty_day(today)
        # yesterday's passes stand: the window still reaches those items
        state = {"date": today, "considered": state.get("considered_today", []),
                 "considered_today": [], "picks_at": None}
    elif not day.get("date"):
        day = empty_day(today)
    if state.get("date") != today:
        state = {"date": today, "considered": [], "considered_today": [], "picks_at": None}
    return day, state, frozen


def reserved(data_dir, today):
    """(ids, urls) of everything on the last RESERVE_DAYS editions, and the
    top picks of the last two, for the editor's "already ran" list."""
    archive = paths(data_dir)["archive"]
    ids, urls, ran = set(), set(), []
    start = datetime.fromisoformat(today)
    for back in range(1, RESERVE_DAYS + 1):
        date = (start - timedelta(days=back)).date().isoformat()
        day = wc.load_json(os.path.join(archive, f"{date}.json"), None)
        if not isinstance(day, dict):
            continue
        shelf = [item for items in (day.get("sports") or {}).values() for item in items or []
                 if isinstance(item, dict)]
        for item in river(day) + list(day.get("picks") or []) + list(day.get("picks_earlier") or []) \
                + shelf:
            ids.add(item.get("id"))
            urls.add(item.get("url"))
        if back <= 2:
            for pick in (day.get("picks") or [])[:ALREADY_RAN_PICKS]:
                ran.append((date, pick.get("name"), pick.get("title")))
    return ids, urls, ran


# ----------------------------------------------------------------------
# Candidates
# ----------------------------------------------------------------------

def default_score(item):
    return 5 if item.get("local") else 3


def annotate(item, comments=None):
    """Place, the local-is-the-subject rule, and a thread's comment count.

    Local is the subject, not the outlet: a headline that names the
    Burlington area, a Vermont town or Vermont itself is local whoever
    published it (Vox on a Vermont governor's race), and one about New
    Hampshire is not local even on WCAX. Only news headlines move; an X
    post, a thread or a newsletter keeps its own channel."""
    region, town = wc.place_of(item.get("title"), item.get("src"))
    item["region"] = region
    if town:
        item["town"] = town
    if item.get("ch") in ("local", "world") and region:
        item["local"] = region != "out"
        item["ch"] = "local" if item["local"] else "world"
    if comments and item.get("ch") == "reddit":
        match = REDDIT_POST_ID_RE.search(item.get("url") or "")
        count = comments.get(match.group(1).lower()) if match else None
        if isinstance(count, int):
            item["comments"] = count
    return item


def apply_tags(items, tags, comments=None):
    """Fold the tagger's verdict into each item. Untagged items keep their
    mechanical channel and a default score; junk is removed. The mechanical
    place rules run last, so they win over the tagger."""
    out = []
    for item in items:
        tag = tags.get(item["id"])
        item = dict(item)
        if isinstance(tag, dict):
            if tag.get("junk") not in (None, "none"):
                continue
            item["ch"] = tag.get("ch") or item["ch"]
            item["local"] = bool(tag.get("local", item["local"]))
            item["topic"] = tag.get("topic")
            if wc.norm_sport(tag.get("sport")) and not item.get("sport"):
                item["sport"] = wc.norm_sport(tag["sport"])
            if item["topic"] in ("business", "economy") and item.get("src") in wc.MARKETS_SOURCES:
                item["topic"] = "markets"   # a markets desk's story is a market story
            item["_score"] = tag.get("score", default_score(item))
        else:
            item["_score"] = default_score(item)
        out.append(annotate(item, comments))
    return out


def reddit_comments(url=REDDIT_INTAKE_URL, timeout=15):
    """{post_id: comment count} from the Reddit bridge's intake, when it
    exists and its OAuth route has counts. Never a failure: {} otherwise."""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            intake = json.load(response)
    except Exception:  # noqa: BLE001 — the bridge is optional
        return {}
    out = {}
    for post in (intake or {}).get("posts") or []:
        if not isinstance(post, dict) or not isinstance(post.get("comments"), int):
            continue
        match = REDDIT_POST_ID_RE.search(post.get("url") or "")
        if match:
            out[match.group(1).lower()] = post["comments"]
    return out


def edition_window(et):
    """(from, until) epochs between which a newsletter edition counts as
    today's: 9 pm Eastern last night (EDITION_LATE_HOUR) up to midnight
    tonight. An edition stamped after midnight waits for tomorrow's river."""
    midnight = et.replace(hour=0, minute=0, second=0, microsecond=0)
    late = (midnight - timedelta(days=1)).replace(hour=EDITION_LATE_HOUR)
    tomorrow = (midnight + timedelta(days=1)).replace(hour=0)
    return int(late.timestamp()), int(tomorrow.timestamp())


def edition_since(et):
    return edition_window(et)[0]


def candidates(pulse, now_ts, et):
    """The run's pool before tags: the WINDOW_HOURS window for everything,
    reaching back further for a newsletter edition only as far as today's
    edition window does (late at night that is more than WINDOW_HOURS)."""
    since = edition_since(et)
    hours = max(WINDOW_HOURS, (now_ts - since) / 3600 + 1)
    cutoff = now_ts - WINDOW_HOURS * 3600
    return [item for item in wc.wire_items(pulse, now_ts, hours)
            if item["d"] >= cutoff or item.get("ch") == "newsletters"]


def evict_stale_editions(day, since):
    """Take out of today's river any newsletter edition sent before `since`
    (filed before the day guard existed). Returns the ids removed."""
    gone = set()
    for update in day.get("updates") or []:
        keep = []
        for item in update.get("items") or []:
            stamp = item.get("posted_at")
            if (item.get("ch") == "newsletters" and stamp
                    and datetime.fromisoformat(stamp).timestamp() < since):
                gone.add(item["id"])
            else:
                keep.append(item)
        update["items"] = keep
        if (update.get("lead") or {}).get("id") in gone:
            update["lead"] = None
    if gone and any(pick["id"] in gone for pick in day.get("picks") or []):
        kept = [pick for pick in day["picks"] if pick["id"] not in gone]
        day["picks"] = [dict(pick, rank=rank) for rank, pick in enumerate(kept, start=1)]
    day["updates"] = [update for update in day.get("updates") or [] if update.get("items")]
    return sorted(gone)


def select_new(pool, in_river, considered, reserved_ids, reserved_urls, editions_in=None):
    """The NEW list: eligible, not yet in the river, not passed on, not run
    before. Returns (new_items, auto_passed_ids). Newsletter editions skip
    the score bar and the caps: apply_answer adds every one of them, but
    only today's (sent inside `editions_in`, see edition_window). National
    sports items have their own lane and a lower score bar."""
    local, world, auto, editions, sports = [], [], [], [], []
    for item in pool:
        if item["id"] in in_river or item["id"] in considered:
            continue
        if item["id"] in reserved_ids or item["url"] in reserved_urls:
            continue
        if item.get("ch") == "newsletters":
            if editions_in is None or editions_in[0] <= item["d"] < editions_in[1]:
                editions.append(item)
            continue
        national_sport = not item["local"] and item.get("sport") and item.get("ch") in ("world", "x")
        bar = SPORTS_MIN_SCORE if national_sport else WORLD_MIN_SCORE
        if not item["local"] and item["_score"] < bar:
            auto.append(item["id"])
            continue
        (local if item["local"] else sports if national_sport else world).append(item)
    rank = lambda item: (-item["_score"], -item["d"])  # noqa: E731
    local.sort(key=rank)
    world.sort(key=rank)
    sports.sort(key=rank)
    return (local[:NEW_MAX_LOCAL] + world[:NEW_MAX_WORLD] + sports[:NEW_MAX_SPORTS]
            + editions), auto


def age_label(item, now_ts):
    hours = max(0, (now_ts - item["d"]) / 3600)
    return f"{hours:.0f}h" if hours >= 1 else f"{hours * 60:.0f}m"


def line(index, item, now_ts):
    who = item.get("handle") or item.get("name") or item.get("src")
    topic = f" · {item['topic']}" if item.get("topic") else ""
    if item.get("sport"):
        topic = f" · sports/{item['sport']}"
    place = {"btv": "Burlington area", "away": "outside the Burlington area",
             "out": "out of state"}.get(item.get("region"), "")
    if place and item.get("town"):
        place = f"{item['town']} ({place})"
    place = f" · {place}" if place else ""
    talk = ""
    if item.get("ch") in wc.THREAD_CHANNELS:
        count = item.get("comments")
        talk = f" · {count} comments" if isinstance(count, int) else " · comments unknown"
    block = "the Brief's own edition, pinned above the picks" if item.get("own") else wc.pick_block(item)
    gate = f" · river only ({block})" if block else ""
    return (f"{index}. {'LOCAL' if item['local'] else 'NATIONAL'} · {item['ch']} · {who} · "
            f"{age_label(item, now_ts)}{topic}{place}{talk}{gate} · {item['title']}")


def shown_river(river_items, current_ids, want_picks):
    """The river items the editor sees. On a re-rank, all of them (a pick
    may come from anywhere today). Between re-ranks, the current update's
    items and the newest RIVER_SHOWN_HOURLY: enough to judge leads and
    near-duplicates, and the prompt stays the same size as the river grows."""
    if want_picks or len(river_items) <= RIVER_SHOWN_HOURLY:
        return list(river_items)
    newest = sorted(river_items, key=lambda item: item.get("posted_at") or "",
                    reverse=True)[:RIVER_SHOWN_HOURLY]
    keep = {item["id"] for item in newest} | set(current_ids)
    return [item for item in river_items if item["id"] in keep]


def build_prompt(numbered_river, new, current, ran, want_picks, et, label, now_ts, total=None,
                 lanes_in_river=None):
    lines = [f"It is {et.strftime('%A, %B')} {et.day}, {clock(et)} in Burlington. "
             f"This is the {label} update."]
    if want_picks:
        lines.append("Rank the picks this hour (`picks`).")
    else:
        lines.append("The picks stand this hour: return no `picks`.")
    if ran:
        lines += ["", "ALREADY RAN on earlier days (never re-serve these stories "
                  "without a genuinely new development):"]
        lines += [f"- {title} ({name}, {date})" for date, name, title in ran]
    if current:
        lines += ["", f"The current {label} update holds: "
                  + ", ".join(str(index) for index in current) + "."]
    total = len(numbered_river) if total is None else total
    shown = (f"{len(numbered_river)} items" if total == len(numbered_river)
             else f"{len(numbered_river)} shown of {total} items, the newest")
    lines += ["", f"TODAY'S RIVER ({shown}):"]
    lines += [line(i, item, now_ts) for i, item in enumerate(numbered_river)] or ["(empty)"]
    offset = len(numbered_river)
    for lane, label_ in (("sports", "Sports"), ("markets", "Market stories")):
        if lanes_in_river and lane in lanes_in_river and any(lane_of(item) == lane for item in new):
            lines += ["", f"{label_} in today's main river: {lanes_in_river[lane]} of {LANE_MAX[lane]}."]
    lines += ["", f"NEW since the last update ({len(new)} items):"]
    lines += [line(offset + i, item, now_ts) for i, item in enumerate(new)] or ["(none)"]
    return "\n".join(lines)


def schema(want_picks):
    props = {
        "add": {"type": "array", "maxItems": 30, "items": {"type": "integer"}},
        "lead": {"type": "integer"},
        "lead_why": {"type": "string", "maxLength": WHY_MAX},
        "drop": {"type": "array", "maxItems": 30, "items": {"type": "integer"}},
        "sports": {"type": "array", "maxItems": LANE_ADD_MAX, "items": {"type": "integer"}},
        "markets": {"type": "array", "maxItems": LANE_ADD_MAX, "items": {"type": "integer"}},
    }
    if want_picks:
        props["picks"] = {"type": "array", "maxItems": PICK_COUNT, "items": {
            "type": "object",
            "properties": {"i": {"type": "integer"},
                           "why": {"type": "string", "maxLength": WHY_MAX}},
            "required": ["i", "why"], "additionalProperties": False}}
    return {"type": "object", "properties": props, "required": sorted(props),
            "additionalProperties": False}


# ----------------------------------------------------------------------
# Validation: the model's answer -> the day, never trusted
# ----------------------------------------------------------------------

def as_index(value, lo, hi):
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if lo <= value < hi else None


def public(item):
    return {key: item[key] for key in ITEM_KEYS if item.get(key) not in (None, "")}


def spread_outlets(picks):
    """Never two picks from one outlet back to back: move the second one down
    past the next pick from somewhere else. Stable otherwise."""
    out = list(picks)
    for k in range(1, len(out)):
        if out[k]["src"] == out[k - 1]["src"]:
            swap = next((j for j in range(k + 1, len(out)) if out[j]["src"] != out[k - 1]["src"]), None)
            if swap is not None:
                out.insert(k, out.pop(swap))
    return out


def _fits(out, item, waiting, kind=True, outlet=True, posts=True):
    """May `item` go next after `out`? `waiting` counts the items still to
    place, `item` included: by kind (True local, False national), by channel
    ("ch:x"), and in all ("all")."""
    if not out:
        return True
    local, ch = bool(item.get("local")), item.get("ch")
    if kind and waiting[not local] and len(out) >= KIND_RUN_MAX \
            and all(bool(o.get("local")) == local for o in out[-KIND_RUN_MAX:]):
        return False
    if outlet and item.get("src") == out[-1].get("src"):
        return False
    if posts and ch in SPREAD_CHANNELS and waiting["all"] > waiting["ch:" + ch] \
            and len(out) >= POST_RUN_MAX and all(o.get("ch") == ch for o in out[-POST_RUN_MAX:]):
        return False
    return True


def _count(waiting, item, step):
    for key in (bool(item.get("local")), "ch:" + str(item.get("ch")), "all"):
        waiting[key] = waiting.get(key, 0) + step


def spread_river(queue, placed=()):
    """Order `queue` (most important first) after the already `placed` items:
    each slot takes the most important item that keeps the house rules, which
    are, from hardest to softest,

    1. never more than KIND_RUN_MAX local, or national, in a row while the
       other kind still has items to place
    2. never two from one outlet back to back
    3. never more than POST_RUN_MAX X posts (or Facebook, or Reddit) in a row
       while anything else waits

    It looks one slot ahead, so a choice does not leave the next slot no way
    to keep them (AP, Reuters, AP, then only an AP and a local left). When no
    item keeps all three, the softest gives way first. An order that already
    keeps them comes back unchanged, so a settled update stays put."""
    queue, out = list(queue), list(placed)
    waiting = {True: 0, False: 0, "all": 0}
    for item in queue:
        _count(waiting, item, 1)

    def leaves_a_move(k):
        if len(queue) == 1:
            return True
        _count(waiting, queue[k], -1)
        after = out + [queue[k]]
        ok = any(_fits(after, item, waiting) for j, item in enumerate(queue) if j != k)
        _count(waiting, queue[k], 1)
        return ok

    while queue:
        fitting = [k for k, item in enumerate(queue) if _fits(out, item, waiting)]
        at = next((k for k in fitting if leaves_a_move(k)), fitting[0] if fitting else None)
        for rules in ((True, True, False), (True, False, False)):
            if at is None:
                at = next((k for k, item in enumerate(queue) if _fits(out, item, waiting, *rules)), None)
        item = queue.pop(at if at is not None else 0)
        _count(waiting, item, -1)
        out.append(item)
    return out[len(placed):]


def order_update(items, lead_id=None, fresh=()):
    """An update's items in reading order: the lead first, then this hour's
    additions (`fresh`, ids most important first), then what the update
    already held, in its stored order, all spread by spread_river. Older items
    move only when a rule needs them to."""
    rank = {item_id: k for k, item_id in enumerate(fresh)}
    lead = [item for item in items if item["id"] == lead_id][:1]
    new = sorted((item for item in items if item["id"] in rank and item["id"] != lead_id),
                 key=lambda item: rank[item["id"]])
    held = [item for item in items if item["id"] not in rank and item["id"] != lead_id]
    return lead + spread_river(new + held, lead)


def order_picks(picks):
    """The house rules on the editor's ranking, applied in order:

    1. local picks sorted by tier (Burlington area and statewide decisions,
       then statewide features, then trips out of the area) among the local
       slots only, the editor's order kept within a tier; national picks
       keep their slots, never moved down, so the editor's interleave of
       local and national by importance stands (Stephen, 2026-10-17: the
       Everything view should mix both, the most important up top)
    2. never two from one outlet back to back
    3. at most THREAD_PICKS_MAX threads, and none above THREAD_TOP_RANK"""
    slots = [i for i, pick in enumerate(picks) if pick.get("local")]
    local = sorted((picks[i] for i in slots), key=wc.pick_tier)
    out = list(picks)
    for slot, pick in zip(slots, local):
        out[slot] = pick
    out = spread_outlets(out)
    threads, rest = [], []
    for pick in out:
        if pick.get("ch") in wc.THREAD_CHANNELS:
            if len(threads) < wc.THREAD_PICKS_MAX:
                threads.append(pick)
            continue
        rest.append(pick)
    floor = wc.THREAD_TOP_RANK - 1
    for pick in threads:
        at = next(i for i, p in enumerate(out) if p is pick)
        rest.insert(min(max(at, floor), len(rest)), pick)
        floor += 1
    return rest


def retire_picks(old, earlier, new, previous_at=None):
    """The day keeps every story the editor ranked. Returns `picks_earlier`
    after a re-rank: the stories of the old ranking that the new one left
    out, with their last rank, reason and `ranked_at`, plus what was already
    there, minus anything back in the new ranking. Newest ranking first,
    then by rank; one row per story."""
    now_in = {pick["id"] for pick in new}
    by_id = {}
    for pick in list(earlier or []) + list(old or []):   # the old ranking is the newer one
        if pick.get("id") in now_in or pick.get("own"):
            continue
        by_id[pick["id"]] = dict(pick, ranked_at=pick.get("ranked_at") or previous_at)
    out = sorted(by_id.values(), key=lambda pick: pick.get("rank") or 0)
    return sorted(out, key=lambda pick: pick.get("ranked_at") or "", reverse=True)


# ----------------------------------------------------------------------
# Lanes kept light: sports and markets. A few of each in the main river a
# day, the rest on their chips (day["sports"] by chip, day["markets"])
# ----------------------------------------------------------------------

def lane_of(item):
    """"sports", "markets" or None: the light lane an item belongs to."""
    if wc.norm_sport(item.get("sport")):
        return "sports"
    if item.get("topic") == "markets":
        return "markets"
    return None


def big_here(item, score=None):
    """A Vermont team's story big enough here to run outside the sports cap."""
    score = item.get("_score") if score is None else score
    return wc.norm_sport(item.get("sport")) == "local" and (score or 0) >= LOCAL_SPORTS_BIG


def counted(items, lane, scores=None):
    """The items that count against `lane`'s daily cap in the main river.
    `scores` is {id: tag score} for items that no longer carry their own."""
    scores = scores or {}
    return [item for item in items if lane_of(item) == lane
            and not big_here(item, scores.get(item.get("id"), item.get("_score")))]


def shelf_items(day, lane=None):
    """The day's light-lane stories that only their chips show (not in the
    river), for one lane or both."""
    in_river = {item["id"] for item in river(day)}
    held = []
    if lane in (None, "sports"):
        held += [item for items in (day.get("sports") or {}).values() for item in items or []]
    if lane in (None, "markets"):
        held += list(day.get("markets") or [])
    out, seen = [], set()
    for item in held:
        if isinstance(item, dict) and item.get("id") and item["id"] not in in_river \
                and item["id"] not in seen:
            seen.add(item["id"])
            out.append({key: value for key, value in item.items() if key != "river"})
    return out


def shelve(day, items):
    """Put light-lane stories on their chips' shelf. Returns the ids added."""
    have = {item.get("id") for item in shelf_items(day)}
    added = []
    for item in items:
        lane = lane_of(item)
        if lane is None or item["id"] in have:
            continue
        have.add(item["id"])
        entry = {key: value for key, value in public(item).items() if key != "river"}
        if lane == "sports":
            chip = wc.sport_chip(item.get("sport"), day["date"]) or "other"
            day.setdefault("sports", {}).setdefault(chip, []).append(entry)
        else:
            day.setdefault("markets", []).append(entry)
        added.append(item["id"])
    return added


def cap_river_lanes(day, scores=None):
    """Hold the main river to each lane's daily cap (LANE_MAX). Priority:
    the current picks in rank order, then the updates' leads, then the
    earlier picks, then the highest tag scores (river order on a tie); the
    rest move to the lane's shelf, and a moved story leaves the picks and
    loses its lead. apply_answer already keeps the caps, so this only moves
    stories filed before them (2026-10-19), or a Vermont sports story whose
    tag turned out smaller. Returns the ids moved."""
    scores = scores or {}
    gone = set()
    for lane, cap in LANE_MAX.items():
        items = counted(river(day), lane, scores)
        if len(items) <= cap:
            continue
        rank = {}
        for pick in day.get("picks") or []:
            rank.setdefault(pick["id"], (0, pick.get("rank") or 0))
        for update in day.get("updates") or []:
            if update.get("lead"):
                rank.setdefault(update["lead"]["id"], (1, 0))
        for n, pick in enumerate(day.get("picks_earlier") or []):
            rank.setdefault(pick["id"], (2, n))
        order = sorted(items, key=lambda item: rank.get(item["id"],
                                                       (3, -(scores.get(item["id"]) or 0))))
        move = order[cap:]
        gone |= {item["id"] for item in move}
        shelve(day, move)
    if not gone:
        return []
    for update in day.get("updates") or []:
        update["items"] = [item for item in update.get("items") or [] if item["id"] not in gone]
        if (update.get("lead") or {}).get("id") in gone:
            update["lead"] = None
    day["updates"] = [update for update in day.get("updates") or [] if update.get("items")]
    if any(pick["id"] in gone for pick in day.get("picks") or []):
        kept = [pick for pick in day["picks"] if pick["id"] not in gone]
        day["picks"] = [dict(pick, rank=rank) for rank, pick in enumerate(kept, start=1)]
    day["picks_earlier"] = [pick for pick in day.get("picks_earlier") or [] if pick["id"] not in gone]
    return sorted(gone)


def lane_view(day, items, lane):
    """Every story of the day in `lane`, newest first: the river's (marked
    "river": true) and the shelf's (at most LANE_SHELF_MAX)."""
    shelf = sorted(shelf_items(day, lane), key=lambda item: item.get("posted_at") or "",
                   reverse=True)[:LANE_SHELF_MAX]
    every = [dict(item, river=True) for item in items if lane_of(item) == lane] + shelf
    return sorted(every, key=lambda item: item.get("posted_at") or "", reverse=True)


def sports_of(day, items):
    """{chip: [item, ...]} every sports story of the day, newest first."""
    out = {}
    for item in lane_view(day, items, "sports"):
        chip = wc.sport_chip(item.get("sport"), day.get("date")) or "other"
        out.setdefault(chip, []).append(item)
    return out


def apply_answer(day, answer, numbered_river, new, want_picks, et, now, previous_at=None,
                 scores=None):
    """Fold a validated answer into the day. Returns a dict of what changed.
    `previous_at` is when the standing picks were ranked, for picks written
    before they carried their own `ranked_at`. `scores` is {id: tag score}
    for today's river, which the sports cap reads."""
    offset, total = len(numbered_river), len(numbered_river) + len(new)
    key, label = label_for(et)
    stamp = now.replace(microsecond=0).isoformat()
    by_index = numbered_river + new

    adds = []
    for value in answer.get("add") or []:
        index = as_index(value, offset, total)
        if index is not None and index not in adds:
            adds.append(index)
    adds = adds[:ADD_MAX if numbered_river else ADD_MAX_FIRST]
    # the Brief's own edition is always in the paper, never the model's call;
    # so is every linkable newsletter edition the tagger did not junk, or the
    # Newsletters chip shows a stray one a day while Inoreader shows fifteen
    # (Stephen, 2026-10-19: "Why is my Newsletter tab have 0 articles?")
    for index in range(offset, total):
        item = by_index[index]
        if (item.get("own") or item.get("ch") == "newsletters") and index not in adds:
            adds.append(index)

    # Lanes kept light (Stephen, 2026-10-19): the main river takes sports and
    # market stories only up to each lane's daily cap (LANE_MAX): picks first,
    # in rank order, then the editor's adds in its order. A Vermont sports
    # story big here is outside the cap. Everything else in a lane, and the
    # editor's `sports` and `markets` lists, go to that lane's shelf.
    room = {lane: cap - len(counted(river(day), lane, scores)) for lane, cap in LANE_MAX.items()}
    to_shelf = []
    picks, pick_seen = [], set()
    if want_picks:
        for entry in answer.get("picks") or []:
            index = as_index(entry.get("i") if isinstance(entry, dict) else None, 0, total)
            if index is None or index in pick_seen or by_index[index].get("own") \
                    or wc.pick_block(by_index[index]):
                # a "river only" item stays out of the picks whatever the answer;
                # the Brief's own edition is pinned above them as `brief` instead
                continue
            why = wc.trim(entry.get("why", ""), WHY_MAX)
            if not why:
                continue
            lane = lane_of(by_index[index])
            if lane and index >= offset and counted([by_index[index]], lane):
                if room[lane] <= 0:
                    if index not in to_shelf:
                        to_shelf.append(index)   # past the cap: the chip, not the picks
                    continue
                room[lane] -= 1
            pick_seen.add(index)
            picks.append((index, why))
            if index >= offset and index not in adds:
                adds.append(index)   # picks are river items too
            if len(picks) == PICK_COUNT:
                break

    picked = {index for index, _ in picks}
    kept = []
    for index in adds:
        item = by_index[index]
        lane = lane_of(item)
        if index in picked or not lane or not counted([item], lane):
            kept.append(index)
        elif room[lane] > 0:
            kept.append(index)
            room[lane] -= 1
        elif index not in to_shelf:
            to_shelf.append(index)
    adds = kept
    for lane in LANE_MAX:
        listed = 0
        for value in answer.get(lane) or []:
            index = as_index(value, offset, total)
            if index is None or index in adds or index in to_shelf \
                    or lane_of(by_index[index]) != lane or listed >= LANE_ADD_MAX:
                continue
            to_shelf.append(index)
            listed += 1
    shelved = shelve(day, [by_index[index] for index in to_shelf])

    # the current update: create it if this is the period's first run
    updates = day.setdefault("updates", [])
    current = updates[0] if updates and updates[0].get("key") == key else None
    if adds and current is None:
        current = {"key": key, "label": label, "time": clock(et), "updated": stamp,
                   "lead": None, "items": []}
        updates.insert(0, current)
    added_ids = []
    for index in adds:
        item = public(by_index[index])
        current["items"].append(item)
        added_ids.append(item["id"])

    # the lead: from this hour's adds or the current update's own items
    lead_ok = set(added_ids) | {item["id"] for item in (current or {}).get("items", [])}
    lead_index = as_index(answer.get("lead"), 0, total)
    lead_why = wc.trim(answer.get("lead_why", ""), WHY_MAX)
    if current is not None and lead_index is not None and lead_why \
            and by_index[lead_index]["id"] in lead_ok:
        current["lead"] = {"id": by_index[lead_index]["id"], "why": lead_why}

    # drops: only past RIVER_MAX, never a pick (current, or any the day ranked
    # earlier: they stay river items, so the counts and chips include them),
    # a lead or the Brief's own edition
    protected = {by_index[index]["id"] for index, _ in picks} if want_picks else set()
    protected |= {pick["id"] for pick in (day.get("picks") or []) + (day.get("picks_earlier") or [])}
    protected |= {update["lead"]["id"] for update in updates if update.get("lead")}
    protected |= {item["id"] for item in river(day) if item.get("own")}   # the Brief stays
    # and so do newsletter editions: filed whatever the editor says, they
    # would otherwise be the oldest national items the cap drops first
    protected |= {item["id"] for item in river(day) if item.get("ch") == "newsletters"}
    dropped = []
    excess = len(river(day)) - RIVER_MAX
    if excess > 0:
        asked = [as_index(value, 0, offset) for value in answer.get("drop") or []]
        order = [numbered_river[i]["id"] for i in asked if i is not None]
        # the editor's choices first, then the weakest national, oldest first
        # then the oldest national items, then the oldest of everything else:
        # the cap is a hard line, so the fallback order covers the whole river
        oldest = lambda item: item.get("posted_at") or ""  # noqa: E731
        order += [item["id"] for item in sorted(river(day), key=lambda item: (
            bool(item.get("local")), oldest(item)))]
        for item_id in order:
            if excess <= 0:
                break
            if item_id in protected or item_id in dropped:
                continue
            for update in updates:
                before = len(update["items"])
                update["items"] = [item for item in update["items"] if item["id"] != item_id]
                if len(update["items"]) < before:
                    dropped.append(item_id)
                    excess -= 1
        day["updates"] = updates = [u for u in updates if u["items"]]

    # order inside each update: the lead first, then this hour's additions in
    # the editor's order (most important first), then the update's earlier
    # items; local and national mixed, outlets and X bunches spread
    # (order_update). An update that already reads well is left as it is, so
    # only the current one really moves.
    fresh = [by_index[index]["id"] for index in adds]
    for update in updates:
        update["items"] = order_update(update["items"], (update.get("lead") or {}).get("id"),
                                       fresh if update is current else ())
    if adds and current is not None:
        current["updated"] = stamp
        current["time"] = clock(et)

    if want_picks and picks:
        # at most NATIONAL_PICKS national and LOCAL_PICKS local picks: half and
        # half on an ordinary day, the news deciding the split within the band
        kept, national, local_n = [], 0, 0
        for index, why in picks:
            if not by_index[index].get("local"):
                national += 1
                if national > NATIONAL_PICKS:
                    continue
            else:
                local_n += 1
                if local_n > LOCAL_PICKS:
                    continue
            kept.append((index, why))
        ranked = order_picks([dict(by_index[index], why=why) for index, why in kept])
        ranked = [dict(public(pick), why=pick["why"]) for pick in ranked]
        in_river = {item["id"] for item in river(day)}
        fresh = [dict(pick, rank=rank, ranked_at=stamp) for rank, pick in
                 enumerate((p for p in ranked if p["id"] in in_river), start=1)]
        day["picks_earlier"] = retire_picks(day.get("picks"), day.get("picks_earlier"),
                                            fresh, previous_at)
        day["picks"] = fresh
    return {"added": added_ids, "dropped": dropped, "picks": len(picks) if want_picks else None,
            "shelved": shelved}


REASONS_TASK = """You check the one-line reasons on a Burlington, Vermont news page.

A reason must add something the headline does not say: what changes for the
reader, who it reaches, what to do about it. It must not restate or paraphrase
the headline, must stay under 90 characters, and may not state a fact (a
number, a date, a name) that the headline does not give.

Good: "Your electric bill, the next time it comes." "Plan another way across
the river for the nights it is down to one lane." Bad: "Police are looking for
whoever broke into a market." (restates) "A local shop growing into a new line
of goods." (paraphrases "DandyLion expands into furniture") "A free UVM evening
on Vermont's Revolutionary history." (neither "free" nor "UVM" is in its headline
"Center for Research on Vermont hosts revolutionary war history panel").

Below, each numbered line is a headline and its reason. Lines marked MUST are
known restatements: rewrite every one of them. Lines marked MUST (invented:
"word") state a fact the headline does not give, that word: rewrite them
without it or any other fact the headline lacks. Rewrite any other reason that
only restates or paraphrases its headline. Return only the lines you rewrote.

For each line you return, `problem` is your note on what was wrong (never shown
to anyone) and `why` is the NEW reason exactly as a reader will see it on the
page: a plain sentence about the story, never about the headline, the old
reason, these rules or this list."""

REASONS_SCHEMA = {
    "type": "object",
    "properties": {"rewrites": {"type": "array", "maxItems": PICK_COUNT + 1, "items": {
        "type": "object",
        "properties": {"i": {"type": "integer"},
                       "problem": {"type": "string", "maxLength": 200},
                       "why": {"type": "string", "maxLength": WHY_MAX}},
        "required": ["i", "problem", "why"], "additionalProperties": False}}},
    "required": ["rewrites"],
    "additionalProperties": False,
}


# A "rewrite" that talks about the headline, the old reason or the rules is the
# model's critique leaking into the reader's line (seen on 2026-10-16: "Paraphrases
# the headline; only swaps Williston for a Burlington suburb"). Never shipped.
CRITIQUE_RE = re.compile(r"paraphras|restat|headline|\bMUST\b|marked|the guide|\bline \d|"
                         r"duplicate of|reader angle|adds nothing|not stated|does not give|"
                         r"the reason|this reason", re.I)


# An invented fact: a reason may not state what its headline (and the
# item's own text) does not give. Seen live on 2026-10-16: "A free UVM evening
# on Vermont's Revolutionary history" for "Center for Research on Vermont hosts
# revolutionary war history panel". Mechanical, so it is checked after the
# model writes, the way restatements are.
CALENDAR = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
            "january", "february", "march", "april", "may", "june", "july", "august",
            "september", "october", "november", "december"}
HOME = {"burlington", "vermont", "vermonters"}   # the paper's own frame, never a new fact
# Two months are also everyday verbs ("the plan may stall", "students march
# downtown"). As months they are written capitalized, so only then do they
# count: mid-sentence, or opening one with a day after them ("May 3").
VERBS_TOO = {"may", "march"}


def invented(why, *sources):
    """The first word of `why` that states a fact none of `sources` gives,
    or None: "free", a number or dollar amount, a weekday or month, or a
    capitalized word (not the first of a sentence, not the paper's home)."""
    text = " ".join(str(source) for source in sources if source).replace("’", "'").lower()
    words = set(re.findall(r"[a-z0-9]+", text))
    numbers = {n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}
    for match in re.finditer(r"\$?\d[\d,]*(?:\.\d+)?|[A-Za-z][A-Za-z'’]*", why or ""):
        token = match.group(0)
        if token[0] == "$" or token[0].isdigit():
            if token.lstrip("$").replace(",", "") not in numbers:
                return token
            continue
        base = re.sub(r"['’]s$", "", token).lower()
        if base in words or base in HOME:
            continue
        before = (why[:match.start()]).rstrip()
        opens = not before or before[-1] in '.!?:"“'
        month = base in CALENDAR
        if base in VERBS_TOO:
            month = token[0].isupper() and (not opens or re.match(r"\s+\d", why[match.end():]) is not None)
        if base == "free" or month or (token[0].isupper() and len(token) > 1 and not opens):
            return token
    return None


def reason_slots(day, picks_too):
    """[(holder dict, headline, the item's own text)] for every reason the
    pass should look at: the picks (on a re-rank) and the current update's
    lead."""
    slots = []
    if picks_too:
        slots += [(pick, pick["title"], pick.get("name")) for pick in day.get("picks") or []]
    updates = day.get("updates") or []
    picked = {pick["id"] for pick in day.get("picks") or []} if picks_too else set()
    if updates and updates[0].get("lead") and updates[0]["lead"]["id"] not in picked:
        # a lead that is also a pick is handled once, through the pick
        lead = updates[0]["lead"]
        item = next((item for item in updates[0]["items"] if item["id"] == lead["id"]), {})
        slots.append((lead, item.get("title", ""), item.get("name")))
    return slots


def polish_reasons(day, engine, picks_too, ask=None):
    """Fable's rule: a reason that shares half or more of its content words
    with its headline gets one rewrite, and the editor reviews the rest for
    paraphrases in the same call. A reason that states a fact its headline
    does not give (invented()) gets the same one rewrite, naming the word. A
    rewrite that still restates or invents, or a flagged reason the call did
    not fix, ships empty: no reason beats a wrong one.
    -> (usage or None, rewritten, emptied)."""
    ask = ask or wc.ask_json
    slots = [slot for slot in reason_slots(day, picks_too) if slot[0].get("why")]
    flagged = {i for i, (holder, title, _) in enumerate(slots) if wc.restates(holder["why"], title)}
    made_up = {i: word for i, (holder, title, own) in enumerate(slots)
               if (word := invented(holder["why"], title, own))}
    flagged |= set(made_up)
    if not slots or (not picks_too and not flagged):
        return None, 0, 0

    def mark(i):
        if i in made_up:
            return f'MUST (invented: "{made_up[i]}") · '
        return "MUST · " if i in flagged else ""
    lines = [f"{i}. {mark(i)}{title} || {holder['why']}" for i, (holder, title, _) in enumerate(slots)]
    usage, rewritten = None, 0
    try:
        answer, usage = ask(engine, REASONS_TASK, "\n".join(lines), REASONS_SCHEMA,
                            max_tokens=MAX_TOKENS[engine["provider"]], log_prefix="curate_wire")
    except wc.ModelError as exc:
        usage, answer = getattr(exc, "usage", None), {}
    except Exception:  # noqa: BLE001 — the reasons pass is never fatal
        answer = {}
    for entry in (answer or {}).get("rewrites") or []:
        index = as_index(entry.get("i") if isinstance(entry, dict) else None, 0, len(slots))
        why = wc.trim((entry or {}).get("why", ""), WHY_MAX) if index is not None else ""
        if index is None or not why:
            continue
        holder, title, own = slots[index]
        if not wc.restates(why, title) and not CRITIQUE_RE.search(why) and not invented(why, title, own):
            holder["why"] = why
            flagged.discard(index)
            rewritten += 1
    for index in flagged:
        slots[index][0]["why"] = ""
    # a lead that is also a pick carries the pick's final reason
    reasons = {pick["id"]: pick.get("why", "") for pick in day.get("picks") or []}
    for update in day.get("updates") or []:
        lead = update.get("lead")
        if lead and lead["id"] in reasons and picks_too:
            lead["why"] = reasons[lead["id"]]
    return usage, rewritten, len(flagged)


def brief_of(items):
    """The newest of the Brief's own editions on today's page, or None. The
    page pins it above "What matters today" rather than ranking it."""
    own = [item for item in items if item.get("own")]
    return dict(max(own, key=lambda item: item.get("posted_at") or "")) if own else None


def finish(day, pulse, now, changed):
    stamp = now.replace(microsecond=0).isoformat()
    items = river(day)
    # the Brief's own edition is never a pick (picks that stood from before
    # this rule drop out and the rest close ranks); it rides on top as `brief`
    if any(pick.get("own") for pick in day.get("picks") or []):
        kept = [pick for pick in day["picks"] if not pick.get("own")]
        day["picks"] = [dict(pick, rank=rank) for rank, pick in enumerate(kept, start=1)]
    current = {pick["id"] for pick in day.get("picks") or []}
    in_river = {item["id"] for item in items}
    day["picks_earlier"] = [pick for pick in day.get("picks_earlier") or []
                            if pick["id"] not in current and pick["id"] in in_river
                            and not pick.get("own")]
    brief = brief_of(items)
    if brief:
        day["brief"] = brief
    else:
        day.pop("brief", None)
    day["count"] = len(items)
    day["counts"] = counts(items)
    sports_before = day.get("sports") or {}
    day["sports"] = sports_of(day, items)
    day["sport_chips"] = wc.sport_chips(day["date"])
    day["sport_counts"] = sport_counts(day["sports"], day["date"])
    markets_before = day.get("markets") or []
    day["markets"] = lane_view(day, items, "markets")
    day["markets_count"] = {"local": sum(1 for item in day["markets"] if item.get("local")),
                            "everything": len(day["markets"])}
    before = (day.get("recaps") or [], day.get("photos_world") or [])
    day.update(recaps_of(pulse, day.get("date")))
    day["photos_world"] = photos_world(pulse, now)
    changed = changed or before != (day["recaps"], day["photos_world"]) \
        or sports_before != day["sports"] or markets_before != day["markets"]
    day["checked"] = stamp
    if changed or not day.get("updated"):
        day["updated"] = stamp
    # every source on today's page: id -> how a reader knows it
    sources = {}
    for item in items + list(day.get("picks") or []) + day["picks_earlier"]:
        entry = sources.setdefault(item["src"], {"name": item.get("name"), "ch": item.get("ch")})
        if item.get("site") and not entry.get("site"):
            entry["site"] = item["site"]
    day["sources"] = dict(sorted(sources.items()))
    day["status"] = status_of(pulse)
    return day


def hydrate_sports(day, scored):
    """A river item filed before its tag knew the sport gets it now, so the
    sport chips and sport_counts see the whole day (2026-10-19 rollout).
    Returns how many items changed."""
    n = 0
    for update in day.get("updates") or []:
        for item in update.get("items") or []:
            sport = wc.norm_sport((scored.get(item.get("id")) or {}).get("sport"))
            if sport and not item.get("sport"):
                item["sport"] = sport
                n += 1
            elif item.get("sport") and item["sport"] != wc.norm_sport(item["sport"]):
                item["sport"] = wc.norm_sport(item["sport"]) or "other"   # soccer -> other
                n += 1
    return n


def sport_counts(sports, date):
    """{"local"|"everything": {chip: n}} over every sports story of the day
    (sports_of), for the page's sport chips; `other` is counted too."""
    out = {}
    for scope in ("local", "everything"):
        tally = {chip: 0 for chip in wc.sport_chips(date) + ["other"]}
        for chip, items in (sports or {}).items():
            for item in items:
                if chip in tally and (scope == "everything" or item.get("local")):
                    tally[chip] += 1
        out[scope] = tally
    return out


def photos_world(pulse, now):
    """The Photos tab's Everything view, newest first: the picture feeds'
    items (pulse.json's `photos`, wire_photos.py) and the bullets of Grok's
    "Pictures of the day" recaps, the last PHOTOS_WORLD_DAYS, at most
    PHOTOS_WORLD_MAX. Only pictures that are the story: no news thumbnail
    ever enters this list."""
    cutoff = int(now.timestamp()) - PHOTOS_WORLD_DAYS * 86400
    out = []
    for item in ((pulse.get("photos") or {}).get("items") or []):
        if not isinstance(item, dict) or not isinstance(item.get("d"), int) or item["d"] < cutoff:
            continue
        if not all(item.get(key) for key in ("id", "src", "name", "title", "url", "image", "posted_at")):
            continue
        photo = {"id": item["id"], "kind": "photo", "src": item["src"], "name": item["name"],
                 "title": item["title"], "url": item["url"], "image": item["image"],
                 "posted_at": item["posted_at"]}
        for key in ("credit", "alt"):
            if item.get(key):
                photo[key] = item[key]
        out.append(photo)
    held = ((pulse.get("inbox") or {}).get("recaps") or {}).get("items") or []
    for rc in held:
        if not isinstance(rc, dict) or rc.get("kind") != "pictures" \
                or not isinstance(rc.get("d"), int) or rc["d"] < cutoff:
            continue
        for bl in rc.get("bullets") or []:
            match = X_STATUS_RE.match((bl or {}).get("url") or "")
            if not match:
                continue
            handle = "@" + match.group(1)
            out.append({"id": wc.item_id(bl["url"]), "kind": "x", "src": "x:" + handle,
                        "name": handle, "title": bl.get("text") or "", "why": bl.get("note") or "",
                        "url": bl["url"], "embed": "x", "posted_at": rc["posted_at"],
                        "recap": rc["id"]})
    seen, unique = set(), []
    for photo in sorted(out, key=lambda photo: photo["posted_at"], reverse=True):
        if photo["id"] not in seen:
            seen.add(photo["id"])
            unique.append(photo)
    return unique[:PHOTOS_WORLD_MAX]


def recaps_of(pulse, date):
    """Today's recaps from the inbox store, for the page: every recap posted
    on `date` (Eastern) newest first, and the newest of each kind. Verbatim;
    wire_inbox.py has already checked every field."""
    held = ((pulse.get("inbox") or {}).get("recaps") or {}).get("items") or []
    recaps = []
    for rc in held:
        if not isinstance(rc, dict) or not isinstance(rc.get("d"), int) or not date:
            continue
        if wc.et_now(datetime.fromtimestamp(rc["d"], timezone.utc)).date().isoformat() != date:
            continue
        recaps.append({
            "id": rc["id"], "kind": rc["kind"], "title": wire_inbox.RECAP_KINDS.get(rc["kind"], rc.get("title")),
            "posted_at": rc["posted_at"], "intro": rc.get("intro") or "",
            "basis": rc.get("basis"), "label": wire_inbox.RECAP_BASIS.get(rc.get("basis"), ""),
            "bullets": [dict({"id": wc.item_id(bl["url"])}, **bl) for bl in rc.get("bullets") or []
                        if isinstance(bl, dict) and bl.get("url")],
        })
    recaps.sort(key=lambda rc: rc["posted_at"], reverse=True)
    latest, seen = [], set()
    for rc in recaps:
        if rc["kind"] not in seen:
            seen.add(rc["kind"])
            latest.append(rc["id"])
    kinds = [{"kind": kind, "title": title} for kind, title in wire_inbox.RECAP_KINDS.items()]
    return {"recaps": recaps, "recaps_latest": latest, "recap_kinds": kinds}


def status_of(pulse):
    """Is each kind of source flowing? The page hides or labels a chip from
    this. Always all three keys, so a page never has to guess."""
    inbox = pulse.get("inbox") if isinstance(pulse.get("inbox"), dict) else {}
    status = {}
    for ch in ("x", "facebook", "recaps"):
        state = inbox.get(ch)
        if isinstance(state, dict):
            status[ch] = {"paused": bool(state.get("paused")), "reason": state.get("reason"),
                          "updated_at": state.get("updated_at")}
        else:
            status[ch] = {"paused": True, "reason": "the inbox reader is not live yet",
                          "updated_at": None}
    photos = pulse.get("photos") if isinstance(pulse.get("photos"), dict) else {}
    status["photos"] = {"checked": photos.get("checked"),
                        "down": sorted(str(entry.get("name") or "") for entry in (photos.get("sources") or {}).values()
                                       if isinstance(entry, dict) and not entry.get("ok"))}
    reddit = pulse.get("reddit")
    if isinstance(reddit, dict):
        status["reddit"] = {"paused": bool(reddit.get("paused")), "last_post": reddit.get("last_post")}
    else:
        subs = {source["id"] for source in pulse.get("sources") or []
                if "reddit.com" in (source.get("site") or "") and source.get("local")}
        newest = max((item.get("d") or 0 for item in pulse.get("items") or [] if item.get("s") in subs),
                     default=0)
        status["reddit"] = {"paused": not newest or wc.utcnow().timestamp() - newest > 36 * 3600,
                            "last_post": wc.iso_ts(newest) if newest else None}
    return status


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def fetch_pulse(url=PULSE_URL, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def give_up(reason, data_dir, now=None):
    """End a run that changed nothing, loudly if the paper has gone stale."""
    print(f"curate_wire: {reason}", file=sys.stderr)
    wc.step_summary(f"- curate_wire: {reason}")
    day = wc.load_json(paths(data_dir)["today"], None)
    if not isinstance(day, dict) or not day.get("checked"):
        return 0   # no paper yet: nothing can be stale
    age = ((now or wc.utcnow()) - datetime.fromisoformat(day["checked"])).total_seconds() / 3600
    if age > STALE_HOURS:
        raise SystemExit(f"curate_wire: wire-today.json was last checked {age:.1f}h ago "
                         f"(limit {STALE_HOURS}h) and this run changed nothing — failing "
                         "so a stale Wire is seen.")
    print(f"curate_wire: the paper was checked {age:.1f}h ago, within {STALE_HOURS}h — "
          "leaving it in place")
    return 0


def decide(day, state, new, et, now):
    """-> (call_model, want_picks, why)."""
    urgent = any(item["local"] and item["_score"] >= URGENT_SCORE for item in new)
    picks_at = state.get("picks_at")
    since = ((now - datetime.fromisoformat(picks_at)).total_seconds() / 3600) if picks_at else None
    if not day.get("picks"):
        # the day's first ranking waits until there is something to rank
        want_picks = len(river(day)) + len(new) >= PICKS_MIN_POOL
    else:
        want_picks = bool(new) and (since is None or since >= PICKS_EVERY_HOURS or urgent)
    if et.hour < QUIET_BEFORE_HOUR and not urgent:
        return False, False, "overnight"
    if want_picks:
        return True, True, "urgent" if urgent and day.get("picks") else "picks due"
    called_at = state.get("called_at")
    if called_at and 0 <= (now - datetime.fromisoformat(called_at)).total_seconds() < CALL_GAP_MINUTES * 60:
        return False, False, "too soon after the last update"
    if len(new) >= MIN_NEW or any(item["local"] and item["_score"] >= 6 for item in new):
        return True, False, "additions"
    return False, False, "quiet hour"


def as_of(args):
    value = getattr(args, "as_of", None)
    return datetime.fromisoformat(value).astimezone(timezone.utc) if value else None


def run(args):
    now = as_of(args) or wc.utcnow()
    now_ts = int(now.timestamp())
    et = wc.et_now(now)
    today = et.date().isoformat()
    files = paths(args.data_dir)

    day = wc.load_json(files["today"], {})
    state = wc.load_json(files["state"], {})
    if getattr(args, "rebuild_today", False):
        # start today over from the pool (after a doctrine change); the
        # frozen editions, the cost ledger and the re-serve guard stay
        print("curate_wire: rebuilding today from the pool")
        if isinstance(day, dict) and day.get("date") == today:
            day = empty_day(today)
        state = {"date": today, "considered": (state or {}).get("considered", []),
                 "considered_today": [], "picks_at": None}
    day, state, frozen = roll_over(day if isinstance(day, dict) else {},
                                   state if isinstance(state, dict) else {}, today, args.data_dir)
    if frozen:
        print(f"curate_wire: froze {frozen} as data/wire/{frozen}.json")
        editions = prune_and_index(args.data_dir, today)
        print(f"curate_wire: {len(editions)} editions on file")
        # the new day exists from its first minute, even if the model is down
        wc.write_json(files["today"], day)
        wc.write_json(files["state"], state)

    engine = wc.pick_engine("curate")
    if engine is None:
        return give_up("no ANTHROPIC_API_KEY or OPENROUTER_API_KEY", args.data_dir, now)
    refuse, mtd = wc.over_budget(args.data_dir, now)
    if refuse:
        return give_up(f"refusing to run, ${mtd:.2f} spent this month "
                       f"(cap ${wc.MONTH_CAP_USD:.0f})", args.data_dir, now)
    try:
        pulse = wc.load_json(args.pulse, None) if args.pulse else fetch_pulse()
        if not isinstance(pulse, dict) or not pulse.get("items"):
            raise ValueError("pulse.json unreadable or empty")
    except Exception as exc:  # noqa: BLE001 — a fetch failure is not a crash
        return give_up(f"could not read pulse.json ({exc})", args.data_dir, now)

    tags = (wc.load_json(files["tags"], {}) or {}).get("tags") or {}
    comments = {} if args.pulse else reddit_comments()
    pool = apply_tags(candidates(pulse, now_ts, et), tags, comments)
    hydrated = hydrate_sports(day, {item["id"]: item for item in pool})
    scores = {item["id"]: item["_score"] for item in pool}
    moved = cap_river_lanes(day, scores)
    if moved:
        print(f"curate_wire: moved {len(moved)} sports and market stories from the main river "
              "to their chips")
    reserved_ids, reserved_urls, ran = reserved(args.data_dir, today)
    evicted = evict_stale_editions(day, edition_since(et))
    if evicted:
        print(f"curate_wire: took {len(evicted)} newsletter editions from an earlier day "
              "out of today's river")
    numbered_river = river(day)
    in_river = {item["id"] for item in numbered_river} | {item["id"] for item in shelf_items(day)}
    considered = set(state.get("considered", [])) | set(state.get("considered_today", []))
    new, auto = select_new(pool, in_river, considered, reserved_ids, reserved_urls,
                           editions_in=edition_window(et))
    state.setdefault("considered_today", []).extend(auto)

    call, want_picks, why = decide(day, state, new, et, now)
    key, label = label_for(et)
    if not call:
        # newsletter editions are never the editor's call, so a quiet hour
        # (or the night) still files them; no lead, no picks, no model
        editions = [item for item in new if item.get("ch") == "newsletters"]
        filed = apply_answer(day, {}, river(day), editions, False, et, now, scores=scores)["added"] \
            if editions else []
        finish(day, pulse, now, changed=bool(filed or evicted or hydrated or moved))
        wc.write_json(files["today"], day)
        wc.write_json(files["state"], state)
        line_ = (f"curate_wire: {why}, {len(new)} new candidates, no model call"
                 + (f", {len(filed)} newsletter editions filed" if filed else "")
                 + f"; {day['count']} in today's river")
        print(line_)
        wc.step_summary("- " + line_)
        return 0

    # The river's own entries carry their tag score for the prompt's sake only
    scored = {item["id"]: item for item in pool}
    numbered_river = [annotate(dict(item, **{key: scored[item["id"]][key] for key in ("topic", "comments")
                                             if item["id"] in scored and key in scored[item["id"]]}),
                               comments)
                      for item in numbered_river]
    numbered_river = [dict(item, _score=scored.get(item["id"], {}).get("_score", default_score(item)),
                           d=int(datetime.fromisoformat(item["posted_at"]).timestamp()))
                      for item in numbered_river]
    current_ids = {item["id"] for item in (day["updates"][0]["items"]
                   if day.get("updates") and day["updates"][0].get("key") == key else [])}
    river_total = len(numbered_river)
    numbered_river = shown_river(numbered_river, current_ids, want_picks)
    current = [i for i, item in enumerate(numbered_river) if item["id"] in current_ids]
    system = wc.read_prompt("wire-taste.md") + TASK
    user = build_prompt(numbered_river, new, current, ran if want_picks else [],
                        want_picks, et, label, now_ts, total=river_total,
                        lanes_in_river={lane: len(counted(river(day), lane, scores))
                                        for lane in LANE_MAX})
    try:
        answer, usage = wc.ask_json(engine, system, user, schema(want_picks),
                                    max_tokens=MAX_TOKENS[engine["provider"]],
                                    log_prefix="curate_wire")
    except wc.ModelError as exc:
        if getattr(exc, "usage", None):
            wc.record_cost(args.data_dir, "curate_wire", engine, exc.usage, now)
        return give_up(f"model call failed ({exc})", args.data_dir, now)
    except Exception as exc:  # noqa: BLE001 — SDK missing, network, anything
        return give_up(f"model call failed ({exc})", args.data_dir, now)
    wc.record_cost(args.data_dir, "curate_wire", engine, usage, now)
    if not isinstance(answer, dict):
        return give_up("the answer was not an object", args.data_dir, now)

    result = apply_answer(day, answer, numbered_river, new, want_picks, et, now,
                          previous_at=state.get("picks_at"), scores=scores)
    if want_picks and not result["picks"]:
        return give_up("asked for picks and got no usable ones", args.data_dir, now)
    polish_usage, rewritten, emptied = polish_reasons(day, engine, want_picks)
    if polish_usage:
        wc.record_cost(args.data_dir, "curate_wire (reasons)", engine, polish_usage, now)
    if rewritten or emptied:
        print(f"curate_wire: reasons pass rewrote {rewritten}, left {emptied} empty")
    if want_picks:
        state["picks_at"] = now.replace(microsecond=0).isoformat()
    state["called_at"] = now.replace(microsecond=0).isoformat()
    # everything shown is now considered: passed items stay passed today
    state["considered_today"] = sorted(set(state.get("considered_today", []))
                                       | {item["id"] for item in new})
    finish(day, pulse, now, changed=bool(result["added"] or result["dropped"] or result["picks"]
                                         or result["shelved"] or evicted or hydrated or moved))
    if as_of(args):
        day["backfilled"] = True   # replayed later from the pulse store, and says so
    wc.write_json(files["today"], day)
    wc.write_json(files["state"], state)
    local_picks = sum(1 for pick in day["picks"] if pick.get("local"))
    line_ = (f"curate_wire: {why} · {len(new)} new shown · {len(result['added'])} added, "
             f"{len(result['dropped'])} dropped, {len(result['shelved'])} to the sport chips · "
             f"river {day['count']} · "
             f"picks {len(day['picks'])} (+{len(day['picks_earlier'])} earlier today), "
             f"{local_picks} local"
             + (" re-ranked" if want_picks else " standing"))
    print(line_)
    wc.step_summary("- " + line_)
    return 0


# ----------------------------------------------------------------------
# Selftest — offline, with an inline fixture and no API call
# ----------------------------------------------------------------------

def selftest():
    import tempfile

    os.environ.pop("GITHUB_STEP_SUMMARY", None)   # selftest lines are not a run's costs

    now = datetime(2026, 10, 16, 18, 10, tzinfo=timezone.utc)   # 2:10 pm Eastern
    et = wc.et_now(now)
    assert label_for(et) == ("afternoon", "Afternoon") and clock(et) == "2:10 pm"
    mk = lambda n, local=True, src="wcax": {  # noqa: E731
        "id": f"id{n}", "ch": "local" if local else "world", "local": local, "src": src,
        "name": src.upper(), "title": f"Headline {n}", "url": f"https://a.com/{n}",
        "posted_at": "2026-10-16T17:00:00+00:00", "d": int(now.timestamp()) - n * 60, "_score": 5}
    river_now = [mk(1), mk(2, src="vtd")]
    new = [mk(3), mk(4, local=False, src="ap"), mk(5, src="vtd")]
    day = empty_day("2026-10-16")
    day["updates"] = [{"key": "midday", "label": "Midday", "time": "12:10 pm",
                       "updated": "x", "lead": None, "items": [public(i) for i in river_now]}]
    answer = {"add": [3, 3, 0, 99, "4", 2], "lead": 2, "lead_why": "y" * 200, "drop": [],
              "picks": [{"i": 2, "why": "Big."}, {"i": 0, "why": "Also."}, {"i": 2, "why": "dupe"},
                        {"i": 4, "why": "The pick from NEW joins the river."}, {"i": 50, "why": "bad"},
                        {"i": 1, "why": ""}]}
    result = apply_answer(day, answer, river_now, new, True, et, now)
    # range, repeats and types fall out; the pick from NEW (4) joins the river
    assert result["added"] == ["id4", "id3", "id5"], result
    current = day["updates"][0]
    assert current["key"] == "afternoon" and current["lead"]["id"] == "id3"
    assert len(current["lead"]["why"]) <= WHY_MAX
    assert [item["id"] for item in current["items"]][0] == "id3"     # the lead leads
    # ranked as asked, then the second WCAX pick moved past the VTDigger one
    assert [p["id"] for p in day["picks"]] == ["id3", "id5", "id1"]
    assert [p["rank"] for p in day["picks"]] == [1, 2, 3]
    assert all(p["title"].startswith("Headline") for p in day["picks"])   # verbatim
    print("curate_wire: answer mapping ok (indices, dupes, types, why length, picks join river)")

    # a re-rank keeps the stories it drops, as picks_earlier, never twice
    later = now + timedelta(hours=6)
    keep = [item["id"] for item in river(day)].index("id1")
    apply_answer(day, {"add": [], "picks": [{"i": keep, "why": "Still."}]}, river(day), [], True,
                 wc.et_now(later), later)
    assert [p["id"] for p in day["picks"]] == ["id1"]
    assert [(p["id"], p["rank"]) for p in day["picks_earlier"]] == [("id3", 1), ("id5", 2)], \
        day["picks_earlier"]
    assert all(p["ranked_at"] == now.isoformat() for p in day["picks_earlier"])
    print("curate_wire: dropped picks move to picks_earlier ok")

    # a newsletter edition joins the river whatever the answer, past the score
    # bar that keeps weak national items from the editor
    edition = dict(mk(6, local=False, src="semafor"), ch="newsletters", _score=1)
    picked, passed = select_new([dict(mk(7, local=False, src="ap"), _score=1), edition],
                                set(), set(), set(), set())
    assert [i["id"] for i in picked] == ["id6"] and passed == ["id7"]
    day3 = empty_day("2026-10-16")
    result = apply_answer(day3, {"add": [], "lead": -1, "lead_why": ""}, [], picked, False, et, now)
    assert result["added"] == ["id6"] and river(day3)[0]["ch"] == "newsletters"
    print("curate_wire: newsletter editions always join the river ok")

    # ...but only on their own Burlington day: yesterday morning's edition
    # stays out of today, last night's 11 pm one still comes in
    monday = datetime(2026, 10, 19, 11, 7, tzinfo=timezone.utc)      # 7:07 am Eastern
    since = edition_since(wc.et_now(monday))
    assert wc.et_now(datetime.fromtimestamp(since, timezone.utc)).strftime("%Y-%m-%d %H:%M") \
        == "2026-10-18 21:00", since
    at = lambda iso: int(datetime.fromisoformat(iso).timestamp())  # noqa: E731
    sunday_am = dict(mk(10, local=False, src="1440"), ch="newsletters", d=at("2026-10-18T09:38:08+00:00"))
    sunday_pm = dict(mk(11, local=False, src="semafor"), ch="newsletters", d=at("2026-10-18T22:15:33+00:00"))
    late = dict(mk(12, local=False, src="tangle"), ch="newsletters", d=at("2026-10-19T03:30:00+00:00"))
    today_ = dict(mk(13, local=False, src="1440"), ch="newsletters", d=at("2026-10-19T08:28:20+00:00"))
    news = dict(mk(14, local=False, src="ap"), d=at("2026-10-18T22:15:33+00:00"))
    tuesday = dict(mk(15, local=False, src="1440"), ch="newsletters", d=at("2026-10-20T04:15:00+00:00"))
    picked, _ = select_new([sunday_am, sunday_pm, late, today_, news, tuesday], set(), set(), set(),
                           set(), editions_in=edition_window(wc.et_now(monday)))
    assert [i["id"] for i in picked] == ["id14", "id12", "id13"], [i["id"] for i in picked]
    # the guard holds across the autumn clock change too (Nov 1 -> Nov 2)
    fall = edition_since(wc.et_now(datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)))
    assert wc.et_now(datetime.fromtimestamp(fall, timezone.utc)).strftime("%m-%d %H:%M") == "11-01 21:00"
    print("curate_wire: a newsletter edition joins only its own day ok")

    # lead must be this hour's add or the current update's own item
    day2 = empty_day("2026-10-16")
    apply_answer(day2, {"add": [1], "lead": 0, "lead_why": "Not allowed", "drop": []},
                 [mk(9)], [mk(8)], False, et, now)
    assert day2["updates"][0]["lead"] is None
    # outlets never back to back in the picks
    spread = spread_outlets([{"src": "a"}, {"src": "a"}, {"src": "b"}])
    assert [p["src"] for p in spread] == ["a", "b", "a"]
    print("curate_wire: leads and outlet spread ok")

    # the river inside an update: a bunch of local from one site is broken up
    # by national, and one X desk's five posts never sit together
    bunch = [mk(n, src=("wcax", "vtd")[n % 2]) for n in range(1, 7)] + \
        [dict(mk(n, local=False, src="x:@AP"), ch="x") for n in range(7, 10)]
    river_order = order_update(bunch, "id1", [item["id"] for item in bunch])
    assert [item["local"] for item in river_order] == \
        [True, True, True, False, True, True, True, False, False], river_order
    assert river_order[0]["id"] == "id1"
    assert order_update(river_order, "id1") == river_order          # settled stays put
    print("curate_wire: river interleave ok")

    # one list by importance: national picks keep the editor's slots, so the
    # Everything view's top five mix; the tier sort moves local picks only
    mixed = [dict(mk(1), region="state", topic="environment"), mk(2, local=False, src="ap"),
             dict(mk(3, src="vtd"), region="btv"), mk(4, local=False, src="reuters"), mk(5)]
    ordered = order_picks(mixed)
    assert [p["local"] for p in ordered] == [True, False, True, False, True], ordered
    assert [p["id"] for p in ordered if not p["local"]] == ["id2", "id4"]
    assert [p["id"] for p in ordered if p["local"]][0] == "id3"    # Burlington before the feature
    print("curate_wire: local and national ranked as one list ok")

    with tempfile.TemporaryDirectory() as tmp:
        old = empty_day("2026-10-15")
        old["updates"] = [{"key": "evening", "label": "Evening", "items": [public(mk(1))]}]
        rolled, state, frozen = roll_over(old, {"date": "2026-10-15", "considered_today": ["z"]},
                                          "2026-10-16", tmp)
        assert frozen == "2026-10-15" and rolled["date"] == "2026-10-16" and not river(rolled)
        assert state["considered"] == ["z"]
        wc.write_json(os.path.join(tmp, "wire", "2026-09-01.json"), empty_day("2026-09-01"))
        editions = prune_and_index(tmp, "2026-10-16")
        assert [e["date"] for e in editions] == ["2026-10-15"]
        assert wc.load_json(os.path.join(tmp, "wire", "2026-10-15.json"), {})["final"] is True
        ids, urls, ran = reserved(tmp, "2026-10-16")
        assert "id1" in ids and "https://a.com/1" in urls
        # a stale paper fails the run; a fresh one does not
        fresh = dict(empty_day("2026-10-16"), checked=(now - timedelta(hours=1)).isoformat())
        wc.write_json(paths(tmp)["today"], fresh)
        assert give_up("test", tmp, now) == 0
        wc.write_json(paths(tmp)["today"], dict(fresh, checked=(now - timedelta(hours=5)).isoformat()))
        try:
            give_up("test", tmp, now)
            raise AssertionError("a 5h-old paper must fail the run")
        except SystemExit as exc:
            assert "5.0h" in str(exc)
    print("curate_wire: freeze, prune, re-serve guard and staleness ok")
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", default=os.path.join(wc.ROOT, "data"))
    parser.add_argument("--pulse")
    parser.add_argument("--rebuild-today", action="store_true",
                        help="start today's paper over from the pool (yesterday stays frozen)")
    parser.add_argument("--as-of", metavar="ISO",
                        help="run as if it were this moment (a labelled backfill of an earlier "
                             "day from the pulse store; costs are still real and logged)")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return 0
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
