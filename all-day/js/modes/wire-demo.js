/* wire-demo.js — the Wire as the design prototype drew it, on baked fake
   data (data/demo/wire.json), for ?demo=1. A daily paper that fills up
   through the day: the dateline (walk back a day), the Local / Everything
   switch and chips by kind of source, What matters today ranked with
   reasons, the river grouped by update, tight rows, a source sheet, and
   "Unfiltered" one level down with the outlet chips.

   Owned with modes/wire.js by the Wire's Stage 2 session, which replaces the
   live half with the real pipeline and may fold this in. Every item is
   invented. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON, mark, cards, chips, pills, button, divider, section, localSwitch, geo, setGeo, put } from '../ui.js';

let D = null;
const W = { root: null, day: 0, ch: 'all', every: false, layout: 'newest', outlet: '', page: 30, fresh: false, more: false, pending: null };
const follows = new Set();

/* Loaded only when the Wire runs in demo mode (wire.js calls init()). */
let readyP = null;
export const init = () => readyP || (readyP = app.demoData('wire').then((d) => {
  D = d;
  d.days.forEach((day) => day.groups.forEach((g) => { if (g.items) app.know(g.items); }));
  Object.values(d.picks).forEach((list) => list.forEach((p) => {
    if (p.ref) { const it = app.item(p.ref); if (it) it.why = p.why; } else app.know([p]);
  }));
  app.know(d.fresh);
  app.know(d.every);
  app.recount();
  return d;
}));

const muted = () => store.muted();
const visible = (it) => !muted()[it.sid] && (geo() === 'everything' || !!it.local);
const chLabel = (k) => (D.channels.find((c) => c.key === k) || { label: '' }).label;
const picksFor = (i) => (D.picks[i] || []).map((p) => (p.ref ? app.item(p.ref) : p)).filter(Boolean);
const pickedIds = (i) => new Set(picksFor(i).map((p) => p.k));
const isRiver = (k) => /^[wyt]\d/.test(k);
const greenOf = (it) => geo() === 'everything' && !!it.local;
const outletN = (name, fallback) => (D.outlets.find((o) => o.name === name) || { n: fallback }).n;

/* ------------------------------------------------------------- subnav */
export function subnav() {
  if (!D) return null;
  const frag = document.createDocumentFragment();
  if (W.every) {
    const dl = el('div', 'dateline every');
    dl.appendChild(button(ICON.left + ' Today’s feed', 'ghost sm back', () => { W.every = false; W.outlet = ''; app.paintSubnav(); render(); app.scrollTop(); }));
    dl.appendChild(el('span', 'dl', '<b>Unfiltered</b><span class="s">' + esc(D.copy.total) + ' today · ' + esc(D.copy.cadence) + ' · nothing picked</span>'));
    frag.appendChild(dl);
    const items = [{ key: '__search', label: 'Search', icon: ICON.search }, { key: '', label: 'All outlets' }]
      .concat(D.outlets.map((o) => ({ key: o.name, label: o.name, n: o.n, cls: o.local ? 'local' : '' })));
    frag.appendChild(chips(items, W.outlet, (k) => {
      if (k === '__search') { app.toast('Search every headline: comes with the real build'); return; }
      W.outlet = W.outlet === k ? '' : k; W.page = 30; app.paintSubnav(); render(); app.scrollTop();
    }, 'outlets'));
    return frag;
  }
  const d = D.days[W.day];
  const n = countDay(d);
  frag.appendChild(cardsDateline(d, n));
  const counts = Object.create(null);
  d.groups.forEach((g) => (g.items || []).forEach((it) => { if (visible(it)) counts[it.ch] = (counts[it.ch] || 0) + 1; }));
  picksFor(W.day).forEach((it) => { if (visible(it) && !isRiver(it.k)) counts[it.ch] = (counts[it.ch] || 0) + 1; });
  const items = D.channels.map((c) => ({ key: c.key, label: c.label, n: c.key === 'all' ? null : (counts[c.key] || 0) }))
    .concat([{ key: '__every', label: 'Unfiltered ↗', cls: 'every' }]);
  const band = el('div', 'toolband');
  band.appendChild(localSwitch(() => { W.more = false; app.paintSubnav(); render(); app.scrollTop(); }));
  band.appendChild(chips(items, W.ch, (k) => {
    if (k === '__every') { W.every = true; app.paintSubnav(); render(); app.scrollTop(); return; }
    W.ch = k; history.replaceState(null, '', location.search + '#wire/' + k); app.paintSubnav(); render(); app.scrollTop();
  }));
  frag.appendChild(band);
  return frag;
}
function cardsDateline(d, n) {
  const dl = el('div', 'dateline');
  const prev = el('button', 'iconbtn nav', ICON.left); prev.setAttribute('aria-label', 'Earlier day');
  const next = el('button', 'iconbtn nav', ICON.right); next.setAttribute('aria-label', 'Later day');
  prev.disabled = W.day >= D.days.length - 1; next.disabled = W.day === 0;
  prev.addEventListener('click', () => goDay(W.day + 1));
  next.addEventListener('click', () => goDay(W.day - 1));
  dl.append(prev, el('span', 'dl', '<b>' + esc(d.date) + '</b><span class="s">' + n + (d.final ? ' stories · final' : ' stories so far · updated ' + esc(d.updated)) + '</span>'), next);
  return dl;
}
function countDay(d) {
  if (d.final) return d.count;
  let n = 0;
  d.groups.forEach((g) => (g.items || []).forEach((it) => { if (visible(it)) n++; }));
  picksFor(W.day).forEach((it) => { if (visible(it) && !isRiver(it.k)) n++; });
  if (W.day === 0 && W.fresh) n += D.fresh.length;
  return n;
}
function goDay(i) { W.day = Math.max(0, Math.min(D.days.length - 1, i)); W.more = false; app.paintSubnav(); render(); app.scrollTop(); }

/* ------------------------------------------------------------- render */
export function render() {
  const root = W.root;
  if (!root || !D) return;
  root.innerHTML = '';
  if (W.every) { renderEvery(root); return; }
  const d = D.days[W.day];
  const feed = el('div', 'feed');
  root.appendChild(feed);
  let shown = 0;
  const picked = W.ch === 'all' ? pickedIds(W.day) : new Set();
  if (W.ch === 'all') renderMatters(feed, d);
  d.groups.forEach((g, gi) => {
    if (g.newline) { if (W.ch === 'all') feed.appendChild(cards.newline(g.newline)); return; }
    let items = g.items.filter((it) => visible(it) && !picked.has(it.k) && (W.ch === 'all' || it.ch === W.ch));
    const fresh = W.day === 0 && gi === 0 && W.fresh ? D.fresh.filter((it) => visible(it) && (W.ch === 'all' || it.ch === W.ch)) : [];
    if (!items.length && !fresh.length) return;
    divider(feed, g.label, g.sub);
    if (fresh.length) {
      fresh.forEach((it) => put(feed, cards.any(it, { tagLocal: greenOf(it), greenLocal: greenOf(it) })));
      feed.appendChild(cards.newline(fresh.length + ' new just now'));
    }
    items.forEach((it) => { put(feed, cards.any(it, { tagLocal: greenOf(it), greenLocal: greenOf(it) })); shown++; });
  });
  if (!shown) feed.appendChild(el('p', 'empty', 'Nothing from ' + esc(chLabel(W.ch)) + ' on this day.'));
  const later = W.day > 0 ? button(esc(W.day === 1 ? 'Today' : D.days[W.day - 1].short) + ' ' + ICON.arrow, '', () => goDay(W.day - 1)) : null;
  const earlier = W.day < D.days.length - 1 ? button(esc(D.days[W.day + 1].short) + '’s edition ' + ICON.arrow, W.day ? 'ghost' : '', () => goDay(W.day + 1)) : null;
  feed.appendChild(cards.caught(W.day === 0 ? {
    title: 'That’s today so far',
    text: 'New stories land through the day. The next check is at ' + D.copy.nextCheck + ', and anything new shows up above a line, never under your thumb.',
    buttons: [earlier, button('What now ' + ICON.arrow, 'ghost', () => app.go('whatnow')),
      button('All ' + esc(D.copy.total) + ' headlines ' + ICON.ext, 'ghost', () => { W.every = true; app.paintSubnav(); render(); app.scrollTop(); })],
    fine: 'Demo. Every item on this page is made up.',
  } : {
    title: 'That was ' + d.date.split(',')[0] + '.',
    text: d.count + ' stories. An edition is final at midnight and stays exactly as it was.',
    buttons: [later, earlier], check: false,
  }));
  app.bindFeed(feed, { onSource: sourceSheet });
}

/* The ranked picks. Number one gets the art; two to five are rows with a
   reason; the rest open on request. The river below leaves them out. */
function renderMatters(feed, d) {
  const picks = picksFor(W.day).filter(visible);
  if (!picks.length) return;
  const wm = el('div', 'wm');
  section(wm, W.day === 0 ? 'What matters today' : 'What mattered ' + d.date.split(',')[0], W.day === 0
    ? picks.length + ' picks from ' + esc(D.copy.total) + ' headlines, each with a reason. Picked at ' + esc(D.copy.pickedAt) + '; again at ' + esc(D.copy.pickedNext) + '.'
    : picks.length + ' picks, as they stood at midnight.');
  const first = picks[0];
  put(wm, cards.pick({ ...first, eyebrow: '1 of ' + picks.length }, { tagLocal: greenOf(first), greenLocal: greenOf(first) }));
  const top = picks.slice(1, 5), rest = picks.slice(5);
  top.forEach((it, i) => wm.appendChild(wmRow(it, i + 2)));
  if (rest.length) {
    if (W.more) {
      rest.forEach((it, i) => wm.appendChild(wmRow(it, i + 6)));
      wm.appendChild(el('p', 'wm-end', 'That’s the ' + picks.length + '. Everything else from the day is below.'));
    } else {
      wm.appendChild(button(rest.length + ' more pick' + (rest.length > 1 ? 's' : ''), 'ghost more', () => { W.more = true; render(); }));
    }
  }
  feed.appendChild(wm);
  divider(feed, W.day === 0 ? 'The rest of today' : 'The rest of the day', geo() === 'local' ? 'local only' : 'every source');
}

/* a ranked row: the numeral, the title, the reason, then the foot line */
export function wmRow(it, n) {
  const on = store.hasVoted(it.k);
  const r = el('article', 'wm-row card fi' + (store.isRead(it.k) ? ' is-read' : ''));
  r.dataset.k = it.k;
  const ext = /^https?:/.test(it.href || '');
  r.innerHTML = '<span class="num">' + n + '</span><div><a class="c-title" href="' + esc(it.href) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + ' data-open>' + esc(it.title || it.text) + '</a>' +
    (it.why ? '<p class="why">' + esc(it.why) + '</p>' : '') +
    '<div class="c-foot"><button class="srcbtn" data-src="' + esc(it.sid || it.src) + '">' + mark(it.src, 'xs') + '<span class="c-src' + (greenOf(it) ? ' is-local' : '') + '">' + esc(it.src) + '</span></button>' +
    (it.ago ? '<span class="dot"></span><span class="age">' + esc(it.ago) + '</span>' : '') +
    '<button class="mini up' + (on ? ' on' : '') + '" data-act="up" aria-label="Upvote" aria-pressed="' + on + '">' + ICON.up + '<span class="n">' + (((Number(it.votes) || 0) + store.voteCount(it.k)) || '') + '</span></button>' +
    '<button class="mini sh" data-act="share" aria-label="Share">' + ICON.share + '</button></div></div>' +
    '<button class="act star' + (store.isSaved(it.k) ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + store.isSaved(it.k) + '">' + ICON.star + '</button>';
  return r;
}

function renderEvery(root) {
  const feed = el('div', 'feed');
  root.appendChild(feed);
  const tools = el('div', 'toolrow');
  tools.appendChild(pills([['newest', 'Newest first'], ['bysrc', 'By outlet']], W.layout, (v) => { W.layout = v; render(); }));
  tools.appendChild(el('span', 'note', W.outlet ? 'Only ' + esc(W.outlet) : 'Every headline from every outlet, newest first. Nothing curated.'));
  feed.appendChild(tools);
  const list = D.every.filter((it) => visible(it) && (!W.outlet || it.src === W.outlet));
  if (W.layout === 'bysrc' && !W.outlet) {
    const by = new Map();
    list.forEach((it) => { if (!by.has(it.src)) by.set(it.src, []); if (by.get(it.src).length < 3) by.get(it.src).push(it); });
    const grid = el('div', 'srcgrid');
    by.forEach((items, src) => {
      const s = el('section', 'srcsec');
      s.innerHTML = '<h3><button class="srcbtn" data-src="' + esc(src) + '">' + mark(src, 'xs') + '<span>' + esc(src) + '</span></button><span class="n">' + esc(outletN(src, items.length)) + ' today</span></h3>';
      items.forEach((it) => put(s, cards.row(it)));
      grid.appendChild(s);
    });
    feed.appendChild(grid);
  } else {
    list.slice(0, W.page).forEach((it) => put(feed, cards.row(it, { greenLocal: true })));
    if (W.page < list.length) {
      feed.appendChild(button('Show ' + Math.min(30, list.length - W.page) + ' more', 'ghost more', () => { W.page += 30; render(); }));
    } else {
      feed.appendChild(cards.caught({ title: 'That’s ' + D.copy.rawSpan, text: 'The raw wire keeps the whole day; older than this lives on yesterday’s edition.',
        buttons: [button('Back to today’s feed', '', () => { W.every = false; app.paintSubnav(); render(); app.scrollTop(); })], check: false }));
    }
  }
  app.bindFeed(feed, { onSource: sourceSheet });
}

/* tap a source: what it is, today's items from it, follow, mute, open */
const KIND = { local: 'Local news', world: 'News', x: 'X', facebook: 'Facebook group, via Muse', reddit: 'Reddit', newsletters: 'Newsletter', video: 'Video' };
const OPEN = { x: 'Open on X', facebook: 'Open the post', reddit: 'Open the thread', newsletters: 'Open the newsletter' };
function sourceSheet(name) {
  const items = [];
  D.days.forEach((d) => d.groups.forEach((g) => (g.items || []).forEach((it) => { if (it.sid === name || it.author === name) items.push(it); })));
  D.every.forEach((it) => { if (it.sid === name && items.length < 12) items.push(it); });
  const first = items[0] || {};
  const openLabel = OPEN[first.ch] || 'Open the site';
  app.sheet(name, (body) => {
    body.appendChild(el('div', 'srchead', mark(name, first.author ? 'round xl' : 'xl') + '<div><div class="k">' + esc(KIND[first.ch] || 'Source') + (first.local ? ' · Local' : '') +
      '</div><div class="n">' + esc(outletN(name, items.length)) + ' today</div></div>'));
    const row = el('div', 'linkrow');
    const fol = button(follows.has(name) ? 'Following ✓' : 'Follow', follows.has(name) ? '' : 'ghost', () => {
      if (follows.has(name)) follows.delete(name); else follows.add(name);
      fol.textContent = follows.has(name) ? 'Following ✓' : 'Follow';
      fol.classList.toggle('ghost', !follows.has(name));
    });
    row.append(fol, button('Mute', 'ghost', () => app.mute(name, first)), button(esc(openLabel) + ' ' + ICON.ext, 'ghost', () => app.toast(openLabel + ' in the real build')));
    body.appendChild(row);
    body.appendChild(el('div', 'sheet-h', 'Recent from ' + esc(name)));
    const f = el('div', 'feed tight');
    items.slice(0, 8).forEach((it) => put(f, it.kind === 'headline' ? cards.row(it) : cards.any(it)));
    body.appendChild(f);
    app.bindFeed(f, { onSource() {} });
  });
}

/* ------------------------------------------------------------- module */
function land() {
  const p = W.pending;
  if (!p || !D) return;
  W.pending = null;
  if (p === 'local' || p === 'everything') { setGeo(p); W.every = false; app.paintSubnav(); render(); return; }
  if (D.channels.some((c) => c.key === p)) { W.ch = p; W.every = false; app.paintSubnav(); render(); return; }
  if (p === 'unfiltered') { W.every = true; app.paintSubnav(); render(); return; }
  if (!app.flashHit(W.root, p)) {
    /* not on today's page: look in the earlier editions and the raw wire */
    const day = D.days.findIndex((d) => d.groups.some((g) => (g.items || []).some((it) => it.k === p)));
    if (day > 0) { W.day = day; app.paintSubnav(); render(); app.flashHit(W.root, p); return; }
    if (D.every.some((it) => it.k === p)) { W.every = true; W.page = 60; app.paintSubnav(); render(); app.flashHit(W.root, p); return; }
    app.toast('That card has moved on. Here’s today’s feed.');
  }
}

export function mount(root) {
  W.root = root;
  root.innerHTML = '<p class="loading">Loading the wire…</p>';
  init().then(() => { render(); if (app.activeTab() === 'wire') app.paintSubnav(); land(); })
    .catch(() => { root.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b> Reload to try again.</div>'; });
}
export function activate(param) { if (param) { W.pending = param; land(); } }
export function refresh() { if (D) { app.paintSubnav(); render(); } }
export function deactivate() { app.closePeek(); }
export function newSince() { return D ? D.newSince || 0 : 0; }
export function pull() {
  if (!D || W.every || W.day !== 0 || W.fresh) return null;
  W.fresh = true; app.paintSubnav(); render();
  return D.fresh.length + ' new since you looked';
}
