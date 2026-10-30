/* Reddit: what Burlington is saying right now, and what it keeps asking.

   Two views under the pill. Fresh is r/burlington and r/vermont, newest on
   top, a hot thread in bigger type, a New mark for what arrived since this
   phone last looked. Questions is the recurring questions by category with
   the threads that asked them, a search box and one question of the day.
   reddit-lib.js decides what shows; this file only draws it.

   The intake (2MB) is fetched when the tab first opens. The bar's count
   comes from the much smaller listings file, a moment after the app boots.
   Tiles carry no votes and no comments: a tap opens the thread on Reddit.
   Never a username, never comment text. Every reader-facing word of the tab
   is in COPY. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON, agoShort } from '../ui.js';
import { sectionBar, pill } from '../sections.js';
import { freshFrom, postsFromListings, newCount, questionsFrom, questionOfDay, search, CATS } from '../reddit-lib.js';

const COPY = {
  label: 'Reddit',
  promise: 'What Burlington is saying',
  fresh: 'Fresh',
  questions: 'Questions',
  top: 'Top',
  isNew: 'New',
  qotd: 'Question of the day',
  searchHolder: 'Search questions',
  searchLabel: 'Search the questions',
  loading: 'Loading',
  noFresh: 'Nothing fresh yet',
  failed: 'Reddit didn’t load',
  noMatch: 'No match',
  moved: 'That thread has moved on',
  asked: (n) => (n === 1 ? 'Asked once' : 'Asked ' + n + ' times'),
  more: (n) => n + ' more',
  got: (n) => (n === 1 ? '1 new thread' : n + ' new threads'),
  open: 'Open on Reddit',
};

const BASE = 'https://raw.githubusercontent.com/btownbrief/btown-brief/reddit-data/data/';
const INTAKE_URL = BASE + 'reddit-intake.json';
const LISTINGS_URL = BASE + 'reddit-listings.json';
const BESTOF_URL = '../data/best-of-reddit.json';
const SEEN_KEY = 'allday-reddit-seen';
const PAGE = 40;
const STALE = 10 * 60000;
const FIRST_LOOK = 24 * 3600000;   // a phone that has never looked: the last day counts as new

const S = { view: 'fresh', cat: 'top', query: '', fresh: [], cards: [], base: 0, loaded: false, failed: false, at: 0, badge: 0, root: null, list: null, shown: 0, watcher: null };
const seenAt = () => Number(store.read(SEEN_KEY, 0)) || Date.now() - FIRST_LOOK;
const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

/* the demo's posts carry their age in hours, so it stays fresh whenever it is opened */
function demoFile() {
  return app.demoData('reddit').then((j) => {
    const now = Date.now();
    const posts = j.intake.posts.map((p) => { const created = new Date(now - p.ageHours * 3600000).toISOString(); return { ...p, created, first_seen: created }; });
    return { intake: { posts }, bestOf: j.bestOf };
  });
}
function fetchAll() {
  if (app.demo) return demoFile();
  return Promise.allSettled([json(INTAKE_URL), json(BESTOF_URL)]).then(([a, b]) => ({
    intake: a.status === 'fulfilled' && Array.isArray(a.value.posts) ? a.value : null,
    bestOf: b.status === 'fulfilled' ? b.value : null,
  }));
}
function take({ intake, bestOf }) {
  const now = Date.now();
  S.failed = !intake && !bestOf;
  if (intake) S.fresh = freshFrom(intake, now).filter((p) => !store.muted()[p.sub]);
  if (bestOf) S.cards = questionsFrom(bestOf, intake, now);
  S.loaded = true;
  S.at = now;
}

/* the bar's count of threads this phone has not seen */
function peekCount() {
  const src = app.demo ? demoFile().then((d) => d.intake.posts) : json(LISTINGS_URL).then(postsFromListings);
  src.then((posts) => {
    S.badge = newCount(freshFrom({ posts }, Date.now()), seenAt());
    app.recount();
  }).catch(() => {});
}
setTimeout(peekCount, 1200);

/* ------------------------------------------------------------------ tiles */
const stamp = (ts) => {
  const age = Date.now() - ts;
  return age < 2 * 86400000 ? agoShort(ts / 1000) : new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const year = (t) => (t.exact ? stamp(t.ts) : String(new Date(t.ts).getUTCFullYear()));
const link = (href, cls, inner) => '<a class="' + cls + '" href="' + esc(href) + '" target="_blank" rel="noopener" data-open>' + inner + '</a>';
const acts = (it) => {
  const on = store.isSaved(it.k);
  return '<button class="act sh" data-act="share" aria-label="Share">' + ICON.share + '</button>' +
    '<button class="act star' + (on ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + on + '">' + ICON.star + '</button>';
};
function known(k, title, href, src, ago) {
  const it = { k, kind: 'post', title, text: '', href, src, sid: src, ago, open: COPY.open };
  app.know([it]);
  return it;
}
/* a wide screen sets tiles two across, so its shading follows row and column
   (a hot tile takes a whole row), where a phone's simply takes turns */
function wideShade(p) {
  if (p.hot) { S.cell += S.cell % 2; S.cell += 2; return S.cell % 4 === 2 ? 0 : 1; }
  const row = Math.floor(S.cell / 2), col = S.cell % 2;
  S.cell += 1;
  return (row + col) % 2;
}
function tile(p, i) {
  const it = known('rd-' + p.id, p.title, p.url, p.sub, stamp(p.ts));
  const c = el('article', 'card fi rd-tile' + (p.hot ? ' hot' : '') + (i % 2 ? ' alt' : '') + (wideShade(p) ? ' alt-w' : '') + (store.isRead(it.k) ? ' is-read' : ''));
  c.dataset.k = it.k;
  const fresh = Math.max(p.ts, p.seen) > S.base;
  c.innerHTML = '<div class="rd-meta">' + (fresh ? '<span class="rd-new">' + esc(COPY.isNew) + '</span>' : '') +
      '<span>' + esc(p.sub) + '</span><span>' + esc(it.ago) + '</span>' + (p.flair ? '<span class="rd-flair">' + esc(p.flair) + '</span>' : '') + '</div>' +
    link(p.url, 'c-title rd-title', esc(p.title)) +
    '<div class="rd-foot"><span class="rd-n">' + ICON.up + '<b>' + esc(p.score) + '</b></span><span class="rd-n">' + ICON.comment + '<b>' + esc(p.comments) + '</b></span>' +
      (p.outlet ? '<span class="rd-out">' + esc(p.outlet) + '</span>' : '') + '<span class="sp"></span>' + acts(it) + '</div>';
  return c;
}
function qcard(card, i, tag) {
  const newest = card.threads[0];
  const it = known(card.k, card.q, newest.url, 'r/burlington', year(newest));
  const c = el('article', 'card fi rd-q' + (i % 2 ? ' alt' : '') + (tag ? ' qotd' : ''));
  c.dataset.k = it.k;
  const lone = card.n === 1 && newest.title === card.q;
  const rows = lone ? '' : card.threads.map((t, n) => '<li' + (n > 2 ? ' hidden' : '') + '>' + link(t.url, 'rd-thread', '<span>' + esc(t.title) + '</span><span class="rd-when">' + esc(year(t)) + '</span>') + '</li>').join('');
  c.innerHTML = (tag ? '<span class="eyebrow">' + esc(tag) + '</span>' : '') + link(newest.url, 'c-title rd-title', esc(card.q)) +
    '<div class="rd-meta"><b>' + esc(COPY.asked(card.n)) + '</b><span>' + esc(year(newest)) + '</span></div>' +
    (lone ? '' : '<ul class="rd-threads">' + rows + '</ul>') +
    '<div class="rd-foot">' + (card.n > 3 ? '<button class="btn ghost sm" data-more>' + esc(COPY.more(card.n - 3)) + '</button>' : '') + '<span class="sp"></span>' + acts(it) + '</div>';
  return c;
}

/* --------------------------------------------------------------- the list */
function page(items, draw) {
  if (S.watcher) S.watcher.disconnect();
  const next = () => {
    const from = S.shown;
    items.slice(from, from + PAGE).forEach((x, i) => S.list.appendChild(draw(x, from + i)));
    S.shown = Math.min(items.length, from + PAGE);
    S.list.querySelector('.rd-end')?.remove();
    if (S.shown >= items.length) return;
    const end = el('div', 'rd-end');
    S.list.appendChild(end);
    if ('IntersectionObserver' in window) {
      S.watcher = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) next(); }, { rootMargin: '600px' });
      S.watcher.observe(end);
    }
  };
  S.shown = 0;
  S.cell = 0;
  next();
}
const empty = (text) => el('p', 'rd-empty', esc(text));

function drawFresh() {
  S.root.innerHTML = '';
  if (!S.loaded) { S.root.appendChild(empty(COPY.loading)); return; }
  if (!S.fresh.length) { S.root.appendChild(empty(S.failed ? COPY.failed : COPY.noFresh)); return; }
  S.list = el('div', 'rd-feed');
  S.root.appendChild(S.list);
  app.bindFeed(S.list);
  page(S.fresh, tile);
}
function matching() {
  const inCat = S.cat === 'top' ? S.cards : S.cards.filter((c) => c.cat === S.cat);
  return search(inCat, S.query);
}
function drawCards() {
  S.list.innerHTML = '';
  const cards = matching();
  const q = !S.query && S.cat === 'top' ? questionOfDay(S.cards, Date.now()) : null;
  if (q) S.list.appendChild(qcard(q, 0, COPY.qotd));
  if (!cards.length) { S.list.appendChild(empty(COPY.noMatch)); return; }
  const rest = q ? cards.filter((c) => c !== q) : cards;
  page(rest, (c, i) => qcard(c, i + (q ? 1 : 0)));
}
function drawQuestions() {
  S.root.innerHTML = '';
  if (!S.loaded) { S.root.appendChild(empty(COPY.loading)); return; }
  if (!S.cards.length) { S.root.appendChild(empty(COPY.failed)); return; }
  const box = el('div', 'rd-search', ICON.search);
  const input = el('input', 'field');
  input.type = 'search';
  input.placeholder = COPY.searchHolder;
  input.value = S.query;
  input.setAttribute('aria-label', COPY.searchLabel);
  input.addEventListener('input', () => { S.query = input.value; drawCards(); });
  box.appendChild(input);
  S.list = el('div', 'rd-feed qs');
  S.root.append(box, S.list);
  app.bindFeed(S.list);
  S.list.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (!more) return;
    more.closest('.card').querySelectorAll('.rd-threads li[hidden]').forEach((li) => { li.hidden = false; });
    more.remove();
  });
  drawCards();
}
const draw = () => (S.view === 'questions' ? drawQuestions() : drawFresh());
function setView(v) {
  if (S.view === v) return;
  S.view = v;
  app.paintSubnav();
  draw();
  app.scrollTop(false);
}

function load() {
  return fetchAll().then((d) => {
    const before = new Set(S.fresh.map((p) => p.id));
    const first = !S.loaded;
    take(d);
    if (first) store.write(SEEN_KEY, Date.now());
    return first ? 0 : S.fresh.filter((p) => !before.has(p.id)).length;
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden || app.activeTab() !== 'reddit' || !S.loaded || Date.now() - S.at < STALE) return;
  load().then((n) => { if (n && S.root.closest('.panel').scrollTop < 40) draw(); });
});

app.register('reddit', {
  label: COPY.label,
  icon: ICON.reddit,
  promise: COPY.promise,
  mount(root) {
    S.root = root;
    S.base = seenAt();
    draw();
    load().then(() => { draw(); app.recount(); if (S.pending) land(S.pending); });
  },
  activate(param) { if (param) land(param); },
  refresh() { if (S.root) { S.fresh = S.fresh.filter((p) => !store.muted()[p.sub]); draw(); } },
  deactivate() { store.write(SEEN_KEY, Date.now()); },
  subnav() {
    const bar = sectionBar({ key: 'reddit-view', title: COPY.label, color: '--liq-reddit', current: S.view, onPick: setView,
      items: [{ key: 'fresh', label: COPY.fresh }, { key: 'questions', label: COPY.questions }] });
    if (S.view !== 'questions') return bar;
    const have = new Set(S.cards.map((c) => c.cat));
    const cats = [['top', COPY.top]].concat(CATS.filter(([k]) => !S.loaded || have.has(k)));
    bar.classList.remove('lead');
    bar.appendChild(pill({ key: 'reddit-cat', title: COPY.questions, color: '--liq-reddit', current: S.cat, items: cats.map(([key, label]) => ({ key, label })),
      onPick(k) { S.cat = k; drawCards(); app.scrollTop(false); } }));
    return bar;
  },
  keepSubnav: true,
  newSince() { return S.loaded ? 0 : S.badge; },
  badge: true,
  pull() { return load().then((n) => { if (!n) return null; draw(); return COPY.got(n); }); },
});

/* #reddit/questions, #reddit/fresh, or a shared tile or card */
function land(param) {
  if (!S.loaded) { S.pending = param; return; }
  S.pending = null;
  if (param === 'fresh' || param === 'questions') { setView(param); return; }
  const inQ = param.startsWith('q-');
  S.view = inQ ? 'questions' : 'fresh';
  if (inQ) { S.cat = 'top'; S.query = ''; }
  app.paintSubnav();
  draw();
  const items = inQ ? matching() : S.fresh;
  const at = items.findIndex((x) => (inQ ? x.k : 'rd-' + x.id) === param);
  if (at < 0 && !(inQ && questionOfDay(S.cards, Date.now())?.k === param)) { app.toast(COPY.moved); return; }
  while (S.shown <= at && S.list.querySelector('.rd-end')) {
    S.list.querySelector('.rd-end').remove();
    items.slice(S.shown, S.shown + PAGE).forEach((x, i) => S.list.appendChild((inQ ? qcard : tile)(x, S.shown + i)));
    S.shown += PAGE;
    if (S.shown < items.length) S.list.appendChild(el('div', 'rd-end'));
  }
  app.flashHit(S.root, param);
}

/* for tests */
export const _state = () => ({ view: S.view, cat: S.cat, fresh: S.fresh.length, cards: S.cards.length, base: S.base, shown: S.shown, badge: S.badge });
