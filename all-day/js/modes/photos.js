/* photos.js — what Burlington looks like, and a reason to go take one.

   THE PROBLEM THIS IS SOLVING. There were already four photo systems in this
   repo and none of them had a reader photo in it:

     · btb_photos — the good one. Real uploads to Supabase storage, a resize
       step, a moderation queue, an admin page, and a category list that has
       included `sunsets` from the start. Five approved photos, all Stephen's,
       all from launch day. Zero pending.
     · btb_sunset_photo_queue — a second, weaker submission path on
       sunset.html that only takes a URL you paste, has no getter, and is
       reviewed by hand in the Supabase table editor.
     · data/sunset-gallery.json — five sunset photos committed to the repo.
     · data/photos.json — the original Google-Form flow, an empty array.

   This tab uses btb_photos for everything and treats sunsets as what the
   photos README always said they were: `category === 'sunsets'`. The other
   three stay where they are; nothing here writes to them.

   WHY IT LEADS WITH TONIGHT. Asking people for photos does not get photos.
   Telling them tonight scores 8.4 and the good light starts in forty minutes
   at a spot eight minutes' walk away gets photos. The score is the same
   BtownSunsetScore the tracker and the weather page use — the shared module,
   not a copy, so the three surfaces cannot drift.

   Uploads reuse js/photos-lib.js rather than reimplementing resize-and-upload,
   which is fiddly (HEIC, canvas, the storage path the RLS policy insists on).
   Both it and the score module are classic scripts, so they are injected on
   demand instead of riding in the shell for every reader who never opens this
   tab. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, safeHref, rail, seg, chip, heading, shelfHead, scrollHint,
         voteBtn, paintVote, starBtn, tabStamp, stampOf, ICON } from './../ui.js';
import { hydrateVotes } from './../rows.js';

const LIB = '../js/photos-lib.js';
const SCORE_LIB = '../js/sunset-score.js';
const SPOTS = '../data/sunset-spots.json';
const SEEDS = '../data/sunset-gallery.json';
/* The same URL the Wikipedia tab already fetches, deliberately — an identical
   request comes out of the browser cache instead of pulling the 400 KB
   featured bundle a second time. */
const WIKI = 'https://en.wikipedia.org/api/rest_v1/feed/featured/';

const state = {
  root: null,
  view: 'sunsets',            // 'sunsets' | 'all'
  photos: null,               // null = not loaded
  live: false,
  cat: null,
  spots: null,
  seeds: null,
  sun: null,                  // { score, sunsetMs, isTonight, degraded }
  potd: undefined,            // undefined = not asked, null = unavailable
};

/* Load a classic script once. The two libraries this tab needs predate the
   app's module system and attach themselves to window. */
const loaded = Object.create(null);
function script(src) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
  return loaded[src];
}

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Developing…</p>';
  render();
  loadPhotos();
  loadSun();
}

export function activate() {}
export function refresh() { render(); }
export function deactivate() { app.closePeek(); }

/* ------------------------------------------------------------------ data */

function loadPhotos() {
  script(LIB)
    .then(() => window.BTBP.getApproved())
    .then((res) => {
      state.photos = res.photos || [];
      state.live = !!res.live;
      render();
    })
    .catch(() => { state.photos = []; render(); });

  data.fetchJSON(SEEDS, 8000)
    .then((j) => { state.seeds = (j && j.photos) || []; render(); })
    .catch(() => { state.seeds = []; });

  data.fetchJSON(SPOTS, 8000)
    .then((j) => { state.spots = (j && j.spots) || []; render(); })
    .catch(() => { state.spots = []; });
}

/* Tonight's number, from the module the Sunset Tracker owns. It wants the two
   Open-Meteo payloads plus the NWS file this app already has, so the only new
   traffic is those two. A failure here costs the score line and nothing else —
   the sunset TIME comes from the weather payload and is always there. */
function loadSun() {
  const weather = data.peek('weather');
  const withWeather = weather ? Promise.resolve(weather)
    : new Promise((res) => data.load('weather', res, () => res(null)));

  Promise.all([script(SCORE_LIB), withWeather])
    .then(([, latest]) => {
      const S = window.BtownSunsetScore;
      if (!S || !latest) return null;
      return Promise.all([
        data.fetchJSON(S.OPEN_METEO_URL, 12000).catch(() => null),
        data.fetchJSON(S.AIR_URL, 12000).catch(() => null),
      ]).then(([om, aq]) => {
        if (!om) return null;
        /* selectTarget reads the NWS payload's sun block, not the Open-Meteo
           one, and takes "now" as its second argument — it decides whether
           tonight's sunset has already passed and we should be talking about
           tomorrow's. */
        const t = S.selectTarget(latest, Date.now());
        if (!t || !t.sunsetMs) return null;
        const r = S.computeScore(t.sunsetMs, om, latest, null, aq);
        return { score: r.score, degraded: r.degraded,
                 sunsetMs: t.sunsetMs, isTonight: t.isTonight };
      });
    })
    .then((sun) => { if (sun) { state.sun = sun; render(); } })
    .catch(() => { /* the time still shows */ });
}

/* Wikipedia's picture of the day. Ambient, and openly not local — it keeps the
   tab worth opening on a day nobody submitted anything, which is most days at
   the start. It loads last and sits at the bottom, per the house rule that
   live/ambient content stays small and below the real thing. */
function etDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).replace(/-/g, '/');
}

function loadPotd() {
  if (state.potd !== undefined) return;
  state.potd = null;
  data.fetchJSON(WIKI + etDay(), 10000)
    .then((j) => {
      const i = j && j.image;
      const thumb = i && i.thumbnail && i.thumbnail.source;
      if (!thumb) return;
      state.potd = {
        url: thumb,
        full: (i.image && i.image.source) || thumb,
        caption: ((i.description && i.description.text) || '').replace(/<[^>]+>/g, ''),
        credit: ((i.artist && i.artist.text) || '').replace(/<[^>]+>/g, ''),
        licence: (i.license && i.license.type) || '',
        page: i.file_page || '',
      };
      render();
    })
    .catch(() => { /* ambient: its absence is not an error */ });
}

const sunsets = () => (state.photos || []).filter((p) => p.category === 'sunsets');
const others = () => (state.photos || []).filter((p) => p.category !== 'sunsets');

/* ----------------------------------------------------------------- pieces */

function verdict(score) {
  if (score >= 8) return 'Drop what you are doing';
  if (score >= 6.5) return 'Worth the walk';
  if (score >= 5) return 'Could go either way';
  if (score >= 3) return 'Probably a quiet one';
  return 'Not tonight';
}

function clockOf(ms) {
  return new Date(ms).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

/* The hero. It answers "is tonight worth it, and when" before anything else,
   because that is the question that turns a reader into a photographer. */
function tonight(root) {
  const w = data.peek('weather');
  const iso = w && w.sun && (w.sun.sunset || w.sun.sunset_tomorrow);
  const ms = state.sun ? state.sun.sunsetMs : (iso ? Date.parse(iso) : null);
  if (!ms) return;

  const isTonight = state.sun ? state.sun.isTonight : (ms > Date.now());
  const box = el('div', 'ph-tonight');
  const left = el('div', 'ph-t-left');
  left.innerHTML =
    '<span class="eyebrow">' + (isTonight ? 'Tonight over the lake' : 'Tomorrow over the lake') + '</span>' +
    '<span class="ph-t-time">' + esc(clockOf(ms)) + '</span>' +
    '<span class="ph-t-sub">' +
      (state.sun ? esc(verdict(state.sun.score)) : 'Sunset') +
    '</span>';
  box.appendChild(left);

  if (state.sun) {
    const dial = el('div', 'ph-score');
    dial.innerHTML =
      '<span class="ph-score-n">' + state.sun.score.toFixed(1) + '</span>' +
      '<span class="ph-score-of">/10</span>';
    dial.style.setProperty('--fill', Math.max(0, Math.min(10, state.sun.score)) * 10 + '%');
    box.appendChild(dial);
  }
  root.appendChild(box);

  const note = el('p', 'ph-t-note');
  note.innerHTML = state.sun
    ? 'Same score the <a href="../sunset.html">Sunset Tracker</a> runs — clouds along tonight’s light path, and haze aloft.'
    : 'Score unavailable right now. The time is right.';
  root.appendChild(note);
}

/* Where to stand. Eight spots, ranked, with the walk from Church Street —
   the practical half of "go take a picture". */
function spotsRail(root) {
  const list = state.spots || [];
  if (!list.length) return;
  shelfHead(root, 'Where to stand', 'Walking time from the top of Church Street');
  const { track, sync } = rail(root, { label: 'sunset spots' });
  list.forEach((s) => {
    const card = el('div', 'ph-spot');
    card.innerHTML =
      '<span class="ph-spot-name">' + esc(s.name) + '</span>' +
      '<span class="ph-spot-meta">' + esc(s.area || '') +
        (s.walk_min ? ' · ' + s.walk_min + ' min walk' : '') + '</span>' +
      (s.why ? '<span class="ph-spot-why">' + esc(s.why) + '</span>' : '');
    if (Array.isArray(s.coords) && s.coords.length === 2) {
      const a = el('a', 'ph-spot-map', 'Open in Maps');
      a.href = 'https://maps.apple.com/?ll=' + s.coords[0] + ',' + s.coords[1] +
               '&q=' + encodeURIComponent(s.name);
      a.target = '_blank';
      a.rel = 'noopener';
      card.appendChild(a);
    }
    track.appendChild(card);
  });
  sync();
}

function photoTile(p, key) {
  const k = 'ph:' + (p.id || key);
  const tile = el('div', 'ph-tile');
  tile.dataset.k = k;
  const hit = el('button', 'ph-tile-hit');
  const img = el('img', 'ph-img');
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = p.caption || '';
  img.src = p.url;
  hit.appendChild(img);
  hit.addEventListener('click', () => openPhoto(p, k));
  tile.appendChild(hit);
  return tile;
}

function openPhoto(p, k) {
  app.sheet(p.credit ? 'By ' + p.credit : 'Photo', (body) => {
    const img = el('img', 'ph-full');
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.alt = p.caption || '';
    img.src = p.url;
    body.appendChild(img);
    if (p.caption) body.appendChild(el('p', 'ph-cap', esc(p.caption)));
    const bits = [];
    if (p.spot) bits.push(esc(p.spot));
    if (p.area) bits.push(esc(p.area));
    if (p.taken_on) bits.push(esc(p.taken_on));
    if (bits.length) body.appendChild(el('p', 'ph-meta', bits.join(' · ')));
    body.appendChild(el('p', 'ph-credit-line',
      p.credit ? 'Photo by ' + esc(p.credit) : 'Photo by a neighbour'));

    if (p.id && state.live) {
      const row = el('div', 'btns');
      const heart = el('button', 'btn btn-quiet',
        '♥ ' + (p.votes || 0) + (p._hearted ? ' — thanks' : ''));
      heart.addEventListener('click', () => {
        if (p._hearted) return;
        p._hearted = true;
        p.votes = (p.votes || 0) + 1;
        heart.textContent = '♥ ' + p.votes + ' — thanks';
        window.BTBP.vote(p.id, store.playerId()).catch(() => {});
      });
      row.appendChild(heart);
      body.appendChild(row);
    }
  });
}

/* ---------------------------------------------------------------- submit */

function submitSheet(preset) {
  app.sheet('Add a photo', (body, close) => {
    body.appendChild(el('p', 'ph-form-intro',
      'Taken by you, in or around Burlington. It gets resized on your phone before it uploads, so full size is fine.'));

    const form = el('form', 'm-form');
    const cats = (window.BTBP && window.BTBP.CATEGORIES) || [{ id: 'other', label: 'Everything else' }];
    const areas = (window.BTBP && window.BTBP.AREAS) || [];
    form.innerHTML =
      '<label>Your photo<input type="file" name="file" accept="image/*" required></label>' +
      '<label>What is it?<select name="category">' +
        cats.map((c) => '<option value="' + esc(c.id) + '"' +
          (c.id === (preset || 'sunsets') ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') +
      '</select></label>' +
      '<label>Where<select name="area">' +
        areas.map((a) => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join('') +
      '</select></label>' +
      '<label>Caption<input type="text" name="caption" maxlength="180" placeholder="A sentence is plenty"></label>' +
      '<details><summary>Add the exact spot, and your name</summary>' +
        '<label>Spot<input type="text" name="spot" maxlength="80" placeholder="e.g. the breakwater"></label>' +
        '<label>Your name<input type="text" name="credit" maxlength="60" placeholder="First name is plenty"></label>' +
      '</details>' +
      '<label class="m-form-check"><input type="checkbox" name="permission" required> I took it, and the Brief may use it.</label>' +
      '<label class="m-form-check"><input type="checkbox" name="ai"> It is AI-generated</label>' +
      '<button class="btn btn-big" type="submit">Send it in</button>' +
      '<p class="ph-form-note">Reviewed before it appears — usually within a day.</p>';

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const file = f.get('file');
      const btn = form.querySelector('button[type=submit]');
      if (!file || !file.size) return;
      btn.disabled = true;
      btn.textContent = 'Uploading…';
      window.BTBP.submit(file, {
        caption: (f.get('caption') || '').toString().trim(),
        category: f.get('category'),
        area: f.get('area'),
        spot: (f.get('spot') || '').toString().trim(),
        taken_on: '',
        credit: (f.get('credit') || '').toString().trim(),
        permission: !!f.get('permission'),
        ai: !!f.get('ai'),
      }).then(() => {
        close();
        app.toast('Sent. Thanks — we’ll look at it today.');
      }).catch((err) => {
        btn.disabled = false;
        btn.textContent = 'Send it in';
        const msg = form.querySelector('.ph-err') || el('p', 'ph-err');
        msg.textContent = (err && err.message) ? err.message : 'That didn’t send — try again in a minute.';
        form.appendChild(msg);
      });
    });
    body.appendChild(form);
  });
}

function addButton(root, preset, label) {
  const b = el('button', 'btn btn-big m-add', label);
  b.addEventListener('click', () => {
    script(LIB).then(() => submitSheet(preset))
      .catch(() => app.toast('Couldn’t open the uploader'));
  });
  root.appendChild(b);
}

/* ----------------------------------------------------------------- render */

export function render() {
  const root = state.root;
  if (!root) return;
  root.innerHTML = '';
  tabStamp(root, stampOf(data.peek('weather') && data.peek('weather').updated), 'photos, as they are approved');

  root.appendChild(seg([['sunsets', 'Sunsets'], ['all', 'Everything']],
    state.view, (v) => { state.view = v; render(); }));
  root.appendChild(el('div', null, '<div style="height:14px"></div>'));

  if (state.view === 'sunsets') renderSunsets(root);
  else renderAll(root);
}

function renderSunsets(root) {
  const mine = sunsets();
  const seeds = state.seeds || [];

  heading(root, {
    eyebrow: 'Burlington’s best habit',
    title: 'Sunsets',
    sub: 'The lake faces west and the whole city knows it. ' +
         '<span class="count">' + (mine.length + seeds.length) + ' on the wall</span>',
  });

  tonight(root);
  addButton(root, 'sunsets', 'Add tonight’s');
  spotsRail(root);

  shelfHead(root, 'On the wall', mine.length ? null : 'Starting with a few of Steve’s');
  const grid = el('div', 'ph-grid');
  mine.forEach((p) => grid.appendChild(photoTile(p)));
  /* The five committed sunset photos hold the wall until readers fill it.
     They are real Burlington sunsets, not placeholder art. */
  seeds.forEach((s, i) => grid.appendChild(photoTile({
    url: '../' + s.image, caption: s.caption, credit: s.credit,
  }, 'seed' + i)));
  root.appendChild(grid);

  if (!mine.length && !seeds.length) {
    root.appendChild(el('p', 'empty', 'Nothing here yet. Be the first.'));
  }
  potdStrip(root);
  hydrateVotes(root, [...root.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
}

/* Small, bottom, and labelled as somebody else's picture. */
function potdStrip(root) {
  loadPotd();
  const p = state.potd;
  if (!p) return;
  shelfHead(root, 'Elsewhere today', 'Wikipedia’s picture of the day');
  const box = el('div', 'ph-potd');
  const hit = el('button', 'ph-potd-hit');
  const img = el('img', 'ph-potd-img');
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  img.src = p.url;
  hit.appendChild(img);
  hit.addEventListener('click', () => openPhoto({
    url: p.full, caption: p.caption,
    credit: (p.credit || 'Wikimedia Commons') + (p.licence ? ' · ' + p.licence : ''),
  }, 'potd'));
  box.appendChild(hit);
  const meta = el('div', 'ph-potd-meta');
  meta.innerHTML =
    '<span class="ph-potd-cap">' + esc((p.caption || '').slice(0, 130)) + '</span>' +
    '<span class="ph-potd-by">' + esc(p.credit || 'Wikimedia Commons') +
      (p.licence ? ' · ' + esc(p.licence) : '') + '</span>';
  box.appendChild(meta);
  root.appendChild(box);
}

function renderAll(root) {
  const all = state.photos || [];

  heading(root, {
    eyebrow: 'Sent in by readers',
    title: 'Burlington, photographed',
    sub: '<span class="count">' + all.length +
         (all.length === 1 ? ' photo' : ' photos') + '</span> from around town.',
  });

  addButton(root, null, 'Add a photo');

  const cats = [...new Set(all.map((p) => p.category).filter(Boolean))];
  if (cats.length > 1) {
    const labels = Object.create(null);
    ((window.BTBP && window.BTBP.CATEGORIES) || []).forEach((c) => { labels[c.id] = c.label; });
    const chips = el('div', 'chips');
    chips.appendChild(chip('All', !state.cat, () => { state.cat = null; render(); }));
    cats.forEach((c) => chips.appendChild(
      chip(esc(labels[c] || c), state.cat === c,
        () => { state.cat = state.cat === c ? null : c; render(); })));
    root.appendChild(chips);
    scrollHint(chips);
  }

  const list = state.cat ? all.filter((p) => p.category === state.cat) : all;
  const grid = el('div', 'ph-grid');
  list.forEach((p) => grid.appendChild(photoTile(p)));
  root.appendChild(grid);

  if (!list.length) {
    root.appendChild(el('p', 'empty',
      state.photos === null ? 'Loading…' : 'No photos in that one yet.'));
  }
  potdStrip(root);
  hydrateVotes(root, [...root.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
}
