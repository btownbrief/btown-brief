#!/usr/bin/env python3
"""
Refresh data/weather/latest.json — the single data file behind the
"Burlington Right Now" dashboard (weather.html).

Sources (all keyless):
  - NWS api.weather.gov      current obs (KBTV), 7-day + hourly forecast,
                             apparent temperature grid, alerts, AFD text,
                             Lake Champlain recreational forecast (REC)
  - USGS waterservices       lake temp + level at Burlington (04294500)
  - AirNow (airnowgovapi)    observed AQI from the real Burlington monitor,
                             with Open-Meteo CAMS model as fallback
  - Open-Meteo               sunrise/sunset/UV + multi-model forecast spread
  - VT DOH / City of BTV     beach status (see fetch_beaches)

Design: every section fetches independently; on failure we KEEP the last
good section from the existing file (same contract as refresh-data.yml).
The site never sees a broken or missing file.

Run:  python3 scripts/refresh_weather.py
"""

import json
import os
import re
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

BTV_TZ = ZoneInfo("America/New_York")

LAT, LON = 44.4759, -73.2121
NWS_GRID = "BTV/89,56"            # from /points/44.4759,-73.2121 — static
USGS_SITE = "04294500"            # LAKE CHAMPLAIN AT BURLINGTON, VT
UA = "btownbrief.com weather dashboard (stephenvdavis@gmail.com)"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "weather", "latest.json")

now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read())


def fetch_json_retry(url, tries=3):
    """NWS intermittently 500s; retry a couple of times."""
    last = None
    for _ in range(tries):
        try:
            return fetch_json(url)
        except Exception as e:  # noqa: BLE001 — any failure warrants a retry
            last = e
    raise last


def c_to_f(c):
    return None if c is None else round(c * 9 / 5 + 32)


def kmh_to_mph(k):
    return None if k is None else round(k * 0.621371)


def first_not_none(*vals):
    """`a or b` treats a legitimate 0°F as missing — use explicit None checks."""
    for v in vals:
        if v is not None:
            return v
    return None


def deg_to_compass(deg):
    if deg is None:
        return None
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return dirs[int((deg / 22.5) + 0.5) % 16]


# ----------------------------------------------------------------------
# Section fetchers — each returns a dict or raises.
# ----------------------------------------------------------------------

def fetch_now():
    """Current conditions from the KBTV airport observation (metric → US)."""
    p = fetch_json_retry("https://api.weather.gov/stations/KBTV/observations/latest")["properties"]

    def v(key):
        f = p.get(key) or {}
        return f.get("value")

    temp_f = c_to_f(v("temperature"))
    # "feels like": heat index in summer, wind chill in winter, else the temp
    feels_f = first_not_none(c_to_f(v("heatIndex")), c_to_f(v("windChill")), temp_f)
    return {
        "observed_at": p.get("timestamp"),
        "station": "KBTV",
        "description": p.get("textDescription") or None,
        "temp_f": temp_f,
        "feels_like_f": feels_f,
        "humidity": round(v("relativeHumidity")) if v("relativeHumidity") is not None else None,
        "dewpoint_f": c_to_f(v("dewpoint")),
        "wind_mph": kmh_to_mph(v("windSpeed")),
        "wind_gust_mph": kmh_to_mph(v("windGust")),
        "wind_dir": deg_to_compass(v("windDirection")),
    }


def fetch_forecast():
    """7-day forecast periods (half-day granularity) — first 6 for the page."""
    data = fetch_json_retry(f"https://api.weather.gov/gridpoints/{NWS_GRID}/forecast")
    periods = []
    for per in data["properties"]["periods"][:6]:
        periods.append({
            "name": per["name"],
            "is_day": per["isDaytime"],
            "temp_f": per["temperature"],
            "pop": (per.get("probabilityOfPrecipitation") or {}).get("value") or 0,
            "wind": f'{per.get("windDirection", "")} {per.get("windSpeed", "")}'.strip(),
            "short": per["shortForecast"],
            "detailed": per["detailedForecast"],
        })
    return {"updated": data["properties"].get("updateTime"), "periods": periods}


def _expand_grid_values(values):
    """NWS grid values use ISO-interval validTime ('start/PT3H') — expand to
    an {hour_iso: value} map so hours can be joined against the hourly forecast."""
    out = {}
    for item in values:
        start_s, _, dur = item["validTime"].partition("/")
        start = datetime.fromisoformat(start_s)
        hours = 1
        m = re.match(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?)?", dur)
        if m:
            hours = (int(m.group(1) or 0)) * 24 + int(m.group(2) or 0) or 1
        for h in range(hours):
            ts = start.timestamp() + h * 3600
            key = datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="hours")
            out[key] = item["value"]
    return out


def fetch_hourly():
    """Next 36 hours, one row per hour. Joins the hourly forecast with the
    apparentTemperature + skyCover grid layers (the hourly endpoint has no
    feels-like). All the client-side life scores read from this array."""
    fc = fetch_json_retry(f"https://api.weather.gov/gridpoints/{NWS_GRID}/forecast/hourly")
    grid = fetch_json_retry(f"https://api.weather.gov/gridpoints/{NWS_GRID}")
    feels = _expand_grid_values(grid["properties"]["apparentTemperature"]["values"])
    sky = _expand_grid_values(grid["properties"]["skyCover"]["values"])

    hours = []
    for per in fc["properties"]["periods"][:36]:
        start = datetime.fromisoformat(per["startTime"])
        key = start.astimezone(timezone.utc).isoformat(timespec="hours")
        # windSpeed can be a range ("10 to 20 mph") — take the max
        nums = re.findall(r"\d+", per.get("windSpeed") or "")
        wind_mph = max(int(n) for n in nums) if nums else None
        hours.append({
            "t": per["startTime"],
            "temp_f": per["temperature"],
            "feels_f": first_not_none(c_to_f(feels.get(key)), per["temperature"]),
            "pop": (per.get("probabilityOfPrecipitation") or {}).get("value") or 0,
            "humidity": (per.get("relativeHumidity") or {}).get("value"),
            "wind_mph": wind_mph,
            "wind_dir": per.get("windDirection"),
            "sky": sky.get(key),
            "short": per["shortForecast"],
        })
    return {"updated": fc["properties"].get("updateTime"), "hours": hours}


def fetch_alerts():
    data = fetch_json_retry(f"https://api.weather.gov/alerts/active?point={LAT},{LON}")
    alerts = []
    for f in data.get("features", []):
        p = f["properties"]
        alerts.append({
            "event": p.get("event"),
            "headline": p.get("headline"),
            "severity": p.get("severity"),
            "expires": p.get("expires"),
        })
    return {"active": alerts}


def fetch_afd():
    """Area Forecast Discussion — the forecaster's own reasoning. We keep the
    KEY MESSAGES bullets (plain-language) and the raw text for the daily read."""
    listing = fetch_json_retry("https://api.weather.gov/products/types/AFD/locations/BTV")
    latest = listing["@graph"][0]
    prod = fetch_json_retry(latest["@id"])
    text = prod["productText"]

    def section(name):
        m = re.search(rf"^\.{name}\.\.\.\s*(.*?)(?=^&&$)", text, re.M | re.S)
        return m.group(1).strip() if m else None

    key_msgs = []
    km = section("KEY MESSAGES")
    if km:
        # bullets look like "1. Sentence wrapped\nacross lines." — rejoin them
        for m in re.finditer(r"^\d+\.\s*(.*?)(?=^\d+\.|\Z)", km, re.M | re.S):
            key_msgs.append(re.sub(r"\s+", " ", m.group(1)).strip())
    return {
        "issued": prod.get("issuanceTime"),
        "key_messages": key_msgs,
        "what_changed": re.sub(r"\s+", " ", section("WHAT HAS CHANGED") or "").strip() or None,
        "raw": text,
    }


def parse_rec_periods(block):
    """Parse '.TONIGHT...North winds 5 to 10 knots. Clear. Waves 1 to 2 feet.'
    period lines out of one REC zone block. Phrasing varies — keep it tolerant
    and always carry the raw text through."""
    periods = []
    for m in re.finditer(r"^\.([A-Z .]+)\.\.\.(.*?)(?=^\.[A-Z .]+\.\.\.|\Z)", block, re.M | re.S):
        name = m.group(1).strip().title()
        body = re.sub(r"\s+", " ", m.group(2)).strip()
        knots_hi = None
        km = re.search(r"winds?[^.]*?(\d+)(?:\s+to\s+(\d+))?\s+knots", body, re.I)
        if km:
            knots_hi = int(km.group(2) or km.group(1))
        gust = re.search(r"[Gg]usts up to (\d+) knots", body)
        waves_hi = None
        wm = re.search(r"Waves (\d+)(?:\s+to\s+(\d+))? f(?:ee|oo)t", body)
        if wm:
            waves_hi = int(wm.group(2) or wm.group(1))
        periods.append({
            "period": name,
            "text": body,
            "wind_knots_max": knots_hi,
            "gust_knots": int(gust.group(1)) if gust else None,
            "waves_ft_max": waves_hi,
            "calm": bool(re.search(r"[Ll]ight and variable", body)),
        })
    return periods


def fetch_lake_forecast():
    """NWS Lake Champlain Recreational Forecast (product REC, ~2x daily
    Apr–Dec). Broad Waters is the section that matters for Burlington's
    waterfront. Off-season the product simply stops being issued — the
    client treats a stale issuance (>24h) as 'suspended for the season'."""
    listing = fetch_json_retry("https://api.weather.gov/products/types/REC/locations/BTV")
    graph = listing.get("@graph") or []
    if not graph:
        return {"issued": None, "suspended": True}
    prod = fetch_json_retry(graph[0]["@id"])
    # The listing can retain the season's last product for a while after
    # issuance stops — a REC older than 36h means the product is suspended,
    # and its winds/waves must not keep feeding the swim score all winter.
    issued = prod.get("issuanceTime")
    if issued:
        age_h = (datetime.now(timezone.utc)
                 - datetime.fromisoformat(issued)).total_seconds() / 3600
        if age_h > 36:
            return {"issued": issued, "suspended": True}
    text = prod["productText"]
    zones = {}
    for m in re.finditer(
        r"^\.The Forecast for the (\w+) Waters of Lake Champlain,.*?\n(.*?)(?=^&&$)",
        text, re.M | re.S,
    ):
        zones[m.group(1).lower()] = parse_rec_periods(m.group(2))
    uv = re.search(r"ultraviolet index for (\w+) will be a (\d+)", text)
    gages = {}
    for m in re.finditer(r"USGS gage at ([\w ]+?)\s{2,}([\d.]+) feet\s+(\d+) degrees", text):
        gages[m.group(1).strip()] = {"level_ft": float(m.group(2)), "temp_f": int(m.group(3))}
    return {
        "issued": prod.get("issuanceTime"),
        "suspended": False,
        "broad": zones.get("broad", []),
        "northern": zones.get("northern", []),
        "southern": zones.get("southern", []),
        "uv": {"day": uv.group(1), "index": int(uv.group(2))} if uv else None,
        "gage_table": gages,
    }


def fetch_usgs():
    """Lake temp + level at the Burlington gage, 15-minute data."""
    url = (f"https://waterservices.usgs.gov/nwis/iv/?format=json&sites={USGS_SITE}"
           "&parameterCd=00010,62614&siteStatus=all")
    data = fetch_json(url)
    out = {}
    for series in data["value"]["timeSeries"]:
        code = series["variable"]["variableCode"][0]["value"]
        vals = series["values"][0]["value"]
        if not vals:
            continue
        latest = vals[-1]
        if code == "00010":
            out["water_temp_f"] = round(float(latest["value"]) * 9 / 5 + 32)
            out["water_temp_at"] = latest["dateTime"]
        elif code == "62614":
            lvl = float(latest["value"])
            out["level_ft"] = lvl
            out["level_at"] = latest["dateTime"]
            # NWS flood stage at Burlington is 100.0 ft (NGVD29);
            # typical summer pool runs ~95–96 ft.
            out["level_status"] = ("flood" if lvl >= 100 else
                                   "elevated" if lvl >= 99 else "normal")
    # Require BOTH series: a partial response must not replace the previous
    # complete section (the keep-last-good contract works per section).
    if "water_temp_f" not in out or "level_ft" not in out:
        raise ValueError(f"USGS incomplete: got {sorted(out)}")
    return out


def fetch_air_quality():
    """Observed AQI from the Burlington monitor (VT DEC via AirNow's keyless
    reporting-area endpoint). Falls back to Open-Meteo's CAMS model if the
    undocumented endpoint breaks or has no fresh observation."""
    try:
        url = ("https://airnowgovapi.com/reportingarea/get?"
               f"latitude={LAT}&longitude={LON}&stateCode=VT&maxDistance=50")
        records = fetch_json(url)
        obs = [r for r in records if r.get("dataType") == "O"
               and isinstance(r.get("aqi"), (int, float))]
        primary = next((r for r in obs if r.get("isPrimary")), obs[0] if obs else None)
        if primary:
            fc = [r for r in records if r.get("dataType") == "F" and r.get("isPrimary")]
            discussion = next((r.get("discussion") for r in fc if r.get("discussion")), None)
            return {
                "source": "AirNow (Burlington monitor)",
                "aqi": primary.get("aqi"),
                "category": primary.get("category"),
                "pollutant": primary.get("parameter"),
                "observed": f'{primary.get("validDate", "")} {primary.get("time", "")}'.strip(),
                "discussion": discussion,
            }
    except Exception as e:  # noqa: BLE001 — fall through to the model
        print(f"airnow failed, falling back to open-meteo: {e}", file=sys.stderr)

    om = fetch_json(
        "https://air-quality-api.open-meteo.com/v1/air-quality?"
        f"latitude={LAT}&longitude={LON}&current=us_aqi,pm2_5&timezone=America%2FNew_York"
    )
    cur = om.get("current", {})
    aqi = cur.get("us_aqi")
    category = ("Good" if aqi <= 50 else "Moderate" if aqi <= 100 else
                "Unhealthy for Sensitive Groups" if aqi <= 150 else
                "Unhealthy" if aqi <= 200 else "Very Unhealthy" if aqi <= 300
                else "Hazardous") if aqi is not None else None
    return {"source": "Open-Meteo model (fallback)", "aqi": aqi,
            "category": category, "pollutant": "PM2.5",
            "observed": cur.get("time"), "discussion": None}


def fetch_sun():
    """Sunrise/sunset (today + tomorrow) and daily UV — same Open-Meteo feed
    the site's sun.js already uses, captured here so scores and the daily
    read work server-side too."""
    data = fetch_json(
        "https://api.open-meteo.com/v1/forecast?"
        f"latitude={LAT}&longitude={LON}"
        "&daily=sunrise,sunset,uv_index_max&timezone=America%2FNew_York"
        "&timeformat=unixtime&forecast_days=2"
    )
    d = data["daily"]

    # Serialize with the Burlington UTC offset — Open-Meteo's default local
    # strings are naive, and a naive string parsed by a browser in another
    # timezone shifts every sunset calculation.
    def iso(ts):
        return datetime.fromtimestamp(ts, BTV_TZ).isoformat(timespec="minutes")

    return {
        "sunrise": iso(d["sunrise"][0]), "sunset": iso(d["sunset"][0]),
        "sunrise_tomorrow": iso(d["sunrise"][1]), "sunset_tomorrow": iso(d["sunset"][1]),
        "uv_max": d.get("uv_index_max", [None])[0],
    }


def fetch_models():
    """Model spread for the next 3 days (GFS vs ECMWF vs ICON via Open-Meteo).
    This is the quantitative 'where forecasts diverge' input for the daily
    read: when the models agree the NWS number is safe to state plainly;
    when they don't, that IS the story."""
    models = "gfs_seamless,ecmwf_ifs025,icon_seamless"
    data = fetch_json(
        "https://api.open-meteo.com/v1/forecast?"
        f"latitude={LAT}&longitude={LON}"
        "&daily=temperature_2m_max,precipitation_probability_max,precipitation_sum"
        f"&models={models}&timezone=America%2FNew_York"
        "&temperature_unit=fahrenheit&forecast_days=3"
    )
    d = data["daily"]
    days = []
    label = {"gfs_seamless": "GFS", "ecmwf_ifs025": "Euro", "icon_seamless": "ICON"}
    for i, date in enumerate(d["time"]):
        row = {"date": date, "high_f": {}, "pop_max": {}, "precip_in": {}}
        for mk, name in label.items():
            hi = d.get(f"temperature_2m_max_{mk}", [None] * 3)[i]
            pop = d.get(f"precipitation_probability_max_{mk}", [None] * 3)[i]
            pr = d.get(f"precipitation_sum_{mk}", [None] * 3)[i]
            if hi is not None:
                row["high_f"][name] = round(hi)
            if pop is not None:
                row["pop_max"][name] = pop
            if pr is not None:
                row["precip_in"][name] = round(pr / 25.4, 2)  # mm → in
        highs = list(row["high_f"].values())
        row["high_spread_f"] = (max(highs) - min(highs)) if len(highs) > 1 else 0
        days.append(row)
    return {"days": days}


# ----------------------------------------------------------------------
# Beaches — written to its own file (data/weather/beaches.json) since it
# has its own seasonal semantics and the newsletter reads it separately.
# ----------------------------------------------------------------------

BEACHES_OUT = os.path.join(os.path.dirname(__file__), "..", "data", "weather", "beaches.json")

# City ArcGIS rows → the five dashboard beaches. N/S sample pairs collapse
# to worst-of (a closed half closes the beach).
BEACH_MAP = {
    "North Beach": ["North Beach North", "North Beach South"],
    "Leddy Park": ["Leddy Beach North", "Leddy Beach South"],
    "Blanchard Beach": ["Blanchard Beach North", "Blanchard Beach South"],
    "Texaco Beach": ["Texaco Beach"],
    "Oakledge Cove": ["Oakledge Cove"],
}
# Aggregation order: a known closure must always win, and a missing/stale
# sample can't vouch for the beach — but it also shouldn't mask an alert.
STATUS_RANK = {"green": 0, "unknown": 1, "yellow": 2, "red": 3}


def fetch_beaches():
    """City of Burlington beach status — the same ArcGIS service behind
    burlingtonvt.gov/1219/Beach-Closure-Tracker. CyanobacteriaDescription
    is the status field (Open/Alert/Closed); Closed also fires on
    E. coli > 235 MPN/100mL (sampled Mon+Thu, posted by 11 AM Tue/Fri;
    cyanobacteria checked daily in season, posted by noon).
    Off-season the rows go stale — anything older than ~3 days reads
    'unknown' so last summer's green never shows in November."""
    url = ("https://maps.burlingtonvt.gov/arcgis/rest/services/BTV_Beach_Status/"
           "MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json")
    data = fetch_json(url)
    rows = {}
    for feat in data.get("features", []):
        a = feat.get("attributes", {})
        name = a.get("LocationName")
        if name:
            rows[name] = a

    def to_status(a):
        if not a:
            return "unknown", None, None, None
        desc = (a.get("CyanobacteriaDescription") or "").strip().lower()
        status = {"open": "green", "alert": "yellow", "closed": "red"}.get(desc, "unknown")
        sampled = a.get("ResultDateTime")
        if sampled:
            try:
                dt = datetime.strptime(sampled, "%m/%d/%Y %I:%M %p").replace(tzinfo=BTV_TZ)
                age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
                if age_h > 72:
                    status = "unknown"
            except ValueError:
                pass
        ecoli = a.get("EColi")
        reason = a.get("StatusReason") or None
        return status, reason, ecoli, sampled

    beaches = []
    for name, sites in BEACH_MAP.items():
        # every expected sample site counts — a missing row is "unknown",
        # never silently dropped in favor of its greener neighbor
        candidates = [to_status(rows.get(s)) for s in sites]
        worst = max(candidates, key=lambda c: STATUS_RANK[c[0]])
        status, reason, ecoli, sampled = worst
        if status == "red":
            reason = reason or "Posted advisory — stay out"
        elif status == "yellow":
            reason = "Cyanobacteria alert — keep kids and dogs out"
        elif status == "green":
            reason = "Open — tested clean"
            if ecoli:
                reason = f"Open (E. coli {ecoli} MPN, under the 235 limit)"
        beaches.append({
            "name": name,
            "status": status,
            "reason": reason,
            "ecoli": ecoli or None,
            "sampled": sampled,
        })

    return {
        "updated": now_iso,
        "source": "City of Burlington beach tracker (burlingtonvt.gov/1219)",
        "note": "E. coli sampled Mon + Thu, posted by 11 AM Tue/Fri; "
                "cyanobacteria checked daily in season. Closed = advisory or E. coli over 235.",
        "beaches": beaches,
    }


# ----------------------------------------------------------------------
# Assemble, preserving last good sections on per-source failure.
# ----------------------------------------------------------------------

SECTIONS = {
    "now": fetch_now,
    "forecast": fetch_forecast,
    "hourly": fetch_hourly,
    "alerts": fetch_alerts,
    "afd": fetch_afd,
    "lake_forecast": fetch_lake_forecast,
    "lake_gage": fetch_usgs,
    "air": fetch_air_quality,
    "sun": fetch_sun,
    "models": fetch_models,
}


def main():
    previous = {}
    if os.path.exists(OUT):
        try:
            with open(OUT) as f:
                previous = json.load(f)
        except Exception:
            previous = {}

    out = {"updated": now_iso, "sections_updated": dict(previous.get("sections_updated", {}))}
    failures = []
    for name, fn in SECTIONS.items():
        try:
            out[name] = fn()
            out["sections_updated"][name] = now_iso
            print(f"{name}: ok")
        except Exception as e:  # noqa: BLE001 — keep last good section, keep going
            failures.append(name)
            if name in previous:
                out[name] = previous[name]
                print(f"{name}: FAILED ({e}) — kept last good data", file=sys.stderr)
            else:
                out[name] = None
                print(f"{name}: FAILED ({e}) — no previous data", file=sys.stderr)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"wrote {os.path.relpath(OUT)} ({len(SECTIONS) - len(failures)}/{len(SECTIONS)} sections fresh)")

    # beaches.json — separate file, same keep-last-good contract
    try:
        beaches = fetch_beaches()
        with open(BEACHES_OUT, "w") as f:
            json.dump(beaches, f, indent=1, ensure_ascii=False)
        print("beaches: ok")
    except Exception as e:  # noqa: BLE001
        print(f"beaches: FAILED ({e}) — kept last good file", file=sys.stderr)

    # Never fail the workflow outright unless *everything* broke.
    if len(failures) == len(SECTIONS):
        sys.exit(1)


if __name__ == "__main__":
    main()
