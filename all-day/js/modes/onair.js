/* On Air: everything in All Day that you watch or listen to, replacing the
   old Watch (Btown TV) and Listen (podcasts) tabs. Top to bottom:

   - The Brief, out loud: a three-minute audio brief written from the Wire's
     top local picks every morning at 7 (scripts/build_wire_audio.py, on the
     wire-audio branch). Today's clip when there is one, otherwise the most
     recent with its date, otherwise no card at all.
   - Btown TV tonight: the nightly curated edition (scripts/curate_tv.py, on
     the btown-tv branch). On Local, the pick and the Burlington & Vermont
     shelf with the reason under each; on Everything, three more from the
     wider shelf. Watched / not for me / more like this write to the same key
     tv.html used, so they still teach tomorrow's edition; "not for me" swaps
     in the editor's next one from the bench on the next draw.
   - Live: the always-on cameras, smaller, because a lake at night is not
     competing with a documentary.
   - Podcasts: the Brief's own show first, always; then every local show
     (pulse.json sources with pod === 1), newest episode first, each a row
     that opens in place; on Everything, two shows from away as well.
   - Past nights: the last two weeks of editions (tv-editions.json).

   All sound goes through the shell's one player and the one video box;
   nothing autoplays. The Brief's own show is on Spotify only, so its
   episodes open Spotify's embed in place, built once and never rebuilt
   (rebuilding the frame is what silently stops playback), and registered
   with the shell so any other sound stops it.

   ?demo=1 runs exactly this file on data/demo/onair.json, which holds the
   same five payloads in the real shapes, re-dated to the reader's clock. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, art, section, rail, chips, button, divider, cards, put, localSwitch, geo, setGeo, agoShort } from '../ui.js';

const KEY = 'onair';
const WIDER = 3;            // picks from the wider shelf on Everything (DESIGN.md §0b, round two)
const NATIONAL = 2;         // shows from away on Everything
const PAST_DAYS = 14;       // Past nights reaches back two weeks
const EPISODES_OPEN = 5;    // a show opens in place to its newest five
const LOCAL_SHELF = 'vt';   // curate_tv.py's "Burlington & Vermont" shelf
const WIDER_ORDER = ['quick', 'settle', 'vault', 'gold', 'bench'];
const BRIEF_ART = '../assets/icon-192.png';
const SHOW_ART = '../assets/btown-arts-cover.jpg';
const PLAYLIST_RE = /^https:\/\/www\.youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const CLIP_FILE = /^\d{4}-\d{2}-\d{2}\.(mp3|txt)$/;

const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const words = (n) => NUMBER[n] || String(n);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const arr = (v) => (Array.isArray(v) ? v : []);

/* --------------------------------------------------------------- clock */
/* Burlington's day, not the reader's (the Wire's rule). */
const TZ = 'America/New_York';
const keyFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const nameFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
function etDay(ms) {
  const o = {};
  keyFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return o.year + '-' + o.month + '-' + o.day;
}
const todayKey = () => etDay(Date.now());
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const utcNoon = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const dayName = (date) => nameFmt.format(utcNoon(date));            // "Thursday, October 15"
const weekday = (date) => dayName(date).split(',')[0];
const addDays = (date, n) => { const t = utcNoon(date); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const clock = (ms) => timeFmt.format(new Date(ms)).replace(/\s+/g, ' ').toLowerCase();
const mmss = (s) => { const n = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
/* "Thursday night" for an edition built the evening of its date */
const nightOf = (date) => (date === addDays(todayKey(), -1) ? 'Last night' : weekday(date) + ' night');

/* ------------------------------------------------------------- sources */
/* The five payloads, from the data layer or from the demo file. */
const FEEDS = ['tv', 'tvEditions', 'pulse', 'podcast', 'audio'];
let demoP = null;
function load(key, ok, fail) {
  if (!app.demo) { data.load(key, ok, fail); return; }
  if (!demoP) demoP = app.demoData(KEY).then(redate);
  demoP.then((d) => (d[key] ? ok(d[key]) : fail()), fail);
}
const clipUrl = (file) => (app.demo ? '#onair/brief' : data.audioUrl(file));

/* The demo file is written on 2026-10-16; move every date and timestamp by
   however long ago that was, so "today" and "2h" mean today and two hours. */
function redate(d) {
  const anchor = String(d._anchor || '2026-10-16');
  const days = Math.round((utcNoon(todayKey()) - utcNoon(anchor)) / 86400000);
  const secs = days * 86400;
  const shiftV = (v) => { if (v && Number(v.d)) v.d = Number(v.d) + secs; };
  const tv = d.tv || {};
  if (isDate(tv.edition)) tv.edition = addDays(tv.edition, days);
  if (tv.generated) tv.generated = new Date(Date.parse(tv.generated) + secs * 1000).toISOString();
  [tv.pick, ...arr(tv.pick_more), ...arr(tv.live)].forEach(shiftV);
  arr(tv.shelves).forEach((s) => [...arr(s.items), ...arr(s.more)].forEach(shiftV));
  arr(d.tvEditions && d.tvEditions.editions).forEach((e) => {
    if (isDate(e.edition)) e.edition = addDays(e.edition, days);
    if (e.generated) e.generated = new Date(Date.parse(e.generated) + secs * 1000).toISOString();
  });
  arr(d.pulse && d.pulse.items).forEach(shiftV);
  arr(d.audio && d.audio.clips).forEach((c) => {
    if (isDate(c.date)) c.date = addDays(c.date, days);
    if (c.made) c.made = new Date(Date.parse(c.made) + secs * 1000).toISOString();
  });
  return d;
}

/* ----------------------------------------------------------------- state */
const O = {
  root: null, slots: null, built: false,
  tv: null, tvEditions: null, pulse: null, podcast: null, audio: null,
  settled: Object.create(null), failed: Object.create(null),
  open: Object.create(null),   // show id -> opened in place
  pending: null,
  own: null,                   // the Brief's own show: built once, never rebuilt
};

/* TV reactions: the store's (tv.html's key, and the Supabase calls that
   teach the editor), or, in the demo, a map that lives for the visit. */
const demoReacts = Object.create(null);
const reacts = () => (app.demo ? demoReacts : store.tvReacts());
function react(v, kind) {
  if (!app.demo) return store.tvReact(v.id, kind, v.t, v.ch);
  if (demoReacts[v.id] === kind) delete demoReacts[v.id]; else demoReacts[v.id] = kind;
  return demoReacts[v.id] || null;
}
const skipped = (v) => reacts()[v && v.id] === 'skip';

/* ------------------------------------------------------------- the clip */
/* Today's clip, or the newest one before today, or null. */
function currentClip() {
  const tk = todayKey();
  const clips = arr(O.audio && O.audio.clips)
    .filter((c) => c && isDate(c.date) && c.date <= tk && CLIP_FILE.test(String(c.file || '')))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return clips[0] || null;
}

function clipItem(c) {
  const today = c.date === todayKey();
  const mins = Math.max(1, Math.round((Number(c.duration) || 0) / 60));
  return {
    k: 'brief:' + c.date, kind: 'audio', src: 'The Brief', sid: 'btown-brief', show: 'The Brief, out loud',
    title: weekday(c.date) + '’s news in ' + words(mins) + (mins === 1 ? ' minute' : ' minutes'),
    text: String(c.teaser || ''), media: BRIEF_ART, dur: c.duration ? mmss(c.duration) : '',
    src_audio: clipUrl(c.file), href: clipUrl(c.file),
    when: (today ? 'Today' : dayName(c.date)) + (c.made && today ? ' · ' + clock(Date.parse(c.made)) : '') + (c.duration ? ' · ' + mmss(c.duration) : ''),
    script: CLIP_FILE.test(String(c.script || '')) ? c.script : '',
  };
}

/* ------------------------------------------------------------ the videos */
const isLocalVideo = (v) => !!v && (!!v.vt || v.g === 'vt' || v.shelf === LOCAL_SHELF);
/* Live on Local is cameras around here: a stream on the Vermont shelf, or
   one on the pinned live roster (scripts/refresh_youtube.py LIVE_ROSTER),
   which the data marks cam: 1. PINNED_LIVE is the roster as it was when this
   was written, for a btown-tv.json made before cam existed. The live search
   also matches "Vermont" in titles like "Peaceful Autumn Village in Vermont
   with Relaxing Jazz"; the pipeline now drops those, and anything that reads
   as music or ambience is still never shown, on either side of the switch. */
const PINNED_LIVE = new Set(['zl1woMXGGmQ']);   // Church Street Market Place
const AMBIENCE_RE = /\b(jazz|lo-?fi|relaxing|ambient|ambience|sleep|study)\b|\bcaf[eé](?![a-z])/i;
const isAmbience = (v) => AMBIENCE_RE.test(String(v && v.t || ''));
const isLocalCam = (v) => !!v && (v.cam === 1 || isLocalVideo(v) || PINNED_LIVE.has(v.id));
const shelvesOf = (tv) => arr(tv && tv.shelves).filter((s) => s && typeof s === 'object');

function videoItem(v, opts = {}) {
  if (!v || !app.isVideoId(v.id) || !v.t) return null;
  const live = opts.live || v.dur === 'LIVE';
  return {
    k: 'yt:' + v.id, kind: 'video', yt: v.id, title: String(v.t), src: String(v.ch || 'YouTube'), sid: 'yt:' + String(v.ch || ''),
    href: 'https://www.youtube.com/watch?v=' + v.id,
    media: app.demo && v.art ? v.art : 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg',
    dur: !live && v.dur ? String(v.dur) : '', why: String(v.why || ''), local: isLocalVideo(v), live,
    ago: !live && Number(v.d) ? agoShort(v.d) : '', v,
  };
}

/* Tonight's local list: the pick when it is from here, the Burlington &
   Vermont shelf, then anything local on the other shelves. A video the
   reader said "not for me" to gives its place to the editor's next local
   one from the bench; with no bench left it stays, marked. */
function localTonight(tv) {
  const seen = new Set();
  const fresh = (v) => v && app.isVideoId(v.id) && !seen.has(v.id) && (seen.add(v.id), true);
  const shelves = shelvesOf(tv);
  const vt = shelves.filter((s) => s.key === LOCAL_SHELF || s.title === 'Burlington & Vermont');
  const rest = shelves.filter((s) => !vt.includes(s));
  const list = [];
  if (isLocalVideo(tv.pick) && fresh(tv.pick)) list.push(tv.pick);
  vt.forEach((s) => arr(s.items).forEach((v) => { if (fresh(v)) list.push(v); }));
  rest.forEach((s) => arr(s.items).forEach((v) => { if (isLocalVideo(v) && fresh(v)) list.push(v); }));
  const bench = arr(tv.pick_more).filter(isLocalVideo)
    .concat(vt.flatMap((s) => arr(s.more)), rest.flatMap((s) => arr(s.more).filter(isLocalVideo)))
    .filter((v) => fresh(v));
  return list.map((v) => {
    if (!skipped(v)) return { v, swapped: false };
    const i = bench.findIndex((b) => !skipped(b));
    return i >= 0 ? { v: bench.splice(i, 1)[0], swapped: true } : { v, swapped: false };
  });
}

/* Three from the wider shelf: the edition's pick when it is not local,
   then the top of each shelf in the order a phone reads best. */
function widerTonight(tv, taken) {
  const seen = new Set(taken.map((x) => x.v.id));
  const ok = (v) => v && app.isVideoId(v.id) && !isLocalVideo(v) && !skipped(v) && !seen.has(v.id);
  const out = [];
  const add = (v) => { if (out.length < WIDER && ok(v)) { out.push({ v, swapped: false }); seen.add(v.id); } };
  add(tv.pick);
  if (skipped(tv.pick)) arr(tv.pick_more).forEach(add);
  const shelves = shelvesOf(tv);
  const ordered = WIDER_ORDER.map((k) => shelves.find((s) => s.key === k)).filter(Boolean)
    .concat(shelves.filter((s) => !WIDER_ORDER.includes(s.key) && s.key !== LOCAL_SHELF));
  for (let round = 0; out.length < WIDER && round < 4; round++) ordered.forEach((s) => add(arr(s.items).filter(ok)[0]));
  return out;
}

const editionCount = (ed) => (ed.pick ? 1 : 0) + shelvesOf(ed).reduce((n, s) => n + arr(s.items).length, 0);
const playlistOf = (ed) => { const u = ed && ed.playlist && ed.playlist.url; return u && PLAYLIST_RE.test(u) ? u : null; };

/* ------------------------------------------------------------ the shows */
function shows() {
  const P = O.pulse;
  if (!P) return [];
  const muted = store.muted();
  const by = Object.create(null);
  arr(P.sources).forEach((s) => {
    if (!s || s.pod !== 1 || !s.id || muted[s.id]) return;
    by[s.id] = { id: s.id, name: String(s.short || s.name || s.id), site: s.site || '', local: s.local === 1 || s.topic === 'local', eps: [] };
  });
  arr(P.items).forEach((it) => { if (it && it.a && it.t && by[it.s]) by[it.s].eps.push(it); });
  const list = Object.values(by).filter((s) => s.eps.length);
  list.forEach((s) => {
    s.eps.sort((a, b) => (Number(b.d) || 0) - (Number(a.d) || 0));
    s.art = (s.eps.find((e) => e.i) || {}).i || '';
  });
  /* who published last goes first: freshness is the whole question */
  return list.sort((a, b) => (Number(b.eps[0].d) || 0) - (Number(a.eps[0].d) || 0));
}

function episodeItem(ep, s) {
  return { k: String(ep.a), kind: 'audio', title: String(ep.t), show: s.name, src: s.name, sid: s.id,
    media: ep.i || s.art || '', src_audio: String(ep.a), href: ep.u || ep.a, ago: Number(ep.d) ? agoShort(ep.d) : '' };
}

/* ---------------------------------------------------------------- draw */
const sec = (host, title, sub, key, right) => { const s = section(host, title, sub, right); if (key) s.dataset.sec = key; return s; };

function vcard(it, w, opts = {}) {
  const c = el('article', 'vcard ' + w);
  c.dataset.k = it.k;
  const meta = [it.src, it.live ? '' : it.ago].filter(Boolean).join(' · ');
  c.innerHTML = '<span class="c-media r169" data-play role="button" tabindex="0" aria-label="Play ' + esc(it.title) + '">' + art(it.media) +
    '<span class="play">' + ICON.play + '</span>' + (it.dur ? '<span class="dur">' + esc(it.dur) + '</span>' : '') +
    (it.live ? '<span class="tag tag-live on-pic">Live</span>' : '') + '</span>' +
    (opts.swapped ? '<span class="s">Stepped in for one you passed on</span>' : '') +
    '<span class="t">' + esc(it.title) + '</span>' + (it.why ? '<span class="s">' + esc(it.why) + '</span>' : '') +
    (meta ? '<span class="s">' + esc(meta) + '</span>' : '') + (opts.react ? reactRow(it) : '');
  return c;
}

/* the three signals that teach tomorrow's edition, then share and save */
const REACTS = [['watched', ICON.check, 'Watched'], ['skip', ICON.x, 'Not for me'], ['more', ICON.plus, 'More like this']];
function reactRow(it) {
  const mine = reacts()[it.yt];
  const saved = store.isSaved(it.k);
  return '<div class="c-acts">' + REACTS.map(([kind, icon, label]) =>
    '<button class="act' + (mine === kind ? ' on' : '') + '" data-react="' + kind + '" aria-label="' + label + '" title="' + label + '" aria-pressed="' + (mine === kind) + '">' + icon + '</button>').join('') +
    '<button class="act sh" data-act="share" aria-label="Share">' + ICON.share + '</button><span class="sp"></span>' +
    '<button class="act star' + (saved ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + saved + '">' + ICON.star + '</button></div>';
}
const SAID = {
  watched: 'Marked watched. Tomorrow’s edition learns from it.',
  skip: 'Not for you. The editor’s next one takes its place.',
  more: 'More like this. Tomorrow’s edition will know.',
};

function wave() {
  return '<div class="wave" aria-hidden="true">' + Array.from({ length: 40 }, (_, i) =>
    '<i style="height:' + (6 + Math.round(10 * Math.abs(Math.sin(i * 0.7)) + 8 * Math.abs(Math.cos(i * 0.3)))) + 'px"></i>').join('') + '</div>';
}

function drawBrief(host) {
  const c = currentClip();
  if (!c) return false;
  const it = clipItem(c);
  app.know([it]);
  sec(host, 'The Brief, out loud', '', 'brief');
  const au = el('div', 'audio');
  au.dataset.k = it.k;
  au.innerHTML = '<button class="pb" data-pk="' + esc(it.k) + '" aria-label="Play the Brief, out loud">' + ICON.play + '</button><div><div class="eyebrow">' + esc(it.when) + '</div><h3>' +
    esc(it.title) + '</h3><p>' + esc((it.text ? it.text + ' ' : '') + 'Read to you every morning at 7.') + '</p></div>' + wave();
  au.querySelector('.pb').addEventListener('click', () => app.play(it));
  host.appendChild(au);
  if (it.script) host.appendChild(button('Read it instead', 'ghost more', () => readScript(it, c)));
  return true;
}

/* the script the voice read, as text: the transcript, for reading or for anyone who cannot listen.
   The script carries pacing marks for the voice ([pause], [softly]: build_wire_audio.py TAGS),
   which are direction, never words, so the reader never sees them. */
const PACING_RE = /[ \t]*\[[a-z ]{1,20}\][ \t]*/g;
function readScript(it, c) {
  app.sheet(it.title, (body) => {
    const t = el('div', 'script');
    body.appendChild(t);
    const show = (text) => {
      t.innerHTML = '';
      String(text || '').replace(PACING_RE, ' ').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).forEach((p, i) => {
        if (i) t.appendChild(el('div', 'spacer'));
        t.appendChild(el('p', '', esc(p)));
      });
    };
    if (app.demo) { show(O.audio._script || ''); return; }
    t.textContent = 'Loading…';
    data.fetchText(data.audioUrl(c.script), 8000).then(show, () => { t.textContent = 'The script didn’t load. Try again in a minute.'; });
  });
}

function drawTV(host) {
  const tv = O.tv;
  if (!tv || !(tv.pick || shelvesOf(tv).length)) return false;
  const every = geo() === 'everything';
  const ed = isDate(tv.edition) ? tv.edition : '';
  const night = !ed || ed >= todayKey() ? 'Tonight' : nightOf(ed);
  const when = night + '’s edition';
  const local = localTonight(tv);
  const wider = every ? widerTonight(tv, local) : [];
  sec(host, every ? 'Tonight, local and beyond' : 'Btown TV tonight', '', 'tv');
  drawTVPlay(host, tv, night);
  const list = local.concat(wider.map((x) => ({ ...x, wider: true })));
  if (list.length) {
    const r = rail(host);
    const items = [];
    list.forEach((x) => {
      const it = videoItem(x.v);
      if (!it) return;
      items.push(it);
      const c = vcard(it, 'w250', { react: true, swapped: x.swapped });
      if (x.wider) c.dataset.wider = '1';
      r.appendChild(c);
    });
    app.know(items);
  } else {
    host.appendChild(el('p', 'note pad', esc('No local picks ' + said(night) + '.')));
  }
  const n = editionCount(tv);
  if (n) host.appendChild(button(esc('The whole edition · ' + plural(n, 'video', 'videos')), 'ghost more', () => editionSheet(tv, when)));
  return true;
}

function drawLive(host) {
  const live = arr(O.tv && O.tv.live).filter((v) => v && app.isVideoId(v.id) && !isAmbience(v) && (geo() === 'everything' || isLocalCam(v)));
  if (!live.length) return false;
  sec(host, 'Live', '', 'live');
  const r = rail(host);
  const items = live.map((v) => videoItem(v, { live: true })).filter(Boolean);
  items.forEach((it) => r.appendChild(vcard(it, 'w220')));
  app.know(items);
  return true;
}

/* Play the night on your TV, on the tab face (it lived only in the edition's
   sheet, and the old Watch tab had it filled under its masthead: sending the
   whole night to a TV is the best thing Btown TV does). Tonight's playlist,
   or, when tonight's did not publish (a dropped upload has done it), a quiet
   link to the most recent past night that has one, said plainly. */
function drawTVPlay(host, tv, night) {
  const row = el('div', 'linkrow tvplay');
  const url = playlistOf(tv);
  if (url) {
    row.appendChild(playLink(url, 'Play ' + said(night) + ' on your TV', 'btn', 'tonight'));
  } else {
    const prev = arr(O.tvEditions && O.tvEditions.editions)
      .filter((e) => e && isDate(e.edition) && e.edition !== tv.edition && playlistOf(e))
      .sort((a, b) => (a.edition < b.edition ? 1 : -1))[0];
    if (!prev) return;
    row.appendChild(playLink(playlistOf(prev), 'Play ' + said(nightOf(prev.edition)) + ' on your TV', 'btn ghost', 'past'));
    row.appendChild(el('span', 'note', esc(night + '’s playlist isn’t up yet')));
  }
  host.appendChild(row);
}

const said = (night) => (/^(Tonight|Last night)$/.test(night) ? night.toLowerCase() : night);   // mid-sentence: “Play tonight”, “Play Friday night”

function playLink(url, label, cls, which) {
  const a = el('a', cls, ICON.play + ' ' + esc(label) + ' ' + ICON.ext);
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  a.dataset.tvplay = which;
  a.title = 'Opens the playlist in YouTube: cast it, or open it on your TV';
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the night’s YouTube playlist in the real build'); });
  return a;
}

/* One edition, in a sheet: the pick and every shelf, as video cards that
   play in the shell's video box, and the night's YouTube playlist for a TV. */
function editionSheet(ed, title) {
  const every = geo() === 'everything';
  app.sheet(title, (body) => {
    const url = playlistOf(ed);
    if (url) {
      const row = el('div', 'linkrow');
      const a = el('a', 'btn', ICON.play + ' Play it on your TV ' + ICON.ext);
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the night’s YouTube playlist in the real build'); });
      row.appendChild(a);
      body.appendChild(row);
    }
    const groups = [];
    if (ed.pick) groups.push({ title: 'The pick', items: [ed.pick] });
    shelvesOf(ed).forEach((s) => groups.push({ title: String(s.title || 'Shelf'), sub: String(s.sub || ''), items: arr(s.items) }));
    const known = [];
    groups.forEach((g) => {
      const vids = g.items.filter((v) => v && app.isVideoId(v.id));
      const shown = every ? vids : vids.filter(isLocalVideo);
      if (!shown.length) return;
      body.appendChild(el('div', 'sheet-h', esc(g.title) + (g.sub ? ' · <span>' + esc(g.sub) + '</span>' : '')));
      const f = el('div', 'feed tight');
      shown.forEach((v) => { const it = videoItem(v); if (it) { known.push(it); put(f, cards.video(it, { noComments: true })); } });
      body.appendChild(f);
    });
    app.know(known);
    if (!known.length) body.appendChild(el('p', 'sheet-note', 'Nothing filmed here that night.'));
    app.bindFeed(body, {});
  });
}

/* --------------------------------------------------------------- podcasts */
function showRow(s, opts = {}) {
  const ep = s.eps[0];
  const latest = episodeItem(ep, s);
  app.know([latest]);
  const r = el('div', 'lrow');
  r.dataset.k = 'pod:' + s.id;
  r.dataset.show = s.id;
  if (opts.national) r.dataset.national = '1';
  r.setAttribute('role', 'button');
  r.tabIndex = 0;
  r.setAttribute('aria-expanded', O.open[s.id] ? 'true' : 'false');
  r.innerHTML = '<span class="th">' + (s.art ? art(s.art) : '') + '</span><div><div class="t">' + esc(s.name) + '</div><div class="s">' +
    esc(ep.t) + (latest.ago ? ' · ' + esc(latest.ago) : '') + '</div></div>';
  const b = el('button', 'pillbtn', ICON.play + ' Latest');
  b.dataset.pk = latest.k;
  b.dataset.label = 'Latest';
  b.setAttribute('aria-label', 'Play the latest ' + s.name);
  b.addEventListener('click', (e) => { e.stopPropagation(); app.play(latest); });
  r.appendChild(b);
  return r;
}

/* a show opened in place: its newest five, each with a play pill, then its own page */
function showEpisodes(s) {
  const box = el('div', 'eps');
  box.dataset.eps = s.id;
  const items = s.eps.slice(0, EPISODES_OPEN).map((ep) => episodeItem(ep, s));
  app.know(items);
  items.forEach((it) => {
    const at = store.heardAt(it.k);
    const r = el('div', 'lrow');
    r.dataset.k = it.k;
    r.innerHTML = '<span class="th bare">' + ICON.listen + '</span><div><div class="t">' + esc(it.title) + '</div><div class="s">' +
      esc([it.ago, at > 30 ? Math.round(at / 60) + ' min in' : ''].filter(Boolean).join(' · ')) + '</div></div>';
    const b = el('button', 'pillbtn', ICON.play + ' Play');
    b.dataset.pk = it.k;
    b.dataset.label = 'Play';
    b.setAttribute('aria-label', 'Play ' + it.title);
    b.addEventListener('click', () => app.play(it));
    r.appendChild(b);
    box.appendChild(r);
  });
  if (/^https?:/i.test(s.site)) {
    const a = el('a', 'btn ghost more', esc(s.name) + '’s own page ' + ICON.ext);
    a.href = safeHref(s.site); a.target = '_blank'; a.rel = 'noopener';
    if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the show’s page in the real build'); });
    box.appendChild(a);
  }
  return box;
}

/* The Brief's own show. Built once: its Spotify frames must never be
   rebuilt, so a switch flip or a refresh redraws around it, not through it. */
function ownShow() {
  const P = O.podcast;
  const eps = arr(P && P.episodes).filter((e) => e && e.title && (SPOTIFY_ID.test(String(e.id || '')) || /^https?:/i.test(String(e.url || ''))));
  if (!eps.length) return null;
  const wrap = el('div', 'own');
  const name = String(P.show || 'Btown Arts Presents');
  const r = el('div', 'lrow');
  r.dataset.k = 'pod:btown-brief';
  r.dataset.show = 'btown-brief';
  r.setAttribute('role', 'button');
  r.tabIndex = 0;
  r.setAttribute('aria-expanded', 'false');
  r.innerHTML = '<span class="th">' + art(SHOW_ART) + '</span><div><div class="t">' + esc(name) + '</div><div class="s"><span class="tag tag-own">Btown Brief</span> ' +
    esc('Our own show · ' + plural(eps.length, 'episode', 'episodes') + (isDate(eps[0].date) ? ' · newest ' + dayName(eps[0].date).split(', ')[1] : '')) + '</div></div>';
  const pill = el('button', 'pillbtn', ICON.play + ' Episodes');
  pill.setAttribute('aria-label', 'Open the episodes of ' + name);
  r.appendChild(pill);
  const list = el('div', 'eps');
  list.hidden = true;
  eps.forEach((e) => {
    const row = el('div', 'lrow');
    row.dataset.k = 'ep:' + (e.id || e.url);
    row.innerHTML = '<span class="th bare">' + ICON.listen + '</span><div><div class="t">' + esc(e.title) + '</div><div class="s">' +
      esc(isDate(e.date) ? dayName(e.date) : '') + '</div></div>';
    const b = el('button', 'pillbtn', ICON.play + ' Play');
    b.setAttribute('aria-label', 'Play ' + e.title);
    const holder = el('div', 'embed-slot');
    b.addEventListener('click', () => {
      if (!SPOTIFY_ID.test(String(e.id || ''))) {
        /* hand-added before Spotify filled the file in: no embed, so send it out */
        if (app.demo) app.toast('Opens the episode on Spotify in the real build');
        else window.open(safeHref(e.url), '_blank', 'noopener');
        return;
      }
      let frame = holder.querySelector('iframe');
      if (!frame) {
        if (app.demo) { app.toast('Opens Spotify’s player for this episode in the real build'); return; }
        app.stop();
        app.closeVideo();
        frame = el('iframe', 'embed spotify');
        frame.title = e.title;
        frame.loading = 'lazy';
        frame.allow = 'clipboard-write; encrypted-media; fullscreen; picture-in-picture';
        frame.src = 'https://open.spotify.com/embed/episode/' + encodeURIComponent(e.id) + '?theme=0';
        holder.appendChild(frame);
        registerEmbed(frame);
      } else holder.hidden = !holder.hidden;
    });
    row.appendChild(b);
    list.append(row, holder);
  });
  /* Enter and space reach this through the tab's keydown handler */
  r.addEventListener('click', () => { list.hidden = !list.hidden; r.setAttribute('aria-expanded', list.hidden ? 'false' : 'true'); });
  wrap.append(r, list);
  return wrap;
}

/* The shell's one-sound rule: Spotify's embed has no pause API, so the stop
   is a reload of the frame, and a frame that has left the page unregisters
   at its first silence call. */
function registerEmbed(frame) {
  const unreg = app.registerForeign(() => {
    if (!frame.isConnected) { unreg(); return; }
    const src = frame.getAttribute('src');
    if (!src) return;
    frame.removeAttribute('src');
    frame.setAttribute('src', src);
  });
}

function drawPodsHead(host) {
  const every = geo() === 'everything';
  sec(host, every ? 'Podcasts' : 'Local podcasts', '', 'pods');
}

function drawPods(host) {
  const list = shows();
  const local = list.filter((s) => s.local);
  const away = geo() === 'everything' ? list.filter((s) => !s.local).slice(0, NATIONAL) : [];
  const add = (s, opts) => {
    host.appendChild(showRow(s, opts));
    if (O.open[s.id]) host.appendChild(showEpisodes(s));
  };
  local.forEach((s) => add(s));
  if (away.length) {
    divider(host, 'From away');
    away.forEach((s) => add(s, { national: true }));
  }
  if (!local.length && !away.length && O.settled.pulse) host.appendChild(el('p', 'note pad', esc(O.failed.pulse ? 'The podcast feed didn’t load. It rides the same wire as the headlines and comes back on its own.' : 'No episodes right now.')));
}

function drawPast(host) {
  const tv = O.tv;
  const every = geo() === 'everything';
  const since = addDays(todayKey(), -PAST_DAYS);
  const nights = arr(O.tvEditions && O.tvEditions.editions)
    .filter((e) => e && isDate(e.edition) && e.edition >= since && (!tv || e.edition !== tv.edition))
    .sort((a, b) => (a.edition < b.edition ? 1 : -1))
    .map((e) => {
      const vids = [e.pick, ...shelvesOf(e).flatMap((s) => arr(s.items))].filter((v) => v && app.isVideoId(v.id));
      const n = every ? vids.length : vids.filter(isLocalVideo).length;
      const lead = (every ? (e.pick && app.isVideoId(e.pick.id) ? e.pick : vids[0]) : vids.find(isLocalVideo)) || null;
      return { e, n, lead };
    })
    .filter((x) => x.n && x.lead);
  if (!nights.length) return false;
  sec(host, 'Past nights', '', 'past');
  const r = rail(host);
  const items = nights.map(({ e, n, lead }) => {
    const v = videoItem(lead);
    return { k: 'tv:' + e.edition, kind: 'video', title: nightOf(e.edition), src: 'Btown TV', sid: 'btown-tv', media: v ? v.media : '',
      href: '#onair/tv:' + e.edition, text: plural(n, every ? 'video' : 'local video', every ? 'videos' : 'local videos') + (v ? ' · ' + v.title : ''), e };
  });
  items.forEach((it) => {
    const c = el('article', 'vcard w170');
    c.dataset.k = it.k;
    c.dataset.night = it.e.edition;
    c.innerHTML = '<span class="c-media r169" role="button" tabindex="0" aria-label="Open ' + esc(it.title) + '’s picks">' + art(it.media) + '</span>' +
      '<span class="t">' + esc(it.title) + '</span><span class="s">' + esc(it.text) + '</span>';
    r.appendChild(c);
  });
  app.know(items);
  return true;
}

function render() {
  const root = O.root;
  if (!root) return;
  if (!FEEDS.some((k) => O.settled[k])) { root.innerHTML = '<p class="loading">Tuning in…</p>'; return; }
  if (FEEDS.every((k) => O.failed[k])) {
    O.built = false; O.own = null;
    root.innerHTML = '<div class="errbox"><b>Couldn’t reach On Air.</b><br>Everything here is served from GitHub. If you are offline it will come back on its own.</div>';
    return;
  }
  if (!O.built) {
    /* the slots are made once, so the Brief's own show (and any Spotify
       frame in it) is never torn down by a redraw */
    root.innerHTML = '';
    const mk = (name) => { const s = el('div'); s.dataset.slot = name; root.appendChild(s); return s; };
    O.slots = { brief: mk('brief'), tv: mk('tv'), live: mk('live'), podsHead: mk('pods-head'), own: mk('own'), pods: mk('pods'), past: mk('past'), end: mk('end') };
    O.built = true;
  }
  const S = O.slots;
  Object.entries(S).forEach(([name, s]) => { if (name !== 'own') s.innerHTML = ''; });
  S.brief.hidden = !drawBrief(S.brief);
  S.tv.hidden = !drawTV(S.tv);
  S.live.hidden = !drawLive(S.live);
  if (!O.own && O.podcast) { O.own = ownShow(); if (O.own) S.own.appendChild(O.own); }
  const anyPods = !!O.own || shows().length > 0;
  S.podsHead.hidden = !anyPods && !O.failed.pulse;
  if (!S.podsHead.hidden) drawPodsHead(S.podsHead);
  drawPods(S.pods);
  S.past.hidden = !drawPast(S.past);
  S.end.appendChild(cards.caught({
    title: 'That’s On Air',
    check: false,
  }));
  app.paintPlayButtons();
  if (app.activeTab() === KEY) app.paintSubnav();
  land();
}

/* ------------------------------------------------------------ the clicks */
function onClick(e) {
  const r = e.target.closest('[data-react]');
  if (r) {
    e.preventDefault();
    const card = r.closest('[data-k]');
    const it = card && app.item(card.dataset.k);
    if (!it || !it.v) return;
    const now = react(it.v, r.dataset.react);
    card.querySelectorAll('[data-react]').forEach((b) => {
      const on = b.dataset.react === now;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    app.toast(now ? SAID[now] : 'Taken back.');
    return;
  }
  const night = e.target.closest('[data-night]');
  if (night) {
    e.preventDefault();
    const ed = arr(O.tvEditions && O.tvEditions.editions).find((x) => x && x.edition === night.dataset.night);
    if (ed) editionSheet(ed, nightOf(ed.edition) + '’s edition');
    return;
  }
  const show = e.target.closest('[data-show]');
  if (show && show.closest('[data-slot="pods"]') && !e.target.closest('button, a')) {
    const id = show.dataset.show;
    O.open[id] = !O.open[id];
    show.setAttribute('aria-expanded', O.open[id] ? 'true' : 'false');
    const next = show.nextElementSibling;
    if (next && next.dataset.eps === id) next.remove();
    if (O.open[id]) {
      const s = shows().find((x) => x.id === id);
      if (s) show.after(showEpisodes(s));
    }
    app.paintPlayButtons();
  }
}
function onKey(e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-show], [data-night] [role="button"]')) { e.preventDefault(); e.target.click(); }
}

/* -------------------------------------------------------------- deep links */
/* Only once every payload has settled: each one redraws the page, which
   would replace a card that had just flashed, and a key cannot be called
   gone while a payload that might hold it is still on its way. */
function land() {
  const k = O.pending;
  if (!k || !O.root || !O.built || !FEEDS.every((f) => O.settled[f])) return;
  O.pending = null;
  if (!app.flashHit(O.root, k)) app.toast('That one has moved on. Here’s what’s on now.');
}

/* ----------------------------------------------------------------- the tab */
function mount(root) {
  O.root = root;
  render();
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  app.bindFeed(root, {});
  FEEDS.forEach((key) => load(key, (j) => {
    O[key] = j; O.settled[key] = true; delete O.failed[key];
    render();
    app.recount();
  }, () => { O.settled[key] = true; O.failed[key] = true; render(); }));
}

function newSince(ts) {
  let n = 0;
  const c = currentClip();
  if (c && c.made && Date.parse(c.made) / 1000 > ts) n++;
  if (O.tv && Date.parse(O.tv.generated) / 1000 > ts) n += localTonight(O.tv).length;
  return n;
}

app.register(KEY, {
  label: 'On Air',
  icon: ICON.onair,
  promise: '',
  mount,
  activate(param) {
    if (param === 'local' || param === 'everything') {
      /* a link can set the shared switch: #onair/everything */
      setGeo(param);
      if (O.root) render();
      return;
    }
    O.pending = param || null;
    land();
  },
  refresh() { if (O.root) render(); },
  deactivate() { app.closePeek(); },
  subnav() {
    if (!O.root) return null;
    const band = el('div', 'toolband');
    band.appendChild(localSwitch(() => { render(); app.scrollTop(); }));
    const S = O.slots;
    const toc = [['brief', 'Out loud'], ['tv', 'Btown TV'], ['live', 'Live'], ['pods', 'Podcasts'], ['past', 'Past nights']]
      .filter(([key]) => !S || O.root.querySelector('[data-sec="' + key + '"]'))
      .map(([key, label]) => ({ key, label }));
    band.appendChild(chips(toc, null, (k) => app.jumpTo(O.root.querySelector('[data-sec="' + k + '"]'))));
    return band;
  },
  newSince,
  pull() {
    if (app.demo) return null;
    return Promise.all([data.check('tv'), data.check('audio'), data.check('tvEditions')])
      .then((got) => (got.some(Boolean) ? 'Fresh from On Air' : null));
  },
});
