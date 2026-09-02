#!/usr/bin/env python3
"""Which All Day tabs does Burlington actually use? Ask GoatCounter.

Since 8/31 (PR #237) every tab landing fires an `all-day-tab-<tab>` event,
and since the share round an `all-day-share-<tab>` event rides beside it.
Nine tabs is the measured ceiling of the bar, so the next tab-bar decision —
reorder, or fold the weakest into a neighbour — should be made from this
table, not instinct. The plan is to read it ~Sep 23, after three weeks of
signal.

Needs a GoatCounter API token once:
  1. https://btown-brief.goatcounter.com/user/api  ->  new token with the
     "read statistics" permission
  2. add  GOATCOUNTER_API_TOKEN=<token>  to ~/.config/btownbrief/secrets.env
     (or export it)

Run: python3 scripts/tab_report.py [--start 2026-08-31] [--end 2026-09-23]
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

SITE = "https://btown-brief.goatcounter.com"
SECRETS = pathlib.Path.home() / ".config" / "btownbrief" / "secrets.env"
TAB_RE = re.compile(r"^all-day-tab-([a-z]+)$")
SHARE_RE = re.compile(r"^all-day-share-([a-z]+)$")
EVENTS_SINCE = "2026-08-31"   # the day PR #237 started counting


def token() -> str | None:
    t = os.environ.get("GOATCOUNTER_API_TOKEN")
    if not t and SECRETS.exists():
        m = re.search(r"^\s*GOATCOUNTER_API_TOKEN\s*=\s*(\S+)", SECRETS.read_text(), re.M)
        if m:
            t = m.group(1).strip().strip("\"'")
    return t or None


def api(path: str, tok: str, params: dict) -> dict:
    url = SITE + "/api/v0" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + tok,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--start", default=EVENTS_SINCE)
    ap.add_argument("--end", default=datetime.date.today().isoformat())
    args = ap.parse_args()

    tok = token()
    if not tok:
        print("No GOATCOUNTER_API_TOKEN. Create one at "
              f"{SITE}/user/api (read statistics) and add it to {SECRETS}.",
              file=sys.stderr)
        return 2

    tabs: dict[str, int] = {}
    shares: dict[str, int] = {}
    after = ""
    for _ in range(50):   # pages of 100; the site has nowhere near 5000 paths
        params = {"start": args.start, "end": args.end, "limit": 100}
        if after:
            params["after"] = after
        try:
            page = api("/stats/hits", tok, params)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                print("GoatCounter refused the token — does it have the "
                      "'read statistics' permission?", file=sys.stderr)
                return 2
            raise
        hits = page.get("hits") or []
        for h in hits:
            p = h.get("path") or ""
            n = int(h.get("count") or 0)
            m = TAB_RE.match(p)
            if m:
                tabs[m.group(1)] = tabs.get(m.group(1), 0) + n
            m = SHARE_RE.match(p)
            if m:
                shares[m.group(1)] = shares.get(m.group(1), 0) + n
        if not page.get("more") or not hits:
            break
        after = str(hits[-1].get("path_id") or "")
        if not after:
            break

    if not tabs:
        print(f"No all-day-tab-* events between {args.start} and {args.end}. "
              "Events only exist since " + EVENTS_SINCE + " — too early, or "
              "ad blockers are winning more than expected.")
        return 1

    total = sum(tabs.values())
    print(f"All Day tab landings, {args.start} → {args.end}  (total {total:,})\n")
    width = max(len(t) for t in tabs)
    for tab, n in sorted(tabs.items(), key=lambda kv: -kv[1]):
        pct = 100 * n / total
        bar = "█" * max(1, round(pct / 2.5))
        share = f"  · shared {shares[tab]}×" if shares.get(tab) else ""
        print(f"  {tab:<{width}}  {n:>6,}  {pct:5.1f}%  {bar}{share}")

    least = min(tabs.items(), key=lambda kv: kv[1])
    print(f"\nLeast-landed tab: {least[0]} ({least[1]:,} — "
          f"{100 * least[1] / total:.1f}%). The bar holds nine; if this is "
          "under a few percent after three weeks, it is the fold candidate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
