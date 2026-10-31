/* sections.js — the floating section pill every tab but the Wire wears
   under the mast (Stephen, 2026-10-19: "I want all the tabs with the
   bubble/buttons at the top of each to have that cool animated liquid
   effect, with different colors ... Make sure they're floating too like
   the Wire. But probably smaller, because it's less important than News,
   Photos, Square, and because it has more text to fit").

   A compact glass pill: the tab's sections (or its views) as segments, the
   one you are on in poured water in the tab's own colour (liquid.js). It
   floats under the mast and stays as you scroll, settling a little smaller
   on the way down as the Wire's does (the shell's keepSubnav and
   pill-small). On a tab of sections it follows the scroll: as you read
   past a section the water pours to the next ("when you scroll down to the
   next section, the toggle up top also auto switches"), and a tap scrolls
   to that section. When the segments run past the edge the pill scrolls
   sideways inside itself, keeps the one you are on in view, and an "All"
   button at its end lists every section in a sheet, so no one has to
   scroll sideways to find one.

     pill({ key, title, items, current, color, onPick, find })
       key      the water's name, one per pill
       title    the tab's name: the group's label and the All sheet's title
       items    [{ key, label, n, icon }] in page order
       current  the segment on; a view switch says which, a tab of
                sections leaves it out and the scroll decides
       color    the water's colour token, e.g. '--liq-food' (its -ink
                partner colours the word on it)
       onPick   (key) => the tab's own jump or view change
       find     (key) => that section's node, so the pill can follow the
                scroll; left out on a view switch

   The segments are buttons with the shared chip markup (data-chip, the
   label, an optional count), so a tab reads and is tested the same way.

   Top tabs (2026-10-29). The pill is each bottom
   tab's row of top tabs, under the mast on every tab and still there as
   you scroll (the shell keeps any tab's .secbar when the mast steps away).
   Three shell rules any tab can use:

     fresh    true: freshest first. Each item carries `newest` (epoch
              seconds, the time of its section's newest thing); the pill
              sorts by it, newest first (items without one keep their order
              after the dated ones), and with `find` the page's sections
              are moved into the same order, so the section with the
              newest thing leads the tab. Food has done this by hand since
              2026-10-18 and still does; this is that rule for everyone.
     newest   on any item, fresh or not: a dot on the segment when it is
              newer than the reader's last visit to this app.
     world    'irl' | 'online' on an item: on a tab that mixes the two
              (Real life / Online, ui.js worldSwitch) the pill leaves out
              the side that is not showing, as the page does. */

import { el, esc, ICON } from './ui.js';
import { liquify } from './liquid.js';
import * as store from './store.js';

/* the reader's last visit to this app, as epoch seconds (0: a first visit,
   when nothing is "new"). The demo pretends it was four hours ago. */
export const since = () => (store.isDemo() ? Math.floor(Date.now() / 1000) - 4 * 3600 : store.visitBase());
const isNew = (it) => { const s = since(); return s > 0 && Number(it.newest) > s; };
/* freshest first: dated items newest first, then the rest in their order */
export function freshOrder(items) {
  return items.map((it, i) => [it, i]).sort((a, b) => {
    const ta = Number(a[0].newest) || 0, tb = Number(b[0].newest) || 0;
    if (ta && tb && ta !== tb) return tb - ta;
    if (!ta !== !tb) return ta ? -1 : 1;
    return a[1] - b[1];
  }).map((x) => x[0]);
}
/* Put the page's sections in the pill's order, moving only those out of
   place (a form a reader is typing in is never redrawn, only moved when it
   must be). Sections that do not share one parent are left where they are. */
export function placeSections(keys, find) {
  const nodes = keys.map((k) => find(k)).filter((n) => n && n.isConnected);
  if (nodes.length < 2) return false;
  const parent = nodes[0].parentNode;
  if (!nodes.every((n) => n.parentNode === parent)) return false;
  let moved = false;
  nodes.forEach((n, i) => {
    const at = [...parent.children].filter((c) => nodes.includes(c))[i];
    if (at !== n) { parent.insertBefore(n, at); moved = true; }
  });
  return moved;
}

let shell = { sheet: null };
/* the shell hands over its sheet (app.js owns sheets) */
export function bindShell(s) { shell = { ...shell, ...s }; }

const STATE = new WeakMap();
const lastOn = Object.create(null);   // the segment on, per pill, across rebuilds
const locks = Object.create(null);    // a tap's scroll in flight, per pill: the water waits for it
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function pill(o) {
  const side = document.body.dataset.world;
  let items = (o.items || []).filter((it) => it && it.key != null && !(side && it.world && it.world !== side));
  if (o.fresh) items = freshOrder(items);
  if (!items.length) return null;
  if (o.fresh && typeof o.find === 'function') placeSections(items.map((it) => String(it.key)), o.find);
  const P = { key: o.key, title: o.title || 'Sections', items, keys: items.map((it) => String(it.key)), colors: items.map(() => o.color),
    onPick: o.onPick || (() => {}), find: typeof o.find === 'function' ? o.find : null, on: null };
  const wrap = el('div', 'secpill');
  wrap.dataset.pill = P.key;
  if (o.color) { wrap.style.setProperty('--secpill-water', 'var(' + o.color + ')'); wrap.style.setProperty('--secpill-ink', 'var(' + o.color + '-ink)'); }
  const scroller = el('div', 'secpill-scroll');
  const track = el('div', 'secpill-track');
  track.setAttribute('role', 'group');
  track.setAttribute('aria-label', P.title + (P.find ? ' sections' : ''));
  items.forEach((it) => {
    const n = it.n != null && it.n !== '' ? '<span class="n">' + esc(it.n) + '</span>' : '';
    const dot = isNew(it) ? '<i class="nd" aria-label="New"></i>' : '';
    const b = el('button', 'chip', (it.icon || '') + '<span>' + esc(it.label) + '</span>' + n + dot);
    b.type = 'button';
    b.dataset.chip = String(it.key);
    if (dot) b.dataset.new = '1';
    b.addEventListener('click', () => pick(P, String(it.key)));
    track.appendChild(b);
  });
  scroller.appendChild(track);
  scroller.addEventListener('scroll', () => edges(P), { passive: true });
  /* every section in a sheet: the way to see them all without a sideways scroll */
  const all = el('button', 'secpill-all', '<span>All</span>' + ICON.down);
  all.type = 'button';
  all.setAttribute('aria-label', 'All of ' + P.title);
  all.setAttribute('aria-haspopup', 'dialog');
  all.addEventListener('click', () => allSheet(P));
  wrap.append(scroller, all);
  Object.assign(P, { wrap, scroller, track });
  STATE.set(wrap, P);
  /* the segment on: where the reader is on a tab of sections, else what the tab says */
  const want = (k) => (k != null && P.keys.includes(String(k)) ? String(k) : null);
  const spied = P.find && !locks[P.key] ? spyPick(P, shell.panel ? shell.panel() : null) : null;
  setOn(P, spied || want(locks[P.key] && locks[P.key].on) || want(o.current) || want(lastOn[P.key]) || P.keys[0], false);
  requestAnimationFrame(() => { fit(P); center(P, false); });
  return wrap;
}

/* a tap: the water pours there at once, and while the page scrolls to the
   section it does not stop at the ones in between */
function pick(P, k) {
  if (P.find) lock(P.key, k);
  if (k !== P.on) setOn(P, k, true);
  P.onPick(k);
}
function lock(key, k) {
  const t = performance.now();
  const L = { t0: t, seen: t, on: k };
  locks[key] = L;
  const release = () => {
    if (locks[key] !== L) return;
    const now = performance.now();
    if (now - L.t0 < 2500 && (now - L.t0 < 300 || now - L.seen < 180)) { setTimeout(release, 90); return; }
    delete locks[key];
    const live = livePill(key);
    if (live && shell.panel) follow(live, shell.panel());
  };
  setTimeout(release, 120);
}
/* a tab that moves the reader itself (What Now's Missions, from a link or
   its own button) says where the water goes, and the scroll waits */
export function hold(key, k) {
  if (k == null) return;
  k = String(k);
  lock(key, k);
  const live = livePill(key);
  if (live && live.keys.includes(k) && live.on !== k) setOn(live, k, true);
}

function setOn(P, k, smooth) {
  P.on = k;
  lastOn[P.key] = k;
  P.track.querySelectorAll('.chip').forEach((b) => {
    const yes = b.dataset.chip === k;
    b.classList.toggle('on', yes);
    if (P.find) { if (yes) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
    else b.setAttribute('aria-pressed', yes ? 'true' : 'false');
  });
  liquify(P.track, { key: P.key, idx: P.keys.indexOf(k), colors: P.colors });
  center(P, smooth);
}

/* the one you are on, scrolled into the middle of the pill */
function center(P, smooth) {
  const sc = P.scroller, b = P.track.querySelector('.chip.on');
  if (!b || !sc.isConnected || sc.scrollWidth <= sc.clientWidth + 1) return;
  const left = Math.max(0, Math.min(sc.scrollWidth - sc.clientWidth, b.offsetLeft - (sc.clientWidth - b.offsetWidth) / 2));
  if (Math.abs(sc.scrollLeft - left) < 2) return;
  if (smooth && !reduced() && typeof sc.scrollTo === 'function') sc.scrollTo({ left, behavior: 'smooth' });
  else sc.scrollLeft = left;
}

/* "All" shows only when the segments run past the edge */
function fit(P) {
  if (!P.wrap.isConnected) return;
  P.wrap.classList.remove('over');
  /* a pixel or two short is rounding, not a hidden segment */
  P.wrap.classList.toggle('over', P.scroller.scrollWidth > P.scroller.clientWidth + 3);
  edges(P);
}
/* a side with more segments past it fades out */
function edges(P) {
  const sc = P.scroller;
  sc.classList.toggle('fl', sc.scrollLeft > 2);
  sc.classList.toggle('fr', sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 2);
}
const livePills = () => [...document.querySelectorAll('.secpill')].map((w) => STATE.get(w)).filter(Boolean);
const livePill = (key) => livePills().find((P) => P.key === key) || null;
window.addEventListener('resize', () => livePills().forEach((P) => { fit(P); center(P, false); }));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => livePills().forEach((P) => { fit(P); center(P, false); }));

/* which section the reader is in: the last whose head has come up to just
   under the floating pill (where a tap lands it); at the very end of the
   page, the last whose head shows. Sections not drawn (or empty) are
   skipped; with fewer than two drawn the pill keeps what it has (What
   Now's Tonight is a view of its own). */
function spyPick(P, panel) {
  if (!P.find || !panel || !panel.isConnected) return null;
  const pr = panel.getBoundingClientRect();
  if (!pr.height) return null;
  /* the pill's foot, or while it is being built, the mast's foot and a pill's height */
  const bar = P.wrap.isConnected ? P.wrap.closest('.secbar') || P.wrap : null;
  const mast = document.getElementById('mast');
  const foot = bar ? bar.getBoundingClientRect().bottom : (mast ? mast.getBoundingClientRect().bottom : pr.top) + 56;
  const line = Math.max(pr.top, foot) + 28;
  const found = [];
  for (const k of P.keys) {
    const node = P.find(k);
    if (!node || !node.isConnected || !panel.contains(node) || !node.offsetHeight) continue;
    found.push([k, node.getBoundingClientRect().top]);
  }
  if (found.length < 2) return null;
  let best = null, bestTop = -Infinity, first = null, firstTop = Infinity;
  for (const [k, t] of found) {
    if (t <= line && t > bestTop) { best = k; bestTop = t; }
    if (t < firstTop) { first = k; firstTop = t; }
  }
  if (panel.scrollTop > 0 && panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2) {
    let low = null, lowTop = -Infinity;
    for (const [k, t] of found) if (t < pr.bottom - 48 && t > lowTop) { low = k; lowTop = t; }
    if (low) best = low;
  }
  return best || first;
}
function follow(P, panel) {
  const L = locks[P.key];
  if (L) { L.seen = performance.now(); return; }
  const k = spyPick(P, panel);
  if (k && k !== P.on) setOn(P, k, true);
}
/* the shell calls this as the tab scrolls (and after it paints the row) */
export function spy(host, panel) {
  if (!host || !panel) return;
  host.querySelectorAll('.secpill').forEach((w) => { const P = STATE.get(w); if (P) follow(P, panel); });
}

function allSheet(P) {
  if (!shell.sheet) return;
  shell.sheet(P.title, (body, card, close) => {
    card.classList.add('secsheet');
    card.style.setProperty('--secpill-water', P.wrap.style.getPropertyValue('--secpill-water'));
    P.items.forEach((it) => {
      const k = String(it.key);
      const n = it.n != null && it.n !== '' ? '<span class="n">' + esc(it.n) + '</span>' : '';
      const b = el('button', 'secsheet-row' + (k === P.on ? ' on' : ''), (it.icon || '') + '<span class="t">' + esc(it.label) + '</span>' + n +
        (isNew(it) ? '<i class="nd" aria-label="New"></i>' : ''));
      b.type = 'button';
      b.dataset.chip = k;
      if (k === P.on) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => { close(); pick(livePill(P.key) || P, k); });
      body.appendChild(b);
    });
  });
}

/* the row under the mast: the pill, floating. On its own it is the tab's
   one switch, so it is the Wire's size (`lead`; Stephen, 2026-10-22: "when
   there's no big one, it just makes sense to make the bubbles bigger"). A
   tab that puts its own big switch on top (The Build over Habits, Watch's
   Upcoming | Past) takes the pill out of this bar, and the pill is the
   small second row again. */
export function sectionBar(o) {
  const p = pill(o);
  if (!p) return null;
  const bar = el('div', 'secbar lead');
  bar.appendChild(p);
  return bar;
}

/* for the tests: the pill's state */
export const _state = (key) => { const P = livePill(key); return P ? { on: P.on, keys: P.keys.slice(), locked: !!locks[key], over: P.wrap.classList.contains('over'),
  fresh: P.items.filter((it) => isNew(it)).map((it) => String(it.key)) } : null; };
