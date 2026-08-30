#!/usr/bin/env python3
"""Editor's Desk — the weekly "what needs a human" page.

Builds desk.html (local-only, gitignored) from live signals and opens it:

  1. Broken & stale — scheduled GitHub workflows across every local
     btownbrief checkout (found by scanning .github/workflows for cron
     blocks, so new repos join automatically) whose latest run failed,
     went quiet past its cadence, or wedged in "queued"; launchd jobs
     with a nonzero exit; plus the hand-kept watchlist in desk-state.json.
  2. Waiting on you — open PRs org-wide plus job-radar, and the pending
     human steps listed in desk-state.json.
  3. Rhythms — recurring chores with due dates. last_done comes from a
     file stamp where one exists (best-of sweep reads bestof-2026.json);
     otherwise from desk-state.json, stamped via --done.

Run:    python3 scripts/editors_desk.py            build + open
        python3 scripts/editors_desk.py --no-open  build only
        python3 scripts/editors_desk.py --done SLUG   stamp a rhythm done
                                                      (or resolve a watchlist
                                                      /waiting item) + rebuild

A launchd job (com.btownbrief.editors-desk) opens it Monday mornings.
Every network call degrades to a "couldn't check" note — the page still
builds offline.
"""

import datetime
import html
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPOS_DIR = os.path.dirname(ROOT)  # ~/btownbrief
EXTRA_REPO_DIRS = [os.path.expanduser("~/job-radar")]
STATE_PATH = os.path.join(ROOT, "desk-state.json")
OUT_PATH = os.path.join(ROOT, "desk.html")

NOW = datetime.datetime.now(datetime.timezone.utc)

DEFAULT_STATE = {
    "note": "Local-only (gitignored). Watchlist/waiting: known issues and pending human steps; remove by resolving via --done. Stamps: last-done dates for rhythms with no file trail.",
    "watchlist": [
        {"slug": "sevendays-adapter", "title": "Seven Days events adapter returns 403",
         "since": "2026-07-11", "note": "Failed sources carry their events forward forever, so the calendar quietly ages."},
        {"slug": "google-maps-key", "title": "Google Maps API key missing",
         "since": "2026-07-26", "note": "Contractor pass-3 rows pending a rerun once restored."},
        {"slug": "ios-safe-area", "title": "iOS standalone safe-area fix — 17 games unpatched",
         "since": "2026-08-01", "note": "Installed games clip the top bar; needs black-translucent + viewport-fit=cover."},
        {"slug": "tmp-logs", "title": "launchd jobs log to /tmp, which macOS purges",
         "since": "2026-08-30", "note": "Failures vanish after a reboot; point plists at ~/Library/Logs/btownbrief/ instead."},
        {"slug": "junk-tilde-dir", "title": "Literal '~' directory in home from a mis-quoted path",
         "since": "2026-08-30", "note": "~/'~'/btownbrief/btown-brief holds shadow copies of some Currents files; delete after confirming the real ones are canonical."},
    ],
    "waiting": [
        {"slug": "lake-breath-sql", "title": "Lake Breath: paste its SQL into Supabase", "since": "2026-08-15"},
        {"slug": "party-sql", "title": "Btown Party: paste room SQL into Supabase (?demo=1 works meanwhile)", "since": "2026-08-09"},
        {"slug": "street-yeet-sql", "title": "Street Yeet: first-score SQL paste pending", "since": "2026-08-24"},
        {"slug": "uf-plan-drafts", "title": "Up For It: PLAN-DRAFTS.md awaits your review", "since": "2026-08-23"},
        {"slug": "small-talk-profile", "title": "Small Talk: create your own profile, then hub listing", "since": "2026-08-23"},
    ],
    "stamps": {
        "hud-tiles": "2025-10-15"
    },
}

# Rhythms with a file trail read their own stamp; the rest use state["stamps"].
RHYTHMS = [
    {"slug": "best-of-sweep", "title": "Best of Reddit additions sweep",
     "cadence_days": 35, "source": "file:data/bestof-2026.json:meta.updated",
     "note": "Mine the Inoreader wire since the last window, append, reseed, hand-filter."},
    {"slug": "events-strip", "title": "Guide events strip refresh",
     "cadence_days": 7, "source": "stamp",
     "note": "COVERAGE.md flags this as weekly-by-hand; candidate for wiring into the newsletter workflow."},
    {"slug": "roster-pass", "title": "Music + Instagram roster pass",
     "cadence_days": 30, "source": "stamp",
     "note": "New local acts via Bandcamp autocomplete; vet IG handles via the profile endpoint first."},
    {"slug": "contractors-reverify", "title": "Contractor directory re-verify",
     "cadence_days": 182, "source": "stamp",
     "note": "License re-checks; OPR registry has no bulk export, so it's manual."},
    {"slug": "hud-tiles", "title": "HUD income-limit tiles",
     "cadence_days": 365, "source": "stamp", "note": "Hand-updated each October."},
]

STATIONS = [
    ("Photo moderation", "photo-admin.html", "the original Editor's Desk — approve community photos"),
    ("GoodBurlington queue", "https://github.com/btownbrief/btown-brief/actions/workflows/goodburlington-queue.yml", "manual kick if the 8:45 open didn't fire"),
    ("Actions overview", "https://github.com/btownbrief/btown-brief/actions", "the whole board at a glance"),
]


def sh(args, timeout=30, cwd=None):
    """Run a command; return stdout or None (never raise)."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def load_state():
    if not os.path.exists(STATE_PATH):
        with open(STATE_PATH, "w", encoding="utf-8") as fh:
            json.dump(DEFAULT_STATE, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        return json.loads(json.dumps(DEFAULT_STATE))
    with open(STATE_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def save_state(state):
    with open(STATE_PATH, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def mark_done(slug):
    state = load_state()
    today = NOW.date().isoformat()
    if any(r["slug"] == slug for r in RHYTHMS):
        state.setdefault("stamps", {})[slug] = today
        print(f"stamped rhythm {slug} = {today}")
    else:
        for key in ("watchlist", "waiting"):
            before = len(state.get(key, []))
            state[key] = [i for i in state.get(key, []) if i["slug"] != slug]
            if len(state[key]) < before:
                print(f"resolved {key} item {slug}")
                break
        else:
            print(f"no rhythm, watchlist, or waiting item named {slug!r}")
            sys.exit(1)
    save_state(state)


# ---- signal gathering -------------------------------------------------------

def local_repos():
    # Hidden dirs (like .pulse-runner, the dispatcher's private checkout) are
    # automation workspaces, often pinned to old commits — not signal.
    dirs = [os.path.join(REPOS_DIR, d) for d in sorted(os.listdir(REPOS_DIR))
            if not d.startswith(".")]
    return [d for d in dirs + EXTRA_REPO_DIRS if os.path.isdir(os.path.join(d, ".git"))]


def gh_slug(repo_dir):
    url = sh(["git", "-C", repo_dir, "remote", "get-url", "origin"], timeout=10)
    if not url:
        return None
    m = re.search(r"github\.com[:/]([^/]+/[^/.]+)", url.strip())
    return m.group(1) if m else None


def cron_interval_hours(cron):
    """Rough interval between firings implied by a cron expression."""
    fields = cron.split()
    if len(fields) != 5:
        return 24
    minute, hour, dom, _month, dow = fields
    if "*" in hour or "/" in hour:
        return 1
    if "," in minute or "," in hour:
        return max(1, 24 // (len(minute.split(",")) * len(hour.split(","))))
    if dom == "*" and dow == "*":
        return 24
    if dow != "*":
        return 24 * 7
    return 24 * 30


def scheduled_workflows(repo_dir):
    """[(workflow_file, interval_hours)] for workflows with a cron schedule."""
    wf_dir = os.path.join(repo_dir, ".github", "workflows")
    if not os.path.isdir(wf_dir):
        return []
    found = []
    for name in sorted(os.listdir(wf_dir)):
        if not name.endswith((".yml", ".yaml")):
            continue
        try:
            text = open(os.path.join(wf_dir, name), encoding="utf-8").read()
        except OSError:
            continue
        crons = re.findall(r"cron:\s*['\"]([^'\"]+)['\"]", text)
        if not crons:
            continue
        found.append((name, min(cron_interval_hours(c) for c in crons)))
    return found


def parse_iso(ts):
    return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def check_workflow_health():
    """Red/amber findings across every repo with scheduled workflows."""
    findings, unreachable = [], []
    seen_slugs = set()
    for repo_dir in local_repos():
        schedules = scheduled_workflows(repo_dir)
        if not schedules:
            continue
        slug = gh_slug(repo_dir)
        if not slug or slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        out = sh(["gh", "run", "list", "-R", slug, "--limit", "60", "--json",
                  "workflowName,workflowDatabaseId,conclusion,status,createdAt,url"], timeout=45)
        if out is None:
            unreachable.append(slug)
            continue
        runs = json.loads(out)
        # Failures and wedged runs matter for EVERY workflow (deploys included —
        # a queued run holding pages concurrency is the zombie-deploy mode).
        by_wf = {}
        for r in runs:
            by_wf.setdefault(r["workflowName"], []).append(r)
        for wf, wf_runs in by_wf.items():
            newest = wf_runs[0]
            if newest["status"] in ("queued", "waiting", "in_progress"):
                age_h = (NOW - parse_iso(newest["createdAt"])).total_seconds() / 3600
                if age_h > 1:
                    findings.append(("red", f"{slug} · {wf}",
                                     f"run wedged in “{newest['status']}” for {age_h:.0f}h — cancel it (the zombie-deploy failure mode)",
                                     newest["url"]))
            elif newest["conclusion"] == "failure":
                findings.append(("red", f"{slug} · {wf}", "latest run failed", newest["url"]))
        # Staleness only makes sense for cron-driven workflows, each judged
        # against its own cadence (a deploy that hasn't run just had no pushes).
        for wf_file, interval_h in schedules:
            out = sh(["gh", "run", "list", "-R", slug, "--workflow", wf_file,
                      "-s", "success", "--limit", "1", "--json", "workflowName,createdAt,url"],
                     timeout=30)
            if out is None:
                continue
            ok = json.loads(out)
            if not ok:
                continue
            age_h = (NOW - parse_iso(ok[0]["createdAt"])).total_seconds() / 3600
            if age_h > interval_h * 2.5 + 6:
                findings.append(("amber", f"{slug} · {ok[0]['workflowName']}",
                                 f"no successful run in {age_h/24:.1f} days (runs ~every {interval_h}h)",
                                 ok[0]["url"]))
    return findings, unreachable


def check_launchd():
    out = sh(["launchctl", "list"], timeout=10)
    findings = []
    if out is None:
        return [("amber", "launchd", "couldn't read launchctl list", None)]
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 3 and parts[2].startswith("com.btownbrief."):
            status = parts[1]
            if status not in ("0", "-"):
                findings.append(("red", parts[2], f"last exit status {status}", None))
    return findings


def check_open_prs():
    prs, notes = [], []
    out = sh(["gh", "search", "prs", "--owner", "btownbrief", "--state", "open",
              "--limit", "50", "--json", "repository,number,title,createdAt,url"], timeout=45)
    if out is None:
        notes.append("couldn't search btownbrief org PRs")
    else:
        for p in json.loads(out):
            prs.append({"repo": p["repository"]["nameWithOwner"], "number": p["number"],
                        "title": p["title"], "createdAt": p["createdAt"], "url": p["url"]})
    out = sh(["gh", "pr", "list", "-R", "stephenvdavis-jpg/job-radar", "--json",
              "number,title,createdAt,url"], timeout=30)
    if out is None:
        notes.append("couldn't list job-radar PRs")
    else:
        for p in json.loads(out):
            prs.append({"repo": "job-radar", "number": p["number"], "title": p["title"],
                        "createdAt": p["createdAt"], "url": p["url"]})
    prs.sort(key=lambda p: p["createdAt"])
    return prs, notes


def rhythm_last_done(rhythm, state):
    src = rhythm["source"]
    if src.startswith("file:"):
        _, rel, dotted = src.split(":", 2)
        try:
            data = json.load(open(os.path.join(ROOT, rel), encoding="utf-8"))
            for key in dotted.split("."):
                data = data[key]
            return datetime.date.fromisoformat(str(data)[:10])
        except Exception:
            return None
    stamp = state.get("stamps", {}).get(rhythm["slug"])
    return datetime.date.fromisoformat(stamp) if stamp else None


# ---- rendering --------------------------------------------------------------

def esc(s):
    return html.escape(str(s), quote=True)


def days_ago(iso_ts):
    return (NOW - parse_iso(iso_ts)).days


def render(state):
    wf_findings, unreachable = check_workflow_health()
    launchd_findings = check_launchd()
    prs, pr_notes = check_open_prs()

    broken = wf_findings + launchd_findings
    rows = []

    def section(title, sub=""):
        rows.append(f'<section><h2>{title}</h2>')
        if sub:
            rows.append(f'<p class="sub">{sub}</p>')

    def chip(level):
        return {"red": '<span class="chip red">needs you</span>',
                "amber": '<span class="chip amber">aging</span>',
                "ok": '<span class="chip ok">ok</span>'}[level]

    # 1 — broken & stale
    section("Broken &amp; stale", "Scheduled workflows across every checkout, launchd exit codes, and the standing watchlist.")
    if not broken:
        rows.append('<p class="allclear">✅ Every scheduled workflow\'s latest run succeeded on time, and all launchd jobs exited clean.</p>')
    else:
        rows.append("<ul>")
        for level, what, detail, url in broken:
            link = f' <a href="{esc(url)}">run ↗</a>' if url else ""
            rows.append(f"<li>{chip(level)} <strong>{esc(what)}</strong> — {esc(detail)}{link}</li>")
        rows.append("</ul>")
    if unreachable:
        rows.append(f'<p class="note">Couldn\'t reach GitHub for: {esc(", ".join(unreachable))}.</p>')
    if state.get("watchlist"):
        rows.append('<h3>Watchlist</h3><ul>')
        for item in state["watchlist"]:
            rows.append(
                f'<li>{chip("amber")} <strong>{esc(item["title"])}</strong>'
                f' <span class="age">since {esc(item.get("since", "?"))}</span>'
                f'<br><span class="note">{esc(item.get("note", ""))} · resolve: <code>scripts/editors_desk.py --done {esc(item["slug"])}</code></span></li>')
        rows.append("</ul>")
    rows.append("</section>")

    # 2 — waiting on you
    section("Waiting on you", "Open PRs org-wide, oldest first, plus pending human steps.")
    if prs:
        rows.append("<ul>")
        for p in prs:
            age = days_ago(p["createdAt"])
            level = "red" if age > 21 else ("amber" if age > 7 else "ok")
            rows.append(f'<li>{chip(level)} <a href="{esc(p["url"])}">{esc(p["repo"])} #{p["number"]}</a>'
                        f' — {esc(p["title"])} <span class="age">{age}d</span></li>')
        rows.append("</ul>")
    else:
        rows.append('<p class="allclear">✅ No open PRs.</p>')
    for note in pr_notes:
        rows.append(f'<p class="note">{esc(note)}</p>')
    if state.get("waiting"):
        rows.append("<h3>Pending steps</h3><ul>")
        for item in state["waiting"]:
            rows.append(f'<li>{chip("amber")} {esc(item["title"])} <span class="age">since {esc(item.get("since", "?"))}</span>'
                        f' <span class="note">· done: <code>--done {esc(item["slug"])}</code></span></li>')
        rows.append("</ul>")
    rows.append("</section>")

    # 3 — rhythms
    section("Rhythms", "Recurring chores. Where a file carries the stamp, it's read automatically.")
    rows.append("<ul>")
    for r in RHYTHMS:
        last = rhythm_last_done(r, state)
        if last is None:
            level, when = "amber", "never recorded"
        else:
            due = last + datetime.timedelta(days=r["cadence_days"])
            overdue = (NOW.date() - due).days
            level = "red" if overdue > 0 else ("amber" if overdue > -7 else "ok")
            when = f"last {last.isoformat()}, due {due.isoformat()}"
        stamp_hint = "" if r["source"].startswith("file:") else f' · done: <code>--done {esc(r["slug"])}</code>'
        rows.append(f'<li>{chip(level)} <strong>{esc(r["title"])}</strong> <span class="age">{esc(when)}</span>'
                    f'<br><span class="note">{esc(r["note"])}{stamp_hint}</span></li>')
    rows.append("</ul>")
    rows.append("<h3>Stations</h3><ul>")
    for title, href, note in STATIONS:
        rows.append(f'<li><a href="{esc(href)}">{esc(title)}</a> — {esc(note)}</li>')
    rows.append("</ul></section>")

    reds = sum(1 for lvl, *_ in broken if lvl == "red") + sum(1 for p in prs if days_ago(p["createdAt"]) > 21)
    stamp = NOW.astimezone().strftime("%A %B %-d, %Y · %-I:%M %p")
    return f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Editor's Desk</title>
<style>
  :root {{ color-scheme: light dark;
    --bg:#faf7f2; --ink:#25211c; --mut:#6f675c; --card:#fff; --line:#e6dfd4;
    --red:#b3382c; --amber:#9a6b0f; --ok:#2d6a4f; --redbg:#f8e4e1; --amberbg:#f6ecd4; --okbg:#dcefe4; }}
  @media (prefers-color-scheme: dark) {{ :root {{
    --bg:#191613; --ink:#ece7de; --mut:#a39a8c; --card:#211d19; --line:#37312a;
    --redbg:#4a2320; --amberbg:#42351a; --okbg:#1f3a2d; --red:#e8968c; --amber:#dcb35e; --ok:#8fcbae; }} }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.55 -apple-system, "Helvetica Neue", sans-serif; }}
  main {{ max-width:760px; margin:0 auto; padding:32px 20px 80px; }}
  h1 {{ font-size:30px; margin:0; }} .stamp {{ color:var(--mut); margin:4px 0 28px; }}
  section {{ background:var(--card); border:1px solid var(--line); border-radius:14px;
    padding:20px 24px; margin-bottom:22px; }}
  h2 {{ font-size:20px; margin:0 0 2px; }} h3 {{ font-size:15px; margin:18px 0 4px; }}
  .sub {{ color:var(--mut); font-size:14px; margin:0 0 12px; }}
  ul {{ margin:8px 0; padding-left:2px; list-style:none; }}
  li {{ margin:10px 0; }}
  .chip {{ font-size:11px; font-weight:600; letter-spacing:.03em; text-transform:uppercase;
    border-radius:99px; padding:2px 9px; margin-right:6px; white-space:nowrap; }}
  .chip.red {{ background:var(--redbg); color:var(--red); }}
  .chip.amber {{ background:var(--amberbg); color:var(--amber); }}
  .chip.ok {{ background:var(--okbg); color:var(--ok); }}
  .age {{ color:var(--mut); font-size:13px; }}
  .note {{ color:var(--mut); font-size:13.5px; }}
  .allclear {{ margin:8px 0; }}
  code {{ font-size:12.5px; background:var(--bg); border:1px solid var(--line);
    border-radius:5px; padding:1px 5px; }}
  a {{ color:inherit; }}
</style>
<main>
  <h1>Editor's Desk</h1>
  <p class="stamp">{esc(stamp)} · {reds} thing{"" if reds == 1 else "s"} need{"s" if reds == 1 else ""} you</p>
  {"".join(rows)}
  <p class="note">Rebuild anytime: <code>python3 scripts/editors_desk.py</code> · opens automatically Monday 8:30.</p>
</main>
"""


def main():
    if "--done" in sys.argv:
        mark_done(sys.argv[sys.argv.index("--done") + 1])
    state = load_state()
    page = render(state)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(page)
    print(f"wrote {OUT_PATH}")
    if "--no-open" not in sys.argv:
        subprocess.run(["open", OUT_PATH])


if __name__ == "__main__":
    main()
