/* explore.js — a tab's other layout, its Explore wall (Stephen, 2026-11-01:
   the grid cell at the right end of the top pill; "videos do not autoplay",
   so every tile carries words under its picture).

   The cell chooses the layout and nothing else. A word or a section leaves
   the wall and goes there; Local, National and Everything keep working on it.
   Wire and Vintage have one. Watch, On Air, Food and Social come later, and
   Town and Body have none.

   What is here:
     kept(tab)            is this tab's wall the one this phone opens on
     flip(tab, on)        the cell, tapped: remembered, for now
     visit(tab)           a word or a link left the wall
     settle()             the sitting is over: what was flipped stays flipped
     caption(post)        the line under an Instagram picture
     seen(), sink(list, seen)
                          the tiles this phone had shown when this sitting
                          began, and a list with them at the bottom
     noTwins, wordsFirst, apart
                          what the walls share about the order of their tiles
     storyView(c, why)    a Wire card as a tile; weakStory(c), one to leave out
     grid(host, views, o) two columns of tiles, drawn in chunks
     waiting(host)        the same two columns, empty, while a file is on its way

   Memory is per tab, per phone, in the settings ({ wire: true }), and off for
   everyone until someone taps. Word taps and deep links are visits and never
   write it, so a reader who opens a wall every day can still step into News.
   A flip counts only once the sitting is over: tap the cell, leave by a word,
   and it is undone, so a look never leaves a wall waiting the next day.
   `tentative` is that one in-memory set, cleared on a tab change or when the
   app goes away.

   A view is what a tile draws:
     k, it       the key, and the item the shell knows it by
     media       a picture, or nothing for a coloured headline tile
     line, src   the words under it, and the source in small dim type
     poster      a picture full of type: it keeps its own shape, not the stagger
     tint        a headline tile's colour: reddit, facebook, x, newsletters, news
     vu, ve      a reel's video link and when it lapses
     url         the original
     sheet       what the sheet shows, when that isn't `it`
     open()      opens it some other way (a fit check's own card) */

import * as app from './app.js';
import * as store from './store.js';
import * as wall from './photo-wall.js';
import { el, esc, art, ICON, safeHref } from './ui.js';

const FIRST = 16;          // tiles on the first screenfuls
const CHUNK = 12;          // then twelve at a time as the reader nears the bottom
const AHEAD = 1800;        // px below the screen where the next ones start drawing
const STAGGER = ['r45', 'r11', 'r34'];   // the two columns' uneven heights, in turn
const PER_LINE = 6.6;      // px of column to a character of caption, roughly
const LINES = 2.7;         // three lines, less what wrapping loses
const HEAD_SHARE = 0.8;    // a headline's share of that: five lines of its larger type
const SEEN_FLUSH = 1500;   // ms between writes of the seen list
const SET_SECONDS = 300;   // one account's posts this close together are one set
const OWN_SHAPE = [3 / 4, 4 / 3];   // height over width: a picture of type shows its own shape from 4:3 to 3:4, no bars

/* --------------------------------------------------------------- memory */
const tentative = new Set();
export const kept = (tab) => !!(store.settings().explore || {})[tab];
function keep(tab, on) { store.setSetting('explore', { ...(store.settings().explore || {}), [tab]: on }); }
export function flip(tab, on) {
  if (kept(tab) === on) return;
  keep(tab, on);
  if (!tentative.delete(tab)) tentative.add(tab);
}
export function visit(tab) {
  if (kept(tab) && tentative.delete(tab)) keep(tab, false);
}
export function settle() {
  tentative.clear();
  flushSeen();
  atSitting = null;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') settle(); });
window.addEventListener('pagehide', settle);

/* ----------------------------------------------------------- the seen list */
/* Keys a wall has put on the screen, shared by the walls, so a post that
   feeds two tabs sinks on both. Written in batches, never on every scroll.
   The list is read once a sitting: what the reader saw a minute ago stays
   where it is through a chip or a switch (Ashley's beagles do not vanish when
   she taps Home fixers), and sinks the next time she comes. */
let toSee = new Set(), seenT = 0, atSitting = null;
function flushSeen() {
  clearTimeout(seenT);
  seenT = 0;
  if (toSee.size) store.markWallSeen([...toSee]);
  toSee = new Set();
}
function markSeen(k) {
  toSee.add(k);
  if (!seenT) seenT = setTimeout(flushSeen, SEEN_FLUSH);
}
export const seen = () => { if (!atSitting) { flushSeen(); atSitting = store.wallSeen(); } return atSitting; };
/* The unseen first, as they came; then the seen, the longest ago first, so a
   reader who has seen everything still gets a new top. */
export function sink(list, map) {
  const fresh = list.filter((v) => !map[v.k]);
  const old = list.filter((v) => map[v.k]);
  return fresh.concat(old.map((v, i) => [v, i]).sort((a, b) => (map[a[0].k] - map[b[0].k]) || (a[1] - b[1])).map((x) => x[0]));
}

/* One account's posts that say the same thing, or went up minutes apart, are
   one set: the first of them stands for it. */
export function noTwins(views) {
  const kept = new Map();
  return views.filter((v) => {
    const mine = kept.get(v.sid) || [];
    if (mine.some((u) => (v.line && u.line === v.line) || (v.d && u.d && Math.abs(u.d - v.d) < SET_SECONDS))) return false;
    kept.set(v.sid, mine.concat(v));
    return true;
  });
}
/* a tile with words sells the tap; one without waits behind them */
export const wordsFirst = (list) => list.filter((v) => v.line).concat(list.filter((v) => !v.line));
/* The list as it came, but the next one is never the same as the last while
   another is left: two teal tiles do not sit side by side. */
export function apart(list, keyOf) {
  const left = [...list], out = [];
  while (left.length) {
    const last = out.length ? keyOf(out[out.length - 1]) : null;
    const at = left.findIndex((v) => keyOf(v) !== last);
    out.push(...left.splice(Math.max(at, 0), 1));
  }
  return out;
}

/* ---------------------------------------------------------------- caption */
/* post.hd, then post.cp (scripts/build_instagram.py). A post with neither
   gets no line: the builder has already said why, and a raw caption here would
   put back the phone numbers and names it took out. cleanCaption is the rule
   for a word's worth of other text: hashtags, @handles and emoji come off and
   the first sentence stays; a tag that leaves a hole in the sentence, a line
   too short to say anything, one that stops on "with", or a pitch (a phone
   number, "DM us", BOOKING) gives no line at all. */
const STYLED = /[\u{1D400}-\u{1D7FF}]/gu;
const HANDLE = /(?<![\w&.])@[\w.]*\w/g;
const HASHTAG = /(?<![\w&])#\w*[^\W\d]\w*/g;
const AT = '', TAG = '';
const BREAK = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}|•·]/gu;
const JOINER = /[\uFE0F\u200D\u200B\u2060\u2800\u20E3\u{1F3FB}-\u{1F3FF}]/gu;
const SENTENCE = /[.!?…]+["'”’)]*(?=\s|$)/g;
const NOT_THE_END = new Set('st mt ft dr mr mrs ms jr sr no vs ave rd jan feb mar apr jun jul aug sep sept oct nov dec mon tue tues wed thu thur thurs fri sat sun inc co a.m p.m am pm'.split(' '));
const DANGLES = new Set('a an the and or of at in on to for with from by w/ &'.split(' '));
const CAP_CHARS = [12, 140];
const LABEL = /^(?:EN:|\(news release\))\s*/i;
const PITCH = /\b\d{3}[\s.)-]{1,2}\d{3}[\s.-]\d{4}\b|\bdm (?:us|me)\b|\bbooking\b|\d+\s?% off\b|\bearly[- ]bird\b|\border online\b|\bgiveaway\b|\buse code\b/i;
export const pitches = (text) => PITCH.test(text);
function firstSentence(t) {
  SENTENCE.lastIndex = 0;
  for (let m = SENTENCE.exec(t); m; m = SENTENCE.exec(t)) {
    const word = (t.slice(0, m.index).match(/[\w.]*$/) || [''])[0].toLowerCase();
    if (m[0] !== '.' || !(NOT_THE_END.has(word) || word.length === 1)) return t.slice(0, m.index + m[0].length);
  }
  return t;
}
export function cleanCaption(text) {
  const t = String(text || '').replace(STYLED, (c) => c.normalize('NFKC')).replace(HANDLE, ' ' + AT + ' ').replace(HASHTAG, ' ' + TAG + ' ')
    .replace(JOINER, '').replace(BREAK, '\n');
  const part = t.split('\n').find((p) => /[\p{L}\p{N}]/u.test(p)) || '';
  let line = firstSentence(part.replace(/\s+/g, ' ').trim());
  line = line.replace(new RegExp('[\\s' + TAG + ']+(?=[.!?\\u2026]*$)'), '').replace(new RegExp('^[\\s' + TAG + ']+'), '');
  line = line.replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '').replace(/[.\s]+$/, '').replace(LABEL, '');
  /* a quote that ran on past the sentence */
  if ((line.match(/“/g) || []).length !== (line.match(/”/g) || []).length || (line.match(/"/g) || []).length % 2) line = line.replace(/^["“”]+|["“”]+$/g, '');
  if (line.includes(AT) || line.includes(TAG) || line.length < CAP_CHARS[0] || line.length > CAP_CHARS[1] || pitches(line)) return '';
  return DANGLES.has(line.split(' ').pop().toLowerCase()) ? '' : line;
}
/* post.cp has lost its tags, and a line can still have marks round it or a
   hole at its end ("*Closed!* It's!"): the first whole sentence of it stands */
function plainLine(cp) {
  const line = firstSentence(String(cp || '').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim());
  return DANGLES.has(line.split(' ').pop().toLowerCase()) ? '' : line;
}
export const caption = (p) => p.hd || plainLine(p.cp);

/* as many whole words as three lines of this column hold; the CSS clamp is
   only the net under it, and it can stop in a word */
function fitWords(s, chars) {
  if (s.length <= chars) return s;
  const cut = s.slice(0, chars + 1);
  const at = cut.lastIndexOf(' ');
  return (at > 12 ? cut.slice(0, at) : s.slice(0, chars)).replace(/[\s,.;:–—-]+$/, '') + '…';
}

/* --------------------------------------------------------------- the tiles */
const COLOURS = new Set(['reddit', 'facebook', 'x', 'newsletters']);
const playable = (v) => !!v.vu && Number(v.ve) * 1000 > Date.now();

/* A paper's card as a tile. A newsletter's headline is its masthead, so its
   summary stands in; a title loses its # and its emoji. The sheet carries the
   words the card would have shown (`why` is the ranking's, for a pick), with
   the star and share a card has. */
const headline = (t) => String(t || '').replace(/\p{Extended_Pictographic}/gu, '').replace(JOINER, '').replace(/(^|\s)#(?=\w)/g, '$1').replace(/\s+/g, ' ').trim();
export function storyView(c, why) {
  const line = headline(c.ch === 'newsletters' && c.line ? c.line : c.title || c.text);
  const media = c.media || c.thumb || '';
  return { k: c.k, it: c, media, line, src: c.src, tint: COLOURS.has(c.ch) ? c.ch : 'news', url: c.href,
    sheet: { ...c, title: line, text: c.line || why || (c.title ? c.text : '') || '', media, ratio: 'r169' } };
}
/* a notice, a thread titled in two words, or a newsletter that is only its
   masthead and date is a line of the paper, not a tile */
const NOTICE = /\b(?:public (?:meeting|hearing|notice)|notice of|meeting agenda|meeting minutes)\b/i;
export const weakStory = (c) => (c.ch === 'reddit' && String(c.title || '').length < 20) || NOTICE.test(c.title || '') ||
  (c.ch === 'newsletters' && !c.line && /\b20\d\d\b/.test(c.title || ''));

/* a picture's own shape once it is known, so a redraw keeps its height */
const shapes = new Map();
function ownShape(box, shape) {
  box.classList.remove('r11');
  box.classList.toggle('xt-fit', shape < OWN_SHAPE[0] || shape > OWN_SHAPE[1]);
  box.style.aspectRatio = '1 / ' + Math.min(Math.max(shape, OWN_SHAPE[0]), OWN_SHAPE[1]);
}
function headTile(v, i, chars) {
  const a = shell(v, 'xt-head ' + STAGGER[i % STAGGER.length] + ' xt-' + v.tint);
  a.innerHTML = '<b class="xt-t">' + esc(fitWords(v.line || '', Math.round(chars * HEAD_SHARE))) + '</b><span class="xt-s">' + esc(v.src) + '</span>';
  return a;
}
/* the swipe's row, only for what a swipe can mute: a fit check has no source */
function shell(v, cls) {
  const a = el('a', 'xt' + (v.it && (v.it.sid || v.it.src) ? ' fi' : '') + (cls ? ' ' + cls : ''));
  a.href = safeHref(v.url || (v.it && v.it.href));
  a.dataset.k = v.k;
  a.dataset.tile = '1';
  a.setAttribute('aria-label', [v.line, v.src].filter(Boolean).join(', '));
  return a;
}
function tile(v, i, chars) {
  if (!v.media) return headTile(v, i, chars);
  const a = shell(v);
  const line = fitWords(v.line || '', chars);
  /* the mark says it plays here, so only while its video link is good */
  a.innerHTML = '<span class="xt-p ' + (v.poster ? 'r11' : STAGGER[i % STAGGER.length]) + '">' + art(v.media) + (playable(v) ? '<span class="iplay">' + ICON.play + '</span>' : '') + '</span>' +
    (line ? '<span class="xt-h">' + esc(line) + '</span>' : '') + '<span class="xt-s">' + esc(v.src) + '</span>';
  const pic = a.querySelector('img');
  if (!pic) return a;
  pic.alt = v.alt || '';
  /* a post's signature lapsed: a hole reads worse than one less. A story's
     thumbnail failed: the story stays, as its coloured headline. */
  pic.addEventListener('error', () => {
    if (!v.tint) { a.remove(); return; }
    v.media = v.sheet.media = '';
    a.replaceWith(headTile(v, i, chars));
  });
  if (v.poster) {
    const box = a.querySelector('.xt-p');
    const fit = () => { if (pic.naturalWidth) { shapes.set(v.media, pic.naturalHeight / pic.naturalWidth); ownShape(box, shapes.get(v.media)); } };
    if (shapes.has(v.media)) ownShape(box, shapes.get(v.media));
    else pic.addEventListener('load', fit);
  }
  return a;
}

/* a tap, through bindFeed so a hold that ended in a peek opens nothing; a
   video link that lapsed since the tile was drawn opens the still */
function openView(v, node) {
  if (v.open) { v.open(); return; }
  if (playable(v)) { app.showClip({ src: v.vu, poster: v.media, title: v.src, href: v.url, vertical: true, it: v.it }); return; }
  const mark = node && node.querySelector('.iplay');
  if (mark) mark.remove();
  wall.openSheet(v.sheet || { ...v.it, title: v.line || v.it.title });
}

/* Two columns, each new tile on the shorter, so a tile drawn later never moves
   one already there. `upto` draws as far as a redraw needs; o.feed is the
   tab's handlers for bindFeed; o.end, the words at the bottom. */
export function grid(host, views, o = {}) {
  const box = el('div', 'xgrid');
  const cols = [el('div', 'xcol'), el('div', 'xcol')];
  box.append(...cols);
  host.appendChild(box);
  const byKey = new Map(views.map((v) => [v.k, v]));
  const tall = [0, 0];
  const panel = host.closest('.panel');
  const R = { i: 0, dead: false };
  const width = () => cols[0].getBoundingClientRect().width || Math.min(innerWidth, 720) / 2 - 16;
  const eyes = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    eyes.unobserve(e.target);
    markSeen(e.target.dataset.k);
  }), { root: panel, threshold: 0.5 }) : null;
  const foot = el('div', 'xfoot');
  foot.setAttribute('aria-hidden', 'true');
  host.appendChild(foot);
  const draw = (n) => {
    const chars = Math.round(width() / PER_LINE * LINES);
    const end = Math.min(R.i + n, views.length);
    for (; R.i < end; R.i += 1) {
      const a = tile(views[R.i], R.i, chars);
      const at = tall[0] <= tall[1] ? 0 : 1;
      cols[at].appendChild(a);
      tall[at] += a.offsetHeight || 200;
      if (eyes) eyes.observe(a);
    }
    if (R.i >= views.length && o.end && !host.querySelector('.idone')) host.appendChild(el('p', 'idone', esc(o.end)));
  };
  const near = () => !R.dead && foot.isConnected && foot.getBoundingClientRect().top - innerHeight < AHEAD;
  R.topUp = () => { if (near() && R.i < views.length) draw(CHUNK); };
  R.drawn = () => R.i;
  /* how many tiles reach the screen: the ones a late file must not move */
  R.onScreen = () => {
    const bottom = panel ? panel.getBoundingClientRect().bottom : innerHeight;
    return [...box.querySelectorAll('[data-tile]')].reduce((n, t) => (t.getBoundingClientRect().top < bottom ? Math.max(n, views.findIndex((v) => v.k === t.dataset.k) + 1) : n), 0);
  };
  const line = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) R.topUp(); },
    { root: panel, rootMargin: '0px 0px ' + AHEAD + 'px 0px' }) : null;
  R.stop = () => { R.dead = true; if (eyes) eyes.disconnect(); if (line) line.disconnect(); };
  app.bindFeed(box, { ...o.feed, onTile: (it) => {
    const v = byKey.get(it.k);
    if (v) openView(v, [...box.querySelectorAll('[data-tile]')].find((n) => n.dataset.k === it.k));
  } });
  draw(Math.max(FIRST, o.upto || 0));
  if (line) line.observe(foot);
  return R;
}

/* the tiles' place while a file is on its way: paper, in the same two columns */
export function waiting(host) {
  const box = el('div', 'xgrid xwait', '<div class="xcol">' + '<i class="r45"></i><i class="r11"></i>' + '</div><div class="xcol">' + '<i class="r34"></i><i class="r45"></i>' + '</div>');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-label', 'Loading');
  host.appendChild(box);
}
