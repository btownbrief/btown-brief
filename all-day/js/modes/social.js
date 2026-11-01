/* Social: X, Facebook, Instagram, Reddit and The Board, on one scroll.

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
   before it. Everything opens on the platform it came from. Free stuff is one
   block among the Facebook groups: its posts open Facebook, its name opens
   Vintage's Free section, its link shares into Vintage, and it has no swipe
   (it is not a source to mute).

   The Board is one block: its freshest prompt and a tease, placed by its
   latest answer, opening People's Board (board.js).

   X and Facebook are the bots' files (pulse.json's inbox: x, voices, facebook
   and free), Instagram is all-day/data/instagram.json, Reddit is the shared
   intake. A paused source keeps its held posts, each with its honest age.
   Every reader-facing word of the tab is in COPY.

   The cell at the end of the pill is the tab's Explore wall (explore.js): every
   post of every platform on one scroll, each freshest first and dealt so one
   platform never runs on. Instagram and X are
   their pictures, each with its words; Reddit, Facebook and The Board are
   coloured headlines, a Reddit tile only its title and its subreddit. It is
   drawn beside the page, not over it. #social/explore opens it. Any section
   leaves it and goes there; Local, National and Everything keep working on it. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as explore from '../explore.js';
import * as photos from './wire-photos.js';
import { el, esc, ICON, agoShort, localSwitch, geo, geoKeeps } from '../ui.js';
import { sectionBar } from '../sections.js';
import { freshFrom } from '../reddit-lib.js';
import { _state as redditState } from './reddit.js';
import { freshest } from './board.js';

const COPY = {
  label: 'Social',
  promise: 'The best of every feed',
  all: 'All',
  isNew: 'New',
  loading: 'Loading',
  empty: 'Nothing here yet',
  free: 'Free right now',
  got: (n) => (n === 1 ? '1 new post' : n + ' new posts'),
  wallEnd: 'That’s the wall',
  share: 'Share',
};
const PLATS = [['reddit', 'Reddit'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['x', 'X'], ['board', 'The Board']];
const BOARD_LINK = '#people/board';
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
const S = { sections: [], open: {}, dead: new Set(), loaded: false, tried: 0, base: 0, root: null, pulse: null, ig: null, reddit: null, board: null, boardIn: false,
  wall: false, byLink: false, seen: {}, place: {}, run: null };
let wallHost = null;
const KEY = 'social';
const panel = () => (S.root ? S.root.closest('.panel') : null);
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
  data.freeOffers(S.pulse).forEach((x) => put('facebook', 'free', COPY.free, '#vintage/free', { ...post(x.u, x.d * 1000, x.title + ' · ' + x.where, x.photo || '', true), k: x.k, shareTab: 'vintage' }));
  ((S.ig && S.ig.posts) || []).filter((x) => !x.t).forEach((x) => put('instagram', x.h, x.nm || '@' + x.h, 'https://www.instagram.com/' + x.h + '/', post(x.u, x.ts * 1000, x.c, x.i, !x.n)));
  /* a subreddit is many people, not one account, so each thread people answered is its own block */
  (S.reddit || []).filter((x) => Number(x.comments) >= THREAD_MIN).forEach((x) => put('reddit', x.id || x.url, x.sub, 'https://www.reddit.com/' + x.sub + '/', post(x.url, x.ts, x.title, '', true)));
  const b = S.board;
  if (b) map.set('board', { key: 'board', plat: 'board', name: NAME.board, home: BOARD_LINK, posts: [{ ...post(BOARD_LINK, b.ts, b.q, '', true), tease: b.tease }] });
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
const itemOf = (b, p) => ({ k: p.k, kind: 'post', title: p.text || b.name, text: '', href: p.href, src: b.name, sid: b.key, ago: stamp(p.ts), open: 'Open on ' + NAME[b.plat], thumb: p.pic, shareTab: p.shareTab });
function acts(it) {
  const on = store.isSaved(it.k);
  return '<button class="act sh" data-act="share" aria-label="Share">' + ICON.share + '</button>' +
    '<button class="act star' + (on ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + on + '">' + ICON.star + '</button>';
}
/* a wide screen sets blocks two across, so its shading follows row and column */
const wideShade = (n) => (Math.floor(n / 2) + (n % 2)) % 2;
function boardBlock(b) {
  const top = b.posts[0];
  const it = { k: 'so-board', kind: 'talk', title: top.text, src: b.name, sid: b.key, href: BOARD_LINK };
  app.know([it]);
  const c = el('article', 'card so-block so-board');
  c.dataset.k = it.k;
  c.innerHTML = '<a class="c-title so-text" href="' + BOARD_LINK + '">' + esc(top.text) + '</a>' +
    top.tease.map((t) => '<p class="ans-cut">' + esc(t) + '</p>').join('') +
    '<div class="so-foot"><span class="sp"></span>' + acts(it) + '</div>';
  return c;
}
function block(b, i) {
  if (b.plat === 'board') return boardBlock(b);
  const top = b.posts[0];
  const it = itemOf(b, top);
  app.know([it]);
  const own = b.home[0] === '#';
  const c = el('article', 'card ' + (own ? '' : 'fi ') + 'so-block so-' + b.plat + (i % 2 ? ' alt' : '') + (wideShade(i) ? ' alt-w' : '') + (store.isRead(it.k) ? ' is-read' : ''));
  c.dataset.k = it.k;
  const earlier = b.posts.slice(1, 1 + EARLIER).filter((p) => p.text);
  const name = own ? '<a class="so-name" href="' + esc(b.home) + '">' + esc(b.name) + '</a>' : link(b.home, 'so-name', esc(b.name));
  c.innerHTML = '<div class="so-head">' + name +
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

/* ----------------------------------------------------------------- the wall */
/* a late file would move what is on the screen, so the wall waits for all of them */
const wallReady = () => S.tried >= SOURCES && S.boardIn;
/* a post as a tile: its picture only on X; a paragraph titles its sheet with its source */
function postView(b, p) {
  const it = itemOf(b, p);
  app.know([it]);
  const v = explore.storyView({ ...it, ch: b.plat, title: p.text });
  const long = v.line.length > LONG;
  return { ...v, it, sid: b.key, d: p.ts / 1000, media: b.plat === 'x' ? v.media : '',
    sheet: { ...v.sheet, title: long || !v.line ? b.name : v.line, text: long ? v.line : '' } };
}
/* The Board lives here in the app, so its sheet goes there, not to a platform */
function boardSheet(it, tease) {
  app.sheet(it.title, (body) => {
    const on = store.isSaved(it.k);
    const box = el('div', '', tease.map((t) => '<p class="c-text">' + esc(t) + '</p>').join('') +
      '<div class="linkrow"><button class="btn ghost" data-act="share">' + ICON.share + ' ' + esc(COPY.share) + '</button>' +
      '<button class="act star sheet-star' + (on ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + on + '">' + ICON.star + '</button>' +
      '<a class="btn" href="' + BOARD_LINK + '">' + esc(NAME.board) + '</a></div>');
    box.dataset.k = it.k;
    body.appendChild(box);
    app.bindFeed(body);
  });
}
function boardView(b) {
  const top = b.posts[0];
  /* the key follows the prompt, so a new one has not been seen */
  const it = { ...itemOf(b, top), k: 'so-board-' + hash(top.text), kind: 'talk', title: top.text };
  app.know([it]);
  return { ...explore.storyView({ ...it, ch: b.plat }), it, sid: b.key, d: top.ts / 1000, open: () => boardSheet(it, top.tease) };
}
const PICS_A_POST = 2;
function wallViews() {
  const blocks = gather();
  const posts = blocks.filter((b) => b.plat !== 'instagram' && b.plat !== 'board')
    .flatMap((b) => b.posts.filter((p) => (p.text || p.pic) && geoKeeps(p.local) && !explore.weakStory({ ch: b.plat, title: p.text })).map((p) => postView(b, p)));
  const ig = photos.igList(((S.ig && S.ig.posts) || []).filter((x) => !x.t && photos.forWall(x))).filter((v) => geoKeeps(v.local));
  const board = blocks.filter((b) => b.plat === 'board' && geoKeeps(b.posts[0].local)).map(boardView);
  /* an account's run of posts is one tile; a group's and a subreddit's are different people's */
  const account = (v) => /^(x|ig):/.test(v.sid);
  const all = explore.noTwins(posts.concat(ig).filter(account)).concat(posts.filter((v) => !account(v)), board).filter((v) => !store.isMuted(v.sid));
  /* two pictures, then a post in words, each freshest first; the words take
     turns by platform, so Reddit's morning is not one colour down the screen */
  const fresh = explore.wordsFirst(all.sort((a, b) => b.d - a.d));
  const pics = fresh.filter((v) => v.media), said = explore.apart(fresh.filter((v) => !v.media), (v) => v.tint);
  const out = [];
  for (let p = 0, t = 0; p < pics.length || t < said.length; p += PICS_A_POST, t += 1) out.push(...pics.slice(p, p + PICS_A_POST), ...said.slice(t, t + 1));
  return explore.sink(out, S.seen);
}
/* Free and The Board are not sources to mute */
const wallFeed = { onMute: (sid, it) => { if (it.href[0] !== '#' && sid !== 'facebook:free') app.mute(sid, it); } };
/* a draw when there is nothing yet is a fresh one, and tiles already shown
   sink; a redraw under the reader keeps the order and the place */
function drawWall() {
  if (!S.wall || !wallHost) return;
  /* nothing can be measured while the tab is away: it draws on the way back */
  if (app.activeTab() !== KEY) { app.markStale(KEY); return; }
  const p = panel();
  const y = p ? p.scrollTop : 0;
  const upto = S.run ? S.run.drawn() : 0;
  if (S.run) S.run.stop();
  else S.seen = explore.seen();
  S.run = null;
  wallHost.innerHTML = '';
  const list = wallReady() ? wallViews() : [];
  if (list.length) S.run = explore.grid(wallHost, list, { upto, end: COPY.wallEnd, feed: wallFeed });
  else if (wallReady()) wallHost.appendChild(el('p', 'rd-empty', esc(COPY.empty)));
  else explore.waiting(wallHost);
  if (p && upto) p.scrollTop = y;
}
function showWall(on) {
  const p = panel();
  if (p) S.place[S.wall ? 'wall' : 'page'] = p.scrollTop;
  S.wall = on;
  S.root.hidden = on;
  wallHost.hidden = !on;
  if (on && !S.run) drawWall();
  app.paintSubnav();
  app.scrollTop();
  if (p) p.scrollTop = S.place[on ? 'wall' : 'page'] || 0;
}
/* a word or a link leaves it: a visit, which writes no memory */
function leaveWall() {
  S.byLink = false;
  explore.visit(KEY);
  showWall(false);
}
const sayWhere = () => app.rewrite(location.search + '#' + KEY + (S.wall ? '/explore' : ''));
/* the cell: the layout, and nothing else */
function flipWall() {
  S.byLink = false;
  explore.flip(KEY, !S.wall);
  showWall(!S.wall);
  sayWhere();
  const b = document.querySelector('#subnav .xcell');
  if (b) b.focus({ preventScroll: true });
}

function draw() {
  if (!S.root) return;
  rebuild();
  S.root.innerHTML = '';
  if (S.sections.length) S.sections.forEach((sec) => S.root.appendChild(section(sec)));
  else S.root.appendChild(el('p', 'rd-empty', esc(S.loaded || S.tried >= SOURCES ? COPY.empty : COPY.loading)));
  drawWall();
  if (app.activeTab() === 'social') app.paintSubnav();
}

/* --------------------------------------------------------------------- data */
const newCount = () => gather().reduce((n, b) => n + b.posts.filter((p) => b.plat !== 'board' && p.ts > S.base && geoKeeps(p.local)).length, 0);
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
    S.pulse = { inbox: { x: held(j.inbox.x), voices: held(j.inbox.voices), facebook: held(j.inbox.facebook), free: held(j.inbox.free) } };
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
    /* the saved view, from the first paint; a link to somewhere is a visit */
    const link = location.hash.startsWith('#' + KEY + '/') ? location.hash.slice(KEY.length + 2) : '';
    S.wall = link ? link === 'explore' : explore.kept(KEY);
    wallHost = el('div', 'xwall');
    root.after(wallHost);
    root.hidden = S.wall;
    wallHost.hidden = !S.wall;
    draw();
    freshest().then((b) => { S.board = b; }).catch(() => {}).then(() => { S.boardIn = true; draw(); });
    if (app.demo) loadDemo();
    else {
      data.load('pulse', (j) => { S.pulse = j; loaded(); }, loaded);
      data.load('instagram', (j) => { S.ig = j; loaded(); }, loaded);
      loadReddit();
    }
    window.addEventListener('allday-geo', () => {
      if (S.run) { S.run.stop(); S.run = null; }
      draw();
      if (app.activeTab() === 'social') app.scrollTop(false);
    });
  },
  activate(param) {
    /* a link is a visit: the wall opens, or steps aside, and the phone's choice stays */
    if (param === 'explore') { if (!S.wall) { S.byLink = true; showWall(true); } return; }
    if (param) { if (S.wall) leaveWall(); return; }
    /* the bare address under a wall's link: back steps off it. Otherwise the
       tab came back to its wall, and the address says so. */
    if (S.wall) { if (S.byLink) leaveWall(); else sayWhere(); }
  },
  refresh() { draw(); },
  deactivate() { S.byLink = false; explore.settle(); store.write(SEEN_KEY, Date.now()); },
  subnav() {
    const row = sectionBar({ key: 'social-sec', title: COPY.label, color: '--liq-reddit', find: sectionNode, cell: { on: S.wall, flip: flipWall },
      onPick: (k) => {
        const off = S.wall;
        if (off) { leaveWall(); sayWhere(); }
        app.jumpTo(sectionNode(k));
        /* the pill was drawn again under the keyboard */
        const b = off && document.querySelector('#subnav .secpill .chip[data-chip="' + k + '"]');
        if (b) b.focus({ preventScroll: true });
      },
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
export const _state = () => ({ sections: S.sections.map((sec) => sec.plat), blocks: S.sections.reduce((n, sec) => n + sec.blocks.length, 0), wall: wallReady() ? wallViews() : [] });
