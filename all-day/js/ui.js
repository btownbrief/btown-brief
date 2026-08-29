/* ui.js — the pieces every tab draws with.

   The carousel is the important one. A horizontal rail that gives no sign it
   scrolls is invisible to most people: they see two cards, assume that is
   all there is, and never swipe. So every rail here gets three affordances
   at once — page dots, a live progress bar, and a count — and the dots are
   per PAGE, not per card, because eight dots under four visible cards tells
   you nothing about where you are.

   On a screen wide enough to show the whole rail the affordance would be a
   lie, so it hides itself. */

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
  return /^(https?:\/\/|#|\.\/|\.\.\/|\/)/i.test(u) ? u : '#';
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
  ext: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg>',
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
export function rail(host, { label } = {}) {
  const wrap = el('div', 'rail-wrap');
  const track = el('div', 'rail');
  const nav = el('div', 'rail-nav');
  const bar = el('div', 'rail-bar', '<i></i>');
  const dots = el('div', 'rail-dots');
  nav.append(bar, dots);
  wrap.append(track, nav);
  host.appendChild(wrap);

  const thumb = bar.firstElementChild;

  /* One dot per screenful, never per card. Past MAX_DOTS the dots stop being
     a map and become a smear, so they cap and track position proportionally
     — the bar above them carries the precision. */
  const MAX_DOTS = 7;
  const MIN_THUMB = 14;   // percent — a sliver you cannot see is not a control

  function sync() {
    const view = track.clientWidth;
    const total = Math.max(view, track.scrollWidth);
    const pages = Math.max(1, Math.ceil((total - 4) / Math.max(1, view)));
    const n = Math.min(MAX_DOTS, pages);

    /* The thumb is always drawn. When everything fits it fills the track,
       which says "this is all of it" rather than hiding the control. */
    const width = Math.max(MIN_THUMB, Math.min(100, (view / total) * 100));
    const max = Math.max(1, total - view);
    const ratio = total > view ? Math.min(1, track.scrollLeft / max) : 0;
    thumb.style.width = width + '%';
    thumb.style.left = (ratio * (100 - width)) + '%';

    if (dots.childElementCount !== n) {
      dots.innerHTML = '';
      for (let i = 0; i < n; i++) dots.appendChild(el('i'));
    }
    const active = Math.round(ratio * (n - 1));
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === active));
    dots.hidden = n < 2;
  }

  track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(() => sync()).observe(track);

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

  return { track, sync, wrap };
}

/* ------------------------------------------------------------ small parts */

export function starBtn(saved) {
  const b = el('button', 'act' + (saved ? ' on' : ''), ICON.star);
  b.setAttribute('aria-label', saved ? 'Saved' : 'Save for later');
  b.setAttribute('aria-pressed', saved ? 'true' : 'false');
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

export function seg(options, current, onPick) {
  const wrap = el('div', 'seg');
  options.forEach(([value, label]) => {
    const b = el('button', value === current ? 'on' : '', esc(label));
    b.addEventListener('click', () => onPick(value));
    wrap.appendChild(b);
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
export function shelfHead(host, title, sub) {
  const h = el('div', 'shelf-head');
  h.appendChild(el('span', 't', esc(title)));
  if (sub) h.appendChild(el('span', 's', esc(sub)));
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
