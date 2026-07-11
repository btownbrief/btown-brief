# Community Photos — backend setup (one time, ~5 minutes)

The photo system uses the same shared Supabase project as the games,
playlist, and click tracking (`jnouvwxomrcffqwilqkq`). Until these steps
run, the pages stay useful: the gallery shows nothing but explains itself,
and the submit form falls back to a pre-filled email to you.

## 1. Choose your admin passphrase & run the schema

1. Open `db/photos.sql` and replace `CHOOSE_YOUR_ADMIN_PASSPHRASE` (near
   the top) with a passphrase you'll remember — it unlocks
   `photo-admin.html` on your phone. Reusing your Caption This passphrase
   is fine. Keep the surrounding quotes.
2. Supabase dashboard → the shared project → **SQL Editor** → paste the
   whole edited file → **Run**. Expect "Success. No rows returned."
   - Only the bcrypt *hash* of the passphrase is stored. To change it
     later, re-run just the `insert into btb_photo_admin ...` statement.
   - If only the LAST statement fails with `must be owner of table
     objects`, everything else worked — add that one storage policy
     through the dashboard (step 2).

## 2. Storage bucket (usually created by the SQL — verify it)

Dashboard → **Storage**. You should see a public bucket named
`btb-photos`. If not, create it:

- Name: `btb-photos`
- **Public bucket: ON** (photos serve straight from the public URL;
  pending photos have unguessable UUID filenames and are linked from
  nowhere until you approve them)
- Additional configuration: max upload size **3 MB**, allowed MIME types
  `image/jpeg` (the pages resize to ≤1600 px JPEG before uploading,
  typically ~300 KB)

If the policy statement failed in step 1: Storage → `btb-photos` →
**Policies** → New policy → **INSERT**, role **anon**, `WITH CHECK`:

```sql
bucket_id = 'btb-photos'
and name ~ '^submissions/[A-Za-z0-9-]+\.jpg$'
```

No SELECT/UPDATE/DELETE policies — anonymous visitors can add a jpeg
under `submissions/` and nothing else.

## 3. That's it

- Readers submit at `photos.html`, by email, or in the Telegram group.
- You moderate at `photo-admin.html` (works from your phone). Email and
  Telegram photos get added there too, via "Add a photo I was sent."
- Other pages and the newsletter read approved photos through
  `js/photos-lib.js` or the exported `data/photos/manifest.json`
  (`python3 scripts/export_photos.py`).
