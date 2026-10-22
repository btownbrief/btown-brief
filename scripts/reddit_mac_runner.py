#!/usr/bin/env python3
"""Read Reddit from Stephen's Mac, logged out, for the jobs GitHub can't run.

Reddit blocks GitHub's runners, Reddit RSS ends 2026-11-13 and the Data API is
closing early, but logged-out reddit.com still answers a home connection. So
every 30 minutes (scripts/reddit_mac_runner.sh, a launchd job) this reads the
subreddit listings the site needs through reddit_client.py's shreddit route
and writes three files for the reddit-data branch:

  data/reddit-intake.json    the shared intake (scripts/reddit_intake.py),
                             now with the Pulse's national subreddits too
  data/reddit-report.json/.md the daily route comparison (reddit_report.py)
  data/reddit-listings.json  the "mirror": each listing below in Reddit's
                             own listing shape, which reddit_client.py's
                             mirror route hands to GitHub's jobs (On Air's
                             r/nba + r/nfl, Changes' r/burlington, the
                             r/GoodBurlington strip and queue)

Rules it keeps (Stephen, 2026-10-22):
  * logged out only: no account, no cookies, no keys
  * titles, links, times, scores, comment counts and flair only; removed
    and deleted posts dropped
  * polite: each listing has its own interval, so a run asks for 2 to 15
    pages (about 14 an hour), at least 4 seconds apart; a 403 or 429 stops
    the run's Reddit reads and backs off across runs (30 min, doubling)
  * never wipes: a listing that fails keeps its last good copy, and when
    not one Reddit read worked the run writes nothing at all (exit 3), so
    the branch keeps the last good files and GitHub's own run takes over

Exit codes: 0 wrote fresh files, 3 nothing fetched (nothing written), 1 bug.

  python3 scripts/reddit_mac_runner.py --prev DIR --out DIR [--state FILE]
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reddit_client  # noqa: E402
import reddit_intake  # noqa: E402
import reddit_report  # noqa: E402

# (path, params, every N minutes). Local new posts every run; the rest less
# often. About 14 requests an hour in all.
TARGETS = [
    ("r/burlington/new", {}, 30),       # intake: Wire, Food, newsletter
    ("r/vermont/new", {}, 30),          # intake
    ("r/burlington/hot", {}, 60),       # Changes' chatter, GoodBurlington queue
    ("r/vermont/hot", {}, 60),          # GoodBurlington queue
    ("r/GoodBurlington/hot", {}, 60),   # the community strip (data/reddit.json)
    ("r/GoodBurlington/new", {}, 60),   # queue's "already posted?" check
    ("r/nba/top", {"t": "day"}, 60),    # On Air sports
    ("r/nfl/top", {"t": "day"}, 60),    # On Air sports
] + [(f"{sub}/hot", {}, 120) for sub in reddit_intake.NATIONAL_SUBS]  # Pulse "Unfiltered"

INTAKE_SUBS = reddit_intake.LOCAL_SUBS + reddit_intake.NATIONAL_SUBS
SLACK = timedelta(minutes=3)   # launchd fires a little early or late
LISTINGS_FILE = "reddit-listings.json"


def utcnow():
    return datetime.now(timezone.utc)


def load(path, default):
    try:
        with open(path, encoding="utf-8") as src:
            value = json.load(src)
        return value if isinstance(value, type(default)) else default
    except (OSError, ValueError):
        return default


def due(entry, every, now):
    when = reddit_intake.parse_iso((entry or {}).get("fetched"))
    return when is None or now - when >= timedelta(minutes=every) - SLACK


def fetch_listings(client, previous, now, targets=TARGETS, force=False):
    """-> (listings doc, {key: listing fetched THIS run}, receipt lines).
    A failed or skipped listing keeps its previous entry untouched."""
    old = previous.get("listings") if isinstance(previous.get("listings"), dict) else {}
    listings = {key: entry for key, entry in old.items() if isinstance(entry, dict)}
    fresh, lines = {}, []
    for path, params, every in targets:
        key = reddit_client.listing_key(path, **params)
        if not force and not due(listings.get(key), every, now):
            continue
        try:
            data = client.shreddit_json(path, **params)
        except reddit_client.RedditError as exc:
            lines.append(f"{key}: FAILED ({exc})")
            if key in listings:
                listings[key]["last_error"] = str(exc)[:160]
            continue
        children = (data.get("data") or {}).get("children") or []
        listings[key] = {"fetched": reddit_intake.iso(now), "route": "shreddit",
                         "count": len(children), "data": data}
        fresh[key] = data
        lines.append(f"{key}: {len(children)} posts")
    # A listing nobody has refreshed in two days is dropped, not served.
    for key in [k for k, e in listings.items()
                if (reddit_intake.parse_iso(e.get("fetched")) or now) < now - timedelta(days=2)]:
        del listings[key]
    doc = {"v": 1, "generated": reddit_intake.iso(now), "by": "mac",
           "note": "Logged-out reddit.com listings read from Stephen's Mac "
                   "(scripts/reddit_mac_runner.py). Titles, links, times, scores, "
                   "comment counts and flair only.",
           "listings": dict(sorted(listings.items()))}
    return doc, fresh, lines


def intake_listings(fresh):
    """{key: listing} -> {sub: listing} for the intake's shreddit route."""
    out = {}
    for sub in INTAKE_SUBS:
        key = reddit_client.listing_key(f"{sub}/{reddit_intake.sub_sort(sub)}")
        if key in fresh:
            out[sub] = fresh[key]
    return out


def run(prev_dir, out_dir, state=None, env=None, now=None, fetch=None, sleep=None, force=False):
    """Returns (exit code, summary text)."""
    env = dict(os.environ if env is None else env)
    now = now or utcnow()
    kwargs = {"env": env, "state_path": state}
    if fetch:
        kwargs["fetch"] = fetch
    if sleep:
        kwargs["sleep"] = sleep
    client = reddit_client.Client(**kwargs)
    prev_data = os.path.join(prev_dir, "data")
    previous_listings = load(os.path.join(prev_data, LISTINGS_FILE), {})
    previous_intake = load(os.path.join(prev_data, "reddit-intake.json"), {})

    doc, fresh, lines = fetch_listings(client, previous_listings, now, force=force)
    if not fresh:
        return 3, "no Reddit listing could be read this run; nothing written\n" + "\n".join(lines)

    today = now.date()
    use_rss = today < reddit_client.RSS_END and client.cooldown("rss") == 0
    routes = ("inoreader",) + (("rss",) if use_rss else ()) + ("shreddit",)
    # Inoreader (not Reddit) is read with the intake's own plain fetch.
    intake = reddit_intake.refresh(previous_intake, fetch=fetch or reddit_intake.http_fetch,
                                   env=env, subs=INTAKE_SUBS,
                                   routes=routes, now=now, client=client,
                                   shreddit_listings=intake_listings(fresh), by="mac")
    if use_rss:
        rss_ok = any(entry["status"] == "ok" for entry in intake["routes"].get("rss", {}).values())
        client.note_rss_run(rss_ok)

    # Never ship a smaller store than we started with because of a bug.
    if previous_intake.get("posts") and not intake.get("posts"):
        return 1, "intake came out empty while the previous one had posts; refusing to write"

    out_data = os.path.join(out_dir, "data")
    os.makedirs(out_data, exist_ok=True)
    reddit_intake.write_json(os.path.join(out_data, "reddit-intake.json"), intake)
    reddit_intake.write_json(os.path.join(out_data, LISTINGS_FILE), doc)
    report = reddit_report.build_report(intake, now=now)
    reddit_intake.write_json(os.path.join(out_data, "reddit-report.json"), report)
    with open(os.path.join(out_data, "reddit-report.md"), "w", encoding="utf-8") as dst:
        dst.write(reddit_report.markdown(report) + "\n")

    counts = {}
    for post in intake["posts"]:
        counts[post["sub"]] = counts.get(post["sub"], 0) + 1
    summary = [f"fetched {len(fresh)} listing(s): " + "; ".join(lines),
               "intake posts per sub: " + ", ".join(f"{s} {counts.get(s, 0)}" for s in INTAKE_SUBS),
               reddit_intake.summary(intake), report["brief_line"]]
    return 0, "\n".join(summary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--prev", required=True, help="dir holding the branch's current data/ files")
    parser.add_argument("--out", required=True, help="dir to write the new data/ files into")
    parser.add_argument("--state", help="back-off state file (cooldowns, RSS failure streak)")
    parser.add_argument("--force", action="store_true", help="fetch every listing, due or not")
    args = parser.parse_args(argv)
    code, text = run(args.prev, args.out, state=args.state, force=args.force)
    print(text)
    return code


if __name__ == "__main__":
    sys.exit(main())
