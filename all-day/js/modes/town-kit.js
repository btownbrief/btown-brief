/* town-kit.js — what the Town app's five tabs share (wave 1 of the eight
   apps, 2026-10-29): Alerts, City Hall, Streets, Guides and Work. It is
   not a mode itself (main.js loads only modes/<tab key>.js); each of the
   five imports it and registers under its own key.

   A Town tab is a page of sections, one per top tab, in a fixed order:
   the order is the reader's job ("is it my recycling day, is there a
   ban"), so it does not reshuffle freshest first the way a feed does. The
   pill still dots a section with something newer than the last visit.

     townMode({ key, label, icon, promise, demo, load, sections })
       demo      the ?demo=1 file, data/demo/<demo>.json: invented data in
                 the same shape load() resolves, so one drawing path runs both
       load      () => Promise of the live data (the repo's data/ files)
       sections  [{ key, label, sub, draw(box, data, ctx), newest(data) }]
                 draw() appends into the section's box; newest() is the epoch
                 seconds of its newest thing, for the dot (optional)

   Live data that fails to load never leaves a blank: each section says so
   in a line. Every row carries a key and a link (rule 4), and in the demo a
   link to the outside world toasts instead of leaving, as cards do. */

import * as app from '../app.js';
import { el, esc, safeHref, ICON, section } from '../ui.js';
import { sectionBar } from '../sections.js';

const HOUR = 3600;
export const DAY = 86400;
const TZ = 'America/New_York';

/* ------------------------------------------------------------ dates */
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/* today in Burlington, '2026-10-29' */
export const today = () => ymd.format(new Date());
/* a day key n days from a day key */
export const plusDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10); };
/* a timestamp's Burlington day key */
export const dayOf = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? ymd.format(new Date(t)) : String(iso || '').slice(0, 10); };
const noon = (key) => new Date(key.slice(0, 10) + 'T12:00:00Z');
const F_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const F_MON = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });
const F_TIME = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const F_LONG = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const okKey = (k) => /^\d{4}-\d{2}-\d{2}/.test(String(k || ''));
/* 'Sun, Nov 1' */
export const fmtDay = (key) => (okKey(key) ? F_DAY.format(noon(key)) : '');
/* 'Monday, January 25, 2027' */
export const fmtLong = (key) => (okKey(key) ? F_LONG.format(noon(key)) : '');
/* '7:30 PM' in Burlington */
export const fmtTime = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? F_TIME.format(new Date(t)) : ''; };
/* epoch seconds of an ISO time or a day key (noon), or 0 */
export const epoch = (iso) => { const t = Date.parse(okKey(iso) && String(iso).length === 10 ? iso + 'T12:00:00Z' : iso); return Number.isFinite(t) ? Math.floor(t / 1000) : 0; };
/* '3h ago', 'yesterday', 'Oct 22' */
export function ago(iso) {
  const s = Math.floor(Date.now() / 1000) - epoch(iso);
  if (!epoch(iso)) return '';
  if (s < HOUR) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < DAY) return Math.round(s / HOUR) + 'h ago';
  const k = dayOf(iso);
  return k === plusDays(today(), -1) ? 'Yesterday' : fmtDay(k).replace(/^\w+, /, '');
}
/* days from today to a day key (negative: past) */
export const daysTo = (key) => Math.round((noon(key) - noon(today())) / (DAY * 1000));
/* '$6.4M', '$426K': a sum short enough for a stat box at 390 */
export const shortMoney = (n) => { const v = Number(n); if (!Number.isFinite(v) || n === null) return ''; return v >= 1e6 ? '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e4 ? '$' + Math.round(v / 1e3) + 'K' : money(v); };
export const money = (n) => (Number.isFinite(Number(n)) && n !== null ? '$' + Math.round(Number(n)).toLocaleString('en-US') : '');

/* ------------------------------------------------------------ data */
/* a repo data file, as the reader's browser sees it from any app folder */
export function getJSON(url) {
  return fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.json(); });
}
/* a file one section needs and the rest can do without: a failure comes
   back as { failed: true }, so that section says so instead of "nothing" */
export const maybeJSON = (url) => getJSON(url).catch((e) => { console.warn('[town] ' + e.message); return { failed: true }; });
export const NOT_LOADED = 'Didn’t load. Pull down to try again.';

/* ------------------------------------------------------------ drawing */
/* a date tile: the day's number over its month */
export const tile = (key) => (okKey(key) ? '<span class="th tm"><b>' + Number(key.slice(8, 10)) + '</b><span>' + esc(F_MON.format(noon(key))) + '</span></span>' : '<span class="th bare"></span>');
const isOut = (href) => /^https?:/.test(href || '');

/* One list row: an optional date tile, a linked title, a grey line, a
   status chip. `tag` is [words, 'local' | 'left' | 'live']. */
export function row(o) {
  /* .meet is the shell's date-tile row (the day over its month) */
  const r = el('div', 'lrow' + (o.date !== undefined ? ' meet' : ''));
  r.dataset.k = o.k;
  const out = isOut(o.href);
  r.innerHTML = (o.date !== undefined ? tile(o.date) : o.icon ? '<span class="th bare">' + o.icon + '</span>' : '<span></span>') +
    '<div><a class="t" href="' + esc(safeHref(o.href)) + '"' + (out ? ' target="_blank" rel="noopener"' : '') + '>' + esc(o.title) + '</a>' +
    (o.sub ? '<p class="s">' + o.sub + '</p>' : '') + '</div>' +
    (o.tag ? '<span class="tag tag-' + esc(o.tag[1] || 'left') + '">' + esc(o.tag[0]) + '</span>' : '<span></span>');
  return r;
}

/* a card of words: a heading, paragraphs (trusted markup: esc() what you
   pass in), buttons, and a fine-print line */
export function card(host, o) {
  const c = el('div', 'textcard gap');
  if (o.k) c.dataset.k = o.k;
  c.innerHTML = (o.title ? '<h3' + (o.serif ? ' class="serif"' : '') + '>' + esc(o.title) + '</h3>' : '') + (o.paras || []).map((p) => '<p>' + p + '</p>').join('');
  if (o.links && o.links.length) c.appendChild(links(o.links, true));
  if (o.fine) c.appendChild(el('p', 'fine', o.fine));
  host.appendChild(c);
  return c;
}

/* buttons that are links: [{ label, href, primary }] */
export function links(list, inCard) {
  const r = el('div', inCard ? 'row' : 'linkrow todaylinks');
  list.filter((l) => l && l.href).forEach((l) => {
    const a = el('a', 'btn sm' + (l.primary ? '' : ' ghost'), esc(l.label) + (isOut(l.href) ? ' ' + ICON.ext : ''));
    a.href = safeHref(l.href);
    if (isOut(l.href)) { a.target = '_blank'; a.rel = 'noopener'; }
    r.appendChild(a);
  });
  return r;
}

/* three numbers in boxes: [[big, small], …] */
export function stats(host, list) {
  const s = el('div', 'stat');
  s.innerHTML = list.map(([b, t]) => '<div><b>' + esc(b) + '</b><span>' + esc(t) + '</span></div>').join('');
  host.appendChild(s);
  return s;
}

/* a grey line in a section: what is true, said plainly */
export const line = (host, text) => host.appendChild(el('p', 'note pad', esc(text)));

/* rows, the first n showing and the rest behind "Show all" */
export function list(host, rows, n) {
  const box = el('div', 'plist');
  rows.forEach((r, i) => { if (i >= n) r.hidden = true; box.appendChild(r); });
  host.appendChild(box);
  if (rows.length > n) {
    const b = el('button', 'btn ghost more', esc('Show all ' + rows.length));
    b.addEventListener('click', () => { rows.forEach((r) => { r.hidden = false; }); b.remove(); const a = rows[n] && rows[n].querySelector('a'); if (a) a.focus(); });
    host.appendChild(b);
  }
  return box;
}

/* A form that writes nowhere yet: its fields, a button, and on submit an
   honest line that nothing was sent. fields: [{ name, label, type, options, placeholder }] */
export function quietForm(host, o) {
  const f = el('form', 'bform textcard gap');
  f.dataset.k = o.k;
  f.innerHTML = (o.title ? '<h3>' + esc(o.title) + '</h3>' : '') + (o.intro ? '<p>' + esc(o.intro) + '</p>' : '');
  o.fields.forEach((fd) => {
    const r = el('label', 'bf-row');
    r.appendChild(el('span', 'bf-label', esc(fd.label)));
    let i;
    if (fd.type === 'select') {
      i = el('select', 'field bf-in');
      i.innerHTML = fd.options.map((x) => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('');
    } else {
      i = el('input', 'field bf-in');
      i.type = fd.type || 'text';
    }
    i.name = fd.name;
    if (fd.placeholder) i.placeholder = fd.placeholder;
    r.appendChild(i);
    f.appendChild(r);
  });
  const go = el('div', 'bf-go');
  go.appendChild(el('button', 'btn', esc(o.button || 'Send')));
  f.appendChild(go);
  const said = el('p', 'bf-note', esc(o.after));
  said.hidden = true;
  f.appendChild(said);
  f.addEventListener('submit', (e) => { e.preventDefault(); said.hidden = false; app.toast('Not sent'); });
  host.appendChild(f);
  return f;
}

/* ------------------------------------------------------------ the mode */
/* The demo files are static, so their dates are written relative to now
   and filled in here: "@d+3" is the Burlington day three days out,
   "@t-5h" and "@t-2d" are times that long ago, and "@m+3T18:00" is a
   meeting's wall time on that day, in civic.json's own form. */
const REL = /^@(d|t|m)([+-]\d+)(h|d)?(?:T(\d\d:\d\d))?$/;
export function redate(v) {
  if (Array.isArray(v)) return v.map(redate);
  if (v && typeof v === 'object') { const o = {}; Object.entries(v).forEach(([k, x]) => { o[k] = redate(x); }); return o; }
  const m = typeof v === 'string' && v.match(REL);
  if (!m) return v;
  const n = Number(m[2]);
  if (m[1] === 'd') return plusDays(today(), n);
  if (m[1] === 'm') return plusDays(today(), n) + 'T' + (m[4] || '18:00') + ':00Z';
  return new Date(Date.now() + n * (m[3] === 'd' ? DAY : HOUR) * 1000).toISOString();
}

export function townMode(spec) {
  const S = { root: null, data: null, failed: false, slots: null, pending: null, ready: false, loading: null };
  const now = () => Math.floor(Date.now() / 1000);

  function load() {
    if (!S.loading) {
      const p = app.demo ? app.demoJSON('data/demo/' + spec.demo + '.json').then(redate) : spec.load();
      S.loading = p.then((d) => { S.data = d; }, (e) => { console.warn('[town] ' + spec.key + ': ' + (e && e.message)); S.failed = true; S.data = null; })
        .then(() => { S.ready = true; app.recount(); });
    }
    return S.loading;
  }

  const ctx = { get demo() { return app.demo; }, root: () => S.root, redraw: () => draw() };

  function draw() {
    const root = S.root;
    root.innerHTML = '';
    S.slots = Object.create(null);
    const feed = el('div', 'shelf feed');
    spec.sections.forEach((sec) => {
      const box = el('section', 'shelf-sec');
      box.dataset.sec = sec.key;
      section(box, sec.label, sec.sub ? esc(sec.sub) : null);
      if (!S.data) line(box, NOT_LOADED);
      else {
        try { sec.draw(box, S.data, ctx); } catch (e) {
          console.warn('[town] ' + spec.key + '/' + sec.key + ': ' + (e && e.message));
          line(box, 'This part didn’t draw. The rest of the tab is fine.');
        }
      }
      feed.appendChild(box);
      S.slots[sec.key] = box;
    });
    root.appendChild(feed);
    root.appendChild(el('div', 'spacer'));
    if (app.activeTab() === spec.key) app.paintSubnav();
  }

  function land() {
    const want = S.pending;
    if (!want || !S.ready || !S.slots) return;
    S.pending = null;
    if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
    if (!app.flashHit(S.root, want)) app.toast('That’s gone from ' + spec.label + ' now.');
  }

  setTimeout(load, 0);

  return {
    label: spec.label,
    icon: ICON[spec.icon] || ICON.more,
    promise: spec.promise,
    mount(root) {
      S.root = root;
      app.bindFeed(root);
      /* the demo's links to the outside world say where they go instead */
      root.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (!a || !app.demo || !/^https?:/.test(a.getAttribute('href')) || e.defaultPrevented) return;
        e.preventDefault();
        app.toast('Opens the source in the real build');
      });
      root.appendChild(el('p', 'loading', esc('Loading ' + spec.label + '…')));
      load().then(() => { draw(); land(); });
    },
    activate(param) { S.pending = param || null; land(); },
    refresh() { if (S.ready) draw(); },
    deactivate() {},
    pull() {
      if (app.demo) return null;
      S.loading = null; S.ready = false; S.failed = false;
      load().then(() => { if (S.root) draw(); });
      return null;
    },
    subnav() {
      if (!S.slots) return null;
      return sectionBar({ key: 'sec-town-' + spec.key, title: spec.label, color: '--app-town-pop',
        find: (k) => S.slots && S.slots[k], onPick: (k) => app.jumpTo(S.slots && S.slots[k]),
        items: spec.sections.map((s) => ({ key: s.key, label: s.label, newest: S.data && s.newest ? s.newest(S.data) || 0 : 0 })) });
    },
    keepSubnav: true,
    newSince(ts) {
      if (!S.data) return 0;
      const base = Number(ts) || now() - 4 * HOUR;
      return spec.sections.filter((s) => s.newest && (s.newest(S.data) || 0) > base).length;
    },
  };
}
