/* editions.js — The Paper's Editions (wave 1, 2026-10-29): every
   edition of the Brief, the archive read the Paper's way.

   One page, in the order of its top tabs: the latest edition, then the
   rest of the week's; every edition by date, a month to a line like a
   newspaper's index; By interest, a timeline per topic (food, civic,
   music, sports, openings); a search of every headline; this week last
   year; a random edition; and the archive's ask box.

   The data is the archive's own public files (play.btownbrief.com/archive,
   which allows reading them from the guide): editions.json for the
   editions and stories-lite.json for every story's headline. Search and
   the timelines run in the browser on that list, so nothing typed here
   goes anywhere. An edition opens on the archive's page for it. If the
   archive does not answer, the last eight editions from the guide's own
   newsletter-picks.json stand in, and the page says so. */

import * as app from '../app.js';
import { el, esc, safeHref, ICON, chips, button } from '../ui.js';
import { sectionBar } from '../sections.js';
import * as P from './paper-core.js';

const KEY = 'editions';
const SECS = [['latest', 'Latest'], ['bydate', 'By date'], ['interest', 'By interest'], ['search', 'Search'], ['lastyear', 'This week last year'], ['random', 'Random'], ['ask', 'Ask']];
const PAGE = 15;
const S = { root: null, slots: {}, eds: [], bySlug: {}, byEd: new Map(), stories: null, storiesFailed: false, fallback: false, topic: 'food', shown: PAGE, pick: null, q: '', pending: null, ready: false };

const dow3 = (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
/* an edition's stories, from an index built once */
const storiesOf = (key) => S.byEd.get(key) || [];
function index() {
  S.byEd = new Map();
  (S.stories || []).forEach((s) => { if (!S.byEd.has(s.e)) S.byEd.set(s.e, []); S.byEd.get(s.e).push(s); });
}

/* one edition as a row: the date tile, the title, its first headlines */
function edRow(e, o = {}) {
  const st = storiesOf(e.key);
  const it = P.item(KEY, e.key, { title: e.title, href: P.editionHref(e),
    line: st.length ? st.slice(0, 2).map((s) => s.h).join(' · ') : P.longDate(e.d) + (e.d.getFullYear() !== new Date().getFullYear() ? ', ' + e.d.getFullYear() : '') });
  app.know([it]);
  return P.row(it, { date: [String(e.d.getDate()), dow3(e.d)], cls: o.cls });
}

/* the big card: an edition, its date, how many stories, the first three */
function bigCard(e, eyebrow, lines) {
  const box = el('div', 'pp-big');
  const st = storiesOf(e.key);
  box.dataset.k = KEY + '-big-' + e.key;
  box.innerHTML = (eyebrow ? '<span class="eyebrow">' + esc(eyebrow) + '</span>' : '') + '<h3><a href="' + esc(P.editionHref(e)) + '" target="_blank" rel="noopener">' + esc(e.title) + '</a></h3>' +
    (lines ? '<p>' + esc(lines) + '</p>' : '');
  if (st.length) {
    const ol = el('ol', 'pp-rundown flush');
    st.slice(0, 3).forEach((s, i) => ol.appendChild(el('li', '', '<span class="n">' + (i + 1) + '</span><span><a href="' + esc(safeHref(s.u)) + '" target="_blank" rel="noopener">' + esc(s.h) + '</a></span>')));
    box.appendChild(ol);
  }
  return box;
}

/* --------------------------------------------------------------- blocks */
function drawLatest(box, latest) {
  const [first, ...rest] = S.eds;
  if (!first) { P.noteLine(box, 'Couldn’t load the editions.'); return; }
  const preview = latest && latest.url === first.url ? String(latest.preview || '').replace(/\s+/g, ' ') : '';
  box.appendChild(bigCard(first, 'The latest edition', preview));
  const list = el('div', 'pp-list');
  rest.slice(0, 6).forEach((e) => { const n = edRow(e); if (n) list.appendChild(n); });
  box.appendChild(list);
  if (S.fallback) P.noteLine(box, 'Showing the last few editions.');
}

function drawByDate(box) {
  const months = [];
  S.eds.forEach((e) => {
    const key = e.d.getFullYear() + '-' + e.d.getMonth();
    let m = months[months.length - 1];
    if (!m || m.key !== key) { m = { key, y: e.d.getFullYear(), m: e.d.getMonth(), eds: [] }; months.push(m); }
    m.eds.push(e);
  });
  const wrap = el('div', 'pp-months');
  months.forEach((m) => {
    const row = el('div', 'pp-month');
    row.appendChild(el('h3', '', esc(P.monthName(m.m)) + '<span>' + m.y + ' · ' + m.eds.length + '</span>'));
    const days = el('div', 'pp-days');
    m.eds.slice().reverse().forEach((e) => {
      const a = el('a', 'pp-day', String(e.d.getDate()) + '<small>' + dow3(e.d) + '</small>');
      a.href = P.editionHref(e);
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', e.title + ', ' + P.longDate(e.d) + ', ' + e.d.getFullYear());
      days.appendChild(a);
    });
    row.appendChild(days);
    wrap.appendChild(row);
  });
  box.appendChild(wrap);
}

function drawInterest(box) {
  const host = el('div', 'pp-tl');
  const paint = () => {
    host.innerHTML = '';
    const t = P.TOPICS.find((x) => x.key === S.topic) || P.TOPICS[0];
    if (!S.stories) { host.appendChild(el('p', 'note pad', esc(S.storiesFailed ? 'Couldn’t load the stories.' : 'Loading…'))); return; }
    const hits = S.stories.filter((s) => P.inTopic(t, s.h));
    host.appendChild(el('p', 'pp-count', esc(hits.length + ' stories')));
    let year = null;
    const list = el('div', 'pp-list');
    hits.slice(0, S.shown).forEach((s) => {
      const d = P.isoDay(s.d);
      if (d && d.getFullYear() !== year) { year = d.getFullYear(); list.appendChild(el('div', 'pp-tl-year', String(year))); }
      const ed = S.bySlug[s.e];
      const it = P.item(KEY, 't-' + t.key + '-' + s.u, { title: s.h, href: s.u, line: (d ? P.shortDate(d) : '') + (ed ? ' · in ' + ed.title : '') });
      app.know([it]);
      const n = P.row(it, { cls: 'tight' });
      if (n) list.appendChild(n);
    });
    host.appendChild(list);
    const more = el('div', 'pp-more');
    if (hits.length > S.shown) more.appendChild(button('Show ' + Math.min(PAGE, hits.length - S.shown) + ' more', 'ghost sm', () => { S.shown += PAGE; paint(); }));
    host.appendChild(more);
  };
  const row = chips(P.TOPICS.map((t) => ({ key: t.key, label: t.label })), S.topic, (k) => {
    S.topic = k; S.shown = PAGE;
    row.querySelectorAll('.chip').forEach((c) => { const on = c.dataset.chip === k; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    paint();
  });
  row.setAttribute('aria-label', 'Topics');
  box.append(row, host);
  paint();
  S.paintTopic = paint;
}

function drawSearch(box) {
  const form = el('form', 'pp-search');
  form.setAttribute('role', 'search');
  const input = el('input', 'field');
  input.type = 'search';
  input.placeholder = 'Search every headline';
  input.setAttribute('aria-label', 'Search every headline in the archive');
  input.value = S.q;
  form.appendChild(input);
  const out = el('div', 'pp-results');
  const paint = () => {
    out.innerHTML = '';
    const q = S.q.trim().toLowerCase();
    if (q.length < 2) return;
    if (!S.stories) { out.appendChild(el('p', 'pp-count', esc(S.storiesFailed ? 'Couldn’t load the headlines.' : 'Loading…'))); return; }
    const words = q.split(/\s+/).filter(Boolean);
    const hits = (S.stories || []).filter((s) => { const h = s.h.toLowerCase(); return words.every((w) => h.includes(w)); });
    out.appendChild(el('p', 'pp-count', esc(hits.length ? hits.length + (hits.length === 1 ? ' headline' : ' headlines') : 'No headlines match.')));
    const list = el('div', 'pp-list');
    hits.slice(0, 20).forEach((s) => {
      const d = P.isoDay(s.d);
      const ed = S.bySlug[s.e];
      const it = P.item(KEY, 's-' + s.u, { title: s.h, href: s.u, line: (d ? P.shortDate(d) : '') + (ed ? ' · in ' + ed.title : '') });
      app.know([it]);
      const n = P.row(it, { cls: 'tight' });
      if (n) list.appendChild(n);
    });
    out.appendChild(list);
  };
  let t = 0;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = input.value; paint(); }, 120); });
  form.addEventListener('submit', (e) => { e.preventDefault(); S.q = input.value; paint(); input.blur(); });
  box.append(form, out);
  const more = el('div', 'pp-more');
  more.appendChild(P.linkBtn('Search the full archive', P.ARCHIVE));
  box.appendChild(more);
  paint();
  S.paintSearch = paint;
}

function drawLastYear(box) {
  /* the same Monday-to-Sunday week, a year ago (52 weeks keeps the weekday) */
  const back = new Date(); back.setHours(12, 0, 0, 0); back.setDate(back.getDate() - 364);
  back.setDate(back.getDate() - ((back.getDay() + 6) % 7));
  const lo = back.getTime() - 12 * 3600000, hi = lo + 7 * 86400000;
  let hits = S.eds.filter((e) => e.d.getTime() >= lo && e.d.getTime() < hi);
  if (!hits.length) {
    const before = S.eds.find((e) => e.d.getTime() < lo);
    if (before) hits = [before];
  }
  if (!hits.length) { P.noteLine(box, 'Nothing from a year ago.'); return; }
  hits.slice().reverse().forEach((e, i) => {
    if (i) box.appendChild(el('div', 'pp-gap'));
    box.appendChild(bigCard(e, String(e.d.getFullYear()), ''));
  });
}

function drawRandom(box) {
  const host = el('div', 'pp-randhost');
  const pick = () => { if (!S.eds.length) return; S.pick = S.eds[Math.floor(Math.random() * S.eds.length)]; paint(); };
  const paint = () => { host.innerHTML = ''; if (S.pick) host.appendChild(bigCard(S.pick, String(S.pick.d.getFullYear()), '')); };
  if (!S.pick) pick(); else paint();
  box.appendChild(host);
  const more = el('div', 'pp-more');
  more.appendChild(button(ICON.shuffle + ' Another one', 'sm', pick));
  box.appendChild(more);
}

function drawAsk(box) {
  const more = el('div', 'pp-more');
  more.appendChild(P.linkBtn('Ask the archive', P.ARCHIVE + '#ask-form', 'sm'));
  box.appendChild(more);
}

/* ----------------------------------------------------------------- draw */
function draw() {
  const root = S.root;
  root.innerHTML = '';
  S.slots = {};
  const page = P.bind(el('div', 'pp pp-editions'));
  const fns = { latest: (b) => drawLatest(b, S.latest), bydate: drawByDate, interest: drawInterest, search: drawSearch, lastyear: drawLastYear, random: drawRandom, ask: drawAsk };
  SECS.forEach(([k, label]) => {
    const box = P.block(page, k, label);
    S.slots[k] = box;
    try { fns[k](box); } catch (e) { console.error('[paper] editions ' + k, e); P.noteLine(box, 'This part didn’t draw.'); }
  });
  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}

/* the stories arrive after the page: the timeline, search and cards fill in */
function storiesIn() {
  if (!S.root || !S.root.firstChild) return;
  draw();
  land();
}

let loading = null;
function load() {
  if (!loading) loading = Promise.all([P.load('editions'), P.load('latest'), P.load('recent')]).then(([eds, latest, recent]) => {
    S.latest = latest;
    S.eds = P.editionList(eds);
    if (!S.eds.length) {
      /* the archive did not answer: the guide's own last eight */
      S.fallback = !app.demo;
      S.eds = ((recent && recent.editions) || []).filter((e) => e && e.url && e.d).map((e) => {
        const d = new Date(e.d * 1000);
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
        return { slug: '', key: 'nl-' + P.ymd(day), url: e.url, title: e.edition, d: day };
      }).sort((a, b) => b.d - a.d);
      S.stories = ((recent && recent.editions) || []).flatMap((e) => { const k = 'nl-' + P.ymd(new Date(e.d * 1000)); return (e.stories || []).map((s) => ({ h: s.t, u: s.u, e: k, d: k.slice(3) })); });
      index();
    }
    S.bySlug = Object.create(null);
    S.eds.forEach((e) => { if (e.slug) S.bySlug[e.slug] = e; });
    S.ready = true;
    app.recount();
  });
  return loading;
}
let storying = null;
function loadStories() {
  if (!storying) storying = load().then(() => (S.stories ? null : P.load('stories'))).then((j) => {
    if (S.stories) return;
    if (!Array.isArray(j)) { S.storiesFailed = true; storiesIn(); return; }
    S.stories = j.filter((s) => s && s.h && s.u).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    index();
    storiesIn();
  });
  return storying;
}
setTimeout(load, 0);

function land() {
  const want = S.pending;
  if (!want || !S.ready || !S.root || !S.root.firstChild) return;
  S.pending = null;
  if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
  const topic = P.TOPICS.find((t) => t.key === want);
  if (topic) { S.topic = topic.key; S.shown = PAGE; draw(); app.jumpTo(S.slots.interest); return; }
  if (!app.flashHit(S.root, want)) app.toast('That’s not in Editions now.');
}

app.register(KEY, {
  label: 'Editions',
  icon: ICON.stack,
  promise: 'Every edition, by date or by what you’re into.',
  mount(root) {
    P.style();
    S.root = root;
    root.appendChild(el('p', 'loading', esc('Loading every edition…')));
    load().then(() => { draw(); land(); loadStories(); });
  },
  activate(param) { S.pending = param || null; land(); },
  refresh() { if (S.ready && S.root) draw(); },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    const newest = S.eds[0] ? P.epoch(S.eds[0].d) : undefined;
    return sectionBar({ key: 'sec-paper-editions', title: 'Editions', color: '--app-paper-pop',
      find: (k) => S.slots[k], onPick: (k) => app.jumpTo(S.slots[k]),
      items: SECS.map(([k, label]) => ({ key: k, label, newest: k === 'latest' ? newest : undefined })) });
  },
  keepSubnav: true,
  newSince(ts) {
    const base = Number(ts) || P.now() - 4 * 3600;
    return S.eds.filter((e) => P.epoch(e.d) > base).length;
  },
});
