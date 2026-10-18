/* On Air: everything in All Day that you watch or listen to, replacing the
   old Watch (Btown TV) and Listen (podcasts) tabs. What changes every day sits
   on top (Stephen, 2026-10-18). Top to bottom:

   - Btown TV tonight: the nightly curated edition (scripts/curate_tv.py, on
     the btown-tv branch). First rail, the picks: on Local, the pick and the
     Burlington & Vermont shelf with the reason under each; on Everything,
     three more from the wider shelf. Watched / not for me / more like this
     write to the same key tv.html used, so they still teach tomorrow's
     edition; "not for me" swaps in the editor's next one from the bench on
     the next draw. Straight under it, smaller and with no header of its own,
     the rest of the edition, two rows deep; then "Watch the whole edition",
     a filled card with the count that opens every video in a sheet.
     ‹ › on the header flip the block in place to earlier nights.
   - Live: the always-on cameras, smaller, because a lake at night is not
     competing with a documentary.
   - Past nights: the last two weeks of editions (tv-editions.json), here
     with the other videos rather than after the podcasts (Stephen,
     2026-10-18: "it feels weird going from videos to podcast back to videos").
     Every video rail has "See as a list", which turns the sideways row into
     a list you scroll down, thumbnail beside a readable title, and back.
   - The Brief, out loud: the newsletter itself, read aloud, a small card
     (scripts/build_edition_audio.py, on the wire-audio branch). Each Monday
     and Friday edition's intro and local news, word for word, voiced within
     the hour it is published. It changes twice a week, so it sits under the
     videos, at the head of the listening. The newest edition's clip, with
     its date, or no card at all. A speed control (1x, 1.25x, 1.5x; 1.25x
     unless the reader picked otherwise on this phone) and the edition's own
     page at btownbrief.com.
   - Podcasts: the Brief's own show first, always; then every local show
     (pulse.json sources with pod === 1), newest episode first, each a row
     that opens in place; on Everything, two shows from away as well.
   - Playlists: Stephen's, then readers', from data/playlists.json, and a
     "Share your playlist" email (see the playlists section below).

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
const CLIP_FILE = /^\d{4}-\d{2}-\d{2}\.mp3$/;
const NEWSLETTER = 'https://www.btownbrief.com/';
const EDITION_URL = /^https:\/\/www\.btownbrief\.com\/p\/[a-z0-9-]+\/?$/;
const RATES = [1, 1.25, 1.5];   // Stephen, 2026-10-17: "way too slow… people like YT videos at 1.5x"
const RATE_DEFAULT = 1.25;
const RATE_KEY = 'allday-brief-rate';

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
/* Playlists are this app's own hand-edited file, not a wire payload: one
   plain fetch, and the demo file's copy in the demo. */
function loadPlaylists(ok, fail) {
  if (app.demo) { load('playlists', ok, fail); return; }
  fetch(PLAYLISTS_URL, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(ok, fail);
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
  tv: null, tvEditions: null, pulse: null, podcast: null, audio: null, playlists: null,
  settled: Object.create(null), failed: Object.create(null),
  open: Object.create(null),   // show id -> opened in place
  pending: null,
  own: null,                   // the Brief's own show: built once, never rebuilt
  night: null,                 // the earlier night the TV block shows, or null for tonight (the visit only)
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
/* The newest edition's clip on or before today, or null. Only clips the
   edition reader made count (kind "edition"): the daily recap it replaced
   left its last clips in the same index until the first edition run prunes
   them, and those must not show. */
function currentClip() {
  const tk = todayKey();
  const clips = arr(O.audio && O.audio.clips)
    .filter((c) => c && c.kind === 'edition' && isDate(c.date) && c.date <= tk && CLIP_FILE.test(String(c.file || '')))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return clips[0] || null;
}

function clipItem(c) {
  const mins = Math.max(1, Math.round((Number(c.duration) || 0) / 60));
  return {
    k: 'brief:' + c.date, kind: 'audio', src: 'The Brief', sid: 'btown-brief', show: 'The Brief, out loud',
    title: weekday(c.date) + '’s Brief, read aloud',
    text: '', media: BRIEF_ART, dur: c.duration ? mmss(c.duration) : '',
    src_audio: clipUrl(c.file), href: clipUrl(c.file),
    when: (c.date === todayKey() ? 'Today’s edition' : dayName(c.date).split(', ')[1] + ' edition') + (c.duration ? ' · ' + mins + ' min' : ''),
    page: EDITION_URL.test(String(c.url || '')) ? c.url : NEWSLETTER,
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
    '<span class="t">' + esc(it.title) + '</span>' + (it.why && !opts.noWhy ? '<span class="s">' + esc(it.why) + '</span>' : '') +
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

/* Small on purpose (Stephen, 2026-10-18: "make that smaller, since it's not
   gonna be changing every day"): one row, then the speeds and the edition's
   own page. The one line under the title says what it is to a first-time
   visitor: the newsletter, not a summary of it. */
function drawBrief(host) {
  const c = currentClip();
  if (!c) return false;
  const it = clipItem(c);
  app.know([it]);
  sec(host, 'The Brief, out loud', '', 'brief');
  const au = el('div', 'audio');
  au.dataset.k = it.k;
  au.innerHTML = '<button class="pb" data-pk="' + esc(it.k) + '" aria-label="Play ' + esc(it.title) + '">' + ICON.play + '</button><div><div class="eyebrow">' + esc(it.when) + '</div><h3>' +
    esc(it.title) + '</h3><p>The intro and the local news, word for word. New every Monday and Friday.</p></div>';
  const row = el('div', 'brow');
  row.innerHTML = speedRow();
  const a = el('a', 'btn sm ghost', 'Read this edition ' + ICON.ext);
  a.href = it.page; a.target = '_blank'; a.rel = 'noopener';
  a.dataset.newsletter = '1';
  row.appendChild(a);
  au.appendChild(row);
  au.querySelector('.pb').addEventListener('click', () => { app.play(it); applyRate(); });
  host.appendChild(au);
  return true;
}

/* ------------------------------------------------------------- the speed */
/* Stephen, 2026-10-17: "way too slow". The clip is voiced at the voice's own
   pace and sped up here, in the player, rather than re-encoded: one MP3 serves
   every speed, costs nothing more, and keeps its pitch (preservesPitch). The
   choice is this phone's (localStorage, read and written in try, so a blocked
   store just means the default for the visit). It applies to the Brief only:
   when anything else loads into the shell's <audio>, the new src resets
   playbackRate to defaultPlaybackRate, which this never touches, so a podcast
   plays at 1x. The 'play' listener catches the Brief started from anywhere
   (the dock's own button, a resume) as well as from this card. */
let rateMem = null;
function rate() {
  if (rateMem != null) return rateMem;
  let r = RATE_DEFAULT;
  try { const v = Number(localStorage.getItem(RATE_KEY)); if (RATES.includes(v)) r = v; } catch (e) { /* storage blocked */ }
  return r;
}
function setRate(r) {
  if (!RATES.includes(r)) return;
  rateMem = r;
  try { localStorage.setItem(RATE_KEY, String(r)); } catch (e) { /* kept for the visit */ }
  applyRate();
}
const shellAudio = () => document.getElementById('audio');
const isBrief = (k) => /^brief:/.test(String(k || ''));
function applyRate() {
  const a = shellAudio();
  if (!a || !isBrief(app.nowPlaying())) return;
  a.preservesPitch = true;
  if ('webkitPreservesPitch' in a) a.webkitPreservesPitch = true;   // Safari before 17
  a.playbackRate = rate();
}
const speedRow = () => '<div class="speed" role="group" aria-label="Playback speed">' + RATES.map((r) =>
  '<button data-rate="' + r + '" aria-pressed="' + (r === rate()) + '" aria-label="' + r + ' times speed">' + r + 'x</button>').join('') + '</div>';
function paintRate(root) {
  root.querySelectorAll('[data-rate]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === rate())));
}

/* Every night the TV block can show, newest first: tonight's edition, then
   the archive's earlier ones (tv-editions.json also holds tonight's; it is
   skipped, the live file wins). */
function tvNights() {
  const tv = O.tv;
  if (!tv || !(tv.pick || shelvesOf(tv).length)) return [];
  const top = isDate(tv.edition) ? tv.edition : '';
  const out = [{ date: top, ed: tv }];
  const seen = new Set([top]);
  arr(O.tvEditions && O.tvEditions.editions)
    .filter((e) => e && isDate(e.edition) && (!top || e.edition < top) && editionCount(e))
    .sort((a, b) => (a.edition < b.edition ? 1 : -1))
    .forEach((e) => { if (!seen.has(e.edition)) { seen.add(e.edition); out.push({ date: e.edition, ed: e }); } });
  return out;
}

/* The rest of a night's edition, for the second rail: the pick when the
   first rail does not have it, then every shelf in the order a phone reads
   best (Settle in, Quick one, From the Vault, Old gold, From the bench, any
   other), less what the first rail shows and what the reader passed on. */
function restOf(ed, taken) {
  const seen = new Set(taken.map((x) => x.v.id));
  const shelves = shelvesOf(ed);
  const ordered = WIDER_ORDER.map((k) => shelves.find((s) => s.key === k)).filter(Boolean)
    .concat(shelves.filter((s) => !WIDER_ORDER.includes(s.key)));
  const out = [];
  [ed.pick, ...ordered.flatMap((s) => arr(s.items))].forEach((v) => {
    if (v && app.isVideoId(v.id) && v.t && !seen.has(v.id) && !skipped(v)) { seen.add(v.id); out.push(v); }
  });
  return out;
}

/* "See as a list" (Stephen, 2026-10-18: the rails felt "really small and
   hard to read" next to YouTube; "at least having a button, so it changes
   to just scrolling down instead of scrolling left and right"). Each video
   rail has a small button above it that turns the row into a list, the
   thumbnail beside a title at reading size, and back; a long list has the
   same button at its foot, which folds it and scrolls back to the top one.
   Sideways stays the default. The choice is this phone's, per rail
   (localStorage in try: blocked storage just means sideways each visit). */
const LIST_KEY = 'allday-onair-lists';
let listMem = null;
function listed() {
  if (listMem) return listMem;
  listMem = Object.create(null);
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) || '{}');
    if (v && typeof v === 'object') Object.keys(v).forEach((k) => { if (v[k] === 1) listMem[k] = 1; });
  } catch (e) { /* storage blocked */ }
  return listMem;
}
function setListed(name, on) {
  const m = listed();
  if (on) m[name] = 1; else delete m[name];
  try { localStorage.setItem(LIST_KEY, JSON.stringify(m)); } catch (e) { /* kept for the visit */ }
}
const LIST_FOOT = 6;   // a list this long gets the button at its foot too
function videoRail(host, name, cls) {
  const top = el('div', 'railmode');
  top.appendChild(modeButton(name));
  host.appendChild(top);
  const r = rail(host, cls);
  r.dataset.rail = name;
  const foot = el('div', 'railmode foot');
  foot.appendChild(modeButton(name));
  host.appendChild(foot);
  paintMode(r);
  return r;
}
function modeButton(name) {
  const b = el('button', 'btn sm ghost');
  b.dataset.railmode = name;
  return b;
}
/* the rail's class, both buttons' words, and whether the foot one shows */
function paintMode(r) {
  const on = !!listed()[r.dataset.rail];
  r.classList.toggle('aslist', on);
  const wrap = r.closest('.rail-wrap');
  const top = wrap.previousElementSibling;
  const foot = wrap.nextElementSibling;
  [top, foot].forEach((row) => {
    const b = row.querySelector('[data-railmode]');
    b.textContent = on ? 'See as a row' : 'See as a list';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  foot.hidden = !on || r.children.length < LIST_FOOT;
}
/* the cards arrive after videoRail returns, so the foot is settled here too */
function settleRails(host) { host.querySelectorAll('.rail[data-rail]').forEach(paintMode); }
function flipMode(btn) {
  const name = btn.dataset.railmode;
  const fromFoot = !!btn.closest('.railmode.foot');
  setListed(name, !listed()[name]);
  const r = O.root.querySelector('.rail[data-rail="' + name + '"]');
  if (!r) return;
  paintMode(r);
  r.scrollLeft = 0;
  const top = r.closest('.rail-wrap').previousElementSibling;
  if (fromFoot) { app.jumpTo(top); top.querySelector('button').focus({ preventScroll: true }); }
}

/* Btown TV, the star of the tab (Stephen, 2026-10-17: "I have 39 to show"):
   two rails. The first is the night's picks, with the reason and the three
   reactions under each: on Local the pick and the Burlington & Vermont
   shelf, on Everything three from the wider shelf as well. The second is the
   whole rest of the edition, two rows deep in one sideways scroll (.rail.tworow):
   four or five covers a screen instead of one and a half, without a third
   and fourth rail pushing Live and the podcasts off the page. The switch
   decides what leads, not whether the rest of the edition exists: the
   edition is Btown Brief's own curation either way.
   ‹ › on the header flip the block in place to an earlier night (as the
   Wire's What matters does), from the archive; "Tonight" in the subtitle comes
   back. O.night is kept for the visit only. */
const TV_PREV = 'Earlier night';
const TV_NEXT = 'Later night';
function drawTV(host) {
  const all = tvNights();
  if (!all.length) return false;
  let i = O.night ? all.findIndex((n) => n.date === O.night) : 0;
  if (i < 0) { O.night = null; i = 0; }
  const ed = all[i].ed;
  const isTop = i === 0;
  const every = geo() === 'everything';
  const date = all[i].date;
  const night = isTop ? (!date || date >= todayKey() ? 'Tonight' : nightOf(date)) : nightOf(date);
  const when = night + '’s edition';
  let title = every ? 'Tonight, local and beyond' : 'Btown TV tonight';
  if (!isTop) title = every ? night + ', local and beyond' : 'Btown TV ' + said(night);
  let nav = null;
  if (all.length > 1) {
    nav = el('div', 'wm-nav');
    const prev = el('button', 'iconbtn nav', ICON.left); prev.setAttribute('aria-label', TV_PREV);
    const next = el('button', 'iconbtn nav', ICON.right); next.setAttribute('aria-label', TV_NEXT);
    prev.disabled = i >= all.length - 1;
    next.disabled = isTop;
    prev.addEventListener('click', () => { if (all[i + 1]) flipTV(all[i + 1].date, TV_PREV); });
    next.addEventListener('click', () => { if (!isTop) flipTV(i - 1 === 0 ? null : all[i - 1].date, TV_NEXT); });
    nav.append(prev, next);
  }
  const h = sec(host, title, isTop ? '' : esc(dayName(date).split(', ')[1] || ''), 'tv', nav);
  h.dataset.showing = isTop ? 'tonight' : date;
  if (!isTop) {
    const back = el('button', 'wm-today', 'Tonight');
    back.dataset.tonight = '1';
    back.addEventListener('click', () => flipTV(null, TV_NEXT));
    const sub = h.querySelector('p');
    if (sub) sub.append(' · ', back);
  }
  drawTVPlay(host, ed, night, isTop);
  const local = localTonight(ed);
  const wider = every ? widerTonight(ed, local) : [];
  const list = local.concat(wider.map((x) => ({ ...x, wider: true })));
  const items = [];
  if (list.length) {
    const r = videoRail(host, 'picks');
    list.forEach((x) => {
      const it = videoItem(x.v);
      if (!it) return;
      items.push(it);
      const c = vcard(it, 'w250', { react: true, swapped: x.swapped });
      if (x.wider) c.dataset.wider = '1';
      r.appendChild(c);
    });
  } else {
    host.appendChild(el('p', 'note pad', esc('No local picks ' + said(night) + '.')));
  }
  /* the rest of the night, smaller, straight under the picks: one section,
     no second header (Stephen, 2026-10-17: "it can still be big on the top
     and small on the bottom") */
  const rest = restOf(ed, list).map((v) => videoItem(v)).filter(Boolean);
  if (rest.length) {
    const r = videoRail(host, 'rest', 'tworow');
    rest.forEach((it) => { items.push(it); r.appendChild(vcard(it, '', { noWhy: true })); });   // dense: title and channel
  }
  app.know(items);
  const n = editionCount(ed);
  if (n) host.appendChild(wholeCard(ed, n, night, when));
  return true;
}

/* The whole edition, as a card that asks to be opened rather than a ghost
   button people scrolled past (Stephen, 2026-10-17: "I want people to want
   to click it… it's really important that people see all of them"): full
   width, filled, three of the night's covers fanned on the left, the count. */
function wholeCard(ed, n, night, when) {
  const b = el('button', 'wholeed');
  b.dataset.whole = String(n);
  const covers = [ed.pick, ...shelvesOf(ed).flatMap((s) => arr(s.items))].map((v) => videoItem(v)).filter(Boolean).slice(0, 3);
  b.innerHTML = '<span class="fan" aria-hidden="true">' + covers.map((it) => '<span class="th">' + art(it.media) + '</span>').join('') + '</span>' +
    '<span class="w"><span class="t">Watch the whole edition</span><span class="s">' +
    esc((n === 1 ? 'The one video' : 'All ' + n + ' videos') + ' from ' + said(night)) + '</span></span>' + ICON.right;
  b.addEventListener('click', () => editionSheet(ed, when));
  return b;
}

/* Flip the TV block in place, keeping the reader's place: the arrow they
   pressed, or the other one at an end. Only this block redraws. */
function flipTV(date, again) {
  O.night = date || null;
  const S = O.slots;
  if (!S) return;
  S.tv.innerHTML = '';
  S.tv.hidden = !drawTV(S.tv);
  settleRails(S.tv);
  app.paintPlayButtons();
  const btn = [...S.tv.querySelectorAll('.wm-nav .nav')];
  const want = btn.find((b) => b.getAttribute('aria-label') === again && !b.disabled) || btn.find((b) => !b.disabled);
  if (want) want.focus({ preventScroll: true });
}

function drawLive(host) {
  const live = arr(O.tv && O.tv.live).filter((v) => v && app.isVideoId(v.id) && !isAmbience(v) && (geo() === 'everything' || isLocalCam(v)));
  if (!live.length) return false;
  sec(host, 'Live', '', 'live');
  const r = videoRail(host, 'live');
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
function drawTVPlay(host, tv, night, isTop = true) {
  const row = el('div', 'linkrow tvplay');
  const url = playlistOf(tv);
  if (url) {
    row.appendChild(playLink(url, 'Play ' + said(night) + ' on your TV', 'btn', isTop ? 'tonight' : 'night'));
  } else if (isTop) {
    const prev = arr(O.tvEditions && O.tvEditions.editions)
      .filter((e) => e && isDate(e.edition) && e.edition !== tv.edition && playlistOf(e))
      .sort((a, b) => (a.edition < b.edition ? 1 : -1))[0];
    if (!prev) return;
    row.appendChild(playLink(playlistOf(prev), 'Play ' + said(nightOf(prev.edition)) + ' on your TV', 'btn ghost', 'past'));
    row.appendChild(el('span', 'note', esc(night + '’s playlist isn’t up yet')));
  } else return;
  host.appendChild(row);
}

const said = (night) => (/^(Tonight|Last night)$/.test(night) ? night.toLowerCase() : night);   // mid-sentence: “Play tonight”, “Play Friday night”, “Btown TV last night”

function playLink(url, label, cls, which) {
  const a = el('a', cls, ICON.play + ' ' + esc(label) + ' ' + ICON.ext);
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  a.dataset.tvplay = which;
  a.title = 'Opens the playlist in YouTube: cast it, or open it on your TV';
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the night’s YouTube playlist in the real build'); });
  return a;
}

/* One edition, in a sheet: the pick and every shelf, as video cards that
   play in the shell's video box, and the night's YouTube playlist for a TV.
   The whole edition on either side of the switch, as the tab face now shows it. */
function editionSheet(ed, title) {
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
      const shown = vids;
      if (!shown.length) return;
      body.appendChild(el('div', 'sheet-h', esc(g.title) + (g.sub ? ' · <span>' + esc(g.sub) + '</span>' : '')));
      const f = el('div', 'feed tight');
      shown.forEach((v) => { const it = videoItem(v); if (it) { known.push(it); put(f, cards.video(it, { noComments: true })); } });
      body.appendChild(f);
    });
    app.know(known);
    if (!known.length) body.appendChild(el('p', 'sheet-note', 'Nothing in that edition.'));
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

/* -------------------------------------------------------------- playlists */
/* Playlists (Stephen, 2026-10-17: "seed fire Spotify playlists of mines and
   or playlists from YouTube. I'm the curator. Encourage people to share
   theirs too."). data/playlists.json is edited by hand: Stephen's own under
   `stephen`, then readers' under `readers`, each { title, by, service, url,
   note, added }. An entry shows only when its url is a real playlist link on
   its service (the patterns below), so the TODO placeholders the file ships
   with stay off the page until he pastes real links. Spotify and YouTube
   play in a sheet through their own embeds; Apple Music and SoundCloud open
   on their own sites. Readers send theirs by email: the Square board's posts
   carry no link field (boards-core.js), and adding one is a foundation change.
   Every string is the file's, so all of it goes through esc(), and a url is
   only ever used after its service's pattern has matched it whole. */
const PLAYLISTS_URL = 'data/playlists.json';
const SHARE_TO = 'btownbrief@gmail.com';
const SERVICES = {
  spotify: { name: 'Spotify', re: /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/([A-Za-z0-9]{22})(?:\?[A-Za-z0-9=&._-]*)?$/,
    embed: (id) => 'https://open.spotify.com/embed/playlist/' + id + '?theme=0' },
  youtube: { name: 'YouTube', re: /^https:\/\/(?:www\.|m\.|music\.)?youtube\.com\/playlist\?list=([A-Za-z0-9_-]{10,64})$/,
    embed: (id) => 'https://www.youtube-nocookie.com/embed/videoseries?list=' + id + '&rel=0&playsinline=1' },
  apple: { name: 'Apple Music', re: /^https:\/\/music\.apple\.com\/[a-z]{2}\/playlist\/(?:[A-Za-z0-9%._~-]+\/)?(pl\.[A-Za-z0-9-]+)(?:\?[A-Za-z0-9=&._-]*)?$/ },
  soundcloud: { name: 'SoundCloud', re: /^https:\/\/(?:soundcloud\.com\/[A-Za-z0-9_-]+\/sets\/([A-Za-z0-9_-]+)|on\.soundcloud\.com\/([A-Za-z0-9]+))(?:\?[A-Za-z0-9=&._-]*)?$/ },
};
const clip = (v, n) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const isTodo = (v) => /^\s*TODO\b/i.test(String(v || ''));

/* one entry, checked, or null */
function playlistItem(p, own) {
  if (!p || typeof p !== 'object') return null;
  const svc = Object.prototype.hasOwnProperty.call(SERVICES, p.service) ? SERVICES[p.service] : null;   // never "constructor" and friends
  const url = String(p.url || '').trim();
  const m = svc && !isTodo(url) && url.match(svc.re);
  const title = clip(p.title, 80);
  if (!m || !title || isTodo(title)) return null;
  const id = m[1] || m[2];
  return {
    k: 'pl:' + p.service + ':' + id, kind: 'playlist', title, href: url, service: p.service, svc, id,
    by: isTodo(p.by) ? '' : clip(p.by, 40), text: isTodo(p.note) ? '' : clip(p.note, 140),
    added: isDate(p.added) ? p.added : '', own: !!own, src: svc.name, sid: 'playlist:' + p.service,
  };
}
function playlists() {
  const P = O.playlists;
  if (!P || typeof P !== 'object') return { own: [], readers: [] };
  const seen = new Set();
  const take = (list, own) => arr(list).map((p) => playlistItem(p, own)).filter((it) => it && !seen.has(it.k) && (seen.add(it.k), true));
  const own = take(P.stephen, true);
  /* readers' newest first; one with no date goes last */
  const readers = take(P.readers, false).sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : 0));
  return { own, readers };
}

function playlistRow(it) {
  const r = el('div', 'lrow plrow');
  r.dataset.k = it.k;
  r.dataset.service = it.service;
  if (it.own) r.dataset.own = '1';
  const meta = [it.svc.name, it.by && !it.own ? 'from ' + it.by : ''].filter(Boolean).join(' · ');
  r.innerHTML = '<span class="th svc">' + (it.service === 'youtube' ? ICON.play : ICON.listen) + '</span><div><div class="t">' + esc(it.title) + '</div><div class="s">' +
    (it.own ? '<span class="tag tag-own">' + esc(it.by ? it.by + '’s pick' : 'Btown Brief') + '</span> ' : '') + esc(meta) + '</div>' +
    (it.text ? '<div class="s pn">' + esc(it.text) + '</div>' : '') + '</div>';
  if (it.svc.embed) {
    r.setAttribute('role', 'button');
    r.tabIndex = 0;
    const b = el('button', 'pillbtn', ICON.play + ' Play');
    b.setAttribute('aria-label', 'Play ' + it.title + ' on ' + it.svc.name);
    b.dataset.playlist = it.k;
    r.appendChild(b);
  } else {
    const a = el('a', 'pillbtn', esc(it.svc.name) + ' ' + ICON.ext);
    a.href = safeHref(it.href); a.target = '_blank'; a.rel = 'noopener';
    a.setAttribute('aria-label', 'Open ' + it.title + ' on ' + it.svc.name);
    a.dataset.playlist = it.k;
    if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the playlist on ' + it.svc.name + ' in the real build'); });
    r.appendChild(a);
  }
  return r;
}

/* A Spotify or YouTube playlist in a sheet, in the service's own player.
   Opening it stops whatever the shell is playing, as the Brief's own show
   does, and the frame registers with the shell so a later play stops it. */
function playlistSheet(it) {
  app.sheet(it.title, (body) => {
    if (app.demo) {
      body.appendChild(el('p', 'sheet-note', esc('Opens ' + it.svc.name + '’s player for this playlist in the real build.')));
    } else {
      app.stop();
      app.closeVideo();
      const frame = el('iframe', it.service === 'youtube' ? 'embed yt' : 'embed spotify list');
      frame.title = it.title;
      frame.loading = 'lazy';
      frame.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
      if (it.service === 'youtube') frame.setAttribute('allowfullscreen', '');
      frame.src = it.svc.embed(it.id);
      body.appendChild(frame);
      registerEmbed(frame);
    }
    if (it.text) body.appendChild(el('p', 'sheet-note', esc(it.text)));
    const row = el('div', 'linkrow');
    const a = el('a', 'btn ghost', esc('Open in ' + it.svc.name) + ' ' + ICON.ext);
    a.href = safeHref(it.href); a.target = '_blank'; a.rel = 'noopener';
    if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the playlist on ' + it.svc.name + ' in the real build'); });
    row.appendChild(a);
    body.appendChild(row);
  });
}

/* "Share yours": an email to the Brief, the subject and the three things
   Stephen needs already in it */
function shareLink() {
  const body = 'Playlist link:\n\nWhat it is (one line):\n\nName to credit:\n';
  const a = el('a', 'btn ghost more', ICON.mail + ' Share your playlist');
  a.href = 'mailto:' + SHARE_TO + '?subject=' + encodeURIComponent('A playlist for On Air') + '&body=' + encodeURIComponent(body);
  a.dataset.sharePlaylist = '1';
  return a;
}

function drawPlaylists(host) {
  const { own, readers } = playlists();
  if (!own.length && !readers.length) return false;   // nothing real yet: no section, not an empty one
  sec(host, 'Playlists', '', 'lists');
  own.forEach((it) => host.appendChild(playlistRow(it)));
  if (readers.length) {
    divider(host, 'From readers');
    readers.forEach((it) => host.appendChild(playlistRow(it)));
  }
  app.know(own.concat(readers));
  host.appendChild(shareLink());
  return true;
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
      const n = vids.length;    // the whole edition, as the face and the sheet show it
      const lead = (every ? null : vids.find(isLocalVideo)) || (e.pick && app.isVideoId(e.pick.id) ? e.pick : vids[0]) || null;
      return { e, n, lead };
    })
    .filter((x) => x.n && x.lead);
  if (!nights.length) return false;
  sec(host, 'Past nights', '', 'past');
  const r = videoRail(host, 'past');
  const items = nights.map(({ e, n, lead }) => {
    const v = videoItem(lead);
    return { k: 'tv:' + e.edition, kind: 'video', title: nightOf(e.edition), src: 'Btown TV', sid: 'btown-tv', media: v ? v.media : '',
      href: '#onair/tv:' + e.edition, text: plural(n, 'video', 'videos') + (v ? ' · ' + v.title : ''), e };
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
    O.slots = { tv: mk('tv'), live: mk('live'), past: mk('past'), brief: mk('brief'), podsHead: mk('pods-head'), own: mk('own'), pods: mk('pods'), lists: mk('lists'), end: mk('end') };
    O.built = true;
  }
  const S = O.slots;
  Object.entries(S).forEach(([name, s]) => { if (name !== 'own') s.innerHTML = ''; });
  S.tv.hidden = !drawTV(S.tv);
  S.live.hidden = !drawLive(S.live);
  S.past.hidden = !drawPast(S.past);
  settleRails(root);
  S.brief.hidden = !drawBrief(S.brief);
  if (!O.own && O.podcast) { O.own = ownShow(); if (O.own) S.own.appendChild(O.own); }
  const anyPods = !!O.own || shows().length > 0;
  S.podsHead.hidden = !anyPods && !O.failed.pulse;
  if (!S.podsHead.hidden) drawPodsHead(S.podsHead);
  drawPods(S.pods);
  S.lists.hidden = !drawPlaylists(S.lists);
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
  const mb = e.target.closest('[data-railmode]');
  if (mb) {
    e.preventDefault();
    flipMode(mb);
    return;
  }
  const rb = e.target.closest('[data-rate]');
  if (rb) {
    e.preventDefault();
    setRate(Number(rb.dataset.rate));
    paintRate(O.root);
    return;
  }
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
  const pl = e.target.closest('[data-k^="pl:"]');
  if (pl && !e.target.closest('a')) {
    const it = app.item(pl.dataset.k);
    if (it && it.svc && it.svc.embed) { e.preventDefault(); playlistSheet(it); }
    else if (it) { const a = pl.querySelector('a[data-playlist]'); if (a) a.click(); }
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
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-show], [data-night] [role="button"], .plrow[role="button"]')) { e.preventDefault(); e.target.click(); }
}

/* -------------------------------------------------------------- deep links */
/* Only once every payload has settled: each one redraws the page, which
   would replace a card that had just flashed, and a key cannot be called
   gone while a payload that might hold it is still on its way. */
function land() {
  const k = O.pending;
  if (!k || !O.root || !O.built || !FEEDS.every((f) => O.settled[f]) || !O.settled.playlists) return;
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
  const a = shellAudio();
  if (a) a.addEventListener('play', applyRate);
  FEEDS.forEach((key) => load(key, (j) => {
    O[key] = j; O.settled[key] = true; delete O.failed[key];
    render();
    app.recount();
  }, () => { O.settled[key] = true; O.failed[key] = true; render(); }));
  /* not in FEEDS: a playlist file that loads must not hide "Couldn't reach On Air" */
  loadPlaylists((j) => { O.playlists = j; O.settled.playlists = true; render(); }, () => { O.settled.playlists = true; render(); });
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
    const toc = [['tv', 'Btown TV'], ['live', 'Live'], ['past', 'Past nights'], ['brief', 'Out loud'], ['pods', 'Podcasts'], ['lists', 'Playlists']]
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
