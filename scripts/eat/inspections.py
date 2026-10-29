#!/usr/bin/env python3
"""Build data/eat/inspections.json: the Vermont Department of Health's food
inspection history for every restaurant in data/restaurants.json.

Where it comes from: the Health Department's public inspection portal
(https://vtdoh.safefoodinspection.com/Inspection/PublicInspectionSearch.aspx).
It has every retail food inspection since May 2016. There is no download or
API, so this script fills in the portal's search form the way a browser does
(an ASP.NET page that posts its own state back), reads the results table, and
for each matched restaurant opens the latest inspection's PDF report and pulls
the "Observations and Corrective Actions" lines out of it.

Every violation gets a plain-English line from data/eat/inspection-key.json.
Every record carries the inspection date and the date we checked, so the app
can say "inspected 4 months ago" instead of implying it is current.

Needs `pdftotext` (poppler) on the PATH. Polite by default: one request a
second.

Usage:
    python3 scripts/eat/inspections.py                 # all towns, latest PDF per restaurant
    python3 scripts/eat/inspections.py --town Winooski # one town (testing)
    python3 scripts/eat/inspections.py --no-pdf        # dates and scores only
    python3 scripts/eat/inspections.py --limit 5       # first 5 matched PDFs (testing)
"""

import argparse
import datetime
import difflib
import html
import http.cookiejar
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
RESTAURANTS = ROOT / "data" / "restaurants.json"
KEY = ROOT / "data" / "eat" / "inspection-key.json"
OUT = ROOT / "data" / "eat" / "inspections.json"

HOST = "https://vtdoh.safefoodinspection.com"
SEARCH = HOST + "/Inspection/PublicInspectionSearch.aspx"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 (btownbrief.com guide)")
VERMONT = "116"           # the portal's state dropdown value for Vermont
YEARS_BACK = 4            # how far back the history list goes
PAUSE = 1.0               # seconds between requests
GRID = "ctl00$MainContent$gvInspections"

# Restaurants whose portal name differs too much to match automatically:
# restaurants.json id -> portal establishment Key (the number on the
# "Past Inspection(s)" link). Add pairs here when the report lists a miss.
MANUAL_KEYS = {}


class Portal:
    def __init__(self):
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        self.state = {}

    def _open(self, url, data=None):
        time.sleep(PAUSE)
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
        with self.opener.open(req, timeout=90) as resp:
            return resp.read()

    def _post(self, extra):
        form = dict(self.state)
        form.update(self.fields)
        form.update(extra)
        page = self._open(SEARCH, form).decode("utf-8", "replace")
        self.state = hidden_fields(page)
        return page

    def search(self, town, begin, end):
        page = self._open(SEARCH).decode("utf-8", "replace")
        self.state = hidden_fields(page)
        self.fields = {
            "ctl00$MainContent$txtCity": town,
            "ctl00$MainContent$wucStateCountiesFS$ddlState": VERMONT,
            "ctl00$MainContent$hfUseRadius": "false",
            "ctl00$MainContent$dteInspectionBeginDate$txtDate": begin.strftime("%m/%d/%Y"),
            "ctl00$MainContent$dteInspectionEndDate$txtDate": end.strftime("%m/%d/%Y"),
        }
        return self._post({"ctl00$MainContent$btnSearch": "Search"})

    def page(self, n):
        return self._post({"__EVENTTARGET": GRID, "__EVENTARGUMENT": f"Page${n}"})

    def report_pdf(self, button_name):
        """Press a report button on the current results page; return PDF bytes."""
        page = self._post({button_name + ".x": "6", button_name + ".y": "6"})
        m = re.search(r"window\.open\('(/Common/ExternalFileViewer\.aspx\?[^']+)'", page)
        if not m:
            return None
        data = self._open(HOST + html.unescape(m.group(1)))
        return data if data[:4] == b"%PDF" else None


def hidden_fields(page):
    return {html.unescape(m.group(1)): html.unescape(m.group(2)) for m in re.finditer(
        r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', page)}


def text(fragment):
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", " ", fragment))


def mdy(s):
    return datetime.datetime.strptime(s.strip(), "%m/%d/%Y").date()


def parse_results(page):
    """Rows of the top-level results grid on one page."""
    rows = []
    grid = page[page.find('id="MainContent_gvInspections"'):]
    # Each establishment row opens with a 20%-wide name cell; past inspections
    # nest inside it, so slice from one name cell to the next.
    starts = [m.start() for m in re.finditer(r'<td style="width:20%;">', grid)]
    for i, s in enumerate(starts):
        chunk = grid[s:starts[i + 1] if i + 1 < len(starts) else len(grid)]
        m = re.match(r'<td style="width:20%;">(.*?)</td><td[^>]*>([^<]*)</td><td[^>]*>([^<]*)</td>'
                     r'<td[^>]*>([^<]*)</td>', chunk, re.S)
        if not m or not m.group(2).strip():
            continue
        name_block, date, kind, score = m.groups()
        name = html.unescape(name_block.split("<BR>")[0].strip())
        divs = [html.unescape(re.sub(r"\s+", " ", d)).strip()
                for d in re.findall(r"<div[^>]*>(.*?)</div>", name_block, re.S)]
        btn = re.search(r'name="(ctl00\$MainContent\$gvInspections\$ctl\d+\$btnInspectionReport)"', chunk)
        key = re.search(r'lnkPastInspections_\d+" Key="(\d+)"', chunk)
        past = re.findall(r'<td align="center">(\d\d/\d\d/\d{4})</td><td[^>]*>([^<]*)</td>', chunk)
        rows.append({
            "portal_name": re.sub(r"\s+", " ", name),
            "portal_address": divs[0] if divs else "",
            "phone": divs[1] if len(divs) > 1 and divs[1] else None,
            "portal_key": key.group(1) if key else None,
            "date": mdy(date).isoformat(),
            "type": kind.strip(),
            "score": int(score) if score.strip().isdigit() else None,
            "button": btn.group(1) if btn else None,
            "history": [{"date": mdy(d).isoformat(), "type": t.strip()} for d, t in past],
        })
    return rows


def next_page_exists(page, n):
    return f"Page${n}" in html.unescape(page)


# ---------- matching to data/restaurants.json ----------

STOP = {"the", "and", "of", "llc", "inc", "co", "cafe", "restaurant", "bar", "&", "vt"}


def norm_name(s):
    s = re.sub(r"[’'`]", "", s.lower())
    return " ".join(w for w in re.findall(r"[a-z0-9]+", s) if w not in STOP)


def street_key(addr):
    """'1 MILL ST STE 138 BURLINGTON, VT 05401' -> ('1', 'mill')."""
    m = re.match(r"\s*(\d+)[a-z]?\s+(.*)", (addr or "").lower())
    if not m:
        return None
    words = [w for w in re.findall(r"[a-z]+", m.group(2)) if w not in
             {"n", "s", "e", "w", "north", "south", "east", "west", "st", "street", "ave", "avenue", "rd", "road", "dr", "drive", "pl", "place"}]
    return (m.group(1), words[0] if words else "")


def town_of(addr):
    m = re.search(r",\s*([A-Za-z .]+),\s*VT", addr or "")
    return m.group(1).strip().title() if m else None


def match(restaurants, rows):
    """Best portal row for each restaurant: same street number + street word
    and a fair name match, or a strong name match in the same town."""
    out = {}
    by_key = {r["portal_key"]: r for r in rows if r["portal_key"]}
    for rest in restaurants:
        if rest["id"] in MANUAL_KEYS and MANUAL_KEYS[rest["id"]] in by_key:
            out[rest["id"]] = (by_key[MANUAL_KEYS[rest["id"]]], "manual")
            continue
        rk, rn, rt = street_key(rest.get("address")), norm_name(rest["name"]), town_of(rest.get("address"))
        best, best_score, how = None, 0.0, None
        for row in rows:
            nscore = difflib.SequenceMatcher(None, rn, norm_name(row["portal_name"])).ratio()
            if rn and (rn in norm_name(row["portal_name"]) or norm_name(row["portal_name"]) in rn):
                nscore = max(nscore, 0.85)
            same_street = rk is not None and rk == street_key(row["portal_address"])
            same_town = rt and rt.upper() in row["portal_address"].upper()
            score = nscore + (0.5 if same_street else 0)
            if same_street and nscore >= 0.45 or (same_town and nscore >= 0.9):
                if score > best_score:
                    best, best_score, how = row, score, "address+name" if same_street else "name+town"
        if best:
            out[rest["id"]] = (best, how)
    return out


# ---------- the PDF ----------

def parse_pdf(data, key):
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(data)
        f.flush()
        txt = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True,
                             text=True, check=True).stdout
    info = {}
    m = re.search(r"(\d{4} - [A-Za-z][^\n]*?License)", txt)
    info["license_type"] = re.sub(r"^\d+ - ", "", m.group(1)).strip() if m else None
    m = re.search(r"Total Debit Points:\s*(\d+)", txt)
    info["debit_points"] = int(m.group(1)) if m else None
    section = txt.split("Observations and Corrective Actions", 1)
    violations = []
    if len(section) == 2:
        body = section[1].split("Inspection Published Comment:", 1)[0]
        current = None
        for line in body.split("\n"):
            m = re.match(r"\s{0,3}(\d+(?:\([a-z]\))?)\s{2,}(\d-\d{3}\.\d+\S*)?\s+(.*)", line)
            if m and not line.strip().startswith(("Item", "Number", "Violations cited")):
                item, code, rest = m.groups()
                current = {"item": item, "code": code, "comment": rest.strip()}
                violations.append(current)
            elif current and line.strip() and not re.search(r"^\s*(Co|py|al|fic|i|Un|of)\s*$", line):
                if "Correct By" in line or "Item" in line.split()[:1]:
                    continue
                current["comment"] += " " + line.strip()
    for v in violations:
        c = re.sub(r"[\x00-\x1f]", "", v["comment"])
        # The layout flattens three columns into the comment: a leading
        # priority letter, "COS" (corrected on site) and a correct-by date.
        m = re.match(r"([A-Z])\s+(?=[A-Z][a-z])", c)
        v["priority"] = m.group(1) if m else None
        if m:
            c = c[m.end():]
        v["corrected_on_site"] = bool(re.search(r"\bCOS\b", c))
        c = re.sub(r"\s*\bCOS\b\s*", " ", c)
        d = re.search(r"\s(\d\d/\d\d/\d{4})\s", " " + c + " ")
        v["correct_by"] = mdy(d.group(1)).isoformat() if d else None
        if d:
            c = c.replace(d.group(1), " ")
        v["comment"] = re.sub(r"\s+", " ", c).strip()
        k = key["items"].get(v["item"]) or key["items"].get(re.sub(r"\(.*", "", v["item"]), {})
        v["category"] = k.get("form_label")
        v["critical"] = bool(k.get("critical"))
        v["plain_english"] = k.get("plain_english", "Not in our key yet; read the inspector's note.")
        # The inspector's note is "what the rule says- what to do"; keep both halves.
        v["inspector_note"] = v.pop("comment")
    info["violations"] = violations
    info["critical_count"] = sum(1 for v in violations if v["critical"])
    return info


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--town", action="append", help="limit to a town (repeatable)")
    ap.add_argument("--no-pdf", action="store_true", help="skip the PDF reports")
    ap.add_argument("--limit", type=int, default=0, help="stop after N PDFs (testing)")
    args = ap.parse_args()

    today = datetime.date.today()
    key = json.loads(KEY.read_text())
    restaurants = [r for r in json.loads(RESTAURANTS.read_text())["restaurants"] if not r.get("closed")]
    towns = sorted({t for t in (town_of(r.get("address")) for r in restaurants) if t})
    if args.town:
        towns = [t.title() for t in args.town]

    portal = Portal()
    begin = today.replace(year=today.year - YEARS_BACK)
    records, pdfs, seen = {}, 0, set()
    for town in towns:
        local = [r for r in restaurants if town_of(r.get("address")) == town]
        n, page = 1, portal.search(town, begin, today)
        town_rows = 0
        while True:
            rows = [r for r in parse_results(page) if r["portal_key"] not in seen]
            seen.update(r["portal_key"] for r in rows)
            town_rows += len(rows)
            for rid, (row, how) in match(local, rows).items():
                if rid in records and records[rid]["latest"]["date"] >= row["date"]:
                    continue
                latest = {"date": row["date"], "type": row["type"], "score": row["score"]}
                if not args.no_pdf and row["button"] and (not args.limit or pdfs < args.limit):
                    try:
                        data = portal.report_pdf(row["button"])
                        if data:
                            latest.update(parse_pdf(data, key))
                            pdfs += 1
                    except Exception as e:  # one bad report should not sink the run
                        latest["pdf_error"] = str(e)[:200]
                if latest.get("score") is not None:
                    # Vermont's pass rule: 70+ and no uncorrected critical violations.
                    latest["passed_score"] = latest["score"] >= 70
                latest["age_days"] = (today - datetime.date.fromisoformat(row["date"])).days
                records[rid] = {
                    "restaurant_id": rid,
                    "portal_name": row["portal_name"],
                    "portal_address": row["portal_address"],
                    "portal_key": row["portal_key"],
                    "match": how,
                    "latest": latest,
                    "history": row["history"],
                    "as_of": today.isoformat(),
                    "source_url": SEARCH,
                }
            n += 1
            if not next_page_exists(page, n):
                break
            page = portal.page(n)
        print(f"{town}: {town_rows} portal rows, {sum(1 for r in local if r['id'] in records)}/{len(local)} matched",
              file=sys.stderr)

    missing = [{"id": r["id"], "name": r["name"], "address": r.get("address")}
               for r in restaurants if r["id"] not in records and town_of(r.get("address")) in towns]
    out = {
        "updated": today.isoformat(),
        "note": ("Vermont Department of Health retail food inspections, read from the public portal. "
                 "'as_of' is the day we checked; 'latest.date' is the day the inspector visited. "
                 "Show the visit date and its age on every record: an old inspection is old news. "
                 "Scores: 100 minus debit points; passing is 70+ with no uncorrected critical violations. "
                 "A violation listed here may already have been corrected on site."),
        "source_url": "https://www.healthvermont.gov/environment/food-lodging-program/inspection-reports",
        "portal_url": SEARCH,
        "key": "data/eat/inspection-key.json",
        "towns": towns,
        "counts": {"restaurants": len(restaurants), "matched": len(records), "with_violations_parsed": pdfs},
        "records": sorted(records.values(), key=lambda r: r["restaurant_id"]),
        "unmatched": missing,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(records)} matched, {len(missing)} unmatched, {pdfs} reports parsed",
          file=sys.stderr)


if __name__ == "__main__":
    main()
