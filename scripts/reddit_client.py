#!/usr/bin/env python3
"""The one door every btown-brief script uses to read Reddit.

Reddit ends RSS on 2026-11-13 (r/modnews, 2026-09-30), already 403s the
logged-out .json endpoints (since 2026-05-28), and closes its public Data API
in March 2027 (r/redditdev, 2026-09-30). This module lets every reader switch
to Reddit's OAuth API the moment Stephen adds the keys, with no code change.

Two routes, picked per call by read():

  oauth  Reddit's Data API with an application-only token (OAuth
         "client_credentials": no Reddit user, read-only). Used whenever
         REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are both set. Returns the
         listing JSON (the same shape the old .json endpoints served).
  rss    Reddit's public .rss/Atom feed. The fallback until then, and also
         the fallback if the OAuth call itself fails. Dies 2026-11-13.

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
import time
import urllib.error
import urllib.parse
import urllib.request

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


class Client:
    """One per run. fetch(url, headers, data) may return bytes or
    (bytes, headers); tests inject one so nothing touches the network."""

    def __init__(self, env=None, fetch=None, sleep=time.sleep, clock=time.time, max_wait=MAX_WAIT):
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

    # -- rate limits -------------------------------------------------------

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
        self.sleep(wait + 1)

    def _retry_after(self, headers):
        for key in ("retry-after", "x-ratelimit-reset"):
            value = _number(headers.get(key))
            if value is not None and value >= 0:
                return value
        return DEFAULT_RETRY

    def _request(self, bucket, url, headers, data=None):
        for attempt in (0, 1):
            self._wait_turn(bucket)
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
                    if attempt == 0 and wait <= self.max_wait:
                        self.sleep(wait + 1)
                        continue
                    raise RateLimited(f"HTTP 429 ({bucket}), retry in {int(wait)}s", wait) from None
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
        return self._request("rss", rss_url(path, **params),
                             {"User-Agent": self.ua, "Accept": "application/atom+xml, application/xml"})

    def read(self, path, **params):
        """("oauth", listing dict) when the keys are set and the call works,
        else ("rss", Atom bytes). Raises the OAuth error if both fail."""
        if self.oauth:
            try:
                return "oauth", self.oauth_json(path, **params)
            except RedditError as oauth_exc:
                try:
                    return "rss", self.rss(path, **params)
                except RedditError:
                    raise oauth_exc from None
        return "rss", self.rss(path, **params)
