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
     going, cta, name, arch, line, show, src_audio, yt (a YouTube id).
   A board post (kind 'board', made by boards.item()) adds id, metaLine,
   place, voted, mine and left ("19d left"). */

import * as store from './store.js';
import { attach as pour } from './liquid.js';
import { mapUrl, oneLine } from './clubs-week.js';

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
  habits: svg('<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.4 2.6 2.6 5-5.4"/>'),
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
  flag: svg('<path d="M5.5 21V4.5M5.5 4.5h11l-2.2 4 2.2 4h-11"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  down: svg('<path d="m6 9.5 6 6 6-6"/>'),
  trash: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>'),
  /* the apps' own: All Day is the Wire's pulse */
  body: svg('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M7.5 12.5h2.6l1.2-2.2 1.8 3.6 1.2-1.4h2.2"/>'),
  town: svg('<path d="M3.5 20.5h17M5 20.5V10l4-3 4 3v10.5M13 20.5V6.5l3.5-3 3.5 3v14"/><path d="M8 13.5h2M8 16.5h2M16 9.5h1M16 12.5h1M16 15.5h1"/>'),
  paper: svg('<path d="M5 4.5h12v14a2 2 0 0 0 2 2H6.5A1.5 1.5 0 0 1 5 19z"/><path d="M17 8.5h2.5V18.5a2 2 0 0 1-2 2M8 8h6M8 11.5h6M8 15h4"/>'),
  /* the apps' bottom tabs */
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  calcheck: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4.5"/>'),
  ball: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5v17M6 6a9 9 0 0 1 0 12M18 6a9 9 0 0 0 0 12"/>'),
  tag: svg('<path d="M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7z"/><circle cx="8" cy="9" r="1.4"/>'),
  reddit: svg('<ellipse cx="12" cy="14.5" rx="8.5" ry="5.8"/><path d="M12 8.7 13 4l4 1"/><circle cx="18.4" cy="5.2" r="1.4"/><circle cx="8.8" cy="13.6" r="1" fill="currentColor" stroke="none"/><circle cx="15.2" cy="13.6" r="1" fill="currentColor" stroke="none"/><path d="M9 17c1.9 1 4.1 1 6 0"/>'),
  spark: svg('<path d="M12 3.5 13.9 10 20.5 12l-6.6 2L12 20.5 10.1 14 3.5 12l6.6-2z"/>'),
  bowl: svg('<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0zM9 20h6M8.5 8c0-1.6 1.4-1.6 1.4-3.2M13.5 8c0-1.6 1.4-1.6 1.4-3.2"/>'),
  basket: svg('<path d="M3.5 10h17l-2 9.5h-13zM8 10l3-6M16 10l-3-6M9 13.5v3M15 13.5v3M12 13.5v3"/>'),
  table: svg('<path d="M3.5 9.5h17M6 9.5 4.5 20M18 9.5l1.5 10.5M8 14h8"/><circle cx="8" cy="5" r="1.6"/><circle cx="12" cy="4.5" r="1.6"/><circle cx="16" cy="5" r="1.6"/>'),
  user: svg('<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  hand: svg('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0v6M14 10.5V6a1.5 1.5 0 0 1 3 0v7c0 4.2-2.6 7.5-6.5 7.5-2.7 0-4.2-1.6-5.6-3.8L3.6 13.9a1.4 1.4 0 0 1 2.3-1.6L8 15"/>'),
  paw: svg('<circle cx="7" cy="10" r="1.8"/><circle cx="10.5" cy="6.2" r="1.8"/><circle cx="14.5" cy="6.2" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M12.5 11.5c-2.6 0-5.5 4-5.5 6.3 0 1.6 1.3 2.4 2.7 2.4 1.2 0 1.8-.6 2.8-.6s1.6.6 2.8.6c1.4 0 2.7-.8 2.7-2.4 0-2.3-2.9-6.3-5.5-6.3z"/>'),
  dumbbell: svg('<path d="M3 12h18M6 8v8M3.5 9.5v5M18 8v8M20.5 9.5v5M8 12h8"/>'),
  leaf: svg('<path d="M5 19c0-8 5.5-13.5 15-14-.4 9.5-6 15-14 15M5 19l7-7"/>'),
  mind: svg('<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9.4"/>'),
  soundOn: svg('<path d="M4.5 9.5v5h3.5l4.5 4v-13l-4.5 4zM16 9a4.2 4.2 0 0 1 0 6M18.5 6.5a7.8 7.8 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4.5 9.5v5h3.5l4.5 4v-13l-4.5 4zM16.5 9.5l4 5M20.5 9.5l-4 5"/>'),
  drop: svg('<path d="M12 3.5s-6.5 7-6.5 11.2a6.5 6.5 0 0 0 13 0C18.5 10.5 12 3.5 12 3.5z"/>'),
  bell: svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  columns: svg('<path d="M3.5 9 12 4l8.5 5zM4.5 20.5h15M6.5 11v7M10 11v7M14 11v7M17.5 11v7"/>'),
  cone: svg('<path d="M10 4h4l4.5 14.5h-13zM8 11h8M6.7 15h10.6M3.5 20.5h17"/>'),
  book: svg('<path d="M4.5 5.5c3-1.4 5.5-1.4 7.5.5 2-1.9 4.5-1.9 7.5-.5v13c-3-1.4-5.5-1.4-7.5.5-2-1.9-4.5-1.9-7.5-.5zM12 6v13"/>'),
  briefcase: svg('<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5h6v2M3.5 12.5h17"/>'),
  pencil: svg('<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM13.5 7l3 3"/>'),
  party: svg('<path d="M4 20.5 8.5 7l8.5 8.5zM14 4.5c0 1.5 1.5 1.5 1.5 3M19.5 9c-1.5 0-1.5 1.5-3 1.5M11 3.5v1.5M20.5 13h-1.5"/>'),
  stack: svg('<path d="M12 4 3.5 8.5 12 13l8.5-4.5zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>'),
  grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  /* the mast's app switcher, and Add to home screen */
  apps: svg('<circle cx="6" cy="6" r="1.7"/><circle cx="12" cy="6" r="1.7"/><circle cx="18" cy="6" r="1.7"/><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/><circle cx="6" cy="18" r="1.7"/><circle cx="12" cy="18" r="1.7"/><circle cx="18" cy="18" r="1.7"/>'),
  home: svg('<path d="M4 11 12 4l8 7M6 9.5V20h12V9.5"/><path d="M12 11.5v6M9 14.5h6"/>'),
};

/* ------------------------------------------------------------------- time */
export function agoShort(epochSec) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(epochSec || 0)));
  if (s < 90) return 'now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

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
    b.type = 'button';   // inside a form (the profile sheet) a pill must not submit it
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

/* "See as a list" (Stephen, 2026-10-18, and again 2026-10-19: "I like
   horizontal scroll, but there must ALWAYS be the option to get out of it").
   Every sideways content row is drawn with listRail(), not rail(): a
   "See as a list" button above it (it reads "See as a row" once opened), and
   under it, only while it is a list, the Collapse bar (DESIGN §9.3's one
   sticky exception) that folds it back and returns to its heading. The
   choice is this phone's, per row (localStorage in try). A chip row of
   filters is not a content row; the allday spec fails a new shelf that
   forgets the button.
     name   the saved key and data-rail
     label  what the button and Collapse say they act on
     cls    extra classes for the row
     cells  open as a grid of cards at least this many px wide, not one column
     onMode (rail, isList) on each change of mode, for a row whose list reads in another order */
const LIST_KEYS = ['allday-rail-lists', 'allday-onair-lists'];   // the second is On Air's first home for it
let listMem = null;
function listed() {
  if (listMem) return listMem;
  listMem = Object.create(null);
  try {
    LIST_KEYS.forEach((k) => {
      const v = JSON.parse(localStorage.getItem(k) || '{}');
      if (v && typeof v === 'object') Object.keys(v).forEach((n) => { if (v[n] === 1) listMem[n] = 1; });
    });
  } catch (e) { /* storage blocked */ }
  return listMem;
}
function setListed(name, on) {
  const m = listed();
  if (on) m[name] = 1; else delete m[name];
  try { localStorage.setItem(LIST_KEYS[0], JSON.stringify(m)); } catch (e) { /* kept for the visit */ }
}
let jumpFn = (n) => n.scrollIntoView({ block: 'start' });
/* the shell hands over its own jumpTo, which knows where the mast ends */
export function setJump(fn) { jumpFn = fn; }

/* the bar under an opened list: it rides the bottom of the screen while the
   list is on it, so a long list folds back up from anywhere in it */
export function collapseBar(what, onCollapse) {
  const bar = el('div', 'collapsebar');
  const b = button(ICON.up + ' Collapse', '', (e) => { e.preventDefault(); e.stopPropagation(); onCollapse(); });
  b.type = 'button';
  b.dataset.collapse = '1';
  b.setAttribute('aria-label', 'Collapse ' + what);
  bar.appendChild(b);
  return bar;
}

export function listRail(host, o) {
  const name = o.name, what = o.label || 'this row';
  const top = el('div', 'railmode');
  const btn = el('button', 'btn sm ghost');
  btn.type = 'button';
  btn.dataset.railmode = name;
  top.appendChild(btn);
  host.appendChild(top);
  const r = rail(host, [o.cls, o.cells ? 'cells' : ''].filter(Boolean).join(' '));
  r.dataset.rail = name;
  if (o.cells) r.style.setProperty('--cell', o.cells + 'px');
  const foot = collapseBar(what, () => {
    setListed(name, false);
    paint();
    r.scrollLeft = 0;
    jumpFn(top.previousElementSibling || top);
    btn.focus({ preventScroll: true });
  });
  foot.classList.add('foot');
  host.appendChild(foot);
  function paint() {
    const on = !!listed()[name];
    r.classList.toggle('aslist', on);
    btn.textContent = on ? 'See as a row' : 'See as a list';
    btn.setAttribute('aria-label', btn.textContent + ': ' + what);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    foot.hidden = !on;
    if (o.onMode) o.onMode(r, on);
  }
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    setListed(name, !listed()[name]);
    paint();
    r.scrollLeft = 0;
  });
  paint();
  return r;
}

/* A grid that grows down on purpose (Stephen, 2026-10-22: "I only see one
   row but I want to see more rows ... a see more at the end so you can keep
   on going down ... you're choosing to"). It opens on three rows of two on a
   phone (two rows of three, or of four on a wide screen: .vgrid's columns),
   "See more" adds as many again, and once it has grown the shell's Collapse
   bar rides the bottom of the screen and folds it back to its first rows
   and its heading. `last` (a closing tile, as Make a tee's whole shop)
   always ends what shows. How far a grid is open lasts the visit, across
   repaints, so `name` is unique across the tabs.
     moreGrid(host, { name, label, head, cells, last }) */
const grown = Object.create(null);
const pageSize = () => {
  const cols = window.matchMedia('(min-width: 1024px)').matches ? 4 : window.matchMedia('(min-width: 560px)').matches ? 3 : 2;
  return cols * (cols === 2 ? 3 : 2);
};
export function moreGrid(host, o) {
  const g = el('div', 'vgrid');
  g.dataset.grid = o.name;
  o.cells.forEach((c) => g.appendChild(c));
  if (o.last) g.appendChild(o.last);
  host.appendChild(g);
  const step = pageSize();
  const first = step - (o.last ? 1 : 0);
  const row = el('div', 'linkrow vmore');
  const more = button(esc('See more'), 'ghost');
  more.type = 'button';
  more.dataset.more = o.name;
  more.setAttribute('aria-label', 'See more of ' + o.label);
  row.appendChild(more);
  const foot = collapseBar(o.label, () => {
    grown[o.name] = 0;
    paint();
    jumpFn(o.head || g);
    more.focus({ preventScroll: true });
  });
  foot.classList.add('foot');
  host.append(row, foot);
  function paint() {
    const shown = Math.max(first, grown[o.name] || 0);
    o.cells.forEach((c, i) => { c.hidden = i >= shown; });
    row.hidden = shown >= o.cells.length;
    foot.hidden = shown <= first;
  }
  more.addEventListener('click', () => { grown[o.name] = Math.max(first, grown[o.name] || 0) + step; paint(); });
  paint();
  return g;
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

/* ------------------------------- the Local / National / Everything switch */
/* Two shared settings and one shared body of water, the same first control on
   every tab that has a local half. localOnly is the one every reader already
   has, so a stored choice keeps meaning what it meant; nationalOnly is only
   ever true with localOnly false. Flipping it writes the settings and
   announces 'allday-geo'; the shell marks every other mounted tab stale so it
   redraws on the way in. */
export const geo = () => {
  const s = store.settings();
  return s.localOnly ? 'local' : s.nationalOnly ? 'national' : 'everything';
};
/* does the switch let this item through? National is everything not local */
export const geoKeeps = (isLocal) => {
  const g = geo();
  return g === 'everything' || (g === 'local') === !!isLocal;
};
export function setGeo(g) {
  const to = g === 'national' || g === 'everything' ? g : 'local';
  if (to === geo()) return;
  store.setSetting('nationalOnly', to === 'national');
  store.setSetting('localOnly', to === 'local');
  window.dispatchEvent(new CustomEvent('allday-geo', { detail: geo() }));
}

const GEO_SEGS = [
  ['local', '<span class="localsw-leaf" aria-hidden="true">\u{1F341}</span><span>Local</span>', '--local', '#16704E'],
  ['national', '<span>National</span>', '--national', '#2A5DA8'],
  ['everything', '<span>Everything</span>', '--every', '#A63A2C'],
];
export function localSwitch(onChange) {
  const now = geo();
  const bar = el('div', 'localsw geosw' + (now === 'local' ? ' is-on' : now === 'national' ? ' is-nat' : ''));
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Local, national or everything');
  GEO_SEGS.forEach(([g, label]) => {
    const b = el('button', 'localsw-half' + (g === now ? ' on' : ''), label);
    b.dataset.geo = g;
    b.setAttribute('aria-pressed', g === now ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (g === now) return;
      setGeo(g);
      if (onChange) onChange(geo());
    });
    bar.appendChild(b);
  });
  const idx = GEO_SEGS.findIndex(([g]) => g === now);
  pour(bar, { key: 'local', n: GEO_SEGS.length, idx, prop: GEO_SEGS[idx][2], fallback: GEO_SEGS[idx][3] });
  return bar;
}

/* ------------------------------------------------ the Real life / Online switch */
/* The second shared switch (2026-10-29, Stephen's memo: "online / real-life
   toggle, plus Local / Everything"), drawn and poured like Local /
   Everything and shown only on a tab that mixes doing and reading (the
   shell decides: app.isMixed). One shared setting, store.settings().world,
   'irl' (the start) or 'online'; flipping it announces 'allday-world'. A
   section says which side it is with data-world="irl" | "online"; the
   shell shows only that side's sections and leaves untagged ones alone. */
export const world = () => (store.settings().world === 'online' ? 'online' : 'irl');
export function setWorld(w) {
  const next = w === 'online' ? 'online' : 'irl';
  if (world() === next) return;
  store.setSetting('world', next);
  window.dispatchEvent(new CustomEvent('allday-world', { detail: next }));
}
export function worldSwitch(onChange) {
  const on = world() === 'irl';
  const bar = el('div', 'localsw worldsw' + (on ? ' is-on' : ''));
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Real life or online');
  const make = (wantOn, label, side) => {
    const b = el('button', 'localsw-half' + (on === wantOn ? ' on' : ''), label);
    b.type = 'button';
    b.dataset.world = side;
    b.setAttribute('aria-pressed', on === wantOn ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (on === wantOn) return;
      setWorld(side);
      if (onChange) onChange(world());
    });
    return b;
  };
  bar.append(make(true, '<span>Real life</span>', 'irl'), make(false, '<span>Online</span>', 'online'));
  pour(bar, { key: 'world', n: 2, idx: on ? 0 : 1, prop: on ? '--liq-irl' : '--liq-online', fallback: on ? '#F2A93B' : '#7A5BB0' });
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

/* A reader's post on a tab's board (boards.js). The author's first name
   leads where a source would, then the post: its photo, title, the tab's
   one-line summary of its fields, the words, the place. The action row is
   the board's own: a vote that counts this board's votes, share, report
   (someone else's post) or delete (your own), and save. The buttons carry
   data-act names boards.js answers through app.onAct(). */
function board(it) {
  if (!ok(it)) return null;
  const c = shell(it, 'board');
  const head = '<div class="c-head">' + mark(it.author, 'round') + '<span class="c-src">' + esc(it.author) + '</span>' +
    (it.arch ? '<span class="dot"></span><span class="via">' + esc(it.arch) + '</span>' : '') +
    (it.ago ? '<span class="dot"></span><span>' + esc(it.ago) + '</span>' : '') +
    (it.left ? '<span class="tag tag-left">' + esc(it.left) + '</span>' : '') + '</div>';
  const media = it.media ? '<span class="c-media ' + esc(it.ratio || 'r45') + '" data-zoom role="button" tabindex="0" aria-label="See it full screen">' + art(it.media) + '</span>' : '';
  const words = '<div class="c-body"><div><p class="c-title b-title">' + esc(it.title) + '</p>' +
    (it.metaLine ? '<p class="b-meta">' + esc(it.metaLine) + '</p>' : '') +
    (it.text ? '<p class="c-text">' + esc(it.text) + '</p>' : '') +
    (it.place ? '<p class="b-place">' + ICON.pin + '<span>' + esc(it.place) + '</span></p>' : '') + '</div></div>';
  const saved = store.isSaved(it.k);
  const row = '<div class="c-acts">' +
    '<button class="act up' + (it.voted ? ' on' : '') + '" data-act="bvote" aria-label="Vote" aria-pressed="' + !!it.voted + '">' + ICON.up + '<span class="n">' + (it.votes || '') + '</span></button>' +
    '<button class="act sh" data-act="share" aria-label="Share">' + ICON.share + '</button>' +
    (it.mine ? '<button class="act del" data-act="bdelete" aria-label="Delete your post">' + ICON.trash + '</button>'
      : '<button class="act rep" data-act="breport" aria-label="Report">' + ICON.flag + '</button>') +
    '<span class="sp"></span><button class="act star' + (saved ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + saved + '">' + ICON.star + '</button></div>';
  c.innerHTML = head + media + words + row;
  return c;
}

/* The Wire's two story cards (2026-10-19 rebuild: "simple, everything
   filled to the screen ... glanceable"). Both end in the same meta line,
   Source · time on the left, then "⋯" (vote, share, the original, the
   source, mute: data-act="wmore", answered by the tab through app.onAct)
   and the star, each a 44px target.
     lead   a top story: the picture full width at 16:9, the headline in
            Lora, the one-line reason, the meta line. o.rank numbers it.
     story  every other item: a square picture on the left when there is
            one, the headline (three lines at most), the meta line. A post
            (X, Facebook, Reddit) is the same row with the post's words.
   o.meta is extra trusted markup for the meta line (a "Local" word); o.tag
   is an eyebrow above the headline ("The Brief"). */
function wmeta(it, o) {
  const saved = store.isSaved(it.k);
  const voted = store.hasVoted(it.k);
  /* the words sit in one box that can take a second line on a narrow
     row ("National" beside a long source), so ⋯ and the star never leave
     the card */
  return '<div class="w-meta">' + (o.rank ? '<span class="w-rank">' + esc(o.rank) + '</span>' : '') +
    '<span class="w-who"><button class="srcbtn" data-src="' + esc(it.sid || it.src) + '"><span class="c-src' + (it.local && o.greenLocal ? ' is-local' : '') + '">' + esc(it.src) + '</span></button>' +
    (it.via ? '<span class="dot"></span><span class="via">' + esc(it.via) + '</span>' : '') +
    (it.ago ? '<span class="dot"></span><span class="age">' + esc(it.ago) + '</span>' : '') + (o.meta || '') + '</span>' +
    /* the upvote with its count and Share stay on the card (Stephen,
       2026-10-20: "I see you cut the Share button ... Please re-add", "add
       the upvote button too"); ⋯ keeps the rest */
    (o.noActs ? '' : '<button class="act up w-up' + (voted ? ' on' : '') + '" data-act="up" aria-label="Upvote" aria-pressed="' + voted + '">' + ICON.up + '<span class="n">' + (voteN(it) || '') + '</span></button>' +
      '<button class="act sh w-sh" data-act="share" aria-label="Share">' + ICON.share + '</button>') +
    '<button class="act w-more" data-act="wmore" aria-label="More: the original, the source, mute">' + ICON.more + '</button>' +
    '<button class="act star' + (saved ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + saved + '">' + ICON.star + '</button></div>';
}
function lead(it, o = {}) {
  if (!ok(it)) return null;
  const c = shell(it, 'wlead' + (it.media ? ' has-pic' : '') + (o.cls ? ' ' + o.cls : ''));
  c.innerHTML = (it.media ? '<a class="w-pic" ' + linkAttrs(it) + ' tabindex="-1" aria-hidden="true">' + art(it.media) + '</a>' : '') +
    '<div class="w-body">' + (o.tag ? '<span class="eyebrow">' + esc(o.tag) + '</span>' : '') + title(it) +
    (it.why ? '<p class="w-dek">' + esc(it.why) + '</p>' : '') + wmeta(it, o) + '</div>';
  return c;
}
function story(it, o = {}) {
  if (!ok(it)) return null;
  const words = !it.title && it.text;
  const c = shell(it, 'wrow' + (it.thumb ? ' has-thumb' : '') + (words ? ' wpost' : '') + (o.cls ? ' ' + o.cls : ''));
  c.innerHTML = (it.thumb ? '<a class="w-thumb" ' + linkAttrs(it) + ' tabindex="-1" aria-hidden="true">' + art(it.thumb) + '</a>' : '') +
    '<div class="w-body">' + (o.tag ? '<span class="eyebrow">' + esc(o.tag) + '</span>' : '') + title(it) +
    (it.line ? '<p class="w-line">' + esc(it.line) + '</p>' : '') + wmeta(it, o) + '</div>';
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
  const f = { headline, post, pick, video, image, event, person, board, audio: video }[it.kind] || headline;
  return f(it, o);
}

export const cards = { headline, row, post, pick, video, image, event, person, board, lead, story, newline, caught, any };

/* A club's weekly meet as a list row, the one People's week and What Now's
   windows both draw: the start time in the tile, the club, where and the
   pace, the newcomer line (each one line), and the place's map as the one
   pill. `o` is a clubs-week.js occurrence; tapping the row calls onOpen(o).
   `day` puts the day ahead of the place ("Tomorrow"). A club with no web
   page is not drawn (rule 4). */
export function meetRow(o, onOpen, opts = {}) {
  const c = o && o.club, m = o && o.meet;
  if (!c || !m || !/^https?:/i.test(String(c.url || ''))) return null;
  const [hm, ap] = String(o.time || '').split(' ');
  const r = el('div', 'lrow meet');
  r.dataset.k = o.k;
  r.dataset.club = c.id;
  r.dataset.at = String(o.at);
  const place = oneLine(m.where, 48), pace = oneLine(c.level, 48), newbie = oneLine(c.newcomers, 90);
  const open = el('button', 'open', '<div class="t">' + esc(c.name) + '</div>' +
    '<div class="s one">' + (opts.day ? '<b>' + esc(opts.day) + '</b> · ' : '') + esc([place, pace].filter(Boolean).join(' · ')) + '</div>' +
    (newbie ? '<div class="s one nb">' + esc(newbie) + '</div>' : ''));
  open.type = 'button';
  open.setAttribute('aria-label', c.name + ', ' + (opts.day ? opts.day + ' ' : '') + o.time + ', ' + m.where);
  if (onOpen) open.addEventListener('click', () => onOpen(o));
  const map = mapUrl(m);
  let right = el('span');
  if (map) {
    right = el('a', 'pillbtn map', ICON.pin + ' Map');
    right.href = safeHref(map);
    right.target = '_blank';
    right.rel = 'noopener';
    right.setAttribute('aria-label', 'Map: ' + m.where);
  }
  r.append(el('span', 'th tm', '<b>' + esc(hm) + '</b><span>' + esc(ap || '') + '</span>'), open, right);
  return r;
}

/* append a card if it could be drawn */
export function put(host, node) { if (node) host.appendChild(node); return node; }
