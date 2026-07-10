#!/usr/bin/env python3
"""
Draft the morning "My Read" weather report into the review queue.

Reads data/weather/latest.json (run refresh_weather.py first — the GitHub
Action does), builds a compact source packet, and drafts the report with
Claude using prompts/weather-read.md (the shared weather brain).

Output: data/weather/read-draft.json  — status "draft", NEVER shown on the
site. Stephen reviews with scripts/approve_read.py, which promotes it to
data/weather/read.json (the only file the dashboard displays).

Without ANTHROPIC_API_KEY the script still writes the draft entry with the
full packet and an empty text, so the review queue and packet are always
there to write from by hand (or from a Claude Code session).
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import outlets as outlets_mod

ROOT = os.path.join(os.path.dirname(__file__), "..")
LATEST = os.path.join(ROOT, "data", "weather", "latest.json")
DRAFT = os.path.join(ROOT, "data", "weather", "read-draft.json")
BRAIN = os.path.join(ROOT, "prompts", "weather-read.md")

MODEL = os.environ.get("WEATHER_READ_MODEL", "claude-sonnet-5")


def build_packet(d):
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
                     f"{afd.get('issued', '?')}):")
        for i, m in enumerate(afd["key_messages"], 1):
            lines.append(f"  {i}. {m}")
    if afd.get("what_changed"):
        lines.append(f"AFD WHAT CHANGED: {afd['what_changed']}")

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
        lines.append(f"AIR: AQI {air['aqi']} {air.get('category')} ({air.get('pollutant')})"
                     + (f" — {air['discussion']}" if air.get("discussion") else ""))

    sun = d.get("sun") or {}
    if sun:
        lines.append(f"SUN: rise {sun.get('sunrise')}, set {sun.get('sunset')}, UV max {sun.get('uv_max')}")

    # What the other outlets are telling readers (never load-bearing)
    try:
        outlets = outlets_mod.fetch_all()
    except Exception:  # noqa: BLE001
        outlets = {}
    wu = outlets.get("wu")
    if wu and wu.get("days"):
        lines.append("WEATHER UNDERGROUND / WEATHER.COM:")
        for day in wu["days"][:2]:
            lines.append(f"  high {day['high_f']}, low {day['low_f']}: {day['narrative']}")
    wcax = outlets.get("wcax")
    if wcax and wcax.get("discussion"):
        lines.append(f"WCAX METEOROLOGIST: {wcax['discussion']}")
    nbc5 = outlets.get("nbc5")
    if nbc5 and nbc5.get("headline"):
        lines.append(f"NBC5 FIRST WARNING ({nbc5.get('published', '?')}): "
                     f"{nbc5['headline']} — {nbc5.get('lede') or ''}")

    return "\n".join(lines)


def call_claude(brain, packet, today):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None, "no ANTHROPIC_API_KEY — packet-only draft"
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 700,
        "system": brain,
        "messages": [{
            "role": "user",
            "content": (f"Today is {today} in Burlington VT. Draft this morning's read "
                        f"from the packet below. Output the read only.\n\n{packet}"),
        }],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        out = json.loads(res.read())
    text = "".join(b.get("text", "") for b in out.get("content", [])).strip()
    return text or None, None


def main():
    with open(LATEST) as f:
        data = json.load(f)
    with open(BRAIN) as f:
        brain = f.read()

    # Burlington-local date (the Action runs in UTC; DST-safe via zoneinfo)
    local = datetime.now(ZoneInfo("America/New_York"))
    today = local.strftime("%A, %B %-d")

    packet = build_packet(data)
    text, note = None, None
    try:
        text, note = call_claude(brain, packet, today)
    except Exception as e:  # noqa: BLE001 — a failed draft still queues the packet
        note = f"draft generation failed: {e}"
        print(note, file=sys.stderr)

    draft = {
        "date": local.date().isoformat(),
        "drafted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "draft",
        "model": MODEL if text else None,
        "note": note,
        "text": text or "",
        "packet": packet,
    }
    with open(DRAFT, "w") as f:
        json.dump(draft, f, indent=1, ensure_ascii=False)
    print(f"wrote read-draft.json for {draft['date']}"
          + (" (with generated text)" if text else " (packet only — write by hand)"))


if __name__ == "__main__":
    main()
