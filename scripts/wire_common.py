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
            "src": source["id"], "name": source.get("short") or source.get("name") or source["id"],
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
        out.append(entry)
    for ch, state in (pulse.get("inbox") or {}).items():
        if ch not in ("x", "facebook") or not isinstance(state, dict):
            continue
        for post in state.get("items") or []:
            when, url = post.get("d"), post.get("u")
            if not url or not isinstance(when, int) or when < cutoff or when > now_ts + 3600:
                continue
            out.append({
                "id": item_id(url), "ch": ch, "local": bool(post.get("local", True)),
                "src": f"{ch}:{post.get('from')}", "name": post.get("name") or post.get("from"),
                "handle": post.get("from"), "title": post.get("summary") or "",
                "url": url, "posted_at": iso_ts(when), "d": when, "kind": post.get("kind"),
            })
            if ch == "x" and str(post.get("from") or "").startswith("@"):
                out[-1]["site"] = "https://x.com/" + post["from"][1:]
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
    with open(os.path.join(ROOT, "prompts", name), encoding="utf-8") as src:
        return src.read()


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
OPENROUTER_BASE_URL = "https://openrouter.ai/api"
MONTH_CAP_USD = 25.0


def pick_engine(role):
    """role is "tag" or "curate" -> {"provider", "model"} or None (no key)."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return {"provider": "anthropic",
                "model": "claude-haiku-5-5" if role == "tag" else "claude-opus-5-5"}
    if os.environ.get("OPENROUTER_API_KEY"):
        return {"provider": "openrouter", "model": GLM}
    return None


def cost_usd(model, usage):
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
                usage["in"] += getattr(got, "input_tokens", 0) or 0
                usage["out"] += getattr(got, "output_tokens", 0) or 0
                usage["cache_read"] += getattr(got, "cache_read_input_tokens", 0) or 0
                usage["cache_write"] += getattr(got, "cache_creation_input_tokens", 0) or 0
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
    assert abs(cost_usd("claude-opus-5-5", {"in": 1_000_000, "out": 100_000}) - 6.0) < 1e-9
    assert pick_engine is not None and et_now().tzinfo is not None
    slim = portable_schema({"type": "array", "minItems": 5, "maxItems": 9,
                            "items": {"type": "string", "maxLength": 9}})
    assert slim == {"type": "array", "items": {"type": "string"}}
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        print(__doc__)
