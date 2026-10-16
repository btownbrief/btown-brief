#!/usr/bin/env python3
"""Daily side-by-side report on the Reddit intake's routes.

Reads data/reddit-intake.json (scripts/reddit_intake.py) and answers, for the
last 24 hours: how many new posts each route delivered for each subreddit,
how much the routes overlap, how far each one trails the fastest, and whether
any route that was working has dropped to zero. It writes a JSON report, an
optional Markdown table, and one plain line for the secretary's morning brief:

  Reddit: green, 41 new posts in 24h (Inoreader 30, RSS 38, OAuth not set up)
  Reddit: AMBER: Inoreader dropped to zero for r/vermont (last new Oct 1); ...
  Reddit: RED: no route delivered a new post in 24h; ...

Levels:
  RED    the intake itself stopped running (6h+), or no route delivered a new
         post for a subreddit in 24h (that is the zero-route alarm; at 36h the
         intake also flips to "paused" and the pages say so).
  AMBER  a route that delivered posts in the prior 6 days delivered none in
         the last 24h, while another route still works.
  green  everything that ever worked is still working. A route that never
         worked in the window (RSS from GitHub's servers, OAuth without
         secrets) is listed, not alarmed.

CLI:
  python3 scripts/reddit_report.py [--intake PATH] [--json-out PATH] [--md-out PATH]
"""

import argparse
import json
import os
import statistics
import sys
from collections import Counter
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reddit_intake import ROUTES, iso, load_json, parse_iso, utcnow, write_json, OUT as INTAKE  # noqa: E402

HOURS = 24
STALE_INTAKE_HOURS = 6
LABEL = {"inoreader": "Inoreader", "rss": "RSS", "oauth": "OAuth"}


def fmt_day(dt):
    return f"{dt:%b} {dt.day}" if dt else "never"


def route_runs(runs, route, sub):
    statuses, last_error = Counter(), None
    for run in runs:
        entry = ((run.get("routes") or {}).get(route) or {}).get(sub)
        if not entry:
            continue
        statuses[entry.get("status")] += 1
        if entry.get("error"):
            last_error = entry["error"]
    return dict(statuses), last_error


def median_lag(posts, route, backfill_until, since):
    """Minutes this route trails whichever route saw each post first, over
    posts first seen inside the report window that two or more routes have
    seen. Posts from the store's very first run are skipped: every route
    "saw" those at the same moment."""
    lags = []
    for post in posts:
        seen = {r: parse_iso(ts) for r, ts in (post.get("seen") or {}).items()}
        seen = {r: ts for r, ts in seen.items() if ts}
        if route not in seen or len(seen) < 2:
            continue
        first = min(seen.values())
        if first < since or (backfill_until and first <= backfill_until):
            continue
        lags.append((seen[route] - first).total_seconds() / 60)
    return round(statistics.median(lags)) if lags else None


def build_report(intake, now=None, hours=HOURS):
    now = now or utcnow()
    since = now - timedelta(hours=hours)
    week = now - timedelta(days=7)
    generated = parse_iso(intake.get("generated"))
    posts = [p for p in intake.get("posts") or [] if isinstance(p, dict)]
    subs = list(intake.get("subs") or sorted({p.get("sub") for p in posts if p.get("sub")}))
    all_runs = [r for r in intake.get("runs") or [] if parse_iso(r.get("ts"))]
    runs = [r for r in all_runs if parse_iso(r["ts"]) >= since]
    backfill_until = min((parse_iso(r["ts"]) for r in all_runs), default=None)

    report_subs = {}
    for sub in subs:
        sub_posts = [p for p in posts if p.get("sub") == sub]
        made = [p for p in sub_posts if parse_iso(p.get("created")) and parse_iso(p["created"]) >= since]
        combos = Counter("+".join(p.get("routes") or []) or "none" for p in made)
        stats = {}
        for route in ROUTES:
            seen = [parse_iso((p.get("seen") or {}).get(route)) for p in sub_posts]
            seen = [ts for ts in seen if ts]
            statuses, last_error = route_runs(runs, route, sub)
            stats[route] = {
                "new_24h": sum(1 for ts in seen if ts >= since),
                "new_prior_6d": sum(1 for ts in seen if week <= ts < since),
                "last_new": iso(max(seen)) if seen else None,
                "found_of_made_24h": sum(1 for p in made if route in (p.get("routes") or [])),
                "only_route": sum(1 for p in made if (p.get("routes") or []) == [route]),
                "median_lag_minutes": median_lag(sub_posts, route, backfill_until, since),
                "runs": statuses,
                "last_error": last_error,
            }
        first_seen = [parse_iso(p.get("first_seen")) for p in sub_posts]
        report_subs[sub] = {
            "new_24h": sum(1 for ts in first_seen if ts and ts >= since),
            "made_24h": len(made),
            "overlap": dict(sorted(combos.items())),
            "routes": stats,
        }

    alarms = []
    if generated is None or now - generated > timedelta(hours=STALE_INTAKE_HOURS):
        alarms.append({"level": "red", "text": "the intake hasn't run since "
                       + (f"{fmt_day(generated)} {generated:%H:%M} UTC" if generated else "ever")
                       + " (check the refresh-reddit workflow)"})
    for sub, data in report_subs.items():
        if data["new_24h"] == 0:
            alarms.append({"level": "red", "sub": sub,
                           "text": f"no route delivered a new {sub} post in {hours}h"})
            continue
        for route, stat in data["routes"].items():
            if stat["new_24h"] == 0 and stat["new_prior_6d"] > 0:
                alarms.append({"level": "amber", "sub": sub, "route": route,
                               "text": f"{LABEL[route]} dropped to zero for {sub} "
                                       f"(last new {fmt_day(parse_iso(stat['last_new']))})"})
    state = intake.get("state") or {}
    if state.get("paused"):
        alarms.insert(0, {"level": "red", "text": "Reddit is paused on the site "
                          f"(no new post from any route since {fmt_day(parse_iso(state.get('since')))})"})

    report = {"v": 1, "generated": iso(now), "window_hours": hours,
              "intake_generated": iso(generated), "intake_state": state,
              "subs": report_subs, "routes": route_summary(report_subs, runs),
              "alarms": alarms}
    report["level"] = ("red" if any(a["level"] == "red" for a in alarms) else
                       "amber" if alarms else "green")
    report["brief_line"] = brief_line(report)
    return report


def route_summary(report_subs, runs):
    """One status per route across subs: live / zero / error / skipped."""
    out = {}
    for route in ROUTES:
        new = sum(data["routes"][route]["new_24h"] for data in report_subs.values())
        statuses = Counter()
        errors = []
        for data in report_subs.values():
            statuses.update(data["routes"][route]["runs"])
            if data["routes"][route]["last_error"]:
                errors.append(data["routes"][route]["last_error"])
        if new:
            status = "live"
        elif statuses and set(statuses) <= {"skipped"}:
            status = "skipped"
        elif statuses and set(statuses) <= {"error", "skipped"}:
            status = "error"
        elif statuses:
            status = "zero"
        else:
            status = "no runs"
        out[route] = {"status": status, "new_24h": new, "error": errors[-1] if errors else None}
    return out


def route_phrase(route, summary):
    label = LABEL[route]
    status = summary["status"]
    if status == "live":
        return f"{label} {summary['new_24h']}"
    if status == "skipped":
        return f"{label} not set up"
    if status == "error":
        return f"{label} blocked ({summary['error']})" if summary.get("error") else f"{label} failing"
    if status == "zero":
        return f"{label} 0"
    return f"{label} no runs"


def brief_line(report):
    """One line, same shape as the brief's "Machine:" line."""
    total = sum(data["new_24h"] for data in report["subs"].values())
    routes = ", ".join(route_phrase(r, report["routes"][r]) for r in ROUTES)
    hours = report["window_hours"]
    if report["level"] == "green":
        return f"Reddit: green, {total} new posts in {hours}h ({routes})"
    texts = [a["text"] for a in report["alarms"] if a["level"] == report["level"]]
    head = "; ".join(texts[:2]) + (f"; and {len(texts) - 2} more" if len(texts) > 2 else "")
    return f"Reddit: {report['level'].upper()}: {head} ({total} new posts in {hours}h: {routes})"


def markdown(report):
    lines = [f"# Reddit intake report, {report['generated']}", "",
             f"**{report['brief_line']}**", "",
             f"Window: last {report['window_hours']} hours. Intake last ran {report['intake_generated']}.", ""]
    if report["alarms"]:
        lines.append("## Alarms")
        lines.extend(f"- {a['level'].upper()}: {a['text']}" for a in report["alarms"])
        lines.append("")
    for sub, data in report["subs"].items():
        lines += [f"## {sub}", "",
                  f"{data['new_24h']} posts new to the intake; {data['made_24h']} posts made in the window.", "",
                  "| Route | New in window | Prior 6 days | Of posts made in window | Only this route | "
                  "Median lag (min) | Runs | Last error |",
                  "|---|---|---|---|---|---|---|---|"]
        for route, stat in data["routes"].items():
            runs = ", ".join(f"{k} {v}" for k, v in sorted(stat["runs"].items())) or "none"
            lag = "" if stat["median_lag_minutes"] is None else str(stat["median_lag_minutes"])
            lines.append(f"| {LABEL[route]} | {stat['new_24h']} | {stat['new_prior_6d']} | "
                         f"{stat['found_of_made_24h']} | {stat['only_route']} | {lag} | {runs} | "
                         f"{stat['last_error'] or ''} |")
        if data["overlap"]:
            lines += ["", "Which routes saw the posts made in the window: "
                      + ", ".join(f"{combo} {n}" for combo, n in data["overlap"].items())]
        lines.append("")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--intake", default=INTAKE)
    parser.add_argument("--json-out")
    parser.add_argument("--md-out")
    parser.add_argument("--hours", type=int, default=HOURS)
    args = parser.parse_args(argv)
    intake = load_json(args.intake, None)
    if not isinstance(intake, dict):
        print(f"Reddit: RED: couldn't read the intake file {args.intake}")
        return 1
    report = build_report(intake, hours=args.hours)
    if args.json_out:
        write_json(args.json_out, report)
    if args.md_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.md_out)), exist_ok=True)
        with open(args.md_out, "w", encoding="utf-8") as dst:
            dst.write(markdown(report) + "\n")
    print(report["brief_line"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
