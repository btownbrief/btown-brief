# data/photos/ — the shared photo hook

Approved community photos are available to every page and tool two ways.
Both return photos in the same normalized shape:

```json
{
  "id": "uuid",
  "url": "https://…supabase.co/storage/v1/object/public/btb-photos/submissions/….jpg",
  "caption": "Sunset from the breakwater",
  "category": "sunsets",
  "area": "Waterfront",
  "spot": "North Beach",
  "taken_on": "early July",
  "credit": "Jane R.",
  "label": null,
  "votes": 12,
  "approved_on": "2026-07-10"
}
```

**Live (preferred on pages):** include `js/photos-lib.js` and call
`BTBP.getApproved()` → `{ live, photos }`, or `BTBP.getPotw()` for the
photo of the week. It falls back to this folder's manifest automatically.

**Static (for the newsletter pipeline and anything offline):**
`manifest.json`, refreshed by `python3 scripts/export_photos.py`:

```json
{ "generated_at": "…", "photo_of_the_week": { …photo }, "photos": [ …photos ] }
```

Recipes:

- **Sunset tracker gallery:** `photos.filter(p => p.category === 'sunsets')`
- **Events coverage:** `photos.filter(p => p.category === 'events')`
- **Newsletter photo of the week:** `manifest.photo_of_the_week` — embed
  `url`, quote `caption`, credit `credit` (or "a neighbor" when blank).

`categories`: sunsets, pets, gardens, food, wildlife, street, events, other.
`area` values match the neighborhood taxonomy in `data/taxonomy.json`.
Legacy `data/photos.json` (the old manual Google-Form flow) is superseded
by this system.
