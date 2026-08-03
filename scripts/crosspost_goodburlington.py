#!/usr/bin/env python3
"""Crosspost genuinely good r/burlington + r/vermont posts to r/GoodBurlington.

Runs as a GitHub Action (authenticated oauth.reddit.com works from Actions
IPs even though anonymous listing JSON 403s them). Candidates pass the same
deterministic screens the Burlington Pulse uses (rough terms, accusations,
name safety), then one Claude call picks AT MOST one post per run that
clearly belongs on r/GoodBurlington — a young sub flooded by a bot reads as
spam, so the cap is the product, not a limitation. Every accept/reject and
its reason lands in data/goodburlington-crossposted.json for auditing.

Posting requires a user-context refresh token (REDDIT_REFRESH_TOKEN secret,
minted once by scripts/goodburlington_token.py). The token MUST belong to
u/whiteshirtdude1 — the script verifies via /api/v1/me and refuses to post
as anyone else. Without the token or ANTHROPIC_API_KEY it exits cleanly
without posting; it never submits an unjudged post.

CLI flags mirror the sibling scripts: --dry-run (judge, don't post),
--selftest.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refresh_chatter as chatter

ROOT = os.path.join(os.path.dirname(__file__), "..")
STATE = os.path.join(ROOT, "data", "goodburlington-crossposted.json")
UA = "btown-brief-site/1.0 (goodburlington crossposter by u/whiteshirtdude1)"
MODEL = os.environ.get("CHATTER_MODEL", "claude-sonnet-5")

EXPECTED_USER = "whiteshirtdude1"   # Stephen's account — never post as anyone else
TARGET_SUB = "GoodBurlington"
SOURCE_SUBS = ("burlington", "vermont")
MAX_PER_RUN = 1
MAX_PER_DAY = 3
MIN_SCORE = 15
MAX_AGE_HOURS = 48
REJECT_LOG_CAP = 300


def utcnow():
    return datetime.now(timezone.utc)


# ----------------------------------------------------------------------
# Reddit OAuth (user context) and API calls
# ----------------------------------------------------------------------

def user_token():
    cid = os.environ.get("REDDIT_CLIENT_ID", "").strip()
    secret = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
    refresh = os.environ.get("REDDIT_REFRESH_TOKEN", "").strip()
    if not cid or not secret or not refresh:
        return None
    import base64
    basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": refresh}).encode()
    request = urllib.request.Request("https://www.reddit.com/api/v1/access_token", data=body,
                                     headers={"User-Agent": UA, "Authorization": "Basic " + basic})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read()).get("access_token")


def api(token, path, data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    request = urllib.request.Request("https://oauth.reddit.com" + path, data=body,
                                     headers={"User-Agent": UA, "Authorization": "Bearer " + token})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def verify_account(token):
    name = (api(token, "/api/v1/me").get("name") or "").strip()
    if name.lower() != EXPECTED_USER:
        raise SystemExit(f"refusing to post: token belongs to u/{name}, not u/{EXPECTED_USER}")
    return name


# ----------------------------------------------------------------------
# Candidates and deterministic screening
# ----------------------------------------------------------------------

def listing_rows(token, sub, limit=40):
    data = api(token, f"/r/{sub}/hot.json?limit={limit}&raw_json=1")
    return [child.get("data") or {} for child in (data.get("data") or {}).get("children", [])]


def as_post(row):
    return {"id": (row.get("id") or "").lower(), "sub": row.get("subreddit") or "",
            "title": chatter.clean_space(row.get("title")), "body": chatter.clean_space(row.get("selftext")),
            "score": row.get("score") or 0, "created_utc": row.get("created_utc") or 0,
            "permalink": row.get("permalink") or "", "fullname": row.get("name") or ""}


def screen(post, state, taken_ids, now=None):
    """Return a reject reason, or None when the post may go to the judge."""
    now_ts = (now or utcnow()).timestamp()
    if not post["id"] or not post["title"] or not post["fullname"]:
        return "malformed"
    if post["id"] in state["rejected"] or any(p["id"] == post["id"] for p in state["posted"]):
        return "already-handled"
    if post["id"] in taken_ids:
        return "already-on-target"
    if post["score"] < MIN_SCORE:
        return "low-score"
    if now_ts - post["created_utc"] > MAX_AGE_HOURS * 3600:
        return "too-old"
    text = post["title"] + " " + post["body"]
    if chatter.term_hit(text, chatter.ROUGH_TERMS | chatter.ACCUSE | chatter.DEROGATORY):
        return "rough-terms"
    if chatter.safety_flag(post):
        return "name-safety"
    return None


def target_taken_ids(token):
    """IDs already on r/GoodBurlington — both native posts and the sources
    of existing crossposts — so the bot never duplicates either."""
    taken = set()
    for row in listing_rows(token, TARGET_SUB, limit=100):
        taken.add((row.get("id") or "").lower())
        for parent in row.get("crosspost_parent_list") or []:
            taken.add((parent.get("id") or "").lower())
    return taken


# ----------------------------------------------------------------------
# LLM judge — picks at most one, everything else gets a logged reason
# ----------------------------------------------------------------------

def judge(candidates):
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return None
    packet = [{"id": p["id"], "sub": p["sub"], "score": p["score"],
               "title": p["title"], "blurb": chatter.trim(p["body"], 300)} for p in candidates]
    prompt = (
        "You curate r/GoodBurlington, a small subreddit strictly for genuinely good, "
        "wholesome, uplifting Burlington/Vermont moments: acts of kindness, community wins, "
        "celebrations, gratitude, delightful photos, good news. From the candidates below, "
        "pick AT MOST ONE post that clearly belongs — when in doubt, pick none. Reject "
        "complaints, crime, politics, ads/self-promo, questions or recommendation-seeking, "
        "lost pets (found pets are fine), news that is merely neutral, and anything mean or "
        "ambiguous. Return strict JSON only: "
        '{"pick": "post-id or null", "notes": {"post-id": "reason, <=12 words"}} '
        "with a note for every candidate.\n" + json.dumps(packet, ensure_ascii=False))
    body = json.dumps({"model": MODEL, "max_tokens": 1000,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    request = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body,
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                                              "content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.loads(response.read())
    text = "".join(block.get("text", "") for block in result.get("content", [])).strip()
    value = chatter.llm_json(text)
    # The model reads untrusted reddit text — its pick must be a real candidate id.
    valid = {p["id"] for p in candidates}
    pick = value.get("pick")
    if pick is not None and pick not in valid:
        pick = None
    notes = {pid: str(reason)[:120] for pid, reason in (value.get("notes") or {}).items() if pid in valid}
    return {"pick": pick, "notes": notes}


# ----------------------------------------------------------------------
# Submitting
# ----------------------------------------------------------------------

def submit_errors(reply):
    return [e[0] for e in ((reply.get("json") or {}).get("errors") or [])]


def crosspost(token, post):
    """Crosspost, falling back to a plain link post when the source sub
    forbids crossposts. Returns the mode used."""
    reply = api(token, "/api/submit", {
        "api_type": "json", "sr": TARGET_SUB, "kind": "crosspost",
        "crosspost_fullname": post["fullname"], "title": post["title"][:300],
        "sendreplies": "false"})
    errors = submit_errors(reply)
    if not errors:
        return "crosspost"
    if any(code in ("NO_CROSSPOSTS", "INVALID_CROSSPOST_THING") for code in errors):
        reply = api(token, "/api/submit", {
            "api_type": "json", "sr": TARGET_SUB, "kind": "link",
            "url": "https://www.reddit.com" + post["permalink"],
            "title": post["title"][:300], "sendreplies": "false"})
        if not submit_errors(reply):
            return "link"
        errors = submit_errors(reply)
    raise RuntimeError(f"submit failed: {errors}")


# ----------------------------------------------------------------------
# State and main run
# ----------------------------------------------------------------------

def load_state():
    state = chatter.load_json(STATE, {})
    return {"posted": state.get("posted") or [], "rejected": state.get("rejected") or {}}


def save_state(state):
    # Keep the reject log bounded; posted history is small and stays forever
    # (it's the never-repost guarantee).
    rejected = dict(list(state["rejected"].items())[-REJECT_LOG_CAP:])
    chatter.write_json(STATE, {"posted": state["posted"], "rejected": rejected})


def posted_today(state, now=None):
    day = (now or utcnow()).date().isoformat()
    return sum(1 for p in state["posted"] if (p.get("ts") or "").startswith(day))


def run(dry_run=False):
    token = user_token()
    if not token:
        print("REDDIT_CLIENT_ID/SECRET/REFRESH_TOKEN not configured; nothing to do")
        return 0
    account = verify_account(token)

    state = load_state()
    if posted_today(state) >= MAX_PER_DAY:
        print(f"daily cap of {MAX_PER_DAY} reached; skipping")
        return 0

    taken = target_taken_ids(token)
    candidates, screened = [], 0
    for sub in SOURCE_SUBS:
        for row in listing_rows(token, sub):
            post = as_post(row)
            if row.get("stickied") or row.get("over_18") or row.get("distinguished"):
                continue
            reason = screen(post, state, taken)
            if reason == "already-handled":
                continue
            if reason:
                screened += 1
                continue
            candidates.append(post)
    print(f"{len(candidates)} candidates after screening ({screened} screened out)")
    if not candidates:
        return 0

    verdict = judge(candidates)
    if verdict is None:
        print("ANTHROPIC_API_KEY missing; refusing to post unjudged — skipping")
        return 0

    now = utcnow().isoformat(timespec="seconds")
    for post in candidates:
        if post["id"] != verdict["pick"]:
            state["rejected"][post["id"]] = verdict["notes"].get(post["id"], "judge: not picked")

    pick = next((p for p in candidates if p["id"] == verdict["pick"]), None)
    if not pick:
        print("judge picked nothing this run")
    elif dry_run:
        print(f"DRY RUN — would crosspost as u/{account}: [{pick['sub']}] {pick['title']}")
    else:
        mode = crosspost(token, pick)
        state["posted"].append({"id": pick["id"], "title": pick["title"], "sub": pick["sub"],
                                 "ts": now, "mode": mode,
                                 "why": verdict["notes"].get(pick["id"], "")})
        print(f"posted ({mode}) as u/{account}: [{pick['sub']}] {pick['title']}")

    if not dry_run:
        save_state(state)
    return 0


def selftest():
    now = utcnow()
    def post(post_id, title, body="", score=50, hours=2):
        return {"id": post_id, "sub": "burlington", "title": title, "body": body, "score": score,
                "created_utc": now.timestamp() - hours * 3600, "permalink": f"/r/burlington/comments/{post_id}/x/",
                "fullname": f"t3_{post_id}"}
    state = {"posted": [{"id": "old1", "ts": "2026-08-01T12:00:00+00:00"}], "rejected": {"old2": "x"}}

    assert screen(post("aaa", "Stranger paid for my coffee and left a kind note"), state, set(), now) is None
    assert screen(post("bbb", "Bike stolen from Church Street rack"), state, set(), now) == "rough-terms"
    assert screen(post("ccc", "Lovely sunset", score=3), state, set(), now) == "low-score"
    assert screen(post("ddd", "Old news", hours=72), state, set(), now) == "too-old"
    assert screen(post("old1", "Repeat"), state, set(), now) == "already-handled"
    assert screen(post("old2", "Repeat"), state, set(), now) == "already-handled"
    assert screen(post("eee", "Nice day"), state, {"eee"}, now) == "already-on-target"
    assert screen(post("fff", "Watch out for John Doe", "He scammed us"), state, set(), now) == "rough-terms"

    assert posted_today({"posted": [{"ts": now.isoformat()}], "rejected": {}}, now) == 1
    assert posted_today(state, now) == 0

    assert submit_errors({"json": {"errors": [["NO_CROSSPOSTS", "msg", "field"]]}}) == ["NO_CROSSPOSTS"]
    assert submit_errors({"json": {"errors": []}}) == []

    assert chatter.llm_json('```json\n{"pick": null, "notes": {}}\n```') == {"pick": None, "notes": {}}
    print("crosspost_goodburlington selftest passed")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    return selftest() if args.selftest else run(args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
