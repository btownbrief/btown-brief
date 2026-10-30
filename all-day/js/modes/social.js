/* Social: the best of X, Facebook, Instagram and Reddit in one feed.

   One block for each account, group or subreddit. The block that posted last
   sits on top, so the feed is always its freshest. A block shows its newest
   post, with a picture when it has one, and its two before that. Everything
   opens on the platform it came from. The pill narrows to one platform;
   Reddit's keeps its own tab, Fresh and Questions, hosted here.

   X and Facebook are the bots' files (pulse.json's inbox), Instagram is
   all-day/data/instagram.json, Reddit is the shared intake. Every
   reader-facing word of the tab is in COPY. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, ICON, agoShort, localSwitch, geo } from '../ui.js';
import { sectionBar } from '../sections.js';
import { freshFrom } from '../reddit-lib.js';
import { _state as redditState } from './reddit.js';

const COPY = {
  label: 'Social',
  promise: 'The best of every feed',
  all: 'Latest',
  isNew: 'New',
  loading: 'Loading',
  empty: 'Nothing here yet',
  got: (n) => (n === 1 ? '1 account posted' : n + ' accounts posted'),
};
const PLATS = [['x', 'X'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['reddit', 'Reddit']];
const NAME = Object.fromEntries(PLATS);
const INTAKE_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/reddit-data/data/reddit-intake.json';
const SEEN_KEY = 'allday-social-seen';
const FIRST_LOOK = 24 * 3600000;
const PAGE = 30;
const EARLIER = 2;

const S = { on: 'all', blocks: [], loaded: false, base: 0, root: null, list: null, shown: 0, cell: 0, watcher: null, pulse: null, ig: null, reddit: null };
const seenAt = () => Number(store.read(SEEN_KEY, 0)) || Date.now() - FIRST_LOOK;

/* --------------------------------------------------------------- the blocks */
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const line = (s) => String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
const post = (href, ts, text, pic, local) => ({ k: 'so-' + hash(href), href, ts, text: line(text).slice(0, 220), pic, local });

function gather() {
  const map = new Map();
  const put = (plat, id, name, home, p) => {
    if (!/^https:/.test(p.href) || !p.ts) return;
    const key = plat + ':' + id;
    if (!map.has(key)) map.set(key, { key, plat, name, home, posts: [] });
    map.get(key).posts.push(p);
  };
  const box = (S.pulse && S.pulse.inbox) || {};
  const items = (k) => (box[k] && !box[k].paused && Array.isArray(box[k].items) ? box[k].items : []);
  items('x').forEach((x) => { const h = String(x.from || '').replace(/^@/, ''); if (h) put('x', h, x.name || '@' + h, 'https://x.com/' + h, post(x.u, x.d * 1000, x.summary, '', !!x.local)); });
  items('facebook').forEach((x) => {
    const g = /^https:\/\/(?:www\.)?facebook\.com\/groups\/[^/]+/.exec(x.u || '');
    put('facebook', x.name || x.from, x.name || x.from, g ? g[0] : 'https://www.facebook.com/', post(x.u, x.d * 1000, x.summary, '', true));
  });
  ((S.ig && S.ig.posts) || []).forEach((x) => put('instagram', x.h, '@' + x.h, 'https://www.instagram.com/' + x.h + '/', post(x.u, x.ts * 1000, x.c, x.i, true)));
  (S.reddit || []).forEach((x) => put('reddit', x.sub, x.sub, 'https://www.reddit.com/' + x.sub + '/', post(x.url, x.ts, x.title, '', true)));
  return [...map.values()];
}
function rebuild() {
  const local = geo() !== 'everything';
  S.blocks = gather()
    .map((b) => ({ ...b, posts: b.posts.filter((p) => !local || p.local).sort((x, y) => y.ts - x.ts) }))
    .filter((b) => b.posts.length && (S.on === 'all' || b.plat === S.on))
    .sort((x, y) => y.posts[0].ts - x.posts[0].ts);
}

/* ------------------------------------------------------------------ drawing */
const stamp = (ts) => (Date.now() - ts < 2 * 86400000 ? agoShort(ts / 1000) : new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
const link = (href, cls, inner) => '<a class="' + cls + '" href="' + esc(href) + '" target="_blank" rel="noopener" data-open>' + inner + '</a>';
const picture = (src) => '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
function acts(it) {
  const on = store.isSaved(it.k);
  return '<button class="act sh" data-act="share" aria-label="Share">' + ICON.share + '</button>' +
    '<button class="act star' + (on ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + on + '">' + ICON.star + '</button>';
}
/* a wide screen sets blocks two across, so its shading follows row and column */
const wideShade = (n) => (Math.floor(n / 2) + (n % 2)) % 2;
function block(b, i) {
  const top = b.posts[0];
  const it = { k: top.k, kind: 'post', title: top.text || b.name, text: '', href: top.href, src: b.name, sid: b.key, ago: stamp(top.ts), open: 'Open on ' + NAME[b.plat], thumb: top.pic };
  app.know([it]);
  const c = el('article', 'card fi so-block so-' + b.plat + (i % 2 ? ' alt' : '') + (wideShade(i) ? ' alt-w' : '') + (store.isRead(it.k) ? ' is-read' : ''));
  c.dataset.k = it.k;
  const earlier = b.posts.slice(1, 1 + EARLIER).filter((p) => p.text);
  c.innerHTML = '<div class="so-head"><span class="so-plat">' + esc(NAME[b.plat]) + '</span>' + link(b.home, 'so-name', esc(b.name)) +
      (top.ts > S.base ? '<span class="so-new">' + esc(COPY.isNew) + '</span>' : '') + '<span class="so-when">' + esc(it.ago) + '</span></div>' +
    (top.pic ? link(top.href, 'so-pic', picture(top.pic)) : '') +
    (top.text ? link(top.href, 'c-title so-text', esc(top.text)) : '') +
    (earlier.length ? '<ul class="so-earlier">' + earlier.map((p) => '<li>' + link(p.href, 'so-row', '<span>' + esc(p.text) + '</span><span class="so-when">' + esc(stamp(p.ts)) + '</span>') + '</li>').join('') + '</ul>' : '') +
    '<div class="so-foot"><span class="sp"></span>' + acts(it) + '</div>';
  return c;
}
function more() {
  const from = S.shown;
  S.blocks.slice(from, from + PAGE).forEach((b, i) => S.list.appendChild(block(b, from + i)));
  S.shown = Math.min(S.blocks.length, from + PAGE);
  S.list.querySelector('.so-end')?.remove();
  if (S.shown >= S.blocks.length) return;
  const end = el('div', 'so-end');
  S.list.appendChild(end);
  if (S.watcher) S.watcher.disconnect();
  if ('IntersectionObserver' in window) {
    S.watcher = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) more(); }, { rootMargin: '600px' });
    S.watcher.observe(end);
  }
}
function draw() {
  if (!S.root) return;
  if (S.watcher) S.watcher.disconnect();
  rebuild();
  S.root.innerHTML = '';
  if (!S.blocks.length) { S.root.appendChild(el('p', 'rd-empty', esc(S.loaded ? COPY.empty : COPY.loading))); return; }
  S.list = el('div', 'so-feed');
  S.root.appendChild(S.list);
  app.bindFeed(S.list);
  S.shown = 0;
  more();
}

/* --------------------------------------------------------------------- data */
const newCount = () => { const b = gather(); return b.filter((x) => x.posts.some((p) => p.ts > S.base)).length; };
function loaded() {
  S.loaded = !!(S.pulse || S.ig || S.reddit);
  draw();
  app.recount();
}
function loadReddit() {
  return data.fetchJSON(INTAKE_URL).then((j) => { S.reddit = freshFrom(j, Date.now()); loaded(); }).catch(() => {});
}

function setOn(k) {
  if (k === 'reddit') { app.go('reddit'); return; }
  S.on = k;
  if (app.activeTab() !== 'social') { app.go('social'); return; }
  app.paintSubnav();
  draw();
  app.scrollTop(false);
}
const bar = (current) => sectionBar({ key: 'social-on', title: COPY.label, color: '--liq-reddit', current, onPick: setOn,
  items: [{ key: 'all', label: COPY.all }, ...PLATS.map(([key, label]) => ({ key, label }))] });

app.register('social', {
  label: COPY.label,
  icon: ICON.comment,
  promise: COPY.promise,
  mount(root) {
    S.root = root;
    S.base = seenAt();
    draw();
    data.load('pulse', (j) => { S.pulse = j; loaded(); }, loaded);
    data.load('instagram', (j) => { S.ig = j; loaded(); }, loaded);
    loadReddit();
    window.addEventListener('allday-geo', draw);
  },
  activate() {},
  refresh() { draw(); },
  deactivate() { store.write(SEEN_KEY, Date.now()); },
  subnav() {
    const row = bar(S.on);
    row.appendChild(localSwitch(() => app.paintSubnav()));
    return row;
  },
  /* Reddit, hosted here, keeps its own row under this one */
  frame(child, inner) {
    const w = el('div', 'so-frame');
    w.append(bar('reddit'));
    if (inner) w.append(inner);
    return w;
  },
  keepSubnav: true,
  /* the bar's count is Reddit's threads this phone has not seen, a small file read at boot */
  newSince() { return S.loaded ? 0 : redditState().badge; },
  badge: true,
  pull() {
    const before = newCount();
    return Promise.all([data.check('pulse'), loadReddit()]).then(() => { const n = newCount() - before; return n > 0 ? COPY.got(n) : null; });
  },
});

/* for tests */
export const _state = () => ({ on: S.on, blocks: S.blocks.length, shown: S.shown, order: S.blocks.slice(0, 5).map((b) => b.key) });
