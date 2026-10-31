/* Social: X, Facebook, Instagram and Reddit, on one scroll.

   One section for each platform, the platform with the newest post on top,
   and a platform with nothing under the Local, National, Everything switch
   has no section (on National, Reddit and Facebook never do). A section is
   its head, its five newest blocks and an All button: Reddit's opens its own
   tab, Fresh and Questions, hosted here with a way back; the others open
   further in place, ten at a time. The pill lists the sections in the same
   order, follows the scroll, and a tap jumps.

   One block for each account, each group, and each Reddit thread with three
   or more comments. A block shows its newest post, with a picture when it
   has one, and its two before that; a thread is one post, so it has none
   before it. Everything opens on the platform it came from.

   X and Facebook are the bots' files (pulse.json's inbox: x, voices and
   facebook), Instagram is all-day/data/instagram.json, Reddit is the shared
   intake. A paused source keeps its held posts, each with its honest age.
   Every reader-facing word of the tab is in COPY. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, ICON, agoShort, localSwitch, geo, geoKeeps } from '../ui.js';
import { sectionBar } from '../sections.js';
import { freshFrom } from '../reddit-lib.js';
import { _state as redditState } from './reddit.js';

const COPY = {
  label: 'Social',
  promise: 'The best of every feed',
  all: 'All',
  isNew: 'New',
  loading: 'Loading',
  empty: 'Nothing here yet',
  got: (n) => (n === 1 ? '1 new post' : n + ' new posts'),
};
const PLATS = [['reddit', 'Reddit'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['x', 'X']];
const NAME = Object.fromEntries(PLATS);
const INTAKE_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/reddit-data/data/reddit-intake.json';
const SEEN_KEY = 'allday-social-seen';
const FIRST_LOOK = 24 * 3600000;
const SHOW = 5;
const STEP = 10;
const EARLIER = 2;
const THREAD_MIN = 3;
const LONG = 140;   // past this a post reads as a paragraph, not a headline
/* the desks that post fifty times a day: the Wire already has them, and they would fill this feed */
const DESKS = new Set(['abc', 'cbsnews', 'nbcnews', 'reuters', 'business', 'wsj', 'washingtonpost', 'axios', 'nytimes']);

const SOURCES = 3;
const S = { sections: [], open: {}, dead: new Set(), loaded: false, tried: 0, base: 0, root: null, pulse: null, ig: null, reddit: null };
const seenAt = () => Number(store.read(SEEN_KEY, 0)) || Date.now() - FIRST_LOOK;

/* --------------------------------------------------------------- the blocks */
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const whole = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const post = (href, ts, text, pic, local) => ({ k: 'so-' + hash(href), href, ts, text: whole(text), pic, local });

function gather() {
  const map = new Map();
  const put = (plat, id, name, home, p) => {
    if (!/^https:/.test(p.href) || !p.ts) return;
    const key = plat + ':' + id;
    if (!map.has(key)) map.set(key, { key, plat, name, home, posts: [] });
    map.get(key).posts.push(p);
  };
  const box = (S.pulse && S.pulse.inbox) || {};
  const items = (k) => (box[k] && Array.isArray(box[k].items) ? box[k].items : []);
  [...items('x'), ...items('voices')].forEach((x) => { const h = String(x.from || '').replace(/^@/, ''); if (h && !DESKS.has(h.toLowerCase())) put('x', h, x.name || '@' + h, 'https://x.com/' + h, post(x.u, x.d * 1000, x.summary, x.media || '', !!x.local)); });
  items('facebook').forEach((x) => {
    const g = /^https:\/\/(?:www\.)?facebook\.com\/groups\/[^/]+/.exec(x.u || '');
    put('facebook', x.name || x.from, x.name || x.from, g ? g[0] : 'https://www.facebook.com/', post(x.u, x.d * 1000, x.summary, '', true));
  });
  ((S.ig && S.ig.posts) || []).forEach((x) => put('instagram', x.h, '@' + x.h, 'https://www.instagram.com/' + x.h + '/', post(x.u, x.ts * 1000, x.c, x.i, !x.n)));
  /* a subreddit is many people, not one account, so each thread people answered is its own block */
  (S.reddit || []).filter((x) => Number(x.comments) >= THREAD_MIN).forEach((x) => put('reddit', x.id || x.url, x.sub, 'https://www.reddit.com/' + x.sub + '/', post(x.url, x.ts, x.title, '', true)));
  return [...map.values()];
}
function rebuild() {
  const blocks = gather()
    .map((b) => ({ ...b, posts: b.posts.filter((p) => geoKeeps(p.local)).sort((x, y) => y.ts - x.ts) }))
    .filter((b) => b.posts.length && !S.dead.has(b.posts[0].k))
    .sort((x, y) => y.posts[0].ts - x.posts[0].ts);
  S.sections = PLATS.map(([plat]) => ({ plat, blocks: blocks.filter((b) => b.plat === plat) }))
    .filter((sec) => sec.blocks.length)
    .sort((x, y) => y.blocks[0].posts[0].ts - x.blocks[0].posts[0].ts);
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
  c.innerHTML = '<div class="so-head">' + link(b.home, 'so-name', esc(b.name)) +
      (top.ts > S.base ? '<span class="so-new">' + esc(COPY.isNew) + '</span>' : '') + '<span class="so-when">' + esc(it.ago) + '</span></div>' +
    (top.pic ? link(top.href, 'so-pic', picture(top.pic)) : '') +
    (top.text ? link(top.href, 'c-title so-text' + (top.text.length > LONG ? ' long' : ''), esc(top.text)) : '') +
    (earlier.length ? '<ul class="so-earlier">' + earlier.map((p) => '<li>' + link(p.href, 'so-row', '<span>' + esc(p.text) + '</span><span class="so-when">' + esc(stamp(p.ts)) + '</span>') + '</li>').join('') + '</ul>' : '') +
    '<div class="so-foot"><span class="sp"></span>' + acts(it) + '</div>';
  /* error events do not bubble, so this listens in the capture phase */
  c.addEventListener('error', (e) => {
    if (e.target.tagName !== 'IMG') return;
    e.target.closest('.so-pic')?.remove();
    if (c.querySelector('.so-text, .so-earlier')) return;
    S.dead.add(top.k);
    const sec = c.closest('.so-sec');
    c.remove();
    if (sec && !sec.querySelector('.so-block')) draw();
  }, true);
  return c;
}
function section({ plat, blocks }) {
  const sec = el('section', 'so-sec');
  sec.dataset.plat = plat;
  sec.innerHTML = '<div class="so-sec-head"><h2>' + esc(NAME[plat]) + '</h2><span class="so-when">' + esc(stamp(blocks[0].posts[0].ts)) + '</span></div>';
  const list = el('div', 'so-feed');
  sec.appendChild(list);
  app.bindFeed(list);
  const upto = S.open[plat] || SHOW;
  blocks.slice(0, upto).forEach((b, i) => list.appendChild(block(b, i)));
  if (plat !== 'reddit' && blocks.length <= upto) return sec;
  const all = el('button', 'btn ghost sm so-all', esc(COPY.all));
  all.type = 'button';
  all.addEventListener('click', () => {
    if (plat === 'reddit') { app.go('reddit'); return; }
    const from = S.open[plat] || SHOW;
    S.open[plat] = from + STEP;
    blocks.slice(from, from + STEP).forEach((b, i) => list.appendChild(block(b, from + i)));
    if (blocks.length <= S.open[plat]) all.remove();
  });
  sec.appendChild(all);
  return sec;
}
function draw() {
  if (!S.root) return;
  rebuild();
  S.root.innerHTML = '';
  if (S.sections.length) S.sections.forEach((sec) => S.root.appendChild(section(sec)));
  else S.root.appendChild(el('p', 'rd-empty', esc(S.loaded || S.tried >= SOURCES ? COPY.empty : COPY.loading)));
  if (app.activeTab() === 'social') app.paintSubnav();
}

/* --------------------------------------------------------------------- data */
const newCount = () => gather().reduce((n, b) => n + b.posts.filter((p) => p.ts > S.base && geoKeeps(p.local)).length, 0);
function loaded() {
  S.tried += 1;
  S.loaded = !!(S.pulse || S.ig || S.reddit);
  draw();
  app.recount();
}
/* ?demo=1: the file's posts carry their age in hours, so it stays fresh whenever it is opened */
function loadDemo() {
  return app.demoData('social').then((j) => {
    const ago = (h) => Date.now() - h * 3600000;
    const held = (box) => ({ ...box, items: box.items.map((x) => ({ ...x, d: Math.round(ago(x.ageHours) / 1000) })) });
    S.pulse = { inbox: { x: held(j.inbox.x), voices: held(j.inbox.voices), facebook: held(j.inbox.facebook) } };
    S.ig = { posts: j.instagram.map((x) => ({ ...x, ts: Math.round(ago(x.ageHours) / 1000) })) };
    S.reddit = j.reddit.map((x) => ({ ...x, ts: ago(x.ageHours) }));
    S.tried = SOURCES;
    loaded();
  }).catch(() => { S.tried = SOURCES; loaded(); });
}
function loadReddit() {
  if (app.demo) return Promise.resolve();
  return data.fetchJSON(INTAKE_URL).then((j) => { S.reddit = freshFrom(j, Date.now()); loaded(); }).catch(loaded);
}

const sectionNode = (k) => (S.root ? S.root.querySelector('.so-sec[data-plat="' + k + '"]') : null);

app.register('social', {
  label: COPY.label,
  icon: ICON.comment,
  promise: COPY.promise,
  mount(root) {
    S.root = root;
    S.base = seenAt();
    draw();
    if (app.demo) loadDemo();
    else {
      data.load('pulse', (j) => { S.pulse = j; loaded(); }, loaded);
      data.load('instagram', (j) => { S.ig = j; loaded(); }, loaded);
      loadReddit();
    }
    window.addEventListener('allday-geo', () => { draw(); if (app.activeTab() === 'social') app.scrollTop(false); });
  },
  activate() {},
  refresh() { draw(); },
  deactivate() { store.write(SEEN_KEY, Date.now()); },
  subnav() {
    const row = sectionBar({ key: 'social-sec', title: COPY.label, color: '--liq-reddit', find: sectionNode, onPick: (k) => app.jumpTo(sectionNode(k)),
      items: S.sections.map(({ plat }) => ({ key: plat, label: NAME[plat] })) }) || el('div', 'secbar lead');
    row.appendChild(localSwitch());
    return row;
  },
  /* Reddit, hosted here, keeps its own row under this one, and the way back */
  frame(child, inner) {
    const w = el('div', 'so-frame');
    const row = sectionBar({ key: 'social-back', title: COPY.label, color: '--liq-reddit', current: 'reddit', onPick: (k) => { if (k === 'social') app.go('social'); },
      items: [{ key: 'social', label: COPY.label }, { key: 'reddit', label: NAME.reddit }] });
    row.appendChild(localSwitch(() => { if (geo() === 'national') app.go('social'); else app.paintSubnav(); }));
    w.append(row);
    if (inner) w.append(inner);
    return w;
  },
  keepSubnav: true,
  /* the bar's count is Reddit's threads this phone has not seen, a small file read at boot */
  newSince() { return S.loaded ? 0 : redditState().badge; },
  badge: true,
  pull() {
    if (app.demo) return Promise.resolve(null);
    const before = newCount();
    return Promise.all([data.check('pulse'), loadReddit()]).then(() => { const n = newCount() - before; return n > 0 ? COPY.got(n) : null; });
  },
});

/* for tests */
export const _state = () => ({ sections: S.sections.map((sec) => sec.plat), blocks: S.sections.reduce((n, sec) => n + sec.blocks.length, 0) });
