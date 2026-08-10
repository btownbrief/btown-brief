#!/usr/bin/env python3
"""Burlington Pulse — the TOP tab: fifteen headlines an editor would keep.

data/pulse.json is the whole firehose (~90 sources, thousands of headlines).
The TOP tab is the opposite: one short list a reader with ten minutes can
finish. A model reads the last 24 hours of candidates and picks 15 stories —
roughly five local, ten national — and writes a one-line reason for each.

Two rules hold the thing honest:

  * Headlines are used VERBATIM. The model picks indices out of a numbered
    list and never writes a headline, so nothing on the page is invented.
  * Every pick maps back to a real item in pulse.json, so the URL, source
    and timestamp on the page are the ones the publisher gave us.

Failure posture: any API trouble logs and exits 0 without writing, so the
workflow stays green and the branch keeps its last good list.

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

MODEL = "claude-sonnet-5"
WINDOW_HOURS = 24
MAX_CANDIDATES = 400
PICK_COUNT = 15
WHY_MAX = 90

SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "i": {"type": "integer"},
                    "why": {"type": "string"},
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

From the numbered list below, pick EXACTLY 15 headlines that a smart reader \
with ten minutes should read right now. Aim for roughly 5 LOCAL and 10 \
NATIONAL picks — take fewer local ones only if the local list is genuinely \
thin today.

How to choose:
  * Consequence. What actually matters to someone's week, money, safety,
    government, or understanding of the world.
  * Breadth of subject. No two picks about the same story — when several
    outlets cover one event, choose the single best one and move on.
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
        if candidate["reddit"]:
            chatter += " [reddit thread]"
        if candidate["hn"]:
            chatter += f" [hn {candidate['hn']} comments]"
        lines.append(
            f"{index}. {'LOCAL' if candidate['local'] else 'NATIONAL'} · "
            f"{candidate['short']} · {candidate['age']:.0f}h ago · "
            f"{candidate['t']}{chatter}")
    return "\n".join(lines)


def build_prompt(candidates):
    return PROMPT_HEAD + format_candidates(candidates)


# ----------------------------------------------------------------------
# The model call, and the validation that never trusts it
# ----------------------------------------------------------------------

def ask_model(prompt):
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined to answer")
    if response.stop_reason == "max_tokens":
        # adaptive thinking shares the budget with the answer — a truncated
        # response must fail loudly, not decay into a JSON parse error
        raise RuntimeError("response truncated at max_tokens")
    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)


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


def build_payload(picks, generated):
    return {
        "v": 1,
        "generated": generated.replace(microsecond=0).isoformat(),
        "model": MODEL,
        "picks": picks,
    }


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def run(args):
    try:
        payload = fetch_pulse()
    except Exception as exc:  # noqa: BLE001 — a fetch failure is not a crash
        print(f"curate_top: could not fetch pulse.json ({exc})", file=sys.stderr)
        return

    candidates = build_candidates(payload, int(utcnow().timestamp()))
    if len(candidates) < PICK_COUNT:
        print(f"curate_top: only {len(candidates)} candidates in the last "
              f"{WINDOW_HOURS}h — leaving the last list in place")
        return

    try:
        answer = ask_model(build_prompt(candidates))
    except Exception as exc:  # noqa: BLE001 — the workflow must stay green
        print(f"curate_top: model call failed ({exc})", file=sys.stderr)
        return

    picks = validate_picks(answer.get("picks"), candidates)
    if not picks:
        print("curate_top: no usable picks came back", file=sys.stderr)
        return

    write_json(args.out, build_payload(picks, utcnow()))
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
        assert written["v"] == 1 and written["model"] == MODEL
        assert len(written["picks"]) == 2
        assert set(written["picks"][0]) == {
            "t", "u", "s", "short", "local", "d", "why"}
    finally:
        if os.path.exists(out):
            os.remove(out)
    print("curate_top: output ok (shape and keys)")
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
