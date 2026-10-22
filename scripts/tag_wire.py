#!/usr/bin/env python3
"""The Wire, step one of two: tag every new item, hourly, cheaply.

pulse.json brings ~1,000 items a day. curate_wire.py (the expensive editor)
should only read the ones worth reading, so this pass gives each NEW item:

  junk   none | promo | contest | tunein | jobs | duplicate | noise
  local  true when the story is about Burlington or Vermont, whatever the outlet
  ch     the mechanical channel, flipped local <-> world when `local` says so
  topic  one of TOPICS
  sport  for a sports item, one of wire_common.SPORTS (nba, nfl, nhl, tennis,
         mlb, college, local, other); a single-sport source's own sport wins
  score  0-10 local interest

Posts from people (Facebook groups, Reddit) are judged by narrower junk
rules: a neighbor announcing an event, asking, reporting or giving something
away is never junk; only a business advertising what it sells, an engagement
contest, spam and empty chatter are (the private wire-tags.md, 2026-10-17).

Tags are kept in data/wire-tags.json, keyed by item id, so an item is tagged
once. The model is Claude Haiku 5.5 when ANTHROPIC_API_KEY exists, else GLM
5.3 Flash through OPENROUTER_API_KEY; the rules are the private wire-tags.md.

Honesty rules, as in curate_top.py: the model answers by INDEX into the
numbered list and only chooses from fixed vocabularies; every tag maps back to
a real item; anything malformed is dropped and that item simply stays
untagged for the next run. The mechanical channel of an inbox or Reddit item
is never overridden. Its `local` is the tagger's, except a Facebook group's:
every group is local, so that one stays mechanical. The X shortlist carries
national desks as well as Vermont accounts (2026-10-17), so for X the verdict
decides: AP on a Vermont story is local, WCAX on a South Carolina trial is not.

Failure posture: no key, the month cap (wire_common.MONTH_CAP_USD, $60), or
any API trouble logs and exits 0. Items left untagged are retried next hour,
and curate_wire.py treats an untagged item with mechanical defaults, so a
tagging outage degrades the river's ranking, never its existence.

CLI:
  --data-dir DIR   wire-data working tree (default data/)
  --pulse PATH     read pulse.json from a file instead of the pulse-data branch
  --as-of ISO      run as if it were that moment (a labelled backfill)
  --selftest       run the offline checks and exit
"""

import argparse
import json
import re
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wire_common as wc  # noqa: E402

PULSE_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
             "pulse-data/data/pulse.json")
UA = "btown-wire-tags/1.0"
WINDOW_HOURS = 30        # the curator looks back 26h; tag a little wider
BATCH = 120              # items per call: ~4k tokens in, ~3k out
MAX_PER_RUN = 600        # the first run of a fresh store tags local first
KEEP_HOURS = 72          # tags older than this leave the store
CALL_GAP_MINUTES = 50    # as curate_wire: one tagging call an hour, whichever tick lands
RIVER_TITLES = 300       # duplicates are judged against all of today's river
JUNK = ("none", "promo", "contest", "tunein", "jobs", "duplicate", "noise")
TOPICS = (
    "city-government", "state-politics", "schools", "housing", "transportation",
    "public-safety", "courts", "business", "food-drink", "arts-culture", "music",
    "events", "sports", "weather", "environment", "health", "community",
    "national-politics", "world", "economy", "markets", "tech", "science", "media", "other",
)
FIXED = ("x", "facebook", "reddit", "newsletters", "video")
TUNEIN_RE = re.compile(r"tune in|watch live|live ?stream|listen live|on air|join us|"
                       r"streaming now|tonight at \d|tonight on|this week on|"
                       r"(?-i:\bLIVE\b)", re.I)   # "LIVE:" is a broadcast; "live music" is a show
# A person's post says "join us tonight at 7" about a show in a room; only
# these words make it a broadcast
BROADCAST_RE = re.compile(r"tune in|watch live|live ?stream|listen live|on air|streaming now|"
                          r"(?-i:\bLIVE\b)", re.I)
# which words make a `tunein` verdict stand, by channel. X is judged as a
# headline: the list is mostly outlets and news desks, and "join us tonight at
# 6" from a station is a broadcast
TUNEIN_WORDS = {"local": TUNEIN_RE, "world": TUNEIN_RE, "x": TUNEIN_RE,
                "facebook": BROADCAST_RE, "reddit": BROADCAST_RE}
# A `tunein` is undone only when the model did not file it under
# selling: every show mislabeled `tunein` on 2026-10-17 was music or arts, every
# ad business or food-drink, so an ad mislabeled `tunein` stays junk
SELLING_TOPICS = ("business", "food-drink")

SCHEMA_ITEM = {
    "type": "object",
    "properties": {
        "i": {"type": "integer"},
        "junk": {"type": "string", "enum": list(JUNK)},
        "local": {"type": "boolean"},
        "ch": {"type": "string", "enum": list(wc.CHANNELS)},
        "topic": {"type": "string", "enum": list(TOPICS)},
        "sport": {"type": "string", "enum": ["none"] + list(wc.SPORTS)},
        "score": {"type": "integer", "minimum": 0, "maximum": 10},
    },
    "required": ["i", "junk", "local", "ch", "topic", "sport", "score"],
    "additionalProperties": False,
}


def schema_for(n):
    return {
        "type": "object",
        "properties": {"tags": {"type": "array", "maxItems": n, "items": SCHEMA_ITEM}},
        "required": ["tags"],
        "additionalProperties": False,
    }


def fetch_pulse(url=PULSE_URL, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def load_store(data_dir):
    store = wc.load_json(os.path.join(data_dir, "wire-tags.json"), {})
    if not isinstance(store, dict) or not isinstance(store.get("tags"), dict):
        store = {"v": 1, "tags": {}}
    return store


def river_titles(data_dir, rebuilding=False):
    """[(id, title)] of today's river, for judging duplicates. Empty when
    today is being rebuilt: the old river is about to be thrown away."""
    if rebuilding:
        return []
    today = wc.load_json(os.path.join(data_dir, "wire-today.json"), {})
    if today.get("date") != wc.et_now().date().isoformat():
        return []   # yesterday's river is not today's
    titles = []
    for update in today.get("updates") or []:
        for item in update.get("items") or []:
            if item.get("title"):
                titles.append((item.get("id"), item["title"]))
    return titles[:RIVER_TITLES]


def needs_tag(tag):
    """True when an item has no usable tag: never tagged, or a sports story
    tagged before tags carried a `sport` (2026-10-19), which is tagged once
    more so the page's sport chips see it."""
    if not isinstance(tag, dict):
        return True
    return tag.get("topic") == "sports" and not tag.get("sport")


def untagged(items, store):
    tags = store.get("tags") or {}
    # the Brief's own edition is never judged (curate_wire always runs it)
    fresh = [item for item in items if needs_tag(tags.get(item["id"])) and not item.get("own")]
    # local first, then newest: a capped first run spends itself on the
    # items the page leads with
    fresh.sort(key=lambda item: (not item["local"], -item["d"]))
    return fresh[:MAX_PER_RUN]


def format_batch(batch, titles):
    """The numbered list. A river item that is itself in this batch is left
    off the ALREADY IN THE RIVER list, so nothing is judged a duplicate of
    itself."""
    in_batch = {item["id"] for item in batch}
    titles = [title for item_id, title in titles if item_id not in in_batch]
    lines = []
    if titles:
        lines.append("ALREADY IN THE RIVER (today):")
        lines.extend(f"- {title}" for title in titles)
        lines.append("")
    lines.append("NEW ITEMS:")
    for index, item in enumerate(batch):
        who = item.get("handle") or item["name"]
        lines.append(f"{index}. {item['ch']} · {'LOCAL' if item['local'] else 'NATIONAL'} · "
                     f"{who} · {item['title']}")
    return "\n".join(lines)


def validate_tags(raw, batch, now_ts):
    """Model output -> {item_id: tag}. Bad indices, repeats, unknown words and
    channel changes the rules forbid are all dropped or corrected."""
    out = {}
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        index = entry.get("i")
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(batch):
            continue
        item = batch[index]
        if item["id"] in out:
            continue
        junk = entry.get("junk") if entry.get("junk") in JUNK else None
        topic = entry.get("topic") if entry.get("topic") in TOPICS else "other"
        words = TUNEIN_WORDS.get(item["ch"])
        if junk == "tunein" and words and not words.search(item["title"]) \
                and topic not in SELLING_TOPICS:
            # a story about an event is news; "tune in" means a broadcast or
            # livestream notice, and only a headline that says so is one. A
            # neighbor's post about a show is the event itself (2026-10-17:
            # nine Facebook band and venue posts were junked as "tunein")
            junk = "none"
        score = entry.get("score")
        if junk is None or not isinstance(score, int) or isinstance(score, bool):
            continue
        local = entry.get("local")
        local = bool(local) if isinstance(local, bool) else item["local"]
        ch = item["ch"]
        if ch in ("local", "world"):
            ch = "local" if local else "world"   # geography decides, never a model whim
        if item["ch"] == "facebook":
            local = item["local"]   # every group is local; X follows the verdict
        out[item["id"]] = {
            "ch": ch, "local": local, "junk": junk, "topic": topic,
            "score": max(0, min(10, score)), "at": now_ts,
        }
        sport = item.get("sport") or sport_of(entry.get("sport"), topic)
        if sport:
            out[item["id"]]["sport"] = sport
    return out


def sport_of(answer, topic):
    """The model's sport for a sports story; `other` when it named none. A
    story filed under any other topic carries no sport."""
    if topic != "sports":
        return None
    return answer if answer in wc.SPORTS else "other"


def prune(store, now_ts):
    cutoff = now_ts - KEEP_HOURS * 3600
    store["tags"] = {key: tag for key, tag in (store.get("tags") or {}).items()
                     if isinstance(tag, dict) and tag.get("at", 0) >= cutoff}


def as_of(args):
    value = getattr(args, "as_of", None)
    return datetime.fromisoformat(value).astimezone(timezone.utc) if value else None


def run(args):
    now = as_of(args) or wc.utcnow()
    now_ts = int(now.timestamp())
    engine = wc.pick_engine("tag")
    if engine is None:
        print("tag_wire: no ANTHROPIC_API_KEY or OPENROUTER_API_KEY, skipping")
        return 0
    refuse, mtd = wc.over_budget(args.data_dir, now)
    if refuse:
        line = (f"tag_wire: refusing to run, ${mtd:.2f} spent this month "
                f"(cap ${wc.MONTH_CAP_USD:.0f})")
        print(line)
        wc.step_summary("- " + line)
        return 0
    try:
        pulse = wc.load_json(args.pulse, None) if args.pulse else fetch_pulse()
        if not isinstance(pulse, dict):
            raise ValueError("pulse.json unreadable")
    except Exception as exc:  # noqa: BLE001 — a fetch failure is not a crash
        print(f"tag_wire: could not read pulse.json ({exc})", file=sys.stderr)
        return 0

    store = {"v": 1, "tags": {}} if getattr(args, "retag", False) else load_store(args.data_dir)
    prune(store, now_ts)
    called = store.get("called_at")
    if called and not getattr(args, "retag", False) and \
            0 <= (now - datetime.fromisoformat(called)).total_seconds() < CALL_GAP_MINUTES * 60:
        # the workflow ticks up to three times an hour; tag once an hour
        print(f"tag_wire: tagged {called}, under {CALL_GAP_MINUTES} minutes ago; next tick")
        return 0
    todo = untagged(wc.wire_items(pulse, now_ts, WINDOW_HOURS), store)
    if not todo:
        print("tag_wire: nothing new to tag")
        store["updated"] = now.replace(microsecond=0).isoformat()
        wc.write_json(os.path.join(args.data_dir, "wire-tags.json"), store)
        return 0

    system = wc.read_prompt("wire-tags.md")
    titles = river_titles(args.data_dir, rebuilding=getattr(args, "retag", False))
    usage = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "calls": 0}
    tagged = failed = 0
    for start in range(0, len(todo), BATCH):
        batch = todo[start:start + BATCH]
        try:
            answer, got = wc.ask_json(engine, system, format_batch(batch, titles),
                                      schema_for(len(batch)), max_tokens=12000,
                                      log_prefix="tag_wire")
        except wc.ModelError as exc:
            got = getattr(exc, "usage", {})
            failed += len(batch)
            print(f"tag_wire: batch of {len(batch)} left untagged ({exc})", file=sys.stderr)
            answer = None
        except Exception as exc:  # noqa: BLE001 — SDK missing, network, anything
            failed += len(batch)
            print(f"tag_wire: batch of {len(batch)} left untagged ({exc})", file=sys.stderr)
            break
        for key in usage:
            usage[key] += got.get(key, 0)
        if answer:
            tags = validate_tags(answer.get("tags"), batch, now_ts)
            store["tags"].update(tags)
            tagged += len(tags)
            failed += len(batch) - len(tags)

    store["updated"] = now.replace(microsecond=0).isoformat()
    if usage["calls"]:
        store["called_at"] = store["updated"]
    wc.write_json(os.path.join(args.data_dir, "wire-tags.json"), store)
    if usage["calls"] or usage["in"]:
        wc.record_cost(args.data_dir, "tag_wire", engine, usage, now)
    junk = sum(1 for tag in store["tags"].values() if tag.get("junk") != "none")
    print(f"tag_wire: {tagged} tagged, {failed} left for next run, "
          f"{len(store['tags'])} in store ({junk} junk)")
    return 0


# ----------------------------------------------------------------------
# Selftest — offline, no API call
# ----------------------------------------------------------------------

def selftest():
    batch = [
        {"id": "a", "ch": "local", "local": True, "name": "WCAX", "title": "Council votes", "d": 2},
        {"id": "b", "ch": "world", "local": False, "name": "AP", "title": "Vermont town floods", "d": 1},
        {"id": "c", "ch": "x", "local": True, "name": "WCAX", "handle": "@wcax", "title": "I-89 closed", "d": 3},
        {"id": "d", "ch": "x", "local": False, "name": "AP", "handle": "@AP",
         "title": "Vermont's governor declares a flood emergency", "d": 4},
        {"id": "e", "ch": "x", "local": False, "name": "WCAX", "handle": "@wcax",
         "title": "Jury selection begins in a South Carolina murder trial", "d": 5},
        {"id": "f", "ch": "facebook", "local": True, "name": "Old North End", "title": "Lost cat on North St", "d": 6},
    ]
    sports = [
        {"id": "g", "ch": "world", "local": False, "name": "ESPN", "title": "Lakers trade", "d": 7},
        {"id": "h", "ch": "world", "local": False, "name": "ESPN", "title": "A bonspiel", "d": 8},
        {"id": "i", "ch": "world", "local": False, "name": "AP", "title": "NFL TV deal", "d": 9},
        {"id": "j", "ch": "world", "local": False, "name": "ESPN MLB", "title": "MLB owners vote",
         "d": 10, "sport": "mlb"},
    ]
    tags = validate_tags([
        {"i": 0, "junk": "none", "local": False, "ch": "world", "topic": "city-government", "score": 9},
        {"i": 1, "junk": "none", "local": True, "ch": "world", "topic": "weather", "score": 14},
        {"i": 2, "junk": "none", "local": False, "ch": "local", "topic": "transportation", "score": 7},
        {"i": 2, "junk": "promo", "local": True, "ch": "x", "topic": "other", "score": 0},
        {"i": 70, "junk": "none", "local": True, "ch": "local", "topic": "other", "score": 5},
        {"i": 0, "junk": "maybe", "local": True, "ch": "local", "topic": "other", "score": 5},
        {"i": 3, "junk": "none", "local": True, "ch": "x", "topic": "weather", "score": 8},
        {"i": 4, "junk": "none", "local": False, "ch": "x", "topic": "courts", "score": 3},
        {"i": 5, "junk": "none", "local": False, "ch": "facebook", "topic": "community", "score": 4},
        {"i": 6, "junk": "none", "local": False, "ch": "world", "topic": "sports", "sport": "nba",
         "score": 4},
        {"i": 7, "junk": "none", "local": False, "ch": "world", "topic": "sports", "sport": "curling",
         "score": 3},
        {"i": 8, "junk": "none", "local": False, "ch": "world", "topic": "economy", "sport": "nfl",
         "score": 3},
        {"i": 9, "junk": "none", "local": False, "ch": "world", "topic": "business", "sport": "none",
         "score": 3},
    ], batch + sports, 100)
    assert set(tags) == {"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}
    assert [tags[k].get("sport") for k in "ghij"] == ["nba", "other", None, "mlb"]   # source wins
    assert "sport" not in tags["a"]
    assert tags["a"]["ch"] == "world" and tags["a"]["local"] is False   # geography flips
    assert tags["b"]["ch"] == "local" and tags["b"]["score"] == 10      # clamped
    assert tags["c"]["ch"] == "x" and tags["c"]["local"] is False       # X: the verdict decides
    assert tags["d"]["ch"] == "x" and tags["d"]["local"] is True        # a national desk on Vermont
    assert tags["e"]["ch"] == "x" and tags["e"]["local"] is False       # WCAX away from home
    assert tags["f"]["ch"] == "facebook" and tags["f"]["local"] is True  # Facebook stays mechanical
    text = format_batch(batch, [("zz", "Earlier story"), ("a", "Council votes")])
    assert "ALREADY IN THE RIVER" in text and "2. x · LOCAL · @wcax · I-89 closed" in text
    assert "- Council votes" not in text      # never a duplicate of itself
    store = {"tags": {"old": {"at": 0}, "new": {"at": 10 ** 9}}}
    prune(store, 10 ** 9)
    assert list(store["tags"]) == ["new"]
    assert [i["id"] for i in untagged(batch, {"tags": {"a": {}}})][:2] == ["f", "c"]   # local, newest first
    # a sports tag from before `sport` existed is tagged again, once
    old = {"tags": {"g": {"topic": "sports"}, "h": {"topic": "sports", "sport": "other"},
                    "a": {"topic": "city-government"}}}
    assert "g" in [i["id"] for i in untagged(sports, old)]
    assert "h" not in [i["id"] for i in untagged(sports, old)]
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", default=os.path.join(wc.ROOT, "data"))
    parser.add_argument("--pulse")
    parser.add_argument("--retag", action="store_true",
                        help="forget every stored tag and tag the window again (after a rules change)")
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
