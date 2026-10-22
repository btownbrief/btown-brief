#!/usr/bin/env python3
"""Build all-day/data/widget.json, the small file behind the All Day
home-screen widget (all-day/widget/btown-widget.js, run by the free
Scriptable app on an iPhone).

Everything in it comes from files this repo already publishes. No new
source, no key, no model call:

  weather   data/weather/latest.json (refresh_weather.py, hourly). Right
            now is the airport reading while it is under 90 minutes old,
            else this hour's NWS forecast row, the same rule as the weather
            page (js/life.js currentConditions). The rain line and the high
            and low come from weather_brief.build(), the page's own brief.
  wire      wire-today.json on the wire-data branch (curate_wire.py, every
            20 minutes), fetched over HTTPS. The top of What matters today,
            Local only, because Local is the Wire's default view.
  tonight   all-day/data/whatnow.json (build_whatnow.py, twice a day): What
            Now's Tonight list (today, 5 pm on), ranked by a few plain
            signals so a one-off show at a big room beats weekly trivia.
  game      data/sports.json (build_sports.py): the next UVM or local game.

It runs in refresh-weather.yml right after the weather refresh, so it is as
fresh as the weather and costs no extra scheduled run. A source that fails
keeps the last good copy of its own section from the widget.json already on
disk; nothing broken is ever written.

The widget re-applies the time rules on the phone (the 90-minute rule, and
dropping a show that has started), because it can show this file for an
hour or more after it was built. That is why `weather.obs`, `weather.hours`
and each item's `start` / `end` travel with the ready-made values.

Run:  python3 scripts/build_widget.py
      python3 scripts/build_widget.py --wire path/to/wire-today.json   (no network)
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import weather_brief  # noqa: E402

BTV = ZoneInfo("America/New_York")
HOUR = timedelta(hours=1)
OBS_MAX_AGE = timedelta(minutes=90)     # js/life.js OBS_MAX_AGE
EVENING = 17                            # What Now's Tonight starts at 5 pm
WIRE_URL = "https://raw.githubusercontent.com/btownbrief/btown-brief/wire-data/data/wire-today.json"
APP = "https://guide.btownbrief.com/all-day/"
SITE = "https://guide.btownbrief.com/"

PATHS = {
    "weather": os.path.join(ROOT, "data", "weather", "latest.json"),
    "whatnow": os.path.join(ROOT, "all-day", "data", "whatnow.json"),
    "music": os.path.join(ROOT, "all-day", "data", "music.json"),
    "sports": os.path.join(ROOT, "data", "sports.json"),
    "out": os.path.join(ROOT, "all-day", "data", "widget.json"),
}

WIRE_SHOWN = 3
TONIGHT_KEPT = 4       # the widget shows two; the spares cover shows that start before the next build
CORE_TOWNS = {"burlington", "south burlington", "winooski"}
SHOW_KINDS = {"music", "comedy", "theater", "film"}
# a weekly or standing listing ("Thursdays, 6 p.m.", "Ongoing", "7 dates through ...")
REPEATS = re.compile(r"\b(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weekly|"
                     r"ongoing|multiple dates|\d+ dates)\b", re.I)


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def _dt(iso):
    return weather_brief._dt(iso)


def _cap(s):
    s = (s or "").strip()
    return s[:1].upper() + s[1:]


def clock(d):
    """'7 pm', '6:30 pm', 'noon': Burlington's clock, as the app writes it."""
    t = d.astimezone(BTV)
    if t.hour == 12 and t.minute == 0:
        return "noon"
    h = t.hour % 12 or 12
    return f"{h}{':%02d' % t.minute if t.minute else ''} {'am' if t.hour < 12 else 'pm'}"


def day_word(d, now):
    """'Today', 'Tomorrow', or the weekday, in Burlington."""
    a, b = d.astimezone(BTV).date(), now.astimezone(BTV).date()
    if a == b:
        return "Today"
    if a == b + timedelta(days=1):
        return "Tomorrow"
    return d.astimezone(BTV).strftime("%a")


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        log(f"could not read {path}: {e}")
        return None


# ------------------------------------------------------------- weather

def upcoming_hours(d, now):
    """The hourly rows still running or ahead: js/life.js upcomingHours."""
    hours = ((d.get("hourly") or {}).get("hours")) or []
    return [h for h in hours if _dt(h.get("t")) and _dt(h["t"]) + HOUR > now]


def current(d, now):
    """Right now: the airport while it is fresh, else this hour's forecast."""
    obs = d.get("now") or {}
    at = _dt(obs.get("observed_at")) if obs.get("observed_at") else None
    if obs.get("temp_f") is not None and at and now - at <= OBS_MAX_AGE:
        return {"temp": obs["temp_f"], "sky": obs.get("description") or "", "from": "airport"}
    rows = upcoming_hours(d, now)
    if rows and rows[0].get("temp_f") is not None:
        return {"temp": rows[0]["temp_f"], "sky": rows[0].get("short") or "", "from": "forecast"}
    if obs.get("temp_f") is not None:
        return {"temp": obs["temp_f"], "sky": obs.get("description") or "", "from": "airport"}
    return None


def rain_line(brief):
    """'Rain likely tonight from 9pm on', or 'Dry through Friday'."""
    periods = (brief or {}).get("periods") or []
    for p in periods:
        pr = p.get("precip")
        if pr:
            word = weather_brief._phrase_label(p["label"])
            return _cap(" ".join(x for x in (pr.get("say"), word, pr.get("when")) if x))
    if periods:
        return "Dry through " + weather_brief._phrase_label(periods[-1]["label"])
    return ""


def weather(d, now):
    if not d or not isinstance(d, dict):
        return None
    cur = current(d, now)
    if not cur:
        return None
    brief = weather_brief.build(d, now)
    periods = (brief or {}).get("periods") or []
    hi = next((p["temp_f"] for p in periods if p.get("is_day") and p.get("temp_f") is not None), None)
    lo = next((p["temp_f"] for p in periods if not p.get("is_day") and p.get("temp_f") is not None), None)
    obs = d.get("now") or {}
    return {
        "temp": cur["temp"],
        "sky": cur["sky"],
        "from": cur["from"],
        "hi": hi,
        "lo": lo,
        "rain": rain_line(brief),
        # for the phone to re-apply the 90-minute rule later
        "obs": {"temp": obs.get("temp_f"), "sky": obs.get("description") or "", "at": obs.get("observed_at")}
        if obs.get("temp_f") is not None else None,
        "hours": [{"t": h["t"], "temp": h.get("temp_f"), "sky": h.get("short") or ""}
                  for h in upcoming_hours(d, now)[:6] if h.get("temp_f") is not None],
        "link": SITE + "weather.html",
    }


# ----------------------------------------------------------------- wire

def fetch_wire(url=WIRE_URL, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "btownbrief-widget/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def wire(p):
    """The top of What matters today, Local only, in rank order; then the
    day's earlier rankings, then the newest update, to make up three."""
    if not isinstance(p, dict) or not isinstance(p.get("updates"), list):
        return None
    out, seen = [], set()

    def take(items):
        for it in items:
            if len(out) >= WIRE_SHOWN:
                return
            if not isinstance(it, dict) or not it.get("id") or not it.get("title") or it.get("own"):
                continue
            if not it.get("local") or it["id"] in seen:
                continue
            seen.add(it["id"])
            out.append({"title": re.sub(r"\s+", " ", str(it["title"])).strip(),
                        "src": str(it.get("name") or ""),
                        "url": str(it.get("url") or ""),
                        "link": APP + "#wire/" + str(it["id"])})

    rank = lambda x: x.get("rank") or 99  # noqa: E731
    take(sorted([x for x in p.get("picks") or [] if isinstance(x, dict)], key=rank))
    take(sorted([x for x in p.get("picks_earlier") or [] if isinstance(x, dict)], key=rank))
    for u in reversed(p["updates"]):
        take((u or {}).get("items") or [])
    return out


# -------------------------------------------------------------- tonight

def tonight_list(events, now):
    """What Now's Tonight filter (whatnow.js tonight()): today in
    Burlington, 5 pm on, not all day, not cancelled, not over."""
    today = now.astimezone(BTV).date()
    seen, out = set(), []
    for e in events or []:
        if not isinstance(e, dict) or not e.get("id") or not e.get("title") or not e.get("url") or e.get("allDay"):
            continue
        if e.get("status") and e["status"] != "active":
            continue
        if re.match(r"^\s*(cancel+ed|postponed)\b", e["title"], re.I):
            continue
        start = _dt(e.get("start"))
        if not start or "T" not in str(e.get("start")):
            continue
        t = start.astimezone(BTV)
        if t.date() != today or t.hour < EVENING:
            continue
        end = _dt(e.get("end")) if e.get("end") else None
        if (end and end < now) or (not end and start < now - 2 * HOUR):
            continue
        sig = re.sub(r"[^a-z0-9]+", "", e["title"].lower()) + "|" + start.isoformat()
        if sig in seen:
            continue
        seen.add(sig)
        out.append(e)
    return out


def score(e, rooms, artists):
    """A few plain signals. A one-off show at a big room, or by an artist
    the Brief follows, comes first; weekly trivia comes last."""
    s = 0
    venue = (e.get("venue") or "").lower()
    title = (e.get("title") or "").lower()
    if any(r and r in venue for r in rooms):
        s += 3
    if any(a and len(a) > 3 and a in title for a in artists):
        s += 3
    if e.get("category") in SHOW_KINDS:
        s += 2
    if (e.get("town") or "").lower() in CORE_TOWNS:
        s += 1
    tags = e.get("tags") or []
    if "series" in tags or "ongoing" in tags or REPEATS.search(e.get("recurring") or ""):
        s -= 3
    return s


def show_title(e):
    """The title without its quote marks, and without ' at <venue>' when
    the widget prints the venue beside it anyway."""
    t = re.sub(r"^['‘’\"“]+|['‘’\"“]+$", "", (e.get("title") or "").strip())
    v = (e.get("venue") or "").strip()
    if v and t.lower().endswith(" at " + v.lower()) and len(t) > len(v) + 6:
        t = t[: -len(v) - 4].rstrip(" ,")
    return t


def tonight(whatnow, music, now):
    if not isinstance(whatnow, dict) or not isinstance(whatnow.get("events"), list):
        return None
    music = music if isinstance(music, dict) else {}
    rooms = [str(r.get("name") or "").lower() for r in music.get("bigrooms") or [] if isinstance(r, dict)]
    artists = [str(a.get("name") or "").lower() for a in music.get("artists") or [] if isinstance(a, dict)]
    evs = tonight_list(whatnow["events"], now)
    evs.sort(key=lambda e: (-score(e, rooms, artists), _dt(e["start"]), e["title"].lower()))
    out, keys = [], []
    for e in evs:
        if len(out) >= TONIGHT_KEPT:
            break
        title = show_title(e)
        # the same show listed twice by two calendars: "Dana and Alden at
        # Higher Ground" and "Dana and Alden, Alex Amen", same room
        key = (str(e.get("venue") or "").lower(), re.sub(r"[^a-z0-9]+", " ", title.lower()).strip())
        if any(v == key[0] and len(min(t, key[1], key=len)) >= 6 and (t.startswith(key[1]) or key[1].startswith(t))
               for v, t in keys):
            continue
        keys.append(key)
        start = _dt(e["start"])
        out.append({
            "title": title,
            "time": clock(start),
            "venue": e.get("venue") or e.get("town") or "",
            "start": start.isoformat(),
            "end": _dt(e["end"]).isoformat() if e.get("end") and _dt(e["end"]) else None,
            "url": e["url"],
            "link": APP + "#whatnow/tonight",
        })
    return out


# ----------------------------------------------------------------- game

def next_game(sports, now):
    """The next UVM or local game, or one under way (started in the last
    two and a half hours and not final)."""
    if not isinstance(sports, dict) or not isinstance(sports.get("games"), list):
        return None
    best = None
    for g in sports["games"]:
        if not isinstance(g, dict) or g.get("level") not in ("college", "local") or g.get("state") == "post":
            continue
        start = _dt(g.get("start"))
        if not start or start < now - timedelta(hours=2.5):
            continue
        if best is None or start < best[0]:
            best = (start, g)
    if not best:
        return {}
    start, g = best
    org, title = str(g.get("org") or ""), str(g.get("title") or "")
    name = title if not org or title.lower().startswith(org.lower()) else org + " " + title
    hoops = "basketball" in str(g.get("sport") or "").lower()
    when = day_word(start, now) + ("" if g.get("allDay") else " " + clock(start))
    return {
        "title": name,
        "when": when,
        "start": start.isoformat(),
        "all_day": bool(g.get("allDay")),
        "home": bool(g.get("home")),
        "tv": str(g.get("tv") or ""),
        "url": html.unescape(str(g.get("url") or "")),
        "link": APP + "#onair/hoops" if hoops else SITE + "sports.html",
    }


# ---------------------------------------------------------------- build

def build(inputs, now=None, previous=None):
    """widget.json from the loaded inputs. A section whose input failed
    keeps `previous`'s copy; with nothing to keep it is empty."""
    now = now or datetime.now(timezone.utc)
    prev = previous if isinstance(previous, dict) else {}
    sections = {
        "weather": weather(inputs.get("weather"), now),
        "wire": wire(inputs.get("wire")),
        "tonight": tonight(inputs.get("whatnow"), inputs.get("music"), now),
        "game": next_game(inputs.get("sports"), now),
    }
    empty = {"weather": None, "wire": [], "tonight": [], "game": None}
    out = {"v": 1, "updated": now.astimezone(timezone.utc).isoformat(timespec="seconds"), "app": APP}
    for k, v in sections.items():
        if v is None:
            log(f"{k}: no usable input, keeping the last good copy")
            out[k] = prev.get(k, empty[k])
        else:
            out[k] = v or empty[k]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--wire", help="a local wire-today.json instead of the wire-data branch")
    ap.add_argument("--out", default=PATHS["out"])
    args = ap.parse_args(argv)

    inputs = {k: read_json(PATHS[k]) for k in ("weather", "whatnow", "music", "sports")}
    if args.wire:
        inputs["wire"] = read_json(args.wire)
    else:
        try:
            inputs["wire"] = fetch_wire()
        except Exception as e:  # any network trouble: keep the last good headlines
            log(f"wire fetch failed: {e}")
            inputs["wire"] = None

    out = build(inputs, previous=read_json(args.out) if os.path.exists(args.out) else None)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, args.out)
    w = out["weather"] or {}
    log(f"widget.json: {w.get('temp')}° {w.get('sky')} ({w.get('from')}), "
        f"{len(out['wire'])} headlines, {len(out['tonight'])} tonight, game: {(out['game'] or {}).get('title')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
