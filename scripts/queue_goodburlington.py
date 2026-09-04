#!/usr/bin/env python3
"""Curate a tap-to-post crosspost queue for r/GoodBurlington.

Stephen posts everything himself — this script never touches his Reddit
account and needs no Reddit app or token (he declined the API route). It
reads r/burlington + r/vermont the same way the Pulse does (public listing
JSON when reachable, Inoreader RSS as fallback), screens candidates with
the Pulse's deterministic filters, asks Claude which ones genuinely belong
on r/GoodBurlington, and writes the survivors to
data/goodburlington-queue.json. goodburlington-queue.html renders that as
one-tap prefilled reddit submit links; a daily launchd job on Stephen's
Mac opens the page when the queue is non-empty
(infrastructure/com.btownbrief.goodburlington-queue.plist).

Queue hygiene is self-healing: an item disappears once it shows up on
r/GoodBurlington (he posted it), ages past 48h (he passed), or the judge
rejected it (logged with a reason in data/goodburlington-curated.json so
his taste audits stay possible). Without OPENROUTER_API_KEY the last good
queue is left untouched — nothing unjudged is ever queued.

"Already on r/GoodBurlington" has to work without Reddit: since Sept 2026
Reddit 403s every listing from Actions, so the check reads the sub's
Inoreader stream — each crosspost's description links back to the source
post — plus data/reddit.json, and matches on normalised title as a last
resort (the submit link pre-fills the source title verbatim). The queue
is capped per source sub so r/vermont can never crowd out r/burlington,
the one Stephen actually cares about; every item carries queued_at so
the page can shelve repeats in their own section.

CLI flags mirror the sibling scripts: --dry-run, --selftest.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import re
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refresh_chatter as chatter

ROOT = os.path.join(os.path.dirname(__file__), "..")
QUEUE = os.path.join(ROOT, "data", "goodburlington-queue.json")
STATE = os.path.join(ROOT, "data", "goodburlington-curated.json")
REDDIT_JSON = os.path.join(ROOT, "data", "reddit.json")
UA = "btown-brief-site/1.0 (goodburlington queue)"
MODEL = os.environ.get("CHATTER_MODEL", "openai/gpt-5.6-luna")

TARGET_SUB = "GoodBurlington"
SOURCE_SUBS = ("burlington", "vermont")
MIN_SCORE = 15          # only enforced when a real score is known (Inoreader has none)
MAX_AGE_HOURS = 48
QUEUE_CAP_PER_SUB = 6   # per source sub, so r/vermont never crowds out r/burlington
REJECT_LOG_CAP = 400
TARGET_INOREADER = ("https://www.inoreader.com/stream/user/1003590800/tag/"
                    "Reddit%20%28r%2FGoodBurlington%29?n=100")


def utcnow():
    return datetime.now(timezone.utc)


def fetch(url, accept):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


# ----------------------------------------------------------------------
# Candidates — public listing JSON first, Inoreader RSS fallback
# ----------------------------------------------------------------------

def parse_listing(raw, sub):
    posts = []
    for child in (json.loads(raw).get("data") or {}).get("children", []):
        row = child.get("data") or {}
        if row.get("stickied") or row.get("over_18") or row.get("distinguished"):
            continue
        post_id = (row.get("id") or "").lower()
        title = chatter.clean_space(row.get("title"))
        if not post_id or not title:
            continue
        posts.append({"id": post_id, "sub": f"r/{sub}", "title": title,
                      "body": chatter.clean_space(row.get("selftext")),
                      "score": row.get("score"), "created_utc": row.get("created_utc") or 0,
                      "permalink": "https://www.reddit.com" + (row.get("permalink") or "")})
    return posts


def parse_inoreader(raw, sub):
    posts = []
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime
    for item in ET.fromstring(raw).findall(".//item")[:100]:
        link = chatter.reddit_url(item.findtext("link"))
        post_id = chatter.reddit_id(link)
        title = chatter.clean_space(item.findtext("title"))
        if not post_id or not title:
            continue
        created = 0
        try:
            created = parsedate_to_datetime(item.findtext("pubDate")).timestamp()
        except Exception:
            pass
        posts.append({"id": post_id, "sub": sub, "title": title,
                      "body": chatter.strip_html(item.findtext("description")),
                      "score": None, "created_utc": created, "permalink": link})
    return posts


def load_candidates():
    merged = {}
    for sub in SOURCE_SUBS:
        for host in ("www.reddit.com", "old.reddit.com", "api.reddit.com"):
            try:
                raw = fetch(f"https://{host}/r/{sub}/hot.json?limit=40&raw_json=1", "application/json")
                for post in parse_listing(raw, sub):
                    merged.setdefault(post["id"], post)
                break
            except Exception as exc:
                print(f"reddit {host} {sub} failed: {exc}", file=sys.stderr)
    for sub, url in chatter.INOREADER.items():
        try:
            raw = fetch(url, "application/rss+xml, application/xml")
            for post in parse_inoreader(raw, sub):
                merged.setdefault(post["id"], post)
        except Exception as exc:
            print(f"inoreader {sub} failed: {exc}", file=sys.stderr)
    return list(merged.values())


def title_key(title):
    """Normalised title for the last-resort duplicate check: lowercase,
    punctuation stripped, whitespace collapsed."""
    return " ".join(re.findall(r"[a-z0-9]+", (title or "").lower()))


def parse_target_listing(raw):
    ids, titles = set(), set()
    for child in (json.loads(raw).get("data") or {}).get("children", []):
        row = child.get("data") or {}
        ids.add((row.get("id") or "").lower())
        for parent in row.get("crosspost_parent_list") or []:
            ids.add((parent.get("id") or "").lower())
        if row.get("url"):
            ids.add(chatter.reddit_id(row["url"]) or "")
        titles.add(title_key(row.get("title")))
    return ids - {""}, titles - {""}


def parse_target_inoreader(raw):
    """Every reddit id linked from a r/GoodBurlington feed item: the post
    itself plus, for link posts and crossposts, the source post in the
    description body."""
    import xml.etree.ElementTree as ET
    ids, titles = set(), set()
    for item in ET.fromstring(raw).findall(".//item"):
        ids.add(chatter.reddit_id(item.findtext("link")) or "")
        for href in re.findall(r'href="([^"]+)"', item.findtext("description") or ""):
            ids.add(chatter.reddit_id(href) or "")
        titles.add(title_key(item.findtext("title")))
    return ids - {""}, titles - {""}


def target_taken():
    """(ids, title keys) already on r/GoodBurlington — native posts and the
    sources of existing crossposts — so the queue never offers a duplicate.
    Reddit's own listing is tried first (blocked from Actions since Sept
    2026), then the sub's Inoreader stream, always merged with the site's
    data/reddit.json so a dead feed never empties the check."""
    ids, titles = set(), set()
    for host in ("www.reddit.com", "old.reddit.com", "api.reddit.com"):
        try:
            raw = fetch(f"https://{host}/r/{TARGET_SUB}/new.json?limit=100&raw_json=1", "application/json")
            got_ids, got_titles = parse_target_listing(raw)
            ids |= got_ids
            titles |= got_titles
            break
        except Exception as exc:
            print(f"reddit {host} {TARGET_SUB} failed: {exc}", file=sys.stderr)
    try:
        got_ids, got_titles = parse_target_inoreader(fetch(TARGET_INOREADER, "application/rss+xml, application/xml"))
        ids |= got_ids
        titles |= got_titles
    except Exception as exc:
        print(f"inoreader {TARGET_SUB} failed: {exc}", file=sys.stderr)
    for post in chatter.load_json(REDDIT_JSON, {}).get("posts", []):
        ids.add(chatter.reddit_id(post.get("url")) or "")
        titles.add(title_key(post.get("title")))
    ids.discard("")
    titles.discard("")
    return ids, titles


def is_taken(post, taken):
    ids, titles = taken
    return post["id"] in ids or title_key(post["title"]) in titles


# ----------------------------------------------------------------------
# Screening and the LLM judge
# ----------------------------------------------------------------------

def screen(post, rejected, taken, now=None):
    """Return a reject reason, or None when the post may go to the judge."""
    now_ts = (now or utcnow()).timestamp()
    if post["id"] in rejected:
        return "already-judged"
    if is_taken(post, taken):
        return "already-on-target"
    if post["score"] is not None and post["score"] < MIN_SCORE:
        return "low-score"
    if now_ts - post["created_utc"] > MAX_AGE_HOURS * 3600:
        return "too-old"
    if chatter.term_hit(post["title"] + " " + post["body"],
                        chatter.ROUGH_TERMS | chatter.ACCUSE | chatter.DEROGATORY):
        return "rough-terms"
    if chatter.safety_flag(post):
        return "name-safety"
    return None


JUDGE_CHUNK = 20   # 60 first-run candidates truncated one big reply mid-JSON


def judge(candidates):
    key = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if not key:
        return None
    verdicts = {}
    for start in range(0, len(candidates), JUDGE_CHUNK):
        verdicts.update(judge_chunk(candidates[start:start + JUDGE_CHUNK], key))
    return verdicts


def judge_chunk(candidates, key):
    packet = [{"id": p["id"], "sub": p["sub"], "score": p["score"],
               "title": p["title"], "blurb": chatter.trim(p["body"], 300)} for p in candidates]
    prompt = (
        "You curate r/GoodBurlington, a small subreddit strictly for genuinely good, "
        "wholesome, uplifting Burlington/Vermont moments: acts of kindness, community wins, "
        "celebrations, gratitude, delightful photos, good news. For each candidate below, "
        "decide whether it clearly belongs — when in doubt, it does not. Reject complaints, "
        "crime, politics, ads/self-promo, questions or recommendation-seeking, lost pets "
        "(found pets are fine), news that is merely neutral, and anything mean or ambiguous. "
        'Return strict JSON only: {"verdicts": {"post-id": {"ok": true/false, "why": "<=12 words"}}} '
        "with a verdict for every candidate.\n" + json.dumps(packet, ensure_ascii=False))
    # reasoning capped: GLM cannot disable it and it shares the max_tokens budget
    body = json.dumps({"model": MODEL, "max_tokens": 6000,
                       "reasoning": {"max_tokens": 1024},
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    request = urllib.request.Request("https://openrouter.ai/api/v1/messages", data=body,
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                                              "content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.loads(response.read())
    text = "".join(block.get("text", "") for block in result.get("content", [])).strip()
    value = chatter.llm_json(text)
    # The model reads untrusted reddit text — only verdicts for real candidate
    # ids count, and a missing verdict means "not queued", never "queued".
    valid = {p["id"] for p in candidates}
    return {pid: {"ok": bool((v or {}).get("ok")), "why": str((v or {}).get("why"))[:120]}
            for pid, v in (value.get("verdicts") or {}).items()
            if pid in valid and isinstance(v, dict)}


def submit_url(post):
    return ("https://www.reddit.com/r/" + TARGET_SUB + "/submit?" +
            urllib.parse.urlencode({"url": post["permalink"], "title": post["title"][:300]}))


def queue_item(post, why, now=None):
    return {"id": post["id"], "sub": post["sub"], "title": post["title"],
            "score": post["score"], "created_utc": post["created_utc"],
            "queued_at": (now or utcnow()).isoformat(timespec="seconds"),
            "url": post["permalink"], "submit_url": submit_url(post), "why": why}


def cap_per_sub(items):
    """Newest first within each source sub, at most QUEUE_CAP_PER_SUB each;
    r/burlington (the sub Stephen cares about) is listed before r/vermont."""
    order = {f"r/{sub}": rank for rank, sub in enumerate(SOURCE_SUBS)}
    out = []
    for sub in sorted({item["sub"] for item in items}, key=lambda s: order.get(s, 99)):
        mine = sorted((i for i in items if i["sub"] == sub),
                      key=lambda i: i["created_utc"], reverse=True)
        out.extend(mine[:QUEUE_CAP_PER_SUB])
    return out


# ----------------------------------------------------------------------
# Main run
# ----------------------------------------------------------------------

def run(dry_run=False):
    state = chatter.load_json(STATE, {})
    rejected = state.get("rejected") or {}
    previous = chatter.load_json(QUEUE, {})
    old_queue = previous.get("items") or []

    taken = target_taken()
    now_ts = utcnow().timestamp()
    # Items he hasn't posted yet stay queued until they age out or appear on
    # the sub — no re-judging needed, a past yes stays a yes.
    keep = [item for item in old_queue
            if not is_taken(item, taken) and now_ts - item["created_utc"] <= MAX_AGE_HOURS * 3600]
    for item in keep:   # items queued before queued_at existed
        item.setdefault("queued_at", previous.get("updated"))
    kept_ids = {item["id"] for item in keep}

    candidates, screened = [], 0
    for post in load_candidates():
        if post["id"] in kept_ids:
            continue
        reason = screen(post, rejected, taken)
        if reason == "already-judged":
            continue
        if reason:
            screened += 1
            continue
        candidates.append(post)
    print(f"{len(candidates)} new candidates ({screened} screened out, {len(keep)} carried over)")

    fresh = []
    if candidates:
        verdicts = judge(candidates)
        if verdicts is None:
            print("OPENROUTER_API_KEY missing; keeping last good queue untouched")
            return 0
        for post in candidates:
            v = verdicts.get(post["id"])
            if v and v["ok"]:
                fresh.append(queue_item(post, v["why"]))
            elif v:
                rejected[post["id"]] = v["why"] or "judge: no"

    items = cap_per_sub(keep + fresh)
    output = {"updated": utcnow().isoformat(timespec="seconds"), "items": items}

    if dry_run:
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    chatter.write_json(QUEUE, output)
    chatter.write_json(STATE, {"rejected": dict(list(rejected.items())[-REJECT_LOG_CAP:])})
    print(f"queue: {len(items)} items ({len(fresh)} new)")
    return 0


def selftest():
    now = utcnow()
    def post(post_id, title, body="", score=50, hours=2):
        return {"id": post_id, "sub": "r/burlington", "title": title, "body": body, "score": score,
                "created_utc": now.timestamp() - hours * 3600,
                "permalink": f"https://www.reddit.com/r/burlington/comments/{post_id}/x/"}

    nobody = (set(), set())
    assert screen(post("aaa", "Stranger paid for my coffee and left a kind note"), {}, nobody, now) is None
    assert screen(post("bbb", "Bike stolen from Church Street rack"), {}, nobody, now) == "rough-terms"
    assert screen(post("ccc", "Lovely sunset", score=3), {}, nobody, now) == "low-score"
    assert screen(post("ino", "Lovely sunset", score=None), {}, nobody, now) is None
    assert screen(post("ddd", "Old news", hours=72), {}, nobody, now) == "too-old"
    assert screen(post("eee", "Repeat"), {"eee": "x"}, nobody, now) == "already-judged"
    assert screen(post("fff", "Nice day"), {}, ({"fff"}, set()), now) == "already-on-target"
    # Title match catches a crosspost whose source id the feed never told us
    assert screen(post("ggg", "Been living here for one year now. Thank you all! ❤️"), {},
                  (set(), {title_key("been living here for one year now, thank you all")}), now) == "already-on-target"

    # Inoreader r/GoodBurlington item: the description links back to the source post
    feed = ('<rss><channel><item><title>Free creemees on Church St</title>'
            '<link>https://www.reddit.com/r/GoodBurlington/comments/gb1/free_creemees/</link>'
            '<description>&lt;a href="https://www.reddit.com/user/whiteshirtdude1"&gt;u&lt;/a&gt; '
            '&lt;a href="https://www.reddit.com/r/burlington/comments/src1/free_creemees/"&gt;[link]&lt;/a&gt;'
            '</description></item></channel></rss>')
    ids, titles = parse_target_inoreader(feed)
    assert ids == {"gb1", "src1"}, ids
    assert titles == {"free creemees on church st"}, titles
    listing_ids, _ = parse_target_listing(json.dumps({"data": {"children": [
        {"data": {"id": "GB2", "title": "x", "url": "https://www.reddit.com/r/vermont/comments/src2/x/",
                  "crosspost_parent_list": [{"id": "SRC3"}]}}]}}))
    assert listing_ids == {"gb2", "src2", "src3"}, listing_ids

    # Per-sub cap: r/burlington first, newest first, r/vermont can't crowd it out
    def vt(post_id, hours):
        item = post(post_id, "t", hours=hours)
        item["sub"] = "r/vermont"
        return item
    mixed = ([queue_item(vt(f"v{n}", n), "ok", now) for n in range(10)] +
             [queue_item(post(f"b{n}", "t", hours=n + 20), "ok", now) for n in range(2)])
    capped = cap_per_sub(mixed)
    assert [i["id"] for i in capped] == ["b0", "b1", "v0", "v1", "v2", "v3", "v4", "v5"], [i["id"] for i in capped]
    assert capped[0]["queued_at"] == now.isoformat(timespec="seconds")

    listing = json.dumps({"data": {"children": [
        {"data": {"id": "GG1", "title": "Free creemees on Church St", "selftext": "so good",
                  "score": 80, "created_utc": 1750000000, "stickied": False,
                  "permalink": "/r/burlington/comments/gg1/free_creemees/"}},
        {"data": {"id": "gg2", "title": "Sticky", "stickied": True,
                  "permalink": "/r/burlington/comments/gg2/x/"}},
    ]}})
    parsed = parse_listing(listing, "burlington")
    assert len(parsed) == 1 and parsed[0]["id"] == "gg1" and parsed[0]["sub"] == "r/burlington"

    item = queue_item(post("hhh", 'Dog "mayor" of the bike path'), "pure joy")
    assert item["submit_url"].startswith("https://www.reddit.com/r/GoodBurlington/submit?")
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(item["submit_url"]).query)
    assert query["title"] == ['Dog "mayor" of the bike path']
    assert query["url"] == [item["url"]]

    assert chatter.llm_json('```json\n{"verdicts": {}}\n```') == {"verdicts": {}}
    print("queue_goodburlington selftest passed")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    return selftest() if args.selftest else run(args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
