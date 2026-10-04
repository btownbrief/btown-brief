#!/usr/bin/env python3
"""Shared Reddit intake: every route into one file, each post tagged by route.

Reddit stops serving RSS on Nov 13, 2026 and closes its public Data API in
March 2027 (r/redditdev, 2026-09-30). Until a long-term route exists, this
script collects the newest r/burlington and r/vermont posts from every route
that still answers, side by side, so a dying route shows up in the daily
comparison (scripts/reddit_report.py) instead of as a silently stale page.

Routes. Each one is optional, bounded, and fails on its own:

  inoreader  Stephen's public Inoreader tag streams, which re-publish Reddit's
             RSS. Works from GitHub Actions. Stops with Reddit RSS on Nov 13.
             Its pubDate is Inoreader's crawl time, not the post time.
  rss        Reddit's own /new/.rss Atom feed. Answers home IPs, usually 403s
             datacenter IPs (so expect "error" from Actions). Ends Nov 13.
  oauth      Reddit's Data API with an app-only token. Runs only when
             REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set. The only route
             with scores, comment counts and flair. Ends March 2027 unless
             Reddit says otherwise.

Output (default data/reddit-intake.json), schema v1:

  {"v": 1, "generated": ISO, "subs": [...], "window_days": 10,
   "state": {"paused": bool, "since": ISO|null, "newest_first_seen": ISO|null,
             "pause_after_hours": 36, "routes_live": [...], "reason": str},
   "routes": {route: {sub: {"status": "ok|empty|error|skipped",
                            "fetched": n, "new": n, "error": str|null}}},
   "runs": [{"ts": ISO, "routes": <same shape as "routes">}],   # last 8 days
   "removed": {post_id: ISO},       # ids OAuth showed as removed or deleted
   "posts": [{"id", "sub", "title", "url", "created", "created_exact",
              "kind": "self|link", "out": URL|null, "score", "comments",
              "flair", "nsfw", "routes": [...], "seen": {route: ISO},
              "first_seen": ISO, "last_seen": ISO}]}

Nothing here stores post bodies, authors or comments: titles, links, times
and counts only, which is what the Reddit access request says we read.
"paused" means no route has delivered a single new post for 36 hours.

CLI:
  python3 scripts/reddit_intake.py                    # live, writes --out
  python3 scripts/reddit_intake.py --store PREV --out NEW
  python3 scripts/reddit_intake.py --fixtures DIR --dry-run
  python3 scripts/reddit_intake.py --routes inoreader,rss
"""

import argparse
import base64
import html
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "reddit-intake.json")

SUBS = ("r/burlington", "r/vermont")
ROUTES = ("inoreader", "rss", "oauth")
# Same public tag streams refresh_chatter.py and refresh_pulse.py read.
INOREADER = {
    "r/burlington": "https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2Fburlington%29?n=100",
    "r/vermont": "https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2FVermont%29?n=100",
}
RSS_URL = "https://www.reddit.com/r/{short}/new/.rss?limit=100"
TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
OAUTH_URL = "https://oauth.reddit.com/r/{short}/new?limit=100&raw_json=1"

SITE_UA = "btown-brief-site/1.0 (reddit intake)"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
# Reddit asks API clients for "<platform>:<app id>:<version> (by /u/<name>)".
# REDDIT_USER_AGENT overrides this once the approved app has a username.
API_UA = "script:btownbrief-local-digest:1.0 (by btownbrief.com)"

WINDOW_DAYS = 10          # a Wednesday-to-Wednesday week plus slack
RUN_HISTORY_DAYS = 8      # receipts kept for the daily comparison
PAUSE_AFTER_HOURS = 36    # Inoreader alone has gone 30h between batches
POSTS_PER_SUB_CAP = 600
TIMEOUT = 25
ERROR_MAX = 160

ATOM = "{http://www.w3.org/2005/Atom}"
POST_ID_RE = re.compile(r"/comments/([a-z0-9]+)(?:/([^/?#]*))?", re.I)
SUB_PATH_RE = re.compile(r"/r/([A-Za-z0-9_]+)/comments/", re.I)
LINK_ANCHOR_RE = re.compile(r'href="(https?://[^"]+)"\s*>\s*\[link\]', re.I)
REDDIT_HOST_RE = re.compile(r"(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)$", re.I)


# ----------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------

def utcnow():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds") if dt else None


def parse_iso(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def parse_rfc822(value):
    try:
        parsed = parsedate_to_datetime((value or "").strip())
    except (TypeError, ValueError, IndexError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def clean_space(value):
    return re.sub(r"\s+", " ", value or "").strip()


def post_id(url):
    match = POST_ID_RE.search(url or "")
    return match.group(1).lower() if match else None


def post_url(url):
    """Canonical thread URL: https://www.reddit.com/r/<sub>/comments/<id>/<slug>/"""
    path = urllib.parse.urlsplit(url or "").path
    sub = SUB_PATH_RE.search(path)
    match = POST_ID_RE.search(path)
    if not sub or not match:
        return None
    slug = match.group(2) or ""
    return (f"https://www.reddit.com/r/{sub.group(1)}/comments/{match.group(1).lower()}/"
            + (slug + "/" if slug else ""))


def is_reddit_host(url):
    host = (urllib.parse.urlsplit(url or "").hostname or "").lower()
    return bool(REDDIT_HOST_RE.search(host))


def outbound(description):
    """The submitted link from a feed item's [link] anchor, or None.

    Takes the LAST [link] anchor: Reddit's own footer link always comes last,
    while a post body can carry a crafted "[link]" anchor pointing anywhere
    (same rule as refresh_pulse.parse_stream). Self posts point back at the
    thread and image/video posts at reddit's media hosts; neither counts."""
    match = None
    for found in LINK_ANCHOR_RE.finditer(description or ""):
        match = found
    if not match:
        return None
    target = html.unescape(match.group(1)).strip()
    return None if is_reddit_host(target) else target


def short_error(exc):
    if isinstance(exc, urllib.error.HTTPError):
        try:
            exc.close()  # an HTTPError holds the open response
        except Exception:  # noqa: BLE001
            pass
        return f"HTTP {exc.code}"
    text = f"{exc.__class__.__name__}: {exc}"
    return text[:ERROR_MAX]


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as src:
            return json.load(src)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as dst:
        json.dump(value, dst, indent=1, ensure_ascii=False)
        dst.write("\n")
    os.replace(tmp, path)


# ----------------------------------------------------------------------
# Parsers: one per route, all returning the same normalized post shape
# ----------------------------------------------------------------------

def blank_post(pid, sub, title, url, created, exact):
    return {"id": pid, "sub": sub, "title": title, "url": url, "created": created,
            "created_exact": exact, "kind": "self", "out": None, "score": None,
            "comments": None, "flair": None, "nsfw": None}


def parse_inoreader(raw, sub):
    posts = []
    for item in ET.fromstring(raw).iter("item"):
        url = post_url(clean_space(item.findtext("link")))
        pid = post_id(url)
        title = clean_space(html.unescape(item.findtext("title") or ""))
        if not pid or not title:
            continue
        post = blank_post(pid, sub, title, url, parse_rfc822(item.findtext("pubDate")), False)
        post["out"] = outbound(item.findtext("description"))
        post["kind"] = "link" if post["out"] else "self"
        posts.append(post)
    return posts


def parse_atom(raw, sub):
    posts = []
    for entry in ET.fromstring(raw).iter(f"{ATOM}entry"):
        link = entry.find(f"{ATOM}link")
        url = post_url(link.get("href") if link is not None else "")
        pid = post_id(url)
        title = clean_space(html.unescape(entry.findtext(f"{ATOM}title") or ""))
        if not pid or not title:
            continue
        created = parse_iso(entry.findtext(f"{ATOM}published") or entry.findtext(f"{ATOM}updated"))
        post = blank_post(pid, sub, title, url, created, created is not None)
        post["out"] = outbound(entry.findtext(f"{ATOM}content"))
        post["kind"] = "link" if post["out"] else "self"
        posts.append(post)
    return posts


def parse_listing(data, sub):
    """OAuth /new listing → (posts, removed_ids)."""
    posts, removed = [], set()
    for child in ((data or {}).get("data") or {}).get("children", []):
        row = child.get("data") or {}
        pid = str(row.get("id") or "").lower()
        url = post_url("https://www.reddit.com" + (row.get("permalink") or ""))
        if not pid or not url:
            continue
        # Removed by mods/admins, or deleted by its author. An author who
        # deleted their ACCOUNT ("[deleted]" author, post still up) doesn't count.
        if (row.get("removed_by_category") or row.get("selftext") in ("[removed]", "[deleted]")
                or row.get("title") in ("[removed]", "[deleted]", "[deleted by user]")):
            removed.add(pid)
            continue
        title = clean_space(row.get("title"))
        if not title:
            continue
        created = None
        if isinstance(row.get("created_utc"), (int, float)):
            created = datetime.fromtimestamp(row["created_utc"], timezone.utc)
        post = blank_post(pid, sub, title, url, created, created is not None)
        target = row.get("url_overridden_by_dest") or row.get("url") or ""
        if not row.get("is_self") and target.startswith("http") and not is_reddit_host(target):
            post["out"] = target
        post["kind"] = "link" if post["out"] else "self"
        post["score"] = row.get("score") if isinstance(row.get("score"), int) else None
        post["comments"] = row.get("num_comments") if isinstance(row.get("num_comments"), int) else None
        post["flair"] = clean_space(row.get("link_flair_text")) or None
        post["nsfw"] = bool(row.get("over_18"))
        post["stickied"] = bool(row.get("stickied"))  # pinned out of date order; never stored
        posts.append(post)
    return posts, removed


# ----------------------------------------------------------------------
# Fetching: injectable so tests never touch the network
# ----------------------------------------------------------------------

def http_fetch(url, headers=None, data=None):
    request = urllib.request.Request(url, headers=headers or {}, data=data)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def fixture_fetch(directory):
    """A fetch() that answers from files: inoreader-<short>.xml,
    rss-<short>.xml, oauth-<short>.json, oauth-token.json. Any other URL
    raises, so a fixture run can never reach the network."""
    def fetch(url, headers=None, data=None):
        name = None
        if url == TOKEN_URL:
            name = "oauth-token.json"
        else:
            for sub, stream in INOREADER.items():
                if url == stream:
                    name = f"inoreader-{sub[2:].lower()}.xml"
            for sub in SUBS:
                short = sub[2:]
                if url == RSS_URL.format(short=short):
                    name = f"rss-{short.lower()}.xml"
                elif url == OAUTH_URL.format(short=short):
                    name = f"oauth-{short.lower()}.json"
        if not name:
            raise RuntimeError(f"fixture fetch refused unknown URL {url}")
        path = os.path.join(directory, name)
        if not os.path.exists(path):
            raise urllib.error.HTTPError(url, 404, f"no fixture {name}", {}, io.BytesIO())
        with open(path, "rb") as src:
            return src.read()
    return fetch


def oauth_token(fetch, env):
    cid = (env.get("REDDIT_CLIENT_ID") or "").strip()
    secret = (env.get("REDDIT_CLIENT_SECRET") or "").strip()
    if not cid or not secret:
        return None
    basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    raw = fetch(TOKEN_URL, {"User-Agent": env.get("REDDIT_USER_AGENT") or API_UA,
                            "Authorization": "Basic " + basic},
                b"grant_type=client_credentials")
    token = json.loads(raw).get("access_token")
    if not token:
        raise RuntimeError("token response had no access_token")
    return token


def collect(fetch=http_fetch, env=None, subs=SUBS, routes=ROUTES, sleep=time.sleep):
    """Ask every route about every sub. Returns
    {route: {sub: {"status", "posts", "removed", "error"}}}."""
    env = os.environ if env is None else env
    results = {route: {} for route in routes}

    def record(route, sub, posts=None, error=None, skipped=None, removed=None):
        if skipped:
            entry = {"status": "skipped", "posts": [], "removed": set(), "error": skipped}
        elif error:
            entry = {"status": "error", "posts": [], "removed": set(), "error": error}
        else:
            entry = {"status": "ok" if posts else "empty", "posts": posts,
                     "removed": removed or set(), "error": None}
        results[route][sub] = entry

    if "inoreader" in routes:
        for sub in subs:
            try:
                raw = fetch(INOREADER[sub], {"User-Agent": SITE_UA,
                                             "Accept": "application/rss+xml, application/xml"})
                record("inoreader", sub, parse_inoreader(raw, sub))
            except Exception as exc:  # noqa: BLE001 — a route never blocks the others
                record("inoreader", sub, error=short_error(exc))

    if "rss" in routes:
        for index, sub in enumerate(subs):
            if index:
                sleep(3)  # Reddit 429s back-to-back unauthenticated fetches
            try:
                raw = fetch(RSS_URL.format(short=sub[2:]),
                            {"User-Agent": BROWSER_UA, "Accept": "application/atom+xml, application/xml"})
                record("rss", sub, parse_atom(raw, sub))
            except Exception as exc:  # noqa: BLE001
                record("rss", sub, error=short_error(exc))

    if "oauth" in routes:
        token, token_error = None, None
        try:
            token = oauth_token(fetch, env)
        except Exception as exc:  # noqa: BLE001
            token_error = "token: " + short_error(exc)
        for sub in subs:
            if token_error:
                record("oauth", sub, error=token_error)
                continue
            if not token:
                record("oauth", sub, skipped="REDDIT_CLIENT_ID/SECRET not set")
                continue
            try:
                raw = fetch(OAUTH_URL.format(short=sub[2:]),
                            {"User-Agent": env.get("REDDIT_USER_AGENT") or API_UA,
                             "Authorization": "Bearer " + token})
                posts, removed = parse_listing(json.loads(raw), sub)
                record("oauth", sub, posts, removed=removed)
            except Exception as exc:  # noqa: BLE001
                record("oauth", sub, error=short_error(exc))
    return results


# ----------------------------------------------------------------------
# Merge into the rolling store
# ----------------------------------------------------------------------

def load_store(previous):
    """Previous intake payload → (posts by id, removed ids, runs)."""
    posts = {}
    for row in previous.get("posts", []) if isinstance(previous, dict) else []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        post = dict(row)
        post["created"] = parse_iso(row.get("created"))
        post["first_seen"] = parse_iso(row.get("first_seen"))
        post["last_seen"] = parse_iso(row.get("last_seen"))
        post["seen"] = {route: parse_iso(ts) for route, ts in (row.get("seen") or {}).items()
                        if parse_iso(ts)}
        posts[post["id"]] = post
    removed = {pid: parse_iso(ts) for pid, ts in (previous.get("removed") or {}).items()
               if parse_iso(ts)} if isinstance(previous, dict) else {}
    runs = [run for run in (previous.get("runs") or []) if isinstance(run, dict)
            and parse_iso(run.get("ts"))] if isinstance(previous, dict) else []
    return posts, removed, runs


ROUTE_RANK = {"oauth": 3, "rss": 2, "inoreader": 1}


def upsert(store, post, route, now):
    """Fold one route's copy of a post into the store. Returns True if the
    route had never delivered this post before."""
    held = store.get(post["id"])
    if held is None:
        held = dict(post)
        held.update({"seen": {}, "first_seen": now, "last_seen": now, "_best": route})
        store[post["id"]] = held
    first_for_route = route not in held["seen"]
    if first_for_route:
        held["seen"][route] = now
    held["last_seen"] = now
    best = held.get("_best") or max(held["seen"], key=lambda r: ROUTE_RANK.get(r, 0))
    if ROUTE_RANK.get(route, 0) >= ROUTE_RANK.get(best, 0):
        held["title"] = post["title"] or held["title"]
        held["url"] = post["url"] or held["url"]
        held["_best"] = route
    # An exact Reddit timestamp beats Inoreader's crawl time; two inexact
    # ones keep the earliest, so a re-crawl can't float a post to the top.
    if post["created"] is not None:
        if post["created_exact"] and not held.get("created_exact"):
            held["created"], held["created_exact"] = post["created"], True
        elif post["created_exact"] == bool(held.get("created_exact")):
            held["created"] = min(filter(None, (held.get("created"), post["created"])))
    if post.get("out") and not held.get("out"):
        held["out"] = post["out"]
    held["kind"] = "link" if held.get("out") else "self"
    if route == "oauth":  # the only route that knows these; newest wins
        for key in ("score", "comments", "flair", "nsfw"):
            held[key] = post.get(key)
    return first_for_route


def merge(store, removed, results, now):
    """Apply one collect() result to the store. Returns the run receipt."""
    receipt = {}
    for route, by_sub in results.items():
        receipt[route] = {}
        for sub, result in by_sub.items():
            new = 0
            for pid in result.get("removed") or ():
                removed[pid] = now
                store.pop(pid, None)
            returned = set()
            for post in result.get("posts") or []:
                if post["id"] in removed:
                    continue
                returned.add(post["id"])
                new += upsert(store, post, route, now)
            if route == "oauth" and result["status"] == "ok":
                # Reddit's own listing is the authority on what still exists:
                # a stored post inside the span it just returned, but missing
                # from it, was removed or deleted, and leaves on this refresh.
                # A stickied post can be months old, so it never sets the span.
                times = [p["created"] for p in result["posts"] if p["created"] and not p.get("stickied")]
                if len(times) >= 5:
                    oldest = min(times)
                    for pid, held in list(store.items()):
                        if (held["sub"] == sub and pid not in returned and held.get("created_exact")
                                and held.get("created") and held["created"] > oldest):
                            removed[pid] = now
                            del store[pid]
            receipt[route][sub] = {"status": result["status"],
                                   "fetched": len(result.get("posts") or []),
                                   "new": new, "error": result.get("error")}
    return receipt


def prune(store, removed, runs, now):
    cutoff = now - timedelta(days=WINDOW_DAYS)
    for pid, held in list(store.items()):
        when = held.get("created") or held.get("first_seen")
        if when is None or when < cutoff:
            del store[pid]
    for pid, when in list(removed.items()):
        if when < cutoff:
            del removed[pid]
    by_sub = {}
    for held in store.values():
        by_sub.setdefault(held["sub"], []).append(held)
    for posts in by_sub.values():
        posts.sort(key=lambda p: p.get("created") or p["first_seen"], reverse=True)
        for held in posts[POSTS_PER_SUB_CAP:]:
            del store[held["id"]]
    run_cutoff = now - timedelta(days=RUN_HISTORY_DAYS)
    return [run for run in runs if parse_iso(run["ts"]) >= run_cutoff]


def intake_state(store, receipt, now, last_delivery=None):
    """last_delivery: the previous run's newest_first_seen. Carried forward so
    removing (or pruning) the newest post can't make the intake look silent."""
    newest = max(filter(None, [last_delivery] + [p.get("first_seen") for p in store.values()]),
                 default=None)
    live = sorted({route for route, by_sub in receipt.items()
                   for entry in by_sub.values() if entry["status"] == "ok"})
    paused = newest is None or now - newest > timedelta(hours=PAUSE_AFTER_HOURS)
    if newest is None:
        reason = "no route has ever delivered a post"
    elif paused:
        reason = f"no new post from any route in {PAUSE_AFTER_HOURS}h"
    else:
        reason = "posts arriving"
    return {"paused": paused, "since": iso(newest) if paused else None,
            "newest_first_seen": iso(newest), "pause_after_hours": PAUSE_AFTER_HOURS,
            "routes_live": live, "reason": reason}


def serialize(store, removed, runs, receipt, subs, now, last_delivery=None):
    def out(held):
        row = {key: held.get(key) for key in ("id", "sub", "title", "url", "created_exact", "kind",
                                               "out", "score", "comments", "flair", "nsfw")}
        row["created"] = iso(held.get("created"))
        row["routes"] = sorted(held["seen"], key=lambda r: ROUTES.index(r) if r in ROUTES else 9)
        row["seen"] = {route: iso(ts) for route, ts in held["seen"].items()}
        row["first_seen"] = iso(held["first_seen"])
        row["last_seen"] = iso(held["last_seen"])
        return row

    posts = sorted(store.values(), key=lambda p: p.get("created") or p["first_seen"], reverse=True)
    return {"v": 1, "generated": iso(now), "subs": list(subs), "window_days": WINDOW_DAYS,
            "state": intake_state(store, receipt, now, last_delivery), "routes": receipt, "runs": runs,
            "removed": {pid: iso(ts) for pid, ts in sorted(removed.items())},
            "posts": [out(p) for p in posts]}


def refresh(previous, fetch=http_fetch, env=None, subs=SUBS, routes=ROUTES, now=None, sleep=time.sleep):
    """previous payload (or {}) → new payload. Pure apart from fetch()."""
    now = now or utcnow()
    store, removed, runs = load_store(previous or {})
    last_delivery = parse_iso(((previous or {}).get("state") or {}).get("newest_first_seen"))
    receipt = merge(store, removed, collect(fetch, env, subs, routes, sleep), now)
    runs.append({"ts": iso(now), "routes": receipt})
    runs = prune(store, removed, runs, now)
    return serialize(store, removed, runs, receipt, subs, now, last_delivery)


def summary(payload):
    lines = []
    for route, by_sub in payload["routes"].items():
        bits = []
        for sub, entry in by_sub.items():
            bit = f"{sub} {entry['status']} {entry['fetched']} fetched/{entry['new']} new"
            if entry.get("error"):
                bit += f" ({entry['error']})"
            bits.append(bit)
        lines.append(f"  {route:9} " + "; ".join(bits))
    state = payload["state"]
    lines.append(f"  state     {'PAUSED' if state['paused'] else 'ok'}: {state['reason']}; "
                 f"{len(payload['posts'])} posts in the {payload['window_days']}-day store")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--store", help="previous intake payload (default: --out)")
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--routes", default=",".join(ROUTES),
                        help="comma list from: " + ", ".join(ROUTES))
    parser.add_argument("--fixtures", metavar="DIR", help="answer every fetch from DIR (no network)")
    parser.add_argument("--dry-run", action="store_true", help="print instead of writing")
    args = parser.parse_args(argv)
    routes = tuple(r for r in (x.strip() for x in args.routes.split(",")) if r)
    unknown = sorted(set(routes) - set(ROUTES))
    if unknown:
        parser.error("unknown route(s): " + ", ".join(unknown))
    fetch = fixture_fetch(args.fixtures) if args.fixtures else http_fetch
    previous = load_json(args.store or args.out, {})
    payload = refresh(previous, fetch=fetch, routes=routes,
                      sleep=(lambda _s: None) if args.fixtures else time.sleep)
    if args.dry_run:
        print(json.dumps(payload, indent=1, ensure_ascii=False))
    else:
        write_json(args.out, payload)
        print(f"reddit intake -> {args.out}")
    print(summary(payload), file=sys.stderr if args.dry_run else sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
