#!/usr/bin/env python3
"""
The plain-words weather brief: two or three sentences about today, tonight
and tomorrow in Burlington, written by rules from the NWS data that
refresh_weather.py has just fetched. No model, no API key, no cost.

Stephen, 2026-10-19: "a text brief about today's weather … just focus on
what matters: weather in Burlington area. When and how much. Temps."

Every number comes from the payload:
  - highs and lows are the NWS forecast periods' own numbers (the same ones
    the week rows show), never a min/max of the hourly temperatures, which
    can disagree with them by a degree or two;
  - rain or snow timing is the run of hours whose NWS chance of
    precipitation clears a bar (see `_timing_bar`), in Burlington's clock;
  - amounts are the NWS grid's quantitative precipitation and snowfall,
    summed over the period;
  - wind is said only when a person on foot or a bike would notice it
    (sustained 20 mph or gusts of 30), in mph.

refresh_weather.py writes the result to latest.json as `brief`:

  {"date": "2026-10-19",            Burlington date it was written for
   "generated": ISO-8601 UTC,
   "text": "Sunny today, high 62. Mostly clear tonight, low 42. …",
   "periods": [                     today/tonight (or tonight/tomorrow)
     {"label": "Today", "name": "Today", "is_day": true, "temp_f": 62,
      "sky": "sunny", "start": ISO, "end": ISO,
      "precip": null | {"kind": "rain", "chance": 70, "say": "rain likely",
                        "start": ISO|null, "end": ISO|null, "when": "from 2 to 8pm",
                        "amount_in": 0.4, "snow_in": 0.0, "amount": "about 0.4 inch"},
      "wind": null | {"mph": 22, "gust_mph": 35},
      "feels_lo": 39, "feels_hi": 60, "text": "Sunny today, high 62."}]}

The weather page (js/life.js) and All Day's What Now card read it; both
hide it when it is more than a few hours old.

Run:  python3 scripts/weather_brief.py   (prints the brief for the
      committed data/weather/latest.json)
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BTV_TZ = ZoneInfo("America/New_York")
HOUR = timedelta(hours=1)

WIND_MPH = 20       # sustained wind a walker or rider notices
GUST_MPH = 30       # gusts that push a bike around


def _dt(iso):
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _local(d):
    return d.astimezone(BTV_TZ)


def clock(d):
    """2pm, 11am, noon, midnight: Burlington's clock, minutes when not :00."""
    t = _local(d)
    if t.minute == 0 and t.hour == 0:
        return "midnight"
    if t.minute == 0 and t.hour == 12:
        return "noon"
    h = t.hour % 12 or 12
    return f"{h}{':%02d' % t.minute if t.minute else ''}{'am' if t.hour < 12 else 'pm'}"


def _span(a, b):
    """'from 2 to 8pm', 'from 10am to 3pm', 'from 9pm to 2am'."""
    ca, cb = clock(a), clock(b)
    same_half = ca[-2:] == cb[-2:] and ca[-2:] in ("am", "pm") and (b - a) < timedelta(hours=12)
    if same_half:
        ca = ca[:-2]
    return f"from {ca} to {cb}"


# ---------------------------------------------------------------- the words

PRECIP_WORDS = (
    # (pattern on the NWS wording, what we call it), first match wins
    (r"thunder|t-storm", "thunderstorms"),
    (r"freezing rain|freezing drizzle|sleet|ice pellets|wintry", "a wintry mix"),
    (r"snow|flurr", "snow"),
    (r"shower", "showers"),
    (r"drizzle", "drizzle"),
    (r"rain", "rain"),
)


def precip_kind(texts):
    """What is falling, from the NWS short-forecast words of the wet hours.
    Rain and snow in the same stretch is 'rain and snow'."""
    found = []
    for t in texts:
        low = (t or "").lower()
        for pat, word in PRECIP_WORDS:
            if re.search(pat, low):
                if word not in found:
                    found.append(word)
                break
    if not found:
        return "rain"
    if "thunderstorms" in found:
        return "thunderstorms"
    if "a wintry mix" in found:
        return "a wintry mix"
    if "snow" in found and len(found) > 1:
        return "rain and snow"
    return found[0]


def likelihood(kind, chance):
    """NWS's own ladder: 30-50% 'chance', 60-70% 'likely', 80%+ said flat."""
    if chance >= 75:
        return kind
    if chance >= 55:
        return f"{kind} likely"
    return f"a chance of {kind}"


def tenths(x):
    """Half up to a tenth, the way js/life.js rounds the week rows (Python's
    round() goes to even: 0.25 would be 0.2 here and 0.3 there)."""
    return int(x * 10 + 0.5 + 1e-9) / 10


def amount_words(rain_in, snow_in):
    """'about 0.4 inch', 'about 2 inches of snow', 'under a tenth of an inch'."""
    if snow_in is not None and snow_in >= 0.5:
        if snow_in < 0.75:
            return "under an inch of snow"
        n = int(snow_in + 0.5 + 1e-9)       # half up, as the page's JS rounds
        return "about an inch of snow" if n == 1 else f"about {n} inches of snow"
    if rain_in is None:
        return ""
    if rain_in < 0.05:
        return "under a tenth of an inch"
    if rain_in < 0.15:
        return "about a tenth of an inch"
    r = tenths(rain_in)
    return f"about {r:g} inch" if r <= 1 else f"about {r:g} inches"


def _runs(rows):
    """Consecutive hours, as [(first row, last row), …]."""
    runs = []
    for h in rows:
        t = _dt(h["t"])
        if runs and t - _dt(runs[-1][1]["t"]) <= HOUR:
            runs[-1][1] = h
        else:
            runs.append([h, h])
    return runs


SKY_DRY = re.compile(r"\b(slight chance|chance|likely|isolated|scattered|showers?|rain|snow|drizzle|"
                     r"flurries|sleet|thunderstorms?|t-storms?|freezing|wintry)\b", re.I)


def sky_words(short, is_day):
    """The NWS short forecast's sky part, lower case: 'Mostly Sunny then
    Slight Chance Rain Showers' → 'mostly sunny'. Falls back to the plain
    'sunny'/'clear' only if NWS gave no sky words at all."""
    parts = [p.strip() for p in re.split(r"\bthen\b", short or "", flags=re.I) if p.strip()]
    sky = [p for p in parts if not SKY_DRY.search(p)]
    if sky:
        # 'Patchy Frost' and 'Areas Of Fog' are sky words too, and worth keeping
        return " then ".join(dict.fromkeys(s.lower() for s in sky))
    return "sunny" if is_day else "clear"


def _wind_max(text):
    nums = [int(n) for n in re.findall(r"\d+", text or "")]
    return max(nums) if nums else None


# --------------------------------------------------------------- periods

def _label(period, today, current=False):
    start = _local(_dt(period["start"]))
    if period.get("is_day"):
        return "Today" if start.date() == today else start.strftime("%A")
    if start.date() == today:
        return "Overnight" if start.hour < 6 else "Tonight"
    if current:
        # last evening's night period, still running after midnight (the
        # forecast was issued before NWS renamed it "Overnight")
        return "Overnight"
    return start.strftime("%A") + " night"


def _phrase_label(label):
    return {"Today": "today", "Tonight": "tonight", "Overnight": "overnight"}.get(label, label)


def analyse(period, end, hours, now, today):
    """One forecast period, read against the hourly rows it covers."""
    start = _dt(period["start"])
    eff_start = max(start, now.replace(minute=0, second=0, microsecond=0))
    rows = [h for h in hours if _dt(h.get("t")) and eff_start <= _dt(h["t"]) < end]
    covered = bool(rows) and _dt(rows[-1]["t"]) + HOUR >= end and _dt(rows[0]["t"]) <= eff_start
    label = _label(period, today, current=start <= now < end)
    out = {
        "label": label,
        "name": period.get("name"),
        "is_day": bool(period.get("is_day")),
        "temp_f": period.get("temp_f"),
        "sky": sky_words(period.get("short"), period.get("is_day")),
        "start": eff_start.isoformat(),
        "end": end.isoformat(),
        "precip": None,
        "wind": None,
        "feels_lo": None,
        "feels_hi": None,
    }

    feels = [h.get("feels_f") for h in rows if h.get("feels_f") is not None]
    if feels:
        out["feels_lo"], out["feels_hi"] = min(feels), max(feels)

    # rain or snow: the hourly chances when we have them, else the period's
    pops = [h.get("pop") or 0 for h in rows]
    chance = max(pops) if pops else (period.get("pop") or 0)
    if not covered:
        chance = max(chance, period.get("pop") or 0)
    if chance >= 25:
        bar = 50 if chance >= 60 else 25
        wet = [h for h in rows if (h.get("pop") or 0) >= bar]
        kind = precip_kind([h.get("short") for h in wet] or [period.get("short")])
        rain = sum(h.get("qpf_in") or 0 for h in rows) if rows and any("qpf_in" in h for h in rows) else None
        snow = sum(h.get("snow_in") or 0 for h in rows) if rows and any("snow_in" in h for h in rows) else None
        p = {"kind": kind, "chance": int(round(chance / 10.0) * 10), "say": likelihood(kind, chance),
             "start": None, "end": None, "when": "",
             "amount_in": round(rain, 2) if rain is not None and covered else None,
             "snow_in": round(snow, 1) if snow is not None and covered else None, "amount": ""}
        if covered and wet:
            a, b = _dt(wet[0]["t"]), _dt(wet[-1]["t"]) + HOUR
            p["start"], p["end"] = a.isoformat(), b.isoformat()
            from_start = a <= eff_start
            to_end = b >= end
            # two or more separate wet stretches are "on and off" across
            # them, never one long run that the gaps would contradict
            gappy = len(_runs(wet)) > 1
            lead = "on and off " if gappy else ""
            if from_start and to_end:
                p["when"] = "on and off" if gappy else ""   # the whole period: the label says when
            elif from_start:
                p["when"] = f"{lead}until {clock(b)}"
            elif to_end:
                p["when"] = f"{lead}from {clock(a)} on"
            else:
                p["when"] = lead + _span(a, b)
        if covered:
            p["amount"] = amount_words(rain, snow)
        out["precip"] = p

    # wind, only when it matters on foot or on a bike
    if covered:
        mph = max((h.get("wind_mph") or 0 for h in rows), default=0)
        gust = max((h.get("gust_mph") or 0 for h in rows), default=0)
    else:
        mph = _wind_max(period.get("wind")) or 0
        g = re.search(r"gusts? as high as (\d+) mph", period.get("detailed") or "", re.I)
        gust = int(g.group(1)) if g else 0
    if mph >= WIND_MPH or gust >= GUST_MPH:
        out["wind"] = {"mph": mph, "gust_mph": gust or None}
    return out


def sentence(p, lead_day=False, compare=None):
    """'Sunny today, high 62.' / 'Rain likely tonight from 9pm on, about
    0.3 inch, low 40.' / 'Tuesday, mostly sunny and cooler, high 56.'"""
    word = _phrase_label(p["label"])
    bits = []
    pr = p["precip"]
    what = pr["say"] if pr else p["sky"]
    if compare is not None and p["is_day"] and p["temp_f"] is not None:
        if p["temp_f"] - compare >= 5:
            what += " and warmer"
        elif compare - p["temp_f"] >= 5:
            what += " and cooler"
    if lead_day:
        head = f"{word}, {what}"
    else:
        head = f"{what} {word}"
    if pr and pr["when"]:
        head += " " + pr["when"]
    bits.append(head)
    if pr and pr["amount"]:
        bits.append(pr["amount"])
    w = p["wind"]
    if w:
        bits.append(f"windy with gusts to {w['gust_mph']} mph" if w.get("gust_mph") and w["gust_mph"] >= GUST_MPH
                    else f"windy, up to {w['mph']} mph")
    if p["temp_f"] is not None:
        bits.append(("high " if p["is_day"] else "low ") + str(p["temp_f"]))
    s = ", ".join(bits) + "."
    return s[0].upper() + s[1:]


def build(d, now=None):
    """The brief for payload `d` (latest.json's shape), or None when the
    forecast is missing."""
    now = now or datetime.now(timezone.utc)
    today = _local(now).date()
    periods = [p for p in ((d.get("forecast") or {}).get("periods") or []) if p and _dt(p.get("start"))]
    hours = ((d.get("hourly") or {}).get("hours")) or []
    # drop a period that has already ended (the file is a few hours old)
    while len(periods) > 1 and _dt(periods[1]["start"]) <= now:
        periods = periods[1:]
    # a forecast that has run out (kept from an old run) says nothing
    if not periods or (len(periods) == 1 and _dt(periods[0]["start"]) + timedelta(hours=12) <= now):
        return None

    def end_of(i):
        return _dt(periods[i + 1]["start"]) if i + 1 < len(periods) else _dt(periods[i]["start"]) + timedelta(hours=12)

    picked = [analyse(periods[i], end_of(i), hours, now, today) for i in range(min(3, len(periods)))]
    # Morning or afternoon: today, tonight, tomorrow. Evening or overnight:
    # tonight and tomorrow, and tomorrow night only when it is wet.
    if not picked[0]["is_day"] and len(picked) == 3 and not picked[2]["precip"]:
        picked = picked[:2]

    texts = []
    alerts = [a for a in ((d.get("alerts") or {}).get("active") or [])
              if a and a.get("event") and (not _dt(a.get("expires")) or _dt(a["expires"]) > now)]
    if alerts:
        a = alerts[0]
        exp = _dt(a.get("expires"))
        until = ""
        if exp:
            day = "" if _local(exp).date() == today else " " + _local(exp).strftime("%A")
            until = f" until {clock(exp)}{day}"
        texts.append(f"{a['event']}{until}.")
        picked_for_text = picked[:2]
    else:
        picked_for_text = picked

    prev_high = None
    for i, p in enumerate(picked_for_text):
        tomorrow_lead = p["is_day"] and p["label"] != "Today"
        p["text"] = sentence(p, lead_day=tomorrow_lead, compare=prev_high if tomorrow_lead else None)
        texts.append(p["text"])
        if p["is_day"]:
            prev_high = p["temp_f"]
    for p in picked:
        p.setdefault("text", sentence(p, lead_day=p["is_day"] and p["label"] != "Today"))

    return {
        "date": today.isoformat(),
        "generated": now.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "text": " ".join(texts),
        "periods": picked[:2],
    }


if __name__ == "__main__":
    path = os.path.join(os.path.dirname(__file__), "..", "data", "weather", "latest.json")
    with open(path) as f:
        data = json.load(f)
    print(json.dumps(build(data), indent=1))
