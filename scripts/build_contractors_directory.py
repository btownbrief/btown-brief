#!/usr/bin/env python3
"""Build the business-level contractor/handyman directory for Chittenden County.

Reads data/contractors/source/05-contractor-dataset.json (1,504 rows: 1,467
VT DFS individual license holders + 37 VBRA remodeler-directory entries) and
sorts every row into exactly one of three outputs:

  data/contractors/directory.json    - publishable business listings
  data/contractors/review-queue.json - needs Steve's manual review
  data/contractors/excluded.json     - dropped, with a reason

Also writes data/contractors/directory.csv (spreadsheet mirror of directory.json).

Method (see SUMMARY-contractors-data.md for the full write-up):

1. VT DFS rows are INDIVIDUAL license holders. This particular pull carries
   no street address, phone, or business name for them at all (name/license/
   town/zip only) - Steve's rule #1 requires shared business name, address,
   or phone to group individuals into a business, and requires independent
   verification before listing an unaffiliated individual as a business.
   None of that evidence exists in this dataset, so every DFS row is
   EXCLUDED as "individual-without-business" rather than guessed at. See
   SUMMARY for the recommended next step (re-pull DFS with street_address).
2. VBRA rows already name a business. The 12 rows VBRA itself tags as
   "Non-trade VBRA associate member" (lenders, insurers, law/accounting
   firms, a fiber ISP, a cabinetry supplier, two design firms VBRA itself
   classifies as associate/non-builder members) are excluded per rule #5.
3. Of the remaining 25 VBRA trade rows, each was read by hand (25 rows is
   small enough to do individually, which rule #8 requires for anything
   short of mechanical fact-checking):
     - two are supplier businesses despite VBRA's category tag (a building-
       supply yard, a lumber yard) -> excluded, not contractors.
     - one is a duplicate-name entity in Lebanon, NH (a second "Allen Pools
       & Spas" unrelated to the Williston, VT listing) -> excluded, out of
       state / not the same business as the in-county listing.
     - businesses headquartered outside Chittenden County AND not in an
       ADJACENT VT county (Franklin, Grand Isle, Addison, Washington,
       Lamoille) are excluded as out-of-county; this is objective VT county
       geography, not a taste call.
     - businesses in an adjacent county, or with an unresolved duplicate-
       name conflict, or an ambiguous residential-vs-commercial-only scope,
       go to the review queue (needs Steve's judgment call, which rule #8
       reserves for him).
     - the rest are candidate publishable listings, subject to Google
       Places confirming a real, matching business (see below).
   VBRA's auto-guessed "category" field (a keyword match against ~180
   service tags, flagged in the source dataset's own schema_notes as
   needing a human pass) is corrected against the business's own name where
   the name makes the real trade obvious (e.g. "BLUE SKY ROOFING" tagged
   "General Contractor" -> Roofing).
4. Google Places (legacy Find Place From Text + Place Details) is used to
   confirm each candidate business actually exists at that identity: name,
   place_id, formatted_address, phone, website. A business demotes from
   "publish" to "review queue" if Places returns zero or multiple
   candidates (ambiguous) rather than one confident match.
5. No handyman rows exist in the source dataset at all (a known gap noted
   in the research brief) - the Handyman category is empty this pass, not
   because handymen were screened out.
"""

import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "data", "contractors", "source", "05-contractor-dataset.json")
OUT_DIR = os.path.join(ROOT, "data", "contractors")
CACHE_PATH = os.path.join(OUT_DIR, "places-cache.json")
TODAY = "2026-07-19"
UA = "btown-brief-site/1.0 (contractors directory build; contact BtownBrief@gmail.com)"

# Chittenden County towns (matches the research brief's town list).
IN_COUNTY = {
    "burlington", "south burlington", "winooski", "essex", "essex junction",
    "essex jct", "essex jct.", "essex juntion", "colchester", "williston",
    "shelburne", "richmond", "jericho", "underhill", "milton", "hinesburg",
    "charlotte", "st. george", "st george", "westford", "bolton", "huntington",
}
# VT counties immediately bordering Chittenden County.
ADJACENT_COUNTY_TOWNS = {
    "swanton": "Franklin County",
    "south hero": "Grand Isle County",
    "vergennes": "Addison County",
    "east middlebury": "Addison County",
}
# Non-adjacent VT / out-of-state towns that showed up in this dataset.
FAR_TOWNS = {
    "newport": "Orleans County (~2.5 hrs from Chittenden County)",
    "white river junction": "Windsor County (not adjacent to Chittenden)",
    "brattleboro": "Windham County (~2.5 hrs from Chittenden County)",
    "quechee": "Windsor County (not adjacent to Chittenden)",
    "lebanon": "Lebanon, NH (out of state)",
    "claremont": "Claremont, NH (out of state)",
    "manchester": "Manchester, NH (out of state)",
}

STEVE_CATEGORIES = [
    "Electrician", "Plumber", "HVAC & Heat Pumps",
    "General Contractor & Remodeler", "Handyman", "Roofing", "Painting",
    "Landscaping",
]

# ---------------------------------------------------------------------------
# Hand-reviewed decisions for the 25 VBRA trade-tagged rows (matched by
# exact name+town+phone from the source dataset). Each of the 37 VBRA rows
# is accounted for below or via the "Non-trade VBRA associate member"
# category filter. See module docstring for the reasoning.
# ---------------------------------------------------------------------------
VBRA_DECISIONS = {
    ("Allen Pools & Spas", "Williston"): {
        "action": "candidate", "category": "Pool & Spa",
    },
    ("Allen Pools & Spas", "Lebanon"): {
        "action": "exclude",
        "reason": "out-of-state duplicate-name entity — a second, unrelated "
                   "\"Allen Pools & Spas\" location in Lebanon, NH; not the "
                   "same business as the Williston, VT listing already "
                   "published, and out of the directory's service area.",
    },
    ("Bourbeau Custom Homes, Inc.", "Swanton"): {
        "action": "queue", "category": "General Contractor & Remodeler",
        "reason": "HQ in Franklin County (Swanton), adjacent to but not in "
                   "Chittenden County. VBRA's directory tags this member as "
                   "serving Chittenden — confirm actual service area before "
                   "publishing. Category corrected from VBRA's auto-tag "
                   "\"Architect/Designer\" to General Contractor & Remodeler "
                   "based on the business's own name (\"Custom Homes\").",
    },
    ("Hayward Design Build", "South Hero"): {
        "action": "queue", "category": "General Contractor & Remodeler",
        "reason": "HQ in Grand Isle County (South Hero), adjacent to but not "
                   "in Chittenden County. ALSO: a second VBRA row for a "
                   "business with the identical name \"Hayward Design "
                   "Build\" exists at a Colchester address with a different "
                   "phone number — confirm whether this is one business "
                   "with two locations, two unrelated businesses that "
                   "share a name, or a stale/duplicate VBRA listing before "
                   "publishing either.",
    },
    ("Hayward Design Build", "Colchester"): {
        "action": "queue", "category": "General Contractor & Remodeler",
        "reason": "Identical business name to a second VBRA row at a South "
                   "Hero address with a different phone number — confirm "
                   "whether this is one business with two locations, two "
                   "unrelated businesses sharing a name, or a stale/"
                   "duplicate VBRA listing before publishing either "
                   "(rule: uncertain match stays out of the published "
                   "directory).",
    },
    ("Chevalier Drilling Co., Inc.", "Swanton"): {
        "action": "queue", "category": "Well & Water Systems",
        "reason": "HQ in Franklin County (Swanton), adjacent to but not in "
                   "Chittenden County. VBRA's directory tags this member as "
                   "serving Chittenden — confirm actual service area before "
                   "publishing.",
    },
    ("Colchester Contracting Services, Inc.", "Colchester"): {
        "action": "candidate", "category": "General Contractor & Remodeler",
    },
    ("Culligan Water Technologies", "Colchester"): {
        "action": "candidate", "category": "Well & Water Systems",
    },
    ("Dousevicz, Inc.", "Essex Juntion"): {
        "action": "queue", "category": "General Contractor & Remodeler",
        "reason": "VBRA tags this member's category as \"Commercial "
                   "Contractor\" — unclear whether Dousevicz takes on "
                   "residential homeowner work or is commercial/site-work "
                   "only. Whether a commercial-focused firm belongs in a "
                   "homeowner-facing directory is Steve's editorial call, "
                   "not an objective fact this build can resolve.",
    },
    ("Floor Coverings International", "Shelburne"): {
        "action": "candidate", "category": "Flooring",
    },
    ("Godbout Development", "Williston"): {
        "action": "candidate", "category": "General Contractor & Remodeler",
    },
    ("H.J. LeBoeuf & Son, Inc.", "Vergennes"): {
        "action": "queue", "category": "General Contractor & Remodeler",
        "reason": "HQ in Addison County (Vergennes), adjacent to but not in "
                   "Chittenden County. VBRA's directory tags this member as "
                   "serving Chittenden — confirm actual service area before "
                   "publishing.",
    },
    ("Hauke Building Supply, Inc.", "Burlington"): {
        "action": "exclude",
        "reason": "supplier, not a contractor — the business's own name "
                   "identifies it as a building-materials supply yard, not "
                   "a licensed trade or contracting service, despite "
                   "VBRA's \"Residential Builder\" category tag.",
    },
    ("High Performance Modular Homes", "Williston"): {
        "action": "candidate", "category": "General Contractor & Remodeler",
    },
    ("Geobarns", "White River Junction"): {
        "action": "exclude",
        "reason": "out-of-county — White River Junction is in Windsor "
                   "County, which does not border Chittenden County "
                   "(~1 hr 15 min away); not a plausible local service "
                   "business for this directory.",
    },
    ("BLUE SKY ROOFING", "Colchester"): {
        "action": "candidate", "category": "Roofing",
    },
    ("Carroll Concrete", "Newport"): {
        "action": "exclude",
        "reason": "out-of-county — Newport is in Orleans County, which "
                   "does not border Chittenden County (~2.5 hrs away); "
                   "also lists a New Hampshire area-code phone number.",
    },
    ("GORDON'S WINDOW DECOR", "Williston"): {
        "action": "candidate", "category": "Windows & Doors",
    },
    ("Applied Solutions Consulting (ASC)", "Westford"): {
        "action": "candidate", "category": "General Contractor & Remodeler",
    },
    ("Ennis Construction INC", "Quechee"): {
        "action": "exclude",
        "reason": "out-of-county — Quechee (village in Hartford, VT) is in "
                   "Windsor County, which does not border Chittenden "
                   "County.",
    },
    ("Green State Builders", "Essex Jct"): {
        "action": "candidate", "category": "General Contractor & Remodeler",
    },
    ("Gale Legal Group PLLC", "Colchester"): {"action": "skip_non_trade"},
    ("Baldwin Design LLC", "Colchester"): {"action": "skip_non_trade"},
    ("Builders Installed Products", "Williston"): {
        "action": "candidate", "category": "Insulation & Weatherization",
    },
    ("Haven Architecture LLC", "Burlington"): {"action": "skip_non_trade"},
    ("Fidium", "Manchester"): {"action": "skip_non_trade"},
    ("Goodro Lumber", "East Middlebury"): {
        "action": "exclude",
        "reason": "supplier, not a contractor — a lumber yard, despite "
                   "VBRA's \"Residential Builder\" category tag. (Also in "
                   "Addison County, adjacent to but not in Chittenden "
                   "County.)",
    },
    ("Hegeman Electric Inc", "Essex Jct."): {
        "action": "candidate", "category": "Electrician",
    },
    ("Cocoplum Appliances", "Brattleboro"): {
        "action": "exclude",
        "reason": "out-of-county — Brattleboro is in Windham County, which "
                   "does not border Chittenden County (~2.5 hrs away).",
    },
}
NON_TRADE_REASON = (
    "non-contractor — VBRA classifies this as a \"Non-trade VBRA associate "
    "member\" (financial/legal/insurance/lending/supplier/ancillary-"
    "design member), not a hands-on contracting trade. Per Steve's rule: "
    "lenders, insurers, attorneys, accountants, and suppliers are excluded "
    "even when VBRA-affiliated."
)


def slugify(name):
    s = "".join(c.lower() if c.isalnum() else "-" for c in name)
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-")


def county_scope(town):
    t = (town or "").strip().lower()
    if t in IN_COUNTY:
        return "in_county", None
    if t in ADJACENT_COUNTY_TOWNS:
        return "adjacent", ADJACENT_COUNTY_TOWNS[t]
    if t in FAR_TOWNS:
        return "far", FAR_TOWNS[t]
    return "unknown", None


# ---------------------------------------------------------------------------
# Google Places (legacy) — Find Place From Text + Place Details
# ---------------------------------------------------------------------------

def load_cache():
    if os.path.exists(CACHE_PATH):
        try:
            return json.load(open(CACHE_PATH))
        except Exception:
            return {}
    return {}


def save_cache(cache):
    json.dump(cache, open(CACHE_PATH, "w"), indent=1)


def http_get(url, params):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(url + "?" + q, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def places_lookup(name, town, api_key, cache, calls):
    """Find Place From Text -> Place Details. Returns dict or None. Caches by
    query text so reruns don't re-bill."""
    query = "%s, %s, VT" % (name, town)
    if query in cache:
        return cache[query]
    if not api_key:
        return None
    try:
        find = http_get(
            "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
            {"input": query, "inputtype": "textquery",
             "fields": "place_id,name,formatted_address", "key": api_key})
        calls[0] += 1
        time.sleep(0.2)
        candidates = find.get("candidates", [])
        if find.get("status") != "OK" or len(candidates) != 1:
            result = {"match": False, "status": find.get("status"),
                      "candidate_count": len(candidates),
                      "candidates": [
                          {"name": c.get("name"), "formatted_address": c.get("formatted_address")}
                          for c in candidates
                      ]}
            cache[query] = result
            return result
        cand = candidates[0]
        details = http_get(
            "https://maps.googleapis.com/maps/api/place/details/json",
            {"place_id": cand["place_id"],
             "fields": "name,formatted_address,formatted_phone_number,website",
             "key": api_key})
        calls[0] += 1
        time.sleep(0.2)
        res = details.get("result", {})
        result = {
            "match": True,
            "place_id": cand["place_id"],
            "name": res.get("name", cand.get("name")),
            "formatted_address": res.get("formatted_address", cand.get("formatted_address")),
            "phone": res.get("formatted_phone_number"),
            "website": res.get("website"),
        }
        cache[query] = result
        return result
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        result = {"match": False, "status": "error", "error": str(e)}
        cache[query] = result
        return result


def town_from_address(formatted_address):
    """'32 Cottonwood Dr #107, Williston, VT 05495, USA' -> 'Williston'.
    Falls back to None if the format doesn't parse as expected."""
    if not formatted_address:
        return None
    parts = [p.strip() for p in formatted_address.split(",")]
    # Expect [...street, City, "VT ZIP", "USA"] or [...street, City, "VT ZIP"]
    for p in parts:
        if p.startswith("VT ") or p == "VT":
            idx = parts.index(p)
            if idx >= 1:
                return parts[idx - 1]
    return None


def maps_url(place_id, name, town):
    if place_id:
        addr_q = urllib.parse.quote("%s, %s, VT" % (name, town))
        return "https://www.google.com/maps/search/?api=1&query=%s&query_place_id=%s" % (addr_q, place_id)
    q = urllib.parse.quote("%s, %s, VT" % (name, town))
    return "https://www.google.com/maps/search/?api=1&query=%s" % q


def main():
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    src = json.load(open(SRC))
    rows = src["rows"]

    dfs_rows = [r for r in rows if any("DFS" in s for s in r["sources"])]
    vbra_rows = [r for r in rows if any("VBRA" in s for s in r["sources"])]
    assert len(dfs_rows) + len(vbra_rows) == len(rows)

    directory = []
    review_queue = []
    excluded = []

    # --- DFS individual rows: no business-identifying fields available ---
    expired_count = sum(1 for r in dfs_rows if (r["license_exp_date"] or "") < TODAY)
    for r in dfs_rows:
        excluded.append({
            "source_record": r,
            "reason": "individual-without-business",
            "detail": "VT DFS license holder — this dataset pull carries no "
                      "business name, street address, or phone for DFS rows, "
                      "so no operating business can be identified or "
                      "independently verified from the data alone. License "
                      "status: %s (expires %s)." % (
                          "expired" if (r["license_exp_date"] or "") < TODAY else "active",
                          r["license_exp_date"]),
        })

    # --- VBRA rows ---
    cache = load_cache()
    calls = [0]
    shortlist = []  # (row, decision) needing a Places lookup

    for r in vbra_rows:
        if r["category"] == "Non-trade VBRA associate member":
            excluded.append({"source_record": r, "reason": "non-contractor",
                              "detail": NON_TRADE_REASON})
            continue
        key = (r["name"], r["town"])
        dec = VBRA_DECISIONS.get(key)
        if dec is None:
            raise SystemExit("No hand-reviewed decision recorded for VBRA row: %r" % (key,))
        if dec["action"] == "skip_non_trade":
            # already handled via category filter above; shouldn't hit this
            excluded.append({"source_record": r, "reason": "non-contractor",
                              "detail": NON_TRADE_REASON})
            continue
        if dec["action"] == "exclude":
            excluded.append({"source_record": r, "reason": "out-of-scope",
                              "detail": dec["reason"]})
            continue
        # candidate or queue: both get a Places lookup (both are "shortlisted")
        shortlist.append((r, dec))

    print("Places shortlist: %d businesses" % len(shortlist))
    if not api_key:
        print("GOOGLE_MAPS_API_KEY not set — places_status will be 'pending' for all rows.")

    # First pass: run every Places lookup so we can detect same-place_id
    # duplicates (two VBRA rows that Places proves are one business).
    looked_up = []
    for r, dec in shortlist:
        places = places_lookup(r["name"], r["town"], api_key, cache, calls)
        looked_up.append((r, dec, places))
    seen_place_ids = {}
    skip_indices = set()
    merged_count = 0
    for i, (r, dec, places) in enumerate(looked_up):
        pid = places.get("place_id") if places and places.get("match") else None
        if not pid:
            continue
        if pid in seen_place_ids:
            j = seen_place_ids[pid]
            other_r, other_dec, _ = looked_up[j]
            note = (" Google Places resolved this and a second VBRA profile "
                    "entry (originally listed as town=%s, phone=%s) to the "
                    "SAME business — both Find Place From Text searches "
                    "returned the identical place_id, address (%s), and "
                    "phone (%s). These are one business with two VBRA "
                    "profile entries, not two separate businesses; both "
                    "VBRA rows are merged into this single listing." % (
                        other_r["town"], other_r.get("phone"),
                        places["formatted_address"], places.get("phone")))
            dec = dict(dec)
            dec["reason"] = dec.get("reason", "") + note
            dec["merged_duplicate_vbra_row"] = {"town": other_r["town"], "phone": other_r.get("phone")}
            looked_up[i] = (r, dec, places)
            skip_indices.add(j)
            merged_count += 1
        else:
            seen_place_ids[pid] = i
    looked_up = [x for i, x in enumerate(looked_up) if i not in skip_indices]

    for r, dec, places in looked_up:
        # Prefer the Google-confirmed physical town over VBRA's self-reported
        # one when we have a verified match — it's the more accurate source
        # for "where is this business actually located" (a few VBRA rows
        # turned out to list a different town than Places' address, e.g.
        # BLUE SKY ROOFING listed as Colchester but actually in Richmond).
        verified_town = None
        if places and places.get("match"):
            verified_town = town_from_address(places.get("formatted_address"))
        effective_town = verified_town or r["town"]
        scope, scope_note = county_scope(effective_town)

        entry_common = {
            "business_name": r["name"],
            "category": dec["category"],
            "town": effective_town,
            "phone": r.get("phone"),
            "website": r.get("website"),
            "licenses": [],
            "vbra_member": True,
            "een_member": False,
            "last_verified": TODAY,
        }

        if places and places.get("match"):
            entry_common["google_place_id"] = places["place_id"]
            entry_common["google_maps_url"] = maps_url(places["place_id"], r["name"], effective_town)
            entry_common["places_status"] = "verified"
            # prefer Places-confirmed phone/website when present
            if places.get("phone"):
                entry_common["phone"] = places["phone"]
            if places.get("website"):
                entry_common["website"] = places["website"]
            other_signals = ["VBRA Remodelers Directory member"]
            if r.get("phone") and places.get("phone"):
                vbra_digits = "".join(c for c in r["phone"] if c.isdigit())[-7:]
                places_digits = "".join(c for c in (places.get("phone") or "") if c.isdigit())[-7:]
                if vbra_digits and vbra_digits == places_digits:
                    other_signals.append("Google Places phone matches VBRA-listed phone")
                else:
                    other_signals.append("Google Places phone differs from VBRA-listed phone — spot-check before publishing")
            entry_common["other_signals"] = other_signals
        elif not api_key:
            entry_common["google_place_id"] = None
            entry_common["google_maps_url"] = maps_url(None, r["name"], effective_town)
            entry_common["places_status"] = "pending"
            entry_common["other_signals"] = ["VBRA Remodelers Directory member"]
        else:
            entry_common["google_place_id"] = None
            entry_common["google_maps_url"] = maps_url(None, r["name"], effective_town)
            entry_common["places_status"] = "no_confident_match"
            entry_common["other_signals"] = ["VBRA Remodelers Directory member"]

        if dec["action"] == "candidate" and places and places.get("match"):
            entry_common["business_id"] = slugify(r["name"] + "-" + effective_town)
            entry_common["service_area"] = (
                "Chittenden County" if scope == "in_county"
                else "Chittenden County (VBRA-listed; HQ in %s)" % scope_note)
            directory.append(entry_common)
        elif dec["action"] == "candidate" and (not places or not places.get("match")):
            cands = (places or {}).get("candidates", [])
            cand_note = ("Google Places candidates found: " +
                         "; ".join("%s (%s)" % (c["name"], c["formatted_address"]) for c in cands)
                         ) if cands else "Google Places returned zero results for this name/town."
            review_queue.append({
                **entry_common,
                "review_reason": "Google Places search did not return a single "
                                  "confident match for this business name/town "
                                  "— confirm the business identity manually "
                                  "before publishing. " + cand_note,
                "evidence_needed": "Manual Google/BBB search to confirm this "
                                    "is a real, currently-operating business "
                                    "at this name.",
            })
        else:  # dec["action"] == "queue"
            item = {
                **entry_common,
                "review_reason": dec["reason"],
                "evidence_needed": "Steve's confirmation (service area, "
                                    "residential-vs-commercial scope, or "
                                    "duplicate-listing resolution as noted).",
            }
            if "merged_duplicate_vbra_row" in dec:
                item["merged_duplicate_vbra_row"] = dec["merged_duplicate_vbra_row"]
            review_queue.append(item)

    save_cache(cache)

    # --- write outputs ---
    os.makedirs(OUT_DIR, exist_ok=True)
    directory.sort(key=lambda d: (d["category"], d["business_name"]))
    review_queue.sort(key=lambda d: d.get("business_name", ""))

    json.dump({
        "generated": TODAY,
        "source": "data/contractors/source/05-contractor-dataset.json",
        "count": len(directory),
        "listings": directory,
    }, open(os.path.join(OUT_DIR, "directory.json"), "w"), indent=1)

    json.dump({
        "generated": TODAY,
        "count": len(review_queue),
        "items": review_queue,
    }, open(os.path.join(OUT_DIR, "review-queue.json"), "w"), indent=1)

    json.dump({
        "generated": TODAY,
        "count": len(excluded),
        "items": excluded,
    }, open(os.path.join(OUT_DIR, "excluded.json"), "w"), indent=1)

    # CSV mirror of directory.json
    csv_path = os.path.join(OUT_DIR, "directory.csv")
    fields = ["business_id", "business_name", "category", "town", "service_area",
              "phone", "website", "google_place_id", "google_maps_url",
              "vbra_member", "een_member", "other_signals", "last_verified",
              "places_status"]
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for d in directory:
            row = dict(d)
            row["other_signals"] = "; ".join(row.get("other_signals", []))
            w.writerow(row)

    print()
    print("DFS individual rows: %d (%d expired) -> all excluded (individual-without-business)" % (len(dfs_rows), expired_count))
    print("VBRA rows: %d" % len(vbra_rows))
    print("Places API calls made this run: %d" % calls[0])
    print()
    print("directory.json: %d" % len(directory))
    print("review-queue.json: %d" % len(review_queue))
    print("excluded.json: %d" % len(excluded))
    print("merged duplicate VBRA rows (same Places place_id): %d" % merged_count)
    print("total: %d + %d merged = %d (should be %d)" % (
        len(directory) + len(review_queue) + len(excluded), merged_count,
        len(directory) + len(review_queue) + len(excluded) + merged_count, len(rows)))


if __name__ == "__main__":
    main()
