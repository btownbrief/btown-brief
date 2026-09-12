#!/usr/bin/env python3
"""Keep the sponsor-facing numbers in one place.

data/media-kit-numbers.json is the source. advertise.html, media-kit.html and
partner.html fetch it at load, but they also carry the same values baked in as
fallbacks (so the printed one-pager and a no-JS view are right). This script
rewrites every `<... data-num="KEY">old</...>` and `data-asof` span in those
pages from the JSON.

  python3 scripts/media_kit_numbers.py            # report drift, exit 1 if any
  python3 scripts/media_kit_numbers.py --apply    # rewrite the fallbacks

Refreshing the JSON itself is the secretary's job (see _refresh in the file):
copy subscribers / open_rate_4wk / click_rate_4wk from advisor/data/metrics.json,
recompute opens_per_edition (round DOWN), update as_of, then run --apply.
Never a price. Nothing goes in without a screenshot or API pull behind it.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PAGES = ["advertise.html", "media-kit.html", "partner.html", "privacy.html"]

def main():
    apply = "--apply" in sys.argv
    n = json.load(open(os.path.join(REPO, "data", "media-kit-numbers.json")))
    drift = 0
    for page in PAGES:
        path = os.path.join(REPO, page)
        if not os.path.exists(path):
            continue
        s = open(path).read()
        def sub_num(m):
            nonlocal drift
            key, old = m.group(2), m.group(3)
            new = str(n.get(key, old))
            if old.strip().lower().startswith("about") and not new.lower().startswith("about"):
                pass
            # keep a capitalised fallback capitalised
            if old[:1].isupper() and new[:1].islower():
                new = new[:1].upper() + new[1:]
            if new != old:
                drift += 1
                print(f"{page}: {key}: {old!r} -> {new!r}")
            return m.group(1) + new + m.group(4)
        s2 = re.sub(r'(<[a-z]+[^>]*data-num="([a-z_]+)"[^>]*>)([^<]*)(</[a-z]+>)', sub_num, s)
        def sub_asof(m):
            nonlocal drift
            if m.group(2) != n["as_of"]:
                drift += 1
                print(f"{page}: as_of {m.group(2)!r} -> {n['as_of']!r}")
            return m.group(1) + n["as_of"] + m.group(3)
        s2 = re.sub(r'(<span data-asof>)([^<]*)(</span>)', sub_asof, s2)
        if apply and s2 != s:
            open(path, "w").write(s2)
    if drift and not apply:
        print(f"{drift} fallback(s) differ from data/media-kit-numbers.json — run with --apply")
        sys.exit(1)
    print("fallbacks in step with data/media-kit-numbers.json" if not drift else f"applied {drift} change(s)")

if __name__ == "__main__":
    main()
