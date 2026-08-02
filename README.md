# Things To Do in Burlington

A curated guide to Burlington, Vermont — built for the [Burlington Brief](https://btownbrief.com).

Static HTML + vanilla JavaScript, no build step required.

## Previewing locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Small Bites (small-bites.html)

One combined, filterable menu for every food spot within a walk of the Church
Street Marketplace — down to the waterfront, along lower Pine Street, and into
the near Old North End (a 900m radius from Church & College). Data lives in
`data/small-bites.json`; the zone is declared in
`scripts/small_bites_roster.py` (South Burlington city center and the Winooski
circle can be added there later).

To refresh the menus:

1. `python3 scripts/small_bites_roster.py` — rebuilds `data/small-bites-roster.json`
   from `data/restaurants.json` (zone membership, dedupe, websites).
2. Re-scrape the menus: for each roster row, fetch the restaurant's own menu
   (site, linked ordering platform, or PDF) and write one JSON file per
   restaurant into a working directory — this step is agent/LLM work; the
   required per-file schema is documented at the top of
   `scripts/build_small_bites.py`. Rules: never guess a price, third-party
   menu sites (Yelp/Grubhub/DoorDash…) don't count, record gaps honestly as
   `menu_status: "unavailable"`, and capture a deal only when the menu/site
   states it.
3. `python3 scripts/build_small_bites.py --menus <that directory>` — validates
   and merges everything (plus verified deals from `data/deals.json`) into
   `data/small-bites.json`, and regenerates `data/small-bites-call-list.md`,
   the phone list for confirming deals.

## Questions / bugs

File an issue or reach out to the Burlington Brief.
