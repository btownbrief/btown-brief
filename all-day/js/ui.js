/* ui.js — the small shared vocabulary every mode renders with.

   Rendering is string concatenation into innerHTML, the same as the pages this
   app replaces, so esc() and safeUrl() are not optional politeness: every
   value here comes off a feed someone else controls. safeUrl admits http and
   https only, which is what keeps a javascript: URL in a feed item from
   becoming a link. */

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function safeUrl(u) {
  try {
    const p = new URL(u, location.href);
    if (p.protocol === 'http:' || p.protocol === 'https:') return p.href;
  } catch (e) { /* not a url */ }
  return '';
}

/* Relative time, tightened for a dense feed: minutes for the first hour,
   then hours, then days. */
export function ago(sec) {
  const s = Math.floor(Date.now() / 1000) - Number(sec || 0);
  if (!isFinite(s) || s < 0) return '';
  if (s < 90) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd';
  const mo = Math.floor(d / 30);
  return mo < 12 ? mo + 'mo' : Math.floor(mo / 12) + 'y';
}

/* Longer form, for cards where a date reads better than an age. */
export function agoLong(sec) {
  const d = Math.floor((Date.now() / 1000 - Number(sec || 0)) / 86400);
  if (!isFinite(d)) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return d + 'd ago';
  const mo = Math.floor(d / 30);
  return mo < 12 ? mo + 'mo ago' : Math.floor(mo / 12) + 'y ago';
}

export function fmtViews(n) {
  const v = Number(n || 0);
  if (!v) return '';
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M views';
  if (v >= 1e3) return Math.round(v / 1e3) + 'K views';
  return v + ' views';
}

export function secsToClock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

/* One restrained hue per topic, matching css/pulse.css so a source reads the
   same colour here as it does there. */
export function topicClass(topic) {
  const known = ['local', 'news', 'tech', 'business', 'science', 'culture',
    'politics', 'sports', 'gaming', 'newsletters'];
  return known.indexOf(topic) >= 0 ? 'c-' + topic : '';
}

export function isReddit(src) {
  return !!(src && src.site && src.site.indexOf('reddit.com') >= 0);
}

/* r/burlington out of a thread or subscription URL. */
export function subOf(url) {
  const m = /reddit\.com\/(r\/[^/?#]+)/.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
}

/* YouTube thumbnails: maxres does not exist for every video, so every <img>
   that asks for one carries the hq fallback and wireFallbacks() attaches it. */
export function ytThumb(id, big) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(id || ''))) return '';
  return 'https://i.ytimg.com/vi/' + id + '/' + (big ? 'maxresdefault' : 'mqdefault') + '.jpg';
}

export function wireFallbacks(root) {
  root.querySelectorAll('img[data-fallback]').forEach((img) => {
    img.addEventListener('error', function onErr() {
      const alt = img.getAttribute('data-fallback');
      img.removeAttribute('data-fallback');
      img.removeEventListener('error', onErr);
      if (alt) img.src = alt;
      else img.remove();
    }, { once: false });
  });
}

/* The bookmark control every mode uses, so a save looks and behaves the same
   whatever it is you are saving. */
export function saveBtn(key, on) {
  return '<button class="ad-save" data-save="' + esc(key) + '" aria-pressed="' +
    (on ? 'true' : 'false') + '">' + (on ? 'Saved' : 'Save') + '</button>';
}

export function loading(msg) {
  return '<p class="loading">' + esc(msg || 'Loading…') + '</p>';
}

export function empty(title, sub) {
  return '<div class="empty"><b>' + esc(title) + '</b>' + esc(sub || '') + '</div>';
}

/* Deterministic shuffle so a "shuffle" button gives a new order on demand but
   a re-render inside one visit does not reorder under the reader's thumb. */
export function sampleN(list, n, seed) {
  const a = list.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, n);
}
