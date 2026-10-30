/* explore.js — Out · Explore (wave 1, 2026-10-29; APP-MAP.html rows 17 and 31).

   - Walks: the downtown walking tour, Out Loud's routes, and its audio pins,
     each playable in the shell's dock (data/out/app-walks.json, from
     out-loud/stories.json and data/walking-tour.json).
   - Then: Church Street address by address, what is there now and what was
     there before, each line with its source (data/out/app-then.json, from
     the Out data lane's history seed). Its Map button is the Living History
     Map: every pinned address on the street, its story in the pin's popup.
     The pins are the seed's own and OpenStreetMap's exact house-number
     matches (scripts/out/geocode_then.py). Leaflet and the tiles load on the
     tap, the way Food's map does, so the tab costs nothing until then.
   - Conditions: the beach tracker as the weather job last read it
     (data/weather/beaches.json), then the trail, park, ice and road sources
     a script can read today, then the ones a person has to check.
   - Dog parks: the fenced parks and dog beaches with their posted rules.

   On ?demo=1 every list is invented (data/demo/out-explore.json). */

import * as app from '../app.js';
import { outMode, readJSON, buttons } from './outkit.js';
import { el, esc, safeHref, button } from '../ui.js';

const FIRST = { walks: 12, then: 15 };
const open = { walks: false, then: false };
let mod = null;

const mmss = (s) => (s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '');
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/[\s,;:]+\S*$/, '') + '…' : s; };
const years = (t) => (t.from ? t.from + (t.to ? ' to ' + t.to : '') + ': ' : '');

/* ---------------------------------------------- the Living History Map */
const LEAFLET = {
  js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', jsSri: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', cssSri: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const STREET = [44.4772, -73.2125];   // the middle of Church Street, Main to Pearl
let leafletP = null;
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!leafletP) {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET.css; css.integrity = LEAFLET.cssSri; css.crossOrigin = '';
      css.dataset.leaflet = '1';
      document.head.appendChild(css);
    }
    leafletP = new Promise((resolve, reject) => {
      const js = document.createElement('script');
      js.src = LEAFLET.js; js.integrity = LEAFLET.jsSri; js.crossOrigin = '';
      js.onload = () => (window.L && window.L.map ? resolve(window.L) : reject(new Error('no Leaflet')));
      js.onerror = () => { leafletP = null; js.remove(); reject(new Error('no Leaflet')); };
      document.head.appendChild(js);
    });
  }
  return leafletP;
}
/* a pin's story: the address, what is there now, every dated line with its source */
function story(p) {
  return '<b>' + esc(p.address) + '</b>' + (typeof p.now === 'string' && p.now ? '<br>Now: ' + esc(p.now) : '') +
    p.timeline.slice().reverse().map((t) => '<br><a href="' + esc(safeHref(t.url)) + '" target="_blank" rel="noopener">' + esc(years(t) + t.what) + '</a>').join('');
}
let M = null;
function dropMap() { if (M) { try { M.remove(); } catch (e) { /* already gone */ } M = null; } }
function openMap(pinned) {
  app.sheet('Church Street, then', (body) => {
    const box = el('div', 'foodmap');
    box.dataset.k = 'then-map';
    body.appendChild(box);
    dropMap();
    loadLeaflet().then((L) => {
      if (!box.isConnected) return;
      const map = M = L.map(box, { zoomControl: true, attributionControl: true }).setView(STREET, 17);
      L.tileLayer(TILES, { maxZoom: 19, attribution: TILE_CREDIT }).addTo(M);
      pinned.forEach((p) => {
        const pin = L.circleMarker([p.lat, p.lng], { radius: 7, weight: 2, className: 'fm-pin open' }).addTo(M);
        pin.bindTooltip(esc(p.address));
        pin.bindPopup(story(p), { maxWidth: 260 });
      });
      setTimeout(() => { if (M === map && box.isConnected) map.invalidateSize(); }, 80);
    }).catch(() => { if (box.isConnected) box.replaceWith(el('p', 'note pad', esc('The map didn’t load.'))); });
  });
}
/* the button's picture is the street itself: a dot per pinned address, no tiles, no library */
function mapButton(pinned) {
  const W = 72, H = 44, halfLat = 0.0042, halfLon = halfLat / Math.cos(STREET[0] * Math.PI / 180) * W / H;
  const dots = pinned.map((p) => '<circle class="fm-dot" r="2" cx="' + (W / 2 + (p.lng - STREET[1]) / halfLon * W / 2).toFixed(1) + '" cy="' + (H / 2 - (p.lat - STREET[0]) / halfLat * H / 2).toFixed(1) + '"/>').join('');
  const b = el('button', 'mapbtn', '<svg class="fm-mini" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><rect class="fm-ground" width="' + W + '" height="' + H + '"/>' +
    '<path class="fm-street" d="M' + W / 2 + ' 0V' + H + '"/>' + dots + '</svg><span>' + esc('Map') + '</span>');
  b.setAttribute('aria-label', 'Map of ' + pinned.length + ' addresses');
  b.addEventListener('click', () => openMap(pinned));
  return b;
}

const BEACH = { open: 'Open', closed: 'Closed', advisory: 'Advisory', unknown: 'Not sampled now' };

async function load(demo) {
  const d = demo ? await readJSON(null, 'out-explore.json') : null;
  const [W, T, C, B] = d ? [d.walks, d.then, d.conditions, d.beaches] : await Promise.all([
    readJSON('../data/out/app-walks.json'), readJSON('../data/out/app-then.json'),
    readJSON('../data/out/conditions-sources.json'), readJSON('../data/weather/beaches.json').catch(() => null),
  ]);

  /* Walks */
  const tour = W.tour || {};
  const lead = [{ k: 'wk-tour', kind: 'post', src: 'Btown Brief', sid: 'out-walks', own: true, title: tour.name || 'A downtown walking tour', href: '../walking-tour.html',
    text: tour.stops && tour.stops.length ? tour.stops.length + ' stops, ' + tour.stops[0].title + ' to ' + tour.stops[tour.stops.length - 1].title : '' }]
    /* a route that is the walking tour itself shows once, as the tour */
    .concat((W.routes || []).filter((r) => (r.pins || []).join() !== (tour.stops || []).map((x) => x.id).join()).map((r) => ({ k: 'wk-' + r.id, kind: 'post', src: 'Out Loud', sid: 'out-loud', title: r.title, href: '../out-loud/',
      text: short(r.blurb, 160) })));
  const pins = (W.pins || []).filter((p) => p.audio).map((p) => ({
    k: 'ol-' + p.id, kind: 'audio', src: 'Out Loud', sid: 'out-loud', show: 'Out Loud', title: p.title, why: p.tease, href: '../out-loud/',
    src_audio: '../out-loud/' + p.audio, dur: mmss(p.secs), media: 'paper',
  }));
  const secs = [{
    key: 'walks', label: 'Walks',
    items: lead.concat(open.walks ? pins : pins.slice(0, FIRST.walks)),
    draw(box) { buttons(box, [!open.walks && pins.length > FIRST.walks ? button('All ' + pins.length + ' stories', 'ghost sm', () => { open.walks = true; mod.reload(); }) : null]); },
  }];

  /* Then */
  const places = (T.places || []).filter((p) => p.timeline && p.timeline.length);
  const thenItems = places.map((p) => {
    const tl = p.timeline;
    const last = tl.slice(-3).reverse();
    return { k: 'th-' + p.id, kind: 'post', src: p.kind === 'block' ? 'Church Street' : 'Church St', sid: 'out-then', title: p.address + (typeof p.now === 'string' && p.now ? ' · now ' + p.now : ''),
      text: last.map((t) => years(t) + t.what).join('. ') + '.',
      href: tl[tl.length - 1].url };
  });
  const pinned = places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  secs.push({
    key: 'then', label: 'Then', right: pinned.length ? () => mapButton(pinned) : null,
    items: open.then ? thenItems : thenItems.slice(0, FIRST.then),
    draw(box) { buttons(box, [!open.then && thenItems.length > FIRST.then ? button('All ' + thenItems.length + ' addresses', 'ghost sm', () => { open.then = true; mod.reload(); }) : null]); },
  });

  /* Conditions */
  const srcs = (C.sources || []).filter((s) => s.url);
  const readable = new Set(((C.counts || {}).machine_readable_ids) || []);
  const tracker = srcs.find((s) => s.id === 'btv-beach-tracker');
  const bl = (B && B.beaches) || [];
  const allQuiet = bl.length && bl.every((b) => b.status === 'unknown');
  const beachItems = allQuiet
    ? [{ k: 'cd-beaches', kind: 'post', src: 'Burlington beach tracker', sid: 'out-beaches', title: 'Beach season is over', href: (tracker && tracker.url) || '../beaches.html',
      text: 'Testing resumes in June.' }]
    : bl.map((b) => ({ k: 'cd-b-' + b.name.toLowerCase().replace(/\W+/g, '-'), kind: 'post', src: 'Burlington beach tracker', sid: 'out-beaches', live: b.status === 'open',
      title: b.name + ': ' + (BEACH[b.status] || cap(b.status)), href: (tracker && tracker.url) || '../beaches.html',
      text: [b.reason, b.ecoli != null ? 'E. coli ' + b.ecoli : '', b.sampled ? 'sampled ' + b.sampled : ''].filter(Boolean).join(' · ') }));
  const srcItem = (s) => ({ k: 'cd-' + s.id, kind: 'post', src: s.owner || s.name, sid: 'out-cd-' + s.id, title: s.name, href: s.url,
    text: cap(short((s.covers || []).slice(0, 4).join(', '), 140)) });
  secs.push({
    key: 'conditions', label: 'Conditions',
    items: beachItems.concat(srcs.filter((s) => readable.has(s.id) && s.id !== 'btv-beach-tracker').map(srcItem), srcs.filter((s) => !readable.has(s.id) && s.id !== 'btv-beach-tracker').map(srcItem)),
  });

  /* Dog parks */
  const dogs = (C.dog_parks || []).filter((p) => p.source_url || p.url).map((p) => ({
    k: 'dg-' + p.id, kind: 'post', src: p.town || 'Dog park', sid: 'out-dogs', title: p.name, href: p.source_url || p.url,
    text: [cap(p.kind), p.hours, p.season, p.leash_rule].filter(Boolean).join('. ') + '.',
  }));
  secs.push({ key: 'dogs', label: 'Dog parks', items: dogs });
  return secs;
}

mod = outMode({ key: 'explore', label: 'Explore', icon: 'pin', promise: 'Walks, old stories on every corner, and the trail report.', load, leave: dropMap });
app.register('explore', mod);
