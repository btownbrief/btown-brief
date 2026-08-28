#!/usr/bin/env python3
"""
Draft the "My Read" weather report into the review queue.

Reads data/weather/latest.json (run refresh_weather.py first — the GitHub
Action does), builds a compact source packet, and drafts the report with
Claude using prompts/weather-read.md (the shared weather brain).

Three editions a day (--edition morning|midday|evening) so the page has a
fresh read by 7 AM, noon, and 5 PM Burlington time. Each edition writes
data/weather/read-draft.json — status "draft", NEVER shown on the site
directly. scripts/auto_publish_read.py (or Stephen, via
scripts/approve_read.py) promotes it to data/weather/read.json, the only
file the dashboard displays.

Without OPENROUTER_API_KEY the script still writes the draft entry with the
full packet and an empty text, so the review queue and packet are always
there to write from by hand (or from a Claude Code session).
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import outlets as outlets_mod

ROOT = os.path.join(os.path.dirname(__file__), "..")
LATEST = os.path.join(ROOT, "data", "weather", "latest.json")
DRAFT = os.path.join(ROOT, "data", "weather", "read-draft.json")
READ = os.path.join(ROOT, "data", "weather", "read.json")
BRAIN = os.path.join(ROOT, "prompts", "weather-read.md")

# Edition windows, Burlington time. --auto drafts whichever edition the
# clock says should be live, so a skipped or hours-late GitHub cron heals
# on the next run that fires instead of leaving yesterday's read up.
EDITION_RANK = {"morning": 0, "midday": 1, "evening": 2}
EDITION_STARTS = [("evening", 16 * 60 + 30), ("midday", 11 * 60 + 30),
                  ("morning", 5 * 60 + 30)]


def edition_due(now_local):
    minutes = now_local.hour * 60 + now_local.minute
    for name, start in EDITION_STARTS:
        if minutes >= start:
            return name
    return None  # small hours — yesterday's evening read stands


def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None

# GLM's reasoning is mandatory, unbounded and billed as output: providers
# burned entire max_tokens budgets on thinking and returned no text (GMICloud
# 7998/8000). Short-output calls use a non-reasoning model instead - same
# OpenRouter key and endpoint, fewer tokens, and no empty-reply failure mode.
MODEL = os.environ.get("WEATHER_READ_MODEL", "openai/gpt-4o-mini")


def build_packet(d, outlets):
    """A compact, human-readable packet — small enough to read at review
    time, complete enough to write from."""
    lines = []
    now = d.get("now") or {}
    lines.append(f"OBSERVED ({now.get('observed_at', '?')}): {now.get('description')}, "
                 f"{now.get('temp_f')}F feels {now.get('feels_like_f')}F, humidity {now.get('humidity')}%, "
                 f"wind {now.get('wind_dir')} {now.get('wind_mph')} mph")

    alerts = (d.get("alerts") or {}).get("active") or []
    if alerts:
        lines.append("ALERTS: " + "; ".join(a.get("headline") or a.get("event", "") for a in alerts))

    fc = (d.get("forecast") or {}).get("periods") or []
    if fc:
        lines.append("NWS FORECAST:")
        for p in fc[:4]:
            lines.append(f"  {p['name']}: {p['detailed']}")

    afd = d.get("afd") or {}
    if afd.get("key_messages"):
        lines.append("AFD KEY MESSAGES (forecaster's reasoning, issued "
                     f"{afd.get('issued', '?')} — covers the whole BTV area, "
                     "northern NY included: translate to what Burlington feels, "
                     "never repeat other regions' place names):")
        for i, m in enumerate(afd["key_messages"], 1):
            lines.append(f"  {i}. {m}")
    if afd.get("what_changed"):
        lines.append(f"AFD WHAT CHANGED (same regional caveat): {afd['what_changed']}")

    lk = d.get("lake_forecast") or {}
    if lk.get("broad") and not lk.get("suspended"):
        lines.append("LAKE (broad waters):")
        for p in lk["broad"][:4]:
            lines.append(f"  {p['period']}: {p['text']}")
    gage = d.get("lake_gage") or {}
    if gage:
        lines.append(f"LAKE GAGE: water {gage.get('water_temp_f')}F, "
                     f"level {gage.get('level_ft')} ft ({gage.get('level_status')})")

    models = (d.get("models") or {}).get("days") or []
    if models:
        lines.append("MODEL SPREAD (where forecasts diverge):")
        for day in models:
            hi = ", ".join(f"{k} {v}" for k, v in day["high_f"].items())
            pop = ", ".join(f"{k} {v}%" for k, v in day["pop_max"].items())
            lines.append(f"  {day['date']}: highs [{hi}] spread {day['high_spread_f']}F; precip chance [{pop}]")

    air = d.get("air") or {}
    if air.get("aqi") is not None:
        lines.append(f"AIR: AQI {air['aqi']} {air.get('category')} ({air.get('pollutant')})")

    sun = d.get("sun") or {}
    if sun:
        lines.append(f"SUN: rise {sun.get('sunrise')}, set {sun.get('sunset')}, UV max {sun.get('uv_max')}")

    # What the other outlets are telling readers (never load-bearing)
    wu = outlets.get("wu")
    if wu and wu.get("days"):
        lines.append("WEATHER UNDERGROUND / WEATHER.COM:")
        for day in wu["days"][:2]:
            lines.append(f"  high {day['high_f']}, low {day['low_f']}: {day['narrative']}")
    wcax = outlets.get("wcax")
    if wcax and wcax.get("discussion"):
        lines.append("WCAX METEOROLOGIST (regional station — Burlington relevance "
                     f"only, never their branding): {wcax['discussion']}")
    nbc5 = outlets.get("nbc5")
    if nbc5 and nbc5.get("headline"):
        lines.append(f"NBC5 ({nbc5.get('published', '?')} — same caveat): "
                     f"{nbc5['headline']} — {nbc5.get('lede') or ''}")

    return "\n".join(lines)


def group_week_days(periods):
    """Fold NWS's 14 half-day periods into calendar days keyed by Burlington
    date — the same grouping js/life.js does, so blurb dates always line up
    with the week strip's cards."""
    days, by_key = [], {}
    for p in periods:
        if not p.get("start"):
            continue
        key = (datetime.fromisoformat(p["start"])
               .astimezone(ZoneInfo("America/New_York")).date().isoformat())
        day = by_key.get(key)
        if day is None:
            day = {"date": key, "parts": []}
            by_key[key] = day
            days.append(day)
        day["parts"].append(f"{p['name']}: {p['detailed']}")
    return days


def build_week_packet(d, outlets):
    """Everything the week blurbs draw on: the full 7-day NWS wording plus
    the same divergence signals the daily read gets."""
    lines = []
    days = group_week_days((d.get("forecast") or {}).get("periods") or [])
    for day in days:
        lines.append(f"DATE {day['date']}:")
        for part in day["parts"]:
            lines.append(f"  {part}")

    models = (d.get("models") or {}).get("days") or []
    if models:
        lines.append("MODEL SPREAD (where forecasts diverge):")
        for day in models:
            hi = ", ".join(f"{k} {v}" for k, v in day["high_f"].items())
            pop = ", ".join(f"{k} {v}%" for k, v in day["pop_max"].items())
            lines.append(f"  {day['date']}: highs [{hi}] spread {day['high_spread_f']}F; precip chance [{pop}]")

    wu = outlets.get("wu")
    if wu and wu.get("days"):
        lines.append("WEATHER UNDERGROUND / WEATHER.COM:")
        for day in wu["days"]:
            lines.append(f"  {day.get('date') or '?'}: high {day['high_f']}, low {day['low_f']}: {day['narrative']}")
    # No free-form outlet prose here — WCAX/NBC5 cover northern New York and
    # all of Vermont, and their regional wording leaks into blurbs. The NWS
    # point forecast and the model spread are already Burlington-scoped.
    return "\n".join(lines), [day["date"] for day in days]


# What each edition asks for. Morning is the full read; the later two are
# updates — what changed since the last one, what the rest of the day holds.
EDITIONS = {
    "morning": "Draft this morning's read from the packet below.",
    "midday": ("Draft a short midday update from the packet below: how the day is "
               "actually playing out so far, and what the afternoon and evening hold."),
    "evening": ("Draft a short early-evening update from the packet below: tonight, "
                "sunset conditions, and a first look at tomorrow."),
}


def get_api_key():
    key = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if not key:
        return None, "no OPENROUTER_API_KEY — packet-only draft"
    if not key.isascii():
        # classic paste accident: copying the *displayed* truncated key
        # ("sk-ant-…") instead of using the console's Copy button
        return None, ("OPENROUTER_API_KEY contains invalid characters (a '…'?) — "
                      "re-copy the full key with the Copy button and update the secret")
    return key, None


# Place names from the rest of the BTV forecast area (northern NY, central
# and southern VT) plus TV-station branding. This page speaks Burlington —
# generated prose naming these is a bug, not color.
REGIONAL_RE = re.compile(
    r"\b(new york|adirondacks?|north country|capital region|plattsburgh|"
    r"saranac|lake placid|glens falls|st\.? lawrence|malone|massena|"
    r"rutland|bennington|brattleboro|windham|windsor|"
    r"southern vermont|central vermont|first alert|first warning)\b", re.I)


def api_call(key, brain, prompt, max_tokens=8000):
    body = json.dumps({
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": brain,
        # Advisory only: providers largely ignore this cap (measured 1.2k-4.2k
        # against a requested 1024). It matters only if MODEL is pointed back at
        # a reasoning model via WEATHER_READ_MODEL; the budgets above carry the
        # real headroom either way.
        "reasoning": {"max_tokens": 1024},
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/messages",
        data=body,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        out = json.loads(res.read())
    text = "".join(b.get("text", "") for b in out.get("content", [])).strip()
    stop = out.get("stop_reason")
    if not text or stop != "end_turn":
        # Surface WHY in the Action log: stop reason and what blocks came back.
        blocks = [b.get("type") for b in out.get("content", [])]
        print(f"api_call: stop_reason={stop!r} blocks={blocks} "
              f"usage={out.get('usage')}", file=sys.stderr)
    return text, stop


def call_claude(key, brain, packet, today, edition):
    prompt = (f"Today is {today} in Burlington VT. {EDITIONS[edition]} "
              f"Output the read only.\n\n{packet}")
    text, _ = api_call(key, brain, prompt)
    m = text and REGIONAL_RE.search(text)
    if m:
        # One corrective retry, then give up — a read naming other regions
        # is worse than no read (the page keeps the last good one).
        print(f"read named {m.group(0)!r} — retrying with correction", file=sys.stderr)
        text, _ = api_call(key, brain, prompt +
                           "\n\nIMPORTANT: your previous draft mentioned "
                           f"'{m.group(0)}'. This read is for Burlington only — "
                           "never name other regions, counties, or TV-station "
                           "brands. Rewrite without them.")
        if text and REGIONAL_RE.search(text):
            print("read still regional after retry — dropping it", file=sys.stderr)
            return None
    return text or None


def call_claude_week(key, brain, week_packet, dates, today):
    """One blurb per forecast day. Line-based output, not JSON — a model
    told to write like a weatherman will put quotes and asides inside prose,
    and JSON breaks on exactly the days worth writing about. Any line that
    doesn't validate is simply skipped — the page falls back to the NWS
    wording per day; no blurbs at all returns None."""
    prompt = (
        f"Today is {today} in Burlington VT. Write the week blurbs from the "
        "packet below, per the week-blurbs section of your instructions. "
        "Output one line per date, in this exact order, each formatted as\n"
        "YYYY-MM-DD | blurb\n"
        "covering these dates: " + ", ".join(dates) + ". No other text.\n\n"
        + week_packet)
    raw, stop = api_call(key, brain, prompt, max_tokens=24000)
    lines = raw.splitlines()
    if stop == "max_tokens" and lines:
        # The reply was cut off mid-generation; the last line may end
        # mid-sentence ("…roll through between 4"). Never publish it.
        lines = lines[:-1]
    week, seen = [], set()
    for line in lines:
        m = re.match(r"\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\S.*)", line)
        if not m or m.group(1) not in dates or m.group(1) in seen:
            continue
        blurb = m.group(2).strip()
        bad = (not re.search(r"[.!?…]['\"”’]?$", blurb) and "truncated") \
            or (len(blurb.split()) > 28 and "overlong") \
            or (REGIONAL_RE.search(blurb) and "regional")
        if bad:
            print(f"dropping {bad} blurb for {m.group(1)}: {blurb!r}", file=sys.stderr)
            continue
        seen.add(m.group(1))
        week.append({"date": m.group(1), "blurb": blurb})
    if not week:
        raise ValueError(f"no usable blurb lines in week reply: {raw[:200]!r}")
    return week


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--edition", choices=sorted(EDITIONS), default="morning")
    parser.add_argument("--auto", action="store_true",
                        help="draft whichever edition is due by the clock, "
                             "unless it is already drafted or live; exits "
                             "quietly otherwise")
    args = parser.parse_args()

    # Burlington-local date (the Action runs in UTC; DST-safe via zoneinfo)
    local = datetime.now(ZoneInfo("America/New_York"))
    today = local.strftime("%A, %B %-d")

    edition = args.edition
    if args.auto:
        edition = edition_due(local)
        if not edition:
            print("auto: no edition due at this hour — nothing to do")
            return
        today_iso = local.date().isoformat()
        for path in (DRAFT, READ):
            cur = load_json(path)
            if (cur and cur.get("date") == today_iso
                    and EDITION_RANK.get(cur.get("edition", "morning"), 0)
                        >= EDITION_RANK[edition]
                    and (cur.get("text") or "").strip()):
                print(f"auto: {edition} edition already covered by "
                      f"{os.path.basename(path)} — nothing to do")
                return
        print(f"auto: {edition} edition is due and missing — drafting")

    with open(LATEST) as f:
        data = json.load(f)
    with open(BRAIN) as f:
        brain = f.read()

    # What the other outlets are telling readers (never load-bearing)
    try:
        outlets = outlets_mod.fetch_all()
    except Exception:  # noqa: BLE001
        outlets = {}

    packet = build_packet(data, outlets)
    week_packet, week_dates = build_week_packet(data, outlets)

    key, note = get_api_key()
    text, week = None, None
    if key:
        try:
            text = call_claude(key, brain, packet, today, edition)
        except Exception as e:  # noqa: BLE001 — a failed draft still queues the packet
            note = f"draft generation failed: {e}"
            print(note, file=sys.stderr)
        # The week blurbs are a bonus, never a blocker: if this call fails
        # the page simply shows the NWS wording in the week panel.
        try:
            week = call_claude_week(key, brain, week_packet, week_dates, today)
        except Exception as e:  # noqa: BLE001
            print(f"week blurbs failed: {e}", file=sys.stderr)

    draft = {
        "date": local.date().isoformat(),
        "edition": edition,
        "drafted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "draft",
        "model": MODEL if text else None,
        "note": note,
        "text": text or "",
        "week": week,
        "packet": packet,
    }
    with open(DRAFT, "w") as f:
        json.dump(draft, f, indent=1, ensure_ascii=False)
    print(f"wrote read-draft.json ({draft['edition']}) for {draft['date']}"
          + (" (with generated text)" if text else " (packet only — write by hand)"))


if __name__ == "__main__":
    main()
