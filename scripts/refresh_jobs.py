#!/usr/bin/env python3
"""
Refresh data/jobs.json, the link-only feed behind the Burlington jobs page.

Institutional boards (one list request each):
  - Seven Days Jobs              local WordPress job-feed RSS
  - University of Vermont       UVM's one-week postings Atom feed
  - City of Burlington          GovernmentJobs search results
  - City of South Burlington    GovernmentJobs search results
  - State of Vermont            Burlington-area careers search results
  - UVM Medical Center          UVMMC cards plus up to eight new-job details

Employer ATS boards (public JSON endpoints, adapters ported from the
job-radar project):
  - GlobalFoundries             Workday CxS API (Essex Junction search)
  - Beta Technologies           Greenhouse boards API
  - OnLogic                     Workable widget API
  - Howard Center               UKG Pro job board API
  - CHCB / EastRise             ADP Workforce Now requisitions API
  - Common Good Vermont         WP Job Manager REST API (Chittenden only)

Only listing metadata is stored: title, employer, pay, posted date, URL,
source, one derived category, and derived filter tags. Descriptions are
fetched by some adapters solely to find a pay figure and are never retained.
Pay is also normalized to an hourly range (pay_hr) so the $25/hr filter
compares like with like. Each source is isolated; a failed or empty source
keeps its last good entries, which then age out normally after 21 days. If
every source fails, the file is untouched.

Run:  python3 scripts/refresh_jobs.py
"""

import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


UA = "btownbrief.com jobs page (stephenvdavis@gmail.com)"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36")
BTV_TZ = ZoneInfo("America/New_York")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "jobs.json")

SEVEN_URL = "https://jobs.sevendaysvt.com/?feed=job_feed&search_location=Burlington"
UVM_URL = "https://www.uvmjobs.com/postings/search.atom?query=&query_v0_posted_at_date=week"
GOVJOBS_URL = ("https://www.governmentjobs.com/careers/home/index?agency={agency}"
               "&sort=PostingDate&isDescendingSort=true")
STATE_URL = ("https://careers.vermont.gov/search/?q=&location=Burlington"
             "&sortColumn=referencedate&sortDirection=desc")
MED_URL = ("https://uvmhealthcareers.org/jobs/"
           "?entity=uvmmc-the-university-of-vermont-medical-center")

SOURCE_ORDER = ["Seven Days", "UVM", "City of Burlington", "City of South Burlington",
                "State of Vermont", "UVM Med Center", "GlobalFoundries",
                "Beta Technologies", "OnLogic", "Howard Center", "CHCB",
                "EastRise", "Common Good VT"]
SOURCE_SLUGS = {
    "Seven Days": "seven-days",
    "UVM": "uvm",
    "City of Burlington": "city-of-burlington",
    "City of South Burlington": "city-of-south-burlington",
    "State of Vermont": "state-of-vermont",
    "UVM Med Center": "uvm-med-center",
    "GlobalFoundries": "globalfoundries",
    "Beta Technologies": "beta",
    "OnLogic": "onlogic",
    "Howard Center": "howard-center",
    "CHCB": "chcb",
    "EastRise": "eastrise",
    "Common Good VT": "common-good",
}
LOCAL_PLACES = ("burlington", "south burlington", "winooski", "essex",
                "colchester", "williston", "shelburne")
STATE_PLACES = LOCAL_PLACES[:-1]

# How many postings the file may hold. This is a safety bound, not a target:
# it must stay comfortably above what the sources actually supply, or the
# newest-first sort lets the most prolific source (UVM, which posts daily)
# crowd the smaller ones out. With thirteen sources feeding the file the
# realistic 21-day population is ~100-130 rows. The 14-day window in
# js/jobs.js is what really governs what readers see.
MAX_JOBS = 150


def fetch_text(url, browser=False, headers=None):
    request_headers = {"User-Agent": BROWSER_UA if browser else UA}
    request_headers.update(headers or {})
    req = urllib.request.Request(url, headers=request_headers)
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.read().decode("utf-8", errors="replace")


def fetch_json(url, post_json=None, headers=None):
    request_headers = {"User-Agent": BROWSER_UA, "Accept": "application/json"}
    request_headers.update(headers or {})
    body = None
    if post_json is not None:
        body = json.dumps(post_json).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=request_headers)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res)


def clean_text(value):
    """Turn a small HTML fragment into normalized display text."""
    value = re.sub(r"<[^>]*>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def attr(tag, name):
    match = re.search(rf"\b{re.escape(name)}\s*=\s*([\"'])(.*?)\1", tag,
                      re.I | re.S)
    return html.unescape(match.group(2)) if match else None


def local_date(dt):
    """The Burlington calendar date of a datetime (tz-aware or naive)."""
    if dt.tzinfo is not None:
        dt = dt.astimezone(BTV_TZ)
    return dt.date().isoformat()


def iso_date(value):
    """Read the ISO timestamps used by the Atom and JSON-LD sources."""
    return local_date(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))


def rfc822_date(value):
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%d %b %Y %H:%M:%S %z"):
        try:
            return local_date(datetime.strptime(value.strip(), fmt))
        except ValueError:
            pass
    raise ValueError(f"unrecognized RSS date: {value!r}")


def stable_id(source, url):
    path = urllib.parse.urlparse(url).path
    patterns = {
        "UVM": r"/postings/(\d+)",
        "City of Burlington": r"/jobs/(\d+)",
        "City of South Burlington": r"/jobs/(\d+)",
        "State of Vermont": r"/(\d+)/?$",
        "UVM Med Center": r"/job/(\d+)",
        "GlobalFoundries": r"_([A-Za-z0-9-]+)$",
    }
    match = re.search(patterns.get(source, r"(?!)"), path)
    suffix = match.group(1) if match else hashlib.sha1(url.encode()).hexdigest()[:12]
    return f"{SOURCE_SLUGS[source]}-{suffix}"


# ---------------------------------------------------------------------------
# Pay normalization, ported from the job-radar (radarlib/match.py). Turns
# "$52,000 - $62,000 Annually" and "$26.50/hr" into the same hourly range so
# the $25+/hr filter is a real comparison instead of a regex guess.
# ---------------------------------------------------------------------------

FULL_TIME_HOURS = 2080  # converts annual salaries to an hourly figure

# Money amount: $60,000 / $26.50 / $60k. Group 1 = number, group 2 = k-suffix.
_MONEY = r"\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?"
# Optional unit wording that may follow the FIRST endpoint of a range
# ("$20/hour - $30/hour", "$52,000 per year to $62,000 per year").
_UNIT = r"(?:\s*(?:/\s*(?:hour|hr|year|yr)|per\s+(?:hour|year)|hourly|annually))?"
_RANGE = rf"{_MONEY}{_UNIT}\s*(?:-|–|—|to)\s*{_MONEY}"

PAY_WORDS = ("salary", "pay", "compensation", "wage", "rate", "hour", "/hr",
             "hourly", "per year", "/yr", "annual", "starting at")
FEE_WORDS = ("fee", "bonus", "deposit", "stipend", "reimburs", "allowance",
             "grant", "budget", "million", "tuition")


def _to_float(num, k_suffix):
    val = float(num.replace(",", ""))
    return val * 1000 if k_suffix else val


def parse_pay(text):
    """Extract (min_hourly, max_hourly, raw_snippet) from posting text.

    Annual figures are normalized to hourly so everything compares against
    the $25/hr floor. Returns (None, None, None) when no pay is found.
    """
    if not text:
        return None, None, None
    text = text.replace(" ", " ")

    def classify(lo, hi, context):
        hourly_ctx = any(w in context for w in ("hour", "/hr", "hr.", "hourly"))
        annual_ctx = any(w in context for w in ("year", "/yr", "annual", "salary"))
        # Sub-250 figures count only with explicit hourly context — an
        # unlabeled "$50" is a guess, and this site doesn't guess pay.
        if hi < 250 and hourly_ctx:
            got = (lo, hi)  # dollars/hour
        elif hi >= 1000:
            got = (lo / FULL_TIME_HOURS, hi / FULL_TIME_HOURS)  # dollars/year
        else:
            return None
        # Plausibility bounds: job pay, not grant budgets or fee amounts.
        if not (7.0 <= got[1] <= 150.0) or got[0] < 5.0:
            return None
        return got

    def fee_nearby(start, end):
        near = text[max(0, start - 20): end + 30].lower()
        return any(w in near for w in FEE_WORDS)

    # Collect candidates and prefer: ranges over single figures, then amounts
    # near pay words, then the earliest mention (a page's own pay field comes
    # before dollar figures buried in a description).
    candidates = []
    range_spans = []
    for m in re.finditer(_RANGE, text):
        lo, hi = sorted((_to_float(m.group(1), m.group(2)),
                         _to_float(m.group(3), m.group(4))))
        range_spans.append(m.span())
        if fee_nearby(m.start(), m.end()):
            continue
        context = text[max(0, m.start() - 50): m.end() + 50].lower()
        got = classify(lo, hi, context)
        if got:
            rank = 2 + (2 if any(w in context for w in PAY_WORDS) else 0)
            candidates.append((-rank, m.start(), (got[0], got[1], m.group(0).strip())))
    for m in re.finditer(_MONEY, text):
        if any(s <= m.start() < e for s, e in range_spans):
            continue  # already part of a range
        if fee_nearby(m.start(), m.end()):
            continue
        val = _to_float(m.group(1), m.group(2))
        context = text[max(0, m.start() - 50): m.end() + 50].lower()
        got = classify(val, val, context)
        if got:
            rank = 2 if any(w in context for w in PAY_WORDS) else 0
            candidates.append((-rank, m.start(), (got[0], got[1], m.group(0).strip())))
    if not candidates:
        return None, None, None
    _, _, (lo, hi, raw) = min(candidates)
    return round(lo, 2), round(hi, 2), raw


# ---------------------------------------------------------------------------
# Categories. Deterministic, no scoring: a title keyword wins, otherwise the
# source's default. "other" only when neither says anything.
# ---------------------------------------------------------------------------

SOURCE_CATEGORY = {
    "UVM": "education",
    "UVM Med Center": "healthcare",
    "City of Burlington": "government",
    "City of South Burlington": "government",
    "State of Vermont": "government",
    "GlobalFoundries": "tech",
    "Beta Technologies": "tech",
    "OnLogic": "tech",
    "Howard Center": "healthcare",
    "CHCB": "healthcare",
    "EastRise": "office",
    "Common Good VT": "community",
    "Seven Days": None,
}

# Checked in order — the specific before the generic, so "Clinical Nurse
# Manager" is healthcare (not office) and "School Custodian" is trades (not
# education).
CAT_RULES = [
    ("healthcare", re.compile(
        r"\b(nurse|nursing|clinic|clinical|patient|medical|dental|dentist|"
        r"pharmac\w*|therapist|therapy|behavioral|psychiatr\w*|hospice|"
        r"phlebotom\w*|surgical|radiolog\w*|LNA|RN|caregiver|resident care|"
        r"direct support|health)\b", re.I)),
    ("trades", re.compile(
        r"\b(custodian|custodial|janitor|housekeep\w*|maintenance|mechanic|"
        r"electrician|plumber|plumbing|carpenter|HVAC|driver|CDL|cook|chef|"
        r"dishwasher|server|barista|bartender|cashier|retail|warehouse|"
        r"groundskeeper|grounds|landscap\w*|laborer|food service|dining|"
        r"delivery|cleaner|parking|line worker|machine operator|security|"
        r"cafe|café|coffee|kitchen|deli|grocery)\b", re.I)),
    ("education", re.compile(
        r"\b(teacher|professor|faculty|instructor|lecturer|tutor|school|"
        r"childcare|child care|preschool|paraeducator|librarian|academic|"
        r"education|postdoc\w*)\b", re.I)),
    ("tech", re.compile(
        r"\b(software|engineer\w*|developer|technician|scientist|"
        r"manufactur\w*|machinist|semiconductor|fab|systems|network|"
        r"cybersecurity|technolog\w*)\b", re.I)),
    ("community", re.compile(
        r"\b(social worker|case manager|outreach|volunteer|community|"
        r"counselor|advocate|shelter|youth|peer support|recovery)\b", re.I)),
    ("office", re.compile(
        r"\b(accountant|accounting|finance|financial|payroll|billing|"
        r"human resources|HR|marketing|communications|administrat\w*|"
        r"assistant|coordinator|clerk|receptionist|customer service|teller|"
        r"paralegal|attorney|analyst|manager|director|specialist|planner|"
        r"buyer|scheduler)\b", re.I)),
]


def categorize(source, title):
    for cat, rule in CAT_RULES:
        if rule.search(title):
            return cat
    return SOURCE_CATEGORY.get(source) or "other"


NO_DEGREE = re.compile(
    r"\b(?:driver|custodian|custodial|laborer|cook|dishwasher|housekeeper|"
    r"housekeeping|groundskeeper|maintenance|attendant|cashier|warehouse|"
    r"delivery|cleaner|clerk|security officer|food service|dining|"
    r"retail associate|line worker|nurse assistant|LNA|machine operator)\b",
    re.I,
)


def job_tags(source, title, pay_lo, employment_type=""):
    """Derive only the documented filter tags from listing metadata."""
    tags = []
    combined = f"{title} {employment_type}"
    # no-degree was inferred from title keywords alone — a guess about
    # requirements, removed until real qualification data exists.
    if pay_lo is not None and pay_lo >= 25:
        tags.append("pay25")
    if re.search(r"\bweekend\b", combined, re.I):
        tags.append("weekend")
    if re.search(r"\b(?:seasonal|summer|temporary)\b", combined, re.I):
        tags.append("seasonal")
    return tags


def make_job(source, title, employer, posted, url, pay=None, employment_type="",
             pay_text="", location=None):
    """pay is the source's own display string; pay_text is throwaway text
    (a description or salary line) searched for a figure and never stored."""
    title = clean_text(title)
    employer = clean_text(employer)
    url = urllib.parse.urldefrag(url)[0]
    pay = clean_text(pay) if pay else None
    lo, hi, raw = parse_pay(pay or pay_text or "")
    job = {
        "id": stable_id(source, url),
        "title": title,
        "employer": employer,
        "pay": pay or raw,
        "pay_hr": [lo, hi] if lo is not None else None,
        "posted": posted,
        "url": url,
        "source": source,
        "cat": categorize(source, title),
        "tags": job_tags(source, title, lo, employment_type),
    }
    if location:
        job["location"] = clean_text(location)
    return job


# ---------------------------------------------------------------------------
# Institutional boards (unchanged from v1, minus the parametrized NeoGov).
# ---------------------------------------------------------------------------

def fetch_seven_days(_previous):
    root = ET.fromstring(fetch_text(SEVEN_URL))
    ns = {"job": "https://jobs.sevendaysvt.com"}
    jobs = []
    for item in root.findall("./channel/item"):
        location = item.findtext("job:location", default="", namespaces=ns)
        if not any(place in location.lower() for place in LOCAL_PLACES):
            continue
        title = item.findtext("title")
        url = item.findtext("link")
        employer = item.findtext("job:company", default="", namespaces=ns)
        posted = rfc822_date(item.findtext("pubDate") or "")
        employment_type = item.findtext("job:job_type", default="", namespaces=ns)
        if title and url and employer:
            jobs.append(make_job("Seven Days", title, employer, posted, url,
                                 employment_type=employment_type))
    return jobs


def fetch_uvm(_previous):
    root = ET.fromstring(fetch_text(UVM_URL))
    atom = {"a": "http://www.w3.org/2005/Atom"}
    jobs = []
    for entry in root.findall("a:entry", atom):
        link = entry.find("a:link[@rel='alternate']", atom)
        title = entry.findtext("a:title", namespaces=atom)
        published = entry.findtext("a:published", namespaces=atom)
        url = link.get("href") if link is not None else None
        if title and published and url:
            jobs.append(make_job("UVM", title, "University of Vermont",
                                 iso_date(published), url))
    return jobs


def relative_city_date(text):
    text = clean_text(text)
    if re.search(r"Posted\s+(?:30\+|more\s+than\s+30)\s+days", text, re.I):
        return None
    today = datetime.now(BTV_TZ).date()
    if re.search(r"Posted\s+today", text, re.I):
        days = 0
    elif re.search(r"Posted\s+yesterday", text, re.I):
        days = 1
    else:
        match = re.search(r"Posted\s+(\d+)\s+(day|week|hour|minute)s?\s+ago", text, re.I)
        if not match:
            raise ValueError(f"unrecognized City posted date: {text!r}")
        amount, unit = int(match.group(1)), match.group(2).lower()
        days = amount * 7 if unit == "week" else amount if unit == "day" else 0
    return (today - timedelta(days=days)).isoformat()


def fetch_governmentjobs(source, agency, employer_base):
    """Shared GovernmentJobs (NeoGov) scraper — Burlington and South
    Burlington run the same platform under different agency slugs."""
    page = fetch_text(GOVJOBS_URL.format(agency=agency), browser=True,
                      headers={"X-Requested-With": "XMLHttpRequest"})
    blocks = re.split(
        r"(?=<li\b[^>]*class=[\"'][^\"']*\blist-item\b)", page, flags=re.I)[1:]
    jobs = []
    for block in blocks:
        anchor = re.search(r"<a\b(?=[^>]*\bitem-details-link\b)[^>]*>.*?</a>",
                           block, re.I | re.S)
        published = re.search(
            r"<div\b[^>]*class=[\"'][^\"']*\blist-published\b[^\"']*[\"'][^>]*>"
            r"(.*?)</div>", block, re.I | re.S)
        if not anchor or not published:
            continue
        # One unparseable date skips its own item, not the whole source.
        try:
            posted = relative_city_date(published.group(1))
        except ValueError as exc:
            print(f"{source}: skipped item ({exc})", file=sys.stderr)
            continue
        if not posted:
            continue
        href = attr(anchor.group(0), "href")
        department = attr(anchor.group(0), "data-department-name")
        employer = employer_base
        if department:
            employer += f" — {department}"
        salary = re.search(
            r"\$[\d,]+(?:\.\d+)?(?:\s*-\s*\$[\d,]+(?:\.\d+)?)?\s+"
            r"(?:Hourly|Annually)", block, re.I)
        meta = re.search(r"<ul\b[^>]*class=[\"'][^\"']*\blist-meta\b[^\"']*[\"']"
                         r"[^>]*>(.*?)</ul>", block, re.I | re.S)
        employment_type = clean_text(meta.group(1)) if meta else ""
        if href:
            jobs.append(make_job(
                source, anchor.group(0), employer, posted,
                urllib.parse.urljoin("https://www.governmentjobs.com", href),
                salary.group(0) if salary else None, employment_type))
    return jobs


def fetch_city(_previous):
    return fetch_governmentjobs("City of Burlington", "burlingtonvt",
                                "City of Burlington")


def fetch_south_burlington(_previous):
    return fetch_governmentjobs("City of South Burlington", "southburlington",
                                "City of South Burlington")


def first_span(block, class_name):
    match = re.search(
        rf"<span\b[^>]*class=[\"'][^\"']*\b{re.escape(class_name)}\b[^\"']*[\"']"
        r"[^>]*>(.*?)</span>", block, re.I | re.S)
    return clean_text(match.group(1)) if match else ""


def fetch_state(_previous):
    page = fetch_text(STATE_URL, browser=True)
    blocks = re.split(
        r"(?=<tr\b[^>]*class=[\"'][^\"']*\bdata-row\b)", page, flags=re.I)[1:]
    jobs = []
    for block in blocks:
        anchor = re.search(r"<a\b(?=[^>]*\bjobTitle-link\b)[^>]*>.*?</a>",
                           block, re.I | re.S)
        if not anchor:
            continue
        location = first_span(block, "jobLocation")
        if not any(place in location.lower() for place in STATE_PLACES):
            continue
        date_text = first_span(block, "jobDate")
        posted = datetime.strptime(date_text, "%b %d, %Y").date().isoformat()
        department = first_span(block, "jobDepartment")
        employer = "State of Vermont" + (f" — {department}" if department else "")
        href = attr(anchor.group(0), "href")
        if href:
            jobs.append(make_job(
                "State of Vermont", anchor.group(0), employer, posted,
                urllib.parse.urljoin("https://careers.vermont.gov", href)))
    return jobs


def json_ld_posted(page):
    scripts = re.findall(
        r"<script\b[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        page, re.I | re.S)

    def find_posting(value):
        if isinstance(value, dict):
            types = value.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if "JobPosting" in types and value.get("datePosted"):
                return value["datePosted"]
            for child in value.values():
                found = find_posting(child)
                if found:
                    return found
        elif isinstance(value, list):
            for child in value:
                found = find_posting(child)
                if found:
                    return found
        return None

    for script in scripts:
        try:
            found = find_posting(json.loads(html.unescape(script).strip()))
            if found:
                return iso_date(found)
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return None


def fetch_med_center(previous):
    page = fetch_text(MED_URL, browser=True)
    matches = list(re.finditer(
        r"<a\b[^>]*href=([\"'])(/job/[^\"']+)\1[^>]*>\s*<h3[^>]*>(.*?)</h3>",
        page, re.I | re.S))
    cards = []
    for index, match in enumerate(matches):
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(page)
        block = page[match.start():block_end]
        partner = first_span(block, "hospital")
        if partner and "University of Vermont Medical Center" not in partner:
            continue
        reference = first_span(block, "job-ref")
        ref_number = re.search(r"\d+", reference)
        url = urllib.parse.urljoin(
            "https://uvmhealthcareers.org", html.unescape(match.group(2)))
        cards.append((int(ref_number.group()) if ref_number else 0, match, block, url))
    # The page is alphabetical, while Job Ref values rise over time. Checking
    # higher refs first spends the eight-detail budget on the newest jobs;
    # any not reached this run get their turn once the current newest are
    # cached (below) and no longer consume detail fetches.
    cards.sort(key=lambda card: card[0], reverse=True)
    old_by_url = {job["url"]: job for job in previous
                  if job.get("source") == "UVM Med Center" and job.get("url")}
    jobs = []
    detail_fetches = 0
    for reference, match, block, url in cards:
        if url in old_by_url:
            old = old_by_url[url]
            known = make_job(
                "UVM Med Center", match.group(3),
                "University of Vermont Medical Center", old["posted"], url,
                old.get("pay"), first_span(block, "employment_type"))
            known["tags"] = old.get("tags", [])
            jobs.append(known)
            continue
        if detail_fetches >= 8:
            continue
        if detail_fetches:
            time.sleep(1)
        detail_fetches += 1
        posted = json_ld_posted(fetch_text(url, browser=True))
        if not posted:
            continue
        employment_type = first_span(block, "employment_type")
        jobs.append(make_job(
            "UVM Med Center", match.group(3), "University of Vermont Medical Center",
            posted, url, employment_type=employment_type))
    print(f"UVM Med Center detail fetches: {detail_fetches}")
    return jobs


# ---------------------------------------------------------------------------
# Employer ATS boards, ported from the job-radar (radarlib/fetchers.py).
# Every adapter must supply a real posted date — items without one are
# skipped, which keeps this pipeline stateless.
# ---------------------------------------------------------------------------

def relative_posted(text):
    """Workday's list view only says 'Posted 3 Days Ago'. Lenient: anything
    unrecognized or 30+ days just skips its item."""
    text = clean_text(text)
    if not text or re.search(r"30\+\s*days", text, re.I):
        return None
    if re.search(r"today|just posted", text, re.I):
        days = 0
    elif re.search(r"yesterday", text, re.I):
        days = 1
    else:
        match = re.search(r"(\d+)\s+days?\s+ago", text, re.I)
        if not match:
            return None
        days = int(match.group(1))
    return (datetime.now(BTV_TZ).date() - timedelta(days=days)).isoformat()


def fetch_globalfoundries(_previous):
    host = "globalfoundries.wd1.myworkdayjobs.com"
    base = f"https://{host}/wday/cxs/globalfoundries/External"
    jobs, offset = [], 0
    while offset < 400:
        data = fetch_json(f"{base}/jobs", post_json={
            "limit": 20, "offset": offset,
            "searchText": "Essex Junction", "appliedFacets": {}})
        postings = data.get("jobPostings", [])
        for item in postings:
            location = (item.get("locationsText") or "")
            if not any(place in location.lower() for place in LOCAL_PLACES):
                continue
            posted = relative_posted(item.get("postedOn") or "")
            path = item.get("externalPath") or ""
            title = item.get("title") or ""
            if not (posted and path and title):
                continue
            jobs.append(make_job("GlobalFoundries", title, "GlobalFoundries",
                                 posted, f"https://{host}/External{path}"))
        offset += len(postings)
        if len(postings) < 20:
            break
    return jobs


def fetch_beta(_previous):
    data = fetch_json("https://boards-api.greenhouse.io/v1/boards/"
                      "betatechnologiesinc/jobs?content=true")
    jobs = []
    for item in data.get("jobs", []):
        location = ((item.get("location") or {}).get("name") or "")
        if not any(place in location.lower() for place in LOCAL_PLACES):
            continue
        posted = (item.get("first_published") or "")[:10] or None
        title = item.get("title") or ""
        url = item.get("absolute_url") or ""
        if not (posted and title and url):
            continue
        # Greenhouse embeds the full description; Beta lists salary ranges
        # there. Parsed for pay, then dropped.
        content = clean_text(html.unescape(item.get("content") or ""))
        jobs.append(make_job("Beta Technologies", title, "Beta Technologies",
                             posted, url, pay_text=content))
    return jobs


def fetch_onlogic(_previous):
    data = fetch_json("https://apply.workable.com/api/v1/widget/accounts/"
                      "onlogic-inc?details=true")
    jobs = []
    for item in data.get("jobs", []):
        location = ", ".join(filter(None, [item.get("city", ""),
                                           item.get("state", "")]))
        if not any(place in location.lower() for place in LOCAL_PLACES):
            continue
        posted = (item.get("published_on") or "")[:10] or None
        title = item.get("title") or ""
        url = item.get("url") or item.get("application_url") or ""
        if not (posted and title and url):
            continue
        description = clean_text(html.unescape(item.get("description") or ""))
        jobs.append(make_job("OnLogic", title, "OnLogic", posted, url,
                             pay_text=description))
    return jobs


def fetch_howard_center(_previous):
    base = ("https://howardcenter.rec.pro.ukg.net/HOW1500HCTR/JobBoard/"
            "ec05cf26-3cd7-4c1c-a247-d472b3d6ba3b")
    jobs, skip = [], 0
    while True:
        data = fetch_json(
            f"{base}/JobBoardView/LoadSearchResults",
            post_json={"opportunitySearch": {
                "Top": 50, "Skip": skip, "QueryString": "",
                "OrderBy": [{"Value": "postedDateUtc", "PropertyName": "PostedDate",
                             "Ascending": False}],
                "Filters": []}, "matchCriteria": {"PreferredJobs": [], "Educations": [],
                "LicenseAndCertifications": [], "Skills": [], "hasNoLicenses": False,
                "SkippedSkills": []}})
        opportunities = data.get("opportunities", [])
        for item in opportunities:
            posted = (item.get("PostedDate") or "")[:10] or None
            title = item.get("Title") or ""
            opp_id = item.get("Id") or ""
            if not (posted and title and opp_id):
                continue
            brief = clean_text(item.get("BriefDescription") or "")
            # Howard Center operates statewide (Rutland included); this is a
            # Burlington-area board, so filter by the posting's own city.
            cities = [(((loc.get("Address") or {}).get("City")) or "")
                      for loc in (item.get("Locations") or [])]
            cities = [c for c in cities if c]
            local = {"burlington", "south burlington", "winooski", "essex",
                     "essex junction", "colchester", "williston", "shelburne"}
            if cities and not any(c.lower() in local for c in cities):
                continue
            jobs.append(make_job(
                "Howard Center", title, "Howard Center", posted,
                f"{base}/OpportunityDetail?opportunityId={opp_id}",
                pay_text=brief, location=", ".join(cities[:1]) or None))
        skip += len(opportunities)
        if len(opportunities) < 50 or skip >= data.get("totalCount", 0):
            break
    return jobs


def fetch_adp_board(source, employer, cid, cc_id):
    base = ("https://workforcenow.adp.com/mascsr/default/careercenter/public/"
            f"events/staffing/v1/job-requisitions?cid={cid}&ccId={cc_id}&lang=en_US")
    jobs, skip = [], 0
    while True:
        data = fetch_json(f"{base}&%24top=50&%24skip={skip}")
        requisitions = data.get("jobRequisitions", [])
        for item in requisitions:
            req_id = str(item.get("itemID") or
                         (item.get("customFieldGroup") or {}).get("itemID", ""))
            locations = item.get("requisitionLocations") or []
            city = ((locations[0].get("address") or {}).get("cityName", "")
                    if locations else "")
            if not any(place in city.lower() for place in LOCAL_PLACES):
                continue
            posted = (item.get("postDate") or "")[:10] or None
            title = item.get("requisitionTitle") or ""
            if not (posted and title and req_id):
                continue
            url = (f"https://workforcenow.adp.com/mascsr/default/mdf/recruitment/"
                   f"recruitment.html?cid={cid}&ccId={cc_id}&lang=en_US&jobId={req_id}")
            description = clean_text(item.get("requisitionDescription") or "")
            jobs.append(make_job(source, title, employer, posted, url,
                                 pay_text=description))
        skip += len(requisitions)
        if len(requisitions) < 50:
            break
    return jobs


def fetch_chcb(_previous):
    return fetch_adp_board("CHCB", "Community Health Centers of Burlington",
                           "10c256dd-20f5-4119-9c79-3044c887c4a0",
                           "19000101_000001")


def fetch_eastrise(_previous):
    return fetch_adp_board("EastRise", "EastRise Credit Union",
                           "f01b4028-1646-47ff-bc4b-89ae51a0ffc1",
                           "9200955339299_2")


def fetch_common_good(_previous):
    """Common Good Vermont's statewide nonprofit board, filtered to
    Chittenden County listings."""
    site = "https://commongoodvt.org"
    regions = {}
    try:
        for term in fetch_json(f"{site}/wp-json/wp/v2/job_listing_region?per_page=100"):
            regions[term["id"]] = term.get("name", "")
    except Exception:
        pass  # regions stay unnamed; those listings are skipped below
    jobs, page = [], 1
    while page <= 3:
        try:
            data = fetch_json(f"{site}/wp-json/wp/v2/job-listings?per_page=50&page={page}")
        except Exception:
            if page == 1:
                raise  # a failing board must fail loudly
            break  # WP returns 400 past the last page
        if not data:
            break
        for item in data:
            location = ", ".join(regions.get(r, "")
                                 for r in item.get("job_listing_region") or [])
            lowered = location.lower()
            if not ("chittenden" in lowered or
                    any(place in lowered for place in LOCAL_PLACES)):
                continue
            posted = (item.get("date") or "")[:10] or None
            title = clean_text((item.get("title") or {}).get("rendered", ""))
            url = item.get("link") or ""
            if not (posted and title and url):
                continue
            meta = item.get("meta") or {}
            employer = clean_text(meta.get("_company_name") or "") or \
                "via Common Good Vermont"
            salary = str(meta.get("_job_salary") or "").strip()
            unit = (meta.get("_job_salary_unit") or "").lower()
            pay_text = ""
            if salary:
                if "$" not in salary:
                    salary = "$" + salary
                unit_word = {"hour": "per hour", "year": "per year"}.get(unit, unit)
                pay_text = f"Salary: {salary} {unit_word}"
            jobs.append(make_job("Common Good VT", title, employer, posted, url,
                                 pay_text=pay_text))
        if len(data) < 50:
            break
        page += 1
    return jobs


SOURCES = [
    ("Seven Days", fetch_seven_days),
    ("UVM", fetch_uvm),
    ("City of Burlington", fetch_city),
    ("City of South Burlington", fetch_south_burlington),
    ("State of Vermont", fetch_state),
    ("UVM Med Center", fetch_med_center),
    ("GlobalFoundries", fetch_globalfoundries),
    ("Beta Technologies", fetch_beta),
    ("OnLogic", fetch_onlogic),
    ("Howard Center", fetch_howard_center),
    ("CHCB", fetch_chcb),
    ("EastRise", fetch_eastrise),
    ("Common Good VT", fetch_common_good),
]


def normalized(value):
    return re.sub(r"[^a-z0-9]+", " ", html.unescape(value).lower()).strip()


def dedupe(jobs):
    """For normalized employer/title twins, keep the newest posting; break
    ties by pay availability, then source order."""
    rank = {source: index for index, source in enumerate(SOURCE_ORDER)}

    def preference(job):
        # Higher is better: newest date, then has-pay, then earlier source.
        return (job["posted"], bool(job["pay"]), -rank[job["source"]])

    chosen = {}
    for job in jobs:
        key = (normalized(job["title"]), normalized(job["employer"]))
        current = chosen.get(key)
        if current is None or preference(job) > preference(current):
            chosen[key] = job
    return list(chosen.values())


def load_previous():
    try:
        with open(OUT, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("jobs", [])
    except (OSError, json.JSONDecodeError, TypeError):
        return []


def load_manual_jobs():
    """Rows Stephen adds by hand (data/jobs-manual.json) survive every
    refresh verbatim — the emailed-listing path the page advertises."""
    path = os.path.join(os.path.dirname(__file__), "..", "data", "jobs-manual.json")
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as src:
            rows = json.load(src)
        return [r for r in rows if r.get("title") and r.get("url")]
    except Exception as exc:
        print(f"jobs-manual.json unreadable: {exc}", file=sys.stderr)
        return []


def main():
    previous = load_previous()
    collected = []
    failures = []
    for source, fetcher in SOURCES:
        try:
            jobs = fetcher(previous)
            if not jobs:
                raise ValueError("source returned 0 usable items")
            collected.extend(jobs)
            print(f"{source}: ok ({len(jobs)} jobs)")
        except Exception as exc:  # any source failure keeps its last good rows
            failures.append(source)
            old = [job for job in previous if job.get("source") == source]
            collected.extend(old)
            suffix = f"kept {len(old)} previous jobs" if old else "no previous data"
            print(f"{source}: FAILED ({exc}) — {suffix}", file=sys.stderr)

    if len(failures) == len(SOURCES):
        print("all sources failed; data/jobs.json left untouched", file=sys.stderr)
        return 1

    manual = load_manual_jobs()
    if manual:
        seen_ids = {job.get("id") for job in collected}
        collected.extend(job for job in manual if job.get("id") not in seen_ids)
        print(f"manual: kept {len(manual)} hand-added rows")

    cutoff = (datetime.now(BTV_TZ).date() - timedelta(days=21)).isoformat()
    jobs = [job for job in dedupe(collected) if job.get("posted", "") >= cutoff]
    jobs.sort(key=lambda job: (job["posted"], job["id"]), reverse=True)
    if len(jobs) > MAX_JOBS:
        # The cap must never evict rows the contract promises to keep:
        # carried-forward rows from a source that FAILED this run (keep-last-
        # good — they age out over 21 days, not the instant other sources
        # supply a full set of fresh ones), and UVMMC rows (whose presence
        # doubles as the detail-fetch cache). Cap only the unprotected rest.
        protected_sources = set(failures) | {"UVM Med Center"}
        protected = [job for job in jobs if job["source"] in protected_sources]
        capped = [job for job in jobs if job["source"] not in protected_sources]
        jobs = protected + capped[:max(0, MAX_JOBS - len(protected))]
        jobs.sort(key=lambda job: (job["posted"], job["id"]), reverse=True)

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "jobs": jobs,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {os.path.relpath(OUT)} ({len(jobs)} jobs; "
          f"{len(SOURCES) - len(failures)}/{len(SOURCES)} sources fresh)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
