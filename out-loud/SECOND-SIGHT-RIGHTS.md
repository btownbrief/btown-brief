# Second Sight: image rights, one line per image

Rule (T21 brief, Sept 6 2026): a stop gets a ghost only when its image is public domain or CC BY
and that status has been read off the source record, not assumed. Anything unverifiable does not
ship. Every record below was fetched from the Library of Congress item API
(`https://www.loc.gov/item/<id>/?fo=json`) on 2026-09-06 and the two rights fields were read
verbatim: `rights_advisory` and the collection `rights` note.

All five are Detroit Publishing Company glass negatives in the LOC Prints & Photographs Division.
Rights text common to all five, verbatim from each record:

> rights_advisory: "No known restrictions on publication."
> rights: "The Library of Congress believes that many of the papers in the Detroit Publishing
> Company collection are in the public domain or have no known copyright restrictions and are
> free to use and reuse."

All five were created c1900–1907, which is before 1929, so they are public domain in the US on
age alone as well. Credit line used on the page and burned into every composite:
"Detroit Publishing Co., Library of Congress Prints & Photographs Division · Public domain
(No known restrictions on publication)".

| stop id | file | LOC title | date (record) | reproduction no. | source | verified |
|---|---|---|---|---|---|---|
| church-street-marketplace | sights/church-street-marketplace.jpg | Church St., looking north from College St., Burlington, Vt. | c1907 | LC-DIG-det-4a13783 | https://www.loc.gov/item/2016800138/ | 2026-09-06, item JSON |
| city-hall-park | sights/city-hall-park.jpg | City Hall Park, Burlington, Vt. | c1907 | LC-DIG-det-4a13784 | https://www.loc.gov/item/2016806357/ | 2026-09-06, item JSON |
| battery-park | sights/battery-park.jpg | Lake Champlain, from Battery Park, Burlington, Vt. | c1904 | LC-DIG-det-4a29995 | https://www.loc.gov/item/2016796677/ | 2026-09-06, item JSON |
| uvm-green | sights/uvm-green.jpg | University of Vermont, Burlington, Vt. | between 1900 and 1906 | LC-DIG-det-4a10660 | https://www.loc.gov/item/2016802599/ | 2026-09-06, item JSON |
| ethan-allen-monument | sights/ethan-allen-monument.jpg | [Ethan Allen Monument, Burlington, Vt.] | between 1900 and 1906 | LC-DIG-det-4a10659 | https://www.loc.gov/item/2016802598/ | 2026-09-06, item JSON |

Files are the LOC 1024-px "v" service JPEGs, resized to 1200 px on the long side at JPEG quality 82
(`sips`), no other edits. Access: `access_restricted: false` on all five.

## Bearings

Bearings are estimated from the photograph and the map, not measured on site. Each `sight` in
`stories.json` carries `bearing_confirmed: false` until Stephen stands there with the field recipe
below and corrects it. `[CONFIRM: all five bearings]`

| stop | bearing | reasoning |
|---|---|---|
| church-street-marketplace | 355° | Titled "looking north from College St."; Church Street runs about 3° west of north on the OSM centreline. The 1900 Burlington Savings Bank building is the surviving right-hand corner. |
| city-hall-park | 80° | Fountain in the middle, storefronts behind the trees: the Church Street frontage seen from the St. Paul Street side. Least certain of the five. |
| battery-park | 245° | Juniper Island dead centre beyond the breakwater; from the Battery Park overlook the island bears roughly WSW. |
| uvm-green | 88° | The Old Mill tower from the Green, which lies due west of it. |
| ethan-allen-monument | 350° | Cemetery path approaching the column from the Colchester Avenue side. Least certain after City Hall Park. |

## Candidates checked and not used

- LOC "Church Street, north from bank" (2016812187, 1911) and "[City Hall Park]" (2016815759, 1900–1920): same rights, held back so each stop has one image.
- LOC "Main Street, Burlington, Vt." (2016799586): the standing spot on Main Street could not be placed from the photo; no stop matched.
- Wikimedia Commons "Burlington Union Station 1918 postcard" and the NYPL Battery Park postcards: marked Public domain on Commons, but each file's license template was not read this pass; add after a per-file check.
- UVM Landscape Change Program: not used. Its images are "used with permission" per image, not blanket PD; a request to UVM Special Collections is a phone call, per doc 05.

## How a stop gets a sight

1. Find a public-domain or CC BY photograph of the exact view (LOC Detroit Publishing set is the deep well: search `loc.gov/photos/?q=<place>+burlington+vt&fo=json`).
2. Read `rights_advisory` on the item record. If it does not say "No known restrictions" (or the file is not clearly CC BY / CC0), stop.
3. Save the 1024-px service JPEG, resize to 1200 px long side into `out-loud/sights/<stop-id>.jpg`.
4. Add `sight: { image, bearing, bearing_confirmed, year, title, credit, license, source_url, stand_at, line_up }` to the stop in `stories.json`.
5. Add the row to the table above with the date you read the record. Then shoot the reference photo (below).

## Field recipe: shooting the "now" reference at the right bearing (5 lines)

1. Open the stop in Out Loud, tap Second Sight, and walk until the arrow points straight up and the ring turns coral.
2. Slide the ghost to about 60% and shuffle sideways until one surviving detail (a cornice, the island, the tower) sits on its real self.
3. Note the phone's Compass app reading at that moment and put it in `bearing`, set `bearing_confirmed: true`.
4. Tap Capture; that composite is the reference. Save it to `out-loud/sights/<stop-id>-now.png` (not shipped, for the next editor).
5. If nothing lines up after a minute, the standing spot is wrong: move, don't rotate, and update `stand_at`.
