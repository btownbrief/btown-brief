#!/usr/bin/env python3
"""
What the other outlets are calling — fetched once a day for the morning
read, NOT part of the hourly refresh (these are page scrapes; be polite).

None of these are load-bearing: each returns None on any failure and the
draft simply notes the outlet was unavailable. The quantitative divergence
signal comes from the Open-Meteo model spread in latest.json; these add
the consumer-facing narratives (WU/weather.com are the same TWC data) and
the local TV voices.

Run directly to test:  python3 scripts/outlets.py
"""

import html
import json
import re
import urllib.request

BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8", errors="replace")


def _find_daily_forecast(obj):
    """Recursively find a TWC-style daily forecast dict (has temperatureMax
    list) inside arbitrarily nested state — key names are opaque hashes."""
    if isinstance(obj, dict):
        if isinstance(obj.get("temperatureMax"), list) and obj.get("narrative"):
            return obj
        for v in obj.values():
            hit = _find_daily_forecast(v)
            if hit:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = _find_daily_forecast(v)
            if hit:
                return hit
    return None


def fetch_wunderground():
    """Weather Underground / weather.com (same TWC data): highs, lows, pop,
    narrative from the Angular TransferState blob."""
    page = _get("https://www.wunderground.com/forecast/us/vt/burlington")
    m = re.search(r'<script id="app-root-state"[^>]*>(.*?)</script>', page, re.S)
    if not m:
        return None
    state = json.loads(html.unescape(m.group(1)))
    fc = _find_daily_forecast(state)
    if not fc:
        return None
    days = []
    for i in range(min(3, len(fc.get("temperatureMax", [])))):
        days.append({
            "date": (fc.get("validTimeLocal") or [None] * 3)[i],
            "high_f": fc["temperatureMax"][i],
            "low_f": (fc.get("temperatureMin") or [None] * 3)[i],
            "narrative": (fc.get("narrative") or [None] * 3)[i],
        })
    return {"outlet": "Weather Underground / weather.com (TWC)", "days": days}


def fetch_wcax():
    """WCAX: the numbers their widget displays (TWC-sourced) plus the
    meteorologist-written discussion embedded in Fusion.contentCache."""
    page = _get("https://www.wcax.com/weather/")
    m = re.search(r"Fusion\.contentCache\s*=\s*(\{.*?\});\s*Fusion\.", page, re.S)
    if not m:
        return None
    cache = json.loads(m.group(1))
    fc = _find_daily_forecast(cache)
    days = []
    if fc:
        for i in range(min(3, len(fc.get("temperatureMax", [])))):
            days.append({
                "high_f": fc["temperatureMax"][i],
                "low_f": (fc.get("temperatureMin") or [None] * 3)[i],
                "narrative": (fc.get("narrative") or [None] * 3)[i],
            })
    # The meteorologist's discussion: every story paragraph that talks about
    # days and temps, in page order (today, the weekend, next week). Taking
    # only the longest one dropped the day-by-day story that makes it read
    # like a person talking.
    paras = []
    texts = re.findall(r'"content"\s*:\s*"((?:[^"\\]|\\.){80,})"', m.group(1))
    for t in texts:
        try:
            t = json.loads(f'"{t}"')
        except Exception:
            continue
        t = re.sub(r"<[^>]+>", " ", t)
        t = re.sub(r"\s+", " ", t).strip()
        if re.search(r"(today|tonight|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|weekend)", t, re.I) \
                and re.search(r"\b\d{2}s?\b", t) and t not in paras:
            paras.append(t)
    discussion = " ".join(paras) or None
    if discussion and len(discussion) > 2500:
        discussion = discussion[:2500].rsplit(". ", 1)[0] + "."
    if not days and not discussion:
        return None
    return {"outlet": "WCAX (Channel 3)", "days": days, "discussion": discussion}


def fetch_nbc5():
    """NBC5: the latest forecast article's headline and body (two hops:
    weather page ld+json ItemList, then the article's own ld+json)."""
    page = _get("https://www.mynbc5.com/weather")
    m = re.search(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S)
    if not m:
        return None
    ld = json.loads(m.group(1))
    items = ld.get("itemListElement") if isinstance(ld, dict) else None
    if not items:
        return None
    url = items[0].get("url")
    if not url:
        return None
    art = _get(url)
    headline, published, body = None, None, None
    for am in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', art, re.S):
        try:
            ald = json.loads(am.group(1))
        except Exception:
            continue
        if isinstance(ald, dict) and ald.get("articleBody"):
            headline = ald.get("headline")
            published = ald.get("datePublished")
            body = re.sub(r"\s+", " ", html.unescape(ald["articleBody"])).strip()
            break
    if body:
        # The forecast comes first; the station's promo boilerplate follows.
        body = re.split(r"\s(?:Watch the video|Want more local news|STAY WEATHER-AWARE)", body)[0].strip()
        body = body[:1500]
    if not headline and not body:
        return None
    return {"outlet": "NBC5", "headline": headline,
            "published": published, "body": body, "url": url}


def fetch_all():
    out = {}
    for name, fn in (("wu", fetch_wunderground), ("wcax", fetch_wcax), ("nbc5", fetch_nbc5)):
        try:
            out[name] = fn()
        except Exception as e:  # noqa: BLE001 — outlets are never load-bearing
            print(f"outlet {name} unavailable: {e}")
            out[name] = None
    return out


if __name__ == "__main__":
    print(json.dumps(fetch_all(), indent=1, ensure_ascii=False))
