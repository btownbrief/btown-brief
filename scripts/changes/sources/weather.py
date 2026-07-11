#!/usr/bin/env python3
"""
Weather changes: NWS watches/warnings/advisories for the Burlington point,
plus a once-a-day heads-up when today's forecast carries thunder/snow/wind.

State shape:
  {
    "alerts": [{"id", "event", "headline", "severity", "onset", "ends", "url"}],
    "forecast_flag": {"day": "2026-07-10", "text": "Thunderstorms likely after 5 PM"} | None
  }

Diff semantics (state-shaped, not feed-shaped):
  - alert id appears            -> "Severe Thunderstorm Warning issued" (priority 3)
  - alert id disappears         -> "… expired/cancelled" (priority 2)
  - forecast_flag day+text new  -> one ambient line (priority 2), max once per day
"""

import re
from datetime import datetime, timedelta

from ..common import get_json, event, iso, now_utc, parse_when, BOOTSTRAP_HOURS, BTV_TZ

ID = "nws-weather"
NAME = "NWS Burlington"
POINT = "44.4759,-73.2121"
ALERTS_URL = f"https://api.weather.gov/alerts/active?point={POINT}"
FORECAST_URL = "https://api.weather.gov/gridpoints/BTV/89,56/forecast"
NWS_HEADERS = {"Accept": "application/geo+json"}

HEADS_UP = re.compile(
    r"thunderstorm|severe|snow|ice storm|freezing rain|damaging wind|wind gusts as high as [4-9]\d",
    re.I,
)


def snapshot():
    state = {"alerts": [], "forecast_flag": None}

    data = get_json(ALERTS_URL, headers=NWS_HEADERS)
    for f in data.get("features", []):
        p = f.get("properties", {})
        state["alerts"].append({
            "id": p.get("id") or f.get("id"),
            "event": p.get("event", "Weather alert"),
            "headline": p.get("headline", ""),
            "severity": p.get("severity", ""),
            "onset": p.get("onset") or p.get("effective"),
            "ends": p.get("ends") or p.get("expires"),
            "url": "https://forecast.weather.gov/MapClick.php?lat=44.4759&lon=-73.2121",
        })

    # Today's forecast heads-up: first period mentioning trouble, kept as a
    # day-scoped flag so it fires once when the wording first appears.
    try:
        fc = get_json(FORECAST_URL, headers=NWS_HEADERS)
        periods = fc.get("properties", {}).get("periods", [])[:2]  # today / tonight
        for p in periods:
            text = p.get("detailedForecast", "") or p.get("shortForecast", "")
            m = HEADS_UP.search(text)
            if m:
                # First sentence containing the match — readable, short
                for sent in re.split(r"(?<=\.)\s+", text):
                    if HEADS_UP.search(sent):
                        state["forecast_flag"] = {
                            "day": now_utc().astimezone(BTV_TZ).strftime("%Y-%m-%d"),
                            "text": f"{p.get('name', 'Today')}: {sent.rstrip('.')}",
                        }
                        break
                break
    except RuntimeError:
        pass  # alerts are the payload; the flag is a nice-to-have

    return state


def _alert_event(a, ts, verb, priority):
    label = a["headline"] or a["event"]
    return event(
        ts=ts, category="weather",
        headline=f"{a['event']} {verb}",
        detail=label if label != a["event"] else "",
        url=a["url"], source=ID, source_name=NAME,
        priority=priority, kind="status",
    )


def diff(prev, cur, bootstrap):
    now = now_utc()
    out = []

    # forecast fetch is best-effort: if it failed this run, carry the previous
    # flag forward (cur is stored as the new state) so recovery on the next
    # run doesn't re-announce unchanged forecast wording.
    if cur.get("forecast_flag") is None and prev is not None:
        cur["forecast_flag"] = prev.get("forecast_flag")

    prev_alerts = {} if prev is None else {a["id"]: a for a in prev.get("alerts", [])}
    cur_alerts = {a["id"]: a for a in cur.get("alerts", [])}

    for aid, a in cur_alerts.items():
        if aid in prev_alerts:
            continue
        onset = parse_when(a.get("onset"))
        if bootstrap and (onset is None or onset < now - timedelta(hours=BOOTSTRAP_HOURS)):
            continue
        stamp = onset if (onset and onset <= now) else now
        out.append(_alert_event(a, iso(stamp), "issued", 3))

    if not bootstrap:
        for aid, a in prev_alerts.items():
            if aid not in cur_alerts:
                ends = parse_when(a.get("ends"))
                stamp = ends if (ends and ends <= now) else now
                out.append(_alert_event(a, iso(stamp), "has ended", 2))

    flag = cur.get("forecast_flag")
    prev_flag = (prev or {}).get("forecast_flag")
    if flag and flag != prev_flag and not bootstrap:
        out.append(event(
            ts=iso(now), category="weather",
            headline=flag["text"],
            url="https://forecast.weather.gov/MapClick.php?lat=44.4759&lon=-73.2121",
            source=ID, source_name=NAME, priority=2, kind="changed",
        ))
    elif flag and bootstrap:
        # first run: surface today's heads-up so the page isn't weather-blind
        out.append(event(
            ts=iso(now), category="weather",
            headline=flag["text"],
            url="https://forecast.weather.gov/MapClick.php?lat=44.4759&lon=-73.2121",
            source=ID, source_name=NAME, priority=2, kind="changed",
        ))
    return out
