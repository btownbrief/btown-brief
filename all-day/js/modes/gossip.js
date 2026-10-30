/* gossip.js — The Paper's Gossip (wave 1, 2026-10-29): what
   Burlington is talking about, the bulletin board version.

     This week  the liveliest r/burlington and r/vermont threads from the
                guide's chatter read (data/chatter.json): its highlights
                (the most useful question, the most debated, someone who
                needs help) and the topics with the most threads
     Threads    the questions the town keeps asking and has settled, each
                linked to its thread (data/best-of-reddit.json)
     Archive    the same read, week by week (data/paper/gossip-archive.json,
                seeded from chatter.json's history)

   No names: a thread is its title and its link, never who posted it, and a
   row the chatter read itself marks unverified or a rumor is left out.
   Freshest first: the top tab with the newest thing leads. */

import * as app from '../app.js';
import { el, esc, ICON, chips, button } from '../ui.js';
import { sectionBar } from '../sections.js';
import * as P from './paper-core.js';

const KEY = 'gossip';
const SECS = [['week', 'This week'], ['threads', 'Threads'], ['archive', 'Archive']];
const S = { root: null, slots: {}, data: null, cat: null, shown: 12, pending: null, ready: false };
const NAME = /\b\/?u\/[\w-]{2,}/g;
const clean = (t) => String(t || '').replace(NAME, 'a neighbor').replace(/\s+/g, ' ').trim();
const t2s = (iso) => { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : Math.floor(t / 1000); };
const keep = (x) => x && x.url && x.title && !x.unverified && !/rumou?r/i.test((x.slot || '') + ' ' + (x.slot_label || '') + ' ' + (x.label || ''));

/* one thread: what kind of talk, the title, where and when */
function threadRows(host, list, prefix) {
  const items = list.filter(keep).map((x, i) => {
    const at = t2s(x.when);
    return P.item(KEY, prefix + '-' + i + '-' + x.url, { kind: 'post', title: clean(x.title), href: x.url, eyebrow: x.label || x.slot_label || null,
      line: [x.blurb ? '“' + clean(x.blurb).slice(0, 140) + '”' : '', [x.sub, at ? P.ago(at) : ''].filter(Boolean).join(' · ')].filter(Boolean).join(' ') });
  });
  app.know(items);
  const box = el('div', 'pp-list');
  items.forEach((it) => { const n = P.row(it); if (n) box.appendChild(n); });
  host.appendChild(box);
  return items.length;
}

function drawWeek(box) {
  const c = S.data.chatter;
  if (!c) { P.noteLine(box, 'Couldn’t load this week.'); return; }
  const up = t2s(c.updated);
  const stale = up && Date.now() / 1000 - up > 8 * 86400;
  if (stale) box.appendChild(el('p', 'pp-count', esc('Updated ' + P.ago(up))));
  const topics = (c.topics || []).filter((t) => t && (t.posts || 0) > 1 && t.sources && t.sources[0]).map((t) => ({
    title: t.sources[0].title || t.label, url: t.sources[0].url, sub: t.sources[0].sub, when: t.last_activity, label: 'Talked about in ' + t.posts + ' threads' }));
  const seen = new Set();
  const list = [...(c.highlights || []), ...topics].filter((x) => x && x.url && !seen.has(x.url) && (seen.add(x.url), true));
  if (!threadRows(box, list.slice(0, 10), 'w')) P.noteLine(box, 'Quiet week.');
}

function drawThreads(box) {
  const cats = ((S.data.bestof && S.data.bestof.categories) || []).filter((c) => c && c.id && Array.isArray(c.entries) && c.entries.length);
  if (!cats.length) { P.noteLine(box, 'Couldn’t load the threads.'); return; }
  if (!S.cat) S.cat = cats[0].id;
  const host = el('div');
  const paint = () => {
    host.innerHTML = '';
    const cat = cats.find((c) => c.id === S.cat) || cats[0];
    const entries = cat.entries.filter((e) => e && e.question && (e.sources || []).some((s) => s && s.thread_url))
      .map((e) => ({ e, src: (e.sources || []).filter((s) => s && s.thread_url).sort((a, b) => (b.year || 0) - (a.year || 0)) }))
      .sort((a, b) => b.src.length - a.src.length || (b.src[0].year || 0) - (a.src[0].year || 0));
    const items = entries.slice(0, S.shown).map(({ e, src }) => P.item(KEY, 'q-' + e.id, { title: e.question, href: src[0].thread_url,
      line: src.length > 1 ? src.length + ' threads' : '' }));
    app.know(items);
    const list = el('div', 'pp-list');
    items.forEach((it) => { const n = P.row(it, { cls: 'tight' }); if (n) list.appendChild(n); });
    host.appendChild(list);
    const more = el('div', 'pp-more');
    if (entries.length > S.shown) more.appendChild(button('Show more', 'ghost sm', () => { S.shown += 12; paint(); }));
    host.appendChild(more);
  };
  const row = chips(cats.map((c) => ({ key: c.id, label: c.title })), S.cat, (k) => {
    S.cat = k; S.shown = 12;
    row.querySelectorAll('.chip').forEach((b) => { const on = b.dataset.chip === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    paint();
  });
  row.setAttribute('aria-label', 'Kinds of question');
  box.append(row, host);
  paint();
}

function drawArchive(box) {
  const weeks = S.data.weeks;
  if (!weeks.length) { P.noteLine(box, 'Nothing kept yet.'); return; }
  weeks.forEach((w) => {
    const d = P.isoDay(w.week);
    box.appendChild(el('div', 'tdiv', '<span>' + esc('Week of ' + (d ? P.shortDate(d) + ', ' + d.getFullYear() : w.week)) + '</span>'));
    threadRows(box, w.threads.slice(0, 6), 'a-' + w.week);
  });
}

function draw() {
  const root = S.root;
  root.innerHTML = '';
  S.slots = {};
  const page = P.bind(el('div', 'pp'));
  const fns = { week: drawWeek, threads: drawThreads, archive: drawArchive };
  SECS.forEach(([k, label]) => {
    const box = P.block(page, k, label);
    S.slots[k] = box;
    try { fns[k](box); } catch (e) { console.error('[paper] gossip ' + k, e); P.noteLine(box, 'This part didn’t draw.'); }
  });
  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}

/* the chatter read's own week first, then the kept weeks, newest first */
function weeksFrom(chatter, kept) {
  const list = ((kept && kept.weeks) || []).filter((w) => w && w.week && Array.isArray(w.threads));
  const up = chatter && chatter.updated && P.isoDay(chatter.updated.slice(0, 10));
  if (up) {
    const monday = new Date(up); monday.setDate(up.getDate() - ((up.getDay() + 6) % 7));
    const wk = P.ymd(monday);
    if (!list.some((w) => w.week === wk)) list.push({ week: wk, threads: (chatter.highlights || []).map((h) => ({ ...h, label: h.slot_label })) });
  }
  return list.sort((a, b) => (a.week < b.week ? 1 : -1));
}

let loading = null;
function load() {
  if (!loading) loading = Promise.all([P.load('chatter'), P.load('bestof'), P.load('weeks')]).then(([chatter, bestof, kept]) => {
    const weeks = weeksFrom(chatter, kept);
    S.data = { chatter, bestof, weeks,
      at: { week: t2s(chatter && chatter.updated), threads: t2s(bestof && bestof.updated), archive: weeks[0] ? P.epoch(P.isoDay(weeks[0].week)) : 0 } };
    S.ready = true;
    app.recount();
  });
  return loading;
}

function land() {
  const want = S.pending;
  if (!want || !S.ready || !S.root || !S.root.firstChild) return;
  S.pending = null;
  if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
  if (!app.flashHit(S.root, want)) app.toast('That’s gone from Gossip now.');
}

app.register(KEY, {
  label: 'Gossip',
  icon: ICON.comment,
  promise: 'What Burlington is talking about, no names.',
  mount(root) {
    P.style();
    S.root = root;
    root.appendChild(el('p', 'loading', esc('Loading the talk…')));
    load().then(() => { draw(); land(); });
  },
  activate(param) { S.pending = param || null; land(); },
  refresh() { if (S.ready && S.root) draw(); },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-paper-gossip', title: 'Gossip', color: '--app-paper-pop', fresh: true,
      find: (k) => S.slots[k], onPick: (k) => app.jumpTo(S.slots[k]),
      items: SECS.map(([k, label]) => ({ key: k, label, newest: S.data.at[k] || undefined })) });
  },
  keepSubnav: true,
  newSince(ts) {
    if (!S.data) return 0;
    const base = Number(ts) || P.now() - 4 * 3600;
    return Object.values(S.data.at).filter((t) => t > base).length;
  },
});
