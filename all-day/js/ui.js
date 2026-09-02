/* ui.js — the pieces every tab draws with.

   The carousel is the important one. A horizontal rail that gives no sign it
   scrolls is invisible to most people: they see two cards, assume that is
   all there is, and never swipe. So every rail here gets three affordances
   at once — page dots, a live progress bar, and a count — and the dots are
   per PAGE, not per card, because eight dots under four visible cards tells
   you nothing about where you are.

   On a screen wide enough to show the whole rail the affordance would be a
   lie, so it hides itself. */

import * as store from './store.js';   /* store imports nothing — no cycle */

export const esc = (s) => {
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s == null ? '' : s)
    /* some feed titles arrive already escaped ("Top News &amp; Analysis") */
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (m, n) => ENT[n] || "'")
    /* upstream truncation can cut an entity in half ("Top News &amp…") */
    .replace(/&[a-zA-Z]{1,8}(…|\.\.\.)\s*$/, '…')
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};

/* Escaping a URL keeps it inside its attribute; it does not stop javascript:
   from running on click. Item URLs come off third-party RSS. */
export const safeHref = (url) => {
  const u = String(url == null ? '' : url).replace(/[\t\n\r\0]/g, '').trim();
  /* the lone-slash branch must not admit protocol-relative URLs — //host,
     and the /\host form browsers normalise the same way */
  return /^(https?:\/\/|#|\.\/|\.\.\/|\/(?![\/\\]))/i.test(u) ? u : '#';
};

export const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export function ago(epochSeconds) {
  const mins = Math.round(Date.now() / 1000 / 60 - Number(epochSeconds) / 60);
  if (!isFinite(mins) || mins < 0) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.round(mins / 60) + 'h ago';
  const d = Math.round(mins / 1440);
  return d === 1 ? 'yesterday' : d + 'd ago';
}

export function agoShort(epochSeconds) {
  const mins = Math.round(Date.now() / 1000 / 60 - Number(epochSeconds) / 60);
  if (!isFinite(mins) || mins < 0) return '';
  if (mins < 60) return Math.max(1, mins) + 'm';
  if (mins < 1440) return Math.round(mins / 60) + 'h';
  return Math.round(mins / 1440) + 'd';
}

export const dayLabel = (iso) => {
  const then = new Date(iso);
  if (isNaN(then)) return '';
  const days = Math.round((Date.now() - then) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return then.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="m12 3.6 2.7 5.65 6.2.86-4.5 4.32 1.08 6.17L12 17.7l-5.48 2.9 1.08-6.17-4.5-4.32 6.2-.86z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m4.5 12.5 5 5 10-11"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8.5 5v14M15.5 5v14" stroke-width="2.4"/></svg>',
  back15: '<svg viewBox="0 0 24 24"><path d="M11 8 5.5 12 11 16M18 8l-5.5 4L18 16"/></svg>',
  /* a jar: a lid, a body, and a coin going in — one glyph for both errands */
  jar: '<svg viewBox="0 0 24 24"><path d="M7.5 7.5h9v10.2a2.3 2.3 0 0 1-2.3 2.3H9.8a2.3 2.3 0 0 1-2.3-2.3z"/><path d="M6.6 4.4h10.8v2.2H6.6z"/><path d="M12 10.6v4.2M10.2 12.3h3.6"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  /* the iOS share glyph — an arrow leaving a tray — because that is the
     shape phones have taught people to look for */
  share: '<svg viewBox="0 0 24 24"><path d="M12 14.5V3.8M8.4 7 12 3.4 15.6 7"/><path d="M8 11H6v9.4h12V11h-2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.3 6.3 4.8 4.8M19.2 19.2l-1.5-1.5M17.7 6.3l1.5-1.5M4.8 19.2l1.5-1.5"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.4v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.2 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z"/></svg>',
  board: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M8.5 9v10.5"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M17 4.5 20.5 8 17 11.5M17 12.5 20.5 16 17 19.5M3.5 8h4.2l8.8 8h4M3.5 16h4.2l2.5-2.4"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>',
};

/* --------------------------------------------------------------- carousel */

/* Build the rail plus its affordance row. Returns the scroller so callers
   can append cards; call `sync` (returned) after appending. */
export function rail(host, { label, open } = {}) {
  const wrap = el('div', 'rail-wrap');
  const track = el('div', 'rail');
  const nav = el('div', 'rail-nav');
  /* One strip: the track runs the full width and the dots sit on top of it,
     so the affordance costs one line instead of two. The track fades in
     while the rail is moving and out again a moment after it stops — the
     dots are what stays, and they are enough to say "there is more". */
  const strip = el('div', 'rail-strip');
  const bar = el('div', 'rail-bar', '<i></i>');
  const dots = el('div', 'rail-dots');
  strip.append(bar, dots);
  nav.appendChild(strip);
  wrap.append(track, nav);
  host.appendChild(wrap);

  const thumb = bar.firstElementChild;

  /* Swiping a long rail twenty times is a chore. Any rail can be opened out
     into a plain vertical list, which is also the honest answer for anyone
     who finds horizontal scrolling awkward. */
  const expand = el('button', 'rail-expand', 'Expand to a list');
  expand.setAttribute('aria-expanded', 'false');

  /* An expanded rail can be a screen and a half tall, so the way out has to
     be at the top as well — otherwise closing it means scrolling to the
     bottom and then scrolling all the way back. */
  const collapseTop = el('button', 'rail-collapse-top', 'Back to a row');
  collapseTop.hidden = true;

  function setOpen(open) {
    track.classList.toggle('is-open', open);
    wrap.classList.toggle('is-open', open);
    expand.setAttribute('aria-expanded', open ? 'true' : 'false');
    expand.textContent = open ? 'Back to a row' : 'Expand to a list';
    collapseTop.hidden = !open;
    if (!open) {
      track.scrollLeft = 0;
      sync();
      /* closing from the top should leave you looking at the rail, not at
         wherever the bottom of the list used to be */
      wrap.scrollIntoView({ block: 'nearest' });
    }
  }
  expand.addEventListener('click', () => setOpen(!track.classList.contains('is-open')));
  /* Some shelves open flat from the start — five cards in a scroller that
     could hold twelve reads as an empty shelf, not a short one. */
  if (open) setOpen(true);
  collapseTop.addEventListener('click', () => setOpen(false));
  wrap.insertBefore(collapseTop, track);
  nav.appendChild(expand);

  /* One dot per screenful, never per card. Past MAX_DOTS they stop being a
     map and become a smear, so they cap and track position proportionally. */
  const MAX_DOTS = 7;
  const MIN_THUMB = 14;   // percent — a sliver you cannot see is not a control
  const IDLE_MS = 1200;
  let idleTimer = 0;

  function sync() {
    const view = track.clientWidth;
    const total = Math.max(view, track.scrollWidth);

    /* The thumb is always drawn. When everything fits it fills the track,
       which says "this is all of it" rather than hiding the control. */
    const width = Math.max(MIN_THUMB, Math.min(100, (view / total) * 100));
    const max = Math.max(1, total - view);
    const ratio = total > view ? Math.min(1, track.scrollLeft / max) : 0;
    thumb.style.width = width + '%';
    thumb.style.left = (ratio * (100 - width)) + '%';

    const pages = Math.max(1, Math.ceil((total - 4) / Math.max(1, view)));
    const n = Math.min(MAX_DOTS, pages);
    if (dots.childElementCount !== n) {
      dots.innerHTML = '';
      for (let i = 0; i < n; i++) dots.appendChild(el('i'));
    }
    const active = Math.round(ratio * (n - 1));
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === active));
    /* one dot is not a position, it is a full stop */
    strip.classList.toggle('is-idle', n < 2);

    /* nothing to scroll and nothing to expand — get out of the way rather
       than offering a control that does nothing */
    expand.hidden = track.childElementCount < 3;
  }

  function wake() {
    if (track.scrollWidth <= track.clientWidth + 4) return;
    bar.classList.add('is-live');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => bar.classList.remove('is-live'), IDLE_MS);
  }

  track.addEventListener('scroll', () => { wake(); requestAnimationFrame(sync); }, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(() => sync()).observe(track);

  /* Waking only on horizontal scroll is backwards: you have to already know
     it scrolls to find out that it scrolls. Coming into view down the page
     is the moment to show it. */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { sync(); wake(); } });
    }, { threshold: 0.35 }).observe(wrap);
  }

  /* DESKTOP. A touch screen pans a rail for free; a mouse has nothing —
     the scrollbar is hidden, and a plain wheel scrolls the page, not the
     rail. So three ways in, none of which interfere with touch:

       · grab the rail and pull it
       · drag the grey thumb, which is a real scrollbar now
       · click anywhere on the track to jump there

     A drag must never also open the card underneath it, so past a 4px
     threshold the click that follows is swallowed. */
  const scrollable = () => track.scrollWidth > track.clientWidth + 4;

  let panning = false, panX = 0, panFrom = 0, panMoved = false;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || !scrollable()) return;
    if (e.button !== 0) return;
    panning = true;
    panMoved = false;
    panX = e.clientX;
    panFrom = track.scrollLeft;
  });
  track.addEventListener('pointermove', (e) => {
    if (!panning) return;
    const dx = e.clientX - panX;
    if (!panMoved && Math.abs(dx) < 4) return;
    if (!panMoved) {
      panMoved = true;
      track.classList.add('is-panning');
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    }
    track.scrollLeft = panFrom - dx;
    e.preventDefault();
  });
  const endPan = () => {
    panning = false;
    track.classList.remove('is-panning');
  };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => track.addEventListener(ev, endPan));
  track.addEventListener('click', (e) => {
    if (!panMoved) return;
    e.preventDefault();
    e.stopPropagation();
    panMoved = false;
  }, true);

  let barDrag = false;
  const seek = (clientX) => {
    const box = bar.getBoundingClientRect();
    const w = thumb.getBoundingClientRect().width;
    const span = Math.max(1, box.width - w);
    const at = Math.min(1, Math.max(0, (clientX - box.left - w / 2) / span));
    track.scrollLeft = at * Math.max(0, track.scrollWidth - track.clientWidth);
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!scrollable()) return;
    barDrag = true;
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    seek(e.clientX);
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => { if (barDrag) seek(e.clientX); });
  ['pointerup', 'pointercancel'].forEach((ev) =>
    bar.addEventListener(ev, () => { barDrag = false; }));

  return { track, sync, wrap, setOpen };
}

/* The same grey bar for anything else that scrolls sideways — the topic
   chips, the subreddit chips, the Wander trail. A rail is not the only thing
   people have to discover they can push, and a row of chips that runs off
   the edge with no sign of it reads as a row of chips that ends there. */
export function scrollHint(scroller) {
  const bar = el('div', 'hint-bar', '<i></i>');
  const thumb = bar.firstElementChild;
  scroller.insertAdjacentElement('afterend', bar);

  function sync() {
    const view = scroller.clientWidth;
    const total = Math.max(view, scroller.scrollWidth);
    const width = Math.max(14, Math.min(100, (view / total) * 100));
    const max = Math.max(1, total - view);
    const ratio = total > view ? Math.min(1, scroller.scrollLeft / max) : 0;
    thumb.style.width = width + '%';
    thumb.style.left = (ratio * (100 - width)) + '%';
  }

  let idle = 0;
  function wake() {
    if (scroller.scrollWidth <= scroller.clientWidth + 4) return;
    bar.classList.add('is-live');
    clearTimeout(idle);
    idle = setTimeout(() => bar.classList.remove('is-live'), 1200);
  }

  scroller.addEventListener('scroll', () => { wake(); requestAnimationFrame(sync); }, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(() => sync()).observe(scroller);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { sync(); wake(); } });
    }, { threshold: 0.5 }).observe(scroller);
  }

  /* draggable, same as a rail's — a mouse has no other way to move a chip row */
  let dragging = false;
  const seek = (clientX) => {
    const box = bar.getBoundingClientRect();
    const w = thumb.getBoundingClientRect().width;
    const span = Math.max(1, box.width - w);
    const at = Math.min(1, Math.max(0, (clientX - box.left - w / 2) / span));
    scroller.scrollLeft = at * Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  };
  bar.addEventListener('pointerdown', (e) => {
    if (scroller.scrollWidth <= scroller.clientWidth + 4) return;
    dragging = true;
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    seek(e.clientX);
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => { if (dragging) seek(e.clientX); });
  ['pointerup', 'pointercancel'].forEach((ev) =>
    bar.addEventListener(ev, () => { dragging = false; }));

  sync();
  return sync;
}

/* ------------------------------------------------------------ small parts */

export function starBtn(saved) {
  const b = el('button', 'act' + (saved ? ' on' : ''), ICON.star);
  b.setAttribute('aria-label', saved ? 'Saved' : 'Save for later');
  b.setAttribute('aria-pressed', saved ? 'true' : 'false');
  return b;
}

export function shareBtn() {
  const b = el('button', 'act share', ICON.share);
  b.setAttribute('aria-label', 'Share');
  b.title = 'Share';
  return b;
}

export function voteBtn(count, mine, live) {
  const b = el('button', 'vote' + (mine ? ' on' : '') + (count ? '' : ' is-zero'),
    ICON.up + '<span class="n">' + (count || 0) + '</span>');
  b.setAttribute('aria-label', 'Upvote');
  b.setAttribute('aria-pressed', mine ? 'true' : 'false');
  /* until the backend answers once, the whole feature stays out of the way */
  b.hidden = !live;
  return b;
}

export function paintVote(b, count, mine) {
  if (!b) return;
  b.classList.toggle('on', !!mine);
  b.classList.toggle('is-zero', !count);
  b.setAttribute('aria-pressed', mine ? 'true' : 'false');
  const n = b.querySelector('.n');
  if (n) n.textContent = count || 0;
}

/* The house segment control. Its fill is water too — see THE LIQUID below —
   keyed by the option values, so the same segment re-rendered by its own
   click resumes the pour rather than starting over. */
export function seg(options, current, onPick) {
  const wrap = el('div', 'seg');
  options.forEach(([value, label]) => {
    const b = el('button', value === current ? 'on' : '', esc(label));
    b.addEventListener('click', () => onPick(value));
    wrap.appendChild(b);
  });
  liquidAttach(wrap, {
    key: 'seg:' + options.map((o) => o[0]).join('|'),
    n: options.length,
    idx: options.findIndex((o) => o[0] === current),
    prop: '--seg-water', fallback: '#6E92B4',
  });
  return wrap;
}

export function chip(label, on, onClick, extraClass) {
  const b = el('button', 'chip' + (on ? ' on' : '') + (extraClass ? ' ' + extraClass : ''), label);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.addEventListener('click', onClick);
  return b;
}

/* A shelf label: one line, legible, cheap. The full `heading` block is a
   1.7rem serif plus a subtitle, which is right at the top of a reading
   surface and wrong repeated down a tab you scroll for video. */
export function shelfHead(host, title, sub, right) {
  const h = el('div', 'shelf-head');
  h.appendChild(el('span', 't', esc(title)));
  if (sub) h.appendChild(el('span', 's', esc(sub)));
  if (right) { h.classList.add('has-more'); h.appendChild(right); }
  host.appendChild(h);
  return h;
}

export function heading(host, { eyebrow, title, sub, right }) {
  const h = el('div', 'h-sec');
  const row = el('div', 'h-row');
  const left = el('div');
  if (eyebrow) left.appendChild(el('p', 'eyebrow', esc(eyebrow)));
  if (title) left.appendChild(el('h2', null, esc(title)));
  row.appendChild(left);
  if (right) row.appendChild(right);
  h.appendChild(row);
  if (sub) h.appendChild(el('p', 'sub', sub));
  host.appendChild(h);
  return h;
}


/* A one-line hint that stays gone once dismissed. Used for the things no
   one discovers by looking — swipe, mostly. */
export function tipBar(host, name, html) {
  if (store.tipDone(name)) return null;
  const bar = el('div', 'tipbar');
  bar.innerHTML = html;
  const x = el('button', 'x', '\u00d7');
  x.setAttribute('aria-label', 'Dismiss this tip');
  x.addEventListener('click', () => { store.dismissTip(name); bar.remove(); });
  bar.appendChild(x);
  host.appendChild(bar);
  return bar;
}

/* "updated 20 minutes ago", with a dot that is green while the payload is
   still warm. Every tab shows one — only the Wire did, and that made the
   other four look like they might be days stale. */
export function updatedLine(stampSec, freshHours = 8) {
  if (!stampSec) return '';
  const old = (Date.now() / 1000 - stampSec) > freshHours * 3600;
  return '<span class="updated' + (old ? ' is-old' : '') + '"><i></i>updated ' +
    esc(ago(stampSec)) + '</span>';
}

export const stampOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
};

/* The stamp sits above everything on a tab, in the same place on all five,
   so "is this today's?" is answered before you start reading. */
export function tabStamp(host, stampSec, what) {
  if (!stampSec) return;
  const line = el('p', 'tabstamp');
  line.innerHTML = updatedLine(stampSec) +
    (what ? '<span class="tabstamp-what">' + esc(what) + '</span>' : '');
  host.appendChild(line);
}


/* ---------------------------------------------------------- local switch */
/* Local is not a filter among filters here — it is the reason the paper
   exists, and it was expressed five different ways: a chip on the wire, a
   shelf on Watch, a segment on Listen, a pool on Wikipedia, nothing at all
   on Reddit. One control, one word, one green, the same first thing on every
   tab, driving one shared setting — so switching it on the wire and walking
   to Watch keeps you in local.

   Deliberately NOT the app's generic .seg: Watch and Listen already carry
   segments, and a third would read as more of the same rather than as the
   thing the whole app is about. */
/* THE LIQUID. A toggle's fill is a body of water: pick the other side and the
   whole slab pours across the bar — the leading edge springs ahead, the
   trailing edge lags so the liquid stretches, droplets fly and cling blobs
   hang at the broken edge when it lands, and the boundary settles into a
   lapping wave. The Local switch's water is green for Local and red for
   Everything; every other segment (Do/See, All photos/Sunsets, Tonight/Past
   nights, the theme picker) pours a quieter lake blue so the big one stays
   the loud one.

   Toggles are rebuilt on every render, so the physics lives out here, keyed
   by which toggle it is, and each new canvas resumes it mid-slosh. One key can
   have several canvases at once — the Local switch sits on nine tabs — and
   the loop paints whichever of them are on screen. That is also the fix for
   a bar that came up blank: the old loop followed the LAST canvas attached,
   and a tab re-rendering behind the visible one (the wire's ten-minute poll,
   a stale tab redrawn on the way in) took the water with it, leaving the bar
   you were looking at with no fill until the next toggle.

   Skipped entirely under prefers-reduced-motion — the CSS fill still works
   without any of this. */
const liquids = new Map();   /* key -> one body of water, across re-renders */
let liquidRaf = 0;
let liquidWake = false;

function cssVar(node, prop, fallback) {
  const v = getComputedStyle(node).getPropertyValue(prop).trim();
  return v || fallback;
}

/* `#rgb`, `#rrggbb` or `rgb(a)(…)` -> [r, g, b]; anything else -> null */
function rgbOf(c) {
  if (!c) return null;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.replace(/./g, (ch) => ch + ch);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const n = c.match(/\d+(\.\d+)?/g);
  return n && n.length >= 3 ? [+n[0], +n[1], +n[2]] : null;
}

function mixColor(a, b, t) {
  const pa = rgbOf(a), pb = rgbOf(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const m = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return 'rgb(' + m(0) + ',' + m(1) + ',' + m(2) + ')';
}

/* Pour the water named `key` into slot `idx` of `n` on this bar. The bar's
   buttons are the slots; the water is measured against them each frame, so
   a three-way segment with one wide label still lands under the right word. */
function liquidAttach(bar, { key, n, idx, prop, fallback }) {
  if (idx < 0 || !(n > 0)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let canvas, ctx;
  try {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    if (!ctx) return;
  } catch (e) { return; }
  canvas.className = 'lsw-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  bar.classList.add('liquid');
  bar.insertBefore(canvas, bar.firstChild);

  let s = liquids.get(key);
  if (!s) {
    s = {
      n, idx: null,
      L: 0, R: 0, vL: 0, vR: 0, dir: 1,   // slab edges as fractions of the bar
      churn: 0, drops: [], blobs: [], bubbles: [], bubbleAt: 0,
      /* colours resolve at the first painted frame — a segment is built
         before it is in the document, and computed style is empty there */
      colorFrom: null, colorTo: null, colorT: 1,
      phase: Math.random() * 20, splashed: true, splashed2: true,
      lastT: 0, faces: [],
    };
    liquids.set(key, s);
  }
  s.n = n;
  const first = s.idx === null;
  const flipped = !first && s.idx !== idx;
  if (first) {
    s.L = idx / n; s.R = (idx + 1) / n; s.vL = 0; s.vR = 0;
  } else if (flipped) {
    s.dir = idx > s.idx ? 1 : -1;
    s.colorFrom = s.colorTo; s.colorTo = null; s.colorT = 0;
    s.churn = 1;
    s.splashed = false;
    s.splashed2 = false;
  }
  s.idx = idx;
  s.faces = s.faces.filter((f) => f.canvas.isConnected && f.canvas !== canvas);
  s.faces.push({ bar, canvas, ctx, prop, fallback, color: null,
                 slots: [...bar.querySelectorAll('button')] });
  s.lastT = performance.now() / 1000;
  if (!liquidRaf) liquidRaf = requestAnimationFrame(liquidFrame);
}

/* where slot `idx` sits on this bar, widened to the bar's rim at either end
   so the water touches the edge like it always did on the Local switch */
function slotBounds(face, s, W) {
  const b = face.slots[s.idx];
  if (!b || !W) return [s.idx / s.n, (s.idx + 1) / s.n];
  const gap = 4;
  const l = s.idx === 0 ? 0 : (b.offsetLeft - gap / 2) / W;
  const r = s.idx === s.n - 1 ? 1 : (b.offsetLeft + b.offsetWidth + gap / 2) / W;
  return [Math.max(0, Math.min(1, l)), Math.max(0, Math.min(1, r))];
}

function liquidFrame() {
  liquidRaf = 0;
  const now = performance.now() / 1000;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let alive = false;
  liquids.forEach((s) => {
    s.faces = s.faces.filter((f) => f.canvas.isConnected);
    if (!s.faces.length) return;              // a render replaced every canvas — wait for the next
    alive = true;
    /* a face in a hidden panel measures 0×0 and is skipped; the physics runs
       in the pixels of the first face actually on screen */
    const shown = s.faces.filter((f) => f.bar.clientWidth > 0 && f.bar.clientHeight > 0);
    if (!shown.length) { s.lastT = now; return; }
    const W = shown[0].bar.clientWidth, H = shown[0].bar.clientHeight;
    const dt = Math.min(0.05, Math.max(0, now - s.lastT));
    s.lastT = now;
    const [tL, tR] = slotBounds(shown[0], s, W);
    /* the face knows which token it wears; read it once it is on screen.
       A flip leaves colorTo empty so the pour blends from the old colour;
       the same side re-read (a theme change) snaps both. */
    const face = shown[0];
    if (!face.color) face.color = cssVar(face.bar, face.prop, face.fallback);
    if (s.colorTo !== face.color) {
      if (s.colorT >= 1 || !s.colorFrom) s.colorFrom = face.color;
      s.colorTo = face.color;
    }
    liquidStep(s, W, H, dt, now, tL, tR);
    shown.forEach((f) => {
      if (f.canvas.width !== W * dpr || f.canvas.height !== H * dpr) {
        f.canvas.width = W * dpr; f.canvas.height = H * dpr;
      }
      f.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      f.ctx.clearRect(0, 0, W, H);
      liquidPaint(s, f.ctx, W, H, tL, tR);
    });
  });
  if (!alive) return;                          // the next attach restarts it
  if (!document.hidden) liquidRaf = requestAnimationFrame(liquidFrame);
  else if (!liquidWake) {
    liquidWake = true;
    document.addEventListener('visibilitychange', () => {
      liquidWake = false;
      if (document.hidden || liquidRaf) return;
      liquids.forEach((s) => { s.lastT = performance.now() / 1000; });
      liquidRaf = requestAnimationFrame(liquidFrame);
    }, { once: true });
  }
}

/* the wave at an edge: three ripples so the surface never reads as a
   standing sine, plus a slow lump while churned so the edge bulges
   irregularly, like something thick, instead of rippling politely */
function edgeFns(s, W, tL, tR) {
  const amp = (target) => (target <= 0.001 || target >= 0.999 ? 0 : 2.4) + s.churn * 8;
  const wave = (yy, ph, a) =>
    a * (Math.sin(yy * 0.18 + s.phase * 2.4 + ph) * 0.5 +
         Math.sin(yy * 0.07 - s.phase * 1.6 + ph * 1.7) * 0.32 +
         Math.sin(yy * 0.31 + s.phase * 4.2 + ph * 2.3) * 0.18) +
    s.churn * 5 * Math.sin(yy * 0.045 + s.phase * 1.1 + ph * 3.1) *
      Math.max(0, Math.sin(yy * 0.02 + ph));
  const aL = amp(tL), aR = amp(tR);
  return {
    aL, aR,
    left: (yy) => s.L * W + wave(yy, 0.9, aL),
    right: (yy) => s.R * W + wave(yy, 3.7, aR),
  };
}

/* everything that moves, once per frame — never per canvas */
function liquidStep(s, W, H, dt, now, tL, tR) {
  s.phase += dt;

  /* the slab: each edge is a spring; the one moving toward open water leads,
     a touch underdamped so a landing jiggles a couple of times */
  const spring = (p, v, target, k, c) => {
    v += (k * (target - p) - c * v) * dt;
    return [p + v * dt, v];
  };
  const goingRight = s.dir > 0;
  [s.L, s.vL] = spring(s.L, s.vL, tL, goingRight ? 64 : 130, goingRight ? 9 : 10);
  [s.R, s.vR] = spring(s.R, s.vR, tR, goingRight ? 130 : 64, goingRight ? 10 : 9);

  const lead = goingRight ? s.R : s.L, leadV = goingRight ? s.vR : s.vL;
  const leadT = goingRight ? tR : tL;

  /* spray while the pour is fast: little beads torn off the leading edge */
  if (s.churn > 0.4 && Math.abs(leadV) > 0.8 && Math.random() < 0.6) {
    s.drops.push({
      x: lead * W, y: H * (0.2 + Math.random() * 0.6),
      vx: leadV * W * (0.5 + Math.random() * 0.5),
      vy: -20 + Math.random() * 40,
      r: 1 + Math.random() * 1.6, life: 0.3 + Math.random() * 0.25,
    });
  }

  /* landing: droplets fly — and, the reference's signature, a cluster of
     round blobs clings at the broken edge like thick milk, hanging almost
     still before the water takes them back */
  if (!s.splashed && s.churn > 0.5 && Math.abs(lead - leadT) < 0.045 && Math.abs(leadV) > 0.35) {
    s.splashed = true;
    const bx = leadT * W;
    for (let i = 0; i < 12; i++) {
      s.drops.push({
        x: bx, y: H * (0.15 + Math.random() * 0.7),
        vx: (goingRight ? 1 : -1) * (20 + Math.random() * 80) * (Math.random() < 0.25 ? -0.45 : 1),
        vy: -30 + Math.random() * 55,
        r: 1.4 + Math.random() * 3.1, life: 0.55 + Math.random() * 0.5,
      });
    }
    for (let i = 0; i < 9; i++) {
      const maxLife = 0.7 + Math.random() * 0.9;
      s.blobs.push({
        edge: goingRight ? 'R' : 'L',
        y: H * (0.1 + Math.random() * 0.8),
        off: (Math.random() < 0.6 ? 1 + Math.random() * 4       // stuck on the edge
                                  : 6 + Math.random() * 9),     // detached, hanging
        r: 2 + Math.random() * 4,
        life: maxLife, maxLife,
        slide: 4 + Math.random() * 9,
      });
    }
  }
  /* the trailing edge lands at the inner boundary — the meniscus everyone
     actually watches — so it gets its own, smaller cluster of cling blobs */
  const trail = goingRight ? s.L : s.R, trailV = goingRight ? s.vL : s.vR;
  const trailT = goingRight ? tL : tR;
  if (!s.splashed2 && s.churn > 0.3 && Math.abs(trail - trailT) < 0.04 && Math.abs(trailV) > 0.25) {
    s.splashed2 = true;
    for (let i = 0; i < 6; i++) {
      const maxLife = 0.6 + Math.random() * 0.8;
      s.blobs.push({
        edge: goingRight ? 'L' : 'R',
        y: H * (0.1 + Math.random() * 0.8),
        off: (Math.random() < 0.6 ? 1 + Math.random() * 3 : 5 + Math.random() * 7),
        r: 1.6 + Math.random() * 3.2,
        life: maxLife, maxLife,
        slide: 4 + Math.random() * 8,
      });
    }
  }
  s.churn = Math.max(0, s.churn - dt * 0.7);
  s.colorT = Math.min(1, s.colorT + dt * 2.2);

  /* bubbles: born low in the water, wobbling up, gone at the rim. The pin
     was bubbly; so is the lake. */
  const slabL = Math.min(s.L, s.R) * W, slabR = Math.max(s.L, s.R) * W;
  if (now > s.bubbleAt && slabR - slabL > 30) {
    s.bubbleAt = now + 0.35 + Math.random() * 0.8 - Math.min(0.5, s.churn * 0.5);
    s.bubbles.push({
      x: slabL + 12 + Math.random() * (slabR - slabL - 24),
      y: H - 4, r: 0.9 + Math.random() * 1.7,
      vy: 9 + Math.random() * 9, ph: Math.random() * Math.PI * 2,
    });
  }

  /* the cling blobs slide down a little and are drawn back toward the edge */
  for (let i = s.blobs.length - 1; i >= 0; i--) {
    const b = s.blobs[i];
    b.life -= dt;
    if (b.life <= 0) { s.blobs.splice(i, 1); continue; }
    b.y = Math.min(H - 3, b.y + b.slide * dt);
    b.off = Math.max(0, b.off - dt * 4);
  }
  /* droplets: floatier than real water — the reference liquid is thick */
  for (let i = s.drops.length - 1; i >= 0; i--) {
    const d = s.drops[i];
    d.life -= dt;
    if (d.life <= 0) { s.drops.splice(i, 1); continue; }
    d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 150 * dt;
  }
  for (let i = s.bubbles.length - 1; i >= 0; i--) {
    const b = s.bubbles[i];
    b.y -= b.vy * dt;
    b.x += Math.sin(s.phase * 2.4 + b.ph) * 5 * dt;
    if (b.y < 6 || b.x < slabL + 4 || b.x > slabR - 4) s.bubbles.splice(i, 1);
  }
}

/* draw the water as it is right now — pure, so every face gets the same frame */
function liquidPaint(s, x, W, H, tL, tR) {
  const fill = mixColor(s.colorFrom || '#1d7a4f', s.colorTo || '#1d7a4f', s.colorT);
  const { aL, aR, left: leftEdge, right: rightEdge } = edgeFns(s, W, tL, tR);

  x.beginPath();
  for (let yy = 0; yy <= H; yy += 3) x.lineTo(leftEdge(yy), yy);
  for (let yy = H; yy >= 0; yy -= 3) x.lineTo(rightEdge(yy), yy);
  x.closePath();
  x.fillStyle = fill;
  x.fill();

  /* a bright crest along whichever meniscus is loose — the light catching
     the moving edge is half of what makes liquid read as liquid */
  const crest = (edgeFn, a) => {
    if (a <= 0.1) return;
    x.beginPath();
    for (let yy = 0; yy <= H; yy += 3) x.lineTo(edgeFn(yy), yy);
    x.strokeStyle = 'rgba(255,255,255,' + Math.min(0.5, 0.22 + s.churn * 0.3).toFixed(3) + ')';
    x.lineWidth = 1.4;
    x.stroke();
  };
  crest(leftEdge, aL);
  crest(rightEdge, aR);

  /* the cling blobs: solid rounds riding the meniscus, shrinking until the
     water has them back */
  for (const b of s.blobs) {
    const k = b.life / b.maxLife;
    const ex = b.edge === 'R' ? rightEdge(b.y) : leftEdge(b.y);
    const dir = b.edge === 'R' ? 1 : -1;
    x.fillStyle = fill;
    x.beginPath();
    x.arc(ex + dir * b.off, b.y, b.r * Math.min(1, k * 1.6), 0, Math.PI * 2);
    x.fill();
  }

  /* a soft light on the surface, drifting like the sun on it */
  const g = x.createLinearGradient((s.phase * 14) % W - W * 0.3, 0, (s.phase * 14) % W + W * 0.3, H);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.save();
  x.beginPath();
  for (let yy = 0; yy <= H; yy += 3) x.lineTo(leftEdge(yy), yy);
  for (let yy = H; yy >= 0; yy -= 3) x.lineTo(rightEdge(yy), yy);
  x.closePath();
  x.clip(); x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();

  /* droplets: stretched along their motion like flung liquid, and when one
     sits close to the water's edge a smaller blob bridges the gap — poor
     man's goo, and enough of it at this size */
  const nearEdge = (d) => {
    const dl = d.x - leftEdge(d.y), dr = rightEdge(d.y) - d.x;
    if (dl >= 0 && dr >= 0) return 0;          // inside the water
    const gap = dl < 0 ? -dl : -dr;
    return gap < 9 ? (dl < 0 ? leftEdge(d.y) : rightEdge(d.y)) : null;
  };
  for (const d of s.drops) {
    x.globalAlpha = Math.min(1, d.life * 2.5);
    x.fillStyle = fill;
    const sp = Math.hypot(d.vx, d.vy);
    const stretch = Math.min(1.8, 1 + sp / 260);
    x.save();
    x.translate(d.x, d.y);
    x.rotate(Math.atan2(d.vy, d.vx));
    x.beginPath(); x.ellipse(0, 0, d.r * stretch, d.r / Math.sqrt(stretch), 0, 0, Math.PI * 2); x.fill();
    x.restore();
    const e = nearEdge(d);
    if (e !== null && e !== 0) {
      x.beginPath(); x.arc((d.x + e) / 2, d.y, d.r * 0.55, 0, Math.PI * 2); x.fill();
    }
  }
  x.globalAlpha = 1;

  /* bubbles rise inside the water and vanish at the rim */
  for (const b of s.bubbles) {
    x.globalAlpha = Math.min(1, (b.y - 6) / 8);
    x.strokeStyle = 'rgba(255,255,255,0.38)';
    x.lineWidth = 0.9;
    x.fillStyle = 'rgba(255,255,255,0.13)';
    x.beginPath(); x.arc(b.x, b.y, b.r, 0, Math.PI * 2); x.fill(); x.stroke();
  }
  x.globalAlpha = 1;
}

export function localSwitch(host, { on, local, all, noun, onChange, extra }) {
  const box = el('div', 'localsw' + (on ? ' is-on' : ''));

  const bar = el('div', 'localsw-bar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Local or everything');

  const make = (wantOn, label) => {
    const b = el('button', 'localsw-half' + (on === wantOn ? ' on' : ''), label);
    b.setAttribute('aria-pressed', on === wantOn ? 'true' : 'false');
    b.addEventListener('click', () => { if (on !== wantOn) onChange(wantOn); });
    return b;
  };
  bar.append(
    make(true, '<span class="localsw-leaf">\u{1F341}</span><span>Local</span>'),
    make(false, '<span>Everything</span>')
  );
  /* `extra` is the jar. It is passed in rather than built here because it
     opens a sheet, and sheets live in app.js — which imports this file. */
  if (extra) {
    const row = el('div', 'localsw-row');
    row.append(bar, extra);
    box.appendChild(row);
  } else {
    box.appendChild(bar);
  }

  const n = on ? local : all;
  if (typeof n === 'number') {
    box.appendChild(el('p', 'localsw-note',
      (on ? 'Burlington &amp; Vermont \u00b7 ' : '') +
      '<b>' + n.toLocaleString() + '</b> ' + esc(noun || 'items') +
      (on && typeof all === 'number' && all > n
        ? ' <span class="localsw-of">of ' + all.toLocaleString() + '</span>' : '')));
  }

  host.appendChild(box);
  liquidAttach(bar, {
    key: 'local', n: 2, idx: on ? 0 : 1,
    prop: on ? '--local' : '--every', fallback: on ? '#16704E' : '#A63A2C',
  });
  return box;
}
