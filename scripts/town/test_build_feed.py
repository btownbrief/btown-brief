"""Unit checks for build_feed.py. Run from the repo root:
python3 -m scripts.town.test_build_feed"""

import contextlib
import datetime as dt
import hashlib
import io
import json
import os
import re
import tempfile

import scripts.town.build_feed as build_feed
import scripts.town.geo as geo_module
import scripts.town.redact as redact_module

from .build_feed import _job_name, _meeting_day, _seen_key, city_tiles, food_tiles, reddit_tiles, sold_tiles, status, write_feed
from .common import ROOT
from .geo import Geo, street_of
from .redact import is_business, publish_permits, publish_sales
from .title_guard import CONTACT, held


class NoGeo:
    forgotten = []

    def find(self, q, home=False):
        return None

    def forget(self, q):
        self.forgotten.append(q)


def main():
    assert street_of("12 SAMPLE RD") == "Sample Road"
    assert street_of("34 N SAMPLE ST") == "North Sample Street"
    assert street_of("8-34 Pine St") == "Pine Street"

    assert street_of("12 PINE ST APT 3") == "Pine Street"

    # no digit survives, however the number or a bare unit is written
    assert street_of("12 Lake Forest Drive 34") == "Lake Forest Drive"
    assert street_of("12 1/2 Pine St") == "Pine Street"
    assert street_of("10 & 12 Pine St") == "Pine Street"
    assert street_of("12 PINE ST 3B") == "Pine Street"
    assert street_of("10 THRU 12 PINE ST") == "Pine Street"
    assert street_of("12 ST PAUL ST") == "St Paul Street" and street_of("12 ST PAUL") == "St Paul"
    assert not re.search(r"\d", street_of("12 ROUTE 7"))

    # anything not positively a business counts as a home
    assert not is_business({"land_use": "R1 - Single Fam"})
    assert not is_business({"land_use": "CR - Com/Resident", "notable_reasons": ["new_building"]})
    assert not is_business({"land_use": None, "notable_reasons": []})

    # mixed-use and exempt are homes until their text names a business
    for luc in ("CR - Com/Resident", "E - Exempt", "EL - Exmpt Land", "TE - Partl Exempt"):
        assert not is_business({"land_use": luc}), luc
        for reasons in (["commercial_occupancy"], ["restaurant_or_fitout"], ["big_project"]):
            assert not is_business({"land_use": luc, "notable_reasons": reasons, "description": "Zoning Certificate of Occupancy Request"}), (luc, reasons)
        for words in ("new restaurant", "wine bar", "cafe seating", "retail fit-out", "office space", "tenant fit-up", "NECTARS sign"):
            assert is_business({"land_use": luc, "project": words}), (luc, words)
        for words in ("grab bar in shower", "wet bar", "home office", "wood shop", "storage shed"):
            assert not is_business({"land_use": luc, "description": words}), (luc, words)
    # a Bank Street or College Street address is not a use
    assert not is_business({"land_use": "CR - Com/Resident", "project": "12 Bank Street"})
    assert not is_business({"land_use": "CR - Com/Resident", "project": "restaurant", "description": "live-work above"})

    # a blank land use is a home, however its description reads, unless it is on the list
    assert not is_business({"land_use": None, "notable_reasons": ["big_project"]})
    assert not is_business({"land_use": "", "notable_reasons": ["restaurant_or_fitout"], "description": "wine cellar"})
    assert is_business({"land_use": None, "project": "NECTARS/CAPONES REFIT", "notable_reasons": ["restaurant_or_fitout"]})
    # big alone is not a storefront; the description speaks too, and is never published
    assert not is_business({"land_use": "CR - Com/Resident", "notable_reasons": ["big_project"]})
    for words in ("kitchen remodel", "new dwelling", "ADU over garage", "second unit", "townhouse", "townhome",
                  "live-work conversion", "live/work space", "parsonage", "front porch", "rear deck"):
        assert not is_business({"land_use": "C - Commercial", "description": words}), words
    assert is_business({"land_use": "C - Commercial", "description": "commercial kitchen hood"})
    assert is_business({"land_use": "C - Commercial"})
    # a roof and the deck under it are a commercial building's too
    for words in ("remove roof system down to metal roof deck", "walls to deck above", "roof replacement"):
        assert is_business({"land_use": "C - Commercial", "description": words}), words
    assert not is_business({"land_use": "CR - Com/Resident", "project": "apartment 7 Sample Street", "notable_reasons": ["restaurant_or_fitout"]})

    # what's published about a home carries no number, no parties, no parcel id
    pub = publish_permits([{"permit_no": "ZP-1", "address": "7 Sample Street", "land_use": "CR - Com/Resident", "project": "apartment 7 Sample Street", "notable": True,
                            "notable_reasons": ["new_building"], "description": "x", "contractor": "y", "source_url": "https://city/rec/1"},
                           {"permit_no": "ZP-2", "address": "9 Sample Street", "land_use": "R1 - Single Fam", "project": "Jane Example", "notable": False}], NoGeo(), "https://portal")
    assert pub[0]["address"] == "Sample Street" and pub[0]["project"] is None and pub[0]["source_url"] == "https://portal"
    assert "address" not in pub[1] and "project" not in pub[1] and "description" not in pub[0] and "contractor" not in pub[0]
    sale = publish_sales([{"return_id": 1, "address": "12 Sample Road", "price": 412000, "property_class": "02. Single Family Dwelling", "span": "114", "buyer_state": "NY"}], NoGeo())[0]
    assert sale["address"] == "Sample Road" and "span" not in sale and "buyer_state" not in sale and "return_id" not in sale

    # a sale whose class is unclear is a home until it says otherwise
    for cls in ("20. Other", None, "05. Condominium"):
        odd = publish_sales([{"return_id": 2, "address": "12 Sample Point Rd", "price": 500000, "property_class": cls}], NoGeo())[0]
        assert odd["home"] and odd["address"] == "Sample Point Road", odd
    assert not publish_sales([{"return_id": 3, "address": "1 Sample Lane", "price": 500000, "property_class": "09. Office Buildings"}], NoGeo())[0]["home"]
    lived_in = publish_sales([{"return_id": 3, "address": "1 Sample Lane", "price": 500000, "property_class": "09. Office Buildings", "buyer_use": "Principal Residence"}], NoGeo())[0]
    assert lived_in["home"] and lived_in["address"] == "Sample Lane"
    tile = sold_tiles({"sections": {"sales": {"items": [{"id": "x", "address": "Sample Lane", "home": True, "price": 500000, "arms_length": True, "posted": "2026-10-20", "property_class": "10. Retail"}]}}}, dt.date(2026, 9, 1))[0]
    assert tile["m"] == 260

    # a row's id comes from what the row prints, never a record number
    assert sale["id"] == hashlib.sha1(b"Sample Road|None|412000").hexdigest()[:12]
    assert sale["id"] != hashlib.sha1(b"1").hexdigest()[:12]
    again = publish_sales([{"return_id": 99, "address": "14 Sample Rd", "price": 412000, "property_class": "02. Single Family Dwelling"}], NoGeo())[0]
    assert again["id"] == sale["id"]
    shop = publish_sales([{"return_id": 3, "address": "1 Sample Lane", "price": 500000, "closed": "2026-10-15", "property_class": "10. Retail"}], NoGeo())[0]
    assert shop["id"] == hashlib.sha1(b"1 Sample Lane|2026-10-15|500000").hexdigest()[:12]

    def permit(no, address, notable=True):
        return {"permit_no": no, "address": address, "kind": "Building", "applied": "2026-10-20", "notable": notable, "land_use": "R1 - Single Fam"}
    batch = [permit("CBP-26-102", "12 Sample Road"), permit("CBP-26-99", "14 Sample Road"), permit("CBP-26-50", "1 Other Lane")]
    first = [r["id"] for r in publish_permits(batch, NoGeo(), "https://portal")]
    assert first[1] == hashlib.sha1(b"Sample Road|2026-10-20|Building|0").hexdigest()[:12]
    assert len(set(first)) == 3
    assert first == [r["id"] for r in publish_permits(batch, NoGeo(), "https://portal")]
    # a later permit on the street leaves the earlier ones' ids alone
    joined = publish_permits([permit("CBP-26-103", "16 Sample Road")] + batch, NoGeo(), "https://portal")
    assert [r["id"] for r in joined[1:]] == first
    # a row that prints no street hashes no street
    quiet = publish_permits([permit("CBP-26-1", "12 Sample Road", False), permit("CBP-26-2", "1 Other Lane", False)], NoGeo(), "https://portal")
    assert quiet[0]["id"] == hashlib.sha1(b"|2026-10-20|Building|0").hexdigest()[:12]
    assert quiet[1]["id"] == hashlib.sha1(b"|2026-10-20|Building|1").hexdigest()[:12]

    # the street a row prints is the street its id hashes, a corrected spelling included
    class FixedGeo(NoGeo):
        def find(self, q, home=False):
            return [44.5, -73.2, "Corrected Road"]
    real_fetch, redact_module.fetch = redact_module.fetch, lambda *a, **k: "x.jpg"
    fixed = publish_sales([{"address": "12 Corected Road", "price": 412000, "closed": "2026-10-15"}], FixedGeo())[0]
    assert fixed["address"] == "Corrected Road" and fixed["id"] == hashlib.sha1(b"Corrected Road|2026-10-15|412000").hexdigest()[:12]
    fixed = publish_permits([permit("CBP-26-1", "12 Corected Road")], FixedGeo(), "https://portal")[0]
    assert fixed["address"] == "Corrected Road" and fixed["id"] == hashlib.sha1(b"Corrected Road|2026-10-20|Building|0").hexdigest()[:12]
    redact_module.fetch = real_fetch

    # two records alike in everything printed still get one id each
    twins = publish_sales([{"return_id": n, "address": "Sample Road", "price": None, "property_class": "02. Single Family Dwelling"} for n in (8, 9)], NoGeo())
    assert twins[0]["id"] != twins[1]["id"], twins

    # a takedown names one row id per record, and each hidden row leaves the geocoder cache
    keep = redact_module.hidden
    redact_module.hidden = lambda: {sale["id"], first[0]}
    NoGeo.forgotten.clear()
    assert publish_sales([{"return_id": 1, "address": "12 Sample Road", "price": 412000, "property_class": "02. Single Family Dwelling"}], NoGeo()) == []
    assert [r["id"] for r in publish_permits(batch, NoGeo(), "https://portal")] == first[1:]
    assert NoGeo.forgotten == ["12 Sample Road", "12 Sample Road"]
    redact_module.hidden = keep
    assert not hasattr(redact_module, "place_id")
    assert list(json.load(open(os.path.join(ROOT, "data", "town", "hidden.json")))) == ["about", "ids"]
    geo = Geo.__new__(Geo)
    geo.cache = {geo_module._key("12 Sample Rd", True): None, geo_module._key("12 Sample Rd", False): None, "other": None}
    geo.forget("12 Sample Rd")
    assert list(geo.cache) == ["other"]

    # a failed lookup is counted, and its message never carries the address
    def boom(url):
        raise RuntimeError(f"GET {url} failed")
    real_get, real_sleep = geo_module.get_json, geo_module.time.sleep
    geo_module.get_json, geo_module.time.sleep = boom, lambda s: None
    geo = Geo.__new__(Geo)
    geo.cache, geo.asked = {}, 0
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert geo.find("12 Sample Road") is None
    geo_module.get_json, geo_module.time.sleep = real_get, real_sleep
    assert out.getvalue() == "[geo] lookup failed: RuntimeError\n" and not geo.cache

    # a home permit never takes the name its owner typed
    home = {"project": "Jane Example garage", "address": "Morse Place", "home": True, "kind": "Building"}
    assert _job_name(home, ["demolition"]) == "Demolition"
    assert _job_name(home, []) == "Home project"
    biz = {"project": "High Key", "address": "191-195 Bank Street", "home": False, "kind": "Zoning permit"}
    assert _job_name(biz, ["restaurant_or_fitout"]) == "High Key"
    blank = {"project": "Project_391737", "address": "32-50 Lakeside Avenue", "home": False, "kind": "Zoning permit"}
    assert _job_name({"project": "John Smith Remodel", "address": "1 Main Street", "home": False}, ["big_project"]) == "Big project"
    assert _job_name(blank, []) == "32-50 Lakeside Avenue"

    today = dt.date(2026, 10, 30)
    assert _meeting_day("Council scheduled for Monday, Nov 2", today) == dt.date(2026, 11, 2)
    assert _meeting_day("x meets Tuesday, Jan 5", today) == dt.date(2027, 1, 5)
    assert _meeting_day("x meets Tuesday, April 6", today) == dt.date(2027, 4, 6)
    assert _meeting_day("x meets Monday, Oct 26", today) == dt.date(2026, 10, 26)
    assert _meeting_day("nothing here", today) is None

    # a home is titled by street; a shop keeps its address
    cutoff = dt.date(2026, 9, 1)
    streets = {"sections": {"sales": {"items": [
        {"id": "a", "address": "Sample Road", "pt": [44.508, -73.255], "home": True, "price": 412000, "arms_length": True, "posted": "2026-10-20", "closed": "2026-10-15",
         "property_class": "02. Single Family Dwelling", "grand_list_value": 300000},
        {"id": "b", "address": "10 Church Street", "home": False, "price": 900000, "arms_length": True, "posted": "2026-10-20", "closed": "2026-10-15",
         "property_class": "10. Retail"},
        {"id": "c", "address": "Skip Lane", "home": True, "price": 500000, "arms_length": False, "posted": "2026-10-20", "property_class": "02. Single Family Dwelling"},
    ]}}}
    tiles = {t["id"]: t for t in sold_tiles(streets, cutoff)}
    assert tiles["sold-a"]["title"] == "House on Sample Road" and tiles["sold-a"]["m"] >= 240 and tiles["sold-a"]["lat"] == 44.508
    assert tiles["sold-b"]["title"] == "10 Church Street"
    assert "sold-c" not in tiles

    # two homes on a street closing the same day are two sales; the same sale twice is one
    same_day = [{"id": i, "address": "North Sample Avenue", "home": True, "price": p, "arms_length": True, "posted": "2026-10-20", "closed": "2026-10-15",
                 "property_class": "02. Single Family Dwelling"} for i, p in (("x", 410000), ("y", 510000), ("z", 510000))]
    assert sorted(t["id"] for t in sold_tiles({"sections": {"sales": {"items": same_day}}}, cutoff)) == ["sold-x", "sold-y"]

    # a jobs or permits tile is news again only past its highest count
    seen = {"jobs-2026-10-28#14": "t1"}
    assert _seen_key({"id": "jobs-2026-10-28", "kind": "jobs", "n": 17}, seen) == "jobs-2026-10-28#17"
    assert _seen_key({"id": "jobs-2026-10-28", "kind": "jobs", "n": 12}, seen) == "jobs-2026-10-28#14"
    assert _seen_key({"id": "week-2026-W44", "kind": "week", "n": 3}, {}) == "week-2026-W44#3"
    assert _seen_key({"id": "sold-a", "kind": "sold"}, seen) == "sold-a"

    # the ban shows only while the city's post stands, and only the closings list counts
    ban = {"sections": {"parking_ban": {"status": "ban_announcement_posted", "items": [{"headline": "Winter parking ban tonight", "source_url": "u"}]},
                        "closings": {"items": [{"name": "A School"}, {"name": "B School"}], "district_posts": [{"headline": "Message to families"}]}}}
    assert status(ban) == {"ban": "Winter parking ban tonight", "ban_url": "u", "schools": 2}
    for word in ("lifted_or_cancelled_posted", "older_announcement_only", "none_posted_72h"):
        ban["sections"]["parking_ban"]["status"] = word
        assert status(ban)["ban"] is None and status(ban)["ban_url"] is None
    assert status({}) == {"ban": None, "ban_url": None, "schools": 0}

    # feed.json is left alone when only its stamp would change
    with tempfile.TemporaryDirectory() as tmp:
        real_path, build_feed.FEED_PATH = build_feed.FEED_PATH, os.path.join(tmp, "feed.json")
        write_feed({"generated": "one", "tiles": [1], "status": {"ban": None}})
        write_feed({"generated": "two", "tiles": [1], "status": {"ban": None}})
        assert json.load(open(build_feed.FEED_PATH))["generated"] == "one"
        write_feed({"generated": "three", "tiles": [2], "status": {"ban": None}})
        assert json.load(open(build_feed.FEED_PATH))["generated"] == "three"
        # a skipped build still carries the ban: only status moves
        real_load, build_feed.load_json = build_feed.load_json, lambda path, default=None: real_load(path, default) if path == build_feed.FEED_PATH else default
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            build_feed.build()
        build_feed.load_json = real_load
        kept = json.load(open(build_feed.FEED_PATH))
        assert kept["tiles"] == [2] and kept["status"] == {"ban": None, "ban_url": None, "schools": 0}
        build_feed.FEED_PATH = real_path

    # one story, however many outlets ran it
    food = food_tiles([{"category": "food", "ts": "2026-10-29T18:41:00+00:00", "headline": "Bluebird Barbecue in Burlington to close", "url": "a"},
                       {"category": "food", "ts": "2026-10-29T20:35:00+00:00", "headline": "Bluebird BBQ in Burlington announces closure", "url": "b"}], cutoff)
    assert len(food) == 1
    # the same first word is not the same story, and a story days later is a new one
    other = food_tiles([{"category": "food", "ts": "2026-10-10T18:00:00+00:00", "headline": "Bluebird Barbecue in Burlington to close", "url": "a"},
                        {"category": "food", "ts": "2026-10-11T18:00:00+00:00", "headline": "Bluebird Coffee adds a second cafe", "url": "b"},
                        {"category": "food", "ts": "2026-10-20T18:00:00+00:00", "headline": "Bluebird Barbecue closes for good", "url": "c"}], cutoff)
    assert [t["url"] for t in other] == ["a", "b", "c"]
    # two places closing the same week are two stories, however alike their headlines read
    two = food_tiles([{"category": "food", "ts": "2026-10-27T18:00:00+00:00", "headline": "Vermont Pub & Brewery to Close After 38 Years", "url": "a"},
                      {"category": "food", "ts": "2026-10-29T18:00:00+00:00", "headline": "Bluebird Barbecue in Burlington to close after 17 years", "url": "b"}], cutoff)
    assert [t["url"] for t in two] == ["a", "b"]
    one = food_tiles([{"category": "food", "ts": "2026-10-29T18:00:00+00:00", "headline": "Bluebird Barbecue in Burlington to close after 17 years", "url": "a"},
                      {"category": "food", "ts": "2026-10-29T20:00:00+00:00", "headline": "Bluebird BBQ in Burlington announces closure", "url": "b"}], cutoff)
    assert [t["url"] for t in one] == ["a"]

    # meetings: the past is dropped, the Council stands alone, the rest share a tile
    ch = [{"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "City Council Meeting agenda posted", "detail": "meets Monday, Nov 9", "url": "https://x/event/1/"},
          {"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "Board of Finance Meeting agenda posted", "detail": "meets Monday, Oct 26", "url": "https://x/event/2/"},
          {"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "Conservation Board scheduled for Monday, Nov 2", "detail": "", "url": "https://x/event/3/"}]
    tiles = city_tiles(ch, today, cutoff)
    assert sorted(t["kind"] for t in tiles) == ["city", "cityweek"]
    week = next(t for t in tiles if t["kind"] == "cityweek")
    assert week["n"] == 1 and week["rows"][0][1] == "Conservation Board"
    # a cancelled meeting leaves the feed; any other starred note becomes a sub line
    note = [{"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "Board of Finance agenda posted", "detail": "meets Monday, Nov 9", "url": "https://x/event/4/"},
            {"category": "cityhall", "ts": "2026-10-29T11:00:00+00:00", "headline": "*Meeting Cancelled* Board of Finance scheduled for Monday, Nov 9", "detail": "", "url": "https://x/event/4/"},
            {"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "*New Location* City Council Meeting agenda posted", "detail": "meets Monday, Nov 9", "url": "https://x/event/5/"},
            {"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "*New Location* Ward Sample NPA Meeting agenda posted", "detail": "meets Monday, Nov 9", "url": "https://x/event/6/"}]
    tiles = {t["kind"]: t for t in city_tiles(note, today, cutoff)}
    assert tiles["city"]["title"] == "City Council" and tiles["city"]["sub"] == "New Location"
    assert tiles["cityweek"]["rows"] == [["2026-11-09", "Ward Sample NPA", "https://x/event/6/", "New Location"]]
    # a Reddit title that names someone or a crime never reaches the feed
    assert held("Officer Smith pulled me over") and held("John Doe stole my bike") and held("Man arrested on Church Street")
    assert not held("Confirming my hatred of the pine/maple st. light") and not held("Skinny Pancake is great")
    for t in ("party at 12 lake forest drive", "12 North Winooski Ave again", "Cops at 40 Sample Way", "Noise on 7B old mill ct", "12 1/2 Pine St",
              "Thanks to J. Sample for the ride", "Spotted J. SAMPLE downtown"):
        assert held(t), t
    for t in ("A 30 year old tradition", "4 way stop at the top", "Mayor visits U.S. Senate", "St. Albans trip", "Mt. Mansfield snow"):
        assert not held(t), t
    for t in ("Call 8025550100", "Call 802 555 0100", "Call (802) 555-0100", "802.555.0100 for rides", "write to someone@example.com",
              "Oak Lane sample.name+vt@mail.example.org", "12 Sample Park", "Noise at 40 sample trail", "9 Mill Trl", "3 North Bch",
              "7 Sample Grn", "party at 12 Old Mill Grv", "Cops at 40 Sample Park", "at 12 Maple St"):
        assert held(t), t
    for t in ("5 mile trail", "10 acre park", "2 dogs at Oakledge Park", "Three killed, 5 in park", "3 hours on the Long Trail",
              "at 12 Maple", "Doors at 7 tonight", "Open at 5 pm", "Back at 8 Thursday", "The 2026 budget of 123456789 dollars", "2026-10-30 meeting",
              "Email the mayor", "$1,000,000,000 grant", "follow @sample.news"):
        assert not held(t), t
    assert held("Fine title", "Misleading - See Comments") and not held("Fine title", "News")
    # the guard and the Reddit tab's copy of it hold the same addresses
    js = open(os.path.join(ROOT, "all-day", "js", "reddit-lib.js"), encoding="utf-8").read()
    assert CONTACT.pattern in js

    # a Reddit tile needs the intake's word: safe for work, unflagged, not removed
    def thread(i, title="Fort Club", detail="▲42 · 6 comments"):
        return {"category": "chatter", "ts": "2026-10-29T10:00:00+00:00", "headline": f"Taking off on r/burlington: {title} {i}", "detail": detail,
                "url": f"https://www.reddit.com/r/burlington/comments/{i}/x/"}
    def post(i, **kw):
        return {"id": i, "nsfw": False, "score": 42, "flair": None, **kw}
    intake = {"removed": {"gone": "2026-10-29T11:00:00+00:00"},
              "posts": [post("ok"), post("nsfw", nsfw=True), post("unsure", nsfw=None), post("flag", flair="Removed by mods"), post("gone"), post("sunk", score=-2)]}
    changes = [thread(i) for i in ("ok", "nsfw", "unsure", "flag", "gone", "sunk", "missing")]
    changes.append({"category": "chatter", "ts": "2026-10-29T10:00:00+00:00", "headline": "New on r/burlington: Hockey Goalies?", "detail": "", "url": "https://www.reddit.com/r/burlington/comments/ok/y/"})
    reddit = reddit_tiles(changes, cutoff, intake)
    assert [t["title"] for t in reddit] == ["Fort Club ok"] and reddit[0]["score"] == 42 and reddit[0]["comments"] == 6
    assert reddit_tiles(changes, cutoff, None) == []
    print("build_feed: all checks passed")


if __name__ == "__main__":
    main()
