#!/usr/bin/env python3
"""Fail red the moment any All Day / guide payload blows its freshness budget.

Editor's Desk already knows how to age every payload (PAYLOADS +
check_payload_freshness in editors_desk.py) — but the Desk runs Monday
mornings, and every silent-staleness incident this project has had (curate-top
8/29, curate-tv 8/31, both green) surfaced from the product days before the
Desk would have said anything. This is the same check at product cadence: a
tiny daily workflow runs it and exits non-zero on any red finding, so a frozen
payload becomes a failure email the next morning instead of a Monday surprise.

Ambers (approaching budget, or unmonitorable) are printed as warnings and do
not fail the run — the Desk remains the place where ambers get read.

Run: python3 scripts/check_freshness.py
"""

import sys

from editors_desk import check_payload_freshness


def main() -> int:
    findings = check_payload_freshness()
    reds = 0
    for sev, name, msg, url in findings:
        line = f"{name}: {msg}" + (f" ({url})" if url else "")
        if sev == "red":
            print(f"::error::{line}")
            reds += 1
        else:
            print(f"::warning::{line}")
    if not findings:
        print("every payload inside its freshness budget")
    return 1 if reds else 0


if __name__ == "__main__":
    raise SystemExit(main())
