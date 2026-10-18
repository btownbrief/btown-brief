/* The Wire: a daily paper that fills up through the day.

   Data is the pipeline's (scripts/curate_wire.py, hourly, on the wire-data
   branch): wire-today.json, wire/index.json and the frozen editions
   wire/YYYY-MM-DD.json. The page, top to bottom:

   - the dateline, always today in Burlington ("0 stories so far" before the
     first update lands), with ‹ › walking the frozen editions; an earlier
     day reads "final". While you scroll down into an earlier day it names
     that day, so it always says what you are looking at.
   - the Local / Everything switch (the shell's, shared with On Air) and the
     chips by kind of source, counted, X and Facebook hidden while paused,
     then "Unfiltered ↗", and under them a row of topics (TOPICS, from each
     story's `topic` tag, scripts/tag_wire.py), each counted, an empty one
     left out
   - the Brief's own edition pinned on the days it went out
   - What matters today: every local pick of the current ranking (plus the
     national ones on Everything, ranked with them as one list), each with
     its reason; one to five shown, the rest behind one button, and after
     them the stories an earlier ranking that day held (`picks_earlier`),
     with their last rank. ‹ › on its head flip the block in place through
     the frozen editions' picks ("What mattered Friday", a Today link back);
     the river below stays today's
   - The rest of today: the river by update, the update's label as the time
     divider, lead first then newest first, the picks left out, the
     "N new since you were here" line
   - then, with no stop, yesterday's frozen edition, the day before, and so on
     as far as the archive goes (30 days), each day under its head with its
     own What mattered block first. The river is long by design (up to
     300 a day), so it is drawn in chunks as the reader nears the bottom; the
     time dividers and the day heads are the landmarks. When the editions run
     out the page says so.

   Unfiltered is a sub-view of this tab, not a tab: every headline on
   pulse.json, newest first or by outlet, the outlet chips, search.

   Photo mode (wire-photos.js) is the other way to read the tab: the News ·
   Photos · Square switch turns the paper into one feed of pictures
   (neighbors' photos and art, the gallery, local Instagram; never the
   news), newest first. The choice is kept on the phone; #wire/photos opens
   it, and the old #art and #photos land there too.

   ?demo=1 runs exactly this file on wire-demo.js's fake payloads, which have
   the same shape as the real ones. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as demo from './wire-demo.js';
import * as photos from './wire-photos.js';
import * as square from './wire-square.js';
import * as boards from '../boards.js';
import { el, esc, safeHref, ICON, mark, cards, chips, pills, button, divider, section, localSwitch, geo, setGeo, put } from '../ui.js';

const FIRST = 60;        // cards on the first screenful (DESIGN.md §9 rule 14: sixty in under 100ms)
const CHUNK = 40;        // then forty at a time as the reader nears the bottom
const AHEAD = 1600;      // how far below the screen the next chunk starts drawing, in px
const PICKS_OPEN = 5;    // one as the pick card, two to five as ranked rows, the rest on request
const RAW_PAGE = 60;
const PER_OUTLET = 6;
const HUNT_AT_ONCE = 5;  // editions a shared link fetches at a time while it looks for its card
/* the river's thumbnails, 72px (were 56). Tried on the left (Stephen,
   2026-10-17: "I like a left oriented photo") and on the right at 390 on
   the real paper (tests/shots/wire-thumbs-*-390.png). Right reads better:
   only about one row in three has a picture, and on the left every titled
   row without one starts at a different edge, so the eye zigzags; on the
   right the titles share one edge and the pictures still break the list. */
const THUMBS_LEFT = false;

/* The chips under the switch, each source with its own colour (Stephen,
   2026-10-17: "better color coordinate the x vs Facebook vs other posts").
   Video went (it had nothing; videos live in On Air); Instagram reads the
   local accounts' posts as a list (wire-photos.js has them). */
const KINDS = [['all', 'All'], ['x', 'X'], ['facebook', 'Facebook'], ['reddit', 'Reddit'], ['instagram', 'Instagram'], ['newsletters', 'Newsletters']];
const SRC_CH = new Set(['x', 'facebook', 'reddit', 'instagram', 'newsletters']);
const KIND_LABEL = { local: 'Local news', world: 'News', x: 'X', facebook: 'Facebook group, via Muse', reddit: 'Reddit', newsletters: 'Newsletter', video: 'Video', instagram: 'Instagram' };
/* The topic row under the chips (Stephen, 2026-10-18: "add some tags for
   people ... like sports or like politics"): a handful of main topics, each
   a few of tag_wire.py's TOPICS. A story with any other topic is only under
   All topics. Keys carry a "t:" so they never meet the source chips'. */
const TOPICS = [
  ['t:politics', 'Politics', ['city-government', 'state-politics', 'national-politics']],
  ['t:safety', 'Safety', ['public-safety', 'courts']],
  ['t:business', 'Business', ['business', 'economy']],
  ['t:housing', 'Housing', ['housing']],
  ['t:around', 'Getting around', ['transportation']],
  ['t:arts', 'Arts & events', ['arts-culture', 'music', 'events']],
  ['t:food', 'Food & drink', ['food-drink']],
  ['t:sports', 'Sports', ['sports']],
  ['t:weather', 'Weather', ['weather']],
  ['t:health', 'Health', ['health']],
];
const TOPIC_OF = Object.fromEntries(TOPICS.flatMap(([key, , tags]) => tags.map((t) => [t, key])));
/* the three ways to read the tab, in words (his girlfriend, 2026-10-17:
   the list and photo icons "looked like the same information") */
const MODES = [['news', 'News'], ['photos', 'Photos'], ['square', 'Square']];
const NUMBER = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const words = (n) => (n < 20 ? NUMBER[n] || String(n) : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? '-' + NUMBER[n % 10] : '') : String(n));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* --------------------------------------------------------------- sources */
/* Where payloads come from: the data layer, or the demo's fake ones. */
const live = {
  now: () => Date.now(),
  base: () => store.visitBase(),
  today: (ok, fail) => data.load('today', ok, fail),
  index: (ok, fail) => data.load('wireIndex', ok, fail),
  pulse: (ok, fail) => data.load('pulse', ok, fail),
  edition: (date) => new Promise((res, rej) => {
    const key = data.edition(date);
    if (!key) { rej(new Error('not a date')); return; }
    data.load(key, res, rej);
  }),
  check: () => data.check('today').then((ok) => (ok ? 'Fresh stories are in' : null)),
  newSince: null,
};
const SRC = app.demo ? demo.source : live;

/* ----------------------------------------------------------------- state */
const W = {
  root: null, panel: null,
  today: null, index: null, pulse: null, eds: Object.create(null),
  failed: false, idxDone: false, stale: false,
  start: null,          // null: the paper opens on today; else the edition it opens on
  reading: null,        // the day the dateline names (follows the scroll)
  ch: 'all',
  topic: 'all',         // or a TOPICS key
  open: new Set(),      // the days whose What matters list is opened past five
  flip: null,           // the earlier day today's What matters block shows, or null (never stored)
  view: 'paper',        // or 'raw', Unfiltered
  mode: photos.remembered() || 'news',   // News (the paper), Photos or Square
  squareOk: app.demo ? true : null,      // the Square board is live (nn-ROUND4.sql); null until asked
  ig: null,             // the Instagram posts, for the News list's Instagram chip
  left: null,           // where the reader left off last time: { date, k, at }
  slot: null,           // the What matters ranking shown: null is the current one, else 'morning' | 'midday' | 'evening'
  photoOpen: null,      // a picture a deep link asked for, opened once the photos are drawn
  pulseTried: false,    // the Unfiltered wire was asked for and did not come
  run: null,            // the river being drawn
  pending: null, queued: [],
  raw: { outlet: '', q: '', run: null, list: null, until: null, keep: 0 },
  hunt: 0,              // the newest deep-link search; an older one stops
};
const follows = app.demo ? Object.create(null) : { ...store.read('allday-follows', {}) };
function setFollow(sid, on) {
  if (on) follows[sid] = 1; else delete follows[sid];
  if (!app.demo) store.write('allday-follows', follows);
}

/* ----------------------------------------------------------------- clock */
/* Burlington's clock, not the reader's: a day and a time of day are always
   America/New_York, so a reader elsewhere sees the same paper. */
const TZ = 'America/New_York';
const keyFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const nameFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
function etDay(ms) {
  const o = {};
  keyFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return o.year + '-' + o.month + '-' + o.day;
}
const todayKey = () => etDay(SRC.now());
const utcNoon = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const dayName = (date) => nameFmt.format(utcNoon(date));                       // "Thursday, October 16"
const weekday = (date) => dayName(date).split(',')[0];
const dayBefore = (date) => { const t = utcNoon(date); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const clock = (ms) => timeFmt.format(new Date(ms)).replace(/\s+/g, ' ').toLowerCase();   // "2:10 pm"
function ago(ms) {
  const s = Math.max(0, Math.floor((SRC.now() - ms) / 1000));
  if (s < 90) return 'now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
const etHour = (ms) => Number(hourFmt.format(new Date(ms))) % 24;

/* ------------------------------------------------------------ the items */
const YT = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const ytOf = (u) => { const m = String(u || '').match(YT); return m ? m[1] : ''; };

/* A pipeline item as the shell's cards read it. Keys are the pipeline's
   ids, so a share link is short and a card keeps its saves and votes from
   one day's edition to the next. An item without an id, a URL or a title
   is not drawn (§9 rule 4). */
function toCard(it, sources, isToday) {
  if (!it || !it.id || !it.url || !it.title) return null;
  const ms = Date.parse(it.posted_at) || 0;
  const name = it.name || (sources[it.src] && sources[it.src].name) || it.src || '';
  const c = {
    k: String(it.id), href: it.url, kind: 'headline', title: it.title, src: name, sid: it.src || name,
    local: !!it.local, ch: it.ch || 'local', d: ms / 1000, thumb: it.thumb || '',
    ago: ms ? (isToday ? ago(ms) : clock(ms)) : '', own: !!it.own, topic: TOPIC_OF[it.topic] || '',
  };
  if (Number(it.votes)) c.votes = Number(it.votes);      // demo only; real counts come from the shell
  if (c.ch === 'x' || c.ch === 'facebook') {
    /* the bot's one-line summary is the text; the link is always the original post */
    Object.assign(c, { kind: 'post', text: it.title, title: '', via: KIND_LABEL[c.ch], open: c.ch === 'x' ? 'Open on X' : 'Open the post' });
    if (it.handle) c.handle = it.handle;
  }
  if (Number.isInteger(it.comments) && it.comments > 0) {
    c.comments = it.comments;
    if (!c.open) c.open = c.ch === 'reddit' ? 'Open the thread' : 'Open the post';
  }
  const media = it.media && typeof it.media === 'object' ? it.media : null;
  if (c.ch === 'video' || (media && media.type === 'video')) {
    const yt = ytOf((media && media.url) || it.url);
    const poster = c.thumb || (yt ? 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg' : '');
    if (poster && (yt || app.demo)) Object.assign(c, { kind: 'video', media: poster, thumb: '', yt });
  }
  return c;
}

/* A payload, once, as days of cards. Cached on the payload object. */
const DAYS = new WeakMap();
function dayOf(p) {
  if (DAYS.has(p)) return DAYS.get(p);
  const sources = p.sources && typeof p.sources === 'object' ? p.sources : {};
  const isToday = p.date === todayKey();
  const byId = Object.create(null);
  const card = (it) => { if (!it || !it.id) return null; if (!byId[it.id]) byId[it.id] = toCard(it, sources, isToday); return byId[it.id]; };
  const updates = (Array.isArray(p.updates) ? p.updates : []).map((u) => ({
    label: String(u.label || 'Update'), time: String(u.time || ''),
    lead: u.lead && u.lead.id ? { id: String(u.lead.id), why: String(u.lead.why || '') } : null,
    items: (Array.isArray(u.items) ? u.items : []).map(card).filter(Boolean),
  }));
  const all = updates.flatMap((u) => u.items);
  /* the Brief is pinned, never ranked: the pipeline says so with `brief`;
     until every payload carries it, the newest own edition stands in */
  const own = all.filter((c) => c.own).sort((a, b) => b.d - a.d);
  const brief = (p.brief && card(p.brief)) || own[0] || null;
  const ranked = (list) => (Array.isArray(list) ? list : []).filter((x) => x && !x.own)
    .map((x) => { const c = card(x); return c ? { c, why: String(x.why || ''), rank: Number(x.rank) || 0, at: String(x.ranked_at || '') } : null; })
    .filter(Boolean);
  const picks = ranked(p.picks).sort((a, b) => (a.rank || 99) - (b.rank || 99));
  /* the stories an earlier ranking that day held: newest ranking first, then
     by rank, once each, and never one that is in the current ranking */
  const inPicks = new Set(picks.map((x) => x.c.k));
  const earlier = ranked(p.picks_earlier).filter((x) => !inPicks.has(x.c.k) && (inPicks.add(x.c.k), true))
    .sort((a, b) => (a.at === b.at ? (a.rank || 99) - (b.rank || 99) : a.at < b.at ? 1 : -1));
  const d = { date: p.date, final: !!p.final, isToday, payload: p, updates, all, picks, earlier, brief,
    counts: p.counts || {}, status: p.status || {}, sources, updated: Date.parse(p.updated) || 0, count: Number(p.count) || all.length };
  app.know(all);
  if (brief) app.know([brief]);
  /* every card the day can draw: a pick can outlive its river slot */
  d.cards = [...new Set(all.concat(brief || [], picks.concat(earlier).map((x) => x.c)))];
  app.know(d.cards);
  DAYS.set(p, d);
  return d;
}

/* ---------------------------------------------------------- what shows */
let MUTE = Object.create(null);
function loadMutes() {
  MUTE = Object.create(null);
  Object.keys(store.muted()).forEach((id) => { MUTE[id] = 1; MUTE[canon(id)] = 1; });
}
const seen = (c) => !MUTE[c.sid] && (geo() === 'everything' || c.local || !!follows[c.sid]);
const shows = (c) => seen(c) && (W.ch === 'all' || c.ch === W.ch) && (W.topic === 'all' || c.topic === W.topic);
/* no filter on: the Brief and What matters lead the day */
const unfiltered = () => W.ch === 'all' && W.topic === 'all';
const greenOf = (c) => !!c.local;

/* Chip counts: the pipeline's own, unless a mute or a follow changes what
   this reader sees that day, in which case they are counted here. */
function countsOf(d) {
  const scope = geo() === 'local' ? 'local' : 'everything';
  const touched = d.all.some((c) => MUTE[c.sid] || (follows[c.sid] && !c.local));
  const given = d.counts[scope];
  if (given && !touched && given.all === d.all.filter(seen).length) return given;
  const out = { all: 0 };
  d.all.forEach((c) => { if (seen(c)) { out.all++; out[c.ch] = (out[c.ch] || 0) + 1; } });
  return out;
}
/* the topic row's counts: what this reader sees under the source chip */
function topicCounts(d) {
  const out = {};
  if (d) d.all.forEach((c) => { if (c.topic && seen(c) && (W.ch === 'all' || c.ch === W.ch)) out[c.topic] = (out[c.topic] || 0) + 1; });
  return out;
}
const paused = (d, ch) => !!(d && d.status && d.status[ch] && d.status[ch].paused);
const chipHidden = (d, ch) => (ch === 'x' || ch === 'facebook') && paused(d, ch);

/* ----------------------------------------------------------------- days */
/* The edition dates the archive holds, newest first, plus a today file
   that is still yesterday's paper (just after midnight, before the first
   run, or while the pipeline is stalled). */
function editionDates() {
  const dates = new Set((W.index && Array.isArray(W.index.editions) ? W.index.editions : []).map((e) => e && e.date).filter(isDate));
  if (W.today && isDate(W.today.date) && W.today.date < todayKey()) dates.add(W.today.date);
  return [...dates].sort().reverse();
}
const olderThan = (date) => editionDates().find((d) => d < date) || null;
function newerThan(date) {
  const tk = todayKey();
  const later = editionDates().filter((d) => d > date && d < tk).sort();
  return later[0] || (date < tk ? tk : null);
}
function payloadFor(date) {
  if (W.today && W.today.date === date) return W.today;
  return W.eds[date] && W.eds[date] !== 'failed' ? W.eds[date] : null;
}
const indexEntry = (date) => (W.index && Array.isArray(W.index.editions) ? W.index.editions : []).find((e) => e && e.date === date) || null;
/* one request per edition at a time; a failure is remembered for the page
   (it says so) but the next ask tries again, behind the data layer's backoff */
function loadEdition(date) {
  if (payloadFor(date)) return Promise.resolve(payloadFor(date));
  if (!W.eds['_p' + date]) {
    W.eds['_p' + date] = SRC.edition(date).then((p) => { W.eds[date] = p; delete W.eds['_p' + date]; return p; },
      (e) => { W.eds[date] = 'failed'; delete W.eds['_p' + date]; throw e; });
  }
  return W.eds['_p' + date];
}

/* --------------------------------------------------------------- subnav */
/* Under the mast, top to bottom: the News · Photos · Square switch, in
   words; then for News the dateline, the Local / Everything switch with
   Unfiltered, and the chips on a row of their own (Stephen, 2026-10-17:
   "underneath the local and everything"); for Photos the switch and the
   kinds of picture; for Square the kinds of post. */
let DL = null;
function modeRow() {
  const g = el('div', 'wmodes');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', 'Read the Wire as');
  MODES.filter(([k]) => k !== 'square' || W.squareOk).forEach(([key, label]) => {
    const on = W.mode === key && W.view === 'paper';
    const b = el('button', 'wmode' + (on ? ' on' : ''), esc(label));
    b.type = 'button';
    b.dataset.view = key;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', () => { if (!on) setMode(key); });
    g.appendChild(b);
  });
  return g;
}
/* a chip's colour mark: a dot in the source's colour */
const DOT = '<i class="sdot" aria-hidden="true"></i>';
function subnav() {
  if (W.view === 'paper' && W.mode === 'photos') return photoSubnav();
  if (W.view === 'paper' && W.mode === 'square') return squareSubnav();
  if (!W.today && !W.failed) return null;
  loadMutes();
  const frag = document.createDocumentFragment();
  if (W.view === 'raw') return rawSubnav(frag);
  frag.appendChild(modeRow());
  const dl = el('div', 'dateline');
  const prev = el('button', 'iconbtn nav', ICON.left); prev.setAttribute('aria-label', 'Earlier day');
  const next = el('button', 'iconbtn nav', ICON.right); next.setAttribute('aria-label', 'Later day');
  const label = el('span', 'dl', '<b></b><span class="s"></span>');
  prev.addEventListener('click', () => { const d = olderThan(W.reading || todayKey()); if (d) goDay(d); });
  next.addEventListener('click', () => { const d = newerThan(W.reading || todayKey()); if (d) goDay(d); });
  dl.append(prev, label, next);
  frag.appendChild(dl);
  DL = { prev, next, label };
  paintDateline(W.reading || W.start || todayKey());

  const d = startDay();
  const counts = d ? countsOf(d) : {};
  if (chipHidden(d, W.ch)) W.ch = 'all';
  const items = KINDS.filter(([k]) => !chipHidden(d, k))
    .map(([key, lab]) => ({ key, label: lab, n: key === 'all' ? null : key === 'instagram' ? igCount() : (counts[key] || 0),
      cls: SRC_CH.has(key) ? 'w-src-' + key : '', icon: SRC_CH.has(key) ? DOT : '' }));
  const band = el('div', 'toolband');
  band.appendChild(localSwitch(() => { W.open.clear(); app.paintSubnav(); render(); app.scrollTop(); }));
  const raw = button('Unfiltered ' + ICON.arrow, 'ghost sm w-raw', openRaw);
  raw.dataset.chip = '__raw';
  band.appendChild(raw);
  const row = el('div', 'toolband w-chips');
  row.appendChild(chips(items, W.ch, (k) => {
    W.ch = k;
    history.replaceState(null, '', location.search + '#wire' + (k === 'all' ? '' : '/' + k));
    app.paintSubnav(); render(); app.scrollTop();
  }));
  frag.append(band, row);
  const topics = topicRow(d);
  if (topics) frag.appendChild(topics);
  return frag;
}
/* the topics, one row; a topic with nothing here is left out, unless it is
   the one picked. Instagram's list has no topics. */
function topicRow(d) {
  if (W.ch === 'instagram') return null;
  const n = topicCounts(d);
  const items = TOPICS.filter(([k]) => n[k] || k === W.topic).map(([key, label]) => ({ key, label, n: n[key] || 0 }));
  if (!items.length) { W.topic = 'all'; return null; }
  const row = el('div', 'toolband w-chips w-topics');
  row.appendChild(chips([{ key: 'all', label: 'All topics' }].concat(items), W.topic, (k) => {
    W.topic = k;
    app.paintSubnav(); render(); app.scrollTop();
  }));
  return row;
}

/* ----------------------------------------------------------- Photo mode */
/* The switch, then the count, then the kinds of picture. No Local /
   Everything: every picture here is Burlington's. */
let PDL = null;
function photoSubnav() {
  loadMutes();
  const frag = document.createDocumentFragment();
  frag.appendChild(modeRow());
  const band = el('div', 'toolband');
  const n = el('span', 'dl pm-n', '<span class="s"></span>');
  band.appendChild(n);
  PDL = n.firstChild;
  paintPhotoCount();
  frag.appendChild(band);
  if (photos.loaded()) {
    const row = el('div', 'toolband w-chips');
    row.appendChild(chips(photos.catChips().map((c) => ({ ...c, cls: c.key === 'instagram' ? 'w-src-instagram' : c.key === 'pets' ? 'w-pets' : '', icon: c.key === 'instagram' ? DOT : '' })),
      photos.cat(), (k) => { pickCat(k); }));
    frag.appendChild(row);
  }
  return frag;
}
function pickCat(k) {
  photos.setCat(k);
  W.photoOpen = null;
  app.paintSubnav(); render(); app.scrollTop();
}
function paintPhotoCount() {
  const n = photos.count();
  if (PDL) PDL.textContent = n == null ? '' : plural(n, 'photo', 'photos');
}

/* ------------------------------------------------------------- Square */
function squareSubnav() {
  const frag = document.createDocumentFragment();
  frag.appendChild(modeRow());
  if (square.loaded()) {
    const row = el('div', 'toolband w-chips');
    row.appendChild(chips(square.typeChips().map((c) => ({ ...c, icon: c.cls ? DOT : '' })), square.type(), (k) => {
      square.setType(k); app.paintSubnav(); render(); app.scrollTop();
    }));
    frag.appendChild(row);
  }
  return frag;
}
let squareSeq = 0;
function renderSquare(opts = {}) {
  const root = W.root;
  const seq = ++squareSeq;
  const draw = () => {
    if (seq !== squareSeq || W.mode !== 'square' || W.view !== 'paper') return;
    square.render(root, { limit: opts.limit });
    if (app.activeTab() === 'wire') app.paintSubnav();
    landSquare();
  };
  if (square.loaded()) { draw(); return; }
  root.innerHTML = '<p class="loading">Loading the Square…</p>';
  square.ensure().then(draw);
}
function landSquare() {
  const k = W.squareOpen;
  if (!k) return;
  W.squareOpen = null;
  if (!app.flashHit(W.root, k)) app.toast('That post has moved on.');
}
square.init({
  now: () => SRC.now(),
  ago,
  today: () => (W.today ? dayOf(W.today).cards : []),
  pulse: () => W.pulse,
  needPulse: () => pulseForSquare(),
  showing: () => W.mode === 'square' && W.view === 'paper' && panelOn(),
  panel: () => W.panel,
  redraw: () => redraw(),
});
/* Is the Square live? Asked once a visit; until it is, the switch has two
   words and a kept Square opens on News. */
let squareAsk = null;
function squareReady() {
  if (!squareAsk) {
    squareAsk = app.demo ? Promise.resolve(true) : boards.roundFour().then((v) => v === true, () => false);
    squareAsk.then((ok) => {
      W.squareOk = ok;
      if (!ok && W.mode === 'square') { W.mode = 'news'; if (W.root) render(); }
      if (app.activeTab() === 'wire') app.paintSubnav();
    });
  }
  return squareAsk;
}

/* The switch: the choice is kept on the phone, and the address says which
   view this is, so it can be shared. Focus stays on the switch. */
function setMode(mode) {
  W.mode = mode === 'photos' || mode === 'square' ? mode : 'news';
  photos.remember(W.mode);
  W.view = 'paper';
  W.photoOpen = null;
  history.replaceState(null, '', location.search + '#wire' + (W.mode !== 'news' ? '/' + W.mode : W.start ? '/' + W.start : W.ch !== 'all' ? '/' + W.ch : ''));
  app.paintSubnav(); render(); app.scrollTop();
  const b = document.querySelector('#subnav .wmode[data-view="' + W.mode + '"]');
  if (b) b.focus({ preventScroll: true });
}

/* The Square's hold on the Unfiltered wire (its Facebook and Reddit
   threads): every payload (the first and each poll's) is taken in, and a
   Square already drawn without it, or with an older one, is drawn again
   where the reader is. A failure lets it draw without them and is tried
   again on the next visit. */
let squarePulse = null;
function pulseForSquare() {
  if (!squarePulse) {
    squarePulse = new Promise((res) => SRC.pulse((j) => {
      const fresh = !W.pulse || W.pulse.src !== j;
      pulseReady(j);
      W.pulseTried = false;
      res();
      if (fresh && W.mode === 'square' && W.view === 'paper' && W.root && W.root.querySelector('.sq-feed')) redraw();
    }, () => { W.pulseTried = true; squarePulse = null; res(); }));
  }
  return squarePulse;
}
/* Photo mode draws once its pictures are in: the art board, the gallery and
   Instagram (wire-photos.js). Drawn at once when they are, so a redraw
   keeps the reader's place. */
let photoSeq = 0;
function renderPhotos(opts = {}) {
  const root = W.root;
  const seq = ++photoSeq;
  loadMutes();
  const draw = () => {
    if (seq !== photoSeq || W.mode !== 'photos' || W.view !== 'paper') return;
    const first = !root.querySelector('.pm-head');
    photos.render(root, { limit: opts.limit, until: W.photoOpen || opts.until });
    if (first && app.activeTab() === 'wire') app.paintSubnav();
    paintPhotoCount();
    landPhoto();
  };
  if (photos.loaded()) { draw(); return; }
  root.innerHTML = '<p class="loading">Loading photos…</p>';
  photos.ensure().then(draw);
}
function landPhoto() {
  const k = W.photoOpen;
  if (!k) return;
  W.photoOpen = null;
  if (app.flashHit(W.root, k) && photos.openPicture(k)) return;
  app.toast('That photo has moved on.');
}

photos.init({
  now: () => SRC.now(),
  clockReady: () => (app.demo ? demo.init() : Promise.resolve()),
  ago,
  visible: (v) => !(v.sid && MUTE[v.sid]),
  green: () => true,
  hydrate: (host, keys) => hydrateVotes(host, keys),
  panel: () => W.panel,
  showing: () => W.mode === 'photos' && W.view === 'paper' && panelOn(),
  redraw: () => redraw(),
  onMute: (sid, it) => muteSource(sid, it),
  squareOk: () => !!W.squareOk,
  squareReady: () => squareReady(),
  pickCat: (k) => pickCat(k),
});

/* The dateline names one day: today, or the edition you opened, or the
   earlier day you have scrolled down into. It is repainted in place as you
   scroll, never rebuilt, so the water in the switch beside it keeps moving. */
function paintDateline(date) {
  W.reading = date;
  if (!DL) return;
  const tk = todayKey();
  let sub;
  if (date === tk) {
    const p = W.today && W.today.date === tk ? W.today : null;
    const n = p ? countsOf(dayOf(p)).all : 0;
    sub = n + (n === 1 ? ' story' : ' stories') + ' so far' + (p && p.updated ? ' · updated ' + clock(Date.parse(p.updated)) : '');
  } else {
    const p = payloadFor(date);
    const e = indexEntry(date);
    const n = p ? countsOf(dayOf(p)).all : (e ? Number(e.count) || 0 : 0);
    sub = plural(n, 'story', 'stories') + ' · ' + (!p || p.final ? 'final' : 'as it stood at ' + clock(Date.parse(p.updated)));
  }
  if (W.stale) sub += ' · reconnecting';
  DL.label.firstChild.textContent = dayName(date);
  DL.label.lastChild.textContent = sub;
  DL.prev.disabled = !olderThan(date);
  DL.next.disabled = date >= tk;
}

function startDay() {
  const date = W.start || todayKey();
  const p = payloadFor(date) || (!W.start ? W.today : null);
  return p ? dayOf(p) : null;
}

function goDay(date) {
  const tk = todayKey();
  W.start = !date || date >= tk ? null : date;
  W.flip = null;
  W.slot = null;
  W.reading = W.start || tk;
  W.open.clear();
  W.view = 'paper';
  history.replaceState(null, '', location.search + '#wire' + (W.start ? '/' + W.start : ''));
  if (W.start && !payloadFor(W.start)) {
    app.paintSubnav();
    W.root.innerHTML = '<p class="loading">Loading ' + esc(dayName(W.start)) + '…</p>';
    loadEdition(W.start).then(() => { if (W.start === date) { app.paintSubnav(); render(); app.scrollTop(); } },
      () => { app.toast('That edition didn’t load. Here’s today.'); goDay(null); });
    return;
  }
  app.paintSubnav(); render(); app.scrollTop();
}

/* ------------------------------------------------------------- the paper */
function render(opts = {}) {
  const root = W.root;
  if (!root) return;
  stopRun();
  if (W.view === 'raw') { renderRaw(); return; }
  if (W.mode === 'photos') { renderPhotos(opts); return; }
  if (W.mode === 'square') { renderSquare(opts); return; }
  if (W.ch === 'instagram') { renderInstagram(opts); return; }
  if (W.failed && !W.today) {
    root.innerHTML = '<div class="errbox"><b>Couldn’t reach the wire.</b><br>The paper is served from GitHub. If you are offline it will come back on its own.</div>';
    return;
  }
  if (!W.today) { root.innerHTML = '<p class="loading">Loading the wire…</p>'; return; }
  loadMutes();
  root.innerHTML = '';
  const feed = el('div', 'feed wire' + (THUMBS_LEFT ? ' thumbs-left' : ''));
  root.appendChild(feed);

  const tk = todayKey();
  /* what the reader is shown as the top of today's paper: the bookmark
     saved on leaving is this, never a payload that landed unseen since */
  if (!W.start && W.today && W.today.date === tk && W.view === 'paper') {
    const top = dayOf(W.today).all[0];
    if (top) W.seenTop = { date: tk, k: top.k };
  }
  const date = W.start || tk;
  const p = payloadFor(date);
  const d = p ? dayOf(p) : null;
  const exclude = new Set();
  if (d && unfiltered()) {
    if (d.brief && seen(d.brief)) {
      put(feed, briefPin(d));
      exclude.add(d.brief.k);
    }
    (date === tk ? topMatters(feed, d) : renderMatters(feed, d, false)).forEach((k) => exclude.add(k));
  }
  /* the Brief and the open picks count toward the first sixty */
  const above = feed.querySelectorAll('[data-k]').length;
  const run = {
    feed, exclude, first: date, lastDate: null, queue: [], shown: 0,
    limit: Math.max(FIRST - above, opts.limit || 0), until: opts.until && !exclude.has(opts.until) ? opts.until : null,
    done: false, loading: false, breaks: [], keys: [], alt: 0,
    sentinel: el('div', 'loading'),
  };
  run.sentinel.setAttribute('aria-hidden', 'true');
  feed.appendChild(run.sentinel);
  W.run = run;
  W.reading = date;
  fill(run);
  app.bindFeed(feed, { onSource: sourceSheet, onMute: muteSource });
  watch(run);
}

/* What matters today: number one as the pick card, two to five as ranked
   rows, then one button for the rest of the current ranking and, after a
   small divider, the stories an earlier ranking that day held, each under
   the rank it last had. The list says when it is done. Returns every key
   in the block, open or not, so the river leaves them all out. */
/* no picture: the Brief is a pin above the picks, not a second front page */
function briefPin(d) {
  return mark3(cards.pick({ ...d.brief, media: '', thumb: '', own: false, eyebrow: 'The Brief', why: '' }, { greenLocal: greenOf(d.brief) }), d.brief);
}
function mattersOf(d) {
  const keep = (x) => seen(x.c) && (x.c.local || geo() === 'everything');
  return { list: d.picks.filter(keep), earlier: d.earlier.filter(keep) };
}
const mattersKeys = (d) => { const { list, earlier } = mattersOf(d); return list.concat(earlier).map((x) => x.c.k); };
function renderMatters(host, d, isToday) {
  const wm = mattersBlock(d, isToday);
  if (!wm) return [];
  host.appendChild(wm);
  divider(host, isToday ? 'The rest of today' : 'The rest of the day', geo() === 'local' ? 'local only' : 'every source');
  return mattersKeys(d);
}

/* ---------------------------------------------- three rankings a day */
/* What matters is ranked again about 6 am, noon and 6 pm (Stephen,
   2026-10-17: "making that more apparent ... from earlier in that day").
   The block on top carries Morning · Midday · Evening: the current ranking
   is chosen; an earlier one shows the list as it stood then. A slot is the
   latest ranking in its part of the day, Burlington time. The payload keeps
   the current ranking (`picks`) and, for each story a later ranking dropped,
   its last rank and that ranking's time (`picks_earlier`). The stories an
   earlier ranking shared with the current one are not stored with their
   rank then, so they fill that ranking's other places in today's order,
   when they were posted before it. */
const SLOTS = [['morning', 'Morning'], ['midday', 'Midday'], ['evening', 'Evening']];
const slotOf = (iso) => { const ms = Date.parse(iso || ''); if (!ms) return null; const h = etHour(ms); return h < 11 ? 'morning' : h < 17 ? 'midday' : 'evening'; };
function rankings(d) {
  const cur = d.picks.map((x) => x.at).filter(Boolean).sort().pop() || String(d.payload.updated || '');
  const slots = Object.create(null);
  d.earlier.forEach((x) => { const sl = slotOf(x.at); if (sl && (!slots[sl] || slots[sl].at < x.at)) slots[sl] = { at: x.at }; });
  const now = d.picks.length ? slotOf(cur) : null;
  if (now) slots[now] = { at: cur, current: true };
  return { slots, now };
}
function asItStood(d, at) {
  const t = Date.parse(at) / 1000;
  const dropped = d.earlier.filter((x) => x.at === at).sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const carried = d.picks.filter((x) => x.c.d && x.c.d <= t);
  const out = [];
  let r = 1, di = 0, ci = 0;
  while (di < dropped.length || ci < carried.length) {
    if (di < dropped.length && ((dropped[di].rank || 99) <= r || ci >= carried.length)) { out.push({ ...dropped[di], n: dropped[di].rank || r }); di++; }
    else { out.push({ ...carried[ci], n: r }); ci++; }
    r++;
  }
  const keep = (x) => seen(x.c) && (x.c.local || geo() === 'everything');
  return out.filter(keep);
}
/* Morning · Midday · Evening, on the block's head */
function slotRow(d, isToday) {
  const { slots, now } = rankings(d);
  if (!now && !Object.keys(slots).length) return null;
  const want = W.slot && slots[W.slot] ? W.slot : now;
  const g = el('div', 'wm-slots');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', isToday ? 'Today’s rankings' : 'That day’s rankings');
  SLOTS.forEach(([key, label]) => {
    const has = !!slots[key];
    const b = el('button', 'wm-slot' + (key === want ? ' on' : ''), esc(label) + (has ? '<span class="t">' + esc(clock(Date.parse(slots[key].at))) + '</span>' : ''));
    b.type = 'button';
    b.dataset.slot = key;
    b.disabled = !has;
    b.setAttribute('aria-pressed', key === want ? 'true' : 'false');
    b.addEventListener('click', () => { if (has && key !== want) reslot(key === now ? null : key); });
    g.appendChild(b);
  });
  return { row: g, slots, now, want };
}
function reslot(slot) {
  W.slot = slot;
  const old = W.root && W.root.querySelector('.wm.wm-top');
  const tp = payloadFor(todayKey());
  if (!old || !tp) return;
  const today = dayOf(tp);
  const past = W.flip && payloadFor(W.flip);
  const node = flipBlock(past ? dayOf(past) : today, today);
  old.replaceWith(node);
  hydrateVotes(node, [...node.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
  const b = node.querySelector('.wm-slot.on');
  if (b) b.focus({ preventScroll: true });
}
/* an earlier ranking, as it stood: its rows, five open, the rest on request */
function stoodBlock(wm, d, at) {
  const list = asItStood(d, at);
  wm.appendChild(el('p', 'wm-was wm-stood', esc('As it stood at ' + clock(Date.parse(at)))));
  if (!list.length) { wm.appendChild(el('p', 'wm-end', esc('No ' + (geo() === 'local' ? 'local ' : '') + 'picks then.'))); return; }
  list.slice(0, PICKS_OPEN).forEach((x) => wm.appendChild(wmRow(x.c, x.why, x.n)));
  const rest = list.slice(PICKS_OPEN);
  if (!rest.length) return;
  const more = button(esc(plural(rest.length, 'more pick', 'more picks')), 'ghost more', () => {
    const f = document.createDocumentFragment();
    rest.forEach((x) => f.appendChild(wmRow(x.c, x.why, x.n)));
    const rows = [...f.querySelectorAll('[data-k]')];
    more.replaceWith(f);
    const a = rows[0] && rows[0].querySelector('a');
    if (a) a.focus({ preventScroll: true });
    hydrateVotes(wm, rows.map((r) => r.dataset.k));
  });
  wm.appendChild(more);
}

/* The block itself. `nav`, on today's block only, goes on its head: the
   ‹ › that flip it through earlier days. A flipped day with nothing to show
   in this view still draws its head, so the arrows stay where they were. */
function mattersBlock(d, isToday, nav) {
  const { list, earlier } = mattersOf(d);
  if (!list.length && !earlier.length && !nav) return null;
  const wm = el('div', 'wm');
  section(wm, isToday ? 'What matters today' : 'What mattered ' + weekday(d.date), nav && !isToday ? esc(dayName(d.date).split(', ')[1] || '') : '', nav || null);
  const sl = nav ? slotRow(d, isToday) : null;
  if (sl) {
    wm.appendChild(sl.row);
    if (sl.want && sl.want !== sl.now) { stoodBlock(wm, d, sl.slots[sl.want].at); return wm; }
  }
  if (!list.length && !earlier.length) {
    wm.appendChild(el('p', 'wm-end', esc('No ' + (geo() === 'local' ? 'local ' : '') + 'picks ' + (isToday ? 'yet today.' : 'that day.'))));
    return wm;
  }
  const [first] = list;
  if (first) put(wm, mark3(cards.pick({ ...first.c, media: first.c.thumb, thumb: '', eyebrow: '1 of ' + list.length, why: first.why }, { greenLocal: greenOf(first.c) }), first.c));
  list.slice(1, PICKS_OPEN).forEach((x, i) => wm.appendChild(wmRow(x.c, x.why, i + 2)));
  const rest = list.slice(PICKS_OPEN);
  const total = list.length + earlier.length;
  const end = () => el('p', 'wm-end', esc('That’s all ' + words(total) + '.'));
  const behind = () => {
    const f = document.createDocumentFragment();
    rest.forEach((x, i) => f.appendChild(wmRow(x.c, x.why, i + PICKS_OPEN + 1)));
    if (earlier.length) {
      f.appendChild(el('p', 'wm-was', esc(isToday ? 'Earlier today, these mattered too' : 'Earlier that day')));
      earlier.forEach((x) => f.appendChild(wmRow(x.c, x.why, x.rank || '·', true)));
    }
    f.appendChild(end());
    return f;
  };
  const hidden = rest.length + earlier.length;
  /* nothing of the current ranking shows here (all muted, say): the earlier
     picks stand on their own, open */
  if (hidden && (W.open.has(d.date) || !list.length)) wm.appendChild(behind());
  else if (hidden) {
    const more = button(esc(plural(hidden, 'more pick', 'more picks')), 'ghost more', () => {
      W.open.add(d.date);
      const f = behind();
      const rows = [...f.querySelectorAll('[data-k]')];
      more.replaceWith(f);
      /* the reader asked for these: move focus to the first, not the top */
      const a = rows[0] && rows[0].querySelector('a');
      if (a) a.focus({ preventScroll: true });
      hydrateVotes(wm, rows.map((r) => r.dataset.k));
    });
    wm.appendChild(more);
  } else if (list.length > 1) wm.appendChild(end());
  return wm;
}

/* Today's block, with ‹ › on its head (Stephen, 2026-10-17: "an arrow next
   to it as well so people can easily see past What Matters picks"). The
   arrows swap the block in place to an earlier day's picks from the frozen
   editions; the river below stays today's and still leaves out today's
   picks, whatever the block shows, so flipping never changes it (a past
   pick that recurs today can show in the river, which is fine). W.flip is
   the day shown, kept for the visit only: a reload opens on today. Returns
   today's keys, for the river to leave out. Before the day's first ranking
   (or with every pick muted) the block still stands, saying so, while there
   may be earlier days to flip to. */
function topMatters(host, d) {
  const keys = mattersKeys(d);
  if (!keys.length && W.idxDone && !olderThan(d.date)) { W.flip = null; return []; }
  const past = W.flip && payloadFor(W.flip);
  if (!past) W.flip = null;
  host.appendChild(flipBlock(past ? dayOf(past) : d, d));
  divider(host, 'The rest of today', geo() === 'local' ? 'local only' : 'every source');
  return keys;
}
const FLIP_PREV = 'Earlier day\'s picks';
const FLIP_NEXT = 'Later day\'s picks';
function flipBlock(shown, today) {
  const isToday = shown === today;
  const nav = el('div', 'wm-nav');
  const prev = el('button', 'iconbtn nav', ICON.left); prev.setAttribute('aria-label', FLIP_PREV);
  const next = el('button', 'iconbtn nav', ICON.right); next.setAttribute('aria-label', FLIP_NEXT);
  /* the archive's index can land after the block: asked at the click, and
     the disabled state repainted when it lands (paintFlip) */
  prev.disabled = !olderThan(shown.date);
  next.disabled = isToday;
  prev.addEventListener('click', () => { const d = olderThan(shown.date); if (d) flipTo(d, FLIP_PREV); });
  next.addEventListener('click', () => { if (!isToday) flipTo(newerThan(shown.date), FLIP_NEXT); });
  nav.append(prev, next);
  const wm = mattersBlock(shown, isToday, nav);
  wm.classList.add('wm-top');
  wm.dataset.showing = shown.date;
  if (!isToday) {
    const sub = wm.querySelector('.sec p');
    const back = el('button', 'wm-today', 'Today');
    back.addEventListener('click', () => flipTo(null, FLIP_NEXT));
    if (sub) sub.append(' · ', back);
  }
  return wm;
}
function paintFlip() {
  const wm = W.root && W.root.querySelector('.wm.wm-top');
  const prev = wm && !wm.hasAttribute('aria-busy') && wm.querySelector('.wm-nav .nav[aria-label="' + FLIP_PREV + '"]');
  if (prev) prev.disabled = !olderThan(wm.dataset.showing);
}
let flipSeq = 0;
function flipTo(date, again) {
  const tk = todayKey();
  const target = !date || date >= tk ? null : date;
  const seq = ++flipSeq;
  const swap = (to) => {
    const old = W.root && W.root.querySelector('.wm.wm-top');
    const tp = payloadFor(tk);
    if (seq !== flipSeq || !old || !tp) return;
    const today = dayOf(tp);
    const past = to && payloadFor(to);
    W.flip = past ? to : null;
    W.slot = null;
    const node = flipBlock(past ? dayOf(past) : today, today);
    node.classList.add('flip-in');   /* a short fade; none under reduced motion */
    old.replaceWith(node);
    hydrateVotes(node, [...node.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
    /* keep the reader's place: the arrow they pressed, or the other one at an end */
    const btn = [...node.querySelectorAll('.wm-nav .nav')];
    const want = btn.find((b) => b.getAttribute('aria-label') === again && !b.disabled) || btn.find((b) => !b.disabled);
    if (want) want.focus({ preventScroll: true });
  };
  if (!target || payloadFor(target)) { swap(target); return; }
  const old = W.root && W.root.querySelector('.wm.wm-top');
  if (old) { old.setAttribute('aria-busy', 'true'); old.querySelectorAll('.wm-nav .nav').forEach((b) => { b.disabled = true; }); }
  loadEdition(target).then(() => swap(target), () => {
    if (seq !== flipSeq) return;
    app.toast('That day’s picks didn’t load.');
    swap(W.flip);
  });
}

/* a ranked row: the numeral, the title, the reason, then the foot line */
function wmRow(it, why, n, was) {
  const on = store.hasVoted(it.k);
  const r = el('article', 'wm-row card fi' + (was ? ' was' : '') + (store.isRead(it.k) ? ' is-read' : ''));
  r.dataset.k = it.k;
  const ext = /^https?:/.test(it.href || '');
  r.innerHTML = '<span class="num">' + esc(n) + '</span><div><a class="c-title" href="' + esc(safeHref(it.href)) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + ' data-open>' + esc(it.title || it.text) + '</a>' +
    (why ? '<p class="why">' + esc(why) + '</p>' : '') +
    '<div class="c-foot"><button class="srcbtn" data-src="' + esc(it.sid || it.src) + '">' + mark(it.src, 'xs') + '<span class="c-src' + (greenOf(it) ? ' is-local' : '') + '">' + esc(it.src) + '</span></button>' +
    (it.ago ? '<span class="dot"></span><span class="age">' + esc(it.ago) + '</span>' : '') +
    '<button class="mini up' + (on ? ' on' : '') + '" data-act="up" aria-label="Upvote" aria-pressed="' + on + '">' + ICON.up + '<span class="n">' + (((Number(it.votes) || 0) + store.voteCount(it.k)) || '') + '</span></button>' +
    '<button class="mini sh" data-act="share" aria-label="Share">' + ICON.share + '</button></div></div>' +
    '<button class="act star' + (store.isSaved(it.k) ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + store.isSaved(it.k) + '">' + ICON.star + '</button>';
  return mark3(r, it);
}

/* One item in the river. A plain headline is the tight row; posts, videos
   and an update's lead get the bigger cards. */
function draw(c, leadWhy, every) {
  const o = { greenLocal: greenOf(c), noComments: !c.comments };
  let n;
  if (c.kind === 'video') n = cards.video(c, o);
  else if (c.kind === 'post') n = cards.post(c, o);
  else if (leadWhy) n = cards.pick({ ...c, media: c.thumb, thumb: '', why: leadWhy, eyebrow: 'The lead' }, o);
  else n = cards.row(c, o);
  return mark3(n, c, every);
}
/* The Wire's colour on a card: its source's mark (X, Facebook, Reddit,
   Instagram, a newsletter) as a left accent, and the green local tint on
   Everything, where local and national share the list (Stephen,
   2026-10-17: "in my old All Day feed, something local was usually green"). */
function mark3(n, c, every = geo() === 'everything') {
  if (!n) return n;
  if (SRC_CH.has(c.ch)) n.classList.add('w-src-' + c.ch);
  if (c.local && every) n.classList.add('w-local');
  const meta = n.querySelector('.c-foot, .c-head');
  if (meta && !meta.querySelector('.geo-tag')) {
    const tag = el('span', 'tag geo-tag ' + (c.local ? 'tag-local' : 'tag-national'), c.local ? 'Local' : 'National');
    const age = meta.querySelector('.age');
    if (age) age.after(tag); else meta.appendChild(tag);
  }
  return n;
}

/* The entries one day adds to the river: its head (unless it is the day the
   page opened on), its updates under their time dividers, and the
   new-since line on today. */
function entriesFor(run, date, p) {
  const out = [];
  const tk = todayKey();
  const isFirst = date === run.first;
  if (!isFirst) {
    const n = p ? countsOf(dayOf(p)).all : 0;
    out.push({ head: date, title: (date === dayBefore(tk) ? 'Yesterday, ' : '') + dayName(date),
      sub: plural(n, 'story', 'stories') + ' · ' + (!p || p.final ? 'final' : 'as it stood at ' + clock(Date.parse(p.updated))) });
  }
  const d = p ? dayOf(p) : null;
  /* an earlier day opens with its own What mattered block, drawn as the
     arrow view draws it, and its river leaves those stories out */
  let exclude = isFirst ? run.exclude : new Set();
  if (!isFirst && d && unfiltered()) {
    /* and its Brief pinned above it, as the arrow view pins it */
    if (d.brief && seen(d.brief)) { out.push({ pin: d }); exclude.add(d.brief.k); }
    const { list, earlier } = mattersOf(d);
    if (list.length || earlier.length) {
      list.concat(earlier).forEach((x) => exclude.add(x.c.k));
      out.push({ matters: d });
    }
  }
  const items = [];
  (d ? d.updates : []).forEach((u) => {
    const list = u.items.filter((c) => shows(c) && !exclude.has(c.k));
    if (!list.length) return;
    out.push({ divider: u.label, sub: u.time ? 'updated ' + u.time : '' });
    list.forEach((c, i) => {
      const e = { c, why: i === 0 && u.lead && u.lead.id === c.k ? u.lead.why : '' };
      out.push(e);
      items.push(e);
    });
  });
  /* You left off here: the bookmark above the story that was at the top of
     today's paper when the reader last left it (his girlfriend, 2026-10-17:
     "another type of bookmark to show where you were last time"). Every
     story above it came in since. Without one for today, the older line:
     how many are new since the last visit, under the last of them. */
  const left = date === tk && isFirst ? leftFor(d, items) : null;
  if (left) {
    out.splice(out.indexOf(left.before), 0, { left: left.at });
  } else if (date === tk && isFirst) {
    const base = SRC.base();
    const fresh = base ? items.filter((e) => e.c.d > base) : [];
    const last = fresh.length ? items.indexOf(fresh[fresh.length - 1]) : -1;
    if (fresh.length && last < items.length - 1) {
      out.splice(out.indexOf(items[last]) + 1, 0, { newline: fresh.length + ' new since you were here at ' + clock(base * 1000) });
    }
  }
  if (!items.length) {
    const topic = W.topic === 'all' ? '' : ' on ' + (TOPICS.find((x) => x[0] === W.topic) || ['', ''])[1];
    const kind = (W.ch === 'all' ? '' : ' from ' + (KINDS.find((x) => x[0] === W.ch) || ['', W.ch])[1]) + topic;
    out.push({ note: date === tk
      ? (unfiltered() && !(d && d.all.length) ? 'Nothing yet today.' : 'Nothing' + kind + ' today so far.')
      : 'Nothing' + (kind || (geo() === 'local' ? ' local' : '')) + ' that day.' });
  }
  return out;
}

/* ---------------------------------------------------- the Instagram chip */
/* The local accounts' posts as a list, newest first, under the same
   switches: a headline row each, its picture as the thumbnail, the caption's
   first line as the title. The end offers the same posts as photos. */
function loadIg() {
  if (!W.igP) {
    W.igP = photos.instagram().then((posts) => {
      W.ig = Array.isArray(posts) ? posts : [];
      if (app.activeTab() === 'wire' && W.mode === 'news' && W.view === 'paper') {
        app.paintSubnav();
        if (W.ch === 'instagram') render();
      }
    }, () => { W.ig = []; });
  }
  return W.igP;
}
function igRows() {
  return photos.igList(W.ig).filter((v) => !MUTE[v.sid]);
}
function igCount() { return W.ig ? igRows().length : null; }
let igRun = null;
function renderInstagram(opts = {}) {
  const root = W.root;
  loadMutes();
  if (!W.ig) { root.innerHTML = '<p class="loading">Loading Instagram…</p>'; loadIg(); return; }
  root.innerHTML = '';
  const feed = el('div', 'feed wire' + (THUMBS_LEFT ? ' thumbs-left' : ''));
  root.appendChild(feed);
  const list = igRows();
  if (!list.length) { feed.appendChild(el('p', 'empty', 'No Instagram posts today.')); return; }
  const run = { i: 0, dead: false, sentinel: el('div', 'loading') };
  if (igRun) igRun.dead = true;
  igRun = run;
  feed.appendChild(run.sentinel);
  const step = (n) => {
    if (run.dead || igRun !== run) return;
    const added = [];
    while (run.i < list.length && n-- > 0) {
      const v = list[run.i++];
      const node = cards.row({ ...v.it, title: v.cap, thumb: v.media, ago: v.it.ago }, { greenLocal: true, noComments: true });
      if (!node) continue;
      node.classList.add('w-src-instagram');
      if (run.i % 2 === 0) node.classList.add('w-alt');
      feed.insertBefore(node, run.sentinel);
      added.push(v.k);
    }
    W.igShown = run.i;
    if (added.length) hydrateVotes(feed, added);
    if (run.i >= list.length) {
      run.sentinel.remove();
      feed.appendChild(cards.caught({ title: 'That’s Instagram today', check: false,
        buttons: [button('See them as photos', '', () => { photos.setCat('instagram'); setMode('photos'); })] }));
      return;
    }
    requestAnimationFrame(() => { if (!run.dead && near(run)) step(CHUNK); });
  };
  step(Math.max(FIRST, opts.limit || 0));
  if ('IntersectionObserver' in window && W.panel) {
    observer = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !run.dead) step(CHUNK); },
      { root: W.panel, rootMargin: '0px 0px ' + AHEAD + 'px 0px' });
    observer.observe(run.sentinel);
  }
  app.bindFeed(feed, { onSource: () => {}, onMute: muteSource });
}

/* ------------------------------------------------------- left off here */
/* Kept on the phone (`allday-wire-left`, { date, k, at }): the story at the
   top of today's paper, every source, as it was last drawn for the reader
   (W.seenTop; a payload that lands while they are elsewhere does not move
   it), saved when they leave the tab or the page. The demo keeps it for
   the visit only. */
const LEFT_KEY = 'allday-wire-left';
let leftMem = null;
function readLeft() {
  if (app.demo) return leftMem;
  try { const v = JSON.parse(localStorage.getItem(LEFT_KEY) || 'null'); return v && isDate(v.date) && v.k ? v : null; } catch (e) { return null; }
}
function saveLeft() {
  const top = W.seenTop;
  if (!top || top.date !== todayKey()) return;
  const v = { date: top.date, k: top.k, at: Math.floor(SRC.now() / 1000) };
  if (app.demo) { leftMem = v; return; }
  try { localStorage.setItem(LEFT_KEY, JSON.stringify(v)); } catch (e) { /* private mode: no bookmark */ }
}
/* where the bookmark goes in today's drawn list: before the first drawn
   story at or below the one that was on top, when something new is above it */
function leftFor(d, items) {
  const v = W.left;
  if (!v || v.date !== d.date || !items.length) return null;
  const idx = d.all.findIndex((c) => c.k === v.k);
  if (idx <= 0) return null;
  const pos = new Map(d.all.map((c, i) => [c.k, i]));
  const i = items.findIndex((e) => (pos.has(e.c.k) ? pos.get(e.c.k) : -1) >= idx);
  if (i <= 0) return null;
  return { before: items[i], at: v.at };
}
const leftMark = (at) => {
  const n = cards.newline('You left off here' + (at ? ' · ' + clock(at * 1000) : ''));
  n.classList.add('w-left');
  return n;
};

/* Draw until the limit (or until a shared key is on the page), fetching the
   next edition when today runs out. Called again as the reader nears the
   bottom. */
function fill(run) {
  if (W.run !== run || run.done) return;
  const added = [];
  const every = geo() === 'everything';
  while (run.shown < run.limit || run.until) {
    if (!run.queue.length) {
      const date = run.lastDate == null ? run.first : olderThan(run.lastDate);
      if (!date) { finish(run); break; }
      const p = payloadFor(date);
      if (!p && date !== todayKey()) {
        if (!run.loading) {
          run.loading = true;
          run.sentinel.textContent = 'Loading ' + weekday(date) + '…';
          loadEdition(date).then(() => { run.loading = false; fill(run); }, () => {
            run.loading = false;
            run.lastDate = date;
            run.queue.push({ head: date, title: dayName(date), sub: 'didn’t load' }, { note: 'That edition didn’t load. The next one is below.' });
            fill(run);
          });
        }
        break;
      }
      run.queue = entriesFor(run, date, p);
      run.lastDate = date;
      continue;
    }
    const e = run.queue.shift();
    let node = null;
    if (e.head) {
      const h = el('div');
      section(h, e.title, esc(e.sub));
      node = h.firstChild;
      node.dataset.day = e.head;
      run.breaks.push({ date: e.head, node });
    } else if (e.divider) {
      const h = el('div');
      divider(h, e.divider, e.sub);
      node = h.firstChild;
      run.alt = 0;
    } else if (e.pin) {
      node = briefPin(e.pin);
      if (node) { run.shown++; added.push(e.pin.brief.k); }
    } else if (e.matters) {
      const box = el('div');
      renderMatters(box, e.matters, false);
      const keys = [...box.querySelectorAll('[data-k]')].map((n) => n.dataset.k);
      while (box.firstChild) run.feed.insertBefore(box.firstChild, run.sentinel);
      run.shown += keys.length;
      added.push(...keys);
    } else if (e.newline) node = cards.newline(e.newline);
    else if (e.note) node = el('p', 'note pad', esc(e.note));
    else if (e.c) {
      node = draw(e.c, e.why, every);
      if (node) {
        run.shown++; added.push(e.c.k);
        /* a faint tint on every other row, so a long list is easier on the eyes */
        if (node.classList.contains('row') && (run.alt++ % 2)) node.classList.add('w-alt');
      }
      if (run.until && e.c.k === run.until) run.until = null;
    } else if (e.left) node = leftMark(e.left);
    if (node) run.feed.insertBefore(node, run.sentinel);
  }
  if (!run.loading && !run.done) run.sentinel.textContent = '';
  if (added.length) hydrateVotes(run.feed, added);
  requestAnimationFrame(() => topUp(run));
}

/* the real end: the editions ran out, and the page says so */
function finish(run) {
  run.done = true;
  run.until = null;
  run.sentinel.textContent = '';
  const days = editionDates().length;
  run.end = cards.caught(days ? {
    title: 'That’s the whole archive',
    buttons: [button('Back to today', '', () => goDay(null))], check: false,
  } : {
    title: 'That’s today so far',
    text: W.idxDone ? '' : 'Earlier editions didn’t load. They come back when the connection does.',
    buttons: [button('Unfiltered ' + ICON.arrow, 'ghost', openRaw)],
  });
  run.feed.insertBefore(run.end, run.sentinel);
}

/* the next chunk starts drawing a screen and a half before the bottom */
const panelOn = () => W.panel && !W.panel.hidden && app.activeTab() === 'wire';
function near(run) {
  if (!panelOn() || !run.sentinel.isConnected) return false;
  return run.sentinel.getBoundingClientRect().top - W.panel.getBoundingClientRect().bottom < AHEAD;
}
function topUp(run) {
  if (W.run !== run || run.done || run.loading || !near(run)) return;
  run.limit = run.shown + CHUNK;
  fill(run);
}
let observer = null;
function watch(run) {
  if (!('IntersectionObserver' in window) || !W.panel) return;
  observer = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) topUp(run); },
    { root: W.panel, rootMargin: '0px 0px ' + AHEAD + 'px 0px' });
  observer.observe(run.sentinel);
}
function stopRun() {
  photos.stop();
  square.stop();
  if (igRun) { igRun.dead = true; igRun = null; }
  if (observer) { observer.disconnect(); observer = null; }
  if (W.raw.run) W.raw.run.dead = true;
  W.run = null;
}

/* which day is under the mast: the dateline follows the scroll */
let tracking = 0;
function track() {
  if (tracking) return;
  if (W.view === 'paper' && W.mode === 'photos') { tracking = requestAnimationFrame(() => { tracking = 0; photos.topUp(); }); return; }
  if (W.view !== 'paper' || !W.run) return;
  tracking = requestAnimationFrame(() => {
    tracking = 0;
    const run = W.run;
    if (!run) return;
    topUp(run);   /* belt and braces for a browser without IntersectionObserver */
    const line = document.getElementById('mast').getBoundingClientRect().bottom + 40;
    let date = run.first;
    for (const b of run.breaks) { if (b.node.getBoundingClientRect().top < line) date = b.date; else break; }
    if (date !== W.reading) paintDateline(date);
  });
}

/* One request for the new rows' vote counts; paint them when they land. */
function hydrateVotes(host, keys) {
  store.loadVotes(keys).then((ok) => {
    if (!ok) return;
    keys.forEach((k) => host.querySelectorAll('[data-k="' + CSS.escape(k) + '"] [data-act="up"] .n').forEach((n) => {
      const it = app.item(k);
      n.textContent = ((it && Number(it.votes)) || 0) + store.voteCount(k) || '';
    }));
  });
}

/* ------------------------------------------------------- mute and source */
/* Outlets that publish twice (Seven Days' wire and its email edition) name
   their main feed in pulse.json's "og"; a mute covers both. */
const srcs = () => (W.pulse && W.pulse.map) || {};
const canon = (sid) => { const s = srcs()[sid]; return s && s.og && srcs()[s.og] ? s.og : sid; };
const kin = (sid) => Object.keys(srcs()).filter((id) => canon(id) === canon(sid));

function muteSource(sid, it) {
  const name = (it && (it.src || it.author)) || app.sourceName(sid);
  const ids = [...new Set([sid].concat(kin(sid)))];
  app.confirmBox({
    title: 'Mute ' + name + '?',
    body: 'You won’t see ' + name + ' anywhere in All Day, or on the Pulse page. Bring it back any time in Settings.',
    yes: 'Mute',
    onYes() {
      ids.forEach((id) => store.setMuted(id, true));
      app.refresh();
      app.toast('Muted ' + name, () => { ids.forEach((id) => store.setMuted(id, false)); app.refresh(); });
    },
  });
}

/* An "Open ↗" link in a sheet. Demo links go nowhere, and say so. */
function openLink(label, href) {
  const a = el('a', 'btn ghost', esc(label) + ' ' + ICON.ext);
  a.href = safeHref(href);
  a.target = '_blank'; a.rel = 'noopener';
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast(label + ' in the real build'); });
  return a;
}

/* Tap a source: what it is, its items that day, Follow, Mute, and the way
   to the original (the X account, the post, the site). */
function sourceSheet(sid, from) {
  if (W.view === 'raw') { rawSourceSheet(sid, from); return; }
  const day = [startDay(), W.today && dayOf(W.today)].concat(Object.keys(W.eds).filter(isDate).map((dt) => payloadFor(dt)).filter(Boolean).map(dayOf))
    .find((d) => d && (!from || d.cards.includes(from))) || startDay();
  const items = day ? day.cards.filter((c) => c.sid === sid) : [];
  const first = from || items[0] || {};
  const info = (day && day.sources[sid]) || {};
  const name = first.src || info.name || app.sourceName(sid);
  const ch = first.ch || info.ch || 'local';
  const when = !day || day.date === todayKey() ? 'today' : weekday(day.date);
  app.sheet(name, (body, card, close) => {
    body.appendChild(el('div', 'srchead', mark(name, ch === 'x' || ch === 'facebook' ? 'round xl' : 'xl') + '<div><div class="k">' +
      esc(KIND_LABEL[ch] || 'Source') + (first.local && ch !== 'local' ? ' · Local' : '') + '</div><div class="n">' + esc(plural(items.length, 'story', 'stories') + ' ' + when) + '</div></div>'));
    const row = el('div', 'linkrow');
    /* Follow is for a source outside Burlington: it then shows on Local
       too. A local source is always there, so it gets no Follow button. */
    if (!first.local) {
      const fol = button('', '', () => { setFollow(sid, !follows[sid]); paintFol(); app.refresh(); });
      const paintFol = () => { fol.textContent = follows[sid] ? 'Following ✓' : 'Follow'; fol.classList.toggle('ghost', !follows[sid]); };
      paintFol();
      row.appendChild(fol);
    }
    row.appendChild(button('Mute', 'ghost', () => { close(); muteSource(sid, first); }));
    const handle = first.handle || (String(sid).startsWith('x:') ? String(sid).slice(2) : '');
    if (handle) row.appendChild(openLink('Open on X', 'https://x.com/' + encodeURIComponent(handle.replace(/^@/, ''))));
    else if (ch === 'facebook' && first.href) row.appendChild(openLink('Open the post', first.href));
    else if (/^https?:/i.test(info.site || '')) row.appendChild(openLink('Open the site', info.site));
    else if (first.href) row.appendChild(openLink('Open the post', first.href));
    body.appendChild(row);
    if (items.length) {
      body.appendChild(el('div', 'sheet-h', esc((when === 'today' ? 'Today' : when) + ' from ' + name)));
      const f = el('div', 'feed tight');
      items.slice(0, 12).forEach((c) => put(f, c.kind === 'headline' ? cards.row(c, { noComments: !c.comments }) : draw(c)));
      body.appendChild(f);
      app.bindFeed(f, { onSource() {}, onMute: muteSource });
    }
  });
}

/* ------------------------------------------------------------ Unfiltered */
/* Every headline on pulse.json, newest first or by outlet, with the outlet
   chips and search the app has always had. Keys are URLs here, as they
   were before the rebuild, so old saves, reads and shared links still land. */
const keyOf = (it) => it.u || it.o || it.t;
function pulseReady(j) {
  if (W.pulse && W.pulse.src === j) return W.pulse;
  const map = Object.create(null);
  (j.sources || []).forEach((s) => { if (s && s.id) map[s.id] = s; });
  const isLocal = (s) => !!s && (s.local === 1 || s.topic === 'local');
  const seenK = new Set();
  const items = (j.items || []).filter((it) => it && it.u && it.t && map[it.s]).sort((a, b) => (b.d || 0) - (a.d || 0))
    .filter((it) => (seenK.has(keyOf(it)) ? false : (seenK.add(keyOf(it)), true)));
  W.pulse = { src: j, map, items: [], isLocal };
  W.pulse.items = items.map((it) => {
    const s = map[it.s];
    return { k: keyOf(it), kind: 'headline', title: it.t, href: it.u, d: Number(it.d) || 0, src: s.short || s.name || it.s,
      sid: canon(it.s), local: isLocal(s), ch: 'raw', thumb: it.i || '', ago: it.d ? ago(it.d * 1000) : '' };
  });
  app.know(W.pulse.items);
  return W.pulse;
}
function withPulse(then) {
  if (W.pulse) { then(); return; }
  SRC.pulse((j) => { pulseReady(j); then(); }, () => { W.pulseTried = true; then(true); });
}

function openRaw() {
  W.view = 'raw';
  history.replaceState(null, '', location.search + '#wire/unfiltered');
  app.paintSubnav(); render(); app.scrollTop();
  if (!W.pulse) withPulse(() => { if (W.view === 'raw') { app.paintSubnav(); render(); } });
}
function closeRaw() {
  W.view = 'paper'; W.raw.outlet = ''; W.raw.q = '';
  history.replaceState(null, '', location.search + '#wire' + (W.start ? '/' + W.start : ''));
  app.paintSubnav(); render(); app.scrollTop();
}
const rawLayout = () => (store.settings().layout === 'sources' ? 'sources' : 'newest');

function outletsOf(P) {
  const counts = Object.create(null);
  P.items.forEach((c) => { if (!MUTE[c.sid]) counts[c.sid] = (counts[c.sid] || 0) + 1; });
  return Object.keys(counts).map((id) => P.map[id]).filter(Boolean)
    .sort((a, b) => (P.isLocal(b) - P.isLocal(a)) || ((a.pr || 500) - (b.pr || 500)) || String(a.short || a.name).localeCompare(String(b.short || b.name)))
    .map((s) => ({ key: s.id, label: s.short || s.name, n: counts[s.id], cls: P.isLocal(s) ? 'local' : '' }));
}

function rawSubnav(frag) {
  const dl = el('div', 'dateline every');
  dl.appendChild(button(ICON.left + ' Today’s paper', 'ghost sm back', closeRaw));
  const P = W.pulse;
  const tk = todayKey();
  const n = P ? P.items.filter((c) => etDay(c.d * 1000) === tk).length : 0;
  dl.appendChild(el('span', 'dl', '<b>Unfiltered</b><span class="s">' + (P ? esc(n ? n.toLocaleString('en-US') + ' today' : P.items.length.toLocaleString('en-US') + ' headlines') : '') + '</span>'));
  frag.appendChild(dl);
  if (P) {
    frag.appendChild(chips([{ key: '', label: 'All outlets' }].concat(outletsOf(P)), W.raw.outlet, (k) => {
      W.raw.outlet = W.raw.outlet === k ? '' : k;
      app.paintSubnav(); render(); app.scrollTop();
    }, 'outlets'));
  }
  return frag;
}

function renderRaw() {
  const root = W.root;
  loadMutes();
  root.innerHTML = '';
  if (!W.pulse) { root.innerHTML = '<p class="loading">Loading every headline…</p>'; return; }
  const feed = el('div', 'feed');
  root.appendChild(feed);
  const tools = el('div', 'toolrow');
  tools.appendChild(pills([['newest', 'Newest first'], ['sources', 'By outlet']], rawLayout(), (v) => { store.setSetting('layout', v); renderRawList(); }));
  const q = el('input', 'field');
  q.type = 'search'; q.placeholder = 'Search every headline'; q.autocomplete = 'off';
  q.setAttribute('aria-label', 'Search every headline');
  q.value = W.raw.q;
  let typing = 0;
  q.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { W.raw.q = q.value.trim(); renderRawList(); }, 200); });
  tools.appendChild(q);
  feed.appendChild(tools);
  const list = el('div');
  feed.appendChild(list);
  W.raw.list = list;
  renderRawList();
  app.bindFeed(feed, { onSource: sourceSheet, onMute: muteSource });
}

function rawItems() {
  const terms = W.raw.q.toLowerCase().split(/\s+/).filter(Boolean);
  return W.pulse.items.filter((c) => !MUTE[c.sid] && (!W.raw.outlet || c.sid === W.raw.outlet) &&
    (!terms.length || terms.every((w) => c.title.toLowerCase().includes(w))));
}

function renderRawList() {
  const list = W.raw.list;
  if (!list) return;
  const until = W.raw.until || null;
  const keep = W.raw.keep || 0;
  W.raw.until = null; W.raw.keep = 0;
  if (W.raw.run) W.raw.run.dead = true;
  if (observer) { observer.disconnect(); observer = null; }
  list.innerHTML = '';
  const all = rawItems();
  if (!all.length) {
    list.appendChild(el('p', 'empty', W.raw.q ? 'Nothing on the wire matches “' + esc(W.raw.q) + '”.' : 'Nothing on the wire for that.'));
    return;
  }
  if (rawLayout() === 'sources' && !W.raw.outlet) {
    const by = new Map();
    all.forEach((c) => { const l = by.get(c.sid) || []; if (l.length < PER_OUTLET) { l.push(c); by.set(c.sid, l); } });
    const grid = el('div', 'srcgrid');
    by.forEach((items, sid) => {
      const s = el('section', 'srcsec');
      s.innerHTML = '<h3><button class="srcbtn" data-outlet="' + esc(sid) + '">' + mark(items[0].src, 'xs') + '<span>' + esc(items[0].src) + '</span></button><span class="n">' +
        esc(all.filter((c) => c.sid === sid).length) + ' on the wire</span></h3>';
      items.forEach((c) => put(s, cards.row(c, { greenLocal: c.local, noComments: true })));
      grid.appendChild(s);
    });
    /* the outlet's name narrows the wire to it, the way the chip does */
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-outlet]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      W.raw.outlet = b.dataset.outlet; app.paintSubnav(); render(); app.scrollTop();
    }, true);
    list.appendChild(grid);
    hydrateVotes(list, [...by.values()].flat().map((c) => c.k));
    return;
  }
  const run = { dead: false, i: 0, all, until, sentinel: el('div', 'loading') };
  W.raw.run = run;
  list.appendChild(run.sentinel);
  const step = (n) => {
    if (run.dead) return;
    const added = [];
    while (run.i < run.all.length && (n-- > 0 || run.until)) {
      const c = run.all[run.i++];
      const node = cards.row(c, { greenLocal: c.local, noComments: true });
      if (node) { list.insertBefore(node, run.sentinel); added.push(c.k); }
      if (c.k === run.until) run.until = null;
    }
    if (added.length) hydrateVotes(list, added);
    if (run.i >= run.all.length) {
      run.sentinel.remove();
      list.appendChild(cards.caught({ title: 'That’s every headline on the wire',
        buttons: [button('Back to today’s paper', '', closeRaw)], check: false }));
      return;
    }
    requestAnimationFrame(() => { if (!run.dead && near(run)) step(CHUNK); });
  };
  step(Math.max(RAW_PAGE, keep));
  if ('IntersectionObserver' in window && W.panel) {
    observer = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !run.dead) step(CHUNK); },
      { root: W.panel, rootMargin: '0px 0px ' + AHEAD + 'px 0px' });
    observer.observe(run.sentinel);
  }
}

function rawSourceSheet(sid, from) {
  const P = W.pulse;
  const s = (P && P.map[sid]) || {};
  const name = (from && from.src) || s.short || s.name || sid;
  const items = P ? P.items.filter((c) => c.sid === sid) : [];
  app.sheet(name, (body, card, close) => {
    body.appendChild(el('div', 'srchead', mark(name, 'xl') + '<div><div class="k">' + esc(P && P.isLocal(s) ? 'Local news' : 'News') +
      '</div><div class="n">' + esc(plural(items.length, 'headline', 'headlines')) + ' on the wire</div></div>'));
    const row = el('div', 'linkrow');
    row.appendChild(button('Only ' + esc(name), '', () => { close(); W.raw.outlet = sid; app.paintSubnav(); render(); app.scrollTop(); }));
    row.appendChild(button('Mute', 'ghost', () => { close(); muteSource(sid, from || { src: name }); }));
    if (/^https?:/i.test(s.site || '')) row.appendChild(openLink('Open the site', s.site));
    body.appendChild(row);
    if (items.length) {
      body.appendChild(el('div', 'sheet-h', 'Newest from ' + esc(name)));
      const f = el('div', 'feed tight');
      items.slice(0, 12).forEach((c) => put(f, cards.row(c, { noComments: true })));
      body.appendChild(f);
      app.bindFeed(f, { onSource() {}, onMute: muteSource });
    }
  });
}

/* ------------------------------------------------------------ deep links */
/* #wire/local|everything, #wire/<kind>, #wire/unfiltered, #wire/2026-10-15
   for an edition, #wire/<key> for a card: on the page, further down today,
   in an earlier edition, or on the raw wire (old links are URLs). */
/* A picture's key (a neighbor's post b-…, a gallery photo g-…, an Instagram
   post ig:…) belongs to Photo mode, as does #wire/photos/<key>. */
const PHOTO_KEY = /^(b-|g-|ig:)/;
const isPhotoParam = (p) => p === 'photos' || p.startsWith('photos/') || PHOTO_KEY.test(p);
function landPhotos(p) {
  const k = p === 'photos' ? '' : p.startsWith('photos/') ? p.slice(7) : p;
  W.view = 'paper';
  W.wantSquare = false;
  if (W.mode !== 'photos') { W.mode = 'photos'; photos.remember('photos'); }
  /* a shared picture is found under All */
  if (k) photos.setCat('all');
  W.photoOpen = k || null;
  app.paintSubnav(); render();
  if (!k) app.scrollTop();
}

/* #wire/square, and #wire/square/<key> for a post there */
function landSquareParam(p) {
  W.wantSquare = false;
  squareReady().then((ok) => {
    if (!ok) { app.toast('The Square isn’t open yet. Here’s the news.'); W.mode = 'news'; W.view = 'paper'; app.paintSubnav(); render(); return; }
    W.view = 'paper';
    if (W.mode !== 'square') { W.mode = 'square'; photos.remember('square'); }
    W.squareOpen = p.startsWith('square/') ? p.slice(7) : null;
    app.paintSubnav(); render();
    if (!W.squareOpen) app.scrollTop();
  });
}

function land() {
  const p = W.pending;
  if (p && isPhotoParam(p)) { W.pending = null; landPhotos(p); return; }
  if (p && (p === 'square' || p.startsWith('square/'))) { W.pending = null; landSquareParam(p); return; }
  if (!p || (!W.today && !W.failed) || !W.idxDone) return;
  W.pending = null;
  W.wantSquare = false;
  if (p === 'local' || p === 'everything') { setGeo(p); W.view = 'paper'; app.paintSubnav(); render(); return; }
  if (p === 'news') { if (W.mode !== 'news') setMode('news'); return; }
  /* anything else is the paper's: a kind, Unfiltered, a day or a story,
     shown as the list for this visit (the kept choice is not changed) */
  if (W.mode !== 'news') { W.mode = 'news'; W.view = 'paper'; app.paintSubnav(); render(); }
  /* the Video chip went; its old link opens the paper */
  if (p === 'video') { W.ch = 'all'; W.topic = 'all'; W.view = 'paper'; app.paintSubnav(); render(); return; }
  if (KINDS.some(([k]) => k === p)) { W.ch = p; W.topic = 'all'; W.view = 'paper'; app.paintSubnav(); render(); return; }
  if (p === 'unfiltered') { openRaw(); return; }
  if (isDate(p)) {
    if (p >= todayKey() || editionDates().includes(p)) goDay(p);
    else { app.toast('That edition is no longer kept. Here’s today’s paper.'); goDay(null); }
    return;
  }
  hunt(p);
}

function hunt(k) {
  if (W.view === 'paper' && app.flashHit(W.root, k)) return;
  const id = ++W.hunt;
  const live = () => id === W.hunt;
  loadMutes();
  const found = (date) => {
    const q = payloadFor(date);
    if (!q) return null;
    return dayOf(q).cards.find((c) => c.k === k) || null;
  };
  const dates = [todayKey()].concat(editionDates());
  const show = (date, c) => {
    if (!live()) return;
    if (MUTE[c.sid]) { app.toast('That card is from ' + c.src + ', which you muted. Unmute it in Settings.'); return; }
    if (!seen(c)) setGeo('everything');
    W.view = 'paper'; W.ch = 'all'; W.topic = 'all';
    W.start = date >= todayKey() ? null : date;
    W.open.add(W.start || todayKey());
    app.paintSubnav();
    render({ until: k });
    if (!app.flashHit(W.root, k)) app.toast('That card has moved on. Here’s today’s paper.');
  };
  for (const date of dates) { const c = found(date); if (c) { show(date, c); return; } }
  /* a URL is a pre-rebuild link to the raw wire; anything else may be on
     any edition in the archive, newest first, a few fetches at a time */
  if (/^https?:/i.test(k)) { huntRaw(k, live); return; }
  const unloaded = editionDates().filter((d) => !payloadFor(d));
  const next = () => {
    if (!live()) return;
    const batch = unloaded.splice(0, HUNT_AT_ONCE);
    if (!batch.length) { huntRaw(k, live); return; }
    Promise.all(batch.map((date) => loadEdition(date).catch(() => null))).then(() => {
      const date = batch.find((d) => found(d));
      if (date) show(date, found(date)); else next();
    });
  };
  next();
}

function huntRaw(k, live) {
  withPulse((failed) => {
    if (!live()) return;
    const c = !failed && W.pulse.items.find((x) => x.k === k);
    if (!c) { app.toast('That card has moved on. Here’s today’s paper.'); return; }
    if (MUTE[c.sid]) { app.toast('That card is from ' + c.src + ', which you muted. Unmute it in Settings.'); return; }
    W.view = 'raw'; W.raw.outlet = ''; W.raw.q = ''; W.raw.until = k;
    if (rawLayout() === 'sources') store.setSetting('layout', 'newest');
    app.paintSubnav(); render();
    if (!app.flashHit(W.root, k)) app.toast('That card has moved on. Here’s today’s paper.');
  });
}

/* -------------------------------------------------------------- the tab */
function applyQueued() {
  const q = W.queued.splice(0);
  q.forEach((apply) => apply());
  return q.length > 0;
}

function mount(root) {
  W.root = root;
  W.panel = root.closest('.panel');
  W.left = readLeft();
  /* a kept Square waits for the board's answer; News until then */
  if (W.mode === 'square' && !W.squareOk) { W.mode = 'news'; W.wantSquare = true; }
  squareReady().then((ok) => {
    if (ok && W.wantSquare && W.mode === 'news' && W.view === 'paper' && !W.pending) { W.mode = 'square'; render(); if (app.activeTab() === 'wire') app.paintSubnav(); }
    W.wantSquare = false;
  });
  loadIg();
  window.addEventListener('pagehide', saveLeft);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && app.activeTab() === 'wire') saveLeft(); });
  render();
  if (W.panel) W.panel.addEventListener('scroll', track, { passive: true });
  if (!app.demo) {
    /* a fresh payload never lands under a reader: at the top it applies,
       further down it waits for a pull or a tap on the tab */
    data.setFreshGate((apply) => {
      if (app.activeTab() !== 'wire' || !W.panel || W.panel.scrollTop < 120) apply();
      else { W.queued.push(apply); app.toast('New stories on the Wire.'); }
    });
    data.setStaleHandler((s) => { if (W.stale !== s) { W.stale = s; if (app.activeTab() === 'wire') paintDateline(W.reading || todayKey()); } });
  }
  SRC.today((j) => {
    W.today = j;
    if (W.view === 'paper' && (!W.start || !W.run)) render();
    if (app.activeTab() === 'wire') app.paintSubnav();
    land();
    app.recount();
  }, () => { W.failed = true; render(); land(); });
  SRC.index((j) => {
    W.index = j; W.idxDone = true;
    const run = W.run;
    /* the archive arrived after the page: let the river run on into it */
    if (run && run.done && run.end) { run.end.remove(); run.end = null; run.done = false; fill(run); }
    if (app.activeTab() === 'wire' && DL) paintDateline(W.reading || todayKey());
    paintFlip();
    land();
  }, () => { W.idxDone = true; land(); });
}

/* a mute, a follow or the switch: redraw as far down as the reader was */
function redraw() {
  const y = W.panel ? W.panel.scrollTop : 0;
  const shown = W.view !== 'paper' ? 0 : W.mode === 'photos' ? photos.drawn() : W.mode === 'square' ? square.drawn() : W.ch === 'instagram' ? W.igShown || 0 : W.run ? W.run.shown : 0;
  if (W.view === 'raw' && W.raw.run) W.raw.keep = W.raw.run.i;
  app.paintSubnav();
  render({ limit: shown });
  if (W.panel) W.panel.scrollTop = y;
}

function newSince(ts) {
  if (SRC.newSince) return SRC.newSince();
  if (!W.today || W.today.date !== todayKey()) return 0;
  loadMutes();
  return dayOf(W.today).all.filter((c) => seen(c) && c.d > ts).length;
}

app.register('wire', {
  label: 'Wire',
  icon: ICON.wire,
  promise: 'Today’s Burlington news, picked from everything that arrived, with a reason on the ones that matter.',
  mount,
  activate(param) { if (param) { W.pending = param; land(); } },
  refresh: redraw,
  deactivate() { app.closePeek(); if (W.mode === 'news' && W.view === 'paper') { saveLeft(); W.left = readLeft() || W.left; } },
  subnav,
  newSince,
  pull() {
    if (applyQueued()) return 'Fresh stories are in';
    if (W.view !== 'paper' || W.start || W.mode !== 'news' || W.ch === 'instagram') return null;
    return SRC.check();
  },
});
