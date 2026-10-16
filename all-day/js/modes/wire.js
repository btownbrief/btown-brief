/* The Wire. TEMPORARY: Stage 2 replaces this file.

   Until the curated river exists (Stage 1's wire-today.json), the live Wire
   draws the feed the app already has, pulse.json and pulse-top.json through
   js/wire.js, with the new shell's rows and cards, so the shell can be used
   and tested end to end:

   - the dateline (the newest day in the payload, its count, when it was
     built), ‹ › to yesterday and back; two days, then the feed says so
   - the Local / Everything switch (the shell's, shared with On Air) and
     chips by kind of source, counted (only kinds the payload has)
   - What matters today: pulse-top's ranked picks with their reasons, number
     one as the pick card, two to five as ranked rows, the rest on request
   - the river: the rest of the day, newest first, under time dividers, with
     the "N new since you were here" line, sixty rows at a time
   - the caught-up card, the source sheet, swipe to save or mute, hold to peek

   Under ?demo=1 the Wire is the prototype's, from wire-demo.js. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as demo from './wire-demo.js';
import { el, esc, safeHref, ICON, mark, cards, chips, button, divider, section, localSwitch, geo, setGeo, agoShort, put } from '../ui.js';

const PAGE = 60;
const DAYS_KEPT = 2;
const PICKS_SHOWN = 10;

const L = { root: null, pulse: null, top: null, srcs: Object.create(null), day: 0, ch: 'all', page: PAGE, more: false,
  pending: null, queued: null, stale: false, failed: false, topDone: false };

/* ------------------------------------------------------------ the items */
const isLocal = (src) => !!src && (src.local === 1 || src.topic === 'local');
const keyOf = (it) => it.u || it.o || it.t;
/* A kind of source, from what pulse.json already says about it. X and
   Facebook arrive with Stage 1's inbox reader; until then they never show. */
function kindOf(src) {
  if (!src) return 'news';
  const site = String(src.site || '');
  if (src.ch) return src.ch;
  if (/reddit\.com/.test(site) || /^r\//.test(src.short || '')) return 'reddit';
  if (/youtube\.com|youtu\.be/.test(site)) return 'video';
  if (src.topic === 'newsletters') return 'newsletters';
  return 'news';
}
const KINDS = [['all', 'All'], ['x', 'X'], ['facebook', 'Facebook'], ['reddit', 'Reddit'], ['newsletters', 'Newsletters'], ['video', 'Video']];

/* Outlets that publish twice (Seven Days' wire and its email edition) name
   their main feed in "og"; a mute covers both, as in Settings before. */
const canon = (sid) => { const s = L.srcs[sid]; return s && s.og && L.srcs[s.og] ? s.og : sid; };
const kin = (sid) => Object.keys(L.srcs).filter((id) => canon(id) === sid);

function toItem(it) {
  const src = L.srcs[it.s];
  if (!src || !it.u || !it.t) return null;
  return {
    k: keyOf(it), kind: 'headline', title: it.t, href: it.u, d: Number(it.d) || 0,
    src: src.short || src.name || it.s, sid: canon(it.s), local: isLocal(src), ch: kindOf(src),
    thumb: it.i || '', ago: it.d ? agoShort(it.d) : '', day: it.d ? et(it.d).key : '', h: it.d ? et(it.d).h : 0,
  };
}

/* mutes, read once per draw rather than once per row: a muted feed hides its
   whole outlet, because items carry the outlet's main id */
let MUTE = Object.create(null);
function loadMutes() {
  MUTE = Object.create(null);
  Object.keys(store.muted()).forEach((id) => { MUTE[id] = 1; MUTE[canon(id)] = 1; });
}
const visible = (it) => !MUTE[it.sid] && (geo() === 'everything' || it.local);
/* Burlington's clock, not the reader's: a day and a time of day are always
   America/New_York, so a reader in another timezone sees the same paper and
   daylight-saving days are as long as they really are. */
const TZ = 'America/New_York';
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
function et(sec) {
  const o = {};
  partsFmt.formatToParts(new Date(sec * 1000)).forEach((p) => { o[p.type] = p.value; });
  return { key: o.year + '-' + o.month + '-' + o.day, h: Number(o.hour) % 24 };
}
const clock = (sec) => timeFmt.format(new Date(sec * 1000)).replace(/\s+/g, ' ').toLowerCase();

/* The days the payload holds, newest first: [{ start, items }] */
let DAYS = [];
function build() {
  L.srcs = Object.create(null);
  (L.pulse.sources || []).forEach((s) => { if (s && s.id) L.srcs[s.id] = s; });
  const all = (L.pulse.items || []).map(toItem).filter(Boolean).sort((a, b) => b.d - a.d);
  const seen = new Set();
  const uniq = all.filter((it) => (seen.has(it.k) ? false : (seen.add(it.k), true)));
  app.know(uniq);
  DAYS = [];
  if (!uniq.length) return;
  /* the newest Burlington days the payload holds, newest first */
  const byDay = new Map();
  uniq.forEach((it) => { if (!byDay.has(it.day)) byDay.set(it.day, []); byDay.get(it.day).push(it); });
  [...byDay.keys()].slice(0, DAYS_KEPT).forEach((key) => {
    const items = byDay.get(key);
    DAYS.push({ key, name: dayFmt.format(new Date(items[0].d * 1000)), items });
  });
}

/* pulse-top's ranked picks, as cards can draw them, with a thumbnail when
   the wire has one for the same story */
function picks() {
  const list = (L.top && Array.isArray(L.top.picks) ? L.top.picks : []).map((p) => {
    const base = app.item(p.u);
    const it = {
      k: p.u, kind: 'headline', title: p.t, href: p.u, why: p.why || '', d: Number(p.d) || 0,
      src: p.short || (L.srcs[p.s] && (L.srcs[p.s].short || L.srcs[p.s].name)) || '', sid: canon(p.s), local: p.local === 1,
      ch: kindOf(L.srcs[p.s]), ago: p.d ? agoShort(p.d) : '', thumb: (base && base.thumb) || '',
    };
    return it;
  }).filter((it) => it.href && it.title);
  app.know(list);
  return list;
}

/* ----------------------------------------------------------------- dates */
const isToday = (day) => day.key === et(Date.now() / 1000).key;
function stamp() {
  const g = L.pulse && Date.parse(L.pulse.generated);
  return g ? clock(g / 1000) : '';
}
function slot(h) {
  if (h >= 21) return 'Late';
  if (h >= 17) return 'Evening';
  if (h >= 13) return 'Afternoon';
  if (h >= 11) return 'Midday';
  if (h >= 5) return 'Morning';
  return 'Overnight';
}

/* ---------------------------------------------------------------- subnav */
function subnav() {
  if (!L.pulse || !DAYS.length) return null;
  loadMutes();
  const frag = document.createDocumentFragment();
  const day = DAYS[L.day];
  const n = day.items.filter(visible).length;
  const today = isToday(day);
  const dl = el('div', 'dateline');
  const prev = el('button', 'iconbtn nav', ICON.left); prev.setAttribute('aria-label', 'Earlier day');
  const next = el('button', 'iconbtn nav', ICON.right); next.setAttribute('aria-label', 'Later day');
  prev.disabled = L.day >= DAYS.length - 1; next.disabled = L.day === 0;
  prev.addEventListener('click', () => goDay(L.day + 1));
  next.addEventListener('click', () => goDay(L.day - 1));
  const sub = L.day > 0 ? n + ' stories · final'
    : n + (today ? ' stories so far' : ' stories') + (stamp() ? ' · updated ' + stamp() : '') + (L.stale ? ' · reconnecting' : '');
  dl.append(prev, el('span', 'dl', '<b>' + esc(day.name) + '</b><span class="s">' + esc(sub) + '</span>'), next);
  frag.appendChild(dl);

  const counts = Object.create(null);
  day.items.forEach((it) => { if (visible(it)) counts[it.ch] = (counts[it.ch] || 0) + 1; });
  const items = KINDS.filter(([k]) => k === 'all' || counts[k] || k === L.ch).map(([key, label]) => ({ key, label, n: key === 'all' ? null : (counts[key] || 0) }));
  const band = el('div', 'toolband');
  band.appendChild(localSwitch(() => { L.more = false; L.page = PAGE; app.paintSubnav(); render(); app.scrollTop(); }));
  band.appendChild(chips(items, L.ch, (k) => {
    L.ch = k; L.page = PAGE;
    history.replaceState(null, '', location.search + '#wire' + (k === 'all' ? '' : '/' + k));
    app.paintSubnav(); render(); app.scrollTop();
  }));
  frag.appendChild(band);
  return frag;
}
function goDay(i) { L.day = Math.max(0, Math.min(DAYS.length - 1, i)); L.page = PAGE; L.more = false; app.paintSubnav(); render(); app.scrollTop(); }

/* ---------------------------------------------------------------- render */
function render() {
  const root = L.root;
  if (!root) return;
  if (L.failed && !L.pulse) {
    root.innerHTML = '<div class="errbox"><b>Couldn’t reach the wire.</b><br>The feed is served from GitHub. If you are offline it will come back on its own.</div>';
    return;
  }
  if (!L.pulse) { root.innerHTML = '<p class="loading">Loading the wire…</p>'; return; }
  loadMutes();
  root.innerHTML = '';
  const feed = el('div', 'feed');
  root.appendChild(feed);
  if (!DAYS.length) { feed.appendChild(el('p', 'empty', 'Nothing on the wire right now.')); return; }

  const day = DAYS[L.day];
  const green = geo() === 'everything';
  const shownPicks = L.day === 0 && L.ch === 'all' ? renderMatters(feed) : new Set();
  const river = day.items.filter((it) => visible(it) && !shownPicks.has(it.k) && (L.ch === 'all' || it.ch === L.ch));
  if (shownPicks.size) divider(feed, 'The rest of ' + (isToday(day) ? 'today' : 'the day'), geo() === 'local' ? 'local only' : 'every source');

  /* new since you were here: the line sits under the newest unseen item */
  const base = store.visitBase();
  const fresh = L.day === 0 && base ? river.filter((it) => it.d > base).length : 0;
  let lastSlot = null;
  river.slice(0, L.page).forEach((it, i) => {
    const s = slot(it.h);
    if (s !== lastSlot) { divider(feed, s, 'latest ' + clock(it.d)); lastSlot = s; }
    put(feed, cards.row(it, { greenLocal: green && it.local, noComments: true }));
    if (fresh && fresh < river.length && i === fresh - 1) {
      feed.appendChild(cards.newline(fresh + ' new since you were here at ' + clock(base)));
    }
  });
  if (!river.length) feed.appendChild(el('p', 'empty', L.ch === 'all' ? 'Nothing local on this day yet. Flip the switch to Everything for the rest.' : 'Nothing from ' + esc(label(L.ch)) + ' on this day.'));

  if (L.page < river.length) {
    feed.appendChild(button('Show ' + Math.min(PAGE, river.length - L.page) + ' more from ' + (L.day ? 'that day' : 'today'), 'ghost more', () => { L.page += PAGE; render(); }));
  } else if (L.day === 0 && DAYS.length > 1) {
    feed.appendChild(cards.caught({
      title: isToday(day) ? 'That’s today so far' : 'That’s the latest edition',
      text: 'New stories land through the day, above a line, never under your thumb.' + (stamp() ? ' Last updated ' + stamp() + '.' : ''),
      buttons: [button('Yesterday’s edition ' + ICON.arrow, '', () => goDay(1)), button('What now ' + ICON.arrow, 'ghost', () => app.go('whatnow'))],
    }));
  } else {
    feed.appendChild(cards.caught({
      title: 'That’s everything. Really.',
      text: 'All Day keeps two days, not an endless scroll.',
      buttons: [button('Back to today', '', () => goDay(0))], check: false,
    }));
  }
  app.bindFeed(feed, { onSource: sourceSheet, onMute: muteSource });
  hydrateVotes(feed);
}
const label = (k) => (KINDS.find((x) => x[0] === k) || ['', ''])[1];

/* What matters today: number one as the pick card, two to five as ranked
   rows, six to ten on request. Returns the keys it drew so the river can
   leave them out. */
function renderMatters(feed) {
  const list = picks().filter(visible).slice(0, PICKS_SHOWN);
  if (!list.length) return new Set();
  const wm = el('div', 'wm');
  const built = L.top && Date.parse(L.top.generated);
  section(wm, 'What matters today', list.length + ' picks from the whole wire, each with a reason.' + (built ? ' Picked at ' + esc(clock(built / 1000)) + '.' : ''));
  const first = list[0];
  put(wm, cards.pick({ ...first, media: first.thumb, thumb: '', eyebrow: '1 of ' + list.length }, { tagLocal: geo() === 'everything' && first.local }));
  list.slice(1, 5).forEach((it, i) => wm.appendChild(demo.wmRow(it, i + 2)));
  const rest = list.slice(5);
  if (rest.length) {
    if (L.more) {
      rest.forEach((it, i) => wm.appendChild(demo.wmRow(it, i + 6)));
      wm.appendChild(el('p', 'wm-end', 'That’s the ' + list.length + '. Everything else from the day is below.'));
    } else {
      wm.appendChild(button(rest.length + ' more pick' + (rest.length > 1 ? 's' : ''), 'ghost more', () => { L.more = true; render(); }));
    }
  }
  feed.appendChild(wm);
  return new Set((L.more ? list : list.slice(0, 5)).map((it) => it.k));
}

/* One request for the screenful's vote counts; paint them when they land. */
function hydrateVotes(feed) {
  const keys = [...feed.querySelectorAll('[data-k]')].map((n) => n.dataset.k);
  store.loadVotes(keys).then((ok) => {
    if (!ok) return;
    feed.querySelectorAll('[data-k]').forEach((n) => {
      const c = n.querySelector('[data-act="up"] .n');
      if (c) c.textContent = store.voteCount(n.dataset.k) || '';
    });
  });
}

function muteSource(sid, it) {
  const name = (it && it.src) || sid;
  app.confirmBox({
    title: 'Mute ' + name + '?',
    body: 'You won’t see ' + name + ' anywhere in All Day, or on the Pulse page. Bring it back any time in Settings.',
    yes: 'Mute',
    onYes() {
      kin(sid).concat(sid).forEach((id) => store.setMuted(id, true));
      app.refresh();
      app.toast('Muted ' + name, () => { kin(sid).concat(sid).forEach((id) => store.setMuted(id, false)); app.refresh(); });
    },
  });
}

/* tap a source: what it is, its items today, mute, open the site */
function sourceSheet(sid, from) {
  const src = L.srcs[sid] || {};
  const name = (from && from.src) || src.short || src.name || sid;
  const items = DAYS.length ? DAYS[0].items.filter((it) => it.sid === sid) : [];
  app.sheet(name, (body) => {
    body.appendChild(el('div', 'srchead', mark(name, 'xl') + '<div><div class="k">' + esc(isLocal(src) ? 'Local news' : (src.topic ? src.topic[0].toUpperCase() + src.topic.slice(1) : 'Source')) +
      '</div><div class="n">' + items.length + ' today</div></div>'));
    const row = el('div', 'linkrow');
    row.appendChild(button('Mute', 'ghost', () => muteSource(sid, from || { src: name })));
    if (/^https?:/.test(safeHref(src.site))) {
      const a = el('a', 'btn ghost', 'Open the site ' + ICON.ext);
      a.href = safeHref(src.site); a.target = '_blank'; a.rel = 'noopener';
      row.appendChild(a);
    }
    body.appendChild(row);
    if (items.length) {
      body.appendChild(el('div', 'sheet-h', 'Today from ' + esc(name)));
      const f = el('div', 'feed tight');
      items.slice(0, 12).forEach((it) => put(f, cards.row(it, { noComments: true })));
      body.appendChild(f);
      app.bindFeed(f, { onSource() {}, onMute: muteSource });
    }
  });
}

/* ------------------------------------------------------------ deep links */
/* waits for both payloads: picks arriving after a landing would redraw the
   page and lose the card it just scrolled to */
function land() {
  const p = L.pending;
  if (!p || !L.pulse || !L.topDone) return;
  L.pending = null;
  if (p === 'local' || p === 'everything') { setGeo(p); app.paintSubnav(); render(); return; }
  if (KINDS.some(([k]) => k === p)) { L.ch = p; L.page = PAGE; app.paintSubnav(); render(); return; }
  loadMutes();
  if (app.flashHit(L.root, p)) return;
  /* a shared card further down the day, on yesterday's page, or hidden by
     the Local switch (a link shared from Everything to a Local reader) */
  const it = app.item(p);
  if (it && MUTE[it.sid]) { app.toast('That card is from ' + it.src + ', which you muted. Unmute it in Settings.'); return; }
  if (it && !it.local && geo() === 'local') { setGeo('everything'); loadMutes(); }
  for (let d = 0; d < DAYS.length; d++) {
    const idx = DAYS[d].items.filter(visible).findIndex((x) => x.k === p);
    if (idx < 0) continue;
    L.day = d; L.ch = 'all'; L.page = Math.max(PAGE, Math.ceil((idx + 1) / PAGE) * PAGE);
    app.paintSubnav(); render();
    if (app.flashHit(L.root, p)) return;
  }
  app.toast('That card has moved on. Here’s today’s feed.');
}

/* ------------------------------------------------------------- the live tab */
const live = {
  mount(root) {
    L.root = root;
    render();
    /* a fresh payload never lands under a reader: at the top it applies,
       further down it waits for a pull or a tap on the tab */
    data.setFreshGate((apply) => {
      const p = root.closest('.panel');
      if (app.activeTab() !== 'wire' || !p || p.scrollTop < 120) apply();
      else { L.queued = apply; app.toast('New stories on the Wire. Pull down or tap Wire to see them.'); }
    });
    data.setStaleHandler((s) => { if (L.stale !== s) { L.stale = s; if (app.activeTab() === 'wire') app.paintSubnav(); } });
    data.load('pulse', (j) => {
      L.pulse = j; build(); render();
      if (app.activeTab() === 'wire') app.paintSubnav();
      land();
      app.recount();
    }, () => { L.failed = true; render(); });
    data.load('top', (j) => { L.top = j; L.topDone = true; if (L.pulse) { render(); land(); } }, () => { L.topDone = true; land(); });
  },
  activate(param) { if (param) { L.pending = param; land(); } },
  refresh() { if (L.pulse) { build(); app.paintSubnav(); render(); } },
  deactivate() { app.closePeek(); },
  subnav,
  newSince(ts) { loadMutes(); return DAYS.length ? DAYS[0].items.filter((it) => visible(it) && it.d > ts).length : 0; },
  pull() {
    if (L.queued) { const q = L.queued; L.queued = null; q(); return 'Fresh stories are in'; }
    return null;
  },
};

if (app.demo) demo.init();
const impl = app.demo ? demo : live;

app.register('wire', {
  label: 'Wire',
  icon: ICON.wire,
  promise: 'Today’s Burlington news, picked from everything that arrived, with a reason on the ones that matter.',
  mount: (root) => impl.mount(root),
  activate: (param, first) => impl.activate(param, first),
  refresh: () => impl.refresh(),
  deactivate: () => impl.deactivate(),
  subnav: () => impl.subnav(),
  newSince: (ts) => impl.newSince(ts),
  pull: () => impl.pull(),
});
