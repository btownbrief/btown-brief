/* photo-wall.js — the community photo wall's drawing helpers, kept when the
   Art tab was folded (2026-10-17).

   Stephen wants All Day to become the new local Instagram: community photos
   are not going away, they move into the Wire as a Photo mode in a later
   build. The Art tab's slot went to Habits, but everything its wall stood
   on stays: the photo queue (../js/photos-lib.js, btb_photos), the `art`
   board with its photo, art and notice kinds and their votes (boards-core.js,
   nn_rules), the demo's art posts (data/demo/art.json, boards-fake.js), and
   the votes counted by week (nn_votes_by_week) that pick a photo of the
   week. This module is the Art tab's wall code with the tab taken out, so
   the Photo mode can start from it. NOTHING IMPORTS IT YET; the Photo mode
   build wires it up (and adds it to sw.js's offline list then).

   What is here, all as the Art tab had them:
     weekStart(ms), prevWeek(start), weekLabel(start)
                                 Burlington weeks, Monday 00:00 New York
     rank(a, b)                  most votes first, a tie to the one posted first
     ofTheWeek(pics, now)        { it, fresh } the photo of the week, else the newest
     winners(pics, weekly, now, weeks)
                                 past weeks' winners, by the votes cast that week
     boardPic(post, opts)        a board post as a wall item (boards.item, plus pic,
                                 shirt, medium, what)
     galleryPic(photo, tab)      a gallery photo as a wall item, labelled by its
                                 caption, else its spot, area, when it was taken,
                                 else the day it was approved
     loadGallery(tab)            the approved gallery photos that belong on the wall
     drawWall(host, list, onOpen)  the three-column grid, two tall tiles in ten
     openSheet(it, onVote)       the whole picture in a sheet, with vote, share,
                                 shirt and report or delete */

import * as app from './app.js';
import * as boards from './boards.js';
import { isoWeek } from './boards-core.js';
import { el, esc, safeHref, ICON, art, agoShort } from './ui.js';

const PHOTOS_LIB = '../js/photos-lib.js';
const KIND_WORD = { photo: 'Photo', art: 'Art' };

/* --------------------------------------------------- Burlington's clock */
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
export function weekStart(ms) { const o = et(ms); return midnight(+o.year, +o.month, +o.day - DOW[o.weekday]); }
export const prevWeek = (start) => weekStart(start - 3600000);
const WEEKF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
export const weekLabel = (start) => 'Week of ' + WEEKF.format(new Date(start + 12 * 3600000));

/* ------------------------------------------------------------ the picks */
const createdMs = (it) => it.created * 1000;
export const rank = (a, b) => (b.votes - a.votes) || (a.created - b.created);

export function ofTheWeek(pics, now = Date.now()) {
  const from = weekStart(now);
  const week = pics.filter((it) => createdMs(it) >= from).sort(rank);
  if (week.length) return { it: week[0], fresh: true };
  const newest = pics.slice().sort((a, b) => b.created - a.created)[0];
  return newest ? { it: newest, fresh: false } : null;
}

/* weekly: { 'ISO week': { post id: votes cast that week } } from
   boards.votesByWeek, or null before nn-ROUND2.sql (then a past week is
   ranked by its pictures' counts so far) */
export function winners(pics, weekly, now = Date.now(), weeks = 8) {
  const out = [];
  let end = weekStart(now);
  for (let i = 0; i < weeks; i++) {
    const start = prevWeek(end);
    const cast = weekly && (weekly[isoWeek(start + 12 * 3600000)] || {});
    const score = (it) => (cast ? cast[it.id] || 0 : it.votes);
    const best = pics.filter((it) => createdMs(it) >= start && createdMs(it) < end)
      .sort((a, b) => (score(b) - score(a)) || (a.created - b.created))[0];
    if (best) out.push({ start, it: best });
    end = start;
  }
  return out;
}

/* ------------------------------------------------------------ the items */
const metaLine = (p) => [KIND_WORD[p.kind] || '', p.meta && p.meta.medium].filter(Boolean).join(' · ');
export function boardPic(post, opts = {}) {
  const it = boards.item(post, { tab: opts.tab || 'wire', ratio: opts.ratio || 'r45', meta: metaLine });
  it.pic = true;
  it.shirt = !!(post.meta && post.meta.shirt === 'yes');
  it.medium = (post.meta && post.meta.medium) || '';
  it.what = KIND_WORD[post.kind];
  return it;
}

export function galleryPic(g, tab = 'wire') {
  const when = Date.parse(g.approved_on ? g.approved_on + 'T12:00:00Z' : '') || 0;
  const area = g.area && g.area !== 'Elsewhere' ? g.area : '';
  const day = when ? new Date(when).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  return { k: 'g-' + g.id, kind: 'image', gallery: true, href: '#' + tab + '/g-' + g.id,
    title: g.caption || g.spot || area || g.taken_on || day || 'A photo from the gallery',
    text: g.caption || '', author: g.credit || '', spot: g.spot || '', area,
    media: g.url, ratio: 'r45', created: when / 1000, ago: when ? agoShort(when / 1000) : '' };
}

let lib = null;
function photosLib() {
  if (window.BTBP) return Promise.resolve(window.BTBP);
  if (!lib) {
    lib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PHOTOS_LIB;
      s.onload = () => (window.BTBP ? resolve(window.BTBP) : reject(new Error('no BTBP')));
      s.onerror = () => { lib = null; reject(new Error('could not load ' + PHOTOS_LIB)); };
      document.head.appendChild(s);
    });
  }
  return lib;
}
/* Every approved reader photo that belongs on the wall: photos filed from a
   board ("All Day · …") are left out, because their posts are on the wall
   already, and so are Food's dishes, which belong to the Weekly Bite. */
export function loadGallery(tab = 'wire') {
  return photosLib().then((P) => P.getApproved()).then((r) => (r.photos || []))
    .catch(() => [])
    .then((photos) => photos.filter((g) => g && g.id && g.url && !/^All Day ·/.test(g.spot || '') && g.category !== 'dish' && g.category !== 'board')
      .map((g) => galleryPic(g, tab)));
}

/* ------------------------------------------------------------- the wall */
/* Two tall tiles in every ten, placed so the grid never leaves a hole: the
   first of a block spans rows one and two on the left, the eighth spans
   rows three and four on the right. A block too short to fill around a
   tall tile gets square ones. */
export function tall(i, n) {
  const pos = i % 10, left = n - (i - pos);
  return (pos === 0 && left >= 5) || (pos === 7 && left >= 10);
}

export function drawWall(host, list, onOpen) {
  app.know(list);
  const g = el('div', 'grid3');
  list.forEach((it, i) => {
    const t = el('a', 'tile' + (tall(i, list.length) ? ' tall' : ''));
    t.href = safeHref(it.href);
    t.dataset.k = it.k;
    t.setAttribute('aria-label', it.title + (it.author ? ', by ' + it.author : '') + (it.gallery ? ', from the gallery' : ', ' + it.votes + (it.votes === 1 ? ' vote' : ' votes')));
    t.innerHTML = art(it.media) + (it.gallery ? '<span class="lbl"><span class="t">' + esc(it.title) + '</span></span>'
      : '<span class="ct" data-vk="' + esc(it.k) + '">' + ICON.up + '<span class="vn">' + esc(it.votes || '') + '</span></span>');
    g.appendChild(t);
  });
  /* one listener for the grid; a tile is a link, so it also works as one */
  g.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    const it = t && app.item(t.dataset.k);
    if (!it) return;
    e.preventDefault();
    (onOpen || openSheet)(it);
  });
  host.appendChild(g);
  return g;
}

/* ------------------------------------------------------------ the sheet */
function actBtn(act, label, cls) {
  const b = el('button', 'btn ' + (cls || ''), label);
  b.dataset.act = act;
  return b;
}
export function voteBtn(it) {
  const b = el('button', 'btn' + (it.voted ? '' : ' ghost'), ICON.up + '<span class="vl">' + (it.voted ? 'Voted' : 'Vote') + '</span><span class="vn">' + esc(it.votes || '') + '</span>');
  b.dataset.vk = it.k;
  b.setAttribute('aria-pressed', it.voted ? 'true' : 'false');
  return b;
}
export function shirtLink(it, cls) {
  const a = el('a', cls, ICON.tee + ' Put it on a shirt');
  a.href = '#vintage/' + encodeURIComponent(it.k);
  a.dataset.shirt = it.k;
  return a;
}

/* The whole picture in a sheet. Its box is reserved at 4:5 and takes the
   picture's own shape once it has loaded, so nothing is cropped. The vote
   button carries data-act="photovote": the caller registers it with
   app.onAct('photovote', …) when it wires the wall up. */
export function openSheet(it) {
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
    const r = el('div', 'linkrow');
    if (it.gallery) {
      const where = [it.spot, it.area].filter(Boolean).join(', ');
      box.appendChild(el('p', 'sheet-note', esc(['Photo by ' + (it.author || 'a neighbor'), where, it.ago].filter(Boolean).join(' · '))));
      if (it.text && it.text !== it.title) box.appendChild(el('p', 'c-text', esc(it.text)));
      r.appendChild(actBtn('share', ICON.share + ' Share', 'ghost'));
    } else {
      box.appendChild(el('p', 'sheet-note', esc(['by ' + it.author, it.what + (it.medium ? ' · ' + it.medium : ''), it.ago].filter(Boolean).join(' · '))));
      if (it.text) box.appendChild(el('p', 'c-text', esc(it.text)));
      const up = voteBtn(it);
      up.dataset.act = 'photovote';
      r.appendChild(up);
      r.appendChild(actBtn('share', ICON.share + ' Share', 'ghost'));
      if (it.shirt) r.appendChild(shirtLink(it, 'btn ghost'));
      r.appendChild(it.mine ? actBtn('bdelete', ICON.trash + ' Delete', 'ghost') : actBtn('breport', ICON.flag + ' Report', 'ghost'));
    }
    box.appendChild(r);
    body.appendChild(box);
    app.bindFeed(body);
  });
}
