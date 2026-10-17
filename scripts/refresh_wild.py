#!/usr/bin/env python3
"""
Refresh data/wild.json — the single data file behind Burlington Wild (wild.html),
the media home of the counting Burlington already does on iNaturalist and eBird.

Sources
  - iNaturalist API v1 (no key; https://api.inaturalist.org/v1/docs)
      observers, species_counts, observations for place 50939 (Burlington, VT)
      this month and this year, a "seen lately" shelf of research-grade
      observations with CC-licensed photos, and a friendly comparison with
      South Burlington (place 53843).
      House rules from inaturalist.org/pages/api+recommended+practices
      (rev. 2025-02-27): about 1 request/second, ~10k/day, a custom
      User-Agent. This script makes ~14 requests per run, six runs a day.
  - eBird API 2.0 (needs EBIRD_API_KEY; https://documenter.getpostman.com/view/664302/S1ENwy59)
      recent notable observations + the top-100 for Chittenden County
      (US-VT-007). Without the key the bird sections are skipped and the
      page shows its own "switched off" state, same as the Google weather
      layer in refresh_weather.py.

Photos: only observations whose PHOTO carries a Creative Commons license
(photo.license_code) are shown, with the observer's attribution string and the
license spelled out. Everything else is a count and a link back to the platform.
Design: every section fetches independently; on failure we KEEP the last good
section from the existing file. The site never sees a broken or missing file.

Run:  python3 scripts/refresh_wild.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BTV_TZ = ZoneInfo("America/New_York")
INAT = "https://api.inaturalist.org/v1"
EBIRD = "https://api.ebird.org/v2"
PLACE = 50939            # Burlington, VT  (admin level 30 city)
RIVAL = {"place_id": 53843, "name": "South Burlington", "url": "https://www.inaturalist.org/observations?place_id=53843"}
EBIRD_REGION = "US-VT-007"   # Chittenden County  [CONFIRM: /v2/ref/region/list/subnational2/US-VT once a key exists]
UA = "btownbrief.com Burlington Wild page (stephenvdavis@gmail.com)"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "wild.json")
CC = {"cc0", "cc-by", "cc-by-nc", "cc-by-sa", "cc-by-nd", "cc-by-nc-sa", "cc-by-nc-nd"}
# Photos shown on the page: NonCommercial licenses are left out by default because the
# Brief carries sponsors. Set WILD_PHOTO_LICENSES="cc0,cc-by,cc-by-sa,cc-by-nc,..." to widen.
# [CONFIRM: whether Stephen wants CC BY-NC photos on the page]
PHOTO_LICENSES = set((os.environ.get("WILD_PHOTO_LICENSES") or "cc0,cc-by,cc-by-sa,cc-by-nd").split(","))
SHELF_DAYS = 30
CC_LABEL = {"cc0": "CC0", "cc-by": "CC BY", "cc-by-nc": "CC BY-NC", "cc-by-sa": "CC BY-SA", "cc-by-nd": "CC BY-ND", "cc-by-nc-sa": "CC BY-NC-SA", "cc-by-nc-nd": "CC BY-NC-ND"}

now_utc = datetime.now(timezone.utc)
now = now_utc.astimezone(BTV_TZ)
MONTH_START = now.replace(day=1).strftime("%Y-%m-%d")
YEAR_START = now.replace(month=1, day=1).strftime("%Y-%m-%d")
WEEK_START = (now - timedelta(days=7)).strftime("%Y-%m-%d")
_last_call = 0.0


def get_json(url, headers=None, timeout=30):
    """One request per second, per iNaturalist's house rules."""
    global _last_call
    wait = 1.05 - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read())
    finally:
        _last_call = time.monotonic()


def inat(path, **params):
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None}, doseq=True)
    return get_json(f"{INAT}/{path}?{q}")


# ------------------------------------------------------------------ iNaturalist
def observers(d1, n=10):
    r = inat("observations/observers", place_id=PLACE, d1=d1, per_page=n, order_by="species_count")
    out = []
    for row in r.get("results", []):
        u = row.get("user") or {}
        out.append({
            "login": u.get("login"),
            "name": (u.get("name") or "").strip() or None,
            "url": f"https://www.inaturalist.org/people/{u.get('login')}",
            "observations": row.get("observation_count", 0),
            "species": row.get("species_count", 0),
        })
    return {"total_observers": r.get("total_results", 0), "top": out}


def species(d1, n=8):
    r = inat("observations/species_counts", place_id=PLACE, d1=d1, per_page=n)
    out = []
    for row in r.get("results", []):
        t = row.get("taxon") or {}
        out.append({
            "count": row.get("count", 0),
            "name": t.get("name"),
            "common": t.get("preferred_common_name"),
            "group": t.get("iconic_taxon_name"),
            "url": f"https://www.inaturalist.org/observations?place_id={PLACE}&taxon_id={t.get('id')}&d1={d1}",
        })
    return {"total_species": r.get("total_results", 0), "top": out}


def tidy_place(s):
    """'New North End, Burlington, VT, USA' → 'New North End, Burlington'."""
    if not s:
        return None
    import re
    return re.sub(r",\s*(VT|Vermont)(,\s*(US|USA))?\s*$", "", s).strip()


def total_observations(place_id, d1):
    return inat("observations", place_id=place_id, d1=d1, per_page=0).get("total_results", 0)


def total_species(place_id, d1):
    return inat("observations/species_counts", place_id=place_id, d1=d1, per_page=0).get("total_results", 0)


def seen_lately(n=12):
    """Recent research-grade observations whose photo carries one of PHOTO_LICENSES."""
    since = (now - timedelta(days=SHELF_DAYS)).strftime("%Y-%m-%d")
    r = inat("observations", place_id=PLACE, d1=since, photos="true", quality_grade="research",
             photo_license=",".join(sorted(PHOTO_LICENSES)), order_by="observed_on", order="desc", per_page=60)
    out, seen_taxa = [], set()
    for o in r.get("results", []):
        photos = [p for p in (o.get("photos") or []) if (p.get("license_code") or "").lower() in PHOTO_LICENSES]
        if not photos:
            continue
        t = o.get("taxon") or {}
        if t.get("id") in seen_taxa:
            continue  # one card per species, so a monarch week isn't twelve monarchs
        seen_taxa.add(t.get("id"))
        p = photos[0]
        u = o.get("user") or {}
        out.append({
            "id": o.get("id"),
            "url": f"https://www.inaturalist.org/observations/{o.get('id')}",
            "observed_on": o.get("observed_on"),
            "name": t.get("name"),
            "common": t.get("preferred_common_name"),
            "group": t.get("iconic_taxon_name"),
            "threatened": bool(t.get("threatened")),
            "introduced": bool(t.get("introduced")),
            "place": tidy_place(o.get("place_guess")),
            "photo": (p.get("url") or "").replace("/square.", "/medium."),
            "photo_license": CC_LABEL.get(p.get("license_code"), p.get("license_code")),
            "attribution": p.get("attribution"),
            "observer": {"login": u.get("login"), "name": (u.get("name") or "").strip() or None,
                         "url": f"https://www.inaturalist.org/people/{u.get('login')}"},
        })
        if len(out) >= n:
            break
    return out


def rare_lately(n=6):
    """Threatened taxa observed this month; the news hook."""
    r = inat("observations", place_id=PLACE, d1=MONTH_START, threatened="true", order_by="observed_on",
             order="desc", per_page=30)
    out, seen_taxa = [], set()
    for o in r.get("results", []):
        t = o.get("taxon") or {}
        if t.get("id") in seen_taxa:
            continue
        seen_taxa.add(t.get("id"))
        u = o.get("user") or {}
        out.append({
            "url": f"https://www.inaturalist.org/observations/{o.get('id')}",
            "observed_on": o.get("observed_on"),
            "name": t.get("name"), "common": t.get("preferred_common_name"), "group": t.get("iconic_taxon_name"),
            "place": tidy_place(o.get("place_guess")),
            "observer": {"login": u.get("login"), "url": f"https://www.inaturalist.org/people/{u.get('login')}"},
            "quality": o.get("quality_grade"),
        })
        if len(out) >= n:
            break
    return out


def refresh_inat():
    return {
        "place": {"id": PLACE, "name": "Burlington, Vermont", "url": f"https://www.inaturalist.org/observations?place_id={PLACE}",
                  "project": {"title": "Biodiversity of Burlington, Vermont", "url": "https://www.inaturalist.org/projects/biodiversity-of-burlington-vermont"}},
        "month": {"since": MONTH_START, "observations": total_observations(PLACE, MONTH_START),
                  **{"observers": observers(MONTH_START)}, **{"species": species(MONTH_START)}},
        "year": {"since": YEAR_START, "observations": total_observations(PLACE, YEAR_START),
                 **{"observers": observers(YEAR_START)}, **{"species": species(YEAR_START)}},
        "seen": seen_lately(),
        "rare": rare_lately(),
        "rival": {"name": RIVAL["name"], "url": RIVAL["url"],
                  "month": {"species": total_species(RIVAL["place_id"], MONTH_START), "observations": total_observations(RIVAL["place_id"], MONTH_START)},
                  "year": {"species": total_species(RIVAL["place_id"], YEAR_START)}},
    }


# ------------------------------------------------------------------ eBird
def refresh_ebird(key):
    h = {"X-eBirdApiToken": key}
    y, m, d = now.year, now.month, now.day
    notable = get_json(f"{EBIRD}/data/obs/{EBIRD_REGION}/recent/notable?back=7&detail=full&maxResults=40", h)
    top = get_json(f"{EBIRD}/product/top100/{EBIRD_REGION}/{y}/{m}/{d}?rankedBy=spp&maxResults=10", h)
    cards, seen_sp = [], set()
    for o in notable:
        if o.get("speciesCode") in seen_sp:
            continue
        seen_sp.add(o.get("speciesCode"))
        cards.append({
            "common": o.get("comName"), "name": o.get("sciName"), "observed_on": (o.get("obsDt") or "")[:10],
            "place": o.get("locName"), "count": o.get("howMany"),
            "observer": (o.get("userDisplayName") or "").strip() or None,
            "url": f"https://ebird.org/checklist/{o.get('subId')}" if o.get("subId") else None,
            "reviewed": bool(o.get("obsReviewed")), "valid": bool(o.get("obsValid")),
        })
        if len(cards) >= 12:
            break
    board = [{"name": r.get("userDisplayName"), "species": r.get("numSpecies"), "checklists": r.get("numCompleteChecklists"),
              "url": f"https://ebird.org/profile/{r.get('profileHandle')}" if r.get("profileHandle") else None}
             for r in top]
    return {"enabled": True, "region": {"code": EBIRD_REGION, "name": "Chittenden County",
                                       "url": f"https://ebird.org/region/{EBIRD_REGION}", "top100_url": f"https://ebird.org/region/{EBIRD_REGION}/top100"},
            "notable": cards, "top": board, "as_of": now_utc.isoformat(timespec="seconds")}


# ------------------------------------------------------------------ main
def main():
    try:
        with open(OUT) as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001 — first run, or a bad file we are about to replace
        data = {}
    ok = True
    try:
        data["inat"] = refresh_inat()
        data["inat"]["as_of"] = now_utc.isoformat(timespec="seconds")
    except Exception as e:  # noqa: BLE001 — keep the last good section
        ok = False
        print(f"iNaturalist refresh failed, keeping last good: {e}", file=sys.stderr)

    key = os.environ.get("EBIRD_API_KEY", "").strip()
    if key:
        try:
            data["ebird"] = refresh_ebird(key)
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"eBird refresh failed, keeping last good: {e}", file=sys.stderr)
    else:
        prev = data.get("ebird") or {}
        data["ebird"] = {"enabled": False, "region": {"code": EBIRD_REGION, "name": "Chittenden County",
                                                      "url": f"https://ebird.org/region/{EBIRD_REGION}", "top100_url": f"https://ebird.org/region/{EBIRD_REGION}/top100"},
                         "note": "EBIRD_API_KEY not set; birds come from eBird's own pages until it is.",
                         "notable": prev.get("notable", []), "top": prev.get("top", [])}

    data["updated"] = now_utc.isoformat(timespec="seconds")
    data["updated_local"] = now.strftime("%A %B %-d, %-I:%M %p")
    data["sources"] = {
        "inaturalist": {"name": "iNaturalist", "url": "https://www.inaturalist.org", "terms": "https://www.inaturalist.org/pages/terms",
                        "note": "Observations belong to their observers; the default license is CC BY-NC. Photos are shown only when the observer chose a Creative Commons license."},
        "ebird": {"name": "eBird, Cornell Lab of Ornithology", "url": "https://ebird.org", "terms": "https://www.birds.cornell.edu/home/ebird-api-terms-of-use/"},
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    os.replace(tmp, OUT)
    i = data.get("inat", {})
    print(f"wrote {OUT}: month obs {i.get('month', {}).get('observations')} / species {i.get('month', {}).get('species', {}).get('total_species')}; "
          f"year obs {i.get('year', {}).get('observations')}; seen {len(i.get('seen', []))}; rare {len(i.get('rare', []))}; "
          f"ebird {'on' if data['ebird'].get('enabled') else 'off'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
