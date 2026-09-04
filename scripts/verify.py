#!/usr/bin/env python3
"""
Forecast verification — "who called it".

Two jobs, same file:

  snapshot(out, fresh)  Called by refresh_weather.py after every run. Appends
                        one compact line to data/weather/verify/YYYY-MM-DD.jsonl
                        with the KBTV observation and what NWS and Google said
                        for every upcoming hour. Files older than KEEP_DAYS are
                        pruned, so the store is a rolling window, not an
                        archive — Google's terms for long-term storage of its
                        forecast are unconfirmed, and scores are what we keep.

  main()                Scores every snapshot whose target hours have since
                        been observed, bucketed by lead time, and writes
                        data/weather/verification.json (trailing WINDOW_DAYS).
                        Temperature: mean absolute error and bias. Rain:
                        Brier score of the stated probability against whether
                        the airport reported measurable precipitation in that
                        hour. Truth is ALWAYS the NWS airport observation —
                        never Google's history endpoint, which would score
                        Google against itself.

This is private for now: nothing on the page reads verification.json until
the sample is a season deep. The weather brain reads the trailing scores
through draft_read.py so the read can say who has had the better handle
lately, and that is all it is used for yet.

Run:  python3 scripts/verify.py
"""

import glob
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
VERIFY_DIR = os.path.join(HERE, "..", "data", "weather", "verify")
OUT = os.path.join(HERE, "..", "data", "weather", "verification.json")

KEEP_DAYS = 8          # snapshot files kept (longest scored lead is 30 h)
WINDOW_DAYS = 30       # scores are trailing this many days
BUCKETS = [("1-3h", 1, 3), ("4-12h", 4, 12), ("13-30h", 13, 30)]
RAIN_WORDS = re.compile(r"rain|shower|drizzle|thunder|snow|sleet|ice pellets|hail", re.I)
SOURCES = ("nws", "google")


def _hour_key(iso):
    """ISO timestamp → epoch hour (int) in UTC. None if unparseable."""
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() // 3600)


def _rows(hours, with_qpf=False):
    out = []
    for h in hours or []:
        k = _hour_key(h.get("t"))
        if k is None or h.get("temp_f") is None:
            continue
        row = [k, h["temp_f"], h.get("pop") or 0]
        if with_qpf:
            row.append(h.get("qpf_in") or 0)
        out.append(row)
    return out


def snapshot(out, fresh):
    """Append this run's forecasts + observation to today's snapshot file."""
    now = out.get("now") or {}
    line = {"run": out.get("updated")}
    if "now" in fresh and now.get("observed_at"):
        line["obs"] = {
            "t": now["observed_at"],
            "temp_f": now.get("temp_f"),
            "desc": now.get("description"),
            "precip_in": now.get("precip_last_hr_in"),
        }
    if "hourly" in fresh and (out.get("hourly") or {}).get("hours"):
        line["nws"] = {"issued": out["hourly"].get("updated"),
                       "hours": _rows(out["hourly"]["hours"])}
    if "google" in fresh and (out.get("google") or {}).get("hours"):
        line["google"] = {"fetched": out["google"].get("fetched_at"),
                          "hours": _rows(out["google"]["hours"], with_qpf=True)}
    if len(line) == 1:
        return
    os.makedirs(VERIFY_DIR, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(os.path.join(VERIFY_DIR, f"{day}.jsonl"), "a") as f:
        f.write(json.dumps(line, separators=(",", ":")) + "\n")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    for path in glob.glob(os.path.join(VERIFY_DIR, "*.jsonl")):
        if os.path.basename(path)[:10] < cutoff:
            os.remove(path)


def _load_lines():
    lines = []
    for path in sorted(glob.glob(os.path.join(VERIFY_DIR, "*.jsonl"))):
        with open(path) as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    lines.append(json.loads(raw))
                except ValueError:
                    continue
    return lines


def _observations(lines):
    """epoch hour → {temp_f, rain(bool)} from the airport, latest obs per hour wins."""
    obs = {}
    for ln in lines:
        o = ln.get("obs")
        if not o or o.get("temp_f") is None:
            continue
        k = _hour_key(o.get("t"))
        if k is None:
            continue
        rain = bool(o.get("precip_in")) or bool(RAIN_WORDS.search(o.get("desc") or ""))
        prev = obs.get(k)
        # keep the latest observation stamp inside the hour
        if prev is None or (o.get("t") or "") >= prev["t"]:
            obs[k] = {"t": o.get("t"), "temp_f": o["temp_f"], "rain": rain}
    return obs


def _bucket(lead_h):
    for name, lo, hi in BUCKETS:
        if lo <= lead_h <= hi:
            return name
    return None


def score(lines, now=None):
    now = now or datetime.now(timezone.utc)
    obs = _observations(lines)
    window_start = int((now - timedelta(days=WINDOW_DAYS)).timestamp() // 3600)
    acc = {s: {b[0]: {"n": 0, "abs": 0.0, "bias": 0.0, "brier": 0.0, "rain_hours": 0}
               for b in BUCKETS} for s in SOURCES}
    seen = set()   # (source, run_hour, target_hour) — one score per forecast per run
    days = set()
    for ln in lines:
        run_k = _hour_key(ln.get("run"))
        if run_k is None or run_k < window_start:
            continue
        for src in SOURCES:
            block = ln.get(src)
            if not block:
                continue
            for row in block.get("hours") or []:
                target, temp, pop = row[0], row[1], row[2]
                lead = target - run_k
                b = _bucket(lead)
                o = obs.get(target)
                if b is None or o is None:
                    continue
                key = (src, run_k, target)
                if key in seen:
                    continue
                seen.add(key)
                a = acc[src][b]
                a["n"] += 1
                a["abs"] += abs(temp - o["temp_f"])
                a["bias"] += temp - o["temp_f"]
                a["brier"] += (pop / 100.0 - (1.0 if o["rain"] else 0.0)) ** 2
                a["rain_hours"] += 1 if o["rain"] else 0
                days.add(target // 24)
    result = {"as_of": now.isoformat(timespec="seconds"), "window_days": WINDOW_DAYS,
              "days_scored": len(days), "truth": "NWS KBTV airport observation",
              "sources": {}}
    for src in SOURCES:
        result["sources"][src] = {}
        for b, _, _ in BUCKETS:
            a = acc[src][b]
            if a["n"] == 0:
                result["sources"][src][b] = {"n": 0}
                continue
            result["sources"][src][b] = {
                "n": a["n"],
                "temp_mae": round(a["abs"] / a["n"], 2),
                "temp_bias": round(a["bias"] / a["n"], 2),
                "brier": round(a["brier"] / a["n"], 4),
                "rain_hours": a["rain_hours"],
            }
    return result


def main():
    lines = _load_lines()
    result = score(lines)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(result, f, indent=1)
    n = sum(v.get("n", 0) for s in result["sources"].values() for v in s.values())
    print(f"verification: {len(lines)} snapshots, {result['days_scored']} days, {n} scored hours")
    return 0


if __name__ == "__main__":
    sys.exit(main())
