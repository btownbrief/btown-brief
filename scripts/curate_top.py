#!/usr/bin/env python3
"""The Pulse — the TOP tab: 25 headlines an editor would keep.

data/pulse.json is the whole firehose (~100 sources, thousands of headlines).
The TOP tab is the opposite: one short list a reader can actually finish. A
model reads the last 24 hours of candidates and picks 25 stories — roughly a
third local — and writes a one-line reason for each.

The model also gets scouts: the "Top Signals" Inoreader folder collects
curation newsletters (Morning Brew, 1440, VTDigger, Seven Days). Headline
links are extracted from those emails, tracking redirects are decoded or
resolved, every link is verified live, and the survivors join the candidate
pool marked CURATED — professional editors' picks the model can adopt.

Two rules hold the thing honest:

  * Headlines are used VERBATIM. The model picks indices out of a numbered
    list and never writes a headline, so nothing on the page is invented.
  * Every pick maps back to a real item in pulse.json, so the URL, source
    and timestamp on the page are the ones the publisher gave us.

Failure posture: any API trouble logs and exits 0 without writing, so the
workflow stays green and the branch keeps its last good list — UNLESS the
live list has already gone stale (see give_up). One miss is normal; a list
frozen for STALE_HOURS is a broken pipeline and fails the run so it is seen.

CLI:
  --out PATH   where to write (default data/pulse-top.json)
  --selftest   run the offline checks and exit
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "pulse-top.json")
PULSE_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
             "pulse-data/data/pulse.json")
UA = "btown-pulse-top/1.0"

MODEL = "z-ai/glm-5.3-flash"
OPENROUTER_BASE_URL = "https://openrouter.ai/api"
WINDOW_HOURS = 24
MAX_CANDIDATES = 400
PICK_COUNT = 25
WHY_MAX = 90

# A real answer is ~800 output tokens. The old 12000 was not headroom, it was
# how long a runaway got to run before anyone found out: four minutes per
# attempt. Generous against the real shape, tight against a loop.
# GLM's reasoning tokens count against this same budget and cannot be
# disabled on this endpoint, so REASONING_MAX_TOKENS caps them (see the
# thinking parameter in ask_once) — without a cap a chatty reasoning pass
# eats all 4000 and the answer never starts.
MAX_TOKENS = 4000
REASONING_MAX_TOKENS = 1024
MODEL_ATTEMPTS = 2

# How stale the live list may get before this job stops pretending it is fine.
# The schedule (10:35/15:35/20:35 UTC) has a 14h overnight gap, and GitHub
# routinely fires crons up to an hour late — so a single missed MORNING run is
# already checking a ~15h-old list. The limit sits just above that: one miss
# stays green in every slot, sustained breakage goes red within a day.
STALE_HOURS = 16

SIGNALS_URL = ("https://www.inoreader.com/stream/user/1003590800/tag/"
               "Top%20Signals?n=30")
SIGNAL_WINDOW_HOURS = 36     # newsletters are dailies; yesterday's still count
MAX_SIGNALS = 40
LINK_TIMEOUT = 8
LOCAL_NEWSLETTERS = {"vtdigger", "seven days", "7days"}
# anchor text that is email plumbing, not a headline
JUNK_TEXT_RE = re.compile(
    r"read (more|our|the|this)|view (this|in|online)|browser|unsubscribe|"
    r"sign.?up|sign.?in|log.?in|subscribe|share|advertis|privacy|preferences|"
    r"refer|shop|follow|download|app store|terms of|contact|feedback|"
    r"update your|digest|password|confirm|verify|welcome|get started", re.I)
# link targets that are never articles
JUNK_URL_RE = re.compile(
    r"instagram\.com|twitter\.com|x\.com/|facebook\.com|tiktok\.com|"
    r"linkedin\.com|youtube\.com/(user|channel|@)|mailto:|unsubscribe|"
    r"aweber|list-manage|/account|/help|/preferences|/advertise|/subscribe|"
    r"/shop|/careers|/privacy|/terms", re.I)

SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            # Bounded on purpose. An unbounded array lets a model that starts
            # looping run until it hits max_tokens — 38k characters of repeated
            # picks, truncated, unparseable, and four minutes of billing to
            # find that out. The ceiling is the ask; the floor keeps a
            # two-pick answer from being written as if it were an edition.
            "minItems": 5,
            "maxItems": PICK_COUNT,
            "items": {
                "type": "object",
                "properties": {
                    "i": {"type": "integer"},
                    # Also trimmed in validate_picks — this stops the model
                    # writing an essay we would only throw away.
                    "why": {"type": "string", "maxLength": WHY_MAX},
                },
                "required": ["i", "why"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["picks"],
    "additionalProperties": False,
}

PROMPT_HEAD = """You are the news editor for "The Pulse", a Burlington, \
Vermont headline reader that carries both local Vermont news and national \
news.

From the numbered list below, pick EXACTLY 25 headlines that a smart reader \
should read right now. Aim for roughly 8 LOCAL and 17 NATIONAL picks — take \
fewer local ones only if the local list is genuinely thin today.

Some entries are marked CURATED: professional newsletter editors (Morning \
Brew, 1440, VTDigger, Seven Days) chose those stories for today's editions. \
That is a strong signal — adopt the best of them freely, some or all — but \
they compete on the same terms as everything else, and the same-story rule \
applies across the whole list.

How to choose:
  * Consequence. What actually matters to someone's week, money, safety,
    government, or understanding of the world.
  * Breadth of subject. No two picks about the same story — when several
    outlets (or a newsletter and an outlet) cover one event, choose the
    single best one and move on.
  * Substance over noise. Skip outrage bait, celebrity churn, listicles,
    sports scores, and pure aggregation.

Order the picks by importance, most important first.

For each pick give its index number and a reason of 90 characters or less \
explaining why it made the cut. The reason is shown as a tooltip, so write \
it for a reader, not for an editor.

Headlines are used verbatim on the page — never rewrite one.

Headlines:
"""


def utcnow():
    return datetime.now(timezone.utc)


def trim(value, limit):
    value = re.sub(r"\s+", " ", value or "").strip()
    if len(value) <= limit:
        return value
    cut = value[:limit - 1].rsplit(" ", 1)[0] or value[:limit - 1]
    return cut.rstrip(" ,.;:-") + "…"


def write_json(path, value):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as dst:
        json.dump(value, dst, separators=(",", ":"), ensure_ascii=False)
        dst.write("\n")


def fetch_pulse(url=PULSE_URL, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


TOP_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
           "pulse-top/data/pulse-top.json")


ARCHIVE_CAP = 10


def fetch_previous(url=TOP_URL, timeout=30):
    """The editions being replaced.

    Returns (prev, archive). `prev` is the single most recent one and keeps
    its old shape because pulse.html reads it. `archive` is the rolling list
    All Day pages back through — the picks are the most-read thing on the
    site and losing them at every rebuild was the complaint.

    The archive is rebuilt from the payload we are replacing: its own picks
    become the newest entry, then whatever it had archived, deduped on
    `generated` so a re-run inside one window cannot double an edition.
    Never a hard failure — a missing branch just means no history yet."""
    try:
        payload = fetch_pulse(url, timeout)
        picks = payload.get("picks")
        generated = payload.get("generated")
        if not (isinstance(picks, list) and picks and generated):
            return None, []
        prev = {"generated": generated, "picks": picks}
        archive, seen = [prev], {generated}
        older = payload.get("editions")
        if not isinstance(older, list):
            # first run after this change: fall back to the one level that
            # the old format carried
            legacy = payload.get("prev")
            older = [legacy] if isinstance(legacy, dict) else []
        for edition in older:
            if not isinstance(edition, dict):
                continue
            stamp = edition.get("generated")
            if not stamp or stamp in seen or not isinstance(edition.get("picks"), list):
                continue
            seen.add(stamp)
            archive.append({"generated": stamp, "picks": edition["picks"]})
            if len(archive) >= ARCHIVE_CAP:
                break
        return prev, archive
    except Exception as exc:  # noqa: BLE001 — the branch may not exist yet
        print(f"curate_top: no previous edition ({exc})", file=sys.stderr)
    return None, []


# ----------------------------------------------------------------------
# Candidates — the last 24 hours, newest first, joined to their source
# ----------------------------------------------------------------------

def build_candidates(payload, now_ts):
    """pulse.json -> [{t,u,s,short,local,d,age,reddit,hn}] newest first."""
    sources = {source["id"]: source for source in payload.get("sources", [])}
    candidates = []
    for item in payload.get("items", []):
        if item.get("x"):
            continue  # unlinkable newsletter edition — nothing to send a reader to
        when = item.get("d")
        source = sources.get(item.get("s"))
        if not when or source is None or not item.get("u") or not item.get("t"):
            continue
        age = (now_ts - when) / 3600.0
        if age < 0 or age > WINDOW_HOURS:
            continue
        candidates.append({
            "t": item["t"],
            "u": item["u"],
            "s": source["id"],
            "short": source.get("short") or source.get("name") or source["id"],
            "local": 1 if source.get("local") else 0,
            "d": when,
            "age": age,
            "reddit": 1 if item.get("r") else 0,
            "hn": item.get("hc") or 0,
        })
    candidates.sort(key=lambda entry: entry["d"], reverse=True)
    return candidates[:MAX_CANDIDATES]


def format_candidates(candidates):
    lines = []
    for index, candidate in enumerate(candidates):
        chatter = ""
        if candidate.get("reddit"):
            chatter += " [reddit thread]"
        if candidate.get("hn"):
            chatter += f" [hn {candidate['hn']} comments]"
        curated = f"CURATED by {candidate['curated']} · " if candidate.get("curated") else ""
        lines.append(
            f"{index}. {curated}{'LOCAL' if candidate['local'] else 'NATIONAL'} · "
            f"{candidate['short']} · {candidate['age']:.0f}h ago · "
            f"{candidate['t']}{chatter}")
    return "\n".join(lines)


def build_prompt(candidates):
    return PROMPT_HEAD + format_candidates(candidates)


# ----------------------------------------------------------------------
# Top Signals — curation newsletters as scouts
# ----------------------------------------------------------------------

NEWSLETTER_NAMES = {"7days": "Seven Days"}


def domain_short(url):
    """https://www.nytimes.com/2026/... -> 'nytimes.com' — the label a
    curated pick wears on the page."""
    host = urllib.parse.urlparse(url).netloc.lower()
    return re.sub(r"^(www|amp|m)\.", "", host) or "web"


def decode_redirect(url):
    """Tracking links often carry the target base64-encoded in the path
    (Morning Brew's link.morningbrew.com/click/<id>/<b64>/... style).
    Return the decoded target when one is found, else the url unchanged."""
    import base64

    for segment in urllib.parse.urlparse(url).path.split("/"):
        if len(segment) < 16:
            continue
        pad = segment + "=" * (-len(segment) % 4)
        try:
            decoded = base64.urlsafe_b64decode(pad).decode("utf-8", "strict")
        except Exception:  # noqa: BLE001 — not base64, keep walking
            continue
        if decoded.startswith("http"):
            return decoded
    return url


def extract_signal_links(html_body, per_item_cap=12):
    """Newsletter HTML -> [(headline_text, target_url)]. Only anchors whose
    text reads like a headline survive; plumbing links never do."""
    import html as html_mod

    out, seen = [], set()
    for href, inner in re.findall(
            r'<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>',
            html_body or "", re.S | re.I):
        text = re.sub(r"\s+", " ", html_mod.unescape(
            re.sub(r"<[^>]+>", " ", inner))).strip()
        if len(text) < 25 or text.startswith("http") or JUNK_TEXT_RE.search(text):
            continue
        target = decode_redirect(html_mod.unescape(href))
        parsed = urllib.parse.urlparse(target)
        if JUNK_URL_RE.search(target) or parsed.path in ("", "/"):
            continue
        if target in seen:
            continue
        seen.add(target)
        out.append((text[:200], target))
        if len(out) >= per_item_cap:
            break
    return out


def fetch_signals(now_ts, url=SIGNALS_URL):
    """The Top Signals folder stream -> candidate dicts, unverified."""
    import email.utils
    import xml.etree.ElementTree as ElementTree

    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        root = ElementTree.fromstring(response.read())

    signals, seen = [], set()
    for item in root.iter("item"):
        source = item.find("source")
        name = (source.text if source is not None else None) or item.findtext(
            "{http://purl.org/dc/elements/1.1/}creator") or "Newsletter"
        name = NEWSLETTER_NAMES.get(name.strip().lower(), name.strip())
        when = now_ts
        pub = item.findtext("pubDate")
        if pub:
            try:
                when = int(email.utils.parsedate_to_datetime(pub).timestamp())
            except Exception:  # noqa: BLE001
                pass
        if (now_ts - when) / 3600.0 > SIGNAL_WINDOW_HOURS:
            continue
        for text, target in extract_signal_links(item.findtext("description")):
            if target in seen:
                continue
            seen.add(target)
            signals.append({
                "t": text,
                "u": target,
                "s": "",
                # readers see the publisher, never the newsletter that
                # scouted it — that stays kitchen-side
                "short": domain_short(target),
                "local": 1 if name.lower() in LOCAL_NEWSLETTERS else 0,
                "d": when,
                "age": max(0.0, (now_ts - when) / 3600.0),
                "curated": name,
            })
            if len(signals) >= MAX_SIGNALS:
                return signals
    return signals


def verify_signals(signals):
    """Every curated link is fetched before it may reach the page. The final
    URL after redirects replaces the tracking link, minus utm noise."""
    kept = []
    for signal in signals:
        try:
            request = urllib.request.Request(
                signal["u"], headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=LINK_TIMEOUT) as resp:
                if resp.status >= 400:
                    continue
                final = resp.geturl()
        except Exception:  # noqa: BLE001 — a dead curated link just drops out
            continue
        parts = urllib.parse.urlparse(final)
        query = "&".join(
            piece for piece in parts.query.split("&")
            if piece and not piece.lower().startswith(("utm_", "rd=", "mc_")))
        final_url = urllib.parse.urlunparse(parts._replace(query=query))
        signal = dict(signal, u=final_url, short=domain_short(final_url))
        kept.append(signal)
    return kept


# ----------------------------------------------------------------------
# The model call, and the validation that never trusts it
# ----------------------------------------------------------------------

def ask_once(client, prompt):
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        # OpenRouter serves this model from ~20 providers and SEVEN OF THEM
        # DO NOT SUPPORT structured_outputs. Routed to one of those, the
        # schema is dropped silently — no error, no warning — and the model
        # free-runs in reasoning mode until it burns the whole token budget
        # and returns empty text. That is what broke this job for two days
        # starting 2026-08-29: every run green, nothing written, the branch
        # frozen on one stale edition. require_parameters makes OpenRouter
        # route only to providers that honour what we sent. Never remove it.
        extra_body={"provider": {"require_parameters": True}},
        # GLM reasons before it answers and the reasoning spends the same
        # max_tokens budget as the answer. Left uncapped it can burn all
        # 4000 and stop with empty text — every scheduled run on 2026-09-01
        # died that way. This must be the SDK's native thinking parameter:
        # a "reasoning" key in extra_body is silently ignored on
        # OpenRouter's Anthropic-style endpoint (measured, 3996/4000
        # tokens of thinking), while thinking budget_tokens is honoured.
        thinking={"type": "enabled", "budget_tokens": REASONING_MAX_TOKENS},
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined to answer")
    if response.stop_reason == "max_tokens":
        # A truncated response is not partially usable — fail loudly rather
        # than decay into a JSON parse error.
        raise RuntimeError("response truncated at max_tokens")
    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)


def ask_model(prompt):
    """One retry, because a bad route is a coin flip and not a bad day.

    Even with require_parameters a provider occasionally loops or returns
    something unparseable. Measured, a single call lands about 4 times in 5;
    a second attempt takes the odds past 95% and costs a few cents of a model
    that is already the cheap one."""
    import anthropic

    client = anthropic.Anthropic(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=OPENROUTER_BASE_URL,
    )
    last = None
    for attempt in range(1, MODEL_ATTEMPTS + 1):
        try:
            return ask_once(client, prompt)
        except Exception as exc:  # noqa: BLE001 — retried, then reported
            last = exc
            print(f"curate_top: attempt {attempt}/{MODEL_ATTEMPTS} failed "
                  f"({exc})", file=sys.stderr)
    raise last


def validate_picks(raw, candidates):
    """Model output -> page-ready picks. Bad indices and repeats are dropped."""
    picks, seen = [], set()
    for entry in raw or []:
        index = entry.get("i") if isinstance(entry, dict) else None
        if not isinstance(index, int) or isinstance(index, bool):
            continue
        if not 0 <= index < len(candidates) or index in seen:
            continue
        seen.add(index)
        candidate = candidates[index]
        picks.append({
            "t": candidate["t"],
            "u": candidate["u"],
            "s": candidate["s"],
            "short": candidate["short"],
            "local": candidate["local"],
            "d": candidate["d"],
            "why": trim(entry.get("why", ""), WHY_MAX),
        })
        if len(picks) == PICK_COUNT:
            break
    return picks


def build_payload(picks, generated, prev=None, archive=None):
    payload = {
        "v": 1,
        "generated": generated.replace(microsecond=0).isoformat(),
        "picks": picks,
    }
    if prev:
        payload["prev"] = prev          # pulse.html still reads this
    if archive:
        payload["editions"] = archive   # All Day pages back through these
    return payload


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def give_up(reason):
    """End a run that wrote nothing, loudly if the live list has gone stale.

    A single skipped run is normal and must stay green: the branch keeps its
    last good list and the next run fixes it. What is NOT normal is the list
    staying frozen while run after run reports success — that is how this job
    served a two-day-old edition through 2026-08-29/30 without a single red
    tick, and how the Pages pipeline froze for two days back in August. If
    nothing has been written for STALE_HOURS, the job fails so it shows up.

    Returns nothing; raises SystemExit(1) when the live list is stale."""
    print(f"curate_top: {reason}", file=sys.stderr)
    try:
        live = fetch_pulse(TOP_URL, 30).get("generated")
        age = (utcnow() - datetime.fromisoformat(live)).total_seconds() / 3600
    except Exception as exc:  # noqa: BLE001 — unreadable is not stale
        print(f"curate_top: could not age the live list ({exc})", file=sys.stderr)
        return
    if age > STALE_HOURS:
        raise SystemExit(
            f"curate_top: the live TOP list is {age:.1f}h old (limit "
            f"{STALE_HOURS}h) and this run wrote nothing — failing so this "
            f"is visible instead of silently serving a stale edition.")
    print(f"curate_top: live list is {age:.1f}h old, within the "
          f"{STALE_HOURS}h limit — leaving it in place")


def run(args):
    try:
        payload = fetch_pulse()
    except Exception as exc:  # noqa: BLE001 — a fetch failure is not a crash
        return give_up(f"could not fetch pulse.json ({exc})")

    now_ts = int(utcnow().timestamp())
    candidates = build_candidates(payload, now_ts)
    if len(candidates) < PICK_COUNT:
        return give_up(f"only {len(candidates)} candidates in the last "
                       f"{WINDOW_HOURS}h")

    try:
        signals = verify_signals(fetch_signals(now_ts))
    except Exception as exc:  # noqa: BLE001 — scouts are optional
        print(f"curate_top: Top Signals unavailable ({exc})", file=sys.stderr)
        signals = []
    if signals:
        print(f"curate_top: {len(signals)} verified curated links from "
              + ", ".join(sorted({s['curated'] for s in signals})))
    candidates = candidates + signals

    try:
        answer = ask_model(build_prompt(candidates))
    except Exception as exc:  # noqa: BLE001 — reported by give_up
        return give_up(f"model call failed ({exc})")

    picks = validate_picks(answer.get("picks"), candidates)
    if not picks:
        return give_up("no usable picks came back")

    prev, archive = fetch_previous()
    write_json(args.out, build_payload(picks, utcnow(), prev, archive))
    local = sum(pick["local"] for pick in picks)
    print(f"curate_top: {len(picks)} picks ({local} local) from "
          f"{len(candidates)} candidates -> {args.out}")


# ----------------------------------------------------------------------
# Selftest — offline, with an inline fixture and no API call
# ----------------------------------------------------------------------

FIXTURE = {
    "v": 1,
    "generated": "2026-08-09T12:00:00+00:00",
    "sources": [
        {"id": "vtd", "name": "VTDigger", "short": "VTDigger", "local": 1},
        {"id": "wire", "name": "Example Wire", "short": "Wire"},
        {"id": "mail", "name": "A Newsletter", "short": "Newsletter"},
    ],
    "items": [
        {"t": "City council votes on the waterfront", "u": "https://a.com/1",
         "d": 1_000_000, "s": "vtd", "r": "https://reddit.com/r/burlington/x"},
        {"t": "National thing happens", "u": "https://b.com/2",
         "d": 999_000, "s": "wire", "hc": 42},
        {"t": "Too old to matter", "u": "https://b.com/3",
         "d": 500_000, "s": "wire"},
        {"t": "Unlinkable edition", "u": "https://inoreader.com/4",
         "d": 999_500, "s": "mail", "x": 1},
        {"t": "Orphaned item", "u": "https://c.com/5", "d": 999_400, "s": "gone"},
    ],
}


def selftest():
    now_ts = 1_000_100
    candidates = build_candidates(FIXTURE, now_ts)
    assert [c["t"] for c in candidates] == [
        "City council votes on the waterfront", "National thing happens"]
    assert candidates[0]["local"] == 1 and candidates[0]["short"] == "VTDigger"
    assert candidates[1]["local"] == 0 and candidates[1]["hn"] == 42
    assert candidates[0]["reddit"] == 1
    print("curate_top: candidates ok (window, x-flag and orphan items dropped)")

    listing = format_candidates(candidates)
    assert listing.startswith("0. LOCAL · VTDigger ·")
    assert "[hn 42 comments]" in listing and "[reddit thread]" in listing
    assert "Burlington" in build_prompt(candidates)
    print("curate_top: prompt ok (numbered, labelled, verbatim headlines)")

    # The model is stubbed: out-of-range, non-integer, and repeated indices
    # must all fall out, and `why` is clamped to the tooltip length.
    picks = validate_picks([
        {"i": 1, "why": "x" * 200},
        {"i": 99, "why": "out of range"},
        {"i": "0", "why": "not an integer"},
        {"i": 1, "why": "duplicate"},
        {"i": 0, "why": "The local story of the day."},
    ], candidates)
    assert len(picks) == 2
    assert picks[0]["u"] == "https://b.com/2" and picks[1]["local"] == 1
    assert len(picks[0]["why"]) <= WHY_MAX
    assert picks[1]["t"] == candidates[0]["t"]  # headline copied, never rewritten
    assert validate_picks(None, candidates) == []
    print("curate_top: validation ok (range, dupes, types, why length)")

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       ".selftest-pulse-top.json")
    try:
        write_json(out, build_payload(picks, utcnow()))
        with open(out, encoding="utf-8") as src:
            written = json.load(src)
        assert written["v"] == 1 and "model" not in written
        assert len(written["picks"]) == 2
        assert set(written["picks"][0]) == {
            "t", "u", "s", "short", "local", "d", "why"}
    finally:
        if os.path.exists(out):
            os.remove(out)
    print("curate_top: output ok (shape and keys)")

    import base64
    encoded = base64.urlsafe_b64encode(
        b"https://example.com/story").decode().rstrip("=")
    assert decode_redirect(
        f"https://link.morningbrew.com/click/abc123def456/{encoded}/h0")\
        == "https://example.com/story"
    assert decode_redirect("https://plain.example.com/a/b") \
        == "https://plain.example.com/a/b"
    links = extract_signal_links(
        '<a href="https://t.co/x">Read more</a>'
        '<a href="https://example.com/">Homepage-length anchor text here ok</a>'
        '<a href="https://example.com/big-story">'
        '<b>Senate passes the big infrastructure package</b></a>'
        '<a href="https://example.com/unsubscribe">'
        'Unsubscribe from this newsletter right now</a>')
    assert links == [("Senate passes the big infrastructure package",
                      "https://example.com/big-story")]
    print("curate_top: signals ok (redirect decode, junk filters)")
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    run(args)


if __name__ == "__main__":
    main()
