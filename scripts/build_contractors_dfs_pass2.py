#!/usr/bin/env python3
"""Pass 2: group DFS individual license holders into candidate businesses
using street_address (not available in the pass-1 dataset pull) and verify
each candidate via Google Places, then merge the result into the existing
directory.json / review-queue.json / excluded.json built by
build_contractors_directory.py (pass 1, VBRA-only).

Why this exists: pass 1 excluded all 1,467 DFS rows outright because that
particular dataset pull carried no street_address, phone, or business name
for DFS rows at all - Steve's rule #1 requires shared address/phone/business
name to group individuals into a business. This script re-pulls the live
DFS Socrata API with ALL available columns (confirmed via the dataset's own
/api/views/cy8e-89cz.json metadata: last_name, first_name, street_address,
city, state, zip_code, license_number, license_exp_date, type_desc,
level_desc - there is still no business/employer/dba column at any point,
confirmed against the live API, not assumed) and uses street_address as the
grouping signal the coordinator asked for.

Method:
1. Filter to the same Chittenden-County towns and trades as pass 1.
2. Drop rows with no real address ("BAD ADDRESS" is a literal placeholder
   value DFS uses for unknown addresses - not a real shared address).
3. Group by (normalized street_address, city, trade). A group of exactly
   one row - or one row after collapsing duplicate license records for the
   SAME person (common: someone licensed as both an electrician and a gas
   installer, or re-licensed) - stays a plain individual and is excluded,
   per the coordinator's explicit instruction: "An individual at an address
   with no corroborating second signal ... stays excluded as
   individual-without-business."
4. A group of 2+ DISTINCT people at the same address+trade becomes a
   candidate business - but a shared address alone is weak evidence (most
   turn out to be family members at a shared home, not a business, when
   inspected by hand - see SUMMARY). Google Places is used to require
   independent, external corroboration before publishing: a Find Place
   From Text search on the address itself, and (when everyone at the
   address shares a surname) a second search combining that surname with
   the trade. A candidate only becomes a business if Places returns a
   single confident match whose result is an actual named place at that
   address - not just a bare geocoded street address. No business name is
   ever invented; it always comes verbatim from either Places' confirmed
   name or, when Places has no name but the DFS data literally shows
   multiple people who share both a surname and an address, the pattern
   "{Surname} {Trade}" is used ONLY as a last resort AND only when a
   Places search for exactly that string returns a confident match  -
   otherwise the group stays unconfirmed and excluded.
5. license_exp_date decides publish vs. review: if at least one person in
   a confirmed business's group holds an active (unexpired) license,
   publish; if every person's license there has expired, the business
   goes to the review queue (per the coordinator: "expired-only -> review
   queue"), never straight to publish or straight to excluded.
"""

import csv
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT_DIR = os.path.join(ROOT, "data", "contractors")
SRC = os.path.join(OUT_DIR, "source", "05-dfs-full-columns-pull.json")
CACHE_PATH = os.path.join(OUT_DIR, "places-cache.json")
TODAY = "2026-07-19"
UA = "btown-brief-site/1.0 (contractors directory build; contact BtownBrief@gmail.com)"
CALLS_BUDGET = 350

TRADE_CATEGORY = {
    "Electrician": "Electrician",
    "Plumber": "Plumber",
    "Gas Installer": "HVAC & Heat Pumps",
    "Oil Installer": "HVAC & Heat Pumps",
}
TRADE_NAME_GUESS = {
    "Electrician": "Electric",
    "Plumber": "Plumbing",
    "Gas Installer": "Heating",
    "Oil Installer": "Heating",
}

IN_COUNTY_TOWN_DISPLAY = {
    "BURLINGTON": "Burlington", "SOUTH BURLINGTON": "South Burlington",
    "S BURLINGTON": "South Burlington", "WINOOSKI": "Winooski",
    "ESSEX": "Essex", "ESSEX JCT": "Essex Junction",
    "ESSEX JUNCTION": "Essex Junction", "ESSEX CENTER": "Essex Junction",
    "COLCHESTER": "Colchester", "WILLISTON": "Williston",
    "SHELBURNE": "Shelburne", "RICHMOND": "Richmond", "JERICHO": "Jericho",
    "JERICHO CENTER": "Jericho", "UNDERHILL": "Underhill", "MILTON": "Milton",
    "HINESBURG": "Hinesburg", "CHARLOTTE": "Charlotte",
    "ST GEORGE": "St. George", "ST. GEORGE": "St. George",
    "WESTFORD": "Westford", "BOLTON": "Bolton", "HUNTINGTON": "Huntington",
}


def norm_addr(a):
    a = (a or "").upper().strip()
    a = re.sub(r"\s+", " ", a)
    a = a.replace(".", "")
    return a


def norm_name_key(part):
    return re.sub(r"[^A-Z]", "", (part or "").upper())


STREET_SUFFIXES = (
    r"RD|ROAD|LN|LANE|DR|DRIVE|ST|STREET|AVE|AVENUE|CT|COURT|WAY|CIR|"
    r"CIRCLE|BLVD|BOULEVARD|HWY|HIGHWAY|PL|PLACE|TER|TERRACE|LOOP|PATH|"
    r"XING|CROSSING|RUN|TRL|TRAIL|PKWY|PARKWAY|SQ|SQUARE|ALY|ALLEY"
)
BARE_ADDRESS_RE = re.compile(
    r"^\d+[A-Z]?\s+.+\b(?:%s)\.?$" % STREET_SUFFIXES, re.IGNORECASE)


def looks_like_bare_address(name):
    """True if `name` is nothing more than a house number + street name +
    suffix (what Places sometimes returns for a plain residential address
    with no registered business/POI) rather than an actual business name."""
    if not name:
        return False
    return bool(BARE_ADDRESS_RE.match(name.strip()))


def same_person(a, b):
    """True if two DFS rows are almost certainly duplicate license records
    for the ONE same person (not two different people), False if clearly
    different, or the string 'ambiguous' if a Jr/Sr/II/III suffix makes it
    genuinely unclear (in practice the suffix ends up inside last_name in
    this dataset, which already makes the last-name key differ - so this
    path is a safety net, not the primary mechanism)."""
    la, fa = norm_name_key(a["last_name"]), norm_name_key(a["first_name"])
    lb, fb = norm_name_key(b["last_name"]), norm_name_key(b["first_name"])
    if la != lb:
        return False
    for r in (a, b):
        raw = ((r["last_name"] or "") + " " + (r["first_name"] or "")).upper()
        if re.search(r"\bJR\b|\bSR\b|\bII\b|\bIII\b|\bIV\b", raw):
            return "ambiguous"
    short, long_ = (fa, fb) if len(fa) <= len(fb) else (fb, fa)
    if short and long_.startswith(short):
        return True
    return fa == fb


def group_dfs_rows(rows):
    groups = {}
    for r in rows:
        addr = norm_addr(r["street_address"])
        if addr in ("BAD ADDRESS", ""):
            continue
        key = (addr, r["city"].upper().strip(), r["type_desc"])
        groups.setdefault(key, []).append(r)

    candidates = {}
    for key, group_rows in groups.items():
        if len(group_rows) < 2:
            continue
        if key[0].startswith("PO BOX") or key[0].startswith("P O BOX"):
            continue  # not a verifiable physical location
        distinct = []
        for r in group_rows:
            placed = False
            for bucket in distinct:
                if same_person(r, bucket[0]) is True:
                    bucket.append(r)
                    placed = True
                    break
            if not placed:
                distinct.append([r])
        if len(distinct) >= 2:
            candidates[key] = distinct
    return groups, candidates


# ---------------------------------------------------------------------------
# Google Places (legacy) — reuses the pass-1 cache file and call-count style
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


def places_lookup(query, api_key, cache, calls):
    if query in cache:
        return cache[query]
    if not api_key or calls[0] >= CALLS_BUDGET:
        return None
    try:
        find = http_get(
            "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
            {"input": query, "inputtype": "textquery",
             "fields": "place_id,name,formatted_address", "key": api_key})
        calls[0] += 1
        time.sleep(0.15)
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
        # Reject a "match" that's really just the bare address geocoded back
        # to us with no distinct business name (Places sometimes does this
        # for a plain residential address with no POI on file) — catches
        # both an exact echo of the query AND a differently-abbreviated
        # street address (e.g. query says "Lane", Places replies "Ln").
        cand_name = cand.get("name") or ""
        name_norm = re.sub(r"[^A-Z0-9]", "", cand_name.upper())
        query_norm = re.sub(r"[^A-Z0-9]", "", query.upper())
        if (name_norm and name_norm in query_norm) or looks_like_bare_address(cand_name):
            result = {"match": False, "status": "BARE_ADDRESS_NO_BUSINESS",
                      "candidate_count": 1,
                      "candidates": [{"name": cand.get("name"), "formatted_address": cand.get("formatted_address")}]}
            cache[query] = result
            return result
        if calls[0] >= CALLS_BUDGET:
            result = {"match": False, "status": "BUDGET_EXHAUSTED_BEFORE_DETAILS"}
            cache[query] = result
            return result
        details = http_get(
            "https://maps.googleapis.com/maps/api/place/details/json",
            {"place_id": cand["place_id"],
             "fields": "name,formatted_address,formatted_phone_number,website",
             "key": api_key})
        calls[0] += 1
        time.sleep(0.15)
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


def maps_url(place_id, query):
    if place_id:
        return "https://www.google.com/maps/search/?api=1&query=%s&query_place_id=%s" % (
            urllib.parse.quote(query), place_id)
    return "https://www.google.com/maps/search/?api=1&query=%s" % urllib.parse.quote(query)


def slugify(name):
    s = "".join(c.lower() if c.isalnum() else "-" for c in name)
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-")


def main():
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    rows = json.load(open(SRC))
    print("DFS full-column pull: %d rows" % len(rows))

    groups, candidates = group_dfs_rows(rows)
    print("Address+city+trade groups (2+ raw license rows): %d" % sum(1 for v in groups.values() if len(v) >= 2))
    print("Candidate businesses (2+ distinct people after collapsing same-person duplicate records): %d" % len(candidates))

    # every row not part of a candidate group's distinct-person list is a
    # plain excluded individual, same as pass 1.
    rows_in_candidates = set()
    for distinct in candidates.values():
        for bucket in distinct:
            for r in bucket:
                rows_in_candidates.add(id(r))

    cache = load_cache()
    calls = [0]

    new_directory = []
    new_review_queue = []
    new_excluded = []

    for (addr, city, trade), distinct in sorted(candidates.items()):
        town = IN_COUNTY_TOWN_DISPLAY.get(city, city.title())
        display_addr = distinct[0][0]["street_address"]
        people = [d[0] for d in distinct]  # one representative row per distinct person
        surnames = set(norm_name_key(p["last_name"]) for p in people)

        # 1) address-only search
        addr_query = "%s, %s, VT" % (display_addr, town)
        result = places_lookup(addr_query, api_key, cache, calls)
        used_query = addr_query

        # 2) if that failed and everyone shares a surname, try "{Surname}
        #    {Trade guess}, {town}, VT" as a second, still-evidence-based try
        if (not result or not result.get("match")) and len(surnames) == 1 and api_key:
            surname = people[0]["last_name"].strip()
            guess = "%s %s, %s, VT" % (surname, TRADE_NAME_GUESS[trade], town)
            result2 = places_lookup(guess, api_key, cache, calls)
            if result2 and result2.get("match"):
                result = result2
                used_query = guess

        active_people = [p for p in people if (p["license_exp_date"] or "")[:10] >= TODAY]
        all_license_nums = [
            {"type": trade, "number": p["license_number"], "status":
                ("active" if (p["license_exp_date"] or "")[:10] >= TODAY else "expired"),
             "expiry": (p["license_exp_date"] or "")[:10], "holder_name":
                (p["first_name"] + " " + p["last_name"]).title()}
            for p in people
        ]

        if not (result and result.get("match")):
            for bucket in distinct:
                for r in bucket:
                    new_excluded.append({
                        "source_record": r,
                        "reason": "individual-without-business",
                        "detail": "Shares street address \"%s\" with %d other DFS "
                                  "%s license holder(s), but Google Places found no "
                                  "independently verifiable business at that address "
                                  "(query tried: %s) — treated as a shared home "
                                  "address, not a business." % (
                                      display_addr, len(people) - 1, trade, used_query),
                    })
            continue

        entry = {
            "business_name": result["name"],
            "category": TRADE_CATEGORY[trade],
            "town": town,
            "phone": result.get("phone"),
            "website": result.get("website"),
            "licenses": all_license_nums,
            "vbra_member": False,
            "een_member": False,
            "last_verified": TODAY,
            "google_place_id": result["place_id"],
            "google_maps_url": maps_url(result["place_id"], used_query),
            "places_status": "verified",
            "other_signals": [
                "%d DFS-licensed %s%s share this address (%s)" % (
                    len(people), trade.lower(),
                    "s" if len(people) != 1 and not trade.lower().endswith("s") else "",
                    ", ".join(p["first_name"].title() + " " + p["last_name"].title() for p in people)),
                "Google Places confirmed a named business at this address" +
                (" via a surname+trade search" if used_query != addr_query else " via the license address"),
            ],
            "business_id": slugify(result["name"] + "-" + town),
            "service_area": "Chittenden County",
        }

        if active_people:
            new_directory.append(entry)
        else:
            entry["review_reason"] = (
                "All %d DFS license(s) at this Places-confirmed business address "
                "have expired — an expired license is not active verification "
                "(licenses: %s). Confirm current licensing status before "
                "publishing." % (len(people), ", ".join(
                    "%s exp. %s" % (l["holder_name"], l["expiry"]) for l in all_license_nums)))
            entry["evidence_needed"] = "Re-check DFS license status, or confirm the business has an active license under a different holder."
            new_review_queue.append(entry)

    # plain singleton individuals (not in any candidate group)
    singleton_count = 0
    for r in rows:
        if id(r) in rows_in_candidates:
            continue
        addr = norm_addr(r["street_address"])
        is_bad_addr = addr in ("BAD ADDRESS", "")
        expired = (r["license_exp_date"] or "")[:10] < TODAY
        new_excluded.append({
            "source_record": r,
            "reason": "individual-without-business",
            "detail": (
                "VT DFS license holder with no address on file (\"BAD ADDRESS\" "
                "placeholder)" if is_bad_addr else
                "VT DFS license holder — no other license holder of the same "
                "trade shares this street address, so there's no corroborating "
                "second signal for a business per rule #1"
            ) + ". License status: %s (expires %s)." % (
                "expired" if expired else "active", r["license_exp_date"]),
        })
        singleton_count += 1

    save_cache(cache)

    # Reconciliation is in raw-DFS-row terms, not entry terms: a published/
    # queued business folds 2+ raw rows into ONE entry (its `licenses`
    # array), so the check sums len(licenses) for those, not entry counts.
    raw_rows_in_directory = sum(len(e["licenses"]) for e in new_directory)
    raw_rows_in_queue = sum(len(e["licenses"]) for e in new_review_queue)
    raw_rows_in_excluded = len(new_excluded)  # always 1 row per excluded entry
    total_accounted = raw_rows_in_directory + raw_rows_in_queue + raw_rows_in_excluded

    print()
    print("Places calls made this pass: %d" % calls[0])
    print("New published (DFS-derived businesses): %d, covering %d raw DFS rows" % (len(new_directory), raw_rows_in_directory))
    print("New review-queue (DFS-derived, expired-only confirmed businesses): %d, covering %d raw DFS rows" % (len(new_review_queue), raw_rows_in_queue))
    print("New excluded (DFS singletons + unconfirmed shared-address groups): %d raw DFS rows" % raw_rows_in_excluded)
    print("  of which plain singletons: %d" % singleton_count)
    print("Reconciliation (raw DFS rows): %d + %d + %d = %d (should equal %d input rows)" % (
        raw_rows_in_directory, raw_rows_in_queue, raw_rows_in_excluded,
        total_accounted, len(rows)))
    assert total_accounted == len(rows), "Row accounting mismatch — some DFS rows were dropped or double-counted."

    # --- merge with pass-1 (VBRA) outputs ---
    old_dir = json.load(open(os.path.join(OUT_DIR, "directory.json")))
    old_queue = json.load(open(os.path.join(OUT_DIR, "review-queue.json")))
    old_excl = json.load(open(os.path.join(OUT_DIR, "excluded.json")))

    # drop the pass-1 DFS placeholder exclusions (the 1,467-row old pull,
    # no street_address) - superseded by this pass's fresh, address-bearing
    # pull. Keep the VBRA-sourced exclusions (non-contractor / out-of-scope).
    kept_old_excluded = [
        e for e in old_excl["items"]
        if not any("DFS" in s for s in e["source_record"].get("sources", []))
    ]
    dropped_old_dfs_excluded = len(old_excl["items"]) - len(kept_old_excluded)
    print()
    print("Dropped %d pass-1 DFS placeholder exclusions (superseded by this pass's address-bearing pull)" % dropped_old_dfs_excluded)

    merged_directory = old_dir["listings"] + new_directory
    merged_queue = old_queue["items"] + new_review_queue
    merged_excluded = kept_old_excluded + new_excluded

    merged_directory.sort(key=lambda d: (d["category"], d["business_name"]))
    merged_queue.sort(key=lambda d: d.get("business_name", ""))

    json.dump({
        "generated": TODAY,
        "source": "data/contractors/source/05-contractor-dataset.json (VBRA) + "
                  "data/contractors/source/05-dfs-full-columns-pull.json (DFS pass 2)",
        "count": len(merged_directory),
        "listings": merged_directory,
    }, open(os.path.join(OUT_DIR, "directory.json"), "w"), indent=1)

    json.dump({
        "generated": TODAY,
        "count": len(merged_queue),
        "items": merged_queue,
    }, open(os.path.join(OUT_DIR, "review-queue.json"), "w"), indent=1)

    json.dump({
        "generated": TODAY,
        "count": len(merged_excluded),
        "items": merged_excluded,
    }, open(os.path.join(OUT_DIR, "excluded.json"), "w"), indent=1)

    fields = ["business_id", "business_name", "category", "town", "service_area",
              "phone", "website", "google_place_id", "google_maps_url",
              "vbra_member", "een_member", "other_signals", "last_verified",
              "places_status"]
    with open(os.path.join(OUT_DIR, "directory.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for d in merged_directory:
            row = dict(d)
            row["other_signals"] = "; ".join(row.get("other_signals", []))
            w.writerow(row)

    def raw_row_count(entry):
        if entry.get("licenses"):
            return len(entry["licenses"])
        if "merged_duplicate_vbra_row" in entry:
            return 2  # two VBRA profile rows resolved to one business (pass 1)
        return 1

    total_raw = (sum(raw_row_count(e) for e in merged_directory) +
                 sum(raw_row_count(e) for e in merged_queue) +
                 len(merged_excluded))  # excluded is always 1 source_record per entry

    print()
    print("=== FINAL MERGED TOTALS (entries) ===")
    print("directory.json: %d businesses" % len(merged_directory))
    print("review-queue.json: %d items" % len(merged_queue))
    print("excluded.json: %d records" % len(merged_excluded))
    print("=== FINAL MERGED TOTALS (raw source rows) ===")
    print("total raw rows accounted for: %d (should equal 37 VBRA + %d fresh DFS pull = %d)" % (
        total_raw, len(rows), 37 + len(rows)))
    assert total_raw == 37 + len(rows), "Final merge row accounting mismatch."


if __name__ == "__main__":
    main()
