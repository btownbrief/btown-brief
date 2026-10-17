/* wire-photos.js — the Wire's Photo mode: every item that carries a picture,
   newest first, one full-width picture at a time (Stephen, 2026-10-17: "I
   really should try to become the new LOCAL INSTAGRAM").

   The News · Photos · Square switch at the top of the Wire turns it on
   (Stephen's girlfriend, 2026-10-17: the old list/photo icons "looked like
   the same information"); the choice is kept on the phone (localStorage
   `allday-wire-view`). #wire/photos opens it, and so do the old #art and
   #photos links; #wire/photos/<key> (and a shared #wire/b-…, #wire/g-…,
   #wire/ig:…) opens that picture's sheet.

   The feed opens under a header that says what it is, with the Post a photo
   button, and a row of chips by kind of picture (CATS): Instagram, vibe
   checks, event posters, food, pets, and only what readers posted here. An
   Instagram post's kind comes from its account (data/instagram-handles.json:
   the DO half is event posters, `food` and all-day/data/food-directory.json
   are food, `photo_categories` names the vibe and pet accounts); a reader's
   photo carries the kind they picked when they posted it (photo-wall.js
   PHOTO_CATS). Pets get their own row at the top of All when there are any.

   What it draws from, each picture once (by key, and by its link):
     - neighbors' photo and art posts on the `art` board (boards.js), with
       their board votes; the photo of the week (the most votes among those
       posted since Monday, Burlington time) leads the feed when there is one
     - the approved photos in the community gallery (the photo queue,
       ../js/photos-lib.js), as the Art wall had them
     - the local Instagram accounts' posts (data/instagram.json, built by
       scripts/build_instagram.py), while their signed picture still works
     - once the Square is live (nn-ROUND4.sql), its pet and show-and-tell
       posts that carry a photo
     - Facebook group posts (pulse.json's inbox) and Reddit posts (its items)
       that carry a picture
     - the Wire's own items with a lead image: today's paper, and the local
       outlets on the Unfiltered wire from the last week (not their podcast
       artwork)
   Local / Everything filters it as it filters the list; mutes hold.

   modes/wire.js owns the tab and calls in here through the ctx it hands to
   init(); this file never touches the paper's own state. The picture sheet
   and the submission sheet are photo-wall.js's. ?demo=1 seeds the art board's
   demo backend from data/demo/art.json (as the Art tab did) and adds that
   file's Instagram posts, all on the Wire demo's pinned clock. */

import * as app from '../app.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import * as store from '../store.js';
import * as wall from '../photo-wall.js';
import { RULES } from '../boards-core.js';
import { el, esc, safeHref, ICON, art, mark, cards, button } from '../ui.js';

const VIEW_KEY = 'allday-wire-view';
const BOARD = 'art';
const FIRST = 10;              // pictures on the first screenful
const CHUNK = 10;              // then ten at a time as the reader nears the bottom
const AHEAD = 1800;            // px below the screen where the next ten start drawing
const FAR = 4000;              // px off screen past which a card lets go of its picture
const NEWS_DAYS = 7;           // how far back the Unfiltered wire's pictures go
const DAY = 86400000;

/* --------------------------------------------------- the kept choice */
/* Which way the reader last read the Wire: 'photos', 'square', or '' for
   News (nothing kept). */
export function remembered() {
  try { const v = localStorage.getItem(VIEW_KEY); return v === 'photos' || v === 'square' ? v : ''; } catch (e) { return ''; }
}
export function remember(view) {
  try { if (view === 'photos' || view === 'square') localStorage.setItem(VIEW_KEY, view); else localStorage.removeItem(VIEW_KEY); } catch (e) { /* private mode: this visit only */ }
}

/* The chips, in order. `posted` is only what readers posted to this feed. */
export const CATS = [['all', 'All'], ['instagram', 'Instagram'], ['vibe', 'Vibe checks'], ['posters', 'Event posters'], ['food', 'Food'], ['pets', 'Pets'], ['posted', 'Posted here']];
const POSTED = new Set(['board', 'gallery', 'square']);

/* ------------------------------------------------------------- state */
let ctx = null;
const P = {
  pics: [],          // the art board's photo and art posts, as photo-wall items
  square: [],        // the Square's pet and show-and-tell photos, once it is live
  cat: 'all',        // the chip
  igCat: null,       // { food, vibe, pets, posters, notFood } Sets of handles
  counts: null,      // per chip, for this reader, before the chip
  gallery: [],       // the community gallery's approved photos
  ig: [],            // Instagram posts, raw
  loaded: null,      // the first load, once
  done: false,       // and it has settled
  boardSeq: 0,
  run: null,         // the feed being drawn
  list: null, lead: null, built: 0,
  pending: null,     // a key to open once the feed is drawn
};

/* ctx, from modes/wire.js:
     now()            the Wire's clock (pinned in the demo)
     clockReady()     resolves once that clock is set (the demo's payload is in)
     ago(ms)          "3h", on that clock
     today()          today's paper as cards, or []
     pulse()          { src, items, map, isLocal } once the Unfiltered wire is in, else null
     needPulse(fn)    fetch it, then fn()
     visible(v)       Local / Everything, follows and mutes, for a source id and a local flag
     green()          a local source shows green (the switch is on Everything)
     hydrate(host, keys)  the Wire's vote counts for those keys
     panel()          the tab's scroll container
     showing()        is Photo mode on screen
     redraw()         draw the mode again, where the reader was
     onMute(sid, it)  the Wire's mute
     squareOk()       is the Square board live (boards.roundFour)
     compose()        open Post a photo */
export function init(c) { ctx = c; }

/* ------------------------------------------------------------ loading */
const clockNow = () => (ctx ? ctx.now() : Date.now());

/* The art board's pictures, newest first: its posts never expire, so the
   list is paged (the RPC's cap at a time) to the end, up to MAX_PAGES. */
const MAX_PAGES = 10;
async function boardPosts() {
  const out = [];
  let before = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await boards.list(BOARD, { limit: RULES.limits.listMax, before });
    if (!r.ok) break;
    out.push(...r.posts);
    if (r.posts.length < RULES.limits.listMax) break;
    before = r.posts[r.posts.length - 1].created_at;
  }
  return out;
}
function loadBoard() {
  const seq = ++P.boardSeq;
  return boardPosts().then((posts) => {
    if (seq !== P.boardSeq) return;
    const seen = new Set();
    P.pics = posts.filter((p) => p && p.id && (p.kind === 'photo' || p.kind === 'art') && p.photo && !seen.has(p.id) && seen.add(p.id))
      .map((p) => {
        const it = wall.boardPic(p, { tab: 'wire/photos', ratio: ratios.get(p.id) || 'r45' });
        it.ago = ctx ? ctx.ago(it.created * 1000) : it.ago;
        return it;
      });
    app.know(P.pics);
  });
}

function loadInstagram() {
  if (app.demo) return Promise.resolve();
  return new Promise((res) => data.load('instagram', (j) => { P.ig = Array.isArray(j.posts) ? j.posts : []; res(); }, () => res()));
}
/* the posts alone, for the News list's Instagram chip */
export function instagram() {
  if (app.demo) return (ctx ? ctx.clockReady().then(demoSeed) : Promise.resolve()).then(() => demoIg);
  return loadInstagram().then(() => P.ig);
}

/* Which accounts are which kind of picture. The roster file is the
   newsletter repo's own (food.js reads it too); a miss leaves only the DO
   half as event posters and the reader photos' own kinds. */
const ROSTER_URL = '../data/instagram-handles.json';
const DIRECTORY_URL = './data/food-directory.json';
const handles = (a) => new Set((Array.isArray(a) ? a : []).map((h) => String(h || '').trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
function getJson(url) { return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null); }
function loadCats() {
  const roster = app.demo ? demoSeed().then((d) => (d && d.instagram_categories) || null) : getJson(ROSTER_URL);
  const dir = app.demo ? Promise.resolve(null) : getJson(DIRECTORY_URL);
  return Promise.all([roster, dir]).then(([r, d]) => {
    const tags = (r && (r.photo_categories || r)) || {};
    const food = handles(r && r.food);
    if (d && d.places && typeof d.places === 'object') Object.values(d.places).forEach((h) => { if (typeof h === 'string' && h) food.add(h.replace(/^@/, '').toLowerCase()); });
    if (app.demo) handles(tags.food).forEach((h) => food.add(h));
    P.igCat = { food, vibe: handles(tags.vibe), pets: handles(tags.pets), posters: handles(tags.posters),
      notFood: new Set(Object.keys((d && d.not_food) || {}).map((h) => h.toLowerCase())) };
  });
}

/* The Square's photos: pet posts and show and tell, newest first */
const SQUARE_KIND = { pets: 'Pet', show: 'Show and tell' };
function loadSquare() {
  if (!ctx || !ctx.squareOk()) { P.square = []; return Promise.resolve(); }
  return Promise.all(Object.keys(SQUARE_KIND).map((kind) => boards.list('square', { kind, limit: RULES.limits.listMax })))
    .then((rs) => {
      const seen = new Set();
      P.square = rs.flatMap((r) => (r.ok ? r.posts : [])).filter((p) => p && p.id && p.photo && !seen.has(p.id) && seen.add(p.id)).map((p) => {
        const it = boards.item(p, { tab: 'wire/photos', ratio: 'r45' });
        Object.assign(it, { pic: true, what: SQUARE_KIND[p.kind], medium: '', shirt: false, cat: p.kind === 'pets' ? 'pets' : '', square: true });
        it.ago = ctx.ago(it.created * 1000);
        return it;
      });
      app.know(P.square);
    });
}

export function ensure() {
  if (!P.loaded) {
    const seeded = app.demo ? ctx.clockReady().then(demoSeed) : Promise.resolve(null);
    P.loaded = seeded.then((d) => Promise.all([
      loadBoard(),
      (d ? Promise.resolve(demoGallery(d)) : wall.loadGallery('wire/photos')).then((g) => { P.gallery = g; app.know(g); }),
      loadInstagram(),
      loadCats().catch(() => {}),
      (ctx.squareReady ? ctx.squareReady() : Promise.resolve()).then(loadSquare).catch(() => {}),
    ])).catch(() => {}).then(() => { P.done = true; return true; });
  }
  return P.loaded;
}
export const loaded = () => P.done;

/* The board changed (a post, a delete, a report, a sign-in): read it again,
   and redraw if the reader is looking. The compose sheet is a sheet, so a
   redraw never eats a form. */
function reloadBoard() {
  if (!P.loaded) return;
  loadBoard().then(() => { if (ctx && ctx.showing()) ctx.redraw(); });
}
window.addEventListener('allday-boards', (e) => {
  const d = e.detail || {};
  if (d.what === 'profile') return;
  if (d.board === 'square') { if (P.loaded) loadSquare().then(() => { if (ctx && ctx.showing()) ctx.redraw(); }); return; }
  if (d.board && d.board !== BOARD) return;
  reloadBoard();
});
app.onAuth(() => setTimeout(reloadBoard));

/* ------------------------------------------------------------- the demo */
/* data/demo/art.json, seeded into the boards demo backend so the demo runs
   the real path (votes, reports and posting through boards.js), as the Art
   tab did. The foundation's own sample art posts make way; anything a reader
   posts stays. Times are on the Wire demo's pinned clock, so the photos sit
   among the paper's stories and this week's photo of the week is this
   week's there. */
const ratios = new Map();
let demoReady = null;
let demoIg = [];
function demoSeed() {
  if (!demoReady) demoReady = app.demoData('art').then((d) => { seed(d); return d; });
  return demoReady;
}
function seed(d) {
  const f = boards._fake();
  if (!f) return;
  const now = clockNow();
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
  const weeks = [wall.weekStart(now)];
  for (let i = 1; i <= 8; i++) weeks.push(wall.prevWeek(weeks[i - 1]));
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
      place: p.place || '', expires_at: at + RULES.boards.art.kinds.notice.days * DAY, created_at: at }, 0);
  });
  /* Instagram, in build_instagram.py's shape; the picture is a palette name */
  demoIg = (d.instagram || []).map((p) => ({ h: p.h, ts: Math.round((now - (p.hours || 1) * 3600000) / 1000), i: p.palette, u: p.u, c: p.c || '', s: p.s || 'see', ...(p.f ? { f: 1 } : {}) }));
}
function demoGallery(d) {
  const now = clockNow();
  return (d.gallery || []).map((g) => wall.galleryPic({ id: g.id, url: g.palette, caption: g.caption, credit: g.credit, spot: g.spot, area: g.area, category: g.category || 'other',
    approved_on: new Date(now - (g.days || 0) * DAY).toISOString().slice(0, 10) }, 'wire/photos'));
}

/* ------------------------------------------------------- the pictures */
const isUrl = (u) => /^https?:\/\//i.test(String(u || ''));
/* a picture's link, compared without its scheme, www, trailing slash or
   tracking, so one story from two places shows once */
function norm(u) {
  try {
    const x = new URL(u);
    [...x.searchParams.keys()].forEach((k) => { if (/^(utm_|fbclid$|gclid$|ref$)/i.test(k)) x.searchParams.delete(k); });
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (x.searchParams.toString() ? '?' + x.searchParams : '')).toLowerCase();
  } catch (e) { return String(u || ''); }
}
const oneLine = (s) => String(s || '').split(/\n/).map((x) => x.trim()).find(Boolean) || '';
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/* a short caption for a sheet's title: the first line, cut at a word */
function short(s, max = 90) {
  const t = oneLine(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,.;:–—-]+$/, '') + '…';
}

/* An Instagram picture is signed for about four days (its `oe`, hex epoch);
   a lapsed one would only draw a hole, so it is left out. */
function igLapsed(u) {
  const m = String(u || '').match(/[?&]oe=([0-9a-f]{8})(?:&|$)/i);
  return !!m && parseInt(m[1], 16) * 1000 < Date.now();
}
const IG_CODE = /instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/i;
const igKeys = new Map();   // one item per key, so a redraw keeps the registry's object
function igView(p) {
  if (!p || !p.h || !p.u || !p.i || !isUrl(p.u)) return null;
  if (!app.demo && (!isUrl(p.i) || igLapsed(p.i))) return null;
  const code = (String(p.u).match(IG_CODE) || [])[1];
  const k = 'ig:' + (code || p.u);
  const cap = String(p.c || '').trim();
  const handle = '@' + String(p.h).replace(/^@/, '');
  let it = igKeys.get(k);
  if (!it) {
    it = { k, kind: 'image', href: p.u, media: p.i, ratio: 'r45', title: short(cap) || handle, text: squash(cap),
      src: handle, sid: 'ig:' + p.h, local: true, d: Number(p.ts) || 0, open: 'Open on Instagram' };
    igKeys.set(k, it);
    app.know([it]);
  }
  it.ago = it.d ? ctx.ago(it.d * 1000) : '';
  return { it, k, from: 'instagram', media: it.media, ratio: 'r45', cap: oneLine(cap) || handle, alt: squash(cap).slice(0, 250) || 'Instagram photo from ' + handle,
    src: handle, sid: it.sid, local: true, d: it.d, url: p.u, cats: igCats(p) };
}
/* The posts as the News list's Instagram chip draws them: newest first,
   each with its picture still working, the same registered item the photo
   feed uses (so a save or a vote is one thing). */
export function igList(posts) {
  return (posts || []).map(igView).filter(Boolean).sort((a, b) => (b.d - a.d) || (a.k < b.k ? -1 : 1));
}
/* an Instagram post's kinds, from its account */
export function igCats(p) {
  const h = String(p.h || '').replace(/^@/, '').toLowerCase();
  const C = P.igCat;
  const out = new Set(['instagram']);
  if (p.s === 'do' || (C && C.posters.has(h))) out.add('posters');
  if (C && C.vibe.has(h)) out.add('vibe');
  if (C && C.pets.has(h)) out.add('pets');
  if ((p.f || (C && C.food.has(h))) && !(C && C.notFood.has(h))) out.add('food');
  return out;
}

/* a neighbor's post or a gallery photo */
function picView(it) {
  const cats = new Set(['posted']);
  if (it.cat && it.cat !== 'other') cats.add(it.cat);
  return { it, k: it.k, from: it.square ? 'square' : it.pic ? 'board' : 'gallery', media: it.media, ratio: 'r45', cap: oneLine(it.title), alt: squash([it.title, it.text].filter(Boolean).join('. ')).slice(0, 250),
    src: it.author || 'A neighbor', sid: '', local: it.local !== false, d: Number(it.created) || 0, pic: !!it.pic, url: '', cats };
}

/* a story, a post or a thread with a lead image; the card's own key, so
   saves and votes are the list's */
function storyView(c, media, from, d) {
  if (!c || !c.k || !c.href || !media) return null;
  const cap = oneLine(c.title || c.text);
  return { it: c, k: c.k, from, media, ratio: 'r11', cap, alt: squash(c.title || c.text).slice(0, 250), src: c.src || '', sid: c.sid || '', local: !!c.local,
    d: Number(d != null ? d : c.d) || 0, url: c.href, open: c.open || (/instagram\.com/.test(c.href) ? 'Open on Instagram' : 'Open the story') };
}

/* pulse.json's inbox: Muse's Facebook group posts (and X), when one carries a picture */
const inboxKeys = new Map();
function inboxViews(j) {
  const out = [];
  const box = j && j.inbox && typeof j.inbox === 'object' ? j.inbox : {};
  Object.keys(box).forEach((ch) => {
    const items = box[ch] && Array.isArray(box[ch].items) ? box[ch].items : [];
    items.forEach((x) => {
      const pic = x && (x.i || x.image);
      if (!x || !x.u || !isUrl(x.u) || !pic || (!app.demo && !isUrl(pic))) return;
      let it = inboxKeys.get(x.u);
      if (!it) {
        it = { k: x.u, kind: 'post', href: x.u, title: '', text: squash(x.summary), src: x.name || x.from || '', sid: 'inbox:' + (x.from || x.name || ch),
          local: !!x.local, ch, d: Number(x.d) || 0, open: ch === 'x' ? 'Open on X' : 'Open the post' };
        inboxKeys.set(x.u, it);
        app.know([it]);
      }
      it.ago = it.d ? ctx.ago(it.d * 1000) : '';
      const v = storyView({ ...it, title: it.text }, pic, ch, it.d);
      if (v) { v.it = it; v.open = it.open; out.push(v); }
    });
  });
  return out;
}

/* Everything that carries a picture, newest first, each once, filtered for
   this reader. Returns { list, lead }. */
export function build() {
  const now = clockNow();
  const all = [];
  P.pics.forEach((it) => all.push(picView(it)));
  P.square.forEach((it) => all.push(picView(it)));
  P.gallery.forEach((it) => { it.ago = it.created ? ctx.ago(it.created * 1000) : it.ago; all.push(picView(it)); });
  (app.demo ? demoIg : P.ig).forEach((p) => all.push(igView(p)));
  /* today's paper: stories with a lead image, and posts that carry one; a
     video is a player, not a picture */
  ctx.today().forEach((c) => {
    if (c.kind !== 'video' && (c.thumb || c.media)) all.push(storyView(c, c.thumb || c.media, c.ch === 'facebook' || c.ch === 'reddit' ? c.ch : 'paper'));
  });
  /* the Unfiltered wire: Facebook and Reddit posts with a picture, and the
     local outlets' pictures from the last week, never a podcast's artwork */
  const P2 = ctx.pulse();
  if (P2 && P2.src) {
    inboxViews(P2.src).forEach((v) => all.push(v));
    const raw = new Map();
    (P2.src.items || []).forEach((x) => { if (x && x.u) raw.set(x.u, x); });
    const from = now / 1000 - NEWS_DAYS * 86400;
    P2.items.forEach((c) => {
      const x = raw.get(c.href);
      if (!x || !c.thumb || x.du || x.dn || c.d < from) return;
      if (!(c.local || x.ch === 'reddit')) return;
      all.push(storyView(c, c.thumb, x.ch === 'reddit' ? 'reddit' : 'outlet'));
    });
  }
  /* a picture that stands for more than one story is a show's artwork or an
     outlet's logo (a radio show's every episode, a podcast's), not a photo */
  const used = new Map();
  const tally = (pic, link) => { if (!isUrl(pic) || !link) return; const k = norm(pic); if (!used.has(k)) used.set(k, new Set()); used.get(k).add(norm(link)); };
  if (P2 && P2.src) (P2.src.items || []).forEach((x) => { if (x) tally(x.i, x.u); });
  const own = (v) => v.from === 'instagram' || POSTED.has(v.from);
  all.forEach((v) => { if (v && !own(v)) tally(v.media, v.url); });
  const stock = (v) => !own(v) && isUrl(v.media) && (used.get(norm(v.media)) || new Set()).size > 1;
  /* each picture once: by key, then by its link */
  const keys = new Set(), links = new Set();
  const every = [];
  all.forEach((v) => {
    if (!v || !v.k || !v.media || keys.has(v.k) || stock(v) || !ctx.visible(v)) return;
    const u = v.url ? norm(v.url) : '';
    if (u && links.has(u)) return;
    keys.add(v.k);
    if (u) links.add(u);
    if (!v.cats) v.cats = new Set();
    v.ago = v.it.ago || (v.d ? ctx.ago(v.d * 1000) : '');
    every.push(v);
  });
  every.sort((a, b) => (b.d - a.d) || (a.k < b.k ? -1 : 1));
  /* the chips count what this reader sees; a chip with nothing hides */
  const counts = { all: every.length };
  every.forEach((v) => v.cats.forEach((c) => { counts[c] = (counts[c] || 0) + 1; }));
  P.counts = counts;
  if (P.cat !== 'all' && !counts[P.cat]) P.cat = 'all';
  const list = P.cat === 'all' ? every : every.filter((v) => v.cats.has(P.cat));
  /* the photo of the week leads All, when this week has one */
  const w = P.cat === 'all' || P.cat === 'posted' ? wall.ofTheWeek(P.pics, now) : null;
  let lead = null;
  if (w && w.fresh) {
    const i = list.findIndex((v) => v.k === w.it.k);
    if (i >= 0) { lead = list[i]; list.splice(i, 1); list.unshift(lead); }
  }
  P.list = list; P.lead = lead; P.built++;
  P.pets = every.filter((v) => v.cats.has('pets'));
  return { list, lead };
}
export const count = () => (P.list ? P.list.length : null);
/* the chips, for the subnav: [key, label, count], the empty ones left out */
export function catChips() {
  if (!P.counts) build();
  return CATS.filter(([k]) => k === 'all' || P.counts[k]).map(([key, label]) => ({ key, label, n: key === 'all' ? null : P.counts[key] }));
}
export const cat = () => P.cat;
export function setCat(k) { P.cat = CATS.some(([x]) => x === k) ? k : 'all'; }

/* ------------------------------------------------------------- votes */
/* A neighbor's picture is voted on its board (one vote per reader, counted
   by the server); the arrow fills at once and the count settles on the
   server's. Every other picture takes the Wire's own vote. */
function paintVotes(it) {
  document.querySelectorAll('[data-vk="' + CSS.escape(it.k) + '"]').forEach((n) => {
    if (n.tagName !== 'BUTTON') return;
    if (n.classList.contains('btn')) {
      n.classList.toggle('ghost', !it.voted);
      const l = n.querySelector('.vl');
      if (l) l.textContent = it.voted ? 'Voted' : 'Vote';
    } else n.classList.toggle('on', !!it.voted);
    n.setAttribute('aria-pressed', it.voted ? 'true' : 'false');
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
  (it.voted ? boards.vote : boards.unvote)(it.id).then((r) => {
    if (r.ok) { it.votes = r.votes; it.voted = r.voted; } else { Object.assign(it, was); app.toast(r.message); }
    paintVotes(it);
  });
}
app.onAct('photovote', (it) => vote(it));

/* ------------------------------------------------------------- drawing */
/* One picture: full width, its box reserved (4:5 for a neighbor's or an
   Instagram post, square for a story's lead image), then one line of
   caption, then the source and age with vote, share and save. */
function card(v, lead) {
  const it = v.it;
  const c = el('article', 'card fi pm' + (lead ? ' pm-lead' : '') + (v.from === 'instagram' ? ' w-src-instagram' : POSTED.has(v.from) ? ' w-posted' : '') + (store.isRead(it.k) ? ' is-read' : ''));
  c.dataset.k = it.k;
  const pic = isUrl(v.media)
    ? '<img class="pic" src="' + esc(v.media) + '" alt="' + esc(v.alt || v.cap) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
    : art(v.media);
  const href = esc(safeHref(it.href));
  let up;
  if (v.pic) {
    up = '<button class="mini up' + (it.voted ? ' on' : '') + '" data-act="photovote" data-vk="' + esc(it.k) + '" aria-label="Vote" aria-pressed="' + !!it.voted + '">' +
      ICON.up + '<span class="vn">' + esc(it.votes || '') + '</span></button>';
  } else {
    const on = store.hasVoted(it.k);
    const n = (Number(it.votes) || 0) + store.voteCount(it.k);
    up = '<button class="mini up' + (on ? ' on' : '') + '" data-act="up" aria-label="Upvote" aria-pressed="' + on + '">' + ICON.up + '<span class="n">' + esc(n || '') + '</span></button>';
  }
  const saved = store.isSaved(it.k);
  c.innerHTML = '<a class="pm-pic ' + esc(v.ratio) + '" href="' + href + '" data-pm' + (isUrl(v.media) ? '' : ' aria-label="' + esc(v.alt || v.cap) + '"') + '>' + pic + '</a>' +
    '<div class="pm-body">' + (lead ? '<span class="eyebrow">Photo of the week</span>' : '') +
    '<a class="pm-cap" href="' + href + '" data-pm>' + esc(v.cap) + '</a>' +
    '<div class="c-foot">' + mark(v.src, 'xs') + '<span class="c-src' + (v.local && ctx.green() ? ' is-local' : '') + '">' + esc(v.src) + '</span>' +
    (v.ago ? '<span class="dot"></span><span class="age">' + esc(v.ago) + '</span>' : '') + '<span class="sp"></span>' + up +
    '<button class="mini sh" data-act="share" aria-label="Share">' + ICON.share + '</button>' +
    '<button class="act star' + (saved ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + saved + '">' + ICON.star + '</button></div></div>';
  return c;
}

/* the item the picture sheet reads: the registered one, with the picture,
   its caption and its age as this feed shows them */
function sheetItem(v) {
  const it = v.it;
  if (it.pic || it.gallery) return it;
  return { ...it, media: v.media, ratio: v.ratio, title: short(it.title || it.text) || v.cap, text: squash(it.text || it.title), alt: v.alt, src: v.src, ago: v.ago, open: v.open || it.open };
}
export function openPicture(k) {
  const v = (P.list && P.list.find((x) => x.k === k)) || (P.pets && P.pets.find((x) => x.k === k));
  if (!v) return false;
  wall.openSheet(sheetItem(v));
  return true;
}

let observer = null;
export function stop() {
  if (observer) { observer.disconnect(); observer = null; }
  if (P.run && P.run.far) P.run.far.disconnect();
  if (P.run) P.run.dead = true;
  P.run = null;
}

const near = (run) => {
  const panel = ctx.panel();
  if (!panel || !run.sentinel.isConnected || !ctx.showing()) return false;
  return run.sentinel.getBoundingClientRect().top - panel.getBoundingClientRect().bottom < AHEAD;
};

/* Draw into root: the empty state, or the feed in chunks of ten as the
   reader nears the bottom. `until` draws on until that key is on the page. */
/* The header: what this is, in one line, and the way to post to it
   (Stephen's girlfriend, 2026-10-17: "I don't even know that this is like,
   add photo to the feed"). */
function header() {
  const h = el('div', 'pm-head');
  h.innerHTML = '<h2>Burlington in photos</h2><p>' + esc('Local Instagram plus photos people post here.') + '</p>';
  const b = button(ICON.plus + ' Post a photo to the Burlington feed', 'pm-post', () => wall.compose('photo'));
  b.dataset.post = 'photo';
  h.appendChild(b);
  return h;
}
/* Pets of Burlington: a row of every pet picture, at the top of All */
function petsRow(pets) {
  const box = el('section', 'pm-pets');
  box.setAttribute('aria-label', 'Pets of Burlington');
  box.innerHTML = '<div class="pm-pets-h"><h3>Pets of Burlington</h3><button class="chip" data-pets>' + esc('See all ' + pets.length) + '</button></div>';
  const row = el('div', 'pm-pets-row');
  pets.slice(0, 12).forEach((v) => {
    const a = el('a', 'pm-pet');
    a.href = safeHref(v.it.href);
    a.dataset.pet = v.k;
    a.innerHTML = (isUrl(v.media) ? '<img class="pic" src="' + esc(v.media) + '" alt="' + esc(v.alt || v.cap) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : art(v.media)) +
      '<span class="pm-pet-cap">' + esc(v.cap) + '</span>';
    row.appendChild(a);
  });
  box.appendChild(row);
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-pets]')) { e.preventDefault(); P.cat = 'pets'; if (ctx) ctx.pickCat('pets'); return; }
    const a = e.target.closest('[data-pet]');
    if (!a) return;
    e.preventDefault();
    openPicture(a.dataset.pet);
  });
  return box;
}

export function render(root, opts = {}) {
  stop();
  const { list, lead } = build();
  root.innerHTML = '';
  root.appendChild(header());
  if (!list.length) {
    const e = el('div', 'caught pm-empty');
    e.innerHTML = '<h3>' + esc(P.cat === 'pets' ? 'No pets yet.' : 'No photos yet.') + '</h3>';
    root.appendChild(e);
    return null;
  }
  if (P.cat === 'all' && P.pets && P.pets.length) root.appendChild(petsRow(P.pets));
  const feed = el('div', 'feed pm-feed');
  root.appendChild(feed);
  /* draw on to a deep link's picture only when it is there to reach */
  const until = opts.until && list.some((v) => v.k === opts.until) ? opts.until : null;
  const run = { dead: false, i: 0, list, lead, feed, until, sentinel: el('div', 'loading') };
  run.sentinel.setAttribute('aria-hidden', 'true');
  feed.appendChild(run.sentinel);
  P.run = run;
  app.bindFeed(feed, { onSource() {}, onMute: (sid, it) => { if (sid && !it.pic && !it.gallery) ctx.onMute(sid, it); } });
  /* a tap on the picture or its caption opens the picture sheet; one
     listener for the feed, as the shell's own */
  feed.addEventListener('click', (e) => {
    const a = e.target.closest('[data-pm]');
    const c = a && a.closest('[data-k]');
    if (!c) return;
    e.preventDefault();
    openPicture(c.dataset.k);
  });
  const panel = ctx.panel();
  if ('IntersectionObserver' in window && panel) {
    observer = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) step(run, CHUNK); },
      { root: panel, rootMargin: '0px 0px ' + AHEAD + 'px 0px' });
    observer.observe(run.sentinel);
    /* A long feed holds hundreds of pictures. A card far from the screen
       lets go of its picture (its box keeps its size, so nothing moves) and
       takes it back on the way in, so memory follows the screen, not the
       length of the scroll. */
    run.far = new IntersectionObserver((es) => es.forEach((x) => {
      const img = x.target.querySelector('img.pic');
      if (!img) return;
      if (x.isIntersecting) { if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; } }
      else if (!img.dataset.src && img.getAttribute('src')) { img.dataset.src = img.getAttribute('src'); img.removeAttribute('src'); }
    }), { root: panel, rootMargin: FAR + 'px 0px' });
  }
  step(run, Math.max(FIRST, opts.limit || 0));
  return run;
}

function step(run, n) {
  if (run.dead || P.run !== run) return;
  const added = [];
  while (run.i < run.list.length && (n-- > 0 || run.until)) {
    const v = run.list[run.i++];
    const node = card(v, v === run.lead);
    if (run.i === 1) node.querySelector('img.pic')?.setAttribute('loading', 'eager');   // the first picture is the page
    run.feed.insertBefore(node, run.sentinel);
    if (run.far) run.far.observe(node);
    if (!v.pic) added.push(v.k);
    if (v.k === run.until) run.until = null;
  }
  if (added.length) ctx.hydrate(run.feed, added);
  if (run.i >= run.list.length) {
    run.sentinel.remove();
    if (observer) { observer.disconnect(); observer = null; }
    const end = cards.caught({ title: P.cat === 'all' ? 'That’s every photo' : 'That’s every one', check: false, buttons: [addBtn('photo', ''), addBtn('art', 'ghost')] });
    run.feed.appendChild(end);
    return;
  }
  requestAnimationFrame(() => { if (!run.dead && near(run)) step(run, CHUNK); });
}
/* a scroll nudge, for a browser without IntersectionObserver */
export function topUp() { const run = P.run; if (run && !run.dead && near(run)) step(run, CHUNK); }

export function addBtn(kind, cls) {
  return button(ICON.plus + ' ' + (kind === 'art' ? 'Add art' : 'Post a photo'), cls, () => wall.compose(kind));
}

/* How far down the reader is, for a redraw that keeps the place. */
export const drawn = () => (P.run ? P.run.i : 0);

/* A broken picture takes its whole card with it: a photo feed with a grey
   hole, or a caption with no picture, is worse than one card fewer. This
   runs before the shell's own handler (window capture comes first). */
window.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.classList || !img.classList.contains('pic')) return;
  const c = img.closest('.card.pm, .pm-pet');
  if (c) c.remove();
}, true);

/* for the tests: the feed as last built, each picture's key, time, place and
   where it came from */
export const _state = () => ({ lead: P.lead ? P.lead.k : null, cat: P.cat, counts: P.counts,
  pets: (P.pets || []).map((v) => v.k),
  list: (P.list || []).map((v) => ({ k: v.k, d: v.d, local: !!v.local, from: v.from, url: v.url || '', cats: [...(v.cats || [])] })) });
