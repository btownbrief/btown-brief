#!/usr/bin/env python3
"""The Wire, step two of two: the day's paper, updated hourly.

Reads pulse.json (the firehose, plus the X and Facebook inbox), the tags
tag_wire.py left in data/wire-tags.json, and the day so far, then asks the
editor model, with prompts/wire-taste.md as its doctrine, for:

  * "What matters today": 25 ranked picks, each with a one-line reason and a
    local flag, so the page shows ten local picks and adds national ones when
    the switch is on Everything. Re-ranked at most every PICKS_EVERY_HOURS
    (and at once when a score-9 local story lands); between re-ranks the
    picks stand.
  * This hour's additions to the river ("The rest of today"), the lead of
    the current update with its reason, and which running items to drop if
    the day passes RIVER_MAX.

Output, data/wire-today.json:

  {"v": 1, "date": "2026-10-16", "tz": "America/New_York", "final": false,
   "updated": "...", "checked": "...", "count": 52,
   "counts": {"local": {"all": 40, "x": 3, ...}, "everything": {...}},
   "picks": [{"rank": 1, "why": "...", ...item}, ...],
   "updates": [{"key": "afternoon", "label": "Afternoon", "time": "2:10 pm",
                "updated": "...", "lead": {"id": "...", "why": "..."},
                "items": [item, ...]}, ...newest first],
   "sources": {"x": {"paused": ..., "reason": ...}, "facebook": ..., "reddit": ...}}

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

Failure posture: no key, the $25 month cap, or any API trouble logs and exits
0 without touching the day's file, so the branch keeps the last good paper,
UNLESS the paper has gone unchecked for STALE_HOURS: then the run fails so it
is seen. A quiet hour (nothing new worth asking about) still stamps
`checked`, so overnight silence is not mistaken for a broken pipeline.

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

PULSE_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
             "pulse-data/data/pulse.json")
UA = "btown-wire/1.0"

WINDOW_HOURS = 26          # a story from last evening can still lead this morning
RESERVE_DAYS = 7           # nothing in the last week's editions comes back
KEEP_DAYS = 30             # frozen editions kept on the branch
RIVER_MAX = 80
ADD_MAX = 20               # per hourly update
ADD_MAX_FIRST = 40         # the day's first update can catch up on the night
PICK_COUNT = 25
NATIONAL_PICKS = 10        # the rest of the 25 are local
WHY_MAX = 90
NEW_MAX_LOCAL = 70         # candidates shown to the editor per run
NEW_MAX_WORLD = 30
WORLD_MIN_SCORE = 3        # national items the tagger scored lower never reach the editor
PICKS_EVERY_HOURS = 5      # re-rank cadence: about 7am, noon, 5pm, 10pm
PICKS_MIN_POOL = 8         # the first ranking of the day waits for this many items
URGENT_SCORE = 9           # a local story this big re-ranks the picks at once
QUIET_BEFORE_HOUR = 6      # overnight the editor sleeps unless something is urgent
MIN_NEW = 2                # fewer new items than this is a quiet hour
STALE_HOURS = 4
ALREADY_RAN_PICKS = 15     # per earlier day, shown to the editor as "already ran"
MAX_TOKENS = {"openrouter": 6000, "anthropic": 16000}
LABELS = (("morning", "Morning", 0), ("midday", "Midday", 11),
          ("afternoon", "Afternoon", 14), ("evening", "Evening", 18))
ITEM_KEYS = ("id", "ch", "local", "src", "name", "title", "url", "posted_at",
             "thumb", "media", "handle", "discuss", "site", "topic", "kind", "own",
             "town", "comments")
REDDIT_INTAKE_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
                     "reddit-data/data/reddit-intake.json")
REDDIT_POST_ID_RE = re.compile(r"/comments/([a-z0-9]+)", re.I)

TASK = """

## Your job this hour

You are the editor of the Wire. Everything below is numbered. You answer only
with numbers from those lists and short reasons. You never write, shorten or
rewrite a headline: the page shows each one exactly as the outlet wrote it.

- `add`: numbers from NEW that earn a place in today's river this hour (at
  most 20, or 40 when the river is empty). Leave out what does not earn a
  place; a passed item does not come back later today.
- `lead` and `lead_why`: the item that leads the current update, from what you
  add this hour or from the current update's items already in the river, with
  a reason in the style of the picks. Use -1 and an empty reason only when
  nothing is added and the current update has no items.
- `drop`: numbers from TODAY'S RIVER to remove, only when the river would pass
  80 items. Otherwise an empty list.
- `picks`, only when asked for: the ranked "What matters today" list from the
  river and NEW together: 25 picks, about 15 local and up to 10 national,
  fewer only when the day truly lacks them. Each has a reason under 90
  characters. A pick from NEW is added to the river for you.
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
            "picks": [], "updates": [], "sources": {}}


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
        editions.append({"date": date, "count": day.get("count", 0),
                         "picks": len(day.get("picks") or [])})
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
        for item in river(day) + list(day.get("picks") or []):
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


def select_new(pool, in_river, considered, reserved_ids, reserved_urls):
    """The NEW list: eligible, not yet in the river, not passed on, not run
    before. Returns (new_items, auto_passed_ids)."""
    local, world, auto = [], [], []
    for item in pool:
        if item["id"] in in_river or item["id"] in considered:
            continue
        if item["id"] in reserved_ids or item["url"] in reserved_urls:
            continue
        if not item["local"] and item["_score"] < WORLD_MIN_SCORE:
            auto.append(item["id"])
            continue
        (local if item["local"] else world).append(item)
    rank = lambda item: (-item["_score"], -item["d"])  # noqa: E731
    local.sort(key=rank)
    world.sort(key=rank)
    return local[:NEW_MAX_LOCAL] + world[:NEW_MAX_WORLD], auto


def age_label(item, now_ts):
    hours = max(0, (now_ts - item["d"]) / 3600)
    return f"{hours:.0f}h" if hours >= 1 else f"{hours * 60:.0f}m"


def line(index, item, now_ts):
    who = item.get("handle") or item.get("name") or item.get("src")
    topic = f" · {item['topic']}" if item.get("topic") else ""
    place = {"btv": "Burlington area", "away": "outside the Burlington area",
             "out": "out of state"}.get(item.get("region"), "")
    if place and item.get("town"):
        place = f"{item['town']} ({place})"
    place = f" · {place}" if place else ""
    talk = ""
    if item.get("ch") in wc.THREAD_CHANNELS:
        count = item.get("comments")
        talk = f" · {count} comments" if isinstance(count, int) else " · comments unknown"
    block = wc.pick_block(item)
    gate = f" · river only ({block})" if block else ""
    return (f"{index}. {'LOCAL' if item['local'] else 'NATIONAL'} · {item['ch']} · {who} · "
            f"{age_label(item, now_ts)}{topic}{place}{talk}{gate} · {item['title']}")


def build_prompt(numbered_river, new, current, ran, want_picks, et, label, now_ts):
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
    lines += ["", f"TODAY'S RIVER ({len(numbered_river)} items):"]
    lines += [line(i, item, now_ts) for i, item in enumerate(numbered_river)] or ["(empty)"]
    offset = len(numbered_river)
    lines += ["", f"NEW since the last update ({len(new)} items):"]
    lines += [line(offset + i, item, now_ts) for i, item in enumerate(new)] or ["(none)"]
    return "\n".join(lines)


def schema(want_picks):
    props = {
        "add": {"type": "array", "maxItems": 30, "items": {"type": "integer"}},
        "lead": {"type": "integer"},
        "lead_why": {"type": "string", "maxLength": WHY_MAX},
        "drop": {"type": "array", "maxItems": 30, "items": {"type": "integer"}},
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


def order_picks(picks):
    """The house rules on the editor's ranking, applied in order:

    1. local picks sorted by tier (Burlington area and statewide decisions,
       then statewide features, then trips out of the area), the editor's
       order kept within a tier; national picks keep their slots
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


def apply_answer(day, answer, numbered_river, new, want_picks, et, now):
    """Fold a validated answer into the day. Returns a dict of what changed."""
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
    # the Brief's own edition is always in the paper, never the model's call
    for index in range(offset, total):
        if by_index[index].get("own") and index not in adds:
            adds.append(index)

    picks, pick_seen = [], set()
    if want_picks:
        for entry in answer.get("picks") or []:
            index = as_index(entry.get("i") if isinstance(entry, dict) else None, 0, total)
            if index is None or index in pick_seen or wc.pick_block(by_index[index]):
                continue   # a "river only" item stays out of the picks whatever the answer
            why = wc.trim(entry.get("why", ""), WHY_MAX)
            if not why:
                continue
            pick_seen.add(index)
            picks.append((index, why))
            if index >= offset and index not in adds:
                adds.append(index)   # picks are river items too
            if len(picks) == PICK_COUNT:
                break

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

    # drops: only past RIVER_MAX, never a pick or a lead
    protected = {by_index[index]["id"] for index, _ in picks} if want_picks else \
        {pick["id"] for pick in day.get("picks") or []}
    protected |= {update["lead"]["id"] for update in updates if update.get("lead")}
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

    # order inside each update: the lead first, then newest first
    for update in updates:
        lead_id = (update.get("lead") or {}).get("id")
        update["items"] = ([item for item in update["items"] if item["id"] == lead_id]
                           + sorted((item for item in update["items"] if item["id"] != lead_id),
                                    key=lambda item: item.get("posted_at") or "", reverse=True))
    if adds and current is not None:
        current["updated"] = stamp
        current["time"] = clock(et)

    if want_picks and picks:
        # at most NATIONAL_PICKS national picks, so the Local list stays long
        kept, national = [], 0
        for index, why in picks:
            if not by_index[index].get("local"):
                national += 1
                if national > NATIONAL_PICKS:
                    continue
            kept.append((index, why))
        ranked = order_picks([dict(by_index[index], why=why) for index, why in kept])
        ranked = [dict(public(pick), why=pick["why"]) for pick in ranked]
        in_river = {item["id"] for item in river(day)}
        day["picks"] = [dict(pick, rank=rank) for rank, pick in
                        enumerate((p for p in ranked if p["id"] in in_river), start=1)]
    return {"added": added_ids, "dropped": dropped, "picks": len(picks) if want_picks else None}


REASONS_TASK = """You check the one-line reasons on a Burlington, Vermont news page.

A reason must add something the headline does not say: what changes for the
reader, who it reaches, what to do about it. It must not restate or paraphrase
the headline, must stay under 90 characters, and may not state a fact (a
number, a date, a name) that the headline does not give.

Good: "Your electric bill, starting in January." "Three nights of one lane on
the only bridge to Winooski." Bad: "Police are looking for whoever broke into
a market." (restates) "A local shop growing into a new line of goods."
(paraphrases "DandyLion expands into furniture").

Below, each numbered line is a headline and its reason. Lines marked MUST are
known restatements: rewrite every one of them. Rewrite any other reason that
only restates or paraphrases its headline. Return only the lines you rewrote."""

REASONS_SCHEMA = {
    "type": "object",
    "properties": {"rewrites": {"type": "array", "maxItems": PICK_COUNT + 1, "items": {
        "type": "object",
        "properties": {"i": {"type": "integer"}, "why": {"type": "string", "maxLength": WHY_MAX}},
        "required": ["i", "why"], "additionalProperties": False}}},
    "required": ["rewrites"],
    "additionalProperties": False,
}


def reason_slots(day, picks_too):
    """[(holder dict, headline)] for every reason the pass should look at:
    the picks (on a re-rank) and the current update's lead."""
    slots = []
    if picks_too:
        slots += [(pick, pick["title"]) for pick in day.get("picks") or []]
    updates = day.get("updates") or []
    if updates and updates[0].get("lead"):
        lead = updates[0]["lead"]
        title = next((item["title"] for item in updates[0]["items"] if item["id"] == lead["id"]), "")
        slots.append((lead, title))
    return slots


def polish_reasons(day, engine, picks_too, ask=None):
    """Fable's rule: a reason that shares half or more of its content words
    with its headline gets one rewrite, and the editor reviews the rest for
    paraphrases in the same call. A rewrite that still restates, or a
    flagged reason the call did not fix, ships empty: no reason beats a
    restatement. -> (usage or None, rewritten, emptied)."""
    ask = ask or wc.ask_json
    slots = [slot for slot in reason_slots(day, picks_too) if slot[0].get("why")]
    flagged = {i for i, (holder, title) in enumerate(slots) if wc.restates(holder["why"], title)}
    if not slots or (not picks_too and not flagged):
        return None, 0, 0
    lines = [f"{i}. {'MUST · ' if i in flagged else ''}{title} || {holder['why']}"
             for i, (holder, title) in enumerate(slots)]
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
        holder, title = slots[index]
        if not wc.restates(why, title):
            holder["why"] = why
            flagged.discard(index)
            rewritten += 1
    for index in flagged:
        slots[index][0]["why"] = ""
    return usage, rewritten, len(flagged)


def finish(day, pulse, now, changed):
    stamp = now.replace(microsecond=0).isoformat()
    items = river(day)
    day["count"] = len(items)
    day["counts"] = counts(items)
    day["checked"] = stamp
    if changed or not day.get("updated"):
        day["updated"] = stamp
    # every source on today's page: id -> how a reader knows it
    sources = {}
    for item in items + list(day.get("picks") or []):
        entry = sources.setdefault(item["src"], {"name": item.get("name"), "ch": item.get("ch")})
        if item.get("site") and not entry.get("site"):
            entry["site"] = item["site"]
    day["sources"] = dict(sorted(sources.items()))
    day["status"] = status_of(pulse)
    return day


def status_of(pulse):
    """Is each kind of source flowing? The page hides or labels a chip from
    this. Always all three keys, so a page never has to guess."""
    inbox = pulse.get("inbox") if isinstance(pulse.get("inbox"), dict) else {}
    status = {}
    for ch in ("x", "facebook"):
        state = inbox.get(ch)
        if isinstance(state, dict):
            status[ch] = {"paused": bool(state.get("paused")), "reason": state.get("reason"),
                          "updated_at": state.get("updated_at")}
        else:
            status[ch] = {"paused": True, "reason": "the inbox reader is not live yet",
                          "updated_at": None}
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
    pool = apply_tags(wc.wire_items(pulse, now_ts, WINDOW_HOURS), tags, comments)
    reserved_ids, reserved_urls, ran = reserved(args.data_dir, today)
    numbered_river = river(day)
    in_river = {item["id"] for item in numbered_river}
    considered = set(state.get("considered", [])) | set(state.get("considered_today", []))
    new, auto = select_new(pool, in_river, considered, reserved_ids, reserved_urls)
    state.setdefault("considered_today", []).extend(auto)

    call, want_picks, why = decide(day, state, new, et, now)
    key, label = label_for(et)
    if not call:
        finish(day, pulse, now, changed=False)
        wc.write_json(files["today"], day)
        wc.write_json(files["state"], state)
        line_ = (f"curate_wire: {why}, {len(new)} new candidates, no model call; "
                 f"{day['count']} in today's river")
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
    current = [i for i, item in enumerate(numbered_river) if item["id"] in current_ids]
    system = wc.read_prompt("wire-taste.md") + TASK
    user = build_prompt(numbered_river, new, current, ran if want_picks else [],
                        want_picks, et, label, now_ts)
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

    result = apply_answer(day, answer, numbered_river, new, want_picks, et, now)
    if want_picks and not result["picks"]:
        return give_up("asked for picks and got no usable ones", args.data_dir, now)
    polish_usage, rewritten, emptied = polish_reasons(day, engine, want_picks)
    if polish_usage:
        wc.record_cost(args.data_dir, "curate_wire (reasons)", engine, polish_usage, now)
    if rewritten or emptied:
        print(f"curate_wire: reasons pass rewrote {rewritten}, left {emptied} empty")
    if want_picks:
        state["picks_at"] = now.replace(microsecond=0).isoformat()
    # everything shown is now considered: passed items stay passed today
    state["considered_today"] = sorted(set(state.get("considered_today", []))
                                       | {item["id"] for item in new})
    finish(day, pulse, now, changed=bool(result["added"] or result["dropped"] or result["picks"]))
    if as_of(args):
        day["backfilled"] = True   # replayed later from the pulse store, and says so
    wc.write_json(files["today"], day)
    wc.write_json(files["state"], state)
    local_picks = sum(1 for pick in day["picks"] if pick.get("local"))
    line_ = (f"curate_wire: {why} · {len(new)} new shown · {len(result['added'])} added, "
             f"{len(result['dropped'])} dropped · river {day['count']} · "
             f"picks {len(day['picks'])} ({local_picks} local)"
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

    # lead must be this hour's add or the current update's own item
    day2 = empty_day("2026-10-16")
    apply_answer(day2, {"add": [1], "lead": 0, "lead_why": "Not allowed", "drop": []},
                 [mk(9)], [mk(8)], False, et, now)
    assert day2["updates"][0]["lead"] is None
    # outlets never back to back in the picks
    spread = spread_outlets([{"src": "a"}, {"src": "a"}, {"src": "b"}])
    assert [p["src"] for p in spread] == ["a", "b", "a"]
    print("curate_wire: leads and outlet spread ok")

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
