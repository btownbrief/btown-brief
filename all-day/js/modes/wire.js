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
     then "Unfiltered ↗"
   - the Brief's own edition pinned on the days it went out
   - What matters today: ten local picks (plus the national ones on
     Everything), each with its reason; one to five shown, the rest on request
   - The rest of today: the river by update, the update's label as the time
     divider, lead first then newest first, the shown picks left out, the
     "N new since you were here" line
   - then, with no stop, yesterday's frozen edition, the day before, and so on
     as far as the archive goes (30 days). The river is long by design (up to
     300 a day), so it is drawn in chunks as the reader nears the bottom; the
     time dividers and the day heads are the landmarks. When the editions run
     out the page says so.

   Unfiltered is a sub-view of this tab, not a tab: every headline on
   pulse.json, newest first or by outlet, the outlet chips, search.

   ?demo=1 runs exactly this file on wire-demo.js's fake payloads, which have
   the same shape as the real ones. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as demo from './wire-demo.js';
import { el, esc, safeHref, ICON, mark, cards, chips, pills, button, divider, section, localSwitch, geo, setGeo, put } from '../ui.js';

const FIRST = 60;        // cards on the first screenful (DESIGN.md §9 rule 14: sixty in under 100ms)
const CHUNK = 40;        // then forty at a time as the reader nears the bottom
const AHEAD = 1600;      // how far below the screen the next chunk starts drawing, in px
const PICKS_SHOWN = 10;  // local picks on the page; the pipeline ranks 25 (a knob, not a design)
const PICKS_OPEN = 5;    // one as the pick card, two to five as ranked rows, the rest on request
const RAW_PAGE = 60;
const PER_OUTLET = 6;
const HUNT_AT_ONCE = 5;  // editions a shared link fetches at a time while it looks for its card

const KINDS = [['all', 'All'], ['x', 'X'], ['facebook', 'Facebook'], ['reddit', 'Reddit'], ['newsletters', 'Newsletters'], ['video', 'Video']];
const KIND_LABEL = { local: 'Local news', world: 'News', x: 'X', facebook: 'Facebook group, via Muse', reddit: 'Reddit', newsletters: 'Newsletter', video: 'Video' };
const NUMBER = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const words = (n) => NUMBER[n] || String(n);
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
  ch: 'all', more: false,
  view: 'paper',        // or 'raw', Unfiltered
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
    ago: ms ? (isToday ? ago(ms) : clock(ms)) : '', own: !!it.own,
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
  const picks = (Array.isArray(p.picks) ? p.picks : [])
    .filter((x) => x && !x.own)
    .sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99))
    .map((x) => { const c = card(x); return c ? { c, why: String(x.why || '') } : null; })
    .filter(Boolean);
  const d = { date: p.date, final: !!p.final, isToday, payload: p, updates, all, picks, brief,
    counts: p.counts || {}, status: p.status || {}, sources, updated: Date.parse(p.updated) || 0, count: Number(p.count) || all.length };
  app.know(all);
  if (brief) app.know([brief]);
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
const shows = (c) => seen(c) && (W.ch === 'all' || c.ch === W.ch);
const greenOf = (c) => geo() === 'everything' && !!c.local;

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
let DL = null;
function subnav() {
  if (!W.today && !W.failed) return null;
  loadMutes();
  const frag = document.createDocumentFragment();
  if (W.view === 'raw') return rawSubnav(frag);
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
    .map(([key, lab]) => ({ key, label: lab, n: key === 'all' ? null : (counts[key] || 0) }))
    .concat([{ key: '__raw', label: 'Unfiltered ↗', cls: 'every' }]);
  const band = el('div', 'toolband');
  band.appendChild(localSwitch(() => { W.more = false; app.paintSubnav(); render(); app.scrollTop(); }));
  band.appendChild(chips(items, W.ch, (k) => {
    if (k === '__raw') { openRaw(); return; }
    W.ch = k;
    history.replaceState(null, '', location.search + '#wire' + (k === 'all' ? '' : '/' + k));
    app.paintSubnav(); render(); app.scrollTop();
  }));
  frag.appendChild(band);
  return frag;
}

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
  W.reading = W.start || tk;
  W.more = false;
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
  if (W.failed && !W.today) {
    root.innerHTML = '<div class="errbox"><b>Couldn’t reach the wire.</b><br>The paper is served from GitHub. If you are offline it will come back on its own.</div>';
    return;
  }
  if (!W.today) { root.innerHTML = '<p class="loading">Loading the wire…</p>'; return; }
  loadMutes();
  root.innerHTML = '';
  const feed = el('div', 'feed');
  root.appendChild(feed);

  const tk = todayKey();
  const date = W.start || tk;
  const p = payloadFor(date);
  const d = p ? dayOf(p) : null;
  const exclude = new Set();
  if (d && W.ch === 'all') {
    if (d.brief && seen(d.brief)) {
      /* no picture: the Brief is a pin above the picks, not a second front page */
      put(feed, cards.pick({ ...d.brief, media: '', thumb: '', own: false, eyebrow: 'The Brief',
        why: date === tk ? 'Today’s newsletter, as it went out.' : 'That day’s newsletter, as it went out.' }, { greenLocal: greenOf(d.brief) }));
      exclude.add(d.brief.k);
    }
    renderMatters(feed, d, date === tk).forEach((k) => exclude.add(k));
  }
  /* the Brief and the open picks count toward the first sixty */
  const above = feed.querySelectorAll('[data-k]').length;
  const run = {
    feed, exclude, first: date, lastDate: null, queue: [], shown: 0,
    limit: Math.max(FIRST - above, opts.limit || 0), until: opts.until && !exclude.has(opts.until) ? opts.until : null,
    done: false, loading: false, breaks: [], keys: [],
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
   rows, the rest on request, and the list says when it is done. Returns
   the keys it drew so the river leaves them out. */
function renderMatters(feed, d, isToday) {
  const local = d.picks.filter((x) => x.c.local && seen(x.c)).slice(0, PICKS_SHOWN);
  const national = geo() === 'everything' ? d.picks.filter((x) => !x.c.local && seen(x.c)) : [];
  const keep = new Set(local.concat(national));
  const list = d.picks.filter((x) => keep.has(x));
  if (!list.length) return [];
  const wm = el('div', 'wm');
  section(wm, isToday ? 'What matters today' : 'What mattered ' + weekday(d.date),
    esc(isToday ? 'Ranked, most important first.' : 'Ranked, as they stood at midnight.'));
  const [first] = list;
  put(wm, cards.pick({ ...first.c, media: first.c.thumb, thumb: '', eyebrow: '1 of ' + list.length, why: first.why }, { greenLocal: greenOf(first.c) }));
  list.slice(1, PICKS_OPEN).forEach((x, i) => wm.appendChild(wmRow(x.c, x.why, i + 2)));
  const rest = list.slice(PICKS_OPEN);
  if (rest.length) {
    if (W.more) {
      rest.forEach((x, i) => wm.appendChild(wmRow(x.c, x.why, i + PICKS_OPEN + 1)));
      wm.appendChild(el('p', 'wm-end', esc('That’s the ' + words(list.length) + '.')));
    } else {
      wm.appendChild(button(esc(plural(rest.length, 'more pick', 'more picks')), 'ghost more', () => { W.more = true; render({ limit: W.run ? W.run.shown : 0 }); }));
    }
  } else if (list.length > 1) {
    wm.appendChild(el('p', 'wm-end', esc('That’s the ' + words(list.length) + '.')));
  }
  feed.appendChild(wm);
  divider(feed, isToday ? 'The rest of today' : 'The rest of the day', geo() === 'local' ? 'local only' : 'every source');
  return (W.more ? list : list.slice(0, PICKS_OPEN)).map((x) => x.c.k);
}

/* a ranked row: the numeral, the title, the reason, then the foot line */
function wmRow(it, why, n) {
  const on = store.hasVoted(it.k);
  const r = el('article', 'wm-row card fi' + (store.isRead(it.k) ? ' is-read' : ''));
  r.dataset.k = it.k;
  const ext = /^https?:/.test(it.href || '');
  r.innerHTML = '<span class="num">' + esc(n) + '</span><div><a class="c-title" href="' + esc(safeHref(it.href)) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + ' data-open>' + esc(it.title || it.text) + '</a>' +
    (why ? '<p class="why">' + esc(why) + '</p>' : '') +
    '<div class="c-foot"><button class="srcbtn" data-src="' + esc(it.sid || it.src) + '">' + mark(it.src, 'xs') + '<span class="c-src' + (greenOf(it) ? ' is-local' : '') + '">' + esc(it.src) + '</span></button>' +
    (it.ago ? '<span class="dot"></span><span class="age">' + esc(it.ago) + '</span>' : '') +
    '<button class="mini up' + (on ? ' on' : '') + '" data-act="up" aria-label="Upvote" aria-pressed="' + on + '">' + ICON.up + '<span class="n">' + (((Number(it.votes) || 0) + store.voteCount(it.k)) || '') + '</span></button>' +
    '<button class="mini sh" data-act="share" aria-label="Share">' + ICON.share + '</button></div></div>' +
    '<button class="act star' + (store.isSaved(it.k) ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + store.isSaved(it.k) + '">' + ICON.star + '</button>';
  return r;
}

/* One item in the river. A plain headline is the tight row; posts, videos
   and an update's lead get the bigger cards. */
function draw(c, leadWhy) {
  const o = { greenLocal: greenOf(c), noComments: !c.comments };
  if (c.kind === 'video') return cards.video(c, o);
  if (c.kind === 'post') return cards.post(c, o);
  if (leadWhy) return cards.pick({ ...c, media: c.thumb, thumb: '', why: leadWhy, eyebrow: 'The lead' }, o);
  return cards.row(c, o);
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
  const items = [];
  (d ? d.updates : []).forEach((u) => {
    const list = u.items.filter((c) => shows(c) && !(isFirst && run.exclude.has(c.k)));
    if (!list.length) return;
    out.push({ divider: u.label, sub: u.time ? 'updated ' + u.time : '' });
    list.forEach((c, i) => {
      const e = { c, why: i === 0 && u.lead && u.lead.id === c.k ? u.lead.why : '' };
      out.push(e);
      items.push(e);
    });
  });
  /* new since you were here: under the last unseen item, when there are
     seen ones below it */
  if (date === tk && isFirst) {
    const base = SRC.base();
    const fresh = base ? items.filter((e) => e.c.d > base) : [];
    const last = fresh.length ? items.indexOf(fresh[fresh.length - 1]) : -1;
    if (fresh.length && last < items.length - 1) {
      out.splice(out.indexOf(items[last]) + 1, 0, { newline: fresh.length + ' new since you were here at ' + clock(base * 1000) });
    }
  }
  if (!items.length) {
    const kind = W.ch === 'all' ? '' : ' from ' + (KINDS.find((x) => x[0] === W.ch) || ['', W.ch])[1];
    out.push({ note: date === tk
      ? (W.ch === 'all' && !(d && d.all.length) ? 'Nothing yet today. The first stories land in the morning; yesterday’s paper is right below.' : 'Nothing' + kind + ' today so far.')
      : 'Nothing' + (kind || (geo() === 'local' ? ' local' : '')) + ' that day.' });
  }
  return out;
}

/* Draw until the limit (or until a shared key is on the page), fetching the
   next edition when today runs out. Called again as the reader nears the
   bottom. */
function fill(run) {
  if (W.run !== run || run.done) return;
  const added = [];
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
    } else if (e.newline) node = cards.newline(e.newline);
    else if (e.note) node = el('p', 'note pad', esc(e.note));
    else if (e.c) {
      node = draw(e.c, e.why);
      if (node) { run.shown++; added.push(e.c.k); }
      if (run.until && e.c.k === run.until) run.until = null;
    }
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
  const tk = todayKey();
  run.end = cards.caught(days ? {
    title: 'That’s the whole archive',
    text: 'The Wire keeps its editions for 30 days. ' + dayName(run.lastDate || tk) + ' is the oldest one on file, and nothing goes further back.',
    buttons: [button('Back to today', '', () => goDay(null))], check: false,
  } : {
    title: 'That’s today so far',
    text: W.idxDone ? 'New stories land through the day, above a line, never under your thumb.' : 'Earlier editions didn’t load. They come back when the connection does.',
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
  if (observer) { observer.disconnect(); observer = null; }
  if (W.raw.run) W.raw.run.dead = true;
  W.run = null;
}

/* which day is under the mast: the dateline follows the scroll */
let tracking = 0;
function track() {
  if (tracking || W.view !== 'paper' || !W.run) return;
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
    .find((d) => d && (!from || d.all.includes(from) || d.brief === from)) || startDay();
  const items = day ? day.all.filter((c) => c.sid === sid) : [];
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
    if (!first.local) body.appendChild(el('p', 'sheet-note', esc('Follow, and ' + name + ' shows on Local too.')));
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
  SRC.pulse((j) => { pulseReady(j); then(); }, () => then(true));
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
  dl.appendChild(el('span', 'dl', '<b>Unfiltered</b><span class="s">' + (P ? esc(n ? n.toLocaleString('en-US') + ' today' : P.items.length.toLocaleString('en-US') + ' headlines') + ' · every 10 min · nothing picked' : 'every headline, nothing picked') + '</span>'));
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
      list.appendChild(cards.caught({ title: 'That’s every headline on the wire', text: 'The raw wire keeps about two days. Older stories live on in the paper’s past editions.',
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
function land() {
  const p = W.pending;
  if (!p || (!W.today && !W.failed) || !W.idxDone) return;
  W.pending = null;
  if (p === 'local' || p === 'everything') { setGeo(p); W.view = 'paper'; app.paintSubnav(); render(); return; }
  if (KINDS.some(([k]) => k === p)) { W.ch = p; W.view = 'paper'; app.paintSubnav(); render(); return; }
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
  const found = (date) => { const q = payloadFor(date); return q ? dayOf(q).all.concat(dayOf(q).brief || []).find((c) => c.k === k) : null; };
  const dates = [todayKey()].concat(editionDates());
  const show = (date, c) => {
    if (!live()) return;
    if (MUTE[c.sid]) { app.toast('That card is from ' + c.src + ', which you muted. Unmute it in Settings.'); return; }
    if (!seen(c)) setGeo('everything');
    W.view = 'paper'; W.ch = 'all'; W.more = true;
    W.start = date >= todayKey() ? null : date;
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
  render();
  if (W.panel) W.panel.addEventListener('scroll', track, { passive: true });
  if (!app.demo) {
    /* a fresh payload never lands under a reader: at the top it applies,
       further down it waits for a pull or a tap on the tab */
    data.setFreshGate((apply) => {
      if (app.activeTab() !== 'wire' || !W.panel || W.panel.scrollTop < 120) apply();
      else { W.queued.push(apply); app.toast('New stories on the Wire. Pull down or tap Wire to see them.'); }
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
    land();
  }, () => { W.idxDone = true; land(); });
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
  refresh() {
    /* a mute, a follow or the switch: redraw as far down as the reader was */
    const y = W.panel ? W.panel.scrollTop : 0;
    const shown = W.run ? W.run.shown : 0;
    if (W.view === 'raw' && W.raw.run) W.raw.keep = W.raw.run.i;
    app.paintSubnav();
    render({ limit: shown });
    if (W.panel) W.panel.scrollTop = y;
  },
  deactivate() { app.closePeek(); },
  subnav,
  newSince,
  pull() {
    if (applyQueued()) return 'Fresh stories are in';
    if (W.view !== 'paper' || W.start) return null;
    return SRC.check();
  },
});
