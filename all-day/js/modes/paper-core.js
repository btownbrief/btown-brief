/* paper-core.js — what the six tabs of The Paper share (wave 1, 2026-10-29):
   where their data comes from, the words that never change, the rows they
   draw and the Paper's own layout rules.

   Data, live. Everything is public and read in the browser; nothing a
   reader does is sent anywhere.
     ../data/newsletter.json     the latest edition (title, date, link, first
                                 lines), refreshed by the guide's pipeline
     ../data/newsletter-picks.json  the stories in the last eight editions
     archive editions.json       every edition (play.btownbrief.com/archive,
                                 which allows cross-origin reads)
     archive stories-lite.json   every story's headline, link, edition, date
     ../data/paper/*.json        the Paper's own seeded lists: questions,
                                 picks, the A to Z shelves, gossip by week
     ../data/catalog.json        every guide page (new launches appear here)
     play.btownbrief.com/games.json  every game
     ../data/chatter.json, ../data/best-of-reddit.json  the gossip
   On ?demo=1 every one of these is data/demo/paper.json instead: invented,
   and nothing is fetched from anywhere else.

   Layout. The Paper is All Day's sibling: the shell's cards, chips, rows
   and tokens, and a few rules of its own below (the pp- classes), every
   value a token from tokens.css. Editions may run denser, like print. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, safeHref, ICON } from '../ui.js';
import { APPS } from '../apps/index.js';
import { tile } from '../switcher.js';

export const MISSION = 'Know your town. Find your people. Make good things happen.';
export const CREED = 'A town feels like home when you have ways to take part and people to take part with.';
export const ARCHIVE = 'https://play.btownbrief.com/archive/';
export const LINKS = {
  about: 'https://www.btownbrief.com/about-me',
  merch: 'https://merch.btownbrief.com/',
  support: 'https://www.btownbrief.com/upgrade',
  brief: 'https://www.btownbrief.com/?utm_source=paper&utm_medium=referral&utm_campaign=paper_app',
};

const DAY = 86400;
export const now = () => Math.floor(Date.now() / 1000);

/* ---------------------------------------------------------------- data */
const cache = Object.create(null);
function getJSON(url) {
  if (!cache[url]) cache[url] = fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.json(); });
  return cache[url];
}
/* the demo file, once; a tab reads its own part */
const demoAll = () => app.demoJSON('data/demo/paper.json');
export const demoPart = (key) => demoAll().then((j) => (j && j[key]) || {});

/* a fetch that is allowed to fail: null, so a tab says so instead of breaking */
const soft = (p) => p.catch(() => null);
const LIVE = {
  latest: () => soft(getJSON('../data/newsletter.json')),
  recent: () => soft(getJSON('../data/newsletter-picks.json')),
  editions: () => soft(getJSON(ARCHIVE + 'data/editions.json')),
  stories: () => soft(getJSON(ARCHIVE + 'data/stories-lite.json')),
  questions: () => soft(getJSON('../data/paper/questions.json')),
  picks: () => soft(getJSON('../data/paper/picks.json')),
  shelves: () => soft(getJSON('../data/paper/everything.json')),
  weeks: () => soft(getJSON('../data/paper/gossip-archive.json')),
  catalog: () => soft(getJSON('../data/catalog.json')),
  games: () => soft(getJSON('https://play.btownbrief.com/games.json')),
  chatter: () => soft(getJSON('../data/chatter.json')),
  bestof: () => soft(getJSON('../data/best-of-reddit.json')),
};
/* one name, one source: live or the demo's part of the same name */
export const load = (name) => (app.demo ? demoAll().then((j) => dated((j && j.data && j.data[name]) || null)).catch(() => null) : LIVE[name]());

/* The demo's dates are relative, so it reads as today on any day: on a
   copy, daysAgo sets date ('2026-10-26'), storyDaysAgo sets d (the same,
   a story's), epochDaysAgo sets d (epoch seconds, an edition's in
   newsletter-picks), hoursAgo sets when, updated and last_activity (and
   date when there is none), weeksAgo sets week (that week's Monday). */
function dated(v) {
  if (Array.isArray(v)) return v.map(dated);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  Object.keys(v).forEach((k) => { o[k] = dated(v[k]); });
  const day = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
  if (typeof v.daysAgo === 'number') o.date = ymd(day(v.daysAgo));
  if (typeof v.storyDaysAgo === 'number') o.d = ymd(day(v.storyDaysAgo));
  if (typeof v.epochDaysAgo === 'number') o.d = Math.floor(day(v.epochDaysAgo).getTime() / 1000);
  if (typeof v.hoursAgo === 'number') {
    const iso = new Date(Date.now() - v.hoursAgo * 3600000).toISOString();
    o.when = o.updated = o.last_activity = iso;
    if (o.date == null) o.date = iso;
  }
  if (typeof v.weeksAgo === 'number') { const d = day(v.weeksAgo * 7); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); o.week = ymd(d); }
  return o;
}

/* ------------------------------------------------------------- dates */
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/* '2026-10-26' as a local noon, so no time zone moves the day */
export const isoDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
export const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const longDate = (d) => (d ? DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() : '');
export const shortDate = (d) => (d ? MON[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : '') : '');
export const monthName = (i) => MON[i];
export const epoch = (d) => (d ? Math.floor(d.getTime() / 1000) : 0);
export function ago(sec) {
  const s = now() - sec;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < DAY) return Math.round(s / 3600) + 'h ago';
  if (s < 8 * DAY) return Math.round(s / DAY) + 'd ago';
  return shortDate(new Date(sec * 1000));
}
/* today's number on Burlington's calendar (days since 1970), so a daily
   rotation turns over at midnight there, wherever the reader is */
export function townDay(ms = Date.now()) {
  try {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-').map(Number);
    if (y && m && d) return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  } catch (e) { /* no time zone data: the reader's own day */ }
  return Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000);
}
/* a minute a 230 words, rounded up, for the edition's line */
export const readMins = (words) => Math.max(1, Math.round((Number(words) || 0) / 230));

/* ------------------------------------------------------------- editions */
/* The archive's edition page: the paper look the archive already draws
   (play.btownbrief.com/archive/e/<slug>/), else the email's own page. */
export const editionHref = (e) => safeHref(e && e.slug ? ARCHIVE + 'e/' + encodeURIComponent(e.slug) + '/' : (e && e.url) || ARCHIVE);
/* the archive's list, newest first, each with a key and a Date */
export function editionList(j) {
  const list = (Array.isArray(j) ? j : (j && j.editions) || []).filter((e) => e && e.slug && isoDay(e.date));
  return list.map((e) => ({ ...e, key: e.slug, d: isoDay(e.date) })).sort((a, b) => b.d - a.d);
}

/* The topics a reader can follow, each a timeline. The words are the
   archive's own topic rules (archive/scripts/extract.mjs), read off the
   headline, since the public story list carries no topics; openings use its
   opening and closing words on food and business stories. */
const OPEN = /\b(open(s|ed|ing)?|debut(s|ed)?|launch(es|ed)?|coming to|arriv(es|ing)|new location|grand opening|clos(es|ed|ing)|shutter(s|ed|ing)?|last day|says goodbye|final (day|weekend)|shuts? down|out of business|calls it quits)\b/i;
const BIZ = /restaurant|caf[eé]|brewer|bakery|creemee|\bfood\b|pizza|coffee|taproom|\bmenu\b|\bchef|cidery|distill|food truck|deli\b|diner\b|cocktail|business|\bstore\b|\bshop\b|market\b|bar\b/i;
export const TOPICS = [
  { key: 'food', label: 'Food', re: /restaurant|caf[eé]|brewer|bakery|creemee|\bfood\b|pizza|coffee|taproom|\bmenu\b|\bchef|cidery|distill|farmers market|food truck|deli\b|diner\b|cocktail|maple/i },
  { key: 'civic', label: 'Civic', re: /city council|mayor|ballot|election|\bvote\b|legislature|statehouse|governor|selectboard|budget|\btax(es)?\b|town meeting|senator|congress|school board|zoning/i },
  { key: 'music', label: 'Music', re: /concert|\bmusic\b|\bband\b|festival|jazz|\bsongs?\b|\balbum\b|\bsinger|\bdj\b|higher ground|the flynn|orchestra|symphony/i },
  { key: 'sports', label: 'Sports', re: /catamounts?|hockey|basketball|soccer|baseball|lake monsters|vermont green|athletics|playoff|champion|\bmarathon\b|\bski(ing)?\b/i },
  { key: 'openings', label: 'Openings', test: (h) => OPEN.test(h) && BIZ.test(h) },
];
export const inTopic = (t, h) => (t.test ? t.test(h) : t.re.test(h));

/* ------------------------------------------------------------- items */
/* Every row the Paper draws is an item the shell knows (save, share, peek,
   a deep link that flashes it): a key and a URL, always. */
export function item(tab, k, o) {
  return { kind: 'headline', ...o, k: tab + '-' + String(k).replace(/[^\w-]+/g, '-').slice(0, 80), href: safeHref(o.href) };
}

/* the Paper's list row: an optional emoji or date tile, the title, one
   line under it, the star. The whole row opens the link (data-open). */
export function row(it, o = {}) {
  if (!it || !it.k || !it.href) return null;
  const r = el('article', 'card pp-row' + (o.date || it.emoji ? '' : ' bare') + (o.cls ? ' ' + o.cls : '') + (store.isRead(it.k) ? ' is-read' : ''));
  r.dataset.k = it.k;
  const on = store.isSaved(it.k);
  const ext = /^https?:/.test(it.href);
  const tileHtml = o.date ? '<span class="pp-date"><b>' + esc(o.date[0]) + '</b><span>' + esc(o.date[1]) + '</span></span>'
    : it.emoji ? '<span class="pp-emoji" aria-hidden="true">' + esc(it.emoji) + '</span>' : '';
  r.innerHTML = tileHtml + '<a class="pp-open" href="' + esc(it.href) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + ' data-open>' +
    (it.eyebrow ? '<span class="eyebrow">' + esc(it.eyebrow) + '</span>' : '') +
    '<span class="pp-t">' + esc(it.title) + '</span>' + (it.line ? '<span class="pp-s">' + esc(it.line) + '</span>' : '') + '</a>' +
    (o.noStar ? '' : '<button class="act star' + (on ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + on + '">' + ICON.star + '</button>');
  return r;
}

/* a section head with an id the pill can find */
export function block(host, key, title, sub) {
  const box = el('section', 'pp-sec');
  box.dataset.sec = key;
  const h = el('div', 'sec');
  h.innerHTML = '<div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>';
  box.appendChild(h);
  host.appendChild(box);
  return box;
}
export function noteLine(host, text) { const n = el('p', 'note pad pp-note', esc(text)); host.appendChild(n); return n; }
export function linkBtn(label, href, cls) {
  const a = el('a', 'btn ' + (cls || 'ghost sm'), esc(label) + (/^https?:/.test(href) ? ' ' + ICON.ext : ''));
  a.href = safeHref(href);
  if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
  return a;
}

/* the eight apps, as cards: this one marked. `wide` is the aside's column. */
export function appCards(host, tab, o = {}) {
  const list = o.inRail ? host : el('div', o.column ? 'pp-apps col' : 'pp-apps');
  APPS.forEach((a) => {
    const here = a.id === app.APP.id;
    const href = here ? '#' + app.HOME : new URL(a.href, document.baseURI).pathname + (app.demo ? '?demo=1' : '');
    const c = el('a', 'pp-app' + (here ? ' on' : ''), tile(a, 'sm') + '<span class="pp-app-w"><b>' + esc(a.name) + '</b><span>' + esc(a.line || '') + '</span></span>');
    c.href = href;
    c.dataset.app = a.id;
    if (here) c.setAttribute('aria-current', 'page');
    list.appendChild(c);
  });
  if (!o.inRail) host.appendChild(list);
  return list;
}

/* the whole-row link opens the item (bindFeed's data-open); demo toasts */
export function bind(host) { app.bindFeed(host); demoLinks(host); return host; }
/* the demo never leaves the page: a link out says where it would go */
export function demoLinks(host) {
  if (!app.demo) return host;
  host.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    const a = e.target.closest && e.target.closest('a[href^="http"]');
    if (!a) return;
    e.preventDefault();
    let where = '';
    try { where = new URL(a.href).hostname.replace(/^www\./, ''); } catch (err) { where = ''; }
    app.toast('Demo: opens ' + (where || 'the page') + ' in the real build');
  });
  return host;
}

/* ---------------------------------------------------------------- picks */
/* the day's three picks and the spotlight, the same all day for everyone */
export function todaysPicks(pj, catalog, n = 3) {
  const list = (pj && Array.isArray(pj.picks) ? pj.picks : []).filter((p) => p && p.title && p.href);
  const day = townDay();
  const out = [];
  for (let i = 0; i < Math.min(n, list.length); i++) out.push(list[(day * n + i) % list.length]);
  const spot = spotlight(catalog, day);
  if (spot) out.push({ ...spot, eyebrow: 'Spotlight' });
  return out;
}
/* one guide page a day, round the whole catalog */
export function spotlight(catalog, day = townDay()) {
  const all = ((catalog && catalog.groups) || []).flatMap((g) => g.cards || []).filter((c) => c && c.title && c.href);
  if (!all.length) return null;
  const c = all[day % all.length];
  return { title: c.title, why: c.blurb || '', href: c.href, emoji: c.emoji || null };
}

/* ---------------------------------------------------------------- styles */
/* The Paper's own rules, every value a token. Injected once. */
const CSS = `
.pp { max-width: var(--col); margin: 0 auto; padding-bottom: var(--s6); }
.pp-sec + .pp-sec { margin-top: var(--s2); }
.pp-dateline { padding: var(--s4) var(--gutter) 0; color: var(--ink-3); }
.pp-dateline .eyebrow { color: var(--ink-3); }
.pp-mission { padding: var(--s2) var(--gutter) var(--s4); font-family: var(--serif); font-size: var(--fs-w-lead-xl); font-weight: 500; line-height: var(--lh-tight); color: var(--ink); }
.pp-creed { padding: 0 var(--gutter) var(--s3); font-family: var(--serif); font-size: var(--fs-lead); font-style: italic; line-height: 1.45; color: var(--ink-2); }
.pp-mail { margin: 0 var(--gutter); padding: var(--s3) var(--s3) var(--s2) var(--s4); border-radius: var(--r-media); background: var(--accent-soft); }
.pp-mail .ask-t { font-size: var(--fs-body); }
.pp-mail .ask-embed { margin-top: var(--s1); }
.pp-mail-row { display: flex; align-items: center; gap: var(--s2); margin-top: var(--s2); }
.pp-mail-row .field { background: var(--raised); }
.pp-mail-foot { display: flex; justify-content: flex-end; margin-top: var(--s1); }
/* the questions: two rows that swipe together, so four or more show at once */
.chips.pp-qs { display: grid; grid-auto-flow: column; grid-template-rows: auto auto; grid-auto-columns: max-content; gap: var(--s2); padding-top: var(--s1); }
.chips.pp-qs::after { display: none; }
.chips.pp-qs .chip { height: auto; min-height: var(--hit); padding: var(--s2) var(--s3); white-space: nowrap; border-radius: var(--r-pill); background: var(--raised); border: 1px solid var(--line); color: var(--ink); font-weight: 600; }
.chips.pp-qs .chip:hover { border-color: var(--ink-3); }
.pp-lead { display: block; padding: var(--s4) var(--gutter) var(--s3); border-bottom: 1px solid var(--line); }
.pp-lead .eyebrow { display: block; margin-bottom: var(--s2); }
.pp-lead-t { display: block; font-family: var(--serif); font-size: var(--fs-w-lead-xl); font-weight: 500; line-height: 1.15; color: var(--ink); }
.pp-lead-t:hover { text-decoration: underline; }
.pp-lead-d { margin-top: var(--s2); color: var(--ink-2); font-size: var(--fs-w-dek); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.pp-lead-m { display: flex; align-items: center; gap: var(--s1); margin-top: var(--s2); font-size: var(--fs-meta); color: var(--ink-3); }
.pp-lead-m span { flex: 1; }
.pp-rundown { padding: 0 var(--gutter); }
.pp-rundown.flush { padding: 0; margin-top: var(--s2); }
.pp-rundown li { list-style: none; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s2); padding: var(--s2) 0; border-bottom: 1px solid var(--line-soft); line-height: 1.35; }
.pp-rundown li:last-child { border-bottom: 0; }
.pp-rundown .n { font-family: var(--serif); color: var(--ink-3); min-width: 1.2em; }
.pp-rundown a { color: var(--ink); font-weight: 500; }
.pp-rundown a:hover { text-decoration: underline; }
.pp-rundown .src { display: block; font-size: var(--fs-small); color: var(--ink-3); margin-top: 2px; }
.pp-more { display: flex; flex-wrap: wrap; gap: var(--s2); padding: var(--s3) var(--gutter) 0; }
.card.pp-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--s3); padding: var(--s3) var(--gutter); border-bottom: 1px solid var(--line); }
.card.pp-row .pp-open { display: block; min-width: 0; grid-column: 2; }
.card.pp-row.bare { grid-template-columns: minmax(0, 1fr) auto; }
.card.pp-row.bare .pp-open { grid-column: 1; }
.card.pp-row.bare .act.star { grid-column: 2; }
.card.pp-row .act.star { grid-column: 3; }
.pp-row .pp-t { display: block; font-size: var(--fs-title); font-weight: 600; line-height: 1.3; color: var(--ink); }
.pp-row .pp-s { display: block; font-size: var(--fs-meta); color: var(--ink-3); margin-top: 2px; line-height: 1.4; }
.pp-row .eyebrow { display: block; margin-bottom: 2px; }
.pp-row .pp-open:hover .pp-t { text-decoration: underline; }
.pp-row.is-read .pp-t { color: var(--ink-2); font-weight: 500; }
.pp-row.tight { padding-top: var(--s2); padding-bottom: var(--s2); }
.pp-row.tight .pp-t { font-size: var(--fs-body); }
.pp-emoji { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--r-tile); background: var(--paper-2); font-size: var(--fs-section); line-height: 1; }
.pp-date { display: grid; place-items: center; width: 44px; padding: var(--s1) 0; border-radius: var(--r-tile); background: var(--paper-2); line-height: 1.1; }
.pp-date b { font-family: var(--serif); font-size: var(--fs-date); font-weight: 500; color: var(--ink); }
.pp-date span { font-size: var(--fs-small); color: var(--ink-3); }
.pp-apps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s2); padding: 0 var(--gutter); }
.pp-apps.col { grid-template-columns: minmax(0, 1fr); padding: 0; }
.pp-app { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--s2); padding: var(--s2); border: 1px solid var(--line); border-radius: var(--r-media); background: var(--raised); color: var(--ink); }
.rail .pp-app { width: 236px; }
@media (min-width: 1280px) { body.has-aside .pp-apps-sec { display: none; } }
.pp-go { display: inline-flex; color: var(--ink-3); }
.pp-go .i { width: 18px; height: 18px; }
.pp-app:hover { border-color: var(--ink-3); }
.pp-app.on { border-color: var(--ink); }
.pp-app-w { min-width: 0; line-height: 1.25; }
.pp-app-w b { display: block; font-size: var(--fs-button); font-weight: 700; }
.pp-app-w span { display: block; font-size: var(--fs-small); color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-note { margin-top: var(--s2); }
.pp-tl-year { padding: var(--s4) var(--gutter) var(--s1); font-family: var(--serif); font-size: var(--fs-date); font-weight: 500; color: var(--ink); border-bottom: 1px solid var(--line); }
.pp-months { padding: 0 var(--gutter); }
.pp-month { display: grid; grid-template-columns: 7.5em minmax(0, 1fr); gap: var(--s2); align-items: baseline; padding: var(--s2) 0; border-bottom: 1px solid var(--line-soft); }
.pp-month h3 { font-family: var(--serif); font-size: var(--fs-body); font-weight: 500; color: var(--ink); }
.pp-month h3 span { display: block; font-family: var(--sans); font-size: var(--fs-small); color: var(--ink-3); }
.pp-days { display: flex; flex-wrap: wrap; gap: var(--s1); }
.pp-day { display: inline-grid; place-items: center; min-width: 40px; height: 36px; padding: 0 var(--s1); border-radius: var(--r-tile); border: 1px solid var(--line); color: var(--ink); font-size: var(--fs-meta); font-weight: 600; line-height: 1.05; }
.pp-day small { display: block; font-size: var(--fs-tag); font-weight: 500; color: var(--ink-3); }
.pp-day:hover { border-color: var(--ink); }
.pp-search { display: flex; gap: var(--s2); padding: 0 var(--gutter) var(--s2); }
.pp-search .field { background: var(--raised); }
.pp-count { padding: 0 var(--gutter); font-size: var(--fs-meta); color: var(--ink-3); }
.pp-shelf h3 { padding: var(--s4) var(--gutter) var(--s1); font-family: var(--serif); font-size: var(--fs-date); font-weight: 500; border-bottom: 1px solid var(--line); }
.pp-story p { padding: 0 var(--gutter) var(--s3); line-height: 1.55; color: var(--ink-2); }
.pp-story .pp-mission { padding-top: var(--s5); }
.pp-story p a { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
.pp-story .pp-credit { color: var(--ink-3); font-size: var(--fs-meta); }
.pp-gap { height: var(--s3); }
.pp-big { margin: 0 var(--gutter); padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-media); background: var(--raised); }
.pp-big .eyebrow { display: block; margin-bottom: var(--s1); }
.pp-big h3 { font-family: var(--serif); font-size: var(--fs-w-lead); font-weight: 500; line-height: 1.2; }
.pp-big h3 a:hover { text-decoration: underline; }
.pp-big p { margin-top: var(--s1); color: var(--ink-2); line-height: 1.5; }
.pp-big .pp-more { padding: var(--s3) 0 0; }
.pp-qsheet .sheet-row a.t { color: var(--ink); }
.aside .pp-aside h3 { font-family: var(--serif); font-size: var(--fs-section); font-weight: 500; padding: 0 0 var(--s2); }
@media (min-width: 1024px) { .pp-mission { font-size: var(--fs-count); } }
`;
let styled = false;
export function style() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'paper-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
