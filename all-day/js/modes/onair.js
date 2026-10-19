/* On Air: everything in All Day that you watch or listen to. Two sides, a
   switch at the top (Stephen, 2026-10-19: "a top toggle for TV and for
   Podcasts, because the TV one is so special"). TV is the default.

   TV, top to bottom:
   - Btown TV: the nightly curated edition (scripts/curate_tv.py, on the
     btown-tv branch), labelled by the night it was made ("Btown TV tonight",
     "Last night on Btown TV" in the morning: the outside reviews of
     2026-10-19 caught the morning still saying "tonight"). One program
     full width at the top, then simple rows, then "Watch the whole edition".
     Local means local (the same reviews: "with Local on, rails still show
     Yes Theory, TED and Vox"): on Local the block is only the Burlington &
     Vermont videos; Everything adds the rest of the night.
     ‹ › on the header flip the block to earlier nights.
   - More to watch: what other people's curators found (scripts/
     gather_onair_finds.py → data/onair-finds.json: Wimp, Shahniva, The
     Awesomer, 13GB, Short of the Week, BiteTube), plus the last two weeks of
     Btown TV, sorted by how long they run. The chip row under the switch
     picks a length: Snack (under 15 minutes, "eating a snack"), Commute (15
     to 30), Sit-down (30 and up), Trailers. Every card says its length and
     has one Watch button; the rest is behind ⋯ (the reviews: "cards carry up
     to five actions with tiny titles").
   - Pick a vid for me: one random video from the chosen length.
   - Playlists: Clipsboard's nine-video boards, played straight through.
   - Live (cameras) and Past nights: two sideways rows, each with "See as a
     list".
   Every video plays in On Air's own player, a sheet: the video, what it is,
   Previous and Next, ← → on a keyboard, and when one ends the next in the
   same list follows after a five-second "Up next" you can cancel.

   Podcasts: The Brief out loud (the newsletter read aloud, small card, with
   speeds), then the Brief's own show and every local show, then music
   playlists from data/playlists.json. These are the listening, so they sit
   together on their own side rather than under a long run of videos.

   All sound goes through the shell's one player or one embed at a time;
   nothing plays until it is tapped. The Brief's own show is on Spotify only,
   so its episodes open Spotify's embed in place, built once and never
   rebuilt (rebuilding the frame is what silently stops playback).

   ?demo=1 runs exactly this file on data/demo/onair.json, which holds the
   same payloads in the real shapes, re-dated to the reader's clock. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, svg, art, section, rail, chips, pills, divider, cards, localSwitch, geo, setGeo, agoShort } from '../ui.js';

const KEY = 'onair';
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
/* The finds file is committed to main daily by its own workflow
   (refresh-onair-finds.yml) and lives inside /all-day/, so the service
   worker caches it like music.json. */
const FINDS_URL = 'data/onair-finds.json';

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
/* The finds file: same-origin, committed daily; the demo carries its own. */
function loadFinds(ok, fail) {
  if (app.demo) { load('finds', ok, fail); return; }
  fetch(FINDS_URL, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => (j && Array.isArray(j.items) ? ok(j) : fail()), fail);
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
  arr(d.finds && d.finds.items).forEach(shiftV);
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
  night: null,
  focus: null,                 // a deep link's video, put first in its length
  side: 'tv',                  // TV | Podcasts, for the visit
  len: '',                     // the TV side's chosen length, or '' for all
  finds: null,                 // the earlier night the TV block shows, or null for tonight (the visit only)
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

/* ------------------------------------------------------------- lengths */
/* Stephen, 2026-10-19: "sometimes im trying to watch a 10 minutes video for
   eating a snack. Sometimes I want a 20 minutes video for my daily commute.
   And sometimes I want a 40+ long YouTube doc." Under two minutes only
   counts when it is a trailer ("I dont LOVE videos under 2 minutes unless
   it's like a trailer"). The chips say the minutes, so a first-time visitor
   reads them without a key; the section heads use his words. */
const LENGTHS = [
  { key: 'snack', chip: 'Under 15 min', title: 'Snack size' },
  { key: 'commute', chip: '15–30 min', title: 'Commute length' },
  { key: 'sit', chip: '30 min+', title: 'Sit-down' },
  { key: 'trailer', chip: 'Trailers', title: 'Trailers' },
];
const LEN = Object.assign(Object.create(null), Object.fromEntries(LENGTHS.map((l) => [l.key, l])));   // no inherited keys: a file's "constructor" is not a length
const TRAILER_RE = /\b(trailer|teaser)\b/i;
const MIN_SEC = 120;
const BUCKET_SHOW = 3;      // rows per length on the All view
const BUCKET_MAX = 40;      // a chosen length shows at most this many: finite, like every list here
const TONIGHT_ROWS = 6;     // rows under the feature before "Watch the whole edition"
const secsOf = (dur) => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(String(dur || ''));
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : 0;
};
function lengthOf(sec, title) {
  if (TRAILER_RE.test(String(title || ''))) return 'trailer';
  if (!sec || sec < MIN_SEC) return '';
  return sec < 900 ? 'snack' : sec < 1800 ? 'commute' : 'sit';
}
const minutes = (sec) => (sec >= 3600 ? Math.floor(sec / 3600) + ' hr ' + Math.round((sec % 3600) / 60) + ' min' : Math.max(1, Math.round(sec / 60)) + ' min');

/* ------------------------------------------------------------ the videos */
const isLocalVideo = (v) => !!v && (!!v.vt || v.g === 'vt' || v.shelf === LOCAL_SHELF);
/* Live on Local is cameras around here: a stream on the Vermont shelf, or
   one on the pinned live roster (scripts/refresh_youtube.py LIVE_ROSTER),
   which the data marks cam: 1. PINNED_LIVE is the roster as it was when this
   was written, for a btown-tv.json made before cam existed. Anything that
   reads as music or ambience is never shown, on either side of the switch. */
const PINNED_LIVE = new Set(['zl1woMXGGmQ']);   // Church Street Market Place
const AMBIENCE_RE = /\b(jazz|lo-?fi|relaxing|ambient|ambience|sleep|study)\b|\bcaf[eé](?![a-z])/i;
const isAmbience = (v) => AMBIENCE_RE.test(String(v && v.t || ''));
const isLocalCam = (v) => !!v && (v.cam === 1 || isLocalVideo(v) || PINNED_LIVE.has(v.id));
const shelvesOf = (tv) => arr(tv && tv.shelves).filter((s) => s && typeof s === 'object');

function videoItem(v, opts = {}) {
  if (!v || !app.isVideoId(v.id) || !v.t) return null;
  const live = opts.live || v.dur === 'LIVE';
  const sec = live ? 0 : secsOf(v.dur);
  return {
    k: 'yt:' + v.id, kind: 'video', yt: v.id, title: String(v.t), src: String(v.ch || 'YouTube'), sid: 'yt:' + String(v.ch || ''),
    href: 'https://www.youtube.com/watch?v=' + v.id,
    media: app.demo && v.art ? v.art : 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg',
    dur: !live && v.dur ? String(v.dur) : '', sec, len: live ? '' : lengthOf(sec, v.t),
    why: String(v.why || ''), local: isLocalVideo(v), live, via: 'Btown TV', viaUrl: '',
    ago: !live && Number(v.d) ? agoShort(v.d) : '', v,
  };
}

/* One find from data/onair-finds.json. Everything in it came off other
   people's pages, so every field is checked before it is used: an id that is
   not an id, a picture that is not Vimeo's own, a link that is not https,
   and the find is left out or the field is dropped. */
const VIMEO_ID = /^\d{5,12}$/;
const VIMEO_ART = /^https:\/\/i\.vimeocdn\.com\/[\w./-]+(\?[\w=&.%-]*)?$/;
const CREDIT = { wimp: 'Wimp', shahniva: 'Shahniva', awesomer: 'The Awesomer', '13gb': '13GB', clipsboard: 'Clipsboard',
  sotw: 'Short of the Week', bitetube: 'BiteTube' };
function findItem(f) {
  if (!f || !f.t || !LEN[f.b]) return null;
  const vimeo = VIMEO_ID.test(String(f.vimeo || '')) ? String(f.vimeo) : '';
  if (!vimeo && !app.isVideoId(f.id)) return null;
  if (vimeo && !VIMEO_ART.test(String(f.art || ''))) return null;
  const sec = Math.max(0, Math.round(Number(f.sec) || 0));
  const viaUrl = /^https:\/\/[^\s"'<>]+$/.test(String(f.via_url || '')) ? String(f.via_url) : '';
  return {
    k: vimeo ? 'vm:' + vimeo : 'yt:' + f.id, kind: 'video', yt: vimeo ? null : f.id, vimeo: vimeo || null,
    title: clip(f.t, 140), src: clip(f.ch, 60) || CREDIT[f.via] || 'YouTube', sid: 'yt:' + String(f.ch || f.via || ''),
    href: vimeo ? 'https://vimeo.com/' + vimeo : 'https://www.youtube.com/watch?v=' + f.id,
    media: vimeo ? f.art : (app.demo && f.art ? f.art : 'https://i.ytimg.com/vi/' + f.id + '/hqdefault.jpg'),
    dur: sec ? fmtClock(sec) : '', sec, len: f.b, why: clip(f.why, 160),
    via: CREDIT[f.via] || '', viaUrl, ago: Number(f.d) ? agoShort(f.d) : '', d: Number(f.d) || 0,
  };
}
const fmtClock = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

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
const MORE_ICON = svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', ' fill="currentColor" stroke="none"');

/* The two shapes a video takes on the TV side (the outside reviews,
   2026-10-19: "feature one program full-width at the top, then simple
   rows"; "a clear title, length, and one Watch button, other actions in an
   overflow"). Both carry data-k, the length on the picture, one Watch
   button and ⋯. `list` is the run the player continues through. */
function feature(it, list) {
  const c = el('article', 'oa-feature');
  c.dataset.k = it.k;
  c.innerHTML = '<span class="c-media r169" data-watch role="button" tabindex="0" aria-label="Watch ' + esc(it.title) + '">' + art(it.media) +
    (it.dur ? '<span class="dur">' + esc(it.dur) + '</span>' : '') + '</span>' +
    '<h3 class="t">' + esc(it.title) + '</h3>' + (it.why ? '<p class="why">' + esc(it.why) + '</p>' : '') +
    '<p class="s">' + esc(metaOf(it)) + '</p>' + watchRow(it, 'btn');
  c._list = list;
  return c;
}
function row(it, list, opts = {}) {
  const c = el('article', 'oa-row');
  c.dataset.k = it.k;
  if (opts.wider) c.dataset.wider = '1';
  c.innerHTML = '<span class="c-media r169" data-watch role="button" tabindex="0" aria-label="Watch ' + esc(it.title) + '">' + art(it.media) +
    (it.dur ? '<span class="dur">' + esc(it.dur) + '</span>' : '') + '</span>' +
    '<div class="b"><span class="t">' + esc(it.title) + '</span>' +
    (opts.swapped ? '<span class="s">Stepped in for one you passed on</span>' : '') +
    '<span class="s">' + esc(metaOf(it)) + '</span>' + watchRow(it, 'pillbtn') + '</div>';
  c._list = list;
  return c;
}
/* channel, then who found it when it was not us */
const metaOf = (it) => [it.src, it.sec ? minutes(it.sec) : '', it.via && it.via !== 'Btown TV' ? 'via ' + it.via : ''].filter(Boolean).join(' · ');
const watchRow = (it, cls) => '<div class="oa-acts"><button class="' + cls + ' oa-watch" data-watch aria-label="Watch ' + esc(it.title) + '">' + ICON.play + ' Watch now</button>' +
  '<button class="iconbtn oa-more" data-more aria-label="More for ' + esc(it.title) + '">' + MORE_ICON + '</button></div>';

/* the three signals that teach tomorrow's edition */
const REACTS = [['watched', ICON.check, 'Watched'], ['skip', ICON.x, 'Not for me'], ['more', ICON.plus, 'More like this']];
const SAID = {
  watched: 'Marked watched. Tomorrow’s edition learns from it.',
  skip: 'Not for you. The editor’s next one takes its place.',
  more: 'More like this. Tomorrow’s edition will know.',
};

/* ⋯: everything that is not Watch, in a sheet. A Btown TV video carries the
   three signals; every video can be saved, shared and opened at its source,
   and a find names the curator who found it, with a link back to them. */
function moreSheet(it) {
  app.sheet(it.title, (body, card, close) => {
    const menu = el('div', 'oa-menu');
    const add = (html, fn, attrs = {}) => {
      const b = el('button', 'oa-mi', html);
      Object.entries(attrs).forEach(([k, v]) => b.setAttribute(k, v));
      b.addEventListener('click', () => fn(b));
      menu.appendChild(b);
      return b;
    };
    if (it.v) {
      const paint = () => menu.querySelectorAll('[data-react]').forEach((b) => b.setAttribute('aria-pressed', String(reacts()[it.yt] === b.dataset.react)));
      REACTS.forEach(([kind, icon, label]) => add(icon + '<span>' + label + '</span>', () => {
        const now = react(it.v, kind);
        paint();
        app.toast(now ? SAID[now] : 'Taken back.');
      }, { 'data-react': kind }));
      paint();
    }
    const saved = () => store.isSaved(it.k);
    const sv = add(ICON.star + '<span>' + (saved() ? 'Saved' : 'Save') + '</span>', (b) => {
      app.toggleSave(it);
      b.setAttribute('aria-pressed', String(saved()));
      b.querySelector('span').textContent = saved() ? 'Saved' : 'Save';
    }, { 'data-act-save': '1' });
    sv.setAttribute('aria-pressed', String(saved()));
    add(ICON.share + '<span>Share</span>', () => app.share(KEY, it.k, it.title));
    const out = (label, href) => {
      const a = el('a', 'oa-mi', ICON.ext + '<span>' + esc(label) + '</span>');
      a.href = safeHref(href); a.target = '_blank'; a.rel = 'noopener';
      if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the original in the real build'); });
      menu.appendChild(a);
      return a;
    };
    if (it.clips) out('Open on Clipsboard', it.href).dataset.via = '1';
    else {
      out(it.vimeo ? 'Open on Vimeo' : 'Open in YouTube', it.href);
      if (it.viaUrl && it.via) out('Found by ' + it.via, it.viaUrl).dataset.via = '1';
    }
    body.appendChild(menu);
  });
}

/* ------------------------------------------------------------ the player */
/* On Air's own player (Stephen, 2026-10-19, on Clipsboard: "its built in
   media player is WOW"). A sheet with the video in YouTube's or Vimeo's own
   embed, what it is and who found it, Previous and Next, and the rest of
   the run under it. ← and → (or P and N) step through on a keyboard; Escape
   closes it, as every sheet. When a video ends the next one in the same run
   follows after a five-second "Up next" that Cancel stops: the reader asked
   for a run when they opened one, and nothing starts that they did not
   start. The end of a YouTube or Vimeo video is read from the player's own
   postMessage events (YouTube's "listening" handshake, Vimeo's "finish"),
   so no player script is loaded from anywhere. Opening it stops whatever
   the shell is playing; closing the sheet removes the frame, which stops it. */
const UP_NEXT = 5;
const YT_ORIGIN = /^https:\/\/www\.youtube(-nocookie)?\.com$/;
const VIMEO_ORIGIN = /^https:\/\/player\.vimeo\.com$/;
function openPlayer(list, start, title) {
  const run = arr(list).filter((it) => it && (it.yt || it.vimeo));
  if (!run.length) return;
  app.stop();
  app.closeVideo();
  app.silenceForeign();
  app.sheet(title, (body, card) => {
    card.classList.add('oa-player');
    const P = { i: Math.max(0, Math.min(run.length - 1, start)), timer: 0, left: 0, frame: null };
    const stage = el('div', 'oa-stage');
    const now = el('div', 'oa-now');
    const ctl = el('div', 'oa-ctl');
    const next = el('div', 'oa-upnext');
    next.hidden = true;
    const queue = el('div', 'oa-queue');
    body.append(stage, now, next, ctl, queue);
    const unreg = app.registerForeign(() => { if (P.frame) P.frame.removeAttribute('src'); });
    const cancel = () => { clearInterval(P.timer); P.timer = 0; next.hidden = true; };
    /* the sheet empties #sheet when it closes, however it closes (×, scrim,
       Escape, another sheet): that is when everything here lets go */
    const host = card.parentNode;
    const gone = new MutationObserver(() => { if (!card.isConnected) dispose(); });
    if (host) gone.observe(host, { childList: true });
    function dispose() {
      gone.disconnect();
      cancel();
      window.removeEventListener('message', onMsg);
      document.removeEventListener('keydown', onKey);
      unreg();
      if (P.frame) P.frame.removeAttribute('src');
      P.frame = null;
    }
    const go = (i) => { if (i < 0 || i >= run.length) return; cancel(); P.i = i; paint(); };
    const ended = () => {
      if (P.i >= run.length - 1 || P.timer) return;
      P.left = UP_NEXT;
      const it = run[P.i + 1];
      const tick = () => {
        next.innerHTML = '<span>Up next in ' + P.left + ' · <b>' + esc(it.title) + '</b></span>';
        const x = el('button', 'btn sm ghost', 'Cancel');
        x.dataset.cancel = '1';
        x.addEventListener('click', cancel);
        next.appendChild(x);
      };
      next.hidden = false;
      tick();
      P.timer = setInterval(() => { P.left -= 1; if (P.left <= 0) go(P.i + 1); else tick(); }, 1000);
    };
    const onMsg = (e) => {
      if (!card.isConnected) { dispose(); return; }
      if (!P.frame || e.source !== P.frame.contentWindow) return;
      let d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
      if (!d || typeof d !== 'object') return;
      const ytEnd = YT_ORIGIN.test(e.origin) && ((d.event === 'onStateChange' && d.info === 0) || (d.event === 'infoDelivery' && d.info && d.info.playerState === 0));
      const vmEnd = VIMEO_ORIGIN.test(e.origin) && d.event === 'finish';
      if (ytEnd || vmEnd) ended();
    };
    window.addEventListener('message', onMsg);
    const onKey = (e) => {
      if (!card.isConnected) { dispose(); return; }
      if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') { e.preventDefault(); go(P.i + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') { e.preventDefault(); go(P.i - 1); }
    };
    document.addEventListener('keydown', onKey);
    function paint() {
      const it = run[P.i];
      stage.innerHTML = '';
      P.frame = null;
      if (app.demo) {
        stage.innerHTML = art(it.media);
        stage.appendChild(el('p', 'oa-demo', 'The video plays here in the real build'));
      } else {
        const f = el('iframe', 'embed yt');   // Vimeo's frame is a 16:9 video too
        f.title = it.title;
        f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        f.setAttribute('allowfullscreen', '');
        f.src = it.vimeo
          ? 'https://player.vimeo.com/video/' + it.vimeo + '?autoplay=1&dnt=1'
          : 'https://www.youtube-nocookie.com/embed/' + it.yt + '?autoplay=1&rel=0&playsinline=1&enablejsapi=1&origin=' + encodeURIComponent(location.origin);
        f.addEventListener('load', () => {
          try {
            if (it.vimeo) f.contentWindow.postMessage(JSON.stringify({ method: 'addEventListener', value: 'finish' }), 'https://player.vimeo.com');
            else f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
          } catch (e) { /* the frame went away */ }
        });
        stage.appendChild(f);
        P.frame = f;
      }
      now.innerHTML = '<h3 class="t">' + esc(it.title) + '</h3><p class="s">' + esc(metaOf(it)) + '</p>' + (it.why ? '<p class="why">' + esc(it.why) + '</p>' : '');
      ctl.innerHTML = '';
      const prev = el('button', 'btn ghost sm', ICON.left + ' Previous');
      prev.dataset.prev = '1';
      prev.disabled = P.i === 0;
      prev.addEventListener('click', () => go(P.i - 1));
      const nx = el('button', 'btn sm', 'Next ' + ICON.right);
      nx.dataset.next = '1';
      nx.disabled = P.i >= run.length - 1;
      nx.addEventListener('click', () => go(P.i + 1));
      const pos = el('span', 'oa-pos', esc((P.i + 1) + ' of ' + run.length));
      const open = el('a', 'btn ghost sm', (it.vimeo ? 'Vimeo' : 'YouTube') + ' ' + ICON.ext);
      open.href = safeHref(it.href); open.target = '_blank'; open.rel = 'noopener';
      open.setAttribute('aria-label', it.vimeo ? 'Open on Vimeo' : 'Open in YouTube');
      if (app.demo) open.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the original in the real build'); });
      ctl.append(prev, pos, nx, open);
      queue.innerHTML = '';
      const after = run.slice(P.i + 1, P.i + 6);
      if (after.length) {
        queue.appendChild(el('div', 'sheet-h', 'Next up'));
        after.forEach((q, j) => {
          const b = el('button', 'oa-q', '<span class="th">' + art(q.media) + '</span><span class="t">' + esc(q.title) + '</span><span class="s">' + esc(q.dur) + '</span>');
          b.addEventListener('click', () => go(P.i + 1 + j));
          queue.appendChild(b);
        });
      }
      body.scrollTop = 0;
    }
    paint();
  });
}

/* Pick a vid for me (BiteTube's best idea, Stephen: "I love the pick a vid
   feature"): one at random from the chosen length (or from everything
   here), never one the reader marked watched or passed on, and never the
   one it picked last time. The rest of that length follows it, shuffled. */
let lastPick = '';
function pickForMe() {
  const pool = pool_().filter((it) => !reacts()[it.yt]);
  if (!pool.length) { app.toast('Nothing here at that length.'); return; }
  const choices = pool.length > 1 ? pool.filter((it) => it.k !== lastPick) : pool;
  const at = Math.floor(Math.random() * choices.length);
  const first = choices[at];
  lastPick = first.k;
  const rest = pool.filter((it) => it !== first);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  openPlayer([first, ...rest], 0, O.len ? LEN[O.len].title : 'Picked for you');
}

/* ---------------------------------------------------- what the TV side holds */
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

/* One night's edition as the TV block shows it: on Local only what is from
   here (with the editor's bench stepping in for a "not for me"); on
   Everything the local ones first, then the pick and every shelf in the
   order a phone reads best, less what the reader passed on. */
function nightList(ed) {
  const local = localTonight(ed);
  if (geo() !== 'everything') return local;
  const seen = new Set(local.map((x) => x.v.id));
  const shelves = shelvesOf(ed);
  const ordered = WIDER_ORDER.map((k) => shelves.find((s) => s.key === k)).filter(Boolean)
    .concat(shelves.filter((s) => !WIDER_ORDER.includes(s.key)));
  const out = local.slice();
  [ed.pick, ...ordered.flatMap((s) => arr(s.items))].forEach((v) => {
    if (v && app.isVideoId(v.id) && v.t && !seen.has(v.id) && !skipped(v)) { seen.add(v.id); out.push({ v, swapped: false, wider: true }); }
  });
  return out;
}

/* The finds and the last two weeks of Btown TV, as one shelf sorted by
   length. Local: only Btown TV's local videos (Local means local). The
   curators take turns (newest first within each), so one busy curator does
   not fill a length; tonight's edition is left out, it has its own block. */
function library() {
  const every = geo() === 'everything';
  const nights = tvNights();
  const tonight = new Set(nights.length ? nightList(nights[0].ed).map((x) => 'yt:' + x.v.id) : []);
  const seen = new Set(tonight);
  const groups = Object.create(null);
  const put1 = (it) => {
    if (!it || !it.len || seen.has(it.k)) return;
    seen.add(it.k);
    (groups[it.via] = groups[it.via] || []).push(it);
  };
  nights.slice(1).forEach(({ ed }) => [ed.pick, ...shelvesOf(ed).flatMap((s) => arr(s.items))]
    .forEach((v) => { if (v && (every || isLocalVideo(v)) && !skipped(v)) put1(videoItem(v)); }));
  if (every) arr(O.finds && O.finds.items).map(findItem).sort((a, b) => (b ? b.d : 0) - (a ? a.d : 0)).forEach(put1);
  const lanes = Object.values(groups);
  const out = [];
  for (let i = 0; lanes.some((l) => i < l.length); i++) lanes.forEach((l) => { if (l[i]) out.push(l[i]); });
  return out;
}

/* what "Pick a vid" and a chosen length draw from: tonight first, then the shelf */
function pool_() {
  const nights = tvNights();
  const tonight = nights.length ? nightList(nights[0].ed).map((x) => videoItem(x.v)).filter((it) => it && it.len) : [];
  const all = tonight.concat(library());
  return O.len ? all.filter((it) => it.len === O.len) : all;
}

/* Clipsboard's boards: nine videos on one idea, a playlist (Stephen: "it
   basically has YouTube playlists too, not just individual videos"). Only
   clips with a real id and length are kept. */
function boards() {
  if (geo() !== 'everything') return [];
  return arr(O.finds && O.finds.boards).map((b) => {
    if (!b || !b.t || !/^[a-z0-9-]{1,120}$/.test(String(b.slug || ''))) return null;
    const clips = arr(b.clips).filter((c) => c && app.isVideoId(c.id) && c.t).map((c) => {
      return findItem({ id: c.id, t: c.t, ch: c.ch, sec: c.sec, b: lengthOf(c.sec, c.t), via: 'clipsboard', via_url: 'https://clipsboard.com/grid/' + b.slug, art: c.art });
    }).filter(Boolean);
    if (clips.length < 3) return null;
    const total = clips.reduce((n, c) => n + c.sec, 0);
    return { k: 'board:' + b.slug, kind: 'playlist', title: clip(b.t, 90), src: 'Clipsboard', sid: 'clipsboard', clips, total,
      href: 'https://clipsboard.com/grid/' + b.slug, via: 'Clipsboard', viaUrl: 'https://clipsboard.com/grid/' + b.slug };
  }).filter(Boolean);
}

/* ------------------------------------------------------------- the TV block */
/* "Btown TV tonight" only while it is tonight's: an edition made yesterday
   evening reads "Last night on Btown TV" the next morning, an older one
   "Thursday night on Btown TV". ‹ › walk the archive in place (O.night, for
   the visit only); "Tonight" in the subtitle comes back. */
const TV_PREV = 'Earlier night';
const TV_NEXT = 'Later night';
const said = (night) => (/^(Tonight|Last night)$/.test(night) ? night.toLowerCase() : night);   // mid-sentence: “Play tonight”, “Play Friday night”
const tvTitle = (night) => (night === 'Tonight' ? 'Btown TV tonight' : night + ' on Btown TV');

function drawTV(host) {
  const all = tvNights();
  if (!all.length) return false;
  let i = O.night ? all.findIndex((n) => n.date === O.night) : 0;
  if (i < 0) { O.night = null; i = 0; }
  const ed = all[i].ed;
  const isTop = i === 0;
  const date = all[i].date;
  const night = !date || date >= todayKey() ? 'Tonight' : nightOf(date);
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
  const h = sec(host, tvTitle(night), isTop ? '' : esc(dayName(date).split(', ')[1] || ''), 'tv', nav);
  h.dataset.showing = isTop ? 'tonight' : date;
  if (!isTop) {
    const back = el('button', 'wm-today', 'Tonight');
    back.dataset.tonight = '1';
    back.addEventListener('click', () => flipTV(null, TV_NEXT));
    const sub = h.querySelector('p');
    if (sub) sub.append(' · ', back);
  }
  drawTVPlay(host, ed, night, isTop);
  const list = nightList(ed).map((x) => ({ ...x, it: videoItem(x.v) })).filter((x) => x.it);
  const items = list.map((x) => x.it);
  app.know(items);
  if (!list.length) {
    host.appendChild(el('p', 'note pad', esc(geo() === 'everything' ? 'Nothing in that edition.' : 'No local videos ' + said(night) + '.')));
  } else {
    host.appendChild(feature(list[0].it, items));
    const box = el('div', 'oa-rows');
    box.dataset.rows = 'tv';
    list.slice(1, 1 + TONIGHT_ROWS).forEach((x) => box.appendChild(row(x.it, items, { swapped: x.swapped, wider: x.wider })));
    host.appendChild(box);
  }
  /* the whole edition, every video in it, on Everything: Local shows only
     what is from here, so the button that opens all of it lives there */
  const n = editionCount(ed);
  if (n && geo() === 'everything') host.appendChild(wholeCard(ed, n, night));
  return true;
}

/* The whole edition, as a card that asks to be opened (Stephen, 2026-10-17:
   "I want people to want to click it… it's really important that people
   see all of them"): full width, filled, three covers fanned, the count. */
function wholeCard(ed, n, night) {
  const b = el('button', 'wholeed');
  b.dataset.whole = String(n);
  const covers = editionVideos(ed).slice(0, 3);
  b.innerHTML = '<span class="fan" aria-hidden="true">' + covers.map((it) => '<span class="th">' + art(it.media) + '</span>').join('') + '</span>' +
    '<span class="w"><span class="t">Watch the whole edition</span><span class="s">' +
    esc((n === 1 ? 'The one video' : 'All ' + n + ' videos') + ' from ' + said(night)) + '</span></span>' + ICON.right;
  b.addEventListener('click', () => editionSheet(ed, (night === 'Tonight' ? 'Tonight' : night) + '’s edition'));
  return b;
}
const editionVideos = (ed, localOnly) => [ed.pick, ...shelvesOf(ed).flatMap((s) => arr(s.items))].filter((v) => !localOnly || isLocalVideo(v)).map((v) => videoItem(v)).filter(Boolean);

/* Flip the TV block in place, keeping the reader's place: the arrow they
   pressed, or the other one at an end. Only this block redraws. */
function flipTV(date, again) {
  O.night = date || null;
  const S = O.slots;
  if (!S) return;
  S.tv.innerHTML = '';
  S.tv.hidden = !drawTV(S.tv);
  const btn = [...S.tv.querySelectorAll('.wm-nav .nav')];
  const want = btn.find((b) => b.getAttribute('aria-label') === again && !b.disabled) || btn.find((b) => !b.disabled);
  if (want) want.focus({ preventScroll: true });
}

/* Play the night on your TV: tonight's YouTube playlist, or, when tonight's
   did not publish, a quiet link to the most recent past night that has one. */
function drawTVPlay(host, tv, night, isTop = true) {
  const row_ = el('div', 'linkrow tvplay');
  const url = playlistOf(tv);
  if (url) {
    row_.appendChild(playLink(url, 'Play ' + said(night) + ' on your TV', 'btn ghost', isTop ? 'tonight' : 'night'));
  } else if (isTop) {
    const prev = arr(O.tvEditions && O.tvEditions.editions)
      .filter((e) => e && isDate(e.edition) && e.edition !== tv.edition && playlistOf(e))
      .sort((a, b) => (a.edition < b.edition ? 1 : -1))[0];
    if (!prev) return;
    row_.appendChild(playLink(playlistOf(prev), 'Play ' + said(nightOf(prev.edition)) + ' on your TV', 'btn ghost', 'past'));
    row_.appendChild(el('span', 'note', esc(night + '’s playlist isn’t up yet')));
  } else return;
  host.appendChild(row_);
}

function playLink(url, label, cls, which) {
  const a = el('a', cls, ICON.play + ' ' + esc(label) + ' ' + ICON.ext);
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  a.dataset.tvplay = which;
  a.title = 'Opens the playlist in YouTube: cast it, or open it on your TV';
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the night’s YouTube playlist in the real build'); });
  return a;
}

/* One edition, in a sheet: the night's TV playlist, then every video as a
   row; a row's Watch opens the player on the whole edition from there. */
function editionSheet(ed, title, localOnly) {
  app.sheet(title, (body) => {
    const url = playlistOf(ed);
    if (url) {
      const r = el('div', 'linkrow');
      r.appendChild(playLink(url, 'Play it on your TV', 'btn', 'sheet'));
      body.appendChild(r);
    }
    const items = editionVideos(ed, localOnly);
    app.know(items);
    const box = el('div', 'oa-rows insheet');
    items.forEach((it) => box.appendChild(row(it, items)));
    body.appendChild(box);
    if (!items.length) body.appendChild(el('p', 'sheet-note', 'Nothing in that edition.'));
    body.addEventListener('click', onClick);
  });
}

/* Pick a vid for me, at the top of the TV side */
function drawPick(host) {
  const n = pool_().length;
  if (!n) return false;
  const r = el('div', 'oa-pick');
  const b = el('button', 'btn oa-pickbtn', ICON.shuffle + ' Pick a vid for me');
  b.dataset.pick = '1';
  r.appendChild(b);
  host.appendChild(r);
  return true;
}

/* More to watch. On All: each length with its first three and a button to
   the rest; with a length chosen: that length, finite, the first full width. */
function drawMore(host) {
  const lib = library();
  if (!lib.length) return false;
  sec(host, 'More to watch', '', 'more');
  LENGTHS.forEach((l) => {
    const list = lib.filter((it) => it.len === l.key);
    if (!list.length) return;
    const d = divider(host, l.title, l.key === 'trailer' ? '' : l.chip);
    d.dataset.len = l.key;
    const box = el('div', 'oa-rows');
    box.dataset.rows = l.key;
    list.slice(0, BUCKET_SHOW).forEach((it) => box.appendChild(row(it, list)));
    host.appendChild(box);
    if (list.length > BUCKET_SHOW) {
      const all = el('button', 'btn ghost sm oa-all', esc('All ' + list.length + ' · ' + l.chip));
      all.dataset.len = l.key;
      host.appendChild(all);
    }
  });
  app.know(lib);
  return true;
}

/* A chosen length: tonight's at that length, then the shelf's */
function drawLength(host) {
  const l = LEN[O.len];
  const all = pool_();
  /* a deep link's video leads its length */
  const at = O.focus ? all.findIndex((it) => it.k === O.focus) : -1;
  if (at > 0) all.unshift(all.splice(at, 1)[0]);
  O.focus = null;
  const list = all.slice(0, BUCKET_MAX);
  const n = all.length > list.length ? list.length + ' of ' + all.length + ' videos' : plural(list.length, 'video', 'videos');
  sec(host, l.title, esc(n + (O.len === 'trailer' ? '' : ' · ' + l.chip.toLowerCase())), 'len');
  if (!list.length) { host.appendChild(el('p', 'note pad', 'Nothing at that length yet.')); return true; }
  app.know(list);
  host.appendChild(feature(list[0], list));
  const box = el('div', 'oa-rows');
  box.dataset.rows = O.len;
  list.slice(1).forEach((it) => box.appendChild(row(it, list)));
  host.appendChild(box);
  return true;
}

function drawBoards(host) {
  const list = boards();
  if (!list.length) return false;
  sec(host, 'Playlists', '', 'boards');
  app.know(list);
  const box = el('div', 'oa-rows');
  box.dataset.rows = 'boards';
  list.forEach((b) => {
    const c = el('article', 'oa-row board');
    c.dataset.k = b.k;
    c.dataset.board = b.k;
    c.innerHTML = '<span class="c-media r169 mosaic" data-watch role="button" tabindex="0" aria-label="Play ' + esc(b.title) + '">' +
      b.clips.slice(0, 4).map((x) => '<span class="m">' + art(x.media) + '</span>').join('') + '<span class="dur">' + esc(String(b.clips.length)) + ' videos</span></span>' +
      '<div class="b"><span class="t">' + esc(b.title) + '</span><span class="s">' + esc(minutes(b.total) + ' · via Clipsboard') + '</span>' +
      '<div class="oa-acts"><button class="pillbtn oa-watch" data-watch aria-label="Play all of ' + esc(b.title) + '">' + ICON.play + ' Play all</button>' +
      '<button class="iconbtn oa-more" data-more aria-label="More for ' + esc(b.title) + '">' + MORE_ICON + '</button></div></div>';
    box.appendChild(c);
  });
  host.appendChild(box);
  return true;
}

/* ------------------------------------------- sideways rows: Live, Past nights */
/* "See as a list" (Stephen, 2026-10-18, and again 2026-10-19: "I still see
   Horizontal scrolling without the option/button to expand as a list"):
   every sideways row on this tab has the button above it, and a long list
   has it at its foot too. Everything else on the TV side is already a list.
   The choice is this phone's, per row (localStorage in try). */
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
const LIST_FOOT = 6;
const RAIL_NAMES = { live: 'Live', past: 'Past nights' };
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
function paintMode(r) {
  const on = !!listed()[r.dataset.rail];
  r.classList.toggle('aslist', on);
  const wrap = r.closest('.rail-wrap');
  const top = wrap.previousElementSibling;
  const foot = wrap.nextElementSibling;
  [top, foot].forEach((row_) => {
    const b = row_.querySelector('[data-railmode]');
    b.textContent = on ? 'See as a row' : 'See as a list';
    b.setAttribute('aria-label', b.textContent + ': ' + (RAIL_NAMES[r.dataset.rail] || 'these videos'));
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  foot.hidden = !on || r.children.length < LIST_FOOT;
}
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

function vcard(it, w, list) {
  const c = el('article', 'vcard ' + w);
  c.dataset.k = it.k;
  c._list = list;
  c.innerHTML = '<span class="c-media r169" data-watch role="button" tabindex="0" aria-label="Watch ' + esc(it.title) + '">' + art(it.media) +
    '<span class="play">' + ICON.play + '</span>' + (it.live ? '<span class="tag tag-live on-pic">Live</span>' : '') + '</span>' +
    '<span class="t">' + esc(it.title) + '</span><span class="s">' + esc(it.src) + '</span>';
  return c;
}

function drawLive(host) {
  const live = arr(O.tv && O.tv.live).filter((v) => v && app.isVideoId(v.id) && !isAmbience(v) && (geo() === 'everything' || isLocalCam(v)));
  if (!live.length) return false;
  sec(host, 'Live', '', 'live');
  const r = videoRail(host, 'live');
  const items = live.map((v) => videoItem(v, { live: true })).filter(Boolean);
  items.forEach((it) => r.appendChild(vcard(it, 'w220', items)));
  app.know(items);
  return true;
}

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
        app.silenceForeign();
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
      app.silenceForeign();
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
      /* Local means local: on Local a night is only its local videos, here and in its sheet */
      const vids = [e.pick, ...shelvesOf(e).flatMap((s) => arr(s.items))].filter((v) => v && app.isVideoId(v.id) && (every || isLocalVideo(v)));
      const n = vids.length;
      const lead = (e.pick && vids.includes(e.pick) ? e.pick : vids[0]) || null;
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

/* ------------------------------------------------------------- the sides */
/* TV | Podcasts, and the TV side's length. Both live for the visit; the side
   is in the URL (#onair/podcasts) so a link can land on it. Both sides are
   drawn and the other is hidden, so the Brief's own show (and a Spotify
   frame in it) is never torn down by a flip. */
function setSide(side, quiet) {
  O.side = side === 'pods' ? 'pods' : 'tv';
  const S = O.slots;
  if (S) { S.tvSide.hidden = O.side !== 'tv'; S.podSide.hidden = O.side !== 'pods'; }
  if (!quiet) {
    try { history.replaceState(null, '', '#onair' + (O.side === 'pods' ? '/podcasts' : '')); } catch (e) { /* a sandboxed frame */ }
    app.scrollTop();
  }
  if (app.activeTab() === KEY) app.paintSubnav();
}
function setLen(k) {
  O.len = LEN[k] ? k : '';
  drawTVSide();
  app.paintSubnav();
  app.scrollTop();
}

function drawTVSide() {
  const S = O.slots;
  ['pick', 'tv', 'more', 'boards', 'live', 'past', 'tvEnd'].forEach((n) => { S[n].innerHTML = ''; });
  S.pick.hidden = !drawPick(S.pick);
  if (O.len) {
    S.tv.hidden = !drawLength(S.tv);
    ['more', 'boards', 'live', 'past'].forEach((n) => { S[n].hidden = true; });
  } else {
    S.tv.hidden = !drawTV(S.tv);
    S.more.hidden = !drawMore(S.more);
    S.boards.hidden = !drawBoards(S.boards);
    S.live.hidden = !drawLive(S.live);
    S.past.hidden = !drawPast(S.past);
    settleRails(S.tvSide);
  }
  S.tvEnd.appendChild(cards.caught({ title: 'That’s On Air', check: false }));
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
    const side = (name) => { const s = el('div', 'oa-side'); s.dataset.side = name; root.appendChild(s); return s; };
    const tvSide = side('tv');
    const podSide = side('pods');
    const mk = (host, name) => { const s = el('div'); s.dataset.slot = name; host.appendChild(s); return s; };
    O.slots = { tvSide, podSide,
      pick: mk(tvSide, 'pick'), tv: mk(tvSide, 'tv'), more: mk(tvSide, 'more'), boards: mk(tvSide, 'boards'), live: mk(tvSide, 'live'), past: mk(tvSide, 'past'), tvEnd: mk(tvSide, 'end'),
      brief: mk(podSide, 'brief'), podsHead: mk(podSide, 'pods-head'), own: mk(podSide, 'own'), pods: mk(podSide, 'pods'), lists: mk(podSide, 'lists'), podEnd: mk(podSide, 'end') };
    O.built = true;
    setSide(O.side, true);
  }
  const S = O.slots;
  drawTVSide();
  ['brief', 'podsHead', 'pods', 'lists', 'podEnd'].forEach((n) => { S[n].innerHTML = ''; });
  S.brief.hidden = !drawBrief(S.brief);
  if (!O.own && O.podcast) { O.own = ownShow(); if (O.own) S.own.appendChild(O.own); }
  const anyPods = !!O.own || shows().length > 0;
  S.podsHead.hidden = !anyPods && !O.failed.pulse;
  if (!S.podsHead.hidden) drawPodsHead(S.podsHead);
  drawPods(S.pods);
  S.lists.hidden = !drawPlaylists(S.lists);
  S.podEnd.appendChild(cards.caught({ title: 'That’s On Air', check: false }));
  app.paintPlayButtons();
  if (app.activeTab() === KEY) app.paintSubnav();
  land();
}

/* ------------------------------------------------------------ the clicks */
function onClick(e) {
  const pick = e.target.closest('[data-pick]');
  if (pick) { e.preventDefault(); pickForMe(); return; }
  const len = e.target.closest('button[data-len]');
  if (len) { e.preventDefault(); setLen(len.dataset.len); return; }
  const w = e.target.closest('[data-watch]');
  if (w) {
    e.preventDefault();
    const card = w.closest('[data-k]');
    const it = card && app.item(card.dataset.k);
    if (!it) return;
    if (it.clips) { openPlayer(it.clips, 0, it.title); return; }
    const list = card._list || [it];
    const at = Math.max(0, list.findIndex((x) => x.k === it.k));
    openPlayer(list, at, card.closest('.sheet-body') ? 'The whole edition' : it.live ? 'Live' : O.len ? LEN[O.len].title : it.via === 'Btown TV' ? 'Btown TV' : 'More to watch');
    return;
  }
  const more = e.target.closest('[data-more]');
  if (more) {
    e.preventDefault();
    const card = more.closest('[data-k]');
    const it = card && app.item(card.dataset.k);
    if (it) moreSheet(it);
    return;
  }
  const mb = e.target.closest('[data-railmode]');
  if (mb) { e.preventDefault(); flipMode(mb); return; }
  const rb = e.target.closest('[data-rate]');
  if (rb) {
    e.preventDefault();
    setRate(Number(rb.dataset.rate));
    paintRate(O.root);
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
    if (ed) editionSheet(ed, nightOf(ed.edition) + (geo() === 'everything' ? '’s edition' : ', from here'), geo() !== 'everything');
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
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-show], [data-night] [role="button"], .plrow[role="button"], .c-media[data-watch]')) { e.preventDefault(); e.target.click(); }
}

/* -------------------------------------------------------------- deep links */
/* Only once every payload has settled: each one redraws the page, which
   would replace a card that had just flashed. A key on the other side
   brings that side forward first. */
const findHit = (k) => [...O.root.querySelectorAll('[data-k]')].find((n) => n.dataset.k === k) || null;
/* every video On Air holds, whatever the switch and the length say */
function allVideos() {
  const out = [];
  tvNights().forEach(({ ed }) => out.push(...editionVideos(ed)));
  arr(O.finds && O.finds.items).forEach((f) => { const it = findItem(f); if (it) out.push(it); });
  return out;
}
function land() {
  let k = O.pending;
  if (!k || !O.root || !O.built || !FEEDS.every((f) => O.settled[f]) || !O.settled.playlists || !O.settled.finds) return;
  O.pending = null;
  if (k === 'brief') { const c = currentClip(); if (c) k = 'brief:' + c.date; }   // the old #listen/brief
  let hit = findHit(k);
  if (!hit && /^(yt|vm):/.test(k)) {
    /* a shared video that the page as drawn does not show (a find while on
       Local, the twentieth of tonight's, the fourth of a length): bring the
       page to it. A find from away flips the switch to Everything, as
       #onair/everything does; then its length opens with it first. */
    const it = allVideos().find((x) => x.k === k);
    if (it) {
      if (!it.local && geo() !== 'everything') setGeo('everything');
      if (it.len) { O.len = it.len; O.focus = k; }
      drawTVSide();
      hit = findHit(k);
    }
  }
  if (hit) setSide(hit.closest('[data-side="pods"]') ? 'pods' : 'tv', true);
  if (app.activeTab() === KEY) app.paintSubnav();
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
  /* not in FEEDS: a playlist or finds file that loads must not hide "Couldn't reach On Air" */
  loadPlaylists((j) => { O.playlists = j; O.settled.playlists = true; render(); }, () => { O.settled.playlists = true; render(); });
  loadFinds((j) => { O.finds = j; O.settled.finds = true; render(); }, () => { O.settled.finds = true; render(); });
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
      O.pending = null;   // an explicit route replaces a link still waiting for its data
      setGeo(param);
      if (O.root) render();
      return;
    }
    if (param === 'podcasts' || param === 'tv') { O.pending = null; setSide(param === 'podcasts' ? 'pods' : 'tv', true); return; }
    O.pending = param || null;
    land();
  },
  refresh() { if (O.root) render(); },
  deactivate() { app.closePeek(); },
  subnav() {
    if (!O.root) return null;
    const wrap = el('div', 'oa-sub');
    const band = el('div', 'toolband');
    band.appendChild(localSwitch(() => { render(); app.scrollTop(); }));
    const sw = pills([['tv', 'TV'], ['pods', 'Podcasts']], O.side, (v) => setSide(v), 'oa-sideswitch');
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'TV or podcasts');
    [...sw.children].forEach((b, i) => { b.dataset.side = i ? 'pods' : 'tv'; b.setAttribute('aria-pressed', String(b.dataset.side === O.side)); });
    band.appendChild(sw);
    wrap.appendChild(band);
    if (O.side === 'tv') {
      const pool = O.built ? (() => { const keep = O.len; O.len = ''; const all = pool_(); O.len = keep; return all; })() : [];
      const items = [{ key: 'all', label: 'All lengths' }].concat(LENGTHS.filter((l) => l.key === O.len || pool.some((it) => it.len === l.key)).map((l) => ({ key: l.key, label: l.chip })));
      wrap.appendChild(chips(items, O.len || 'all', (k) => setLen(k === 'all' ? '' : k)));
    } else {
      const toc = [['brief', 'Out loud'], ['pods', 'Podcasts'], ['lists', 'Playlists']]
        .filter(([key]) => O.root.querySelector('[data-side="pods"] [data-sec="' + key + '"]'))
        .map(([key, label]) => ({ key, label }));
      if (toc.length) wrap.appendChild(chips(toc, null, (k) => app.jumpTo(O.root.querySelector('[data-sec="' + k + '"]'))));
    }
    return wrap;
  },
  newSince,
  pull() {
    if (app.demo) return null;
    return Promise.all([data.check('tv'), data.check('audio'), data.check('tvEditions')])
      .then((got) => (got.some(Boolean) ? 'Fresh from On Air' : null));
  },
});
