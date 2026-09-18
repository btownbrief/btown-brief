#!/usr/bin/env python3
"""
Print the "This week in Burlington's wild" newsletter block as Beehiiv-pasteable HTML,
built from data/wild.json (the same data wild.html shows). Stephen pastes it into a
Wednesday edition; the page's "Copy the block" button produces the same thing.

Run:  python3 scripts/wild_snippet.py            # prints HTML
      python3 scripts/wild_snippet.py --text     # plain text version
"""
import json
import os
import sys
from datetime import datetime
from html import escape as esc

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data", "wild.json")


def fmt_date(s):
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%a %b %-d")
    except Exception:  # noqa: BLE001
        return s or ""


def n(x):
    return f"{int(x or 0):,}"


def build(d):
    i = d.get("inat")
    if not i:
        return None
    m = i["month"]
    top = (m["observers"].get("top") or [None])[0]
    sp = [s.get("common") or s.get("name") for s in (m["species"].get("top") or [])[:3]]
    seen = (i.get("seen") or [None])[0]
    rare = (i.get("rare") or [None])[0]
    rival = i.get("rival") or {}
    paras = []
    p = (f"Burlington has logged <strong>{n(m['observations'])} observations</strong> of <strong>{n(m['species']['total_species'])} species</strong> "
         f"on iNaturalist this month, from {n(m['observers']['total_observers'])} people.")
    if top:
        p += f" Out front is <a href=\"{esc(top['url'])}\">{esc(top.get('name') or top['login'])}</a> with {n(top['species'])} species."
    if sp:
        p += " The most recorded: " + ", ".join(esc(x) for x in sp) + "."
    paras.append(p)
    if rare:
        paras.append(f"Flagged as threatened this month: <a href=\"{esc(rare['url'])}\">{esc(rare.get('common') or rare.get('name'))}</a>"
                     + (f" at {esc(rare['place'])}" if rare.get("place") else "") + f", recorded {esc(fmt_date(rare.get('observed_on')))}.")
    if seen:
        ob = seen.get("observer") or {}
        paras.append(f"Worth a look: a <a href=\"{esc(seen['url'])}\">{esc(seen.get('common') or seen.get('name'))}</a>"
                     + (f" near {esc(seen['place'])}" if seen.get("place") else "") + f", photographed by {esc(ob.get('name') or ob.get('login') or 'someone')}.")
    if rival:
        paras.append(f"Burlington vs {esc(rival['name'])} this month: {n(m['species']['total_species'])} species to {n(rival['month']['species'])}. "
                     f"The whole board, and how to get on it, is at <a href=\"https://guide.btownbrief.com/wild.html\">guide.btownbrief.com/wild</a>.")
    return paras


def main():
    with open(DATA) as f:
        d = json.load(f)
    paras = build(d)
    if not paras:
        print("wild.json has no iNaturalist section yet; run scripts/refresh_wild.py first.", file=sys.stderr)
        return 1
    if "--text" in sys.argv:
        import re
        print("This week in Burlington's wild\n")
        for p in paras:
            print(re.sub(r"<[^>]+>", "", p).replace("&amp;", "&") + "\n")
    else:
        print("<h3>This week in Burlington's wild</h3>")
        for p in paras:
            print(f"<p>{p}</p>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
