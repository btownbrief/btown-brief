/* ui.js — the pieces every tab draws with. Pure builders: they read the store
   for saved, voted and read state, and hand back DOM. They never act; a tap
   on anything they draw is caught by the shell's bindFeed() in app.js, which
   is why a card carries data-k, data-act, data-open and data-src attributes
   rather than its own listeners.

   Everything printed goes through esc(). Items come off third-party feeds.

   An item, as the cards read it (a tab maps its own data onto this):
     k        stable key, also the deep link (#tab/<k>) and the save/vote key
     href     where it opens; an item without one is not drawn
     kind     headline | post | pick | video | image | event | person | audio
     title, text, why, src (display name), sid (source id, for mutes),
     author, handle, via, ago, thumb, media (a picture URL, or a demo palette
     name), ratio (r169 | r45 | r11), dur, local, own, live, votes,
     comments, open ("Open on X"), eyebrow, dow, dom, when, where, price,
     going, cta, name, arch, line, show, src_audio, yt (a YouTube id). */

import * as store from './store.js';
import { attach as pour } from './liquid.js';

export const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Only http(s) and in-app hash links survive; a javascript: URL from a feed
   becomes a dead link rather than a script. */
export function safeHref(u) {
  const s = String(u || '').trim();
  if (/^#/.test(s)) return s;
  try {
    const url = new URL(s, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch (e) { return '#'; }
}
const isExternal = (u) => /^https?:/i.test(String(u || ''));

export const svg = (d, extra) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';

/* ------------------------------------------------------------------ icons */
/* 24-box stroke icons. The first nine are the tabs. */
export const ICON = {
  wire: svg('<path d="M3 12h3.4l2.6-6.2 4 12.4 2.6-6.2H21"/>'),
  watch: svg('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M8.2 6l2 4M13.2 6l2 4"/>'),
  food: svg('<path d="M7 3v7a2 2 0 0 0 4 0V3M9 3v18M17 3c-1.6 2-2.4 4.4-2.4 7.2H17V21"/>'),
  people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.4 19.5a5.6 5.6 0 0 1 11.2 0"/><circle cx="17" cy="9.2" r="2.5"/><path d="M15.6 19.5a4.8 4.8 0 0 1 5-4.6"/>'),
  whatnow: svg('<path d="M13 3 5.2 13.4h6L10.4 21 19 10.6h-6z"/>'),
  vintage: svg('<path d="M8 4 3.5 7.3 6 10.5l2-1.1V20h8V9.4l2 1.1 2.5-3.2L16 4a4 4 0 0 1-8 0z"/>'),
  art: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m5.5 17 4.2-5 3 3.5 2.4-2.6 3.4 4.1"/><circle cx="15.6" cy="9" r="1.3"/>'),
  onair: svg('<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>'),
  games: svg('<path d="M7.2 8h9.6a5 5 0 0 1 4.8 6.4l-1 3.3a2.4 2.4 0 0 1-4.2.7L14.8 16H9.2l-1.6 2.4a2.4 2.4 0 0 1-4.2-.7l-1-3.3A5 5 0 0 1 7.2 8z"/><path d="M8.2 11.3v3.2M6.6 12.9h3.2"/><circle cx="15.6" cy="12" r=".9" fill="currentColor"/><circle cx="17.8" cy="14" r=".9" fill="currentColor"/>'),
  listen: svg('<path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3"/><rect x="3.5" y="13.5" width="4" height="6" rx="2"/><rect x="16.5" y="13.5" width="4" height="6" rx="2"/>'),
  up: svg('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>'),
  comment: svg('<path d="M4.5 5.5h15v10h-8l-4 3.6v-3.6h-3z"/>'),
  share: svg('<path d="M12 14.5V3.8M8.4 7 12 3.4 15.6 7"/><path d="M8 11H6v9.4h12V11h-2"/>'),
  star: svg('<path d="m12 3.6 2.7 5.65 6.2.86-4.5 4.32 1.08 6.17L12 17.7l-5.48 2.9 1.08-6.17-4.5-4.32 6.2-.86z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.3 6.3 4.8 4.8M19.2 19.2l-1.5-1.5M17.7 6.3l1.5-1.5M4.8 19.2l1.5-1.5"/>'),
  moon: svg('<path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.4v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.2 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="m4.5 12.5 5 5 10-11"/>'),
  play: svg('<path d="M8 5.2v13.6L19 12z"/>'),
  pause: svg('<path d="M8.5 5v14M15.5 5v14" stroke-width="2.4"/>'),
  ext: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  left: svg('<path d="m14.5 6-6 6 6 6"/>'),
  right: svg('<path d="m9.5 6 6 6-6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'),
  shuffle: svg('<path d="M17 4.5 20.5 8 17 11.5M17 12.5 20.5 16 17 19.5M3.5 8h4.2l8.8 8h4M3.5 16h4.2l2.5-2.4"/>'),
  pin: svg('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  eye: svg('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  heart: svg('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
  trophy: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a3 3 0 0 0 3 4M17 6h2.5a3 3 0 0 1-3 4M12 14v3M8.5 20h7M9.5 17h5"/>'),
  live: svg('<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>'),
  tee: svg('<path d="M8 4 3.5 7.3 6 10.5l2-1.1V20h8V9.4l2 1.1 2.5-3.2L16 4a4 4 0 0 1-8 0z"/>'),
  mail: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>'),
};

/* ------------------------------------------------------------------- time */
export function agoShort(epochSec) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(epochSec || 0)));
  if (s < 90) return 'now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}
export const clockTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, ' ');

/* --------------------------------------------------------------- pictures */
/* A picture is either a URL (the real thing, lazy, reserving its box) or, in
   demo mode, the name of a placeholder palette from data/demo/palette.json.
   A real picture that fails to load is removed by the shell's error
   listener, so a broken image never leaves a grey hole. */
let PALETTE = Object.create(null);
export function setPalette(p) { PALETTE = p && typeof p === 'object' ? p : PALETTE; }

export function art(media) {
  const m = String(media || '');
  if (/^(https?:)?\/\//.test(m) || /^\.{0,2}\//.test(m)) {
    return '<img class="pic" src="' + esc(m) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
  }
  const p = PALETTE[m] || PALETTE.paper || ['', '', '', '', ''];
  return '<span class="ph ' + esc(p[3] || '') + '" style="--p1:' + esc(p[0]) + ';--p2:' + esc(p[1]) + ';--p3:' + esc(p[2]) +
    ';--sx:' + esc(p[4] || '70%') + '"></span>';
}

/* ------------------------------------------------------------ source mark */
const INIT = { 'Seven Days': '7D', 'r/burlington': 'r/', 'r/vermont': 'r/', 'Front Porch Forum': 'FPF', 'Burlington Twenty Somethings': '20s',
  'Vermont Public': 'VP', 'VTDigger': 'VTD', 'Burlington Free Press': 'BFP', 'Btown Brief': 'BB', 'The Brief': 'BB',
  'UVM Athletics': 'UVM', 'Vermontbiz': 'VB', 'The Verge': 'V', 'Ars Technica': 'Ars', 'Hello Burlington': 'HB',
  'Love Burlington': 'LB', 'NWS Burlington': 'NWS', 'Higher Ground': 'HG', 'Radio Bean': 'RB' };
export const initials = (name) => INIT[name] || String(name || '?').replace(/^[@#]/, '').split(/[\s_.]+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase().slice(0, 3);
const markHue = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 8; };
export const mark = (name, cls) => '<span class="mark ' + esc(cls || '') + '" style="--mk:var(--mark-' + markHue(name) + ')">' + esc(initials(name)) + '</span>';

/* --------------------------------------------------------------- controls */
export function button(label, cls, onClick) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/* chips: kinds of source, outlets, a table of contents. Labels are escaped
   here; an icon is trusted markup from ICON. */
export function chips(items, current, onPick, cls) {
  const row = el('div', 'chips' + (cls ? ' ' + cls : ''));
  items.forEach((c) => {
    const b = el('button', 'chip' + (c.key === current ? ' on' : '') + (c.cls ? ' ' + c.cls : ''),
      (c.icon || '') + '<span>' + esc(c.label) + '</span>' + (c.n != null ? '<span class="n">' + esc(c.n) + '</span>' : ''));
    b.setAttribute('aria-pressed', c.key === current ? 'true' : 'false');
    b.dataset.chip = c.key;
    b.addEventListener('click', () => onPick(c.key, b));
    row.appendChild(b);
  });
  /* a mouse wheel has no sideways: turn vertical wheel into horizontal scroll over a chip row */
  row.addEventListener('wheel', (e) => {
    if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    row.scrollLeft += e.deltaY; e.preventDefault();
  }, { passive: false });
  return row;
}

export function pills(options, current, onPick, cls) {
  const wrap = el('div', 'pills' + (cls ? ' ' + cls : ''));
  options.forEach(([v, label]) => {
    const b = el('button', v === current ? 'on' : '', esc(label));
    b.addEventListener('click', () => { [...wrap.children].forEach((c) => c.classList.toggle('on', c === b)); onPick(v); });
    wrap.appendChild(b);
  });
  return wrap;
}

/* A section head: 21px Lora title, a grey line, an optional control. `sub`
   is trusted markup (a tab may bold a number); pass esc() text into it. */
export function section(host, title, sub, right) {
  const h = el('div', 'sec');
  h.innerHTML = '<div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>';
  if (right) h.appendChild(right);
  host.appendChild(h);
  return h;
}
export function note(host, text, cls) { const n = el('p', 'note' + (cls ? ' ' + cls : ''), esc(text)); host.appendChild(n); return n; }

/* a horizontal shelf with a thin progress bar, so nobody mistakes it for a static row */
export function rail(host, cls) {
  const wrap = el('div', 'rail-wrap');
  const track = el('div', 'rail' + (cls ? ' ' + cls : ''));
  const bar = el('div', 'rail-bar', '<i></i>');
  wrap.append(track, bar);
  host.appendChild(wrap);
  const sync = () => {
    const view = track.clientWidth, total = Math.max(view, track.scrollWidth);
    const w = Math.max(12, Math.min(100, view / total * 100));
    const r = total > view ? track.scrollLeft / (total - view) : 0;
    bar.firstElementChild.style.width = w + '%';
    bar.firstElementChild.style.left = (r * (100 - w)) + '%';
    bar.hidden = total <= view + 4;
  };
  track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(sync).observe(track);
  setTimeout(sync, 0);
  return track;
}

export function divider(host, label, sub) {
  const d = el('div', 'tdiv', '<span>' + esc(label) + '</span>' + (sub ? '<span class="s">' + esc(sub) + '</span>' : ''));
  host.appendChild(d);
  return d;
}

/* The dateline: "Thursday, October 16" over "48 stories so far · updated
   2:10 pm", with ‹ › to walk days. prev/next are handlers or null. */
export function dateline({ title, sub, prev, next }) {
  const d = el('div', 'dateline');
  const p = el('button', 'iconbtn nav', ICON.left); p.setAttribute('aria-label', 'Earlier day');
  const n = el('button', 'iconbtn nav', ICON.right); n.setAttribute('aria-label', 'Later day');
  p.disabled = !prev; n.disabled = !next;
  if (prev) p.addEventListener('click', prev);
  if (next) n.addEventListener('click', next);
  d.append(p, el('span', 'dl', '<b>' + esc(title) + '</b><span class="s">' + esc(sub || '') + '</span>'), n);
  return d;
}

/* ---------------------------------------------- the Local / Everything switch */
/* One shared setting (store.settings().localOnly) and one shared body of
   water, the same first control on every tab that has a local half. Flipping
   it writes the setting and announces 'allday-geo'; the shell marks every
   other mounted tab stale so it redraws on the way in. */
export const geo = () => (store.settings().localOnly ? 'local' : 'everything');
export function setGeo(g) {
  const local = g !== 'everything';
  if ((geo() === 'local') === local) return;
  store.setSetting('localOnly', local);
  window.dispatchEvent(new CustomEvent('allday-geo', { detail: geo() }));
}

export function localSwitch(onChange) {
  const on = geo() === 'local';
  const bar = el('div', 'localsw' + (on ? ' is-on' : ''));
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Local or everything');
  const make = (wantOn, label) => {
    const b = el('button', 'localsw-half' + (on === wantOn ? ' on' : ''), label);
    b.setAttribute('aria-pressed', on === wantOn ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (on === wantOn) return;
      setGeo(wantOn ? 'local' : 'everything');
      if (onChange) onChange(geo());
    });
    return b;
  };
  bar.append(make(true, '<span class="localsw-leaf" aria-hidden="true">\u{1F341}</span><span>Local</span>'), make(false, '<span>Everything</span>'));
  pour(bar, { key: 'local', n: 2, idx: on ? 0 : 1, prop: on ? '--local' : '--every', fallback: on ? '#16704E' : '#A63A2C' });
  return bar;
}

/* ------------------------------------------------------------------ cards */
/* Source line above, title, media, then one action row. The same order on
   every card. A card is an <article class="card fi"> so gestures.js can
   swipe it; its identity is data-k. */

const voteN = (it) => (Number(it.votes) || 0) + store.voteCount(it.k);

function head(it, o) {
  const name = it.author || it.name || it.src;
  const bits = [];
  if (it.kind === 'pick') bits.push('<span class="eyebrow">' + esc(it.eyebrow || 'Today’s pick') + '</span><span class="dot"></span>');
  bits.push('<button class="srcbtn" data-src="' + esc(it.sid || it.src || name) + '">' + (it.avatar ? avatar(it, it.author ? 'round' : '') : mark(name, it.author ? 'round' : '')) +
    '<span class="c-src' + (it.local && o.greenLocal ? ' is-local' : '') + '">' + esc(name) + '</span></button>');
  if (it.handle) bits.push('<span class="via">' + esc(it.handle) + '</span>');
  if (it.via) bits.push('<span class="dot"></span><span class="via">' + esc(it.via) + '</span>');
  if (it.ago) bits.push('<span class="dot"></span><span>' + esc(it.ago) + '</span>');
  if (it.local && o.tagLocal) bits.push('<span class="tag tag-local">Local</span>');
  if (it.own) bits.push('<span class="tag tag-own">Btown Brief</span>');
  if (it.live) bits.push('<span class="tag tag-live">Live</span>');
  return '<div class="c-head">' + bits.join('') + '</div>';
}
const avatar = (it, cls) => '<span class="mark ' + esc(cls || '') + '">' + art(it.avatar) + '</span>';

function acts(it, only, o = {}) {
  const on = store.hasVoted(it.k);
  const saved = store.isSaved(it.k);
  const up = '<button class="act up' + (on ? ' on' : '') + '" data-act="up" aria-label="Upvote" aria-pressed="' + on + '">' + ICON.up + '<span class="n">' + (voteN(it) || '') + '</span></button>';
  const cm = '<button class="act cm" data-act="comment" aria-label="Comments">' + ICON.comment + '<span class="n">' + esc(it.comments || '') + '</span></button>';
  const sh = '<button class="act sh" data-act="share" aria-label="Share">' + ICON.share + '</button>';
  const st = '<button class="act star' + (saved ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + saved + '">' + ICON.star + '</button>';
  const open = it.open ? '<a class="act openlink" ' + linkAttrs(it) + '>' + esc(it.open) + ' ' + ICON.ext + '</a>' : '';
  return '<div class="c-acts">' + (only ? '' : up + (o.noComments ? '' : cm)) + sh + open + '<span class="sp"></span>' + st + '</div>';
}
const linkAttrs = (it) => 'href="' + esc(safeHref(it.href)) + '"' + (isExternal(it.href) ? ' target="_blank" rel="noopener"' : '') + ' data-open';
const title = (it) => '<a class="c-title" ' + linkAttrs(it) + '>' + esc(it.title || it.text) + '</a>';
const shell = (it, cls) => {
  const c = el('article', 'card fi ' + cls + (store.isRead(it.k) ? ' is-read' : ''));
  c.dataset.k = it.k;
  return c;
};
const ok = (it) => !!(it && it.k && it.href);

/* The tight row: the Wire's plain headline. Title and thumbnail, then one
   foot line carrying source, age, votes, comments and share; the star in its
   own column. */
function row(it, o = {}) {
  if (!ok(it)) return null;
  const c = shell(it, 'row' + (it.thumb ? ' has-thumb' : ''));
  const on = store.hasVoted(it.k);
  c.innerHTML = title(it) +
    (it.thumb ? '<a class="c-thumb sm" ' + linkAttrs(it) + ' tabindex="-1" aria-hidden="true">' + art(it.thumb) + '</a>' : '') +
    '<div class="c-foot">' +
      '<button class="srcbtn" data-src="' + esc(it.sid || it.src) + '">' + mark(it.src, 'xs') + '<span class="c-src' + (it.local && o.greenLocal ? ' is-local' : '') + '">' + esc(it.src) + '</span></button>' +
      (it.ago ? '<span class="dot"></span><span class="age">' + esc(it.ago) + '</span>' : '') +
      '<button class="mini up' + (on ? ' on' : '') + '" data-act="up" aria-label="Upvote" aria-pressed="' + on + '">' + ICON.up + '<span class="n">' + (voteN(it) || '') + '</span></button>' +
      (o.noComments ? '' : '<button class="mini cm" data-act="comment" aria-label="Comments">' + ICON.comment + '<span class="n">' + esc(it.comments || '') + '</span></button>') +
      '<button class="mini sh" data-act="share" aria-label="Share">' + ICON.share + '</button>' +
    '</div>' +
    '<button class="act star' + (store.isSaved(it.k) ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + store.isSaved(it.k) + '">' + ICON.star + '</button>';
  return c;
}

function headline(it, o = {}) {
  if (!o.full) return row(it, o);
  if (!ok(it)) return null;
  const c = shell(it, 'headline' + (it.thumb ? ' has-thumb' : ''));
  c.innerHTML = head(it, o) + '<div class="c-body"><div>' + title(it) + (it.text && o.excerpt ? '<p class="c-text">' + esc(it.text) + '</p>' : '') + '</div>' +
    (it.thumb ? '<a class="c-thumb" ' + linkAttrs(it) + ' tabindex="-1" aria-hidden="true">' + art(it.thumb) + '</a>' : '') + '</div>' + acts(it, false, o);
  return c;
}

/* an X post, a Facebook group post, a Reddit thread, a forum post */
function post(it, o = {}) {
  if (!ok(it)) return null;
  const c = shell(it, 'post');
  c.innerHTML = head(it, o) + '<div class="c-body"><div>' + (it.title ? title(it) : '') +
    '<p class="c-text' + (it.title ? '' : ' lead') + '">' + esc(it.text) + '</p></div></div>' +
    (it.media ? '<span class="c-media r169" data-zoom>' + art(it.media) + '</span>' : '') + acts(it, false, o);
  return c;
}

function pick(it, o = {}) {
  if (!ok(it)) return null;
  const c = shell(it, 'pick');
  c.innerHTML = head({ ...it, kind: 'pick' }, o) + (it.media ? '<a class="c-media r169" ' + linkAttrs(it) + ' tabindex="-1" aria-hidden="true">' + art(it.media) + '</a>' : '') +
    '<div class="c-body"><div>' + title(it) + (it.why ? '<p class="pick-why">' + esc(it.why) + '</p>' : '') + '</div></div>' + acts(it, false, o);
  return c;
}

function video(it, o = {}) {
  if (!ok(it)) return null;
  const c = shell(it, 'video');
  c.innerHTML = head(it, o) + '<span class="c-media r169" data-play role="button" tabindex="0" aria-label="Play ' + esc(it.title) + '">' + art(it.media) +
    '<span class="play">' + ICON.play + '</span>' + (it.dur ? '<span class="dur">' + esc(it.dur) + '</span>' : '') + '</span>' +
    '<div class="c-body"><div>' + title(it) + (it.why || it.text ? '<p class="c-text">' + esc(it.why || it.text) + '</p>' : '') + '</div></div>' + acts(it, false, o);
  return c;
}

function image(it, o = {}) {
  if (!ok(it)) return null;
  const c = shell(it, 'image');
  c.innerHTML = head(it, o) + '<span class="c-media ' + esc(it.ratio || 'r45') + '" data-zoom role="button" tabindex="0" aria-label="See it full screen">' + art(it.media) + '</span>' +
    '<div class="c-body"><p class="c-text">' + esc(it.text) + '</p></div>' + acts(it, false, o);
  return c;
}

function event(it, o = {}) {
  if (!ok(it)) return null;
  const c = shell(it, 'event');
  c.innerHTML = head(it, o) + '<div class="c-body"><div class="date"><span class="dow eyebrow">' + esc(it.dow) + '</span><span class="dom">' + esc(it.dom) + '</span></div>' +
    '<div>' + title(it) + '<p class="ev-meta">' + esc(it.when) + ' · ' + esc(it.where) + '</p>' +
    '<p class="ev-meta"><span class="price">' + esc(it.price) + '</span>' + (it.going ? ' · ' + esc(it.going) + ' going' : '') + '</p>' +
    (it.cta ? '<div class="p-cta"><button class="btn sm" data-cta>' + esc(it.cta) + '</button></div>' : '') + '</div></div>' + acts(it, false, o);
  return c;
}

function person(it) {
  if (!ok(it)) return null;
  const c = shell(it, 'person');
  c.innerHTML = '<div class="c-body">' + (it.avatar ? avatar(it, 'round xl') : mark(it.name, 'round xl')) + '<div><div class="c-head"><span class="c-src">' + esc(it.name) +
    '</span>' + (it.arch ? '<span class="dot"></span><span>' + esc(it.arch) + '</span>' : '') + (it.ago ? '<span class="dot"></span><span>' + esc(it.ago) + '</span>' : '') +
    '</div><p class="p-line">' + esc(it.line) + '</p>' +
    '<p class="c-text">' + esc(it.text) + '</p><div class="p-cta"><button class="btn" data-cta>' + esc(it.cta) + '</button>' +
    (it.going ? '<span class="going">' + esc(it.going) + '</span>' : '') + '</div></div></div>' + acts(it, true);
  return c;
}

const newline = (label) => el('div', 'newline', esc(label));

/* The end of a feed, and it says what it was the end of. Buttons are built
   by the caller with button(). */
function caught(opts) {
  const c = el('div', 'caught');
  c.innerHTML = (opts.check === false ? '' : '<div class="ck">' + ICON.check + '</div>') + '<h3>' + esc(opts.title) + '</h3>' +
    (opts.text ? '<p>' + esc(opts.text) + '</p>' : '') + '<div class="row"></div>' +
    (opts.fine ? '<p class="fine">' + esc(opts.fine) + '</p>' : '');
  const r = c.querySelector('.row');
  (opts.buttons || []).filter(Boolean).forEach((b) => r.appendChild(b));
  return c;
}

/* Any item by its kind. Returns null for an item that cannot be drawn (no
   key or no URL), so a caller can append-if. */
function any(it, o = {}) {
  if (!it) return null;
  if (it.kind === 'newline') return newline(it.label);
  const f = { headline, post, pick, video, image, event, person, audio: video }[it.kind] || headline;
  return f(it, o);
}

export const cards = { headline, row, post, pick, video, image, event, person, newline, caught, any };

/* append a card if it could be drawn */
export function put(host, node) { if (node) host.appendChild(node); return node; }
