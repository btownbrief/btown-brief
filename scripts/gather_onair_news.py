#!/usr/bin/env python3
"""On Air news recaps: the evening newscasts and late night's take on the news.

Stephen, 2026-10-19: "Curated recent videos from the main comedy news shows
like The Daily Show, Jimmy Kimmel, John Oliver, etc., and also the main news
recaps like Reuters and ABC World News Tonight, etc. Full recap videos, not
just one-off stories."

Each show below posts its full broadcast, monologue or headlines block to its
own official YouTube channel, among dozens of single-story clips and Shorts.
SHOWS says how to tell the full recap apart: a title rule, a minimum length,
and for the two monologues that carry no title marker (Kimmel, Fallon) the
hour they go up. Research and the evidence for every rule:
reference/drafts/new-nine-2026-10/research/onair-news-recaps-2026-10-19.md in
the newsletter repo.

Discovery is YouTube's free RSS (15 newest uploads a channel, or a playlist's
15). NBC News posts about 1.5 videos an hour, so its feed holds roughly ten
hours: that is why this runs every three hours (refresh-onair-finds.yml),
not once a day. A candidate that passes the title rule is measured once with
videos.list (one quota unit per fifty ids); what fails is remembered in
`seen` and never asked about again. A premiere or a video still processing
(no length yet) waits in `pending` for the next run. No model call: $0.

Output, all-day/data/onair-news.json:
  items: [{id, t, ep (the card's episode title), show, sk, ch,
           kind: "newscast" | "comedy", topic: "news",
           sec, dur, d (upload time, epoch seconds)}], newest first, the last
           seven days, at most PER_SHOW from one show.

Failure posture: each feed fails on its own; no YouTube credentials means
nothing new is measured (candidates wait in `pending`); the file is rewritten
only when what it holds changed, so a quiet run commits nothing. Exits 0.

CLI: --out PATH (default all-day/data/onair-news.json), --dry-run, --selftest
"""

import argparse
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import gather_onair_finds as finds

try:
    from zoneinfo import ZoneInfo
    ET_ZONE = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001  no tz database: the hour rules fall back to EDT
    ET_ZONE = None

ROOT = finds.ROOT
OUT = os.path.join(ROOT, "all-day", "data", "onair-news.json")
FEED = "https://www.youtube.com/feeds/videos.xml?"
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}

KEEP_DAYS = 7
PENDING_DAYS = 2
SEEN_DAYS = 10
PER_SHOW = 8


def show(key, name, kind, feed, match, min_min, hours=None, reject=None, hours_unless=None):
    return {"key": key, "name": name, "kind": kind, "feed": feed, "match": re.compile(match, re.I),
            "min": int(min_min * 60), "hours": set(hours) if hours else None,
            "reject": re.compile(reject, re.I) if reject else None,
            "hours_unless": re.compile(hours_unless) if hours_unless else None}


# feed: "channel_id=UC…" or "playlist_id=PL…"; hours: upload hours, Eastern
SHOWS = [
    show("abc", "ABC World News Tonight", "newscast", "playlist_id=PLQOa26lW-uI9Ja7WDOHBJecZXTC9fm__C",
         r"\bfull broadcast\b", 12),
    show("nbc", "NBC Nightly News", "newscast", "channel_id=UCeY0bbntWzzVIaj2z3QigXg",
         r"^NBC Nightly News Full (Episode|Broadcast)\b|^(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)\.? \d{1,2}: ", 14),
    show("cbs", "CBS Evening News", "newscast", "channel_id=UCAeWdyKJXGWmVAXFpgLNNTg",
         r"\bfull broadcast\b", 12),
    show("pbs", "PBS News Hour", "newscast", "channel_id=UC6ZFN9Tx6xh-skXCuRHCDpQ",
         r"\bfull episode\b", 20),
    show("reuters", "Reuters World News", "newscast", "channel_id=UChqUTb7kYRX8-EiaN3XFrSQ",
         r"\|\s*Reuters World News\s*$", 5),
    show("dailyshow", "The Daily Show", "comedy", "channel_id=UCwWhs_6x42TyRM4Wstoq8HA",
         r"\|\s*The Daily Show\s*$", 8, hours=[h for h in range(24) if h != 23], hours_unless=r"^Jon Stewart"),
    show("lwt", "Last Week Tonight", "comedy", "channel_id=UC3XTzVzaHQEd30rQbuvCtTQ",
         r"^S\d+ E\d+:", 20),
    show("kimmel", "Jimmy Kimmel Live", "comedy", "channel_id=UCa6vGFO9ty8v5KZJXQxdhaw",
         r".", 8, hours=[22, 23, 0]),
    show("seth", "Late Night with Seth Meyers", "comedy", "channel_id=UCVTyTA7-g9nopHeHbeuvpRA",
         r":\s*A Closer Look\s*$|\bNews of the Week\b", 6, reject=r"A Closer Look Back"),
    show("fallon", "The Tonight Show", "comedy", "channel_id=UC8-Th83bH_thdKZDJCrn88g",
         r".", 6, hours=[23], reject=r"\|\s*The Tonight Show|\(Extended\)"),
    show("snl", "SNL Weekend Update", "comedy", "channel_id=UCqFzWxSCi39LnW1JKFR3efg",
         r"^Weekend Update\b", 6),
]
SHOW = {s["key"]: s for s in SHOWS}


EDT = timezone(timedelta(hours=-4))   # the fallback when there is no tz database


def et_hour(ts):
    return datetime.fromtimestamp(ts, ET_ZONE or EDT).hour


def parse_time(text):
    try:
        return int(datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


def parse_feed(xml_text):
    """A YouTube Atom feed -> [{id, title, d}]. A bad entry is skipped."""
    out = []
    for e in ET.fromstring(xml_text).findall("a:entry", NS):
        vid = (e.findtext("yt:videoId", namespaces=NS) or "").strip()
        title = finds.clean(e.findtext("a:title", namespaces=NS), 160)
        d = parse_time(e.findtext("a:published", namespaces=NS))
        if finds.ID_RE.match(vid) and title and d:
            out.append({"id": vid, "title": title, "d": d})
    return out


def is_recap(s, title, d):
    """The title and upload-hour rules, before anything is measured."""
    if finds.SHORTS_RE.search(title) or not s["match"].search(title):
        return False
    if s["reject"] and s["reject"].search(title):
        return False
    if s["hours"] is not None and et_hour(d) not in s["hours"]:
        return bool(s["hours_unless"] and s["hours_unless"].search(title))
    return True


AP_MONTH = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."]
MONTH_RE = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d{1,2})\b")
# the show's own name and series tags, which the card already says
TAILS = re.compile(r"\s*(\|\s*The Daily Show|\|\s*Reuters World News|-\s*SNL|:\s*A Closer Look|"
                   r":\s*\d{1,2}/\d{1,2}/\d{2,4}:\s*Last Week Tonight.*)\s*$", re.I)


def episode_title(s, title, d):
    """What the card calls the episode. A newscast's own title is its show and
    a date, so it becomes "Full broadcast · Sunday, Oct. 18" (the date in the
    title wins: ABC's Oct. 14 went up after midnight). The rest lose the show
    name the card already carries and any series number."""
    if s["kind"] == "newscast" and re.search(r"\bfull (broadcast|episode)\b", title, re.I):
        # an upload before 4 am is the evening before's broadcast
        when = datetime.fromtimestamp(d, ET_ZONE or EDT) - timedelta(hours=4)
        m = MONTH_RE.search(title)
        if m:
            month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].index(m.group(1).lower()) + 1
            year = when.year - (1 if month == 12 and when.month == 1 else 0)
            try:
                when = when.replace(year=year, month=month, day=int(m.group(2)))
            except ValueError:
                pass
        return "Full broadcast · " + when.strftime("%A") + ", " + AP_MONTH[when.month - 1] + " " + str(when.day)
    ep = TAILS.sub("", re.sub(r"^S\d+ E\d+:\s*", "", title))
    if s["key"] == "nbc":
        ep = re.sub(r"^[A-Z][a-z]{2,4}\.? \d{1,2}:\s*", "", ep)
    return ep.strip() or title


def gate(s, cand, detail):
    """(item, None) to keep, (None, reason) to forget, (None, None) to wait."""
    if not detail:
        return None, "gone"
    if not detail["ok"]:
        return None, "not embeddable"
    if detail["live"] or not detail["sec"]:
        return None, None          # a premiere or still processing: next run
    if detail["kids"]:
        return None, "for kids"
    if detail["sec"] < s["min"]:
        return None, "too short"
    sec = detail["sec"]
    title = detail["t"] or cand["title"]
    return {"id": cand["id"], "t": title, "ep": episode_title(s, title, cand["d"]), "show": s["name"], "sk": s["key"],
            "ch": detail["ch"], "kind": s["kind"], "topic": "news", "sec": sec,
            "dur": finds.fmt_seconds(sec), "d": cand["d"]}, None


def cap_shows(items, per=PER_SHOW):
    count, out = {}, []
    for it in items:
        count[it["sk"]] = count.get(it["sk"], 0) + 1
        if count[it["sk"]] <= per:
            out.append(it)
    return out


def run(args):
    now = finds.now_ts()
    try:
        with open(args.out, encoding="utf-8") as fh:
            prev = json.load(fh)
    except (OSError, ValueError):
        prev = {}
    keep = now - KEEP_DAYS * 86400
    items = [it for it in prev.get("items", []) if isinstance(it, dict) and it.get("sk") in SHOW
             and int(it.get("d", 0)) >= keep]
    seen = {k: v for k, v in (prev.get("seen") or {}).items() if now - int(v) < SEEN_DAYS * 86400}
    known = {it["id"] for it in items}
    cands = {}
    for c in prev.get("pending", []):
        if (isinstance(c, dict) and c.get("sk") in SHOW and finds.ID_RE.match(str(c.get("id", "")))
                and int(c.get("d", 0)) >= now - PENDING_DAYS * 86400 and c["id"] not in known):
            cands[c["id"]] = c
    report = {}
    for s in SHOWS:
        entries = finds.safe(s["key"], lambda: parse_feed(finds.fetch(FEED + s["feed"], accept="application/atom+xml")), report)
        for e in entries or []:
            if e["d"] < keep or e["id"] in known or e["id"] in seen or e["id"] in cands:
                continue
            if is_recap(s, e["title"], e["d"]):
                cands[e["id"]] = dict(e, sk=s["key"])

    details = {}
    if cands:
        auth = finds.safe("youtube-auth", finds.youtube_auth, report)
        if auth and auth[0] is not None:
            details = finds.safe("youtube", lambda: finds.youtube_details(list(cands), auth), report) or {}
        else:
            report["youtube"] = "no credentials: nothing new measured"
    added, pending, reasons = [], [], {}
    for vid, c in cands.items():
        if report.get("youtube") != "ok":
            pending.append(c)
            continue
        item, why = gate(SHOW[c["sk"]], c, details.get(vid))
        if item:
            added.append(item)
        elif why:
            seen[vid] = now
            reasons[why] = reasons.get(why, 0) + 1
        else:
            pending.append(c)

    merged = cap_shows(sorted(added + items, key=lambda it: -int(it["d"])))
    # one the cap pushed out is still in its feed: remembered, so it is not measured again
    kept = {it["id"] for it in merged}
    for it in added:
        if it["id"] not in kept:
            seen[it["id"]] = now
    pending.sort(key=lambda c: -int(c["d"]))
    payload = {
        "v": 1,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "shows": {s["key"]: {"name": s["name"], "kind": s["kind"]} for s in SHOWS},
        "items": merged,
        "pending": pending[:60],
        "seen": seen,
        "stats": {"added": len(added), "turned_away": reasons, "sources": report},
    }
    print(json.dumps({"added": len(added), "total": len(merged), "pending": len(pending),
                      "by_show": {k: sum(1 for it in merged if it["sk"] == k) for k in SHOW},
                      "turned_away": reasons, "sources": report}, indent=1))
    if args.dry_run:
        return payload
    same = all(prev.get(k) == payload[k] for k in ("items", "pending", "seen", "shows"))
    if same:
        print("onair-news: nothing changed; file left as it was", file=sys.stderr)
        return payload
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    os.replace(tmp, args.out)
    return payload


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        import subprocess
        sys.exit(subprocess.call([sys.executable, "-m", "unittest", "tests.test_gather_onair_news"], cwd=ROOT))
    run(args)


if __name__ == "__main__":
    main()
