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
import { liquify } from '../liquid.js';

const FIRST = 60;        // cards on the first screenful (DESIGN.md §9 rule 14: sixty in under 100ms)
const CHUNK = 40;        // then forty at a time as the reader nears the bottom
const AHEAD = 1600;      // how far below the screen the next chunk starts drawing, in px
const PICKS_OPEN = 5;    // one as the pick card, two to five as ranked rows, the rest on request
const RAW_PAGE = 60;
const PER_OUTLET = 6;
const HUNT_AT_ONCE = 5;  // editions a shared link fetches at a time while it looks for its card

/* The chips under the switch, each source with its own colour (Stephen,
   2026-10-17: "better color coordinate the x vs Facebook vs other posts").
   Video went (it had nothing; videos live in On Air); Instagram reads the
   local accounts' posts as a list (wire-photos.js has them). */
const KINDS = [['all', 'All'], ['x', 'X'], ['facebook', 'Facebook'], ['reddit', 'Reddit'], ['instagram', 'Instagram'], ['newsletters', 'Newsletters']];
const SRC_CH = new Set(['x', 'facebook', 'reddit', 'instagram', 'newsletters']);
const KIND_LABEL = { local: 'Local news', world: 'News', x: 'X', facebook: 'Facebook group', reddit: 'Reddit', newsletters: 'Newsletter', video: 'Video', instagram: 'Instagram' };
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
/* each word's water, a colour token */
const MODE_WATER = ['--liq-news', '--liq-photos', '--liq-square'];
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
const shortFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const shortDay = (date) => shortFmt.format(utcNoon(date));                     // "Oct 16" 
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
    site: String(it.site || (sources[it.src] && sources[it.src].site) || ''),
  };
  if (Number(it.votes)) c.votes = Number(it.votes);      // demo only; real counts come from the shell
  if (c.ch === 'x' || c.ch === 'facebook') {
    /* the bot's one-line summary is the text; the link is always the original post */
    Object.assign(c, { kind: 'post', text: c.ch === 'facebook' ? ownVoice(it.title) : it.title, title: '', via: KIND_LABEL[c.ch], open: c.ch === 'x' ? 'Open on X' : 'Open the post' });
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

/* Muse writes each Facebook post up as "Someone is sharing the 1877 map
   ...", "Someone is asking for ...": a robot narrating a neighbour, four
   times in a row (the reviewers, 2026-10-19). Until its brief asks for the
   post's own words (wire-inbox/briefs/muse-task.md), the river drops the
   narrator: "Someone is sharing the 1877 map" reads "The 1877 map", and
   "Someone is asking for a plumber" reads "Asking for a plumber". Nothing
   is added; a line this does not recognise is left as it came. */
const NARRATOR = /^(?:someone|a member|a user|a neighbou?r|the poster|one member)\s+(?:is|was)\s+/i;
const SAYS = /^(?:sharing|announcing|promoting|posting|recounting|showing|highlighting|advertising|offering|reporting|noting|celebrating|reminding (?:people|everyone|members) (?:of|about|that)|pointing out|warning(?: people| everyone| members)? (?:about|of|that))\s+(?:that\s+)?/i;
function ownVoice(t) {
  const s = String(t || '').trim();
  if (!NARRATOR.test(s)) return s;
  let rest = s.replace(NARRATOR, '');
  if (SAYS.test(rest)) rest = rest.replace(SAYS, '');
  if (rest.length < 12) return s;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
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
/* a local story's source is green only on Everything, where local and
   national share the list; on Local every one is local */
const greenOf = (c) => !!c.local && geo() === 'everything';

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
/* a topic with nothing under this source chip (or the Instagram list,
   which has no topics) goes back to All topics */
function checkTopic(d) {
  if (W.topic !== 'all' && (W.ch === 'instagram' || !topicCounts(d)[W.topic])) W.topic = 'all';
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
/* News · Photos · Square is a pill that floats over the paper and stays
   on screen as you scroll (Stephen, 2026-10-19: "that's how important it
   is"). Once the banner at the top of the paper has scrolled away, a small
   second row floats under it with the same two controls the banner leads
   with: the day, ‹ Monday, October 19 ›, on the left and Local /
   Everything on the right. All three words are drawn from the first
   paint, so nothing moves under a thumb; Square holds its place, unseen,
   until the board answers. Unfiltered keeps its own two rows (the way back
   and the outlets). */
function modeRow() {
  const g = el('div', 'wmodes');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', 'Read the Wire as');
  MODES.forEach(([key, label]) => {
    const on = W.mode === key && W.view === 'paper';
    const wait = key === 'square' && !W.squareOk;
    const b = el('button', 'wmode' + (on ? ' on' : '') + (wait ? ' wait' : ''), esc(label));
    b.type = 'button';
    b.dataset.view = key;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (wait) { b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
    b.addEventListener('click', () => { if (!on && !(key === 'square' && !W.squareOk)) setMode(key); });
    g.appendChild(b);
  });
  /* the chosen word sits in poured water, each its own colour (Stephen,
     2026-10-19: "that bubble and the motion ... for the main ones I want
     people switching through"); Unfiltered has no word on, so no water */
  const at = MODES.findIndex(([key]) => key === W.mode);
  if (W.view === 'paper' && at >= 0) liquify(g, { key: 'wire-mode', idx: at, colors: MODE_WATER });
  return g;
}
/* a chip's colour mark: a dot in the source's colour */
const DOT = '<i class="sdot" aria-hidden="true"></i>';
/* how many things narrow what this view shows */
function activeFilters() {
  if (W.view !== 'paper') return 0;
  if (W.mode === 'photos') return photos.cat() !== 'all' ? 1 : 0;
  if (W.mode === 'square') return square.type() !== 'all' ? 1 : 0;
  return (W.ch !== 'all' ? 1 : 0) + (W.topic !== 'all' ? 1 : 0) + (W.slot ? 1 : 0);
}
function subnav() {
  if (W.view === 'raw') {
    if (!W.today && !W.failed) return null;
    loadMutes();
    return rawSubnav(document.createDocumentFragment());
  }
  const bar = el('div', 'wbar');
  bar.append(modeRow());
  if (topRowShown()) {
    const fl = topRow('wfloat');
    fl.setAttribute('aria-hidden', 'true');
    /* hidden until the banner's own row has gone under the pill */
    fl.querySelectorAll('button').forEach((b) => { b.tabIndex = -1; });
    bar.appendChild(fl);
    requestAnimationFrame(floatCheck);
  }
  return bar;
}

/* ----------------------------------------------------------- the banner */
/* The top of the paper, every view of it (News, a kind like Instagram,
   Photos, the Square), always open (Stephen, 2026-10-19: "I like how much
   you can see without clicking Filters"; it scrolls away with the paper).
   On News it leads with the day and Local / Everything, then the kinds of
   source and the topics as rows of chips that scroll sideways, and a foot
   with Unfiltered and "Show all", which lays every row out in full and back
   ("there should always be the option to get out of a horizontal
   scroll"). The wide screen's rail holds the chips instead. Each tap
   applies at once. */
let FBODY = null;
const dayRowShown = () => W.view === 'paper' && W.mode === 'news' && W.ch !== 'instagram';
/* the row that floats: the day and the switch on News, the switch alone on
   Photos (Local is Burlington's pictures, Everything adds the world's) */
const topRowShown = () => dayRowShown() || (W.view === 'paper' && W.mode === 'photos');
function topRow(cls) {
  const row = el('div', cls);
  row.append(dayRowShown() ? dayPager() : el('span', 'wtop-sp'), localSwitch(() => { W.open.clear(); changed(); }));
  return row;
}
function dayPager() {
  const row = el('div', 'wday');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Edition');
  const prev = el('button', 'wday-nav prev', ICON.left);
  const next = el('button', 'wday-nav next', ICON.right);
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', 'Earlier day');
  next.setAttribute('aria-label', 'Later day');
  /* focus follows to the same arrow on the new day's banner */
  prev.addEventListener('click', () => { const d = olderThan(row.dataset.of); if (d) { W.refocus = '.prev'; goDay(d); } });
  next.addEventListener('click', () => { const d = newerThan(row.dataset.of); if (d) { W.refocus = '.next'; goDay(d); } });
  row.append(prev, el('span', 't'), next);
  fillPager(row);
  return row;
}
/* the day the reader is in (it follows the scroll into earlier days) */
function fillPager(row) {
  const tk = todayKey();
  const date = W.reading || W.start || W.shownDay || tk;
  row.dataset.of = date;
  /* as long as the width allows: "Monday, October 19", "Monday, Oct 19",
     "Mon, Oct 19" (the CSS shows one) */
  const wd = weekday(date);
  row.querySelector('.t').innerHTML = '<span class="d-l">' + esc(dayName(date)) + '</span><span class="d-m">' + esc(wd + ', ' + shortDay(date)) +
    '</span><span class="d-s">' + esc(wd.slice(0, 3) + ', ' + shortDay(date)) + '</span>';
  row.querySelector('.prev').disabled = !olderThan(date);
  /* the paper is leading with an earlier day because today has nothing yet:
     there is no later day to go to */
  row.querySelector('.next').disabled = date >= tk || (!W.start && !!W.shownDay && date === W.shownDay);
}
function banner() {
  const band = el('section', 'wband' + (W.fwrap ? ' wrap' : ''));
  band.setAttribute('aria-label', 'What the Wire shows');
  if (topRowShown()) band.appendChild(topRow('wband-top'));
  const body = el('div', 'wband-b');
  body.appendChild(filtersUI(true));
  FBODY = body;
  band.appendChild(body);
  const foot = el('div', 'wband-foot');
  if (W.mode === 'news') {
    const raw = button('Unfiltered ' + ICON.arrow, 'ghost wf-raw', () => openRaw());
    raw.setAttribute('aria-label', 'Every headline, unfiltered');
    foot.appendChild(raw);
  }
  const all = el('button', 'wband-all', '<span>' + (W.fwrap ? 'Show less' : 'Show all') + '</span>' + ICON.down);
  all.type = 'button';
  all.setAttribute('aria-pressed', W.fwrap ? 'true' : 'false');
  all.addEventListener('click', () => {
    W.fwrap = !W.fwrap;
    band.classList.toggle('wrap', W.fwrap);
    all.setAttribute('aria-pressed', W.fwrap ? 'true' : 'false');
    all.firstChild.textContent = W.fwrap ? 'Show less' : 'Show all';
    fits(band);
    if (band.classList.contains('fits')) { const h = W.root && W.root.querySelector('.whead h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
  });
  foot.appendChild(all);
  band.appendChild(foot);
  return band;
}
/* the top of every paper view */
function paperTop(root) {
  const band = banner();
  root.prepend(band);
  floatCheck();
  requestAnimationFrame(() => fits(band));
}
/* "Show all" only when a row of chips runs past the screen */
function fits(band) {
  if (!band || !band.isConnected) return;
  const over = [...band.querySelectorAll('.wf .chips')].some((r) => r.scrollWidth > r.clientWidth + 1);
  band.classList.toggle('fits', !over && !W.fwrap);
}
window.addEventListener('resize', () => { if (W.root) fits(W.root.querySelector('.wband')); });
/* the floating day row shows once the banner's own row is under the pill */
function floatCheck() {
  const on = (() => {
    if (app.activeTab() !== 'wire' || !topRowShown() || !W.root) return false;
    const top = W.root.querySelector('.wband-top');
    const bar = document.querySelector('#subnav .wmodes');
    if (!top || !bar) return false;
    return top.getBoundingClientRect().bottom < bar.getBoundingClientRect().bottom + 4;
  })();
  document.body.classList.toggle('wire-float', on);
  const fl = document.querySelector('#subnav .wfloat');
  if (fl && fl.getAttribute('aria-hidden') !== (on ? 'false' : 'true')) {
    fl.setAttribute('aria-hidden', on ? 'false' : 'true');
    fl.querySelectorAll('button').forEach((b) => { b.tabIndex = on ? 0 : -1; });
  }
  /* one copy of the two controls in reach at a time */
  const top = W.root && W.root.querySelector('.wband-top');
  if (top) top.inert = on;
}
/* something else drew the chips' content anew (Instagram arrived) */
function paintFilters() {
  if (!FBODY || !FBODY.isConnected) { FBODY = null; return; }
  const was = document.activeElement && FBODY.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  FBODY.innerHTML = '';
  FBODY.appendChild(filtersUI(true));
  if (was) { const n = FBODY.querySelector(was); if (n && !n.disabled) n.focus({ preventScroll: true }); }
  fits(FBODY.closest('.wband'));
}
function focusKey(n) {
  if (n.dataset.chip) return '.chip[data-chip="' + CSS.escape(n.dataset.chip) + '"]';
  if (n.dataset.slot) return '.wm-slot[data-slot="' + CSS.escape(n.dataset.slot) + '"]';
  if (n.classList.contains('localsw-half')) return '.localsw-half.on';
  const label = n.getAttribute('aria-label');
  return label ? '[aria-label="' + CSS.escape(label) + '"]' : null;
}
/* something that narrows the paper changed: the button's count, the
   banner, the rail and the paper, from the top; focus stays on the chip
   that was tapped */
function changed() {
  const a = document.activeElement;
  const host = a && a.closest ? a.closest('.wband, .aside, .wfloat') : null;
  const was = host ? focusKey(a) : null;
  /* from the floating row too, focus lands in the banner: the paper goes back to its top */
  const where = host ? (host.classList.contains('aside') ? '#aside' : '#panel-wire .wband') : null;
  app.paintSubnav();
  render();
  app.scrollTop();
  if (was) { const n = document.querySelector(where + ' ' + was); if (n && !n.disabled) n.focus({ preventScroll: true }); }
}
function pickKind(k) {
  W.ch = k;
  /* a ranking of the day only reads on the whole paper */
  if (k !== 'all') W.slot = null;
  /* the address holds one thing: on an earlier day, the day */
  history.replaceState(null, '', location.search + '#wire' + (W.start ? '/' + W.start : k === 'all' ? '' : '/' + k));
  changed();
}
function pickTopic(k) { W.topic = k; if (k !== 'all') W.slot = null; changed(); }
function clearFilters() {
  if (W.mode === 'photos') { pickCat('all'); return; }
  if (W.mode === 'square') { square.setType('all'); changed(); return; }
  W.ch = 'all'; W.topic = 'all'; W.slot = null;
  history.replaceState(null, '', location.search + '#wire' + (W.start ? '/' + W.start : ''));
  changed();
}
/* the chips; in the banner they go without heads and without the buttons
   the banner's foot carries */
function filtersUI(band) {
  const f = el('div', 'wf');
  const h = (t) => { if (!band) f.appendChild(el('div', 'sheet-h', esc(t))); };
  const clear = () => { if (!band && activeFilters()) f.appendChild(button('Clear filters', 'ghost wf-clear', clearFilters)); };
  if (W.view === 'paper' && W.mode === 'photos') {
    if (photos.loaded()) {
      h('Kind of photo');
      f.appendChild(chips(photos.catChips().map((c) => ({ ...c, cls: c.key === 'instagram' ? 'w-src-instagram' : c.key === 'pets' ? 'w-pets' : '', icon: c.key === 'instagram' ? DOT : '' })),
        photos.cat(), (k) => pickCat(k)));
    }
    clear();
    return f;
  }
  if (W.view === 'paper' && W.mode === 'square') {
    if (square.loaded()) {
      h('Kind of post');
      f.appendChild(chips(square.typeChips().map((c) => ({ ...c, icon: c.cls ? DOT : '' })), square.type(), (k) => { square.setType(k); changed(); }));
    }
    clear();
    return f;
  }
  loadMutes();
  const d = startDay();
  const counts = d ? countsOf(d) : {};
  if (chipHidden(d, W.ch)) W.ch = 'all';
  /* a kind with nothing in it today is left out, unless it is the one on */
  const kinds = KINDS.filter(([k]) => !chipHidden(d, k))
    .map(([key, lab]) => ({ key, label: lab, n: key === 'all' ? null : key === 'instagram' ? igCount() : (counts[key] || 0),
      cls: SRC_CH.has(key) ? 'w-src-' + key : '', icon: SRC_CH.has(key) ? DOT : '' }))
    .filter((c) => c.key === 'all' || c.key === W.ch || c.n !== 0);
  h('Source');
  f.appendChild(chips(kinds, W.ch, pickKind));
  checkTopic(d);
  if (W.ch !== 'instagram') {
    const n = topicCounts(d);
    const items = TOPICS.filter(([k]) => n[k]).map(([key, label]) => ({ key, label, n: n[key] }));
    if (items.length) {
      h('Topic');
      const row = chips([{ key: 'all', label: 'All topics' }].concat(items), W.topic, pickTopic);
      row.classList.add('w-topics');
      f.appendChild(row);
    }
  }
  /* the day's three rankings (Stephen, 2026-10-17), today only */
  const tp = !W.start && unfiltered() && payloadFor(todayKey());
  const sl = tp ? slotRow(dayOf(tp)) : null;
  if (sl) { h('Top stories as of'); f.appendChild(sl.row); }
  if (!band) {
    const raw = button('Every headline, unfiltered ' + ICON.arrow, 'ghost wf-raw', () => openRaw());
    raw.dataset.chip = '__raw';
    f.appendChild(raw);
  }
  clear();
  return f;
}

/* ------------------------------------------------------- the wide rail */
/* At 1280 and up: the same filters, in place, and what you saved. */
function aside() {
  const box = el('div', 'wside');
  if (W.view === 'paper') {
    const fs = el('section', 'ws');
    fs.appendChild(el('h3', null, W.mode === 'news' ? 'Filters' : W.mode === 'photos' ? 'Photos' : 'The Square'));
    fs.appendChild(filtersUI());
    box.appendChild(fs);
  }
  const sv = el('section', 'ws wsaved');
  sv.appendChild(el('h3', null, 'Saved'));
  const list = store.saved();
  if (!list.length) sv.appendChild(el('p', 'note', 'Nothing saved yet.'));
  list.slice(0, 6).forEach((it) => {
    const a = el('a', null, esc(it.title) + '<span>' + esc(it.from || '') + '</span>');
    a.href = safeHref(it.href);
    if (!/^#/.test(it.href || '')) { a.target = '_blank'; a.rel = 'noopener'; }
    sv.appendChild(a);
  });
  if (list.length > 6) sv.appendChild(button('All ' + list.length + ' saved', 'ghost sm', () => document.getElementById('saved-btn').click()));
  box.appendChild(sv);
  return box;
}

/* ----------------------------------------------------------- Photo mode */
function pickCat(k) {
  photos.setCat(k);
  W.photoOpen = null;
  changed();
}

/* ------------------------------------------------------------- Square */
let squareSeq = 0;
function renderSquare(opts = {}) {
  const root = W.root;
  const seq = ++squareSeq;
  const draw = () => {
    if (seq !== squareSeq || W.mode !== 'square' || W.view !== 'paper') return;
    square.render(root, { limit: opts.limit });
    paperTop(root);
    if (app.activeTab() === 'wire') app.paintSubnav();
    landSquare();
  };
  if (square.loaded()) {
    draw();
    /* the Unfiltered wire failed last time: try again (it redraws on arrival) */
    if (!W.pulse) pulseForSquare();
    return;
  }
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
    const was = photos.cat();
    photos.render(root, { limit: opts.limit, until: W.photoOpen || opts.until });
    paperTop(root);
    /* the subnav names the chip: paint it again if a rebuild moved it (a
       kind can drop under the chip's minimum) */
    if ((first || photos.cat() !== was) && app.activeTab() === 'wire') app.paintSubnav();
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
  everything: () => geo() === 'everything',
  /* the day's pictures from everywhere (the payload key may still settle) */
  world: () => (W.today && (W.today.photos_world || W.today.world_photos)) || [],
});

/* the day the reader is in: the one the page opened on, or the earlier day
   they have scrolled down into */
function paintDateline(date) {
  W.reading = date;
  document.querySelectorAll('#subnav .wday, #panel-wire .wband .wday').forEach(fillPager);
}

function startDay() {
  const date = W.start || W.shownDay || todayKey();
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
  paintFilters();
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
/* Top to bottom: the head (whose top stories these are, how many stories,
   the Local / Everything switch), the Brief pinned on the days it went
   out, the top stories (the day's ranking: five as big cards, the rest on
   request), then the river by time of day, and on into the days before.
   Before today's first ranking the paper opens on the latest day that has
   one (the reviewers, 2026-10-19: a morning reader met two empty states
   and no stories). */
function render(opts = {}) {
  const root = W.root;
  if (!root) return;
  stopRun();
  if (W.view === 'raw') { renderRaw(); return; }
  if (W.mode === 'photos') { renderPhotos(opts); return; }
  if (W.mode === 'square') { renderSquare(opts); return; }
  if (W.topic !== 'all') { loadMutes(); checkTopic(startDay()); }
  if (W.ch === 'instagram') { renderInstagram(opts); return; }
  if (W.failed && !W.today) {
    root.innerHTML = '<div class="errbox"><b>Couldn’t reach the wire.</b><br>The paper is served from GitHub. If you are offline it will come back on its own.</div>';
    return;
  }
  if (!W.today) { root.innerHTML = '<p class="loading">Loading the wire…</p>'; return; }
  loadMutes();
  root.innerHTML = '';
  const feed = el('div', 'feed wire');
  root.appendChild(feed);

  const tk = todayKey();
  /* what the reader is shown as the top of today's paper: the bookmark
     saved on leaving is this, never a payload that landed unseen since */
  if (!W.start && W.today && W.today.date === tk && W.view === 'paper') {
    const top = dayOf(W.today).all[0];
    if (top) W.seenTop = { date: tk, k: top.k };
  }
  let date = W.start || tk;
  let p = payloadFor(date);
  let d = p ? dayOf(p) : null;
  /* today has no ranking yet: lead with the latest day that has one. With
     nothing at all today, that day is the page; with a few stories in,
     its top stories lead and today's stories follow them. */
  let borrow = null;
  W.shownDay = null;
  if (!W.start && unfiltered()) {
    const empty = !d || !d.all.some(seen);
    if (empty || !mattersOf(d).list.length) {
      const prev = W.noEarlier === tk ? null : olderThan(tk);
      const pp = prev && payloadFor(prev);
      /* nothing today and the archive not in yet: wait for it rather than
         flash an empty paper */
      if (empty && (!W.idxDone || (prev && !pp))) root.innerHTML = '<p class="loading">Loading the wire…</p>';
      if (prev && !pp) {
        loadEdition(prev).then(() => { if (W.view === 'paper' && W.mode === 'news' && !W.start && (!W.panel || W.panel.scrollTop < 120)) render(); },
          () => { W.noEarlier = tk; if (empty && W.view === 'paper' && W.mode === 'news') render(); });
        if (empty) return;
      } else if (empty && !W.idxDone) return;
      else if (pp) {
        if (empty) { date = prev; p = pp; d = dayOf(pp); W.shownDay = prev; } else if (mattersOf(dayOf(pp)).list.length) borrow = dayOf(pp);
      }
    }
  }
  const top = borrow || d;
  const ranked = !!(top && unfiltered() && (mattersOf(top).list.length || mattersOf(top).earlier.length));
  W.reading = date;
  paperTop(root);
  headBlock(feed, borrow ? borrow.date : date, borrow || d, ranked);
  const exclude = new Set();
  if (d && unfiltered()) {
    if (d.brief && seen(d.brief)) {
      put(feed, briefPin(d));
      exclude.add(d.brief.k);
    }
    if (top) topBlock(feed, top, top.date === tk).forEach((k) => exclude.add(k));
    if (borrow) {
      const n = countsOf(d).all;
      section(feed, 'Today so far', esc(plural(n, 'story', 'stories') + (W.today.updated ? ' · updated ' + clock(Date.parse(W.today.updated)) : '')));
    }
  }
  /* the Brief and the open picks count toward the first sixty */
  const above = feed.querySelectorAll('[data-k]').length;
  const run = {
    feed, exclude, first: date, lastDate: null, queue: [], shown: 0,
    limit: Math.max(FIRST - above, opts.limit || 0), until: opts.until && !exclude.has(opts.until) ? opts.until : null,
    done: false, loading: false, breaks: [], keys: [],
    borrowed: borrow ? borrow.date : null, borrowedKeys: borrow ? new Set(mattersKeys(borrow)) : null,
    sentinel: el('div', 'loading'),
  };
  run.sentinel.setAttribute('aria-hidden', 'true');
  feed.appendChild(run.sentinel);
  W.run = run;
  W.reading = date;
  fill(run);
  app.bindFeed(feed, { onSource: sourceSheet, onMute: muteSource });
  watch(run);
  /* the filters read the day this paper shows */
  if (app.activeTab() === 'wire') { app.paintAside(); paintFilters(); paintDateline(W.reading); }
  if (W.refocus) {
    const b = root.querySelector('.wband .wday ' + W.refocus);
    const to = b && !b.disabled ? b : root.querySelector('.wband .wday button:not(:disabled)');
    W.refocus = null;
    if (to) to.focus({ preventScroll: true });
  }
}

/* today has no ranking (or no stories) yet, so the paper leads with an
   earlier day's */
function needsEarlier() {
  if (!unfiltered() || !W.today || W.today.date !== todayKey()) return false;
  loadMutes();
  const d = dayOf(W.today);
  return !d.all.some(seen) || !mattersOf(d).list.length;
}

/* The head: whose top stories these are, a count and the time, the switch.
   Narrowed by a filter, it says what by, with one way back. */
const KIND_NAME = Object.fromEntries(KINDS);
const TOPIC_NAME = Object.fromEntries(TOPICS.map(([k, l]) => [k, l]));
function headSub(date, d) {
  const tk = todayKey();
  const n = d ? countsOf(d).all : (indexEntry(date) ? Number(indexEntry(date).count) || 0 : 0);
  /* today: when it last changed (the count lives in Filters, beside each
     kind); an earlier day: its date and how many it held */
  let sub = date === tk
    ? (W.today && W.today.updated ? 'Updated ' + clock(Date.parse(W.today.updated)) : plural(n, 'story', 'stories'))
    : shortDay(date) + ' · ' + plural(n, 'story', 'stories');
  if (W.stale) sub += ' · reconnecting';
  return sub;
}
function headBlock(host, date, d, ranked) {
  const tk = todayKey();
  const h = el('div', 'whead');
  const day = date === tk ? 'Today' : weekday(date);
  h.innerHTML = '<h2>' + esc(ranked ? (date === tk ? 'Today’s' : day + '’s') + ' top stories' : day) + '</h2>';
  const row = el('div', 'whead-row', '<span class="s"></span>');
  row.firstChild.textContent = headSub(date, d);
  row.firstChild.dataset.of = date;
  h.appendChild(row);
  const on = [];
  if (W.ch !== 'all') on.push(KIND_NAME[W.ch] || W.ch);
  if (W.topic !== 'all') on.push(TOPIC_NAME[W.topic] || '');
  if (W.slot) on.push('as of ' + (SLOTS.find((x) => x[0] === W.slot) || ['', ''])[1].toLowerCase());
  if (on.length) {
    const f = el('div', 'wfilt', 'Showing ' + on.filter(Boolean).map((t) => '<b>' + esc(t) + '</b>').join(' · '));
    f.appendChild(button('Clear', 'ghost sm', clearFilters));
    h.appendChild(f);
  }
  host.appendChild(h);
  return h;
}
/* the stale flag came or went: say so in the head, in place */
function paintHeadSub() {
  const s = W.root && W.root.querySelector('.whead-row .s');
  if (!s) return;
  const date = s.dataset.of;
  const p = payloadFor(date);
  s.textContent = headSub(date, p ? dayOf(p) : null);
}

/* the Brief: a pin above the top stories, words only */
function briefPin(d) {
  return wireCls(cards.lead({ ...d.brief, media: '', thumb: '', why: '' }, { tag: 'The Brief', greenLocal: greenOf(d.brief), meta: geoMeta(d.brief) }), d.brief);
}
function mattersOf(d) {
  const keep = (x) => seen(x.c) && (x.c.local || geo() === 'everything');
  return { list: d.picks.filter(keep), earlier: d.earlier.filter(keep) };
}
const mattersKeys = (d) => { const { list, earlier } = mattersOf(d); return list.concat(earlier).map((x) => x.c.k); };

/* ---------------------------------------------- three rankings a day */
/* What matters is ranked again about 6 am, noon and 6 pm (Stephen,
   2026-10-17: "making that more apparent ... from earlier in that day").
   Filters offers Morning · Midday · Evening: the current ranking is
   chosen; an earlier one shows the top stories as they stood then. A slot
   is the latest ranking in its part of the day, Burlington time. The
   payload keeps the current ranking (`picks`) and, for each story a later
   ranking dropped, its last rank and that ranking's time
   (`picks_earlier`). The stories an earlier ranking shared with the
   current one are not stored with their rank then, so they fill that
   ranking's other places in today's order, when they were posted before
   it. */
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
/* Morning · Midday · Evening, in Filters; only when there was more than
   one ranking to choose from */
function slotRow(d) {
  const { slots, now } = rankings(d);
  if (!now || Object.keys(slots).length < 2) return null;
  const want = W.slot && slots[W.slot] ? W.slot : now;
  const g = el('div', 'wm-slots');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', 'Today’s rankings');
  SLOTS.forEach(([key, label]) => {
    const has = !!slots[key];
    const b = el('button', 'wm-slot' + (key === want ? ' on' : ''), esc(label) + (has ? '<span class="t">' + esc(clock(Date.parse(slots[key].at))) + '</span>' : ''));
    b.type = 'button';
    b.dataset.slot = key;
    b.disabled = !has;
    b.setAttribute('aria-pressed', key === want ? 'true' : 'false');
    b.addEventListener('click', () => { if (has && key !== want) { W.slot = key === now ? null : key; changed(); } });
    g.appendChild(b);
  });
  return { row: g, slots, now, want };
}

/* The top stories: the day's ranking, one to five as big cards, then one
   button for the rest and, under a small head, the stories an earlier
   ranking that day held, each under the rank it last had. Today's block
   can show an earlier ranking (Filters). Returns every key in the block,
   open or not, so the river leaves them all out. */
function topBlock(host, d, isToday) {
  const { list, earlier } = mattersOf(d);
  let shown = list.map((x, i) => ({ ...x, n: i + 1 }));
  let early = earlier;
  if (isToday && W.slot) {
    const { slots, now } = rankings(d);
    if (slots[W.slot] && W.slot !== now) { shown = asItStood(d, slots[W.slot].at); early = []; }
  }
  if (!shown.length && !early.length) return mattersKeys(d);
  const box = el('div', 'wleads');
  shown.slice(0, PICKS_OPEN).forEach((x) => put(box, leadCard(x.c, x.why, x.n)));
  if (box.children.length) host.appendChild(box);
  const rest = shown.slice(PICKS_OPEN);
  const more = () => {
    const f = document.createDocumentFragment();
    rest.forEach((x) => put(f, storyRow(x.c, { rank: x.n })));
    if (early.length) {
      f.appendChild(el('p', 'wsub', esc(isToday ? 'Earlier today' : 'Earlier that day')));
      early.forEach((x) => put(f, storyRow(x.c, { rank: x.rank || '' })));
    }
    return f;
  };
  const hidden = rest.length + early.length;
  if (hidden && (W.open.has(d.date) || !shown.length)) host.appendChild(more());
  else if (hidden) {
    const b = button(esc('More top stories · ' + hidden), 'ghost wmore-btn', () => {
      W.open.add(d.date);
      const f = more();
      const rows = [...f.querySelectorAll('[data-k]')];
      b.replaceWith(f);
      /* the reader asked for these: move focus to the first, not the top */
      const a = rows[0] && rows[0].querySelector('a');
      if (a) a.focus({ preventScroll: true });
      hydrateVotes(host, rows.map((r) => r.dataset.k));
    });
    host.appendChild(b);
  }
  return mattersKeys(d);
}

/* The Wire's two cards. A plain headline or a post is a story row, a video
   keeps its poster and play button, a top story is the big card. Local and
   National are words on the meta line, and only on Everything, where the
   two share the list (on Local every story is local). */
/* X says so on the meta line; a Facebook group's name is long enough (and
   says what it is), a subreddit's name says Reddit */
const VIA = { x: 'X' };
function geoMeta(c) {
  if (geo() !== 'everything') return '';
  return c.local ? '' : '<span class="dot"></span><span class="geo">National</span>';
}
function wireCls(n, c) {
  if (!n) return n;
  if (SRC_CH.has(c.ch)) n.classList.add('w-src-' + c.ch);
  if (c.local && geo() === 'everything') n.classList.add('w-local');
  return n;
}
function leadCard(c, why, rank) {
  const media = c.kind === 'video' ? c.media : c.thumb;
  return wireCls(cards.lead({ ...c, media, thumb: '', why, via: VIA[c.ch] || '' }, { rank, greenLocal: greenOf(c), meta: geoMeta(c) }), c);
}
function storyRow(c, o = {}) {
  if (c.kind === 'video') return wireCls(cards.video(c, { greenLocal: greenOf(c), noComments: !c.comments }), c);
  return wireCls(cards.story({ ...c, via: VIA[c.ch] || '' }, { rank: o.rank, greenLocal: greenOf(c), meta: geoMeta(c) }), c);
}
const draw = (c) => storyRow(c);

/* "⋯" on a card: vote, share, the original, the source, mute */
function moreSheet(it) {
  app.sheet(it.src || 'Story', (body, card, close) => {
    body.appendChild(el('p', 'wmore-t', esc(it.title || it.text)));
    const list = el('div', 'wacts');
    const row = (icon, label, cls, fn) => {
      const b = el('button', 'wact' + (cls ? ' ' + cls : ''), icon + '<span class="l">' + esc(label) + '</span><span class="n"></span>');
      b.type = 'button';
      b.addEventListener('click', fn);
      list.appendChild(b);
      return b;
    };
    const count = () => (Number(it.votes) || 0) + store.voteCount(it.k);
    const paintUp = (b) => {
      const on = store.hasVoted(it.k);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.querySelector('.l').textContent = on ? 'Upvoted' : 'Upvote';
      b.querySelector('.n').textContent = count() || '';
    };
    const up = row(ICON.up, 'Upvote', '', () => { app.toggleVote(it); paintUp(up); });
    up.dataset.wact = 'up';
    paintUp(up);
    row(ICON.share, 'Share', '', () => { close(); app.share('wire', it.k, it.title || it.text); }).dataset.wact = 'share';
    const label = it.open || (it.ch === 'reddit' ? 'Open the thread' : 'Open the story');
    const a = el('a', 'wact', ICON.ext + '<span class="l">' + esc(label) + '</span>' + (it.comments ? '<span class="n">' + esc(plural(it.comments, 'reply', 'replies')) + '</span>' : ''));
    a.href = safeHref(it.href);
    a.target = '_blank'; a.rel = 'noopener';
    a.dataset.wact = 'open';
    a.addEventListener('click', (e) => {
      store.markRead(it.k);
      document.querySelectorAll('.card[data-k="' + CSS.escape(it.k) + '"]').forEach((n) => n.classList.add('is-read'));
      if (app.demo || !/^https?:/.test(it.href || '')) { e.preventDefault(); app.toast(label + ' in the real build'); }
    });
    list.appendChild(a);
    if (it.sid || it.src) {
      row(ICON.eye, 'More from ' + it.src, '', () => { close(); sourceSheet(it.sid || it.src, it); }).dataset.wact = 'source';
      row(ICON.x, 'Mute ' + it.src, 'warn', () => { close(); muteSource(it.sid || it.src, it); }).dataset.wact = 'mute';
    }
    body.appendChild(list);
  });
}
app.onAct('wmore', (it) => moreSheet(it));

/* The entries one day adds to the river: its head (unless it is the day the
   page opened on), its own top stories for an earlier day, then its stories
   newest first under the part of the day each was posted in, by the clock
   it shows (the reviewers, 2026-10-19: a 9:43 pm post sat under Morning,
   because the dividers were the pipeline's runs), and the new-since line
   on today. */
/* midnight in Burlington at the start of a day, in epoch seconds */
function dayStart(date) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 5);
  return (guess - etHour(guess) * 3600000) / 1000;
}
function partOf(sec, start) {
  if (sec < start) return 'The night before';
  const h = etHour(sec * 1000);
  return h >= 17 ? 'Evening' : h >= 12 ? 'Afternoon' : h >= 5 ? 'Morning' : 'Overnight';
}
function entriesFor(run, date, p) {
  const out = [];
  const tk = todayKey();
  const isFirst = date === run.first;
  if (!isFirst) {
    const n = p ? countsOf(dayOf(p)).all : 0;
    const yest = date === dayBefore(tk);
    const parts = dayName(date).split(', ');
    out.push({ head: date, title: yest ? 'Yesterday' : parts[0],
      sub: (yest ? dayName(date) : parts[1] || '') + ' · ' + (!p || p.final ? plural(n, 'story', 'stories') : 'as it stood at ' + clock(Date.parse(p.updated))) });
  }
  const d = p ? dayOf(p) : null;
  /* an earlier day opens with its own top stories, and its river leaves
     them out; the day whose top stories lead the page skips them here */
  let exclude = isFirst ? run.exclude : new Set();
  if (!isFirst && d && unfiltered()) {
    /* and its Brief pinned above them */
    if (d.brief && seen(d.brief)) { out.push({ pin: d }); exclude.add(d.brief.k); }
    if (run.borrowed === date) run.borrowedKeys.forEach((k) => exclude.add(k));
    else {
      const { list, earlier } = mattersOf(d);
      if (list.length || earlier.length) {
        list.concat(earlier).forEach((x) => exclude.add(x.c.k));
        out.push({ matters: d });
      }
    }
  }
  const once = new Set();
  const list = [];
  (d ? d.updates : []).forEach((u) => u.items.forEach((c) => {
    if (once.has(c.k) || !shows(c) || exclude.has(c.k)) return;
    once.add(c.k);
    list.push(c);
  }));
  list.sort((a, b) => b.d - a.d);
  const start = dayStart(date);
  const items = [];
  let part = null;
  list.forEach((c) => {
    const now = partOf(c.d, start);
    if (now !== part) { out.push({ divider: now }); part = now; }
    const e = { c };
    out.push(e);
    items.push(e);
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
  if (!items.length && !(isFirst && run.borrowed)) {
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
        paintFilters();
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
  const feed = el('div', 'feed wire');
  root.appendChild(feed);
  paperTop(root);
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
      const node = cards.story({ ...v.it, title: v.cap, thumb: v.media, ago: v.it.ago }, {});
      if (!node) continue;
      node.classList.add('w-src-instagram');
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
    } else if (e.pin) {
      node = briefPin(e.pin);
      if (node) { run.shown++; added.push(e.pin.brief.k); }
    } else if (e.matters) {
      const box = el('div');
      topBlock(box, e.matters, false);
      const keys = [...box.querySelectorAll('[data-k]')].map((n) => n.dataset.k);
      while (box.firstChild) run.feed.insertBefore(box.firstChild, run.sentinel);
      run.shown += keys.length;
      added.push(...keys);
    } else if (e.newline) node = cards.newline(e.newline);
    else if (e.note) node = el('p', 'note pad', esc(e.note));
    else if (e.c) {
      node = draw(e.c);
      if (node) {
        run.shown++; added.push(e.c.k);
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
  floatCheck();
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
      items.slice(0, 12).forEach((c) => put(f, draw(c)));
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
      items.forEach((c) => put(s, cards.story(c, { greenLocal: c.local })));
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
      const node = cards.story(c, { greenLocal: c.local });
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
      items.slice(0, 12).forEach((c) => put(f, cards.story(c)));
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
const PHOTO_KEY = /^(b-|g-|ig:|pw:)/;
const isPhotoParam = (p) => p === 'photos' || p.startsWith('photos/') || PHOTO_KEY.test(p);
function landPhotos(p) {
  const k = p === 'photos' ? '' : p.startsWith('photos/') ? p.slice(7) : p;
  W.view = 'paper';
  W.wantSquare = false;
  if (W.mode !== 'photos') { W.mode = 'photos'; photos.remember('photos'); }
  /* a shared picture is found under All; one from everywhere, on Everything */
  if (k) photos.setCat('all');
  if (/^pw:/.test(k) && geo() !== 'everything') setGeo('everything');
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
    data.setStaleHandler((s) => { if (W.stale !== s) { W.stale = s; if (app.activeTab() === 'wire') paintHeadSub(); } });
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
    /* today has no ranking yet: the page can now lead with the latest day that does */
    if (W.view === 'paper' && W.mode === 'news' && !W.start && W.ch !== 'instagram' && (!W.panel || W.panel.scrollTop < 120) && needsEarlier()) render();
    if (app.activeTab() === 'wire') paintFilters();
    /* the day's ‹ can now see the days before */
    if (W.reading) paintDateline(W.reading);
    land();
  }, () => {
    W.idxDone = true;
    /* an empty today waited for the archive; without it, draw today as it is */
    if (W.view === 'paper' && W.mode === 'news' && !W.start) render();
    land();
  });
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
  keepSubnav: true,
  aside,
  newSince,
  pull() {
    if (applyQueued()) return 'Fresh stories are in';
    if (W.view !== 'paper' || W.start || W.mode !== 'news' || W.ch === 'instagram') return null;
    return SRC.check();
  },
});
