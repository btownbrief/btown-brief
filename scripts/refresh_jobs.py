#!/usr/bin/env python3
"""
Refresh data/jobs.json, the link-only feed behind the Burlington jobs page.

Sources (one list request each):
  - Seven Days Jobs              local WordPress job-feed RSS
  - University of Vermont       UVM's one-week postings Atom feed
  - City of Burlington          GovernmentJobs search results
  - State of Vermont            Burlington-area careers search results
  - UVM Medical Center          UVMMC cards plus up to eight new-job details

Only listing metadata is stored: title, employer, pay, posted date, URL,
source, and derived filter tags. Descriptions are never retained. Each source
is isolated; a failed or empty source keeps its last good entries, which then
age out normally after 21 days. If every source fails, the file is untouched.

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
CITY_URL = ("https://www.governmentjobs.com/careers/home/index?agency=burlingtonvt"
            "&sort=PostingDate&isDescendingSort=true")
STATE_URL = ("https://careers.vermont.gov/search/?q=&location=Burlington"
             "&sortColumn=referencedate&sortDirection=desc")
MED_URL = ("https://uvmhealthcareers.org/jobs/"
           "?entity=uvmmc-the-university-of-vermont-medical-center")

SOURCE_ORDER = ["Seven Days", "UVM", "City of Burlington",
                "State of Vermont", "UVM Med Center"]
SOURCE_SLUGS = {
    "Seven Days": "seven-days",
    "UVM": "uvm",
    "City of Burlington": "city-of-burlington",
    "State of Vermont": "state-of-vermont",
    "UVM Med Center": "uvm-med-center",
}
LOCAL_PLACES = ("burlington", "south burlington", "winooski", "essex",
                "colchester", "williston", "shelburne")
STATE_PLACES = LOCAL_PLACES[:-1]


def fetch_text(url, browser=False, headers=None):
    request_headers = {"User-Agent": BROWSER_UA if browser else UA}
    request_headers.update(headers or {})
    req = urllib.request.Request(url, headers=request_headers)
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.read().decode("utf-8", errors="replace")


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
        "State of Vermont": r"/(\d+)/?$",
        "UVM Med Center": r"/job/(\d+)",
    }
    match = re.search(patterns.get(source, r"(?!)"), path)
    suffix = match.group(1) if match else hashlib.sha1(url.encode()).hexdigest()[:12]
    return f"{SOURCE_SLUGS[source]}-{suffix}"


def pay_meets_25(pay):
    """Use the lower bound of hourly and annual salary ranges."""
    if not pay:
        return False
    match = re.search(r"\$\s*([\d,]+(?:\.\d+)?)", pay)
    if not match:
        return False
    amount = float(match.group(1).replace(",", ""))
    if re.search(r"Hourly|/\s*hr\b", pay, re.I):
        return amount >= 25
    if re.search(r"Annually|/\s*year\b", pay, re.I):
        return amount >= 52000
    return False


NO_DEGREE = re.compile(
    r"\b(?:driver|custodian|custodial|laborer|cook|dishwasher|housekeeper|"
    r"housekeeping|groundskeeper|maintenance|attendant|cashier|warehouse|"
    r"delivery|cleaner|clerk|security officer|food service|dining|"
    r"retail associate|line worker|nurse assistant|LNA|machine operator)\b",
    re.I,
)


def job_tags(source, title, pay, employment_type=""):
    """Derive only the documented filter tags from listing metadata."""
    tags = []
    combined = f"{title} {employment_type}"
    if source in ("City of Burlington", "State of Vermont"):
        tags.append("city")
    if NO_DEGREE.search(title):
        tags.append("no-degree")
    if pay_meets_25(pay):
        tags.append("pay25")
    if re.search(r"\bweekend\b", combined, re.I):
        tags.append("weekend")
    if re.search(r"\b(?:seasonal|summer|temporary)\b", combined, re.I):
        tags.append("seasonal")
    return tags


def make_job(source, title, employer, posted, url, pay=None, employment_type=""):
    title = clean_text(title)
    employer = clean_text(employer)
    url = urllib.parse.urldefrag(url)[0]
    return {
        "id": stable_id(source, url),
        "title": title,
        "employer": employer,
        "pay": clean_text(pay) if pay else None,
        "posted": posted,
        "url": url,
        "source": source,
        "tags": job_tags(source, title, pay, employment_type),
    }


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
    if re.search(r"Posted\s+30\+\s+days", text, re.I):
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


def fetch_city(_previous):
    page = fetch_text(CITY_URL, browser=True,
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
            print(f"City of Burlington: skipped item ({exc})", file=sys.stderr)
            continue
        if not posted:
            continue
        href = attr(anchor.group(0), "href")
        department = attr(anchor.group(0), "data-department-name")
        employer = "City of Burlington"
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
                "City of Burlington", anchor.group(0), employer, posted,
                urllib.parse.urljoin("https://www.governmentjobs.com", href),
                salary.group(0) if salary else None, employment_type))
    return jobs


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


SOURCES = [
    ("Seven Days", fetch_seven_days),
    ("UVM", fetch_uvm),
    ("City of Burlington", fetch_city),
    ("State of Vermont", fetch_state),
    ("UVM Med Center", fetch_med_center),
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
        print("all five sources failed; data/jobs.json left untouched", file=sys.stderr)
        return 1

    cutoff = (datetime.now(BTV_TZ).date() - timedelta(days=21)).isoformat()
    jobs = [job for job in dedupe(collected) if job.get("posted", "") >= cutoff]
    jobs.sort(key=lambda job: (job["posted"], job["id"]), reverse=True)
    if len(jobs) > 30:
        # The 30-row cap must never evict rows the contract promises to keep:
        # carried-forward rows from a source that FAILED this run (keep-last-
        # good — they age out over 21 days, not the instant other sources
        # supply 30 fresh ones), and UVMMC rows (whose presence doubles as the
        # detail-fetch cache). Cap only the unprotected remainder.
        protected_sources = set(failures) | {"UVM Med Center"}
        protected = [job for job in jobs if job["source"] in protected_sources]
        capped = [job for job in jobs if job["source"] not in protected_sources]
        jobs = protected + capped[:max(0, 30 - len(protected))]
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
