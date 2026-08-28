/* modes/wander.js — the rabbit hole.

   Wikipedia as a place you go, not a link you follow. Everything here comes
   from the live MediaWiki APIs, which are CORS-open and need no key, so this
   mode has no server side at all.

   Two findings shaped the design, both measured rather than assumed:

   1. Random is the wrong primitive. Twelve real draws from list=random gave
      NOBLEX E-Optics GmbH, Bray Unknowns F.C., LU 213 grenade and nine more
      like them; filtering for "has a picture and a real intro" rescued 3 of
      20, and those three were a butterfly and a defunct Alberta electoral
      district. So nothing here draws from all of Wikipedia. It draws from
      pools of things that are already interesting: the ~4,200 entries on
      Wikipedia:Unusual articles, the last week's most-read, and what is
      within walking distance of City Hall Park. See
      scripts/build_wander_pool.py.

   2. The /page/related/ endpoint the docs recommend is retired — it answers
      403. The replacement is a morelike: search, which returns eight
      candidates with thumbnails and one-sentence extracts in a single 4.5 KB
      request, and is better anyway.

   The one rule the whole mode is built around: a link never leaves the app.
   Every internal link is intercepted, pushed onto a visible trail, and loaded
   in place. */

import { getURL, get } from '../wire.js';
import * as store from '../store.js';
import { esc, safeUrl } from '../ui.js';

const API = 'https://en.wikipedia.org/w/api.php';
const REST = 'https://en.wikipedia.org/api/rest_v1';
const BURLINGTON = { lat: 44.4759, lon: -73.2121 };

let root = null;
let ctx = null;
let pool = null;
let trail = [];
let peekTimer = 0;
let peekEl = null;

export default {
  mount(el, context) {
    root = el;
    ctx = context;
    trail = store.trail();

    root.innerHTML = '<div id="wa-view"></div>';
    root.addEventListener('click', onClick);
    bindPeek();

    loadPool();
    doorway();
  },

  deactivate() { hidePeek(); },

  focusSearch() {
    const box = root.querySelector('#wa-search');
    if (box) { box.focus(); return; }
    doorway();
    setTimeout(() => { const b = root.querySelector('#wa-search'); if (b) b.focus(); }, 60);
  },
};

/* ------------------------------------------------------------------- api */

function api(params) {
  const p = Object.assign({ action: 'query', format: 'json', origin: '*', formatversion: 2 }, params);
  return getURL(API + '?' + new URLSearchParams(p).toString());
}

function summary(title) {
  return getURL(REST + '/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')), 60 * 60 * 1000);
}

/* Eight where-to-next candidates with art and a sentence, in one request. */
function morelike(title) {
  return api({
    generator: 'search',
    gsrsearch: 'morelike:' + title,
    gsrlimit: 8,
    gsrnamespace: 0,
    prop: 'pageimages|description|extracts',
    piprop: 'thumbnail',
    pithumbsize: 400,
    exintro: 1,
    explaintext: 1,
    exsentences: 1,
  }).then(pagesOf);
}

function pagesOf(d) {
  const pages = (d && d.query && d.query.pages) || [];
  const list = Array.isArray(pages) ? pages : Object.values(pages);
  return list
    .filter((p) => p && p.title && !p.missing)
    .sort((a, b) => (a.index || 99) - (b.index || 99));
}

/* ------------------------------------------------------------------ pools */

function loadPool() {
  get('wanderPool')
    .then((res) => { pool = res.data; })
    .catch(() => {
      /* The nightly pool file may not be built yet. Fall back to a live pool
         so the mode works on day one; it is smaller but the same idea. */
      pool = null;
    });
}

/* Pool entries are either a bare title or {t, d} — the unusual pool carries
   the index's hand-written blurb, which is better copy than anything we
   could generate. */
function titleOf(entry) { return typeof entry === 'string' ? entry : (entry && entry.t) || ''; }

function poolList(which) {
  return (pool && pool.pools && pool.pools[which]) || [];
}

function drawFromPool(which) {
  const list = poolList(which);
  if (list.length) {
    return Promise.resolve(titleOf(list[Math.floor(Math.random() * list.length)]));
  }
  // The nightly file may not exist yet. Live fallback: yesterday's most-read.
  return livePopular().then((l) => l[Math.floor(Math.random() * l.length)]);
}

let popularCache = null;
function livePopular() {
  if (popularCache) return Promise.resolve(popularCache);
  const d = new Date(Date.now() - 36 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return getURL('https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/' +
    y + '/' + m + '/' + day, 6 * 3600 * 1000)
    .then((res) => {
      const arts = (res.items && res.items[0] && res.items[0].articles) || [];
      popularCache = arts
        .map((a) => a.article)
        .filter((t) => !/^(Main_Page|Special:|Wikipedia:|Portal:|Category:|File:|Talk:|Help:)/.test(t))
        .filter((t) => !/^(List_of|Lists_of|Deaths_in|\d{4}_)/.test(t))
        .slice(0, 600)
        .map((t) => t.replace(/_/g, ' '));
      return popularCache;
    })
    .catch(() => ['Voynich manuscript', 'Dyatlov Pass incident', 'Antikythera mechanism']);
}

/* --------------------------------------------------------------- doorway */

function doorway() {
  const resume = trail.length > 1
    ? '<button class="door" data-open="' + esc(trail[0].title) + '">' +
        '<span class="ic">↩</span><span><span class="dt">Back down yesterday\'s hole</span>' +
        '<span class="ds">' + esc(trail[0].title.toUpperCase()) + ' → ' + (trail.length - 1) + ' MORE</span></span>' +
        '<span class="arr">→</span></button>'
    : '';

  root.querySelector('#wa-view').innerHTML =
    '<div class="wrap">' +
      '<div class="page-head">' +
        '<h1>Wander</h1>' +
        '<p class="sub">Wikipedia, but you never have to leave. Pick a door, then follow the ' +
          'blue links as far as they go.</p>' +
      '</div>' +
      '<div class="searchwrap">' +
        '<input class="searchbox" id="wa-search" type="search" placeholder="Look something up" autocomplete="off">' +
        '<div id="wa-results"></div>' +
      '</div>' +
      '<div class="doors">' +
        '<button class="door big" data-draw="mixed"><span class="ic">🎲</span>' +
          '<span><span class="dt">Take me somewhere</span><span class="ds">ONE TAP · NO DECISIONS</span></span>' +
          '<span class="arr">→</span></button>' +
        '<button class="door" data-door="weird"><span class="ic">🌀</span>' +
          '<span><span class="dt">The weird stuff</span><span class="ds" id="wa-n-unusual">WIKIPEDIA\'S OWN ODDITIES</span></span>' +
          '<span class="arr">→</span></button>' +
        '<button class="door" data-door="near"><span class="ic">📍</span>' +
          '<span><span class="dt">Near here</span><span class="ds">WITHIN WALKING DISTANCE</span></span>' +
          '<span class="arr">→</span></button>' +
        '<button class="door" data-draw="popular"><span class="ic">📈</span>' +
          '<span><span class="dt">What everyone\'s reading</span><span class="ds">YESTERDAY\'S MOST-READ</span></span>' +
          '<span class="arr">→</span></button>' +
        '<button class="door" data-door="today"><span class="ic">📅</span>' +
          '<span><span class="dt">On this day</span><span class="ds" id="wa-today">' + todayLabel() + '</span></span>' +
          '<span class="arr">→</span></button>' +
        resume +
      '</div>' +
      '<div id="wa-door-body"></div>' +
      (trail.length ? trailHistoryHTML() : '') +
    '</div>';

  const box = root.querySelector('#wa-search');
  let t = 0;
  box.addEventListener('input', () => {
    clearTimeout(t);
    const q = box.value.trim();
    if (q.length < 2) { root.querySelector('#wa-results').innerHTML = ''; return; }
    t = setTimeout(() => runSearch(q), 200);
  });

  if (poolList('unusual').length) {
    const n = poolList('unusual').length;
    const el = root.querySelector('#wa-n-unusual');
    if (el) el.textContent = n.toLocaleString() + ' CURATED ODDITIES';
  }
}

function todayLabel() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toUpperCase();
}

function trailHistoryHTML() {
  return '<h2 class="sec">Where you\'ve been</h2>' +
    '<div class="trail">' + trail.slice(0, 14).map((h, i) =>
      (i ? '<i>←</i>' : '') + '<button data-open="' + esc(h.title) + '">' + esc(h.title) + '</button>'
    ).join('') + '</div>';
}

/* ------------------------------------------------------------ door bodies */

function nearHere(lat, lon, label) {
  const body = root.querySelector('#wa-door-body');
  body.innerHTML = '<p class="loading">Looking around…</p>';
  api({ list: 'geosearch', gscoord: lat + '|' + lon, gsradius: 10000, gslimit: 30 })
    .then((d) => {
      const hits = (d.query && d.query.geosearch) || [];
      if (!hits.length) { body.innerHTML = '<div class="empty"><b>Nothing nearby</b></div>'; return; }
      return api({
        titles: hits.map((h) => h.title).slice(0, 30).join('|'),
        prop: 'pageimages|description',
        piprop: 'thumbnail',
        pithumbsize: 300,
      }).then((meta) => {
        const info = {};
        pagesOf(meta).forEach((p) => { info[p.title] = p; });
        body.innerHTML = '<h2 class="sec">Near ' + esc(label) + '</h2><div class="wa-cards">' +
          hits.map((h) => cardHTML(h.title, info[h.title], Math.round(h.dist) + ' m away')).join('') +
          '</div>';
      });
    })
    .catch(() => { body.innerHTML = '<div class="empty"><b>Couldn\'t look around</b></div>'; });
}

/* The index's own blurbs are the draw here — scrolling thirty of them is a
   rabbit hole before you have opened anything. Shuffle deals thirty more. */
function weirdList() {
  const body = root.querySelector('#wa-door-body');
  const list = poolList('unusual');
  if (!list.length) {
    body.innerHTML = '<p class="loading">The weird list isn\'t built yet — try "Take me somewhere".</p>';
    return;
  }
  const picks = [];
  const used = {};
  while (picks.length < 30 && picks.length < list.length) {
    const i = Math.floor(Math.random() * list.length);
    if (used[i]) continue;
    used[i] = 1;
    picks.push(list[i]);
  }
  body.innerHTML =
    '<h2 class="sec">The weird stuff <button class="chip" data-door="weird" style="margin-left:10px">Shuffle</button></h2>' +
    '<p class="faint" style="margin:-8px 0 12px;font-size:.86rem">' +
      list.length.toLocaleString() + ' pages Wikipedia\'s own editors flagged as strange. ' +
      'The descriptions are theirs.</p>' +
    '<div class="wa-weird">' + picks.map((e) =>
      '<button class="wa-weird-row" data-open="' + esc(titleOf(e)) + '">' +
        '<b>' + esc(titleOf(e)) + '</b>' +
        (e.d ? '<span>' + esc(e.d) + '</span>' : '') +
      '</button>').join('') + '</div>';
  body.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function onThisDay() {
  const body = root.querySelector('#wa-door-body');
  body.innerHTML = '<p class="loading">Checking the calendar…</p>';
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  getURL(REST + '/feed/onthisday/selected/' + mm + '/' + dd, 6 * 3600 * 1000)
    .then((res) => {
      const sel = (res.selected || []).slice(0, 12);
      if (!sel.length) { body.innerHTML = '<div class="empty"><b>A quiet day in history</b></div>'; return; }
      body.innerHTML = '<h2 class="sec">On ' + esc(todayLabel().toLowerCase()) + '</h2>' +
        '<div class="wa-otd">' + sel.map((ev) => {
          const p = (ev.pages || [])[0];
          const title = p ? p.title : '';
          const thumb = p && p.thumbnail ? p.thumbnail.source : '';
          return '<button class="wa-otd-row" data-open="' + esc(title) + '">' +
            (thumb ? '<img src="' + esc(safeUrl(thumb)) + '" alt="" loading="lazy">' : '<span class="wa-otd-nothumb"></span>') +
            '<span><b class="wa-year">' + esc(ev.year) + '</b>' + esc(ev.text) + '</span></button>';
        }).join('') + '</div>';
    })
    .catch(() => { body.innerHTML = '<div class="empty"><b>Couldn\'t reach the calendar</b></div>'; });
}

function runSearch(q) {
  api({
    generator: 'search',
    gsrsearch: q,
    gsrlimit: 6,
    gsrnamespace: 0,
    prop: 'pageimages|description',
    piprop: 'thumbnail',
    pithumbsize: 200,
  })
    .then((d) => {
      const hits = pagesOf(d);
      root.querySelector('#wa-results').innerHTML = hits.length
        ? '<div class="wa-results">' + hits.map((p) =>
            '<button data-open="' + esc(p.title) + '"><b>' + esc(p.title) + '</b>' +
            (p.description ? '<span>' + esc(p.description) + '</span>' : '') + '</button>').join('') + '</div>'
        : '<p class="faint" style="padding:10px 2px;font-size:.86rem">Nothing found.</p>';
    })
    .catch(() => { /* leave the last results up */ });
}

function cardHTML(title, info, note) {
  const thumb = info && info.thumbnail ? info.thumbnail.source : '';
  const desc = (info && info.description) || '';
  return '<button class="card wa-card" data-open="' + esc(title) + '">' +
    (thumb ? '<img class="wa-card-img" src="' + esc(safeUrl(thumb)) + '" alt="" loading="lazy" decoding="async">'
           : '<span class="wa-card-img wa-card-noimg"></span>') +
    '<span class="wa-card-body">' +
      '<span class="wa-card-t">' + esc(title) + '</span>' +
      (desc ? '<span class="wa-card-d">' + esc(desc) + '</span>' : '') +
      (note ? '<span class="wa-card-n">' + esc(note) + '</span>' : '') +
    '</span></button>';
}

/* --------------------------------------------------------------- article */

function open(title, opts) {
  const view = root.querySelector('#wa-view');
  view.innerHTML = '<div class="wrap"><p class="loading">Opening ' + esc(title) + '…</p></div>';
  root.scrollTop = 0;

  if (!opts || !opts.noPush) pushTrail(title);

  Promise.all([
    api({ action: 'parse', page: title, prop: 'text|displaytitle', redirects: 1 })
      .catch(() => null),
    summary(title).catch(() => null),
  ]).then(([parsed, sum]) => {
    if (!parsed || !parsed.parse) {
      view.innerHTML = '<div class="wrap"><div class="empty"><b>Couldn\'t open that one</b>' +
        'It may have moved. <button class="btn" data-home style="margin-top:14px">Back to the doors</button></div></div>';
      return;
    }
    const realTitle = (sum && sum.titles && sum.titles.normalized) || parsed.parse.title || title;
    const k = store.keyOf('wiki:' + realTitle);
    ctx.index(k, {
      k,
      kind: 'wiki',
      t: realTitle,
      u: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(realTitle.replace(/ /g, '_')),
      s: 'Wikipedia',
      i: sum && sum.thumbnail ? sum.thumbnail.source : '',
    });

    const article = clean(parsed.parse.text);
    const on = store.isSaved(k);

    view.innerHTML =
      '<div class="wa-trailbar">' +
        '<button class="wa-home" data-home aria-label="Back to the doors">✕</button>' +
        '<div class="wa-crumbs">' + crumbsHTML() + '</div>' +
        '<span class="wa-depth">' + trail.length + ' deep</span>' +
      '</div>' +
      '<div class="wrap wa-article">' +
        '<h1 class="wa-title">' + esc(realTitle) + '</h1>' +
        (sum && sum.description ? '<p class="wa-desc">' + esc(sum.description) + '</p>' : '') +
        '<div class="wa-acts">' +
          '<button class="btn" data-save="' + esc(k) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
            (on ? 'Saved' : 'Save') + '</button>' +
          '<button class="btn" data-draw="mixed">Somewhere else</button>' +
          '<a class="btn" href="https://en.wikipedia.org/wiki/' +
            esc(encodeURIComponent(realTitle.replace(/ /g, '_'))) +
            '" target="_blank" rel="noopener">On Wikipedia ↗</a>' +
        '</div>' +
        '<div class="wa-body" id="wa-body"></div>' +
        '<div id="wa-next"><p class="loading">Finding where to go next…</p></div>' +
      '</div>';

    root.querySelector('#wa-body').appendChild(article);
    nextShelf(realTitle);
  });
}

/* Turn Wikipedia's article HTML into something that belongs in this app:
   strip the furniture, neutralise anything executable, and convert every
   internal link into an in-app navigation. */
function clean(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  body.querySelectorAll(
    'script, style, link, meta, iframe, object, embed, form, ' +
    '.mw-editsection, .navbox, .vertical-navbox, .metadata, .mbox-text, ' +
    'table.ambox, table.ombox, .sistersitebox, .portal, .noprint, ' +
    '#toc, .toc, .reflist, .mw-references-wrap, .refbegin, .navigation-not-searchable, ' +
    '.mw-empty-elt, .shortdescription, .hatnote + .hatnote, sup.reference, ' +
    '.mw-cite-backlink, .error, .plainlinks .external'
  ).forEach((n) => n.remove());

  // Nothing survives that can execute or navigate outside our control.
  body.querySelectorAll('*').forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      if (a.name === 'style' && /expression|url\s*\(/i.test(a.value)) n.removeAttribute('style');
    });
  });

  body.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) { unwrap(a); return; }          // citation jumps, nothing to jump to
    const m = /^\/wiki\/([^#?]+)/.exec(href);
    if (m) {
      const t = decodeURIComponent(m[1]).replace(/_/g, ' ');
      if (/^(File|Image|Category|Template|Help|Portal|Wikipedia|Special|Talk):/i.test(t)) {
        unwrap(a);
        return;
      }
      a.setAttribute('data-wiki', t);
      a.removeAttribute('href');
      a.setAttribute('role', 'link');
      a.setAttribute('tabindex', '0');
      a.className = 'wl';
      return;
    }
    const abs = safeUrl(href.startsWith('//') ? 'https:' + href : href);
    if (abs) {
      a.setAttribute('href', abs);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener nofollow');
      a.className = 'wx';
    } else unwrap(a);
  });

  body.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    img.setAttribute('src', src.startsWith('//') ? 'https:' + src : src);
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    img.removeAttribute('srcset');
  });

  // Infoboxes are table hell on a phone. Keep the picture, fold the rest away.
  body.querySelectorAll('table.infobox').forEach((t) => {
    const img = t.querySelector('img');
    const det = doc.createElement('details');
    det.className = 'wa-infobox';
    const sum = doc.createElement('summary');
    sum.textContent = 'The facts box';
    det.appendChild(sum);
    if (img) {
      const fig = doc.createElement('div');
      fig.className = 'wa-infoimg';
      fig.appendChild(img.cloneNode(true));
      t.parentNode.insertBefore(fig, t);
    }
    t.parentNode.insertBefore(det, t);
    det.appendChild(t);
  });

  const frag = doc.createElement('div');
  while (body.firstChild) frag.appendChild(body.firstChild);
  return frag;
}

function unwrap(a) {
  const parent = a.parentNode;
  while (a.firstChild) parent.insertBefore(a.firstChild, a);
  parent.removeChild(a);
}

/* Where to go next: morelike candidates, plus a couple of links drawn from
   the article you just read, because the best next thing is often something
   the writer already mentioned. */
function nextShelf(title) {
  const slot = root.querySelector('#wa-next');
  if (!slot) return;

  const inline = [...root.querySelectorAll('#wa-body p .wl')]
    .map((a) => a.getAttribute('data-wiki'))
    .filter((t, i, arr) => t && arr.indexOf(t) === i);

  morelike(title)
    .then((list) => {
      const seen = { [title]: 1 };
      const cards = [];
      list.forEach((p) => {
        if (seen[p.title]) return;
        seen[p.title] = 1;
        cards.push(cardHTML(p.title, p, p.extract ? '' : ''));
      });
      const extras = inline.filter((t) => !seen[t]).slice(0, 3);
      return Promise.all(extras.length
        ? [api({ titles: extras.join('|'), prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: 300 })]
        : []
      ).then(([meta]) => {
        if (meta) pagesOf(meta).forEach((p) => cards.push(cardHTML(p.title, p, 'mentioned above')));
        slot.innerHTML = '<h2 class="sec">Where to next</h2>' +
          '<div class="wa-cards">' + cards.slice(0, 8).join('') + '</div>' +
          '<button class="more-btn" data-draw="mixed">Somewhere else entirely ↯</button>';
      });
    })
    .catch(() => {
      slot.innerHTML = '<button class="more-btn" data-draw="mixed">Somewhere else entirely ↯</button>';
    });
}

/* ----------------------------------------------------------------- trail */

function pushTrail(title) {
  trail = trail.filter((h) => h.title !== title);
  trail.unshift({ title, at: Math.floor(Date.now() / 1000) });
  store.setTrail(trail);
}

function crumbsHTML() {
  return trail.slice(0, 8).reverse().map((h, i, arr) =>
    '<button data-open="' + esc(h.title) + '"' + (i === arr.length - 1 ? ' class="on"' : '') + '>' +
    esc(h.title) + '</button>').join('<i>›</i>');
}

/* ------------------------------------------------------------------ peek */
/* Press and hold a link to see what is behind it without losing your place.
   This is the mechanic that turns reading into wandering. */

function bindPeek() {
  root.addEventListener('pointerdown', (e) => {
    const a = e.target.closest('.wl');
    if (!a) return;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => showPeek(a), 420);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
    root.addEventListener(ev, () => clearTimeout(peekTimer)));
  root.addEventListener('scroll', hidePeek, { passive: true });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.wl')) e.preventDefault(); });
}

function showPeek(a) {
  const title = a.getAttribute('data-wiki');
  if (!title) return;
  hidePeek();

  peekEl = document.createElement('div');
  peekEl.className = 'wa-peek';
  peekEl.innerHTML = '<p class="loading" style="padding:18px">…</p>';
  document.body.appendChild(peekEl);
  place(a);

  summary(title)
    .then((s) => {
      if (!peekEl) return;
      const thumb = s.thumbnail ? safeUrl(s.thumbnail.source) : '';
      peekEl.innerHTML =
        (thumb ? '<img src="' + esc(thumb) + '" alt="">' : '') +
        '<div class="wa-peek-body">' +
          '<b>' + esc(s.title) + '</b>' +
          (s.description ? '<i>' + esc(s.description) + '</i>' : '') +
          '<p>' + esc((s.extract || '').slice(0, 220)) + '</p>' +
          '<button class="btn primary" data-open="' + esc(s.title) + '">Go there</button>' +
        '</div>';
      place(a);
    })
    .catch(() => hidePeek());
}

function place(a) {
  if (!peekEl) return;
  const r = a.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 24);
  peekEl.style.width = w + 'px';
  let left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
  const below = window.innerHeight - r.bottom;
  peekEl.style.left = left + 'px';
  if (below > 230) { peekEl.style.top = (r.bottom + 8) + 'px'; peekEl.style.bottom = 'auto'; }
  else { peekEl.style.bottom = (window.innerHeight - r.top + 8) + 'px'; peekEl.style.top = 'auto'; }
}

function hidePeek() {
  clearTimeout(peekTimer);
  if (peekEl) { peekEl.remove(); peekEl = null; }
}

/* ---------------------------------------------------------------- events */

function onClick(e) {
  if (peekEl && !peekEl.contains(e.target)) {
    const inPeek = e.target.closest('.wa-peek');
    if (!inPeek) hidePeek();
  }

  const link = e.target.closest('.wl');
  if (link) { e.preventDefault(); hidePeek(); open(link.getAttribute('data-wiki')); return; }

  const openBtn = e.target.closest('[data-open]');
  if (openBtn) { hidePeek(); open(openBtn.getAttribute('data-open')); return; }

  if (e.target.closest('[data-home]')) { hidePeek(); doorway(); return; }

  const draw = e.target.closest('[data-draw]');
  if (draw) {
    const which = draw.getAttribute('data-draw');
    draw.disabled = true;
    const kind = which === 'mixed'
      ? (Math.random() < 0.55 ? 'unusual' : 'popular')
      : which;
    drawFromPool(kind)
      .then((title) => { draw.disabled = false; if (title) open(title); })
      .catch(() => { draw.disabled = false; ctx.toast('Wikipedia didn\'t answer — try again'); });
    return;
  }

  if (e.target.closest('[data-door="near"]')) {
    nearHere(BURLINGTON.lat, BURLINGTON.lon, 'City Hall Park');
    return;
  }
  if (e.target.closest('[data-door="weird"]')) { weirdList(); return; }
  if (e.target.closest('[data-door="today"]')) { onThisDay(); return; }
}
