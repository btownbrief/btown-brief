/* wander.js — Wikipedia, read inside the app.

   Two screens on one hash. #wander is the doorway, #wander/{Title} is the
   reader, so Back walks the rabbit hole in reverse and the trail shows how
   deep you went.

   The doorway leads with things you can tap immediately. Making someone
   press a category button before seeing a single article is a door in front
   of a door — the rails are populated on arrival and every pool can be
   reshuffled or opened out into a full list in place.

   The search box sits above the big button on purpose: arriving with
   something in mind is at least as common as wanting to be surprised.

   THE SANITIZER is the load-bearing part. mobile-html is ~360KB of markup
   anyone on earth can edit, and it gets injected into this page. Every rule
   below was checked against a real payload and the comments say what breaks
   without it. It hands back live nodes rather than an HTML string: the
   serialise-and-reparse round trip is exactly what mutation-XSS exploits. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, rail, heading, chip, scrollHint, ICON } from './../ui.js';

const REST = 'https://en.wikipedia.org/api/rest_v1/';
const ACTION = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&';
const HERE = '44.48|-73.21';

/* namespaces that must not become in-app links — the reader only renders
   mainspace, so these degrade to plain text */
const NS_PLAIN = /^(Special|File|Image|Media|Wikipedia|Help|Category|Template|Talk|Portal|Draft|User|Module|MediaWiki|Book)(\s+talk)?:/i;

const POOLS = [
  ['unusual', '🙃', 'Weird stuff', 'The strangest pages on Wikipedia, with their own jokes attached'],
  ['vermont', '🍁', 'Near here', 'Everything within twelve kilometres of City Hall'],
  ['onthisday', '📅', 'On this day', 'What happened on this date, year by year'],
  ['popular', '🔥', 'What everyone is reading', 'The most-read articles of the past week'],
];

const state = {
  root: null, pool: null, live: Object.create(null), at: null, gen: 0,
  expanded: Object.create(null), shuffle: Object.create(null), suggestTimer: 0,
};

export function mount(root) {
  state.root = root;
  data.load('pool', (json) => { state.pool = json.pools; if (!state.at) renderDoor(); }, () => {
    if (!state.at) renderDoor();
  });
  loadOnThisDay();
}

/* Eastern day, because that is the day the reader is in — and the feed has
   no entry for a date that has not arrived in UTC yet, so fall back a day
   rather than showing an empty shelf. */
function etDay(offset) {
  const d = new Date(Date.now() - (offset || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '/');
}

function loadOnThisDay(offset) {
  const day = etDay(offset || 0);
  data.fetchJSON(REST + 'feed/featured/' + day, 10000)
    .then((j) => {
      const seen = new Set();
      const out = [];
      (j.onthisday || []).forEach((ev) => {
        const page = (ev.pages || [])[0];
        const title = page && page.titles && page.titles.normalized;
        /* one event often anchors several pages, and the feed repeats a page
           across related entries — keep the first mention */
        if (!title || seen.has(title)) return;
        seen.add(title);
        out.push({ t: title, d: (ev.year ? ev.year + ' · ' : '') + (ev.text || '').slice(0, 120) });
      });
      if (!out.length) throw new Error('empty');
      state.live.onthisday = out;
      if (!state.at) renderDoor();
    })
    .catch(() => { if (!offset) loadOnThisDay(1); });
}

export function activate(param) {
  if (param) openReader(param);
  else { state.at = null; renderDoor(); }
}

export function deactivate() {
  clearTimeout(state.suggestTimer);
  app.closePeek();
}

const go = (title) => app.go('wander', title);
const pretty = (t) => String(t || '').replace(/_/g, ' ');
/* Two kinds of pool. Three come off the nightly file; "on this day" is
   fetched live, because a list of what happened on this date is stale the
   moment the date turns and it is one request to get right. */
const list = (key) => (Array.isArray(state.live[key]) ? state.live[key]
  : (state.pool && Array.isArray(state.pool[key]) ? state.pool[key] : []));

/* A stable-per-shuffle sample, so re-rendering does not reshuffle underneath
   a finger already moving toward a card. */
function sample(key, n) {
  const pool = list(key);
  if (!pool.length) return [];
  const seed = state.shuffle[key] || 0;
  const start = seed % Math.max(1, pool.length);
  const out = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) out.push(pool[(start + i * 7) % pool.length]);
  return out;
}

/* ------------------------------------------------------------ doorway */

function renderDoor() {
  const root = state.root;
  root.innerHTML = '';

  const door = el('section', 'door');
  door.appendChild(el('h1', null, 'Wander'));
  door.appendChild(el('p', null,
    'Six million articles. One tap and you are seven deep — still in the app, with a trail of where you went.'));

  const search = el('div', 'search');
  search.innerHTML =
    '<svg class="mag" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>' +
    '<input id="wq" type="search" autocomplete="off" placeholder="Look something up">' +
    '<div class="suggest" id="wsug" hidden></div>';
  door.appendChild(search);

  const dice = el('button', 'btn btn-big', '🎲 Take me somewhere');
  dice.addEventListener('click', takeMeSomewhere);
  door.appendChild(dice);
  root.appendChild(door);

  const input = search.querySelector('#wq');
  input.addEventListener('input', () => {
    clearTimeout(state.suggestTimer);
    const term = input.value.trim();
    if (term.length < 2) { hideSuggest(); return; }
    state.suggestTimer = setTimeout(() => suggest(term), 220);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    root.querySelector('#wsug button')?.click();
  });

  renderTrail(root);
  renderSaved(root);
  POOLS.forEach(([key, emoji, name, sub]) => renderPool(root, key, emoji, name, sub));

  if (!state.pool) root.appendChild(el('p', 'loading', 'Loading the pools…'));
}

function hideSuggest() {
  const s = state.root.querySelector('#wsug');
  if (s) { s.hidden = true; s.innerHTML = ''; }
}

function suggest(term) {
  data.fetchJSON(ACTION + 'action=opensearch&limit=8&search=' + encodeURIComponent(term), 8000)
    .then((r) => {
      const box = state.root.querySelector('#wsug');
      if (!box) return;
      const titles = r?.[1] || [];
      const descs = r?.[2] || [];
      if (!titles.length) { hideSuggest(); return; }
      box.innerHTML = '';
      titles.forEach((t, i) => {
        const b = el('button', null,
          esc(t) + (descs[i] ? '<span class="d">' + esc(descs[i]) + '</span>' : ''));
        b.addEventListener('click', () => { hideSuggest(); go(t); });
        box.appendChild(b);
      });
      box.hidden = false;
    })
    .catch(hideSuggest);
}

function renderPool(root, key, emoji, name, sub) {
  const pool = list(key);
  if (!pool.length) return;
  const open = !!state.expanded[key];

  const box = el('div', 'pool');
  const head = el('button', 'pool-head');
  head.innerHTML =
    '<span class="pool-emoji">' + emoji + '</span>' +
    '<span><span class="pool-name">' + esc(name) + '</span>' +
      '<span class="pool-sub">' + esc(sub) + ' · ' + pool.length.toLocaleString() + '</span></span>' +
    '<span class="chev">' + (open ? '▴' : '▾') + '</span>';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');

  const shuffle = el('button', 'iconbtn', ICON.shuffle);
  shuffle.setAttribute('aria-label', 'Shuffle ' + name);
  shuffle.addEventListener('click', (e) => {
    e.stopPropagation();
    state.shuffle[key] = (state.shuffle[key] || 0) + 1 + Math.floor(Math.random() * 13);
    renderDoor();
  });
  head.insertBefore(shuffle, head.lastElementChild);
  head.addEventListener('click', () => { state.expanded[key] = !open; renderDoor(); });
  box.appendChild(head);

  const body = el('div', 'pool-body');
  const { track, sync } = rail(body, { label: 'to read' });
  sample(key, open ? 30 : 12).forEach((entry) => track.appendChild(doorCard(entry)));
  sync();
  box.appendChild(body);
  root.appendChild(box);
}

function doorCard(entry) {
  const title = (entry && entry.t) || entry;
  const card = el('button', 'doorcard');
  card.innerHTML = '<span class="t">' + esc(pretty(title)) + '</span>' +
    (entry && entry.d ? '<span class="d">' + esc(entry.d) + '</span>' : '');
  card.addEventListener('click', () => go(title));
  return card;
}

function renderTrail(root) {
  const t = store.trail();
  if (!t.length) return;
  heading(root, { eyebrow: 'Where you have been', title: 'Your trail' });
  const row = el('div', 'trail');
  t.slice().reverse().slice(0, 14).forEach((title) => {
    const c = el('button', 'tchip' + (title === state.at ? ' here' : ''), esc(pretty(title)));
    c.addEventListener('click', () => go(title));
    row.appendChild(c);
  });
  const clear = el('button', 'tchip', 'Clear');
  clear.addEventListener('click', () => { store.clearTrail(); renderDoor(); });
  row.appendChild(clear);
  root.appendChild(row);
  scrollHint(row);
}

function renderSaved(root) {
  const saved = store.saved().filter((i) => i.kind === 'wiki');
  if (!saved.length) return;
  heading(root, { eyebrow: 'Saved articles', title: 'Kept for later' });
  const row = el('div', 'trail');
  saved.forEach((i) => {
    const c = el('button', 'tchip here', '★ ' + esc(pretty(i.title)));
    c.addEventListener('click', () => go(i.k));
    row.appendChild(c);
  });
  root.appendChild(row);
  scrollHint(row);
}

function takeMeSomewhere() {
  const buckets = [];
  if (list('unusual').length) buckets.push({ w: 4, key: 'unusual' });
  if (list('vermont').length) buckets.push({ w: 3, key: 'vermont' });
  if (list('onthisday').length) buckets.push({ w: 2, key: 'onthisday' });
  if (list('popular').length) buckets.push({ w: 2, key: 'popular' });
  const total = buckets.reduce((n, b) => n + b.w, 0);
  if (!total) {
    data.fetchJSON(REST + 'page/random/summary', 10000)
      .then((s) => { if (s?.titles) go(s.titles.canonical || s.titles.normalized); })
      .catch(() => app.toast('Wikipedia is not answering — try again'));
    return;
  }
  let roll = Math.random() * total;
  let pick = buckets[0];
  for (const b of buckets) { roll -= b.w; if (roll <= 0) { pick = b; break; } }
  const pool = list(pick.key);
  const entry = pool[Math.floor(Math.random() * pool.length)];
  go((entry && entry.t) || entry);
}

/* ------------------------------------------------------------- reader */

function openReader(title) {
  const root = state.root;
  const gen = ++state.gen;          // anything older than this is stale
  state.at = title;
  root.innerHTML = '<p class="loading">Opening ' + esc(pretty(title)) + '…</p>';
  root.scrollTop = 0;
  let summary = null;

  data.fetchJSON(REST + 'page/summary/' + encodeURIComponent(title), 10000)
    .then((s) => {
      if (gen !== state.gen) throw new Error('superseded');
      summary = s;
      const canonical = s?.titles?.canonical;
      /* redirects resolve here; replaceState rather than a new hash so Back
         does not bounce between an alias and its target */
      if (canonical && canonical !== title) {
        title = canonical;
        state.at = title;
        try { history.replaceState(null, '', '#wander/' + encodeURIComponent(title)); } catch (e) { /* fine */ }
      }
      return data.fetchText(REST + 'page/mobile-html/' + encodeURIComponent(title), 20000);
    })
    .then((raw) => {
      if (gen !== state.gen) return;
      store.pushTrail(title);
      renderArticle(title, raw, summary);
    })
    /* a request the reader has already navigated away from must not replace
       what they are actually reading, error card included */
    .catch(() => { if (gen === state.gen) readerError(title); });
}

function readerError(title) {
  const root = state.root;
  root.innerHTML = '';
  const box = el('div', 'errbox',
    '<p><b>' + esc(pretty(title)) + '</b> would not open — either Wikipedia has no such article, or the connection dropped.</p>');
  const btns = el('div', 'btns');
  const retry = el('button', 'btn', 'Try again');
  retry.addEventListener('click', () => openReader(title));
  const home = el('button', 'btn btn-quiet', 'Back to the doorway');
  home.addEventListener('click', () => app.go('wander'));
  btns.append(retry, home);
  box.appendChild(btns);
  root.appendChild(box);
}

function unwrap(node, keepChildren) {
  const parent = node.parentNode;
  if (!parent) return;
  if (keepChildren) while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

function sanitize(raw) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  /* the lead image lives in <head>, which is about to go */
  let lead = doc.querySelector('meta[property="mw:leadImage"]')?.getAttribute('content') || null;
  /* it comes from the same untrusted document and has had none of the URL
     rules applied, so hold it to the same standard */
  if (lead && lead.startsWith('//')) lead = 'https:' + lead;
  if (lead && !/^https:\/\//i.test(lead)) lead = null;

  /* RULE 1. Every post-lead <section> ships style="display:none" and the
     page's own JS reveals them. Miss this and the article renders as a
     single paragraph and looks broken. */
  doc.querySelectorAll('section[style]').forEach((s) => {
    if (/display\s*:\s*none/i.test(s.getAttribute('style') || '')) s.removeAttribute('style');
  });

  /* RULE 2. Body inner only. The <base href="//en.wikipedia.org/wiki/">
     dies with the head — a relative URL that leaked past us would resolve
     against wikipedia.org and break our own chrome. */
  const body = doc.body;

  /* RULE 3. Nothing executable, nothing that restyles the page. <base> is
     listed as well as dying with the head: Parsoid puts it in <head>, but a
     <base> anywhere in the body would still repoint every relative URL. */
  body.querySelectorAll('script, style, link, meta, base, iframe, form, input, object, embed, template, noscript')
    .forEach((n) => n.remove());
  body.querySelectorAll('*').forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      else if (/^(href|src|srcset|action|formaction|xlink:href)$/i.test(a.name) &&
               /^\s*(javascript|data):/i.test(a.value)) n.removeAttribute(a.name);
    });
  });

  /* RULE 4 (before rule 5, deliberately). Every citation is an <a> pointing
     at ./ThisArticle#cite_note-N. Left alone, rule 5 would turn all 700 of
     them into in-app links back to the page you are already on. */
  body.querySelectorAll('sup.mw-ref').forEach((sup) => {
    const note = document.createElement('sup');
    note.className = 'wikinote';
    note.textContent = '†';
    sup.replaceWith(note);
  });
  body.querySelectorAll('.mw-references-wrap, ol.mw-references, .reflist, .references, .pcs-ref, [id^="cite_note"]')
    .forEach((n) => n.remove());

  /* RULE 5. //host/… → https://host/… */
  body.querySelectorAll('[href], [src], [srcset]').forEach((n) => {
    ['href', 'src', 'srcset'].forEach((attr) => {
      const v = n.getAttribute(attr);
      if (v && v.slice(0, 2) === '//') n.setAttribute(attr, 'https:' + v);
    });
  });

  /* RULE 6. Parsoid ./Title → in-app, namespace → plain, redlink → text.
     Unwrapping keeps CHILD NODES, never textContent: File: links wrap the
     images, and textContent would silently delete every picture. */
  body.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/\/w\/index\.php\?|action=edit|redlink=1/.test(href) || a.classList.contains('new')) {
      unwrap(a, true);
      return;
    }
    const m = href.match(/^(?:\.\/|\/wiki\/)([^?#]+)/);
    if (m) {
      const target = decodeURIComponent(m[1]).replace(/_/g, ' ');
      if (NS_PLAIN.test(target)) {
        const span = document.createElement('span');
        span.className = 'plain-link';
        while (a.firstChild) span.appendChild(a.firstChild);
        a.replaceWith(span);
      } else {
        /* mw-redirect links stay clickable — REST resolves redirects */
        a.setAttribute('data-wiki', target);
        a.setAttribute('href', '#wander/' + encodeURIComponent(target));
        a.removeAttribute('target');
      }
    } else if (/^https?:\/\//i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    } else {
      a.removeAttribute('href');
    }
  });

  /* RULE 7. Every id and name goes. Wikipedia uses them for section anchors
     we already strip, and leaving them lets a page carrying id="theme-btn"
     — or "vbox", or "sheet" — win a document-wide getElementById and bind
     the app's own handlers to article content. `name` goes for the same
     reason: named elements land on window. */
  body.querySelectorAll('[id], [name]').forEach((n) => {
    n.removeAttribute('id');
    n.removeAttribute('name');
  });

  /* RULE 8. Inline styles are Wikipedia's own table and float layout and are
     worth keeping — except the positioning ones, which would let article
     content lift itself out of the reader and sit on top of the app. */
  body.querySelectorAll('[style]').forEach((n) => {
    const v = n.getAttribute('style') || '';
    if (/position\s*:\s*(fixed|sticky|absolute)|z-index/i.test(v)) {
      n.setAttribute('style', v.replace(/(^|;)\s*(position|z-index|top|left|right|bottom)\s*:[^;]*/gi, ''));
    }
  });

  /* RULE 9. Furniture out; wide tables kept but boxed so they can scroll. */
  body.querySelectorAll(
    'table.infobox, .infobox, .navbox, .metadata, .mw-empty-elt, .mw-editsection, ' +
    '.pcs-edit-section-link, .mw-kartographer-map, .mw-kartographer-container, ' +
    '.pcs-fold-hr, .hatnote-container'
  ).forEach((n) => n.remove());
  body.querySelectorAll('table').forEach((t) => {
    if (t.closest('.table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.parentNode.insertBefore(wrap, t);
    wrap.appendChild(t);
  });

  /* Live nodes, NOT body.innerHTML. Serialising to a string and reparsing it
     into the page is the classic mutation-XSS setup: a few elements
     (svg/style, math/annotation-xml, noembed, xmp) serialise to markup that
     reparses with a different meaning, which is how a sanitised tree turns
     back into a live script. Adopting the nodes skips the second parse. */
  return { body, lead };
}

function renderArticle(title, raw, summary) {
  const root = state.root;
  const clean = sanitize(raw);
  const hero = clean.lead || summary?.originalimage?.source || summary?.thumbnail?.source;
  root.innerHTML = '';

  const trailBox = el('div');
  renderTrail(trailBox);
  root.appendChild(trailBox);

  if (hero) {
    const img = el('img', 'reader-hero');
    img.src = hero;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    root.appendChild(img);
  }

  const art = el('article', 'reader');
  while (clean.body.firstChild) art.appendChild(document.adoptNode(clean.body.firstChild));
  root.appendChild(art);
  wireLinks(art);

  const acts = el('div', 'reader-acts');
  const rec = { k: title, kind: 'wiki', title: pretty(title), from: 'Wikipedia', href: '#wander/' + encodeURIComponent(title) };
  const save = el('button', 'btn btn-quiet', store.isSaved(title) ? '★ Saved' : '☆ Save');
  save.addEventListener('click', () => {
    save.textContent = store.toggleSaved(rec) ? '★ Saved' : '☆ Save';
  });
  const worm = el('button', 'btn btn-quiet', '🌀 Wormhole');
  worm.addEventListener('click', takeMeSomewhere);
  const src = el('a', 'btn btn-quiet', 'Sources on Wikipedia ↗');
  src.href = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title);
  src.target = '_blank';
  src.rel = 'noopener';
  acts.append(save, worm, src);
  root.appendChild(acts);

  keepFalling(title, root);
}

let peeked = false;

function wireLinks(art) {
  art.querySelectorAll('a[data-wiki]').forEach((a) => {
    const target = a.getAttribute('data-wiki');
    let hold = 0;
    a.addEventListener('click', (e) => {
      /* a press-and-hold peek must not also navigate */
      if (peeked) { e.preventDefault(); peeked = false; }
    });
    a.addEventListener('pointerdown', () => {
      clearTimeout(hold);
      hold = setTimeout(() => { peeked = true; peekArticle(target); }, 450);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
      a.addEventListener(ev, () => clearTimeout(hold)));
  });
}

function peekArticle(title) {
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* ignore */ } }
  const open = el('button', 'btn', 'Open');
  open.addEventListener('click', () => { app.closePeek(); go(title); });
  const { content } = app.peek({ title: pretty(title), loading: true, actions: [open] });
  data.fetchJSON(REST + 'page/summary/' + encodeURIComponent(title), 8000)
    .then((s) => {
      content.innerHTML = '';
      if (s.thumbnail?.source) {
        const img = el('img');
        img.src = s.thumbnail.source;
        img.alt = '';
        content.appendChild(img);
      }
      content.appendChild(el('p', null, esc(s.extract || '')));
    })
    .catch(() => { content.innerHTML = '<p class="empty">Could not load that one.</p>'; });
}

function keepFalling(title, root) {
  const box = el('div');
  heading(box, { eyebrow: 'Keep falling', title: 'Where this leads' });
  root.appendChild(box);
  data.fetchJSON(ACTION + 'action=query&generator=search&gsrsearch=' +
    encodeURIComponent('morelike:' + title) +
    '&gsrlimit=8&prop=pageimages|description&piprop=thumbnail&pithumbsize=320', 10000)
    .then((r) => {
      const pages = r?.query?.pages || [];
      if (!pages.length) { box.remove(); return; }
      pages.sort((a, b) => (a.index || 0) - (b.index || 0));
      const { track, sync } = rail(box, { label: 'to read' });
      pages.forEach((p) => {
        const card = el('button', 'doorcard');
        card.innerHTML =
          (p.thumbnail ? '<img loading="lazy" src="' + esc(p.thumbnail.source) + '" alt="">' : '') +
          '<span class="t">' + esc(p.title) + '</span>' +
          (p.description ? '<span class="d">' + esc(p.description) + '</span>' : '');
        card.addEventListener('click', () => go(p.title));
        track.appendChild(card);
      });
      sync();
    })
    .catch(() => box.remove());
}
