"""What Town publishes about a sale or a permit. data/town/streets.json ships with
the site, so a private home's number must never reach it: readers can open the file.

A home keeps its street, a rounded map point and nothing that identifies it. Only a
place positively known to be a business keeps its address and project name, so an
unknown or blank land use counts as a home.

A row's id is a hash of what the row itself prints, never of a record number, so
undoing the hash tells a reader nothing the row doesn't already say.

A takedown, start to finish:
  1. Take the tile's id without its kind ("sold-abc123" in the feed is "abc123"). A
     place with several records has one id for each: find them in streets.json.
  2. Add one id per record to "ids" in data/town/hidden.json and push to main.
  3. Actions -> Refresh Town data -> Run workflow -> daily. Streets drops each row and
     its address's geocoder cache entry, the workflow saves the smaller cache, Feed
     drops the tile and prunes its photo, and the deploy follows.
  4. Older copies of the cache expire after a week unused. To clear them now:
     gh cache list --key town-geo-, then gh cache delete each one."""

import hashlib
import json
import os
import re
from collections import Counter

from .common import OUT_DIR
from .aerials import fetch
from .geo import street_of
from .title_guard import names_person

BUSINESS_LUC = ("C -", "CC", "I -")         # commercial, industrial
NEEDS_A_USE = ("CR", "E -", "EL", "TE")     # mixed-use and exempt: a home until the text names a business
# a sale is a home unless its class says business; "20. Other" and a blank both fail closed
BUSINESS_SALE = re.compile(r"\b(office|retail|commercial|industrial|hotel|motel|restaurant|warehouse)\b", re.I)
RESIDENTIAL = re.compile(r"\b(apartments?|apts?|condo(minium)?s?|residen\w+|houses?|homes?|duplex|triplex|dwellings?|"
                         r"units?|adus?|townho\w+|(?<!commercial )kitchens?|bedrooms?|live[-/ ]work|parsonages?|porch(es)?|"
                         r"(?<!roof )(?<!metal )decks?(?! above))\b", re.I)
BUSINESS_USE = re.compile(r"\b(restaurants?|(?<!grab )(?<!wet )bars?|caf[eé]s?|bakery|brew(ery|eries|pub)|tap ?rooms?|retail|storefronts?|"
                          r"(?<!home )offices?|(?<!home )(?<!wood )shops?|hotels?|motels?|salons?|delis?|bagels?|pizza|catering|"
                          r"tenant fit\S*|fit[- ](out|up)|commercial (kitchen|space|tenant)|concessions?|clinics?|dental|pharmacy|grocery)\b", re.I)
# real businesses the city's export leaves without a land use
KNOWN_BUSINESS = re.compile(r"\b(nectar['’]?s|capone['’]?s)\b", re.I)


def hidden():
    """Row ids taken down at someone's request, one per record. data/town/hidden.json holds them."""
    try:
        with open(os.path.join(OUT_DIR, "hidden.json"), encoding="utf-8") as fh:
            return set(json.load(fh).get("ids", []))
    except (OSError, ValueError):
        return set()


def _row_id(*printed):
    return hashlib.sha1("|".join(str(x) for x in printed).encode()).hexdigest()[:12]


def _place(address, hit, home):
    """What a row prints as its place: a home's street, a business's address."""
    return (hit[2] if hit else street_of(address or "")) if home else address


def _permit_ids(items, places):
    """One id per row. A counter tells apart what is otherwise alike, and counting in
    permit order keeps an earlier permit's id when a later one joins it."""
    ids, used = [None] * len(items), Counter()
    for i in sorted(range(len(items)), key=lambda i: (len(str(items[i].get("permit_no"))), str(items[i].get("permit_no")))):
        key = (places[i], items[i].get("applied"), items[i].get("kind"))
        ids[i] = _row_id(*key, used[key])
        used[key] += 1
    return ids


def _taken_down(row_id, address, gone, geo):
    if row_id not in gone:
        return False
    geo.forget(address or "")
    return True


def is_business(p):
    """p's description is read here and never published."""
    luc = (p.get("land_use") or "").strip().upper()
    text = f"{p.get('project') or ''} {p.get('description') or ''}"
    known = bool(KNOWN_BUSINESS.search(text))
    if not luc:
        return known
    if RESIDENTIAL.search(text):
        return False
    if luc.startswith(BUSINESS_LUC):
        return True
    return luc.startswith(NEEDS_A_USE) and (known or bool(BUSINESS_USE.search(text)))


def publish_permits(items, geo, portal):
    out, gone = [], hidden()
    homes = [not is_business(p) for p in items]
    hits = [geo.find(p["address"], home=home) if p.get("notable") else None for p, home in zip(items, homes)]
    # a routine row prints no place, so its id hashes none
    places = [_place(p.get("address"), hit, home) if p.get("notable") else "" for p, hit, home in zip(items, hits, homes)]
    for p, home, hit, place, row_id in zip(items, homes, hits, places, _permit_ids(items, places)):
        row = {k: p.get(k) for k in ("kind", "layer", "applied", "week", "est_cost", "notable", "notable_reasons", "status")}
        row["id"] = row_id
        if _taken_down(row_id, p.get("address"), gone, geo):
            continue
        if p.get("notable"):
            row["home"] = home
            row["pt"] = hit[:2] if hit else None
            row["img"] = fetch(hit[0], hit[1], 260 if home else 170, 240, 240) if hit else None
            if home:
                row.update(address=place, project=None, source_url=portal)
            else:
                row.update(address=place, land_use=p.get("land_use"), source_url=p.get("source_url"),
                           project=None if names_person(p.get("project")) else p.get("project"))
        out.append(row)
    return out


def publish_sales(items, geo):
    used = Counter()
    out, gone = [], hidden()
    for s in items:
        cls = s.get("property_class") or ""
        home = not BUSINESS_SALE.search(cls) or s.get("buyer_use") == "Principal Residence"
        hit = geo.find(s["address"], home=home) if s.get("price") else None
        place = _place(s.get("address"), hit, home)
        key = (place, s.get("closed"), s.get("price"))
        row_id = _row_id(*key, *([used[key]] if used[key] else []))  # the first keeps its short form, so ids hold
        used[key] += 1
        if _taken_down(row_id, s.get("address"), gone, geo):
            continue
        out.append({
            "id": row_id,
            "address": place,
            "pt": hit[:2] if hit else None, "home": home,
            "img": fetch(hit[0], hit[1], 260 if home else 170, 240, 240) if hit else None,
            "closed": s.get("closed"), "posted": s.get("posted"), "price": s.get("price"),
            "grand_list_value": s.get("grand_list_value"), "property_class": cls or None,
            "arms_length": s.get("arms_length"), "company": bool(s.get("buyer_entity")),
            "source_url": s.get("source_url"), "notable": s.get("notable"), "notable_reasons": s.get("notable_reasons"),
        })
    return out
