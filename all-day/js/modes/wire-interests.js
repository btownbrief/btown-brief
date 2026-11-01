/* wire-interests.js — the Wire's Explore wall, and somebody else's feed on it
   (Stephen, 2026-11-01: "take a break from mine and explore someone else's
   world a little bit"; Ashley: Instagram's Explore, not the news, and beagles
   and labs, not every dog).

   The wall is the cell at the end of News · Recaps · Town · Photos
   (explore.js owns the cell's memory and draws the tiles, two across, each
   with its words under it). Under the pill is a row of chips, each its own
   colour, and they pick what fills it. They live only here: tap one and the
   wall becomes that feed; tap another and they take turns, tile by tile, the
   first tapped first; tap it again and it is undone. What is on stays on the phone (localStorage `allday-wire-feeds`) and
   nothing but the chips changes it, so a word, a link or the cell never clears
   Ashley's picks. #wire/feed/dogs+good opens it, for that visit; a chip tapped
   there keeps what is on screen. #wire/feed/dogs.beagle holds the breed too;
   #wire/explore opens the wall as it is.

   With no chip on, the wall is how News lives in Explore: only 5% of Local
   stories have a picture, so it mixes Burlington's Instagram pictures with the
   day's stories, one story after every few pictures, spaced so the colour
   lasts. A story with a picture is a picture tile with its headline under it;
   one without is a coloured headline tile in its source's colour. Local,
   National and Everything, mutes and Hide politics all apply. A paid post
   (`ad`), a pitch, or an offer that has run out is never on a wall or in a feed.

   With a chip on it is pictures first, with short headlines among them:
     - Instagram posts carrying the feed's key in `t`, from accounts in
       data/instagram-handles.json with an `interest` (build_instagram.py), so
       one account of hundreds never decides the feed. The posts are dealt out
       one account at a time, and the deal changes by the hour.
     - Burlington's own pets on Dog people (a post whose kind is pets and
       whose caption says dog). Beagles and Labs lead Dog people, the other
       dogs after them; cats, cartoons and merch are never in it.
     - all-day/data/interests.json (scripts/build_interests.py): free RSS for
       Good news, Nosy and Tech, the politics and the grim left out there.
       Nosy is headlines only: its pictures can be booking photos.

   A chip with nothing behind it is left out. Dog people has Beagles and Labs
   under it when there are enough of them to be worth a chip. Tiles this phone
   showed on an earlier sitting sink to the bottom (explore.js). A wall draws
   as soon as either half of it is in, less a moment's grace, and the late half
   joins below what is on the screen.

   modes/wire.js owns the tab and calls in here through the ctx it hands to
   init(). Every reader-facing word is in COPY. */

import * as app from '../app.js';
import * as data from '../wire.js';
import * as photos from './wire-photos.js';
import * as explore from '../explore.js';
import { el, esc, agoShort, chips } from '../ui.js';

const FEEDS = [['dogs', 'Dog people'], ['home', 'Home fixers'], ['plants', 'Plant people'], ['good', 'Good news'], ['nosy', 'Nosy'],
  ['laughs', 'Laughs'], ['sports', 'Sports fans'], ['wild', 'Space & wild'], ['tech', 'Tech']];
const NAME = Object.fromEntries(FEEDS);
const isFeed = (k) => Object.hasOwn(NAME, k);
const BREEDS = [['all', 'All dogs'], ['beagle', 'Beagles'], ['lab', 'Labs']];
const isBreed = (b) => BREEDS.some(([k]) => k === b);
const COPY = { empty: 'Nothing here yet', done: 'That’s the feed', wall: 'That’s the wall' };
const KEY = 'allday-wire-feeds';
const MIN_BREED = 4;       // a breed with fewer posts than this gets no chip
const GRID = 10;           // pictures between two runs of headlines
const BRIEFS = 3;          // headlines in a run
const WALL_GAP = 3;        // pictures before each story on the wall
const GRACE = [350, 1200]; // ms the first half waits for the other: pictures, or stories, which alone are a wall of text
const CALM = 2;            // the wall's first stories are never politics, Hide politics or not
const RECENT_DAYS = 7;     // within an account, these lead whatever the likes
const FEED_TINTS = ['feed-nosy', 'feed-wild', 'feed-laughs', 'feed-plants', 'feed-sports', 'feed-home'];   // a feed's headlines, one colour to a source
const BREED_WORD = { beagle: /\bbeagles?\b/i, lab: /\b(?:labs?|labradors?)\b/i };
const DOG_WORD = /\b(?:dogs?|pups?|puppy|puppies|doggos?|beagles?|labs?|labradors?|retrievers?|shepherds?|hounds?)\b/i;
/* the town's own crime report is news, not gossip */
const NOT_NOSY = /\b(?:state police|suspects?|atms?|homicide|shooting|stabbing)\b/i;
/* tagged a dog by its account, but not a dog: a shelter's cat, Snoopy, a tee */
const NOT_DOG = /\b(?:cats?|kitt(?:y|ies|ens?)|felines?)\b|snoopy|peanuts|\b(?:tees?|t-?shirts?|tshirts?|hoodies?|sweatshirts?|necklaces?|merch|shop now|get yours|use code)\b|\d+% off/i;

let ctx = null;
/* ctx, from modes/wire.js:
     changed(was)     the row changed, `was` a feed on before it did: repaint
                      the bar, the feed and the top
     landed()         a file arrived: draw again where the reader is
     muted(sid)       has the reader muted this source
     stories()        today's cards this reader would see, newest first
     storiesIn()      the paper has answered, with a payload or without
     whyOf(k)         the ranking's line for a story, if it was picked
     keeps(v)         the Local switch keeps this picture
     quiet(text)      Hide politics lets these words through
     feed             the Wire's own onSource and onMute, for bindFeed */
export function init(c) { ctx = c; }

const S = { ...readOn(), ig: null, text: null, miss: new Set(), bound: false, hour: 0, seen: {}, last: null, left: 0, tapped: null, run: null, list: [], visit: false, part: false, stay: [], waited: false };

/* what is kept: the keys, or { on, breed } once a breed is chosen */
function readOn() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    const on = Array.isArray(v) ? v : (v && Array.isArray(v.on) ? v.on : []);
    return { on: new Set(on.filter(isFeed)), breed: v && isBreed(v.breed) ? v.breed : 'all' };
  } catch (e) { return { on: new Set(), breed: 'all' }; }
}
function keep() {
  try {
    if (S.breed !== 'all') localStorage.setItem(KEY, JSON.stringify({ on: [...S.on], breed: S.breed }));
    else if (S.on.size) localStorage.setItem(KEY, JSON.stringify([...S.on]));
    else localStorage.removeItem(KEY);
  } catch (e) { /* this visit only */ }
}

export const active = () => S.on.size > 0;
export function clear() { if (!S.on.size) return; S.on.clear(); S.visit = false; keep(); }
/* a link's keys, each maybe with its breed. A link with no feed we know
   changes nothing: a stale one must not wipe what the reader keeps. */
const namedIn = (keys) => keys.map((k) => k.split('.')).filter(([k]) => isFeed(k));
export const names = (keys) => namedIn(keys).length > 0;
/* a link is a visit: it shows its feed and leaves what the phone keeps alone */
export function open(keys) {
  const named = namedIn(keys);
  if (!named.length) return false;
  S.on = new Set(named.map(([k]) => k));
  const dogs = named.find(([k]) => k === 'dogs');
  S.breed = dogs && isBreed(dogs[1]) ? dogs[1] : 'all';
  S.visit = true;
  return true;
}
/* the visit is over: back to the kept picks. True if that changed the wall. */
export function endVisit() {
  if (!S.visit) return false;
  S.visit = false;
  Object.assign(S, readOn());
  return true;
}
export const hash = () => [...S.on].map((k) => (k === 'dogs' && S.breed !== 'all' ? k + '.' + S.breed : k)).join('+');
/* how many tiles are drawn, for a redraw that keeps the reader's place */
export const drawn = () => (S.run ? S.run.drawn() : 0);

/* ------------------------------------------------------------- loading */
const settled = () => S.ig !== null && S.text !== null;
/* either half of what fills the wall right now, and both */
const someIn = () => S.ig !== null || (active() ? S.text !== null : ctx.storiesIn());
const allIn = () => (active() ? settled() : S.ig !== null && ctx.storiesIn());
const landed = () => ctx.landed();
/* One subscription each, for the visit: a file that failed is asked for again
   by the data layer's poll or by a pull, and lands here like the first. */
export function ensure() {
  if (S.bound) return;
  S.bound = true;
  const got = (file, take) => (j) => { S.miss.delete(file); take(j); landed(); };
  const lost = (file, take) => () => { S.miss.add(file); take(); landed(); };
  if (app.demo) {
    photos.instagram().then((posts) => { S.ig = posts || []; landed(); }).catch(() => { S.ig = []; landed(); });
    app.demoData('interests').then((j) => { S.text = j.feeds || {}; landed(); }).catch(() => { S.text = {}; landed(); });
    return;
  }
  /* after the draw that asked: a file another tab already has answers at once */
  queueMicrotask(() => {
    data.load('instagram', got('instagram', (j) => { S.ig = j.posts; }), lost('instagram', () => { S.ig = S.ig || []; }));
    data.load('interests', got('interests', (j) => { S.text = j.feeds; }), lost('interests', () => { S.text = S.text || {}; }));
  });
}
/* A pull: both files again, past the data layer's dead window. On the wall
   that freshens the posts and their signed links; off it, it only goes after
   a file that never came, so the row can come back. */
export function pull(onWall) {
  if (app.demo || !(onWall || S.miss.size)) return Promise.resolve(false);
  return Promise.all(['instagram', 'interests'].map((f) => data.reread(f))).then((r) => r.some(Boolean));
}

/* ------------------------------------------------------------- what is in it */
const interestOf = (p) => (Array.isArray(p.t) ? p.t : p.t ? [p.t] : []);
const localDog = (p) => p.kind === 'pets' && !p.n && DOG_WORD.test(String(p.c || ''));
/* the feed's own posts, and the dogs of Burlington */
const inFeed = (p, k) => (interestOf(p).includes(k) || (k === 'dogs' && localDog(p))) &&
  (k !== 'dogs' || !NOT_DOG.test(p.h + ' ' + String(p.c || '')));
const heard = (p) => photos.forWall(p) && !photos.selling(p) && !ctx.muted('ig:' + p.h) && ctx.quiet([p.c, p.hd, p.cp].filter(Boolean).join(' '));
const breedOf = (p, b) => p.br === b || BREED_WORD[b].test(String(p.c || ''));
const textOf = (k) => (S.text && Array.isArray(S.text[k]) ? S.text[k] : []).filter((x) => x && !ctx.muted('if:' + x.s) && ctx.quiet(x.t) && (k !== 'nosy' || !NOT_NOSY.test(x.t)));
const has = (k) => (S.ig || []).some((p) => inFeed(p, k) && heard(p)) || textOf(k).length > 0;

/* The hour's deal: every account's best, then the rest spaced out by how many
   each account has, so one account never fills a screen or the end of the
   feed, and a second look an hour on is a new order. An account's best is its
   best of the week, so an old hit never leads. The hour is the one the feed
   was opened in: a redraw under the reader keeps the same order. */
function deal(views) {
  const score = (s) => { let h = S.hour; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; };
  const since = photos.clockNow() / 1000 - RECENT_DAYS * 86400;
  const old = (v) => (v.d >= since ? 0 : 1);
  const by = new Map();
  views.forEach((v) => { if (!by.has(v.sid)) by.set(v.sid, []); by.get(v.sid).push(v); });
  const decks = [...by.entries()].sort((a, b) => score(a[0]) - score(b[0])).map((e) => e[1].sort((x, y) => old(x) - old(y) || (y.likes || 0) - (x.likes || 0) || y.d - x.d));
  return decks.flatMap((d, at) => d.map((v, i) => ({ v, at, turn: i / d.length }))).sort((a, b) => a.turn - b.turn || a.at - b.at).map((x) => x.v);
}
const breedDog = (p) => breedOf(p, 'beagle') || breedOf(p, 'lab');
function pictures(on) {
  /* a breed narrows the dogs, never the plants blended in with them */
  const keeps = (p, k) => inFeed(p, k) && (k !== 'dogs' || S.breed === 'all' || breedOf(p, S.breed));
  const posts = (S.ig || []).filter((p) => heard(p) && on.some((k) => keeps(p, k)));
  /* Beagles and Labs first: the other dogs are there for a reader who keeps
     going (Ashley: "beagles and labs, not every dog") */
  const later = (p) => on.includes('dogs') && inFeed(p, 'dogs') && !breedDog(p) && !on.some((k) => k !== 'dogs' && inFeed(p, k));
  return dealt(posts.filter((p) => !later(p))).concat(dealt(posts.filter(later)));
}
/* posts as they lead: one of each set, dealt, those with words before those without */
const dealt = (posts) => explore.wordsFirst(deal(explore.noTwins(photos.igList(posts))));
function briefs(on) {
  const seen = new Set();
  return on.flatMap((k) => textOf(k).map((x) => (k === 'nosy' ? { ...x, i: '' } : x)))
    .filter((x) => /^https?:/.test(x.u || '') && x.t && !seen.has(x.u) && seen.add(x.u))
    .sort((a, b) => b.ts - a.ts);
}
/* the link is the story's own: a feed headline has no place in the paper to land on */
function briefItem(x) {
  const it = { k: 'if-' + x.u, kind: 'article', href: x.u, shareUrl: x.u, title: x.t, src: x.s, sid: 'if:' + x.s, ch: 'feed', ago: x.ts ? agoShort(x.ts) : '', thumb: x.i || '' };
  app.know([it]);
  return it;
}
function briefView(x) {
  const it = briefItem(x);
  return { ...explore.storyView(it), sid: it.sid, d: x.ts || 0 };
}
/* Good news on News: the same rows, newest first, as the paper's cards. Both
   null until the file has answered. */
const goodRows = () => {
  const seen = new Set();
  return textOf('good').filter((x) => /^https?:/.test(x.u || '') && x.t && !seen.has(x.u) && seen.add(x.u));
};
export const goodCount = () => (S.text === null ? null : goodRows().length);
export const good = () => (S.text === null ? null : goodRows().sort((a, b) => b.ts - a.ts).map(briefItem));
/* A feed's headlines, every source taking its turn so one paper never fills a
   screen, each source in its own colour so a feed of nothing but headlines has
   a rhythm. */
function headlines(on) {
  const views = deal(briefs(on).map(briefView));
  const tints = new Map();
  views.forEach((v) => { if (!tints.has(v.src)) tints.set(v.src, FEED_TINTS[tints.size % FEED_TINTS.length]); });
  return views.map((v) => (v.media ? v : { ...v, tint: tints.get(v.src) }));
}

/* ------------------------------------------------------------- the row */
export function bar() {
  ensure();
  const box = el('div', 'ifeeds');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Feeds');
  box.addEventListener('scroll', () => { S.left = box.scrollLeft; }, { passive: true });
  FEEDS.filter(([k]) => S.on.has(k) || !settled() || has(k)).forEach(([k, label]) => {
    const on = S.on.has(k);
    const b = el('button', 'ifeed ifeed-' + k + (on ? ' on' : ''), esc(label));
    b.type = 'button';
    b.dataset.feed = k;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', () => {
      const was = active();
      S.visit = false;
      if (on) S.on.delete(k); else S.on.add(k);
      S.last = k;
      S.tapped = '#panel-wire .ifeed[data-feed="' + k + '"]';
      keep();
      ctx.changed(was);
    });
    box.appendChild(b);
  });
  /* every repaint is a new row: it comes back where the reader left it, and
     the chip just tapped (or, opening on a kept feed, the first lit) in view */
  queueMicrotask(() => {
    if (!box.isConnected) return;
    box.scrollLeft = S.left;
    const chip = (S.last && box.querySelector('[data-feed="' + S.last + '"]')) || box.querySelector('.ifeed.on');
    if (!chip) return;
    const a = chip.getBoundingClientRect(), r = box.getBoundingClientRect();
    if (a.right > r.right) box.scrollLeft += a.right - r.right + 16;
    else if (a.left < r.left) box.scrollLeft -= r.left - a.left + 16;
  });
  return box;
}
/* a redraw of the row takes the focus with it: it comes back to the chip */
export function keepFocus() {
  const a = document.activeElement;
  if (S.tapped || !a || !a.closest || !a.closest('#panel-wire .ifeeds, #panel-wire .ibreeds')) return;
  S.tapped = a.dataset.feed ? '#panel-wire .ifeed[data-feed="' + a.dataset.feed + '"]' : '#panel-wire .ibreeds .chip[data-chip="' + a.dataset.chip + '"]';
}
/* keyboard and screen reader stay on the chip that was tapped */
export function refocus() {
  const b = S.tapped && document.querySelector(S.tapped);
  S.tapped = null;
  if (b) b.focus({ preventScroll: true });
}
function breedRow() {
  if (!S.on.has('dogs')) return null;
  const dogs = (S.ig || []).filter((p) => inFeed(p, 'dogs') && heard(p));
  const items = BREEDS.filter(([k]) => k === 'all' || k === S.breed || dogs.filter((p) => breedOf(p, k)).length >= MIN_BREED)
    .map(([key, label]) => ({ key, label }));
  if (items.length < 2) return null;
  const row = chips(items, S.breed, (k) => {
    S.visit = false;
    S.breed = k;
    S.tapped = '#panel-wire .ibreeds .chip[data-chip="' + k + '"]';
    keep();
    ctx.changed(true);
  });
  row.classList.add('ibreeds');
  return row;
}

/* ------------------------------------------------------------- the feed */
/* Runs of each in turn, from what this phone has not seen; then everything it
   has, so a seen story never keeps its place beside a new picture. */
function interleave(pics, text, gap, run) {
  const unseen = (l) => l.filter((v) => !S.seen[v.k]);
  const a = unseen(pics), b = unseen(text);
  const out = [];
  for (let p = 0, t = 0; p < a.length || t < b.length; p += gap, t += run) out.push(...a.slice(p, p + gap), ...b.slice(t, t + run));
  return explore.sink(out.concat(pics.filter((v) => S.seen[v.k]), text.filter((v) => S.seen[v.k])), S.seen);
}
/* A run of pictures, a run of headlines. Each feed deals its own, what this
   phone has not seen first, and with two or more on they take turns one tile
   at a time, so a second chip never buries the first. A tile in two feeds goes
   out once. */
function feedViews() {
  const decks = [...S.on].map((k) => interleave(pictures([k]), headlines([k]), GRID, BRIEFS));
  const out = new Map();
  for (let i = 0; decks.some((d) => d.length > i); i += 1) decks.forEach((d) => { if (d[i] && !out.has(d[i].k)) out.set(d[i].k, d[i]); });
  return [...out.values()];
}
/* no chip on: a few pictures, a story, a few pictures, a story, until the
   day's stories run out and the pictures go on. The colours take turns, and
   the politics waits past the top. */
function wallStories() {
  const news = ctx.stories().filter((c) => !explore.weakStory(c)).map((c) => explore.storyView(c, ctx.whyOf(c.k)));
  const calm = new Set(news.filter((v) => !v.it.pol).slice(0, CALM));
  return explore.apart([...calm, ...news.filter((v) => !calm.has(v))], (v) => (v.media ? v.k : v.tint));
}
function wallViews() {
  return interleave(dealt(photos.notFeed(S.ig).filter((p) => heard(p) && !photos.aged(p) && ctx.keeps({ local: !p.n }))), wallStories(), WALL_GAP, 1);
}
/* before the page is cleared for a redraw: a half that came late joins below
   the tiles on the screen, which stay put */
export function hold() { S.stay = S.part && S.run ? S.list.slice(0, S.run.onScreen()) : []; }
export function topUp() { if (S.run) S.run.topUp(); }
export function stop() { if (S.run) S.run.stop(); S.run = null; }
/* `upto` is a redraw's count of tiles already drawn: as far down as the reader
   was, in the same order. Without it the wall starts fresh. */
export function draw(root, upto) {
  if (!upto) {
    S.hour = Math.floor(Date.now() / 3600000);
    S.seen = explore.seen();
  }
  const br = active() ? breedRow() : null;
  if (br) root.appendChild(br);
  const f = el('div', 'ifeed-list');
  root.appendChild(f);
  stop();
  const list = someIn() ? (active() ? feedViews() : wallViews()) : [];
  const stay = upto ? S.stay : [];
  const keys = new Set(stay.map((v) => v.k));
  S.list = stay.map((v) => list.find((x) => x.k === v.k)).filter(Boolean).concat(list.filter((v) => !keys.has(v.k)));
  S.part = !allIn();
  if (S.part && S.list.length && !S.waited) {
    S.waited = true;
    S.list = [];
    explore.waiting(f);
    setTimeout(() => { if (S.part) landed(); }, GRACE[S.ig === null ? 1 : 0]);
    return;
  }
  if (S.list.length) S.run = explore.grid(f, S.list, { upto, feed: ctx.feed, end: active() ? COPY.done : COPY.wall });
  else if (S.part) explore.waiting(f);
  else f.appendChild(el('p', 'rd-empty', esc(COPY.empty)));
}

/* for tests */
export const _state = () => ({ on: [...S.on], breed: S.breed, drawn: drawn(), order: S.list.map((v) => v.k) });
