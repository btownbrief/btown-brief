#!/usr/bin/env python3
"""Shared helpers for the Town app's data scripts (scripts/town/).

Same house style as scripts/changes/common.py: stdlib only, every section fails
on its own, polite client. Two extra rules for the Town app:

  - every record carries "source_url" and "verified" (the UTC time this run saw it)
  - a section that fails keeps the last good copy from the previous output file,
    marked "stale": true, so one bad fetch never blanks a tab

burlingtonvt.gov's robots.txt asks generic crawlers for a 10-second crawl delay;
city_get() enforces it. We identify ourselves honestly and never as an AI crawler.
"""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from scripts.changes.common import parse_feed, parse_when, strip_tags  # noqa: F401 (re-exported)

UA = "btownbrief.com town data (stephenvdavis@gmail.com)"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "data", "town")
CITY_ARCGIS = "https://services1.arcgis.com/1bO0c7PxQdsGidPK/arcgis/rest/services"
CITY_HOST = "www.burlingtonvt.gov"
CITY_DELAY = 10  # seconds, from burlingtonvt.gov robots.txt Crawl-delay
_last_city_hit = [0.0]


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get(url, timeout=30, retries=1, headers=None, browser=False):
    """GET -> bytes. One quiet retry; raises RuntimeError on final failure."""
    hdrs = {"User-Agent": BROWSER_UA if browser else UA, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)
    if urllib.parse.urlparse(url).netloc == CITY_HOST:
        wait = CITY_DELAY - (time.time() - _last_city_hit[0])
        if wait > 0:
            time.sleep(wait)
        _last_city_hit[0] = time.time()
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(3)
    raise RuntimeError(f"GET {url} failed: {last}")


def get_text(url, **kw):
    return get(url, **kw).decode("utf-8", "replace")


def get_json(url, **kw):
    return json.loads(get_text(url, **kw))


def page_text(raw_html):
    """Visible text of an HTML page, scripts and styles removed."""
    t = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", raw_html, flags=re.S | re.I)
    return strip_tags(t)


def arcgis_query(layer_url, where="1=1", out_fields="*", order_by=None, page=2000, limit=None):
    """Query an ArcGIS FeatureServer layer with paging; returns a list of attribute dicts."""
    rows, offset = [], 0
    while True:
        params = {"where": where, "outFields": out_fields, "returnGeometry": "false",
                  "f": "json", "resultOffset": offset, "resultRecordCount": page}
        if order_by:
            params["orderByFields"] = order_by
        data = get_json(f"{layer_url}/query?{urllib.parse.urlencode(params)}", timeout=60)
        if "error" in data:
            raise RuntimeError(f"ArcGIS error from {layer_url}: {data['error']}")
        feats = [f.get("attributes", {}) for f in data.get("features", [])]
        rows.extend(feats)
        if limit and len(rows) >= limit:
            return rows[:limit]
        if not data.get("exceededTransferLimit") or not feats:
            return rows
        offset += len(feats)


def arcgis_layer_info(layer_url):
    return get_json(f"{layer_url}?f=json")


def arcgis_first_layer(service_url):
    """Some city services are re-published monthly with a new layer id (e.g. /151 -> /152).
    Find the current one instead of hard-coding it."""
    svc = get_json(f"{service_url}?f=json")
    layers = (svc.get("layers") or []) + (svc.get("tables") or [])
    if not layers:
        raise RuntimeError(f"no layers at {service_url}")
    return f"{service_url}/{layers[0]['id']}"


def epoch_ms_to_iso(v, date_only=False):
    if not isinstance(v, (int, float)):
        return None
    dt = datetime.fromtimestamp(v / 1000, tz=timezone.utc)
    return dt.date().isoformat() if date_only else dt.isoformat(timespec="seconds")


def rec(source_url, verified, **fields):
    """One output record. source_url and verified are always present."""
    out = dict(fields)
    out["source_url"] = source_url
    out["verified"] = verified
    return out


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    """Atomic write so the site never reads a half-written file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def run_sections(out_path, sections, meta):
    """Run each (name, fn) section; a failure keeps the previous copy marked stale.

    fn(verified) returns a dict. The output file is {"generated", ..., "sections": {name: {...}}}.
    Returns the number of sections that failed.
    """
    previous = (load_json(out_path, {}) or {}).get("sections", {})
    verified = now_iso()
    result, failed = {}, 0
    for name, fn in sections:
        try:
            body = fn(verified)
            body["ok"] = True
            body["stale"] = False
            result[name] = body
            print(f"  ok    {name}")
        except Exception as e:  # noqa: BLE001 — one source must never sink the run
            failed += 1
            old = previous.get(name)
            if old:
                old = dict(old)
                old["stale"] = True
                old["ok"] = False
                old["error"] = str(e)[:300]
                result[name] = old
            else:
                result[name] = {"ok": False, "stale": True, "error": str(e)[:300]}
            print(f"  FAIL  {name}: {e}")
    for name, old in previous.items():  # --only runs keep the sections they skipped
        result.setdefault(name, old)
    data = {"generated": verified}
    data.update(meta)
    data["sections"] = result
    write_json(out_path, data)
    return failed


def only_filter(argv_only, sections):
    if not argv_only:
        return sections
    wanted = {s.strip() for s in argv_only.split(",") if s.strip()}
    return [s for s in sections if s[0] in wanted]
