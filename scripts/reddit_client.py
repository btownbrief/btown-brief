#!/usr/bin/env python3
"""The one door every btown-brief script uses to read Reddit.

Reddit ends RSS on 2026-11-13 (r/modnews, 2026-09-30), already 403s the
logged-out .json endpoints (since 2026-05-28), and closes its public Data API
in March 2027 (r/redditdev, 2026-09-30). This module lets every reader switch
to Reddit's OAuth API the moment Stephen adds the keys, with no code change.

Four routes, tried in order by read() (and by listing(), which skips rss):

  oauth     Reddit's Data API with an application-only token (OAuth
            "client_credentials": no Reddit user, read-only). Used whenever
            REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are both set. Returns
            the listing JSON (the same shape the old .json endpoints served).
  rss       Reddit's public .rss/Atom feed. Dies 2026-11-13.
  shreddit  The logged-out reddit.com page fragment a browser loads while a
            subreddit scrolls (/svc/shreddit/community-more-posts/<sort>/).
            No account, no cookies, ever. Parsed into the SAME listing dict
            as oauth (title, permalink, link, time, score, comments, flair
            only; removed/deleted posts dropped), so callers need no new
            parser. Answers a home connection (Stephen's Mac); expect 403
            from GitHub's runners. Against Reddit's terms: Stephen decided
            2026-10-22 to accept that for a handful of requests an hour.
  mirror    The listings the Mac runner last fetched by the shreddit route,
            read from the reddit-data branch (data/reddit-listings.json).
            How GitHub's jobs see Reddit once Reddit blocks them. A copy
            older than MIRROR_MAX_AGE counts as a failure, so callers keep
            their own last good data instead of re-serving a stale list.

Order: REDDIT_ROUTES (comma list) wins. Otherwise oauth, rss, shreddit,
mirror; shreddit moves ahead of rss once RSS has failed RSS_STREAK_LIMIT runs
in a row (needs a state file) or twice in one run, and rss leaves the order
for good on RSS_END.

Politeness (rss + shreddit, the two www.reddit.com routes): at least
REDDIT_MIN_GAP seconds (default 4) between two requests; a final 403 or 429
trips that route for the rest of the run (a 429 trips both); with a state file
(REDDIT_STATE_FILE, set by the Mac runner) it also cools down across runs,
30 minutes doubling per strike up to 12 hours, reset by the next success.

Rules this module keeps for every caller:
  * one descriptive User-Agent, as Reddit's API rules ask
    ("<platform>:<app id>:<version> (by /u/<name>)"). REDDIT_USER_AGENT
    overrides it once the app has a Reddit username to name.
  * Reddit's rate-limit headers (x-ratelimit-remaining / -reset): a spent
    window is waited out when the wait is short (<= max_wait seconds),
    otherwise RateLimited is raised at once.
  * a 429 is retried ONCE after Retry-After / x-ratelimit-reset when that is
    short; otherwise RateLimited. Callers treat any RedditError as "keep the
    last good data", which every reader already does.
  * no secret (client id, client secret, token) ever appears in an error
    message: every message built here passes through redact().

Usage:
  client = Client()                      # reads os.environ
  route, data = client.read("r/burlington/new", limit=100)
  # route == "oauth": data is the listing dict; route == "rss": Atom bytes
"""

import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from html.parser import HTMLParser

TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
OAUTH_BASE = "https://oauth.reddit.com"
RSS_BASE = "https://www.reddit.com"

# Reddit's format. REDDIT_USER_AGENT replaces it (e.g. with the app owner's
# /u/ name, which Reddit asks OAuth clients to include).
DEFAULT_UA = "script:btownbrief-allday:1.1 (by btownbrief.com)"
TIMEOUT = 25
MAX_WAIT = 65          # longest pause we accept inside one run, in seconds
DEFAULT_RETRY = 60     # a 429 with no usable header
TOKEN_SLACK = 60       # refresh the token this many seconds before it expires
ERROR_MAX = 160

SHREDDIT_BASE = "https://www.reddit.com/svc/shreddit/community-more-posts"
SHREDDIT_SORTS = ("new", "hot", "top", "rising")
LISTING_PATH_RE = re.compile(r"^r/([A-Za-z0-9_]{2,21})/(new|hot|top|rising)$")
MIRROR_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
              "reddit-data/data/reddit-listings.json")
MIRROR_MAX_AGE = 6 * 3600   # an older mirror copy is a failure, not data
ROUTE_NAMES = ("oauth", "rss", "shreddit", "mirror")
RSS_END = date(2026, 11, 13)  # r/modnews 2026-09-30: Reddit stops serving RSS
RSS_STREAK_LIMIT = 3          # failed runs in a row before shreddit goes first
MIN_GAP = 4.0                 # seconds between two www.reddit.com requests
COOLDOWN_FIRST = 30 * 60      # first strike after a 403/429
COOLDOWN_MAX = 12 * 3600
WWW_BUCKETS = ("rss", "shreddit")
REMOVED_TITLE_RE = re.compile(r"^\[\s*(removed|deleted)(\s+by\s+[a-z ]+)?\s*\]$", re.I)


class RedditError(Exception):
    """Any failed Reddit read. The message never contains a secret."""


class RateLimited(RedditError):
    def __init__(self, message, retry_after):
        super().__init__(message)
        self.retry_after = retry_after


def credentials(env):
    cid = (env.get("REDDIT_CLIENT_ID") or "").strip()
    secret = (env.get("REDDIT_CLIENT_SECRET") or "").strip()
    return (cid, secret) if cid and secret else None


def user_agent(env):
    return (env.get("REDDIT_USER_AGENT") or "").strip() or DEFAULT_UA


def redact(text, secrets):
    text = str(text)
    for value in secrets:
        if value and len(value) >= 4:
            text = text.replace(value, "[redacted]")
    return text[:ERROR_MAX]


def http_fetch(url, headers=None, data=None):
    """Real network call -> (body bytes, lower-cased response headers)."""
    request = urllib.request.Request(url, headers=headers or {}, data=data)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read(), {k.lower(): v for k, v in response.headers.items()}


def _lower(headers):
    try:
        return {str(k).lower(): v for k, v in (headers or {}).items()}
    except AttributeError:
        return {}


def _number(value):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def build_url(base, path, params, suffix=""):
    path = path.strip("/")
    query = urllib.parse.urlencode([(k, v) for k, v in params.items() if v is not None])
    return f"{base}/{path}{suffix}" + (f"?{query}" if query else "")


def oauth_url(path, **params):
    return build_url(OAUTH_BASE, path, dict(params, raw_json=1))


def rss_url(path, **params):
    # "search" -> /search.rss ; "r/x/new" -> /r/x/new/.rss
    return build_url(RSS_BASE, path, params, ".rss" if path.strip("/") == "search" else "/.rss")


def split_listing_path(path):
    """"r/burlington/new" -> ("burlington", "new"); None for anything else
    (search, a user page): the shreddit and mirror routes only know
    subreddit listings."""
    match = LISTING_PATH_RE.match((path or "").strip("/"))
    return (match.group(1), match.group(2)) if match else None


def shreddit_url(path, **params):
    parts = split_listing_path(path)
    if not parts:
        return None
    sub, sort = parts
    query = [("name", sub)]
    if sort == "top" and params.get("t"):
        query.append(("t", params["t"]))
    return f"{SHREDDIT_BASE}/{sort}/?" + urllib.parse.urlencode(query)


def listing_key(path, **params):
    """The mirror's key for a listing: "r/nba/top?t=day", "r/burlington/new".
    Lower-cased so r/GoodBurlington and r/goodburlington meet; limit is
    ignored (the shreddit route returns one page, about 24 posts)."""
    parts = split_listing_path(path)
    if not parts:
        return None
    sub, sort = parts
    key = f"r/{sub.lower()}/{sort}"
    return key + (f"?t={str(params['t']).lower()}" if sort == "top" and params.get("t") else "")


def route_order(env, today=None, rss_streak=0):
    """Which routes read() tries, in order. REDDIT_ROUTES wins (unknown names
    are ignored); otherwise oauth, rss, shreddit, mirror, with shreddit ahead
    of rss once RSS keeps failing, and no rss at all from RSS_END on."""
    raw = (env.get("REDDIT_ROUTES") or "").strip()
    if raw:
        order = []
        for name in (x.strip().lower() for x in raw.split(",")):
            if name in ROUTE_NAMES and name not in order:
                order.append(name)
        return order
    today = today or date.today()
    if today >= RSS_END:
        return ["oauth", "shreddit", "mirror"]
    if rss_streak >= RSS_STREAK_LIMIT:
        return ["oauth", "shreddit", "rss", "mirror"]
    return ["oauth", "rss", "shreddit", "mirror"]


# ----------------------------------------------------------------------
# The shreddit fragment -> the OAuth listing shape
# ----------------------------------------------------------------------

class _ShredditParser(HTMLParser):
    """Collects each <shreddit-post>'s attributes and the text inside its
    <shreddit-post-flair>. Nothing else on the page is read."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.posts = []
        self.after = None
        self._flair_depth = 0
        self._flair_text = []

    def handle_starttag(self, tag, attrs):
        if tag == "shreddit-post":
            self.posts.append({"attrs": dict(attrs), "flair": ""})
        elif tag == "shreddit-post-flair" and self.posts:
            self._flair_depth = 1
            self._flair_text = []
        elif self._flair_depth:
            self._flair_depth += 1
        if tag == "faceplate-partial":
            found = dict(attrs)
            if found.get("slot") == "load-after" and "after=" in (found.get("src") or ""):
                query = urllib.parse.urlsplit(found["src"]).query
                self.after = (urllib.parse.parse_qs(query).get("after") or [None])[0]

    def handle_endtag(self, tag):
        if not self._flair_depth:
            return
        if tag == "shreddit-post-flair":
            self._flair_depth = 0
            self.posts[-1]["flair"] = " ".join(" ".join(self._flair_text).split())
        else:
            self._flair_depth = max(1, self._flair_depth - 1)

    def handle_data(self, data):
        if self._flair_depth:
            self._flair_text.append(data)


def _int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _timestamp(value):
    """"2026-10-22T14:48:29.643000+0000" -> epoch seconds, or None."""
    value = (value or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(value, fmt).timestamp()
        except ValueError:
            continue
    return None


def _is_reddit_host(url):
    host = (urllib.parse.urlsplit(url or "").hostname or "").lower()
    return bool(re.search(r"(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)$", host))


def parse_shreddit(raw):
    """The fragment's HTML -> {"kind": "Listing", "data": {"after", "children",
    "removed_ids"}}, each child {"kind": "t3", "data": {...}} with OAuth's
    field names. Keeps only what the callers use: id, title, permalink, url,
    url_overridden_by_dest (an outside link), is_self, created_utc, score,
    num_comments, link_flair_text, over_18, stickied, subreddit and, for a
    crosspost, the parent id. Never author names, bodies or comments.
    Removed or deleted posts are dropped; their ids go in removed_ids."""
    text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
    parser = _ShredditParser()
    parser.feed(text)
    parser.close()
    children, removed, seen = [], [], set()
    for post in parser.posts:
        a = post["attrs"]
        pid = (a.get("id") or "").lower()
        pid = pid[3:] if pid.startswith("t3_") else pid
        permalink = a.get("permalink") or ""
        if not re.fullmatch(r"[a-z0-9]{3,12}", pid) or "/comments/" not in permalink or pid in seen:
            continue
        seen.add(pid)
        title = " ".join((a.get("post-title") or "").split())
        if (REMOVED_TITLE_RE.match(title) or any(k in a for k in ("is-removed", "removed", "deleted"))
                or a.get("item-state") in ("removed", "deleted")):
            removed.append(pid)
            continue
        if not title:
            continue
        href = a.get("content-href") or ""
        if href.startswith("/"):
            href = "https://www.reddit.com" + href
        kind = (a.get("post-type") or "").lower()
        row = {
            "id": pid, "name": "t3_" + pid, "title": title, "permalink": permalink,
            "url": href or "https://www.reddit.com" + permalink,
            "is_self": kind == "text",
            "created_utc": _timestamp(a.get("created-timestamp")),
            "score": _int(a.get("score")),
            "num_comments": _int(a.get("comment-count")),
            "link_flair_text": post["flair"] or None,
            "over_18": any(k in a for k in ("nsfw", "is-nsfw", "over18")),
            "stickied": any(k in a for k in ("stickied", "pinned", "is-pinned")),
            "subreddit": a.get("subreddit-name") or "",
            "post_type": kind,
        }
        if href.startswith("http") and not _is_reddit_host(href):
            row["url_overridden_by_dest"] = href
        if kind == "crosspost":
            parent = re.search(r"/comments/([a-z0-9]+)", href, re.I)
            if parent:
                row["crosspost_parent_list"] = [{"id": parent.group(1).lower()}]
        children.append({"kind": "t3", "data": row})
    return {"kind": "Listing",
            "data": {"after": parser.after, "children": children, "removed_ids": removed}}


class Client:
    """One per run. fetch(url, headers, data) may return bytes or
    (bytes, headers); tests inject one so nothing touches the network.
    state_path (or REDDIT_STATE_FILE) keeps the cross-run back-off and the
    RSS failure streak; without it, back-off lasts one run."""

    def __init__(self, env=None, fetch=None, sleep=time.sleep, clock=time.time, max_wait=MAX_WAIT,
                 state_path=None):
        self.env = os.environ if env is None else env
        self.fetch = fetch or http_fetch
        self.sleep = sleep
        self.clock = clock
        self.max_wait = max_wait
        self.ua = user_agent(self.env)
        self._creds = credentials(self.env)
        self._token = None
        self._token_until = 0.0
        self._limits = {}  # bucket -> (remaining, reset_at)
        self.min_gap = _number(self.env.get("REDDIT_MIN_GAP"))
        self.min_gap = MIN_GAP if self.min_gap is None else max(self.min_gap, 0.0)
        self._last_www = None       # clock() of the last www.reddit.com request
        self._tripped = {}          # route -> reason, for the rest of this run
        self._rss_fails = 0         # in this run
        self._mirror = None         # the mirror document, fetched once per run
        self.state_path = state_path or (self.env.get("REDDIT_STATE_FILE") or "").strip() or None
        self.state = self._load_state()

    @property
    def oauth(self):
        return self._creds is not None

    def _secrets(self):
        values = list(self._creds or ()) + [self._token]
        if self._creds:
            values.append(base64.b64encode(f"{self._creds[0]}:{self._creds[1]}".encode()).decode())
        return [v for v in values if v]

    def _error(self, message):
        return RedditError(redact(message, self._secrets()))

    # -- cross-run state (Mac runner only) -----------------------------------

    def _load_state(self):
        if not self.state_path:
            return {}
        try:
            with open(self.state_path, encoding="utf-8") as src:
                state = json.load(src)
            return state if isinstance(state, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save_state(self):
        if not self.state_path:
            return
        try:
            os.makedirs(os.path.dirname(os.path.abspath(self.state_path)), exist_ok=True)
            tmp = self.state_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as dst:
                json.dump(self.state, dst, indent=1, sort_keys=True)
            os.replace(tmp, self.state_path)
        except OSError:
            pass  # back-off still holds for this run

    def cooldown(self, route):
        """Seconds left on route's cross-run back-off (0 when none)."""
        entry = (self.state.get("cooldown") or {}).get(route) or {}
        return max(0.0, (_number(entry.get("until")) or 0.0) - self.clock())

    def _strike(self, route, reason):
        """A final 403/429 from a www.reddit.com route: stop asking for the
        rest of the run, and back off across runs, doubling per strike."""
        self._tripped[route] = reason
        if not self.state_path:
            return
        cool = self.state.setdefault("cooldown", {})
        strikes = int((cool.get(route) or {}).get("strikes") or 0) + 1
        wait = min(COOLDOWN_FIRST * 2 ** (strikes - 1), COOLDOWN_MAX)
        cool[route] = {"strikes": strikes, "until": self.clock() + wait, "reason": reason,
                       "at": datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(timespec="seconds")}
        self._save_state()

    def _cleared(self, route):
        cool = self.state.get("cooldown") or {}
        if route in cool:
            del cool[route]
            self._save_state()

    @property
    def rss_streak(self):
        return int(self.state.get("rss_fail_streak") or 0)

    def note_rss_run(self, ok):
        """The Mac runner reports once per run whether RSS answered; three
        failed runs in a row put shreddit ahead of rss in read()."""
        self.state["rss_fail_streak"] = 0 if ok else self.rss_streak + 1
        self._save_state()

    def order(self, today=None):
        today = today or datetime.fromtimestamp(self.clock(), timezone.utc).date()
        streak = self.rss_streak + (RSS_STREAK_LIMIT if self._rss_fails >= 2 else 0)
        return route_order(self.env, today, streak)

    # -- rate limits -------------------------------------------------------

    def _pause(self, seconds):
        self.sleep(seconds)
        self._last_www = None  # a deliberate wait is longer than the gap

    def _note(self, bucket, headers):
        remaining = _number(headers.get("x-ratelimit-remaining"))
        reset = _number(headers.get("x-ratelimit-reset"))
        if remaining is not None and reset is not None:
            self._limits[bucket] = (remaining, self.clock() + reset)

    def _wait_turn(self, bucket):
        remaining, reset_at = self._limits.get(bucket, (None, 0.0))
        if remaining is None or remaining >= 1:
            return
        wait = reset_at - self.clock()
        if wait <= 0:
            return
        if wait > self.max_wait:
            raise RateLimited(f"rate-limit window spent ({bucket}), resets in {int(wait)}s", wait)
        self._pause(wait + 1)

    def _gap(self, bucket):
        if bucket not in WWW_BUCKETS or self._last_www is None:
            return
        wait = self.min_gap - (self.clock() - self._last_www)
        if wait > 0:
            self._pause(wait)

    def _retry_after(self, headers):
        for key in ("retry-after", "x-ratelimit-reset"):
            value = _number(headers.get(key))
            if value is not None and value >= 0:
                return value
        return DEFAULT_RETRY

    def _request(self, bucket, url, headers, data=None, retry_429=True):
        if bucket in self._tripped:
            raise RedditError(f"{bucket} stopped for this run ({self._tripped[bucket]})")
        for attempt in (0, 1):
            self._wait_turn(bucket)
            self._gap(bucket)
            if bucket in WWW_BUCKETS:
                self._last_www = self.clock()
            try:
                result = self.fetch(url, headers, data)
            except urllib.error.HTTPError as exc:
                got = _lower(getattr(exc, "headers", None))
                try:
                    exc.close()  # an HTTPError holds the open response
                except Exception:  # noqa: BLE001
                    pass
                self._note(bucket, got)
                if exc.code == 429:
                    wait = self._retry_after(got)
                    if retry_429 and attempt == 0 and wait <= self.max_wait:
                        self._pause(wait + 1)
                        continue
                    if bucket in WWW_BUCKETS:
                        # "slow down" is about this address, so the other
                        # www.reddit.com route stops for the run too
                        for other in WWW_BUCKETS:
                            self._tripped.setdefault(other, f"HTTP 429 from {bucket}")
                        self._strike(bucket, "HTTP 429")
                    raise RateLimited(f"HTTP 429 ({bucket}), retry in {int(wait)}s", wait) from None
                if exc.code == 403 and bucket in WWW_BUCKETS:
                    self._strike(bucket, "HTTP 403")
                raise self._error(f"HTTP {exc.code}") from None
            except RedditError:
                raise
            except Exception as exc:  # noqa: BLE001 — timeouts, DNS, bad TLS
                raise self._error(f"{exc.__class__.__name__}: {exc}") from None
            body, got = result if isinstance(result, tuple) else (result, {})
            self._note(bucket, _lower(got))
            return body
        raise RateLimited(f"HTTP 429 ({bucket})", DEFAULT_RETRY)  # pragma: no cover

    # -- routes ------------------------------------------------------------

    def token(self):
        """Application-only OAuth token, cached for its lifetime. None when
        the two secrets are not set."""
        if not self._creds:
            return None
        if self._token and self.clock() < self._token_until:
            return self._token
        cid, secret = self._creds
        basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
        raw = self._request("token", TOKEN_URL,
                            {"User-Agent": self.ua, "Authorization": "Basic " + basic},
                            b"grant_type=client_credentials")
        try:
            reply = json.loads(raw)
        except ValueError:
            raise self._error("token reply was not JSON") from None
        token = reply.get("access_token") if isinstance(reply, dict) else None
        if not token:
            # Reddit's own error field only ("invalid_grant", "unauthorized_client").
            reason = reply.get("error") if isinstance(reply, dict) else None
            raise self._error(f"no access_token in the reply ({reason or 'no reason given'})")
        self._token = token
        lifetime = _number(reply.get("expires_in")) or 3600
        self._token_until = self.clock() + max(lifetime - TOKEN_SLACK, 30)
        return token

    def oauth_json(self, path, **params):
        """GET oauth.reddit.com/<path> -> parsed JSON. Raises RedditError
        when the secrets are missing or the call fails."""
        token = self.token()
        if not token:
            raise RedditError("REDDIT_CLIENT_ID/SECRET not set")
        raw = self._request("oauth", oauth_url(path, **params),
                            {"User-Agent": self.ua, "Authorization": "bearer " + token})
        try:
            return json.loads(raw)
        except ValueError:
            raise self._error("reply was not JSON") from None

    def rss(self, path, **params):
        """GET www.reddit.com/<path>/.rss -> Atom bytes."""
        wait = self.cooldown("rss")
        if wait:
            raise RedditError(f"rss backing off for {int(wait // 60)} more min")
        try:
            body = self._request("rss", rss_url(path, **params),
                                 {"User-Agent": self.ua, "Accept": "application/atom+xml, application/xml"})
        except RedditError:
            self._rss_fails += 1
            raise
        self._cleared("rss")
        return body

    def shreddit_json(self, path, **params):
        """The logged-out reddit.com fragment for a subreddit listing ->
        an OAuth-shaped listing dict. One page (about 24 posts); `limit`
        is ignored. No cookies are ever sent."""
        url = shreddit_url(path, **params)
        if not url:
            raise RedditError(f"shreddit has no page for {path.strip('/')}")
        wait = self.cooldown("shreddit")
        if wait:
            raise RedditError(f"shreddit backing off for {int(wait // 60)} more min")
        raw = self._request("shreddit", url,
                            {"User-Agent": self.ua, "Accept": "text/html,application/xhtml+xml"},
                            retry_429=False)
        listing = parse_shreddit(raw)
        if not listing["data"]["children"] and not listing["data"]["removed_ids"]:
            # A challenge page or a renamed fragment looks exactly like this:
            # treat it as a failure so callers keep their last good data.
            raise RedditError("shreddit page had no posts (challenge page or layout change?)")
        self._cleared("shreddit")
        return listing

    def mirror_json(self, path, **params):
        """The Mac runner's last shreddit copy of this listing, from the
        reddit-data branch (REDDIT_MIRROR: a URL or a file path; "off"
        disables it). Older than MIRROR_MAX_AGE is a failure."""
        key = listing_key(path, **params)
        if not key:
            raise RedditError(f"mirror has no page for {path.strip('/')}")
        doc = self._mirror_doc()
        entry = ((doc.get("listings") or {}).get(key)) if isinstance(doc, dict) else None
        if not isinstance(entry, dict) or not isinstance(entry.get("data"), dict):
            raise RedditError(f"mirror has no {key}")
        fetched = None
        try:
            fetched = datetime.fromisoformat(str(entry.get("fetched")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
        age = self.clock() - fetched if fetched else None
        if age is None or age > MIRROR_MAX_AGE:
            hours = f"{age / 3600:.0f}h old" if age is not None else "undated"
            raise RedditError(f"mirror copy of {key} is {hours}")
        return entry["data"]

    def _mirror_doc(self):
        if self._mirror is None:
            source = (self.env.get("REDDIT_MIRROR") or "").strip() or MIRROR_URL
            try:
                if source.lower() == "off":
                    raise RedditError("mirror switched off")
                if source.startswith("http"):
                    raw = self._request("mirror", source, {"User-Agent": self.ua,
                                                           "Accept": "application/json"})
                else:
                    with open(source, "rb") as src:
                        raw = src.read()
                doc = json.loads(raw)
                self._mirror = doc if isinstance(doc, dict) else {}
            except (RedditError, OSError, ValueError) as exc:
                self._mirror = {"error": str(exc)[:ERROR_MAX]}
        if self._mirror.get("error"):
            raise RedditError("mirror unavailable: " + self._mirror["error"])
        return self._mirror

    def _try(self, route, path, params):
        if route == "oauth":
            if not self.oauth:
                return None
            return self.oauth_json(path, **params)
        if route == "rss":
            return self.rss(path, **params)
        if route == "shreddit":
            return self.shreddit_json(path, **params)
        if route == "mirror":
            return self.mirror_json(path, **params)
        return None

    def _first(self, routes, path, params):
        first_error = None
        for route in routes:
            try:
                data = self._try(route, path, params)
            except RedditError as exc:
                first_error = first_error or exc
                continue
            if data is not None:
                return route, data
        if first_error is not None:
            raise first_error
        raise RedditError(f"no route can read {path.strip('/')}")

    def read(self, path, **params):
        """(route, data) from the first route that answers, in order(): data
        is Atom bytes when route == "rss", else an OAuth-shaped listing dict.
        Raises the first route's error when every route fails."""
        return self._first(self.order(), path, params)

    def listing(self, path, **params):
        """Like read(), but only the routes that return a listing dict
        (oauth, shreddit, mirror): for callers that parse listing JSON."""
        return self._first([r for r in self.order() if r != "rss"], path, params)
