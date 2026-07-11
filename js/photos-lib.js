/* ============================================================
   BTOWN PHOTOS SHARED — the one way any page gets community photos.
   Used by photos.html (gallery + submit), photo-admin.html (queue),
   and available to every other page (sunset tracker, events,
   newsletter tooling) via window.BTBP.

   Live source: the shared Supabase project (db/photos.sql).
   Fallback: data/photos/manifest.json — a static export written by
   scripts/export_photos.py — so consumers still render if Supabase
   is unreachable. Every photo is normalized to the same shape:
     { id, url, caption, category, area, spot, taken_on, credit,
       label, votes, approved_on }
============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
  var BUCKET = 'btb-photos';

  var CATEGORIES = [
    { id: 'sunsets',  label: '🌅 Sunsets' },
    { id: 'pets',     label: '🐾 Pets' },
    { id: 'gardens',  label: '🌷 Gardens' },
    { id: 'food',     label: '🍽️ Food' },
    { id: 'wildlife', label: '🦆 Wildlife' },
    { id: 'street',   label: '🏙️ Street scenes' },
    { id: 'events',   label: '🎪 Events' },
    { id: 'other',    label: '📷 Everything else' },
  ];

  var AREAS = [
    'Downtown / Church St', 'Old North End', 'New North End', 'South End',
    'Hill Section', 'UVM / University', 'Waterfront', 'Winooski',
    'South Burlington', 'Essex / Essex Jct', 'Williston', 'Shelburne',
    'Colchester', 'Greater Burlington', 'Elsewhere',
  ];

  function rpc(fn, args) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.message || fn + ' failed: ' + res.status);
        });
      }
      return res.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function photoUrl(storagePath) {
    return SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + storagePath;
  }

  function normalize(row) {
    return {
      id: row.id,
      url: row.url || photoUrl(row.storage_path),
      caption: row.caption || '',
      category: row.category || 'other',
      area: row.area || 'Elsewhere',
      spot: row.spot || '',
      taken_on: row.taken_on || '',
      credit: row.credit || '',
      label: row.display_label || row.label || null,
      votes: Number(row.votes || 0),
      approved_on: row.approved_on || null,
    };
  }

  /* Approved photos, newest first. Resolves { live, photos } — live is
     false when this came from the static manifest (no voting then). */
  function getApproved() {
    return rpc('btb_photos_get').then(function (rows) {
      return { live: true, photos: (rows || []).map(normalize) };
    }).catch(function () {
      return fetch('data/photos/manifest.json')
        .then(function (r) { if (!r.ok) throw new Error('no manifest'); return r.json(); })
        .then(function (m) { return { live: false, photos: (m.photos || []).map(normalize) }; })
        .catch(function () { return { live: false, photos: [] }; });
    });
  }

  /* Photo of the week (auto: most-hearted of the last 7 days, else 30).
     Resolves a normalized photo or null. */
  function getPotw() {
    return rpc('btb_photos_potw').then(function (rows) {
      return rows && rows.length ? normalize(rows[0]) : null;
    }).catch(function () {
      return fetch('data/photos/manifest.json')
        .then(function (r) { if (!r.ok) throw new Error('no manifest'); return r.json(); })
        .then(function (m) { return m.photo_of_the_week ? normalize(m.photo_of_the_week) : null; })
        .catch(function () { return null; });
    });
  }

  function vote(photoId, voter) {
    return rpc('btb_photos_vote', { p_photo: photoId, p_voter: voter });
  }

  /* Client-side resize: longest edge ≤1600px, JPEG blob (~300 KB). */
  async function resizeImage(file, maxDim, quality) {
    var bitmap = await createImageBitmap(file);
    var scale = Math.min(1, (maxDim || 1600) / Math.max(bitmap.width, bitmap.height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    var blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/jpeg', quality || 0.85);
    });
    if (!blob) throw new Error('could not process that image');
    return blob;
  }

  /* Upload a jpeg blob to the bucket; resolves its storage path. */
  async function uploadBlob(blob) {
    var path = 'submissions/' + crypto.randomUUID() + '.jpg';
    var res = await fetch(SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    if (res.status === 401 || res.status === 403) {
      // some storage gateways also want the key as a bearer token
      res = await fetch(SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'image/jpeg',
        },
        body: blob,
      });
    }
    if (!res.ok) {
      var msg = 'upload failed: ' + res.status;
      try { msg = (await res.json()).message || msg; } catch (e) {}
      throw new Error(msg);
    }
    return path;
  }

  /* Full reader submission: resize, upload, register as pending. */
  async function submit(file, fields) {
    var blob = await resizeImage(file);
    var path = await uploadBlob(blob);
    await rpc('btb_photos_submit', {
      p_path: path,
      p_caption: fields.caption || '',
      p_category: fields.category,
      p_area: fields.area,
      p_spot: fields.spot || '',
      p_taken: fields.taken_on || '',
      p_name: fields.credit || '',
      p_permission: fields.permission === true,
      p_ai: fields.ai === true,
      p_voter: window.BTBC ? window.BTBC.visitorId() : 'anon',
    });
    return path;
  }

  window.BTBP = {
    CATEGORIES: CATEGORIES,
    AREAS: AREAS,
    rpc: rpc,
    photoUrl: photoUrl,
    normalize: normalize,
    getApproved: getApproved,
    getPotw: getPotw,
    vote: vote,
    resizeImage: resizeImage,
    uploadBlob: uploadBlob,
    submit: submit,
  };
})();
