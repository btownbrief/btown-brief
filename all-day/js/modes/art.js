/* Art: photos and art by people who live here, on one wall, voted on by the
   town. It replaces the Photos tab, which died because nobody posted: this
   one gives a reason to (a weekly winner, a shirt) and never looks empty.

   Every reader post is on the art board (boards.js, rules in boards-core.js):
   kinds photo and art (a photo is required, they never expire; meta medium
   and shirt yes/no) and notice (no photo, 30 days). A photo goes through
   the reader photo queue, so a post shows only once Stephen has approved its
   picture, and Art's approved photos also join the community gallery.

   Top to bottom, and the chip row is the table of contents:

   - Photo of the week. The photo or art post with the most votes among
     those posted since Monday, Burlington time; a tie goes to the one posted
     first. Vote, share, and "Put it on a shirt" when the maker said yes,
     which goes to #vintage/<the post's key> for Vintage's make-a-tee. With
     nothing posted this week, the newest post, and it says so. With nothing
     posted ever, tonight's sunset score and the best spot to shoot it from
     (sun.js, data/sunset-spots.json), because a reason to go out gets photos.
   - The wall. Every photo and art post, newest first, in a three-column grid
     with two tall tiles in every ten, plus the approved photos already in
     the community gallery (btb_photos_get), marked as from the gallery and
     without votes, so day one is not empty. A tile opens a sheet: the whole
     picture, title, maker, medium, votes, share, report.
   - Add yours. The boards compose sheet for a photo or a piece of art.
   - Community board. Notices: calls for artists, shows, open studios.
   - Winners. The past eight weeks' photo of the week: among the pictures
     posted that week, the most votes cast that week (boards.votesByWeek),
     so a week's winner is settled at Sunday midnight and never changes
     after. Just the name; no prizes, no points.

   This week's votes are the posts' own counts: every vote on a picture
   posted this week was cast this week. Until nn-ROUND2.sql is pasted there
   are no counts by week, and a past week is ranked by its pictures' counts
   so far, as before, which can still change. */

import * as app from '../app.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { RULES, isoWeek } from '../boards-core.js';
import { sunScore } from '../sun.js';
import { el, esc, safeHref, ICON, art, section, rail, chips, button, agoShort } from '../ui.js';

const KEY = 'art';
const BOARD = 'art';
const PAGE = RULES.limits.listMax;          // the list RPC's cap
const MAX_PAGES = 10;                       // 600 posts before the wall stops paging on its own
const WEEKS = 8;                            // winners shown
const NOTICE_DAYS = RULES.boards.art.kinds.notice.days;
const PHOTOS_LIB = '../js/photos-lib.js';
const SPOTS_URL = '../data/sunset-spots.json';
const DAY = 86400000;

const SECTIONS = [['week', 'This week'], ['wall', 'The wall'], ['add', 'Add yours'], ['board', 'Board'], ['winners', 'Winners']];
const KIND_WORD = { photo: 'Photo', art: 'Art' };

/* ------------------------------------------------------------------ state */
const S = {
  posts: null,        // every art-board post loaded so far, newest first, as the server sent it
  pics: [],           // items (boards.item) for the photo and art posts
  notices: [],        // the notice posts
  gallery: [],        // items for the community gallery's photos
  more: false,        // the server has older posts than the last page
  before: null,       // where the next page starts
  failed: null,       // a list refusal other than 'off', as its sentence
  sun: undefined, spots: null,
  heroId: null, winSig: '',
  weekly: null,       // { 'ISO week': { post id: votes cast that week } }, or null before nn-ROUND2.sql
};
let root = null, slots = null, pending = null, ready = false;
const ratios = new Map();   // demo only: a post id's picture shape

/* --------------------------------------------------- Burlington's clock */
/* A week runs Monday 00:00 to Sunday 24:00 in America/New_York, wherever
   the reader is. */
const ETF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'short' });
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function et(ms) { const o = {}; ETF.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; }); return o; }
const wallClock = (ms) => { const o = et(ms); return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second); };
/* midnight on a Burlington date, as an instant; midnight is never inside a
   daylight-saving jump (those happen at 2 am), so two passes settle it */
function midnight(y, m, d) {
  const g = Date.UTC(y, m - 1, d);
  let t = g - (wallClock(g) - g);
  t = g - (wallClock(t) - t);
  return t;
}
function weekStart(ms) { const o = et(ms); return midnight(+o.year, +o.month, +o.day - DOW[o.weekday]); }
const prevWeek = (start) => weekStart(start - 3600000);
const WEEKF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const weekLabel = (start) => 'Week of ' + WEEKF.format(new Date(start + 12 * 3600000));

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const createdMs = (it) => it.created * 1000;
/* most votes first; a tie goes to the one posted first */
const rank = (a, b) => (b.votes - a.votes) || (a.created - b.created);

/* ------------------------------------------------------------- the demo */
/* data/demo/art.json, seeded into the boards demo backend so the demo runs
   the real path: votes, reports and posting through boards.js. The
   foundation's own sample Art posts make way for these; anything a reader
   posts in the demo stays. Seeded once, the first time this tab opens, so
   the demo backend never changes under another tab mid-visit. */
let demoReady = null;
const demoSeed = () => demoReady || (demoReady = app.demoData(KEY).then((d) => { seed(d); return d; }));

function seed(d) {
  const f = boards._fake();
  if (!f) return;
  const now = Date.now();
  f.posts = f.posts.filter((p) => p.board !== BOARD || p.user_id === boards.demoReader || !/^demo-0000-/.test(p.user_id));
  const uid = (who) => 'demo-art-' + who;
  (d.people || []).forEach(([who, name]) => f.profiles.set(uid(who), { display_name: name, neighborhood: null, archetype: null }));
  let n = 0;
  const add = (row, votes) => {
    const id = '0000a000-0000-4000-8000-' + String(++n).padStart(12, '0');
    f.posts.push({ id, board: BOARD, reports: 0, status: 'approved', decided_at: null, place: '', ...row });
    for (let i = 0; i < (votes || 0); i++) f.votes.add(id + '|p_seed' + String(i).padStart(4, '0'));
    return id;
  };
  const weeks = [weekStart(now)];
  for (let i = 1; i <= WEEKS; i++) weeks.push(prevWeek(weeks[i - 1]));
  (d.posts || []).forEach((p) => {
    const start = weeks[p.week] || weeks[0];
    const end = p.week ? start + 7 * DAY : now;
    const at = Math.round(start + Math.min(Math.max(p.f || 0.5, 0), 1) * (end - start));
    const path = 'submissions/demo-' + p.palette + '-' + (n + 1) + '.jpg';
    f.addPhoto(path, 'approved', { at });
    const id = add({ user_id: uid(p.who), kind: p.kind, title: p.title, body: p.body || '', photo_path: path, photo_req: true,
      meta: { ...(p.medium ? { medium: p.medium } : {}), shirt: p.shirt || 'no' }, expires_at: null, created_at: at }, p.votes);
    ratios.set(id, p.ratio || 'r45');
  });
  (d.notices || []).forEach((p) => {
    const at = Math.round(now - (p.days || 0) * DAY);
    add({ user_id: uid(p.who), kind: 'notice', title: p.title, body: p.body || '', photo_path: null, photo_req: false, meta: {},
      place: p.place || '', expires_at: at + NOTICE_DAYS * DAY, created_at: at }, 0);
  });
}

/* ---------------------------------------------------------------- loading */
const libs = Object.create(null);
function script(src) {
  if (!libs[src]) {
    libs[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => { delete libs[src]; reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  return libs[src];
}

/* The wall's posts arrive 60 at a time, newest first. The first load keeps
   going until it has every week the winners need (this one and the eight
   before), or the board runs out; "Older pictures" asks for the next page. */
function oldestNeeded() {
  let s = weekStart(Date.now());
  for (let i = 0; i < WEEKS; i++) s = prevWeek(s);
  return s;
}
async function page() {
  const r = await boards.list(BOARD, { limit: PAGE, before: S.before });
  if (!r.ok) {
    S.more = false;
    if (r.error !== 'off') S.failed = r.message;
    return false;
  }
  S.failed = null;
  S.posts = (S.posts || []).concat(r.posts);
  S.more = r.posts.length >= PAGE;
  if (r.posts.length) S.before = r.posts[r.posts.length - 1].created_at;
  take();
  return true;
}
async function loadPosts() {
  S.posts = []; S.before = null; S.more = false;
  const need = oldestNeeded();
  for (let i = 0; i < MAX_PAGES; i++) {
    if (!(await page()) || !S.more) break;
    if (Date.parse(S.before) < need) break;
  }
}

const metaLine = (p) => [KIND_WORD[p.kind] || '', p.meta && p.meta.medium].filter(Boolean).join(' · ');
function take() {
  const now = Date.now();
  const seen = new Set();
  const posts = (S.posts || []).filter((p) => p && p.id && !seen.has(p.id) && seen.add(p.id));
  S.pics = posts.filter((p) => (p.kind === 'photo' || p.kind === 'art') && p.photo).map((p) => {
    const it = boards.item(p, { tab: KEY, ratio: ratios.get(p.id) || 'r45', meta: metaLine });
    it.pic = true;
    it.shirt = !!(p.meta && p.meta.shirt === 'yes');
    it.medium = (p.meta && p.meta.medium) || '';
    it.what = KIND_WORD[p.kind];
    return it;
  });
  S.notices = posts.filter((p) => p.kind === 'notice' && (!p.expires_at || Date.parse(p.expires_at) > now));
  app.know(S.pics);
}

/* The community gallery: every approved reader photo from before the wall
   had votes, and since. Photos filed from a board ("All Day · …") are left
   out, because their posts are on the wall already, and so are Food's
   dishes, which belong to the Weekly Bite. */
function loadGallery() {
  const got = app.demo
    ? demoSeed().then((d) => (d.gallery || []).map((g) => ({ id: g.id, url: g.palette, caption: g.caption, credit: g.credit, spot: g.spot, area: g.area,
      approved_on: new Date(Date.now() - (g.days || 0) * DAY).toISOString().slice(0, 10) })))
    : (window.BTBP ? Promise.resolve() : script(PHOTOS_LIB)).then(() => window.BTBP.getApproved()).then((r) => r.photos || []);
  return got.catch(() => []).then((photos) => {
    S.gallery = photos.filter((g) => g && g.id && g.url && !/^All Day ·/.test(g.spot || '') && g.category !== 'dish' && g.category !== 'board')
      .map((g) => {
        const when = Date.parse(g.approved_on ? g.approved_on + 'T12:00:00Z' : '') || 0;
        return { k: 'g-' + g.id, kind: 'image', gallery: true, href: '#' + KEY + '/g-' + g.id, title: g.caption || g.spot || 'A photo from the gallery',
          text: g.caption || '', author: g.credit || '', spot: g.spot || '', area: g.area && g.area !== 'Elsewhere' ? g.area : '',
          media: g.url, ratio: 'r45', created: when / 1000, ago: when ? agoShort(when / 1000) : '' };
      });
    app.know(S.gallery);
  });
}

/* Tonight's light, only asked for when the wall has nothing of its own. */
function loadSun() {
  if (S.sun !== undefined) return;
  S.sun = null;
  sunScore(data).then((sun) => { S.sun = sun; paint('week'); });
  data.fetchJSON(SPOTS_URL, 8000).then((j) => { S.spots = (j && j.spots) || []; paint('week'); }).catch(() => { S.spots = []; });
}

/* the votes cast in each of this week and the eight before, per post */
function loadWeekly() {
  return boards.roundTwo().then((two) => (two ? boards.votesByWeek(BOARD, WEEKS + 1) : { ok: false })).then((r) => {
    if (!r.ok) { S.weekly = null; return; }
    const w = {};
    r.weeks.forEach((x) => { (w[x.week] = w[x.week] || {})[x.post] = Number(x.votes) || 0; });
    S.weekly = w;
  });
}

function load() { return Promise.all([loadPosts(), loadGallery(), loadWeekly()]); }

/* The board changed under us (a post, a delete, a report, a sign-in): read
   it again. The compose sheet is a sheet, so a redraw never eats a form. */
let reloading = null;
function reload() {
  if (!ready) return;
  if (!reloading) {
    reloading = Promise.all([loadPosts(), loadWeekly()]).then(() => {
      reloading = null;
      ['week', 'wall', 'board', 'winners'].forEach(paint);
      paintWaiting();
      app.recount();
    });
  }
}
window.addEventListener('allday-boards', (e) => {
  const d = e.detail || {};
  if ((d.board && d.board !== BOARD) || d.what === 'profile') return;
  reload();
});
/* on the next task: sign-in's other listeners (the profile, the shell) go first */
app.onAuth(() => setTimeout(reload));

/* ------------------------------------------------------------ the picks */
function ofTheWeek() {
  const from = weekStart(Date.now());
  const week = S.pics.filter((it) => createdMs(it) >= from).sort(rank);
  if (week.length) return { it: week[0], fresh: true };
  const newest = S.pics.slice().sort((a, b) => b.created - a.created)[0];
  return newest ? { it: newest, fresh: false } : null;
}
function winners() {
  const out = [];
  let end = weekStart(Date.now());
  for (let i = 0; i < WEEKS; i++) {
    const start = prevWeek(end);
    const cast = S.weekly && (S.weekly[isoWeek(start + 12 * 3600000)] || {});
    const score = (it) => (cast ? cast[it.id] || 0 : it.votes);
    const best = S.pics.filter((it) => createdMs(it) >= start && createdMs(it) < end)
      .sort((a, b) => (score(b) - score(a)) || (a.created - b.created))[0];
    if (best) out.push({ start, it: best });
    end = start;
  }
  return out;
}

/* ---------------------------------------------------------------- votes */
/* One vote per reader per post (the device's id, or the account once
   signed in), counted by the board. The arrow fills at once and the count
   settles on the server's; a refusal puts it back and says why. */
function voteBtn(it) {
  const b = el('button', 'btn' + (it.voted ? '' : ' ghost'), ICON.up + '<span class="vl">' + (it.voted ? 'Voted' : 'Vote') + '</span><span class="vn">' + esc(it.votes || '') + '</span>');
  b.dataset.vk = it.k;
  b.setAttribute('aria-pressed', it.voted ? 'true' : 'false');
  return b;
}
function paintVotes(it) {
  document.querySelectorAll('[data-vk="' + CSS.escape(it.k) + '"]').forEach((n) => {
    if (n.tagName === 'BUTTON') {
      n.classList.toggle('ghost', !it.voted);
      n.setAttribute('aria-pressed', it.voted ? 'true' : 'false');
      const l = n.querySelector('.vl');
      if (l) l.textContent = it.voted ? 'Voted' : 'Vote';
    }
    const c = n.querySelector('.vn');
    if (c) c.textContent = it.votes || '';
  });
}
function vote(it) {
  if (!it || !it.pic) return;
  const was = { votes: it.votes, voted: it.voted };
  it.voted = !it.voted;
  it.votes = Math.max(0, it.votes + (it.voted ? 1 : -1));
  paintVotes(it);
  rerank();
  (it.voted ? boards.vote : boards.unvote)(it.id).then((r) => {
    if (r.ok) { it.votes = r.votes; it.voted = r.voted; } else { Object.assign(it, was); app.toast(r.message); }
    paintVotes(it);
    rerank();
  });
}
/* the sheet's vote button reaches here through bindFeed */
app.onAct('artvote', (it) => vote(it));

/* A vote can hand the week to another picture, or change a past winner. */
function rerank() {
  const w = ofTheWeek();
  if ((w ? w.it.id : null) !== S.heroId) paint('week');
  if (winSig() !== S.winSig) paint('winners');
}
const winSig = () => winners().map((w) => w.it.id).join(',');

/* ---------------------------------------------------------------- render */
function render() {
  root.innerHTML = '';
  slots = Object.create(null);
  SECTIONS.forEach(([k]) => {
    const s = el('div', 'slot');
    s.dataset.sec = k;
    slots[k] = s;
    root.appendChild(s);
  });
  SECTIONS.forEach(([k]) => paint(k));
  root.appendChild(el('div', 'spacer'));
}

function paint(k) {
  if (!ready || !slots || !slots[k]) return;
  const host = slots[k];
  const y = panel() ? panel().scrollTop : 0;
  host.innerHTML = '';
  ({ week: paintWeek, wall: paintWall, add: paintAdd, board: paintBoard, winners: paintWinners })[k](host);
  if (panel() && app.activeTab() === KEY) panel().scrollTop = y;
}

/* ------------------------------------------------------ photo of the week */
function paintWeek(host) {
  const w = ofTheWeek();
  S.heroId = w ? w.it.id : null;
  if (!w) { paintInvite(host); return; }
  const it = w.it;
  const hero = el('div', 'hero');
  const pic = el('a', 'c-media r11', art(it.media));
  pic.href = safeHref(it.href);
  pic.setAttribute('aria-label', 'See “' + it.title + '” big');
  pic.addEventListener('click', (e) => { e.preventDefault(); openSheet(it); });
  hero.appendChild(pic);
  const by = ['by ' + it.author, it.what + (it.medium ? ', ' + it.medium.toLowerCase() : '')].join(' · ');
  hero.insertAdjacentHTML('beforeend', '<span class="eyebrow">' + esc(w.fresh ? 'Photo of the week' : 'The newest on the wall') + '</span>' +
    '<h3>' + esc(it.title) + '</h3><p>' + esc(by + '. ' + (w.fresh
      ? 'The most votes on anything posted since Monday. The week closes Sunday at midnight.'
      : 'Nothing new since Monday yet, so here’s the newest. Post this week and it could be yours.')) + '</p>');
  const row = el('div', 'row');
  const up = voteBtn(it);
  up.addEventListener('click', () => vote(it));
  row.appendChild(up);
  row.appendChild(button(ICON.share + ' Share', 'ghost', () => app.share(KEY, it.k, it.title)));
  if (it.shirt) row.appendChild(shirtLink(it, 'btn ghost'));
  hero.appendChild(row);
  host.appendChild(hero);
}

/* "Put it on a shirt": the Vintage tab's make-a-tee picks the picture up
   from the hash, #vintage/b-<post id>, and nothing else. */
function shirtLink(it, cls) {
  const a = el('a', cls, ICON.tee + ' Put it on a shirt');
  a.href = '#vintage/' + encodeURIComponent(it.k);
  a.dataset.shirt = it.k;
  return a;
}

/* Nothing on the wall yet. Asking for photos does not get photos; telling
   people tonight scores 7.4 and where to stand does. */
function verdict(score) {
  if (score >= 8) return 'Drop what you’re doing.';
  if (score >= 6.5) return 'Worth the walk.';
  if (score >= 5) return 'Could go either way.';
  if (score >= 3) return 'Probably a quiet one.';
  return 'Probably a gray one, but the light changes fast.';
}
const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' AM', ' am').replace(' PM', ' pm');

function paintInvite(host) {
  loadSun();
  const sun = S.sun;
  const w = data.peek('weather');
  const iso = w && w.sun && (w.sun.sunset || w.sun.sunset_tomorrow);
  const ms = sun ? sun.sunsetMs : (iso ? Date.parse(iso) : null);
  const tonight = sun ? sun.isTonight : (ms ? ms > Date.now() : true);
  const spot = (S.spots || [])[0];
  /* A score is only a score with a forecast behind it. One worked out without
     the cloud data is a guess, and a 0.0 is what an empty forecast for
     tomorrow comes out as, not a gray sky: both are unknown, and the time
     and the spot still hold. */
  const scored = !!sun && Number.isFinite(sun.score) && sun.score > 0 && !sun.degraded;
  const tc = el('div', 'textcard gap');
  tc.dataset.k = 'invite';
  /* a good score is the headline; a gray one is said plainly, lower down */
  const day = tonight ? 'tonight' : 'tomorrow';
  const score = scored ? (tonight ? 'Tonight’s' : 'Tomorrow’s') + ' sunset scores ' + sun.score.toFixed(1) + ' out of 10' : '';
  const head = scored && sun.score >= 5 ? score : 'The wall starts with you';
  const words = [
    ms ? 'Sunset is at ' + clock(ms) + ' ' + day + '.' : '',
    scored ? (sun.score >= 5 ? '' : score + '. ') + verdict(sun.score) : '',
    'Nobody has put a picture on the wall yet, so the first one is photo of the week.',
  ].filter(Boolean).join(' ');
  tc.innerHTML = '<span class="eyebrow">Photo of the week</span><h3 class="serif">' + esc(head) + '</h3><p>' + esc(words) + '</p>' +
    (spot ? '<p><b>' + esc('Best spot: ' + spot.name) + '</b>' + esc((spot.walk_min ? ', ' + spot.walk_min + ' minutes’ walk from Church Street. ' : '. ') + (spot.why || '')) + '</p>' : '');
  const row = el('div', 'row');
  row.appendChild(button(ICON.plus + ' Add the first photo', '', () => compose('photo')));
  const a = el('a', 'btn ghost', 'The Sunset Tracker');
  a.href = '../sunset.html';
  row.appendChild(a);
  tc.appendChild(row);
  host.appendChild(tc);
}

/* ---------------------------------------------------------------- the wall */
/* Two tall tiles in every ten, placed so the grid never leaves a hole: the
   first of a block spans rows one and two on the left, the eighth spans
   rows three and four on the right. A block too short to fill around a
   tall tile gets square ones. */
function tall(i, n) {
  const pos = i % 10, left = n - (i - pos);
  return (pos === 0 && left >= 5) || (pos === 7 && left >= 10);
}

function wallItems() {
  return S.pics.concat(S.gallery).sort((a, b) => b.created - a.created);
}

function paintWall(host) {
  const list = wallItems();
  section(host, 'The wall', esc('Photos and art by people who live here, newest first. Tap one to see it big.'));
  if (S.failed && !S.pics.length) host.appendChild(el('p', 'note pad', esc(S.failed)));
  if (!list.length) {
    host.appendChild(el('p', 'note pad', esc('Nothing on the wall yet. Add yours below.')));
    return;
  }
  const g = el('div', 'grid3');
  list.forEach((it, i) => {
    const t = el('a', 'tile' + (tall(i, list.length) ? ' tall' : ''));
    t.href = safeHref(it.href);
    t.dataset.k = it.k;
    t.setAttribute('aria-label', it.title + (it.author ? ', by ' + it.author : '') + (it.gallery ? ', from the gallery' : ', ' + plural(it.votes, 'vote', 'votes')));
    t.innerHTML = art(it.media) + (it.gallery ? '<span class="lbl">From the gallery</span>'
      : '<span class="ct" data-vk="' + esc(it.k) + '">' + ICON.up + '<span class="vn">' + esc(it.votes || '') + '</span></span>');
    g.appendChild(t);
  });
  /* one listener for the grid; a tile is a link, so it also works as one */
  g.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    const it = t && app.item(t.dataset.k);
    if (!it) return;
    e.preventDefault();
    openSheet(it);
  });
  host.appendChild(g);
  if (S.more) {
    host.appendChild(button('Older pictures ' + ICON.arrow, 'ghost more', (e) => {
      e.currentTarget.disabled = true;
      page().then(() => { paint('wall'); paint('winners'); });
    }));
  } else {
    host.appendChild(el('div', 'spacer'));
    host.appendChild(el('p', 'note pad', esc('That’s the whole wall: ' + plural(list.length, 'picture', 'pictures') + ', back to the first.')));
  }
}

/* The whole picture in a sheet. Its box is reserved at 4:5 and takes the
   picture's own shape once it has loaded, so nothing is cropped. */
function openSheet(it) {
  app.sheet(it.title, (body) => {
    const box = el('div');
    box.dataset.k = it.k;   // the sheet's buttons reach their item through bindFeed
    const media = el('span', 'c-media ' + (it.ratio || 'r45'), art(it.media));
    const img = media.querySelector('img');
    if (img) {
      img.alt = it.title;
      img.loading = 'eager';
      img.addEventListener('load', () => {
        if (!img.naturalWidth) return;
        media.className = 'c-media';
        media.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
      });
    }
    box.appendChild(media);
    if (it.gallery) {
      const where = [it.spot, it.area].filter(Boolean).join(', ');
      box.appendChild(el('p', 'sheet-note', esc(['Photo by ' + (it.author || 'a neighbor'), where, it.ago].filter(Boolean).join(' · '))));
      if (it.text && it.text !== it.title) box.appendChild(el('p', 'c-text', esc(it.text)));
      box.appendChild(el('p', 'sheet-note', esc('From the community gallery, from before the wall had votes.')));
      const r = el('div', 'linkrow');
      r.appendChild(actBtn('share', ICON.share + ' Share', 'ghost'));
      box.appendChild(r);
    } else {
      box.appendChild(el('p', 'sheet-note', esc(['by ' + it.author, it.what + (it.medium ? ' · ' + it.medium : ''), it.ago].filter(Boolean).join(' · '))));
      if (it.text) box.appendChild(el('p', 'c-text', esc(it.text)));
      const r = el('div', 'linkrow');
      const up = voteBtn(it);
      up.dataset.act = 'artvote';
      r.appendChild(up);
      r.appendChild(actBtn('share', ICON.share + ' Share', 'ghost'));
      if (it.shirt) r.appendChild(shirtLink(it, 'btn ghost'));
      r.appendChild(it.mine ? actBtn('bdelete', ICON.trash + ' Delete', 'ghost') : actBtn('breport', ICON.flag + ' Report', 'ghost'));
      box.appendChild(r);
    }
    body.appendChild(box);
    app.bindFeed(body);
  });
}
function actBtn(act, label, cls) {
  const b = el('button', 'btn ' + (cls || ''), label);
  b.dataset.act = act;
  return b;
}

/* --------------------------------------------------------------- add yours */
function compose(kind) {
  const fields = [];
  if (kind === 'art') fields.push({ key: 'medium', label: 'Medium', type: 'text', max: 40, placeholder: 'Gouache, linocut, oil, ink…' });
  fields.push({ key: 'shirt', label: 'Could it go on a shirt?', type: 'enum', options: [['yes', 'Yes'], ['no', 'No']],
    hint: 'Say yes and neighbors can send it to make-a-tee on the Vintage tab.' });
  boards.compose({
    board: BOARD, kind, heading: kind === 'art' ? 'Add art' : 'Add a photo',
    title: 'Title', titlePlaceholder: kind === 'art' ? 'The breakwater light, in fog' : 'North Beach, 6:52 am',
    body: 'One line about it', bodyPlaceholder: kind === 'art' ? 'Where you made it, what with' : 'Where you stood, what you saw',
    fields, cta: 'Send it in',
    notes: ['Stephen approves every photo before it shows on the wall, usually within a day.'],
    onPosted: () => paintWaiting(),
  });
}

function paintAdd(host) {
  section(host, 'Add yours', esc('A photo you took or a piece you made, from around here.'));
  const tc = el('div', 'textcard');
  tc.innerHTML = '<p>' + esc('A title, one line, and the picture. Stephen approves every photo before it shows, usually within a day; then the town votes, and the week’s favorite leads this tab.') + '</p>';
  const row = el('div', 'row');
  row.append(button(ICON.plus + ' Add a photo', '', () => compose('photo')), button(ICON.plus + ' Add art', 'ghost', () => compose('art')));
  tc.appendChild(row);
  const wait = el('p', 'fine waiting');
  wait.hidden = true;
  tc.appendChild(wait);
  host.appendChild(tc);
  paintWaiting();
}

/* A reader who has just posted sees nothing new on the wall until the photo
   is approved; this line says so. */
function paintWaiting() {
  const n = root && root.querySelector('.waiting');
  if (!n) return;
  if (!app.user()) { n.hidden = true; return; }
  boards.mine().then((r) => {
    const w = r.ok ? r.posts.filter((p) => p.board === BOARD && p.photo_state === 'pending' && !p.ended).length : 0;
    n.hidden = !w;
    n.textContent = w ? plural(w, 'picture', 'pictures') + ' of yours ' + (w === 1 ? 'is' : 'are') + ' waiting for Stephen’s look.' : '';
  });
}

/* ------------------------------------------------------- community board */
function paintBoard(host) {
  section(host, 'Community board', esc('Calls for artists, shows, open studios, models and easels. Each notice comes down after ' + NOTICE_DAYS + ' days.'),
    button(ICON.plus + ' Post', 'ghost sm', () => boards.compose({
      board: BOARD, kind: 'notice', heading: 'Post a notice', title: 'What is it?', titlePlaceholder: 'Open studio Saturday, twelve artists',
      body: 'Details', bodyPlaceholder: 'When, what it costs, how to get in touch', place: 'Where', placePlaceholder: 'Soda Plant, Pine Street',
      notes: ['A notice stays up for ' + NOTICE_DAYS + ' days. Links are taken out; say how to reach you in words.'],
    })));
  if (!S.notices.length) {
    host.appendChild(el('p', 'note pad', esc('Nothing on the board right now. Post a call for artists, a show or an open studio.')));
    return;
  }
  const f = el('div', 'feed');
  boards.draw(f, S.notices, { tab: KEY, meta: () => '' });
  app.bindFeed(f);
  host.appendChild(f);
}

/* ---------------------------------------------------------------- winners */
function paintWinners(host) {
  const list = winners();
  S.winSig = list.map((w) => w.it.id).join(',');
  section(host, 'Winners', esc('The most-voted picture posted each week, Monday to Sunday. Just the honor.'));
  if (!list.length) {
    host.appendChild(el('p', 'note pad', esc('The first winner is the most-voted picture posted this week, named here on Monday.')));
    return;
  }
  const r = rail(host);
  list.forEach((w) => {
    const c = el('a', 'vcard w150');
    c.href = safeHref(w.it.href);
    c.dataset.win = w.it.k;
    c.setAttribute('aria-label', weekLabel(w.start) + ': ' + w.it.title + ', by ' + w.it.author);
    c.innerHTML = '<span class="c-media r11">' + art(w.it.media) + '</span><span class="t">' + esc(weekLabel(w.start)) + '</span><span class="s">' + esc(w.it.author + ' · ' + w.it.title) + '</span>';
    r.appendChild(c);
  });
  r.addEventListener('click', (e) => {
    const c = e.target.closest('[data-win]');
    const it = c && app.item(c.dataset.win);
    if (!it) return;
    e.preventDefault();
    openSheet(it);
  });
}

/* ------------------------------------------------------------------- bits */
const panel = () => (root ? root.closest('.panel') : null);
function jump(k) { if (slots && slots[k]) app.jumpTo(slots[k]); }

/* #art/week|wall|add|board|winners jumps to a section; #art/b-<id> flashes
   that post (a picture opens in its sheet, paging back for an older one);
   #art/g-<id> a gallery photo. */
async function land() {
  if (!pending || !ready) return;
  const k = pending; pending = null;
  if (SECTIONS.some(([s]) => s === k)) { jump(k); return; }
  const here = () => root.querySelector('[data-k="' + CSS.escape(k) + '"]');
  for (let i = 0; /^b-/.test(k) && !here() && S.more && i < MAX_PAGES; i++) {
    await page();
    paint('wall');
  }
  if (!here()) { app.toast('That picture has moved.'); return; }
  app.flashHit(root, k);
  const it = app.item(k);
  if (it && (it.pic || it.gallery)) openSheet(it);
}

app.register(KEY, {
  label: 'Art',
  icon: ICON.art,
  promise: 'Photos and art by people who live here, on one wall, voted on by the town.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Hanging the wall…</p>';
    (app.demo ? demoSeed() : Promise.resolve()).then(load).then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      app.recount();
      land();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>Art didn’t load.</b> Reload to try again.</div>'; });
  },
  activate(param) { pending = param || null; land(); },
  refresh() { if (ready) render(); },
  deactivate() {},
  subnav() {
    if (!ready) return null;
    return chips(SECTIONS.map(([key, label]) => ({ key, label })), null, (k) => jump(k));
  },
  /* posts made since the reader last looked */
  newSince(ts) { return (S.posts || []).filter((p) => Date.parse(p.created_at) / 1000 > ts).length; },
});

/* for the tests: Burlington's week, as this tab counts it */
export const _week = { weekStart, ofTheWeek: () => { const w = ofTheWeek(); return w && { id: w.it.id, fresh: w.fresh }; } };
