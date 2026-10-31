/* wire-square.js — the Wire's Square: what Burlington is posting.

   The third way to read the Wire, after News and Photos (research,
   reference/drafts/new-nine-2026-10/research/community-square.md: "one
   feed, two kinds of card"). Two kinds of post share it, visibly different:

     - neighbors' own posts on the `square` board (boards.js), full cards:
       a post, show and tell, an ask, something free, a pet. The compose
       sheet is boards.compose; posting needs the email sign-in, reading
       needs nothing. A pet or show-and-tell photo also shows in Photos.
     - what people are saying elsewhere, curated by the pipeline: the
       Facebook group posts and the Burlington and Vermont subreddits'
       threads in today's paper and on the Unfiltered wire, as compact cards
       with a source chip, two lines and the link out. Never a copied
       picture. The Unfiltered wire also follows national subreddits
       (r/news, r/technology, r/Jokes ...); they are never the Square's
       (Stephen, 2026-10-18: "I just want our Burlington in our Vermont").
       Which is which is decided by the subreddit (LOCAL_SUBS), never by
       guessing from the text.

   Newest first, with a thumb on the scale for the neighbors: a native post
   sorts as if it were six hours newer than it is.

   The board needs nn-ROUND4.sql (rules version 3). modes/wire.js asks
   boards.roundFour() and only offers Square once the answer is yes; the
   demo's boards-fake.js always has it. modes/wire.js owns the tab in All
   Day and modes/square.js in Town; each calls in here through the ctx it
   hands to init(), and each page loads only one of them.

   The chips pick a kind of post, Facebook, or one subreddit (r/burlington
   and r/vermont each have their own colour), and the pick is kept on the
   phone. A pick with nothing in it shows everything without forgetting it. */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { RULES } from '../boards-core.js';
import * as store from '../store.js';
import { el, esc, safeHref, ICON, cards, button } from '../ui.js';

const BOARD = 'square';
const BOOST = 6 * 3600;            // a neighbor's post sorts this many seconds newer
const OUTSIDE_DAYS = 3;            // how far back the outside threads go
const DAY = 86400;
const FIRST = 30;                  // cards on the first screenful
const CHUNK = 30;                  // then thirty at a time as the reader nears the bottom
const AHEAD = 1600;                // px below the screen where the next ones start drawing
/* the subreddits whose threads are the Square's, lower case */
const SUBS = { burlington: 'r/burlington', vermont: 'r/vermont', goodburlington: 'r/GoodBurlington' };
export const LOCAL_SUBS = new Set(Object.keys(SUBS));
const SUB = /^https?:\/\/(?:[a-z]+\.)?reddit\.com\/r\/([A-Za-z0-9_]+)/i;
/* a thread's subreddit: from its link, else from its source's page */
const subOf = (...urls) => { for (const u of urls) { const m = String(u || '').match(SUB); if (m) return m[1].toLowerCase(); } return ''; };
const localSub = (...urls) => LOCAL_SUBS.has(subOf(...urls));

/* the chips, in order; an empty one is left out */
export const TYPES = [['all', 'All'], ['post', 'Posts'], ['show', 'Show and tell'], ['ask', 'Ask'], ['free', 'Free'], ['pets', 'Pets'],
  ['facebook', 'Facebook'], ...Object.entries(SUBS)];
const TYPE_KEY = 'allday-square-type';
const DOT = '<i class="sdot" aria-hidden="true"></i>';
const savedType = () => { try { const v = localStorage.getItem(TYPE_KEY); return TYPES.some(([k]) => k === v) ? v : 'all'; } catch (e) { return 'all'; } };

/* the compose sheet for each kind of post */
const KINDS = {
  post: { word: 'Post', heading: 'Post to the Square', title: 'What’s up', ph: 'The maples on North Ave are peaking', body: 'More', bph: 'Go this weekend.' },
  show: { word: 'Show and tell', heading: 'Show and tell', title: 'What is it', ph: 'Finished the porch bench', body: 'The story', bph: 'Two weekends and a lot of sanding.' },
  ask: { word: 'Ask', heading: 'Ask Burlington', title: 'Your question', ph: 'Best place to get a bike tuned before winter?', body: 'More', bph: 'Anything that helps people answer.' },
  free: { word: 'Free', heading: 'Give something away', title: 'What is it', ph: 'Kids’ bike, 16 inch, needs air', body: 'More', bph: 'Condition, how long it’s out.', place: 'Where to get it', pph: 'Old North End' },
  pets: { word: 'Pet', heading: 'Post your pet', title: 'Name, and what’s happening', ph: 'Biscuit, first snow', body: 'More', bph: '' },
};
const KIND_ORDER = ['post', 'show', 'ask', 'free', 'pets'];

let ctx = null;
/* type is the reader's pick; on is what build() could honour */
const S = { posts: [], loaded: null, done: false, failed: false, type: savedType(), on: null, counts: null, list: null, seq: 0 };

/* ctx, from modes/wire.js:
     now()            the Wire's clock (pinned in the demo)
     ago(ms)          "3h", on that clock
     today()          today's paper as cards, or []
     pulse()          the Unfiltered wire once it is in, else null
     needPulse()      a promise for it
     showing()        is the Square on screen
     panel()          the tab's scroll container
     redraw()         draw it again, where the reader was
     tab              Town only: where a post's link lands, 'wire/square' if unset
     canPost()        Town only: is the board open for posts (the Wire hides the
                      whole Square until it is) */
export function init(c) { ctx = c; }

/* ------------------------------------------------------- the river's voice */
/* Muse writes each Facebook post up as "Someone is sharing the 1877 map
   ...", "Someone is asking for ...": a robot narrating a neighbour, four
   times in a row (the reviewers, 2026-10-19). Until its brief asks for the
   post's own words (wire-inbox/briefs/muse-task.md), the river drops the
   narrator: "Someone is sharing the 1877 map" reads "The 1877 map", and
   "Someone is asking for a plumber" reads "Asking for a plumber". Nothing
   is added; a line this does not recognise is left as it came. */
const NARRATOR = /^(?:someone|a member|a user|a neighbou?r|the poster|one member)\s+(?:is|was)\s+/i;
const SAYS = /^(?:sharing|announcing|promoting|posting|recounting|showing|highlighting|advertising|offering|reporting|noting|celebrating|reminding (?:people|everyone|members) (?:of|about|that)|pointing out|warning(?: people| everyone| members)? (?:about|of|that))\s+(?:that\s+)?/i;
export function ownVoice(t) {
  const s = String(t || '').trim();
  if (!NARRATOR.test(s)) return s;
  let rest = s.replace(NARRATOR, '');
  if (SAYS.test(rest)) rest = rest.replace(SAYS, '');
  if (rest.length < 12) return s;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/* ------------------------------------------------------------ loading */
function load() {
  const seq = ++S.seq;
  return boards.list(BOARD, { limit: RULES.limits.listMax }).then((r) => {
    if (seq !== S.seq) return;
    S.failed = !r.ok;
    S.posts = r.ok ? r.posts.filter((p) => p && p.id) : [];
  });
}
export function ensure() {
  if (!S.loaded) S.loaded = Promise.all([load(), ctx.needPulse()]).catch(() => {}).then(() => { S.done = true; });
  return S.loaded;
}
export const loaded = () => S.done;
window.addEventListener('allday-boards', (e) => {
  const d = e.detail || {};
  if (d.what === 'profile' || (d.board && d.board !== BOARD) || !S.loaded) return;
  load().then(() => { if (ctx && ctx.showing()) ctx.redraw(); });
});
app.onAuth(() => setTimeout(() => { if (S.loaded) load().then(() => { if (ctx && ctx.showing()) ctx.redraw(); }); }));

/* ------------------------------------------------------------ the items */
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const native = (p) => {
  /* the kind as the card's small line, except a plain post */
  const it = boards.item(p, { tab: ctx.tab || 'wire/square', ratio: 'r45', meta: () => (p.kind !== 'post' && KINDS[p.kind] ? KINDS[p.kind].word : '') });
  it.type = p.kind;
  return it;
};
/* an outside thread: today's paper first, then the Unfiltered wire */
const outKeys = new Map();
function outside() {
  const now = ctx.now() / 1000;
  const out = [];
  const add = (o) => {
    if (!o.k || !/^https?:/i.test(o.href || '') || !o.text || o.d < now - OUTSIDE_DAYS * DAY) return;
    let it = outKeys.get(o.k);
    if (!it) { it = { kind: 'post', ...o }; outKeys.set(o.k, it); app.know([it]); }
    it.ago = it.d ? ctx.ago(it.d * 1000) : '';
    out.push(it);
  };
  ctx.today().forEach((c) => {
    if (c.ch !== 'facebook' && c.ch !== 'reddit') return;
    if (c.ch === 'reddit' && !localSub(c.href, c.site)) return;
    add({ k: c.k, href: c.href, src: c.src, sid: c.sid, ch: c.ch, sub: subOf(c.href, c.site), text: squash(c.text || c.title), d: c.d, comments: c.comments || 0,
      open: c.ch === 'reddit' ? 'Open the thread' : 'Open the post' });
  });
  const P = ctx.pulse();
  const src = P && P.src;
  if (src) {
    const box = src.inbox && typeof src.inbox === 'object' ? src.inbox : {};
    const fb = box.facebook && Array.isArray(box.facebook.items) ? box.facebook.items : [];
    fb.forEach((x) => { if (x && x.u) add({ k: x.u, href: x.u, src: x.name || x.from || 'Facebook group', sid: 'inbox:' + (x.from || x.name || 'facebook'), ch: 'facebook', text: squash(x.summary), d: Number(x.d) || 0, open: 'Open the post' }); });
    const map = P.map || {};
    (src.items || []).forEach((x) => {
      if (!x || x.ch !== 'reddit' || !x.u) return;
      const s = map[x.s] || {};
      if (!localSub(x.u, s.site)) return;
      add({ k: x.u, href: x.u, src: s.short || s.name || 'r/burlington', sid: x.s, ch: 'reddit', sub: subOf(x.u, s.site), text: squash(x.t), d: Number(x.d) || 0, open: 'Open the thread' });
    });
  }
  /* once each: by key, and by its link without scheme, www or a trailing
     slash (today's paper keys a post by its id, the Unfiltered wire by URL) */
  const seen = new Set();
  const link = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return out.filter((it) => {
    const l = link(it.href);
    if (seen.has(it.k) || seen.has(l)) return false;
    seen.add(it.k); seen.add(l);
    return true;
  });
}

/* everything, newest first with the neighbors nudged up; counts for the chips */
export function build() {
  const all = S.posts.map((p) => ({ it: native(p), mine: true }))
    .concat(outside().map((it) => ({ it, mine: false })));
  const score = (x) => (x.mine ? x.it.created + BOOST : x.it.d || 0);
  all.sort((a, b) => score(b) - score(a));
  app.know(all.filter((x) => x.mine).map((x) => x.it));
  const type = (x) => (x.mine ? x.it.type : x.it.sub || x.it.ch);
  const counts = { all: all.length };
  all.forEach((x) => { counts[type(x)] = (counts[type(x)] || 0) + 1; });
  S.counts = counts;
  S.on = counts[S.type] ? S.type : 'all';
  S.list = S.on === 'all' ? all : all.filter((x) => type(x) === S.on);
  return S.list;
}
export function typeChips() {
  if (!S.counts) build();
  return TYPES.filter(([k]) => k === 'all' || S.counts[k]).map(([key, label]) => {
    const cls = key === 'facebook' ? 'w-src-facebook' : SUBS[key] ? 'w-src-reddit w-sub-' + key : '';
    return { key, label, n: key === 'all' ? null : S.counts[key], cls, icon: cls ? DOT : '' };
  });
}
export const type = () => S.on || S.type;
export function setType(k) {
  S.type = S.on = TYPES.some(([x]) => x === k) ? k : 'all';
  try { localStorage.setItem(TYPE_KEY, S.type); } catch (e) { /* private mode: this visit only */ }
}
/* everything for now, the kept pick untouched: a link to one post, a new post */
export function showAll() { S.type = S.on = 'all'; }

/* today's paper (wire-today.json) as the cards outside() reads, for a page
   without modes/wire.js */
export function paperThreads(p) {
  const sources = p && p.sources && typeof p.sources === 'object' ? p.sources : {};
  return (p && Array.isArray(p.updates) ? p.updates : []).flatMap((u) => (Array.isArray(u.items) ? u.items : []))
    .filter((it) => it && it.id && it.url && it.title && (it.ch === 'facebook' || it.ch === 'reddit'))
    .map((it) => ({ k: String(it.id), href: it.url, src: it.name || (sources[it.src] && sources[it.src].name) || it.src || '', sid: it.src || '', ch: it.ch,
      text: it.ch === 'facebook' ? ownVoice(it.title) : it.title, d: (Date.parse(it.posted_at) || 0) / 1000, comments: Number(it.comments) || 0,
      site: String(it.site || (sources[it.src] && sources[it.src].site) || '') }));
}

/* ------------------------------------------------------------- drawing */
export function compose(kind) {
  const k = KINDS[kind];
  if (!k) return;
  boards.compose({ board: BOARD, kind, heading: k.heading, title: k.title, titlePlaceholder: k.ph, body: k.body, bodyPlaceholder: k.bph,
    place: k.place, placePlaceholder: k.pph, cta: 'Post', onPosted: showAll });
}

/* the way to post: five kinds, one tap each */
function composer() {
  const box = el('div', 'sq-compose');
  box.innerHTML = '<h2>The Square</h2>';
  const row = el('div', 'sq-kinds');
  KIND_ORDER.forEach((kind) => {
    const b = button((kind === 'post' ? ICON.plus + ' ' : '') + esc(KINDS[kind].word === 'Pet' ? 'Your pet' : KINDS[kind].word), kind === 'post' ? 'sm' : 'ghost sm', () => compose(kind));
    b.dataset.compose = kind;
    row.appendChild(b);
  });
  box.appendChild(row);
  return box;
}

/* an outside thread: a compact card, its source as a coloured chip, two
   lines, the way out. Nothing in it is ever a copied picture. */
function outCard(it) {
  const c = el('article', 'card fi sq-out w-src-' + it.ch + (it.sub ? ' w-sub-' + it.sub : '') + (store.isRead(it.k) ? ' is-read' : ''));
  c.dataset.k = it.k;
  const ext = /^https?:/.test(it.href || '');
  c.innerHTML = '<div class="sq-out-h"><span class="sq-chip">' + esc(SUBS[it.sub] || it.src || 'Facebook group') + '</span>' +
    (it.ago ? '<span class="age">' + esc(it.ago) + '</span>' : '') + (it.comments ? '<span class="age">' + esc(it.comments + (it.comments === 1 ? ' comment' : ' comments')) + '</span>' : '') + '</div>' +
    '<a class="sq-out-t" href="' + esc(safeHref(it.href)) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + ' data-open>' + esc(it.text) + ' <span class="sq-out-go">' + ICON.ext + '</span></a>';
  return c;
}

export function render(root, opts = {}) {
  stop();
  const list = build();
  root.innerHTML = '';
  const post = !ctx.canPost || ctx.canPost();
  if (post) root.appendChild(composer());
  if (!list.length) {
    const e = el('div', 'caught sq-empty');
    e.innerHTML = '<h3>' + esc(S.failed ? 'The Square didn’t load.' : 'Nothing here yet.') + '</h3>';
    root.appendChild(e);
    return;
  }
  const feed = el('div', 'feed sq-feed');
  root.appendChild(feed);
  app.bindFeed(feed);
  /* drawn in chunks as the reader nears the bottom: three days of outside
     threads can run to hundreds */
  const run = { i: 0, dead: false, sentinel: el('div', 'loading') };
  run.sentinel.setAttribute('aria-hidden', 'true');
  feed.appendChild(run.sentinel);
  S.run = run;
  const panel = ctx.panel();
  const near = () => panel && run.sentinel.isConnected && ctx.showing() && run.sentinel.getBoundingClientRect().top - panel.getBoundingClientRect().bottom < AHEAD;
  const step = (n) => {
    if (run.dead) return;
    while (run.i < list.length && n-- > 0) {
      const x = list[run.i++];
      const node = x.mine ? cards.board(x.it) : outCard(x.it);
      if (node) feed.insertBefore(node, run.sentinel);
    }
    if (run.i >= list.length) {
      run.sentinel.remove();
      stop();
      feed.appendChild(cards.caught({ title: 'That’s the Square', check: false, buttons: post ? [button(ICON.plus + ' Post to the Square', '', () => compose('post'))] : [] }));
      return;
    }
    requestAnimationFrame(() => { if (near()) step(CHUNK); });
  };
  if ('IntersectionObserver' in window && panel) {
    run.io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) step(CHUNK); }, { root: panel, rootMargin: '0px 0px ' + AHEAD + 'px 0px' });
    run.io.observe(run.sentinel);
  }
  step(Math.max(FIRST, opts.limit || 0));
}
export function stop() {
  if (S.run) { S.run.dead = true; if (S.run.io) S.run.io.disconnect(); S.run = null; }
}
export const drawn = () => (S.run ? S.run.i : (S.list ? S.list.length : 0));

/* for the tests */
export const _state = () => ({ type: S.type, counts: S.counts, list: (S.list || []).map((x) => ({ k: x.it.k, mine: x.mine, type: x.mine ? x.it.type : x.it.sub || x.it.ch })) });
