#!/usr/bin/env python3
"""Shared plumbing for the Wire: channels, ids, the model call, the cost ledger.

Used by refresh_pulse.py (mechanical channels only), tag_wire.py and
curate_wire.py. Standard library only; the Anthropic SDK is imported lazily
inside ask_json so the tests and selftests never need it.

Channels. Every item on the Wire has a `ch`, the kind of source it came from,
which is what the page's chips filter on, and a `local` flag, which is what
the Local / Everything switch filters on:

  local        a Burlington or Vermont outlet's headline
  world        a national or international outlet's headline
  x            an X post (the inbox's grok/x.json)
  facebook     a public Facebook group post (the inbox's muse/facebook.json)
  reddit       a subreddit thread
  newsletters  an email newsletter edition
  video        a YouTube or Vimeo link

The mechanical part needs no model: the Inoreader folder (local vs national
vs Newsletters), the source's site (reddit.com, youtube.com), and the inbox
file. tag_wire.py then settles what the folder cannot know (a Vermont
station's wire story about Gaza is not local; a national outlet's story about
Winooski is).

Engines. Which models run is decided by which key exists, never by a flag:
ANTHROPIC_API_KEY -> Claude Haiku 5.5 tags, Claude Opus 5.5 curates;
otherwise OPENROUTER_API_KEY -> GLM 5.3 Flash runs both prompts. No key -> the
scripts skip quietly and the last good files stay up.
"""

import hashlib
import html
import json
import os
import re
import sys
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001 — tzdata missing would be a broken runner
    ET = None

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CHANNELS = ("local", "world", "x", "facebook", "reddit", "newsletters", "video")
CHIPS = ("all", "x", "facebook", "reddit", "newsletters", "video")

# Newsletters whose subject is Burlington or Vermont. Ids are the pulse
# source ids (slug of the Inoreader title); an unknown newsletter is national.
LOCAL_NEWSLETTERS = {
    "7days", "btv-daily", "burlington-tasting-room", "compass", "daybreak",
    "essex-reporter", "love-burlington", "vermont-poltical-observer",
    "vermont-public", "vermont-sports", "vtdigger-dd84",
}
VIDEO_HOSTS = ("youtube.com", "youtu.be", "vimeo.com")

# Sports (Stephen, 2026-10-19: "better sports coverage ... the ability to
# select the specific sport. Like nba"). Every sports item on the Wire carries
# a `sport`, which the page's sport chips filter on. `local` is any Vermont
# team or school (UVM, Vermont Green FC, the Lake Monsters, high schools),
# whatever the game; `college` is college sports elsewhere.
# Later that day: "Sports: keep it light ... Chips: NBA, NFL, NHL, Tennis,
# Local (MLB in postseason; college optional; drop soccer)". Soccer is no
# longer its own sport (a soccer story is `other`), and MLB is a chip only in
# its postseason (sport_chips); the rest of the year an MLB story counts as
# `other` on the chips while keeping its own `sport`.
SPORTS = ("nba", "nfl", "nhl", "tennis", "mlb", "college", "local", "other")
# values an older tag, river item or recap may still carry -> today's sport
LEGACY_SPORTS = {"soccer": "other"}
# MLB's postseason, as (month, day) bounds: the Wild Card round opens around
# the last day of September and the World Series is over by early November.
MLB_POSTSEASON = ((9, 29), (11, 7))
# Sources that only ever carry one sport: their items get that sport without
# a model. Keys are pulse source ids, or "x:@handle" (lowercase) for X posts.
SOURCE_SPORT = {
    "espn-com-nba": "nba", "espn-com-nfl": "nfl", "espn-mlb": "mlb", "espn-nhl": "nhl",
    "espn-college-football": "college", "espn-college-basketball": "college",
    "espn-tennis": "tennis",
    "wcax-sports": "local", "mychamplainvalley-sports": "local",
    "university-of-vermont-athletics": "local", "vermont-green-fc": "local",
    "vermont-sports": "local",
    "x:@shamscharania": "nba", "x:@nba": "nba", "x:@adamschefter": "nfl", "x:@nfl": "nfl",
    "x:@jeffpassan": "mlb", "x:@mlb": "mlb", "x:@friedgehnic": "nhl", "x:@nhl": "nhl",
    "x:@petethamel": "college", "x:@josemorgado": "tennis", "x:@atptour": "tennis",
    "x:@wta": "tennis",
    "x:@uvmathletics": "local", "x:@vermontgreenfc": "local", "x:@vtlakemonsters": "local",
}


# Markets desks (Stephen, 2026-10-19: "can we also add some stock news"): the
# tagger files their stories under `markets` unless it says business or economy,
# and then curate_wire.apply_tags moves them to `markets` anyway.
MARKETS_SOURCES = {"cnbc-market-insider", "marketwatch-bulletins"}


def source_sport(src):
    """The one sport a single-sport source carries, or None."""
    return SOURCE_SPORT.get((src or "").lower())


def norm_sport(value):
    """A stored sport as today's vocabulary knows it, or None."""
    value = LEGACY_SPORTS.get(value, value)
    return value if value in SPORTS else None


def mlb_postseason(date):
    """Is `date` (a date, or "YYYY-MM-DD") inside MLB's postseason?"""
    if isinstance(date, str):
        date = datetime.fromisoformat(date).date()
    (m0, d0), (m1, d1) = MLB_POSTSEASON
    return (m0, d0) <= (date.month, date.day) <= (m1, d1)


def sport_chips(date):
    """The sport chips for a day, in the order the page shows them. `other`
    is never a chip: those stories live in the daily Sports recap."""
    chips = ["nba", "nfl", "nhl", "tennis"]
    if mlb_postseason(date):
        chips.append("mlb")
    return chips + ["local", "college"]


def sport_chip(sport, date):
    """Which chip a story with this sport sits under on `date`."""
    sport = norm_sport(sport)
    if sport is None:
        return None
    if sport == "mlb" and not mlb_postseason(date):
        return "other"
    return sport


# The newsletter's own edition. It is always in the river (the way Stephen's
# own events are always in the newsletter) and never judged as junk.
OWN_SOURCES = {"btown-brief"}


def host_of(url):
    host = re.sub(r"^https?://", "", (url or "").lower()).split("/")[0]
    return re.sub(r"^(www|m|amp)\.", "", host)


def utcnow():
    return datetime.now(timezone.utc)


def et_now(now=None):
    return (now or utcnow()).astimezone(ET)


def item_id(url):
    """Stable short id for a URL. Pulse URLs are already canonical
    (refresh_pulse.canon_url), so a plain hash is stable across runs."""
    return hashlib.sha1((url or "").strip().encode("utf-8")).hexdigest()[:12]


def display_name(source):
    """The outlet's name as a reader knows it ("Vermont Public", not
    local-news-2310). Entities are decoded and a short name that was cut
    off ("Top News &amp…") gives way to the full one."""
    short = html.unescape(source.get("short") or "").strip()
    full = html.unescape(source.get("name") or "").strip()
    if not short or short.endswith("…"):
        short = full or short
    return short or source.get("id") or ""


# ----------------------------------------------------------------------
# Places: is the story about the Burlington area, elsewhere in Vermont, or
# out of state? Read from the headline (and a few single-town sources).
# ----------------------------------------------------------------------

BTV_PLACES = (
    "Burlington", "Winooski", "South Burlington", "Essex", "Essex Junction", "Colchester",
    "Williston", "Shelburne", "Charlotte", "Milton", "Hinesburg", "Richmond", "Jericho",
    "Underhill", "Westford", "St. George", "Huntington", "Bolton", "Chittenden",
    "Church Street", "Old North End", "South End", "New North End", "Intervale", "North Beach",
    "Oakledge", "the Flynn", "UVM", "University of Vermont", "Champlain College",
    "Saint Michael's", "St. Michael's", "Lake Champlain", "BTV", "Queen City",
)
AWAY_PLACES = (
    "Barre", "Montpelier", "Rutland", "Brattleboro", "Bennington", "St. Albans",
    "Saint Albans", "Middlebury", "Stowe", "Waterbury", "Brandon", "Moretown", "Shaftsbury",
    "Hardwick", "Newport", "St. Johnsbury", "Springfield", "Randolph", "Bristol",
    "Vergennes", "Woodstock", "Killington", "Ludlow", "Dorset", "Northfield", "Morrisville",
    "Johnson", "Swanton", "Enosburg", "Lyndonville", "Windsor", "White River Junction",
    "Norwich", "Thetford", "Groton", "Otter Valley", "Smugglers' Notch", "Smugglers’ Notch",
    "Jay Peak", "Sugarbush", "Mad River", "Arlington", "Castleton", "Fair Haven", "Poultney",
    "Wilmington", "Bellows Falls", "Derby", "Barton", "Cabot", "Waitsfield", "Warren",
    "Manchester, Vt", "Northeast Kingdom", "Franklin County", "Addison County",
    "Rutland County", "Washington County", "Lamoille",
)
OUT_PLACES = (
    "New Hampshire", "N.H.", "Claremont", "Hanover", "Lebanon, N.H.", "Plattsburgh",
    "Keene", "Adirondack", "Upstate New York", "Massachusetts", "Maine",
)
VERMONT_WORDS = ("Vermont", "Vermonters", "Vt.", "VT", "statewide", "Statehouse",
                 "Legislature", "Gov. Scott", "Phil Scott")
# sources that only ever cover the Burlington area
BTV_SOURCES = {"r-burlington", "burlington-vt-news-flash-police-department",
               "the-charlotte-news", "btown-brief", "btv-daily", "love-burlington",
               "the-vermont-cynic", "burlington-tasting-room"}


def _place_re(names):
    return re.compile(r"(?<![\w'’])(" + "|".join(re.escape(n) for n in names) + r")(?!\w)")


BTV_RE, AWAY_RE, OUT_RE, VT_RE = (_place_re(BTV_PLACES), _place_re(AWAY_PLACES),
                                  _place_re(OUT_PLACES), _place_re(VERMONT_WORDS))


def place_of(title, src=""):
    """-> (region, town). region: "btv" (Burlington area), "away" (named
    Vermont town outside it), "out" (out of state), "vt" (statewide), or
    None (no place named). A Burlington-area name wins over any other."""
    title = title or ""
    # "South Burlington" must not read as "Burlington" plus "South"
    for regex, region in ((BTV_RE, "btv"), (AWAY_RE, "away"), (OUT_RE, "out")):
        match = regex.search(title)
        if match:
            return region, match.group(1)
    if src in BTV_SOURCES:
        return "btv", None
    if VT_RE.search(title):
        return "vt", None
    return None, None


# ----------------------------------------------------------------------
# Pick gates: kinds of story the doctrine keeps out of "What matters today"
# ----------------------------------------------------------------------

# a single incident or case (doctrine: river quick hits at most) ...
CRIME_RE = re.compile(
    r"burglar|robber|theft|stole|shoplift|arrest|charged|charges|cited for|convicted|"
    r"conviction|sentenced|pleads|plea deal|indicted|lawsuit|sues\b|sued\b|cruelty|fraud",
    re.I)
# ... unless it is an active public-safety situation
ACTIVE_RE = re.compile(
    r"closed|closure|evacuat|lockdown|shelter in place|missing|at large|manhunt|"
    r"warning|alert|advisory|recall|outbreak|outage|boil water|road(s)? closed", re.I)
THREAD_CHANNELS = ("reddit", "facebook")
THREAD_MIN_COMMENTS = 15
THREAD_PICKS_MAX = 2
THREAD_TOP_RANK = 6          # a thread is never above rank 6
WEEKEND_TOPICS = {"events", "weather", "transportation", "environment", "sports"}
FEATURE_TOPICS = {"arts-culture", "music", "community", "environment", "tech", "science",
                  "health", "media", "other", "food-drink", "events", "sports", "weather"}


def pick_block(item):
    """Why an item may not be a pick, or None. Applied before the editor
    sees the list (the line says "river only") and again after it answers."""
    title = item.get("title") or ""
    if CRIME_RE.search(title) and not ACTIVE_RE.search(title):
        return "a single crime or court story"
    if item.get("ch") in THREAD_CHANNELS:
        comments = item.get("comments")
        if not isinstance(comments, int):
            return "a thread with no comment count"
        if comments < THREAD_MIN_COMMENTS:
            return f"a thread with {comments} comments"
    region = item.get("region")
    if region == "out":
        return "out of state"
    if region == "away" and item.get("topic") not in WEEKEND_TOPICS:
        return "outside the Burlington area"
    return None


def pick_tier(item):
    """Local picks sort by this, model order kept within a tier: Burlington
    area first (and statewide decisions with it), then statewide features,
    then trips out of the area."""
    region = item.get("region")
    if region == "btv":
        return 0
    if region == "away":
        return 2
    return 1 if item.get("topic") in FEATURE_TOPICS or item.get("topic") is None else 0


# ----------------------------------------------------------------------
# Reasons that only restate their headline
# ----------------------------------------------------------------------

STOPWORDS = set("""a an and are as at be been but by for from has have he her his in into is it its
of on or our over she so that the their them they this to up was were what when where which
who will with you your new after about more than just now how why can its it's not no""".split())


def content_words(text):
    words = re.findall(r"[a-z0-9']+", html.unescape(text or "").lower())
    out = set()
    for word in words:
        word = word.strip("'")
        if len(word) < 3 or word in STOPWORDS:
            continue
        out.add(word[:-1] if word.endswith("s") and len(word) > 4 else word)
    return out


def restates(reason, headline, share=0.5):
    """True when half or more of the reason's content words are the
    headline's (Fable's rule says more than half; at exactly half the
    reason is still mostly the headline, so the line sits there)."""
    words = content_words(reason)
    if not words:
        return True
    return len(words & content_words(headline)) / len(words) >= share


def mechanical_channel(source, url=""):
    """(ch, local) for a pulse source and one of its item URLs, no model."""
    site = (source.get("site") or "") + " " + (source.get("feed") or "")
    local = bool(source.get("local"))
    if "reddit.com" in site:
        return "reddit", local
    if source.get("topic") == "newsletters":
        return "newsletters", source.get("id") in LOCAL_NEWSLETTERS
    if any(host in (url or "") for host in VIDEO_HOSTS) or \
            any(host in site for host in VIDEO_HOSTS):
        return "video", local
    return ("local" if local else "world"), local


def iso_ts(ts):
    return datetime.fromtimestamp(int(ts), timezone.utc).isoformat()


def wire_items(pulse, now_ts, window_hours):
    """pulse.json -> the Wire's flat candidate items, newest first.

    Every item carries id, ch, local, src, name, title, url, posted_at (and
    `d`, the epoch the code sorts on), plus thumb / media / handle / discuss
    where the source gave one. Titles and summaries are copied verbatim;
    nothing here writes a word a reader will see."""
    sources = {source["id"]: source for source in pulse.get("sources") or []
               if isinstance(source, dict) and source.get("id")}
    # hosts of the outlets the wire already carries: a subreddit post that
    # only links one of their articles is that article, so the outlet's own
    # copy is the one that runs (it wears the thread as `discuss`)
    outlet_hosts = {host_of(source.get("site")) for source in sources.values()
                    if source.get("site") and "reddit.com" not in source["site"]}
    outlet_hosts.discard("")
    cutoff = now_ts - window_hours * 3600
    out = []
    for item in pulse.get("items") or []:
        if not isinstance(item, dict) or item.get("x"):
            continue  # an unlinkable newsletter edition has nowhere to send a reader
        source = sources.get(item.get("s"))
        when, url, title = item.get("d"), item.get("u"), item.get("t")
        if source is None or not url or not title or not isinstance(when, int):
            continue
        if when < cutoff or when > now_ts + 3600:
            continue
        ch, local = mechanical_channel(source, url)
        if ch == "reddit" and not local:
            # r/news, r/worldnews, r/nba: aggregator echoes of the world wire,
            # ~200 a day. The Reddit chip is the town talking, so only the
            # local subs reach the Wire (the raw wire keeps the rest).
            continue
        if ch == "reddit" and host_of(item.get("o")) in outlet_hosts:
            continue
        own = source["id"] in OWN_SOURCES
        if own:
            ch, local = "newsletters", True
        entry = {
            "id": item_id(url), "ch": item.get("ch") or ch,
            "local": bool(item["local"]) if "local" in item else local,
            "src": source["id"], "name": display_name(source),
            "title": title, "url": url, "posted_at": iso_ts(when), "d": when,
        }
        if own:
            entry["own"] = True
        if source.get("site"):
            entry["site"] = source["site"]   # the source sheet's "Open the site"
        if item.get("i"):
            entry["thumb"] = item["i"]
        if item.get("a"):
            entry["media"] = {"type": "audio", "url": item["a"]}
        elif entry["ch"] == "video":
            entry["media"] = {"type": "video", "url": url}
        if item.get("r") or item.get("h"):
            entry["discuss"] = item.get("r") or item.get("h")
        if source_sport(source["id"]):
            entry["sport"] = source_sport(source["id"])
        out.append(entry)
    for ch, state in (pulse.get("inbox") or {}).items():
        if ch not in ("x", "facebook") or not isinstance(state, dict):
            continue
        for post in state.get("items") or []:
            when, url = post.get("d"), post.get("u")
            if not url or not isinstance(when, int) or when < cutoff or when > now_ts + 3600:
                continue
            out.append({
                "id": item_id(url), "ch": ch, "local": bool(post.get("local", ch == "facebook")),
                "src": f"{ch}:{post.get('from')}", "name": post.get("name") or post.get("from"),
                "handle": post.get("from"), "title": post.get("summary") or "",
                "url": url, "posted_at": iso_ts(when), "d": when, "kind": post.get("kind"),
            })
            if ch == "x" and str(post.get("from") or "").startswith("@"):
                out[-1]["site"] = "https://x.com/" + post["from"][1:]
            if source_sport(out[-1]["src"]):
                out[-1]["sport"] = source_sport(out[-1]["src"])
    seen, unique = set(), []
    for entry in sorted(out, key=lambda e: e["d"], reverse=True):
        if entry["id"] in seen or not entry["title"]:
            continue
        seen.add(entry["id"])
        unique.append(entry)
    return unique


def trim(value, limit):
    value = re.sub(r"\s+", " ", value or "").strip()
    if len(value) <= limit:
        return value
    cut = value[:limit - 1].rsplit(" ", 1)[0] or value[:limit - 1]
    return cut.rstrip(" ,.;:-") + "…"


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as src:
            return json.load(src)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as dst:
        json.dump(value, dst, separators=(",", ":"), ensure_ascii=False)
        dst.write("\n")
    os.replace(tmp, path)


def read_prompt(name):
    """A private taste prompt (scripts/private_prompts.py); raises if missing."""
    import private_prompts
    return private_prompts.load(name)


def step_summary(text):
    """Append markdown to the Actions step summary when there is one."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as dst:
            dst.write(text.rstrip() + "\n")
    except OSError:
        pass


# ----------------------------------------------------------------------
# Engines and prices
# ----------------------------------------------------------------------

# $ per million tokens. Anthropic list prices (cached 2026-10-06) and
# OpenRouter's GLM 5.3 Flash (2026-10-16; reasoning is billed as output).
PRICES = {
    "claude-haiku-5-5": {"in": 0.10, "out": 0.50, "cache_read": 0.01, "cache_write": 0.125},
    "claude-opus-5-5": {"in": 4.00, "out": 20.00, "cache_read": 0.20, "cache_write": 5.00},
    "z-ai/glm-5.3-flash": {"in": 0.014, "out": 0.90, "cache_read": 0.014, "cache_write": 0.014},
}
GLM = "z-ai/glm-5.3-flash"
# Opus 5.5's server-side fallback targets (Opus 4.8 / Opus 5) list at $5/$25.
PRICES["claude-opus-4-8"] = {"in": 5.00, "out": 25.00, "cache_read": 0.50, "cache_write": 6.25}
FALLBACK_PRICE_AS = "claude-opus-4-8"
OPENROUTER_BASE_URL = "https://openrouter.ai/api"
# Stephen's Max plan carries $100 a month of API credits (2026-10-16). The Wire
# takes at most $60 of it, leaving room for whatever else uses the key.
MONTH_CAP_USD = 60.0


def pick_engine(role):
    """role is "tag" or "curate" -> {"provider", "model"} or None (no key)."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return {"provider": "anthropic",
                "model": "claude-haiku-5-5" if role == "tag" else "claude-opus-5-5"}
    if os.environ.get("OPENROUTER_API_KEY"):
        return {"provider": "openrouter", "model": GLM}
    return None


def cost_usd(model, usage):
    if usage.get("fallback"):
        model = FALLBACK_PRICE_AS
    price = PRICES.get(model)
    if not price:
        return 0.0
    return (usage.get("in", 0) * price["in"] + usage.get("out", 0) * price["out"]
            + usage.get("cache_read", 0) * price["cache_read"]
            + usage.get("cache_write", 0) * price["cache_write"]) / 1_000_000


class ModelError(RuntimeError):
    pass


def ask_json(engine, system, user, schema, max_tokens, attempts=2, log_prefix="wire"):
    """One structured-output call, retried once. -> (parsed_json, usage).

    usage is summed over every attempt, failed ones included, because a
    failed attempt is still billed. Raises ModelError with that usage
    attached (exc.usage) when no attempt produced valid JSON."""
    import anthropic

    usage = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "calls": 0}
    if engine["provider"] == "anthropic":
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    else:
        client = anthropic.Anthropic(api_key=os.environ["OPENROUTER_API_KEY"],
                                     base_url=OPENROUTER_BASE_URL)
    last = None
    for attempt in range(1, attempts + 1):
        try:
            response = _create(client, engine, system, user, schema, max_tokens, attempt)
            got = getattr(response, "usage", None)
            if got is not None:
                add_usage(usage, got)
            usage["calls"] += 1
            if response.stop_reason == "refusal":
                raise ModelError("the model declined to answer")
            if response.stop_reason == "max_tokens":
                raise ModelError("response truncated at max_tokens")
            text = next((block.text for block in response.content
                         if block.type == "text"), None)
            if not text:
                raise ModelError("no text in the response")
            return json.loads(text), usage
        except Exception as exc:  # noqa: BLE001 — retried, then reported
            last = exc
            print(f"{log_prefix}: attempt {attempt}/{attempts} failed ({exc})",
                  file=sys.stderr)
    error = ModelError(str(last))
    error.usage = usage
    raise error


# Constraints Anthropic's structured outputs do not accept (numbers, string
# lengths, array sizes beyond a 0/1 floor). The code enforces every one of
# them after the call anyway; GLM gets the full schema because there the
# bounds are what stop a looping answer (see curate_top.py).
UNPORTABLE = ("maxItems", "maxLength", "minLength", "minimum", "maximum")


def portable_schema(schema):
    if isinstance(schema, dict):
        out = {}
        for key, value in schema.items():
            if key in UNPORTABLE or (key == "minItems" and value not in (0, 1)):
                continue
            out[key] = portable_schema(value)
        return out
    if isinstance(schema, list):
        return [portable_schema(value) for value in schema]
    return schema


def add_usage(usage, got):
    """Fold one response's usage in. With a server-side fallback, every
    attempt (the declined one included) is in `usage.iterations` while the
    top level covers only the model that answered, so the iterations win
    when they sum higher, and a fallback run is priced at the fallback
    tier's higher rate (the ledger must never undercount the cap)."""
    top = {"in": getattr(got, "input_tokens", 0) or 0,
           "out": getattr(got, "output_tokens", 0) or 0,
           "cache_read": getattr(got, "cache_read_input_tokens", 0) or 0,
           "cache_write": getattr(got, "cache_creation_input_tokens", 0) or 0}
    iterations = getattr(got, "iterations", None) or []
    if iterations:
        summed = {key: 0 for key in top}
        for entry in iterations:
            summed["in"] += getattr(entry, "input_tokens", 0) or 0
            summed["out"] += getattr(entry, "output_tokens", 0) or 0
            summed["cache_read"] += getattr(entry, "cache_read_input_tokens", 0) or 0
            summed["cache_write"] += getattr(entry, "cache_creation_input_tokens", 0) or 0
            if "fallback" in str(getattr(entry, "type", "")):
                usage["fallback"] = True
        top = {key: max(top[key], summed[key]) for key in top}
    for key, value in top.items():
        usage[key] = usage.get(key, 0) + value


def _create(client, engine, system, user, schema, max_tokens, attempt):
    model = engine["model"]
    fmt = {"type": "json_schema",
           "schema": schema if engine["provider"] == "openrouter" else portable_schema(schema)}
    messages = [{"role": "user", "content": user}]
    if engine["provider"] == "openrouter":
        # Same three guards as curate_top.py, for the same measured reasons:
        # require_parameters keeps OpenRouter off providers that silently drop
        # the schema, and GLM's reasoning must be capped with the SDK's native
        # thinking parameter or it eats the whole max_tokens budget.
        return client.messages.create(
            model=model, max_tokens=max_tokens, system=system, messages=messages,
            output_config={"format": fmt},
            extra_body={"provider": {"require_parameters": True}},
            thinking={"type": "enabled", "budget_tokens": 1024},
        )
    if model == "claude-haiku-5-5":
        # Tagging is classification: thinking off (allowed on Haiku 5.5 at
        # effort high or below), effort low. Haiku has no server-side fallback.
        return client.messages.create(
            model=model, max_tokens=max_tokens, system=system, messages=messages,
            thinking={"type": "disabled"},
            output_config={"effort": "low", "format": fmt},
        )
    # Claude Opus 5.5: thinking cannot be disabled on this model (a 400 at
    # every effort), so `thinking` is omitted and effort low keeps it short.
    # The first attempt opts into the server-side refusal fallback; the retry
    # goes without it, so a 400 on the beta can never block the run.
    params = dict(model=model, max_tokens=max_tokens, system=system, messages=messages,
                  output_config={"effort": "low", "format": fmt})
    if attempt == 1:
        return client.beta.messages.create(
            betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
    return client.messages.create(**params)


# ----------------------------------------------------------------------
# The cost ledger: tokens and estimated dollars, month to date
# ----------------------------------------------------------------------

def ledger_path(data_dir):
    return os.path.join(data_dir, "wire-cost.json")


def month_key(now=None):
    return et_now(now).strftime("%Y-%m")


def load_ledger(data_dir, now=None):
    ledger = load_json(ledger_path(data_dir), {})
    if not isinstance(ledger, dict) or ledger.get("month") != month_key(now):
        ledger = {"v": 1, "month": month_key(now), "usd": 0.0, "runs": []}
    return ledger


def over_budget(data_dir, now=None, cap=MONTH_CAP_USD):
    """-> (refuse, month_to_date_usd)."""
    usd = float(load_ledger(data_dir, now).get("usd") or 0)
    return usd >= cap, usd


def record_cost(data_dir, script, engine, usage, now=None):
    """Add one run to the month's ledger, print it, and put it in the step
    summary. Returns the run's estimated dollars."""
    now = now or utcnow()
    usd = cost_usd(engine["model"], usage)
    ledger = load_ledger(data_dir, now)
    ledger["usd"] = round(float(ledger.get("usd") or 0) + usd, 6)
    ledger["runs"].append({
        "at": now.replace(microsecond=0).isoformat(), "script": script,
        "model": engine["model"], "in": usage.get("in", 0), "out": usage.get("out", 0),
        "cache_read": usage.get("cache_read", 0), "calls": usage.get("calls", 0),
        "usd": round(usd, 6),
    })
    ledger["runs"] = ledger["runs"][-800:]   # a month of hourly runs, two scripts
    write_json(ledger_path(data_dir), ledger)
    line = (f"{script}: {engine['model']} · {usage.get('calls', 0)} call(s) · "
            f"{usage.get('in', 0):,} in / {usage.get('out', 0):,} out tokens · "
            f"${usd:.4f} this run · ${ledger['usd']:.2f} month to date "
            f"(cap ${MONTH_CAP_USD:.0f})")
    print(line)
    step_summary("- " + line)
    return usd


def selftest():
    reddit = {"id": "r-burlington", "site": "https://www.reddit.com/r/burlington/", "local": 1}
    assert mechanical_channel(reddit) == ("reddit", True)
    assert mechanical_channel({"id": "nba", "site": "https://www.reddit.com/r/nba/"}) == ("reddit", False)
    assert mechanical_channel({"id": "7days", "topic": "newsletters"}) == ("newsletters", True)
    assert mechanical_channel({"id": "semafor", "topic": "newsletters"}) == ("newsletters", False)
    assert mechanical_channel({"id": "wcax", "site": "https://www.wcax.com/", "local": 1}) == ("local", True)
    assert mechanical_channel({"id": "ap", "site": "https://apnews.com/"}) == ("world", False)
    assert mechanical_channel({"id": "wcax", "local": 1}, "https://www.youtube.com/watch?v=1") == ("video", True)
    assert item_id("https://a.com/1") == item_id("https://a.com/1 ") != item_id("https://a.com/2")
    assert source_sport("espn-com-nba") == "nba" and source_sport("x:@ShamsCharania") == "nba"
    assert source_sport("x:@AP") is None and set(SOURCE_SPORT.values()) <= set(SPORTS)
    assert "cnbc-market-insider" in MARKETS_SOURCES
    assert source_sport("espn-tennis") == "tennis" and source_sport("x:@FabrizioRomano") is None
    assert norm_sport("soccer") == "other" and norm_sport("tennis") == "tennis" and norm_sport("x") is None
    assert "mlb" in sport_chips("2026-10-19") and "mlb" not in sport_chips("2026-11-08")
    assert "mlb" not in sport_chips("2026-07-04") and "other" not in sport_chips("2026-10-19")
    assert sport_chip("mlb", "2026-07-04") == "other" and sport_chip("mlb", "2026-09-30") == "mlb"
    assert sport_chip("soccer", "2026-10-19") == "other" and sport_chip("nba", "2026-07-04") == "nba"
    pulse = {"sources": [{"id": "espn-mlb", "site": "https://www.espn.com/mlb/"}],
             "items": [{"s": "espn-mlb", "t": "Trade", "u": "https://espn.com/1", "d": 100}],
             "inbox": {"x": {"items": [{"u": "https://x.com/AdamSchefter/status/1", "d": 100,
                                        "from": "@AdamSchefter", "summary": "A trade."}]}}}
    assert sorted(item["sport"] for item in wire_items(pulse, 200, 1)) == ["mlb", "nfl"]
    assert abs(cost_usd("claude-opus-5-5", {"in": 1_000_000, "out": 100_000}) - 6.0) < 1e-9
    assert pick_engine is not None and et_now().tzinfo is not None
    assert display_name({"id": "t", "short": "Top News &amp…", "name": "Top News &amp; Analysis"}) \
        == "Top News & Analysis"
    assert place_of("Millions announced to rebuild Barre's North End") == ("away", "Barre")
    assert place_of("South Burlington adds a bus") == ("btv", "South Burlington")
    assert place_of("Claremont mayor under investigation") == ("out", "Claremont")
    assert place_of("Vermont once dreamed of universal healthcare") == ("vt", None)
    assert place_of("Fed holds rates") == (None, None)
    assert pick_block({"title": "Police searching for suspect in Winooski market burglary"})
    assert pick_block({"title": "Route 2 closed after a crash; driver charged"}) is None
    assert pick_block({"title": "A thread", "ch": "reddit"}) == "a thread with no comment count"
    assert pick_block({"title": "A thread", "ch": "reddit", "comments": 40}) is None
    assert restates("State police update on a police shooting in Williston, a Chittenden County town.",
                    "VSP provides update on investigation into Williston police shooting")
    assert not restates("Your electric bill, starting in January.",
                        "Vermont regulators finalize 5.5% rate increase for Green Mountain Power")
    usage = {}
    add_usage(usage, type("U", (), {"input_tokens": 10, "output_tokens": 0, "iterations": [
        type("I", (), {"type": "message", "input_tokens": 10, "output_tokens": 0}),
        type("I", (), {"type": "fallback_message", "input_tokens": 10, "output_tokens": 5})]})())
    assert usage["in"] == 20 and usage["out"] == 5 and usage["fallback"]
    assert cost_usd("claude-opus-5-5", usage) == cost_usd("claude-opus-4-8", {"in": 20, "out": 5})
    slim = portable_schema({"type": "array", "minItems": 5, "maxItems": 9,
                            "items": {"type": "string", "maxLength": 9}})
    assert slim == {"type": "array", "items": {"type": "string"}}
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        print(__doc__)
