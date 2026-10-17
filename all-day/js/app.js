/* app.js — the shell. It owns the mast, the tab bar, theme, sheets, toast,
   peek, gestures, routing, scroll memory, share, the one video box and the
   one audio player. A tab owns its data and the order it shows things in,
   and plugs in through register() (DESIGN.md section 9):

     app.register('food', {
       label: 'Food',            the tab bar word
       icon: ICON.food,          a 24-box stroke icon from ui.js
       promise: '…',             the one-line promise; the shell draws the empty state
       mount(root) {},           first visit: fetch, then render with the shell's cards
       activate(param, first) {},  every landing; #food/<key> arrives as param
       refresh() {},             a setting changed (a mute, Local/Everything); redraw cheaply
       deactivate() {},          the tab was left; stop anything that moves
       subnav() {},              optional: up to two rows under the mast, or null
       newSince(ts) {},          how many items are newer than ts (epoch seconds), for the tab dot
       pull() {},                optional shell extension: pull-to-refresh asked; return a toast or null
     });

   Each tab panel is its own scroll container, so per-tab scroll memory is
   just saving and restoring scrollTop, and the mast can slide away without
   the layout reflowing. A tab renders into the root it is given (a body
   inside the panel); the shell keeps the pull strip above it. */

import * as store from './store.js';
import * as auth from './auth.js';
import { bindGestures } from './gestures.js';
import { el, esc, safeHref, ICON, art, mark, cards, pills, button, setPalette } from './ui.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

/* ?demo=1: every tab shows its full prototype screen on baked fake data,
   and nothing a reader does is saved or sent anywhere. */
export const demo = new URLSearchParams(location.search).get('demo') === '1';
store.setDemo(demo);

/* The bar's order is the shell's call. What Now sits fifth of nine, dead
   centre, in the one wider cell so its two words never wrap. */
export const TABS = ['wire', 'watch', 'food', 'people', 'whatnow', 'vintage', 'habits', 'onair', 'games'];
const REQUIRED = ['label', 'icon', 'promise', 'mount', 'activate', 'refresh', 'newSince'];

const registry = Object.create(null);
const mounted = Object.create(null);
const stale = Object.create(null);
const scrollMemory = Object.create(null);
const panels = Object.create(null);
const bodies = Object.create(null);
const landed = new Set();
let active = null;
let started = false;

export function register(key, mod) {
  if (!TABS.includes(key)) throw new Error('[all-day] unknown tab ' + key);
  const missing = REQUIRED.filter((f) => mod[f] == null);
  if (missing.length) throw new Error('[all-day] tab ' + key + ' is missing ' + missing.join(', '));
  registry[key] = mod;
}
export const activeTab = () => active;
/* The signed-in reader as { id }, or null; never an email (auth.js keeps
   none). onAuth(fn) runs fn(user) on every sign-in, sign-out and lost
   session, and returns the unsubscribe. */
export const user = () => auth.user();
export const token = () => auth.token();
export const onAuth = (fn) => auth.onChange(fn);
export const signOut = () => auth.signOut();

/* Card buttons a shell module answers (boards.js: bvote, breport,
   bdelete). bindFeed() hands a data-act it does not know itself to the
   function registered under its name, with the card's item. */
const ACTS = Object.create(null);
export function onAct(name, fn) { ACTS[name] = fn; }
/* The signed-in half of Settings → Your account (boards.js draws it). */
let accountPainter = null;
export function registerAccount(fn) { accountPainter = fn; }

/* -------------------------------------------------------------- items */
/* Every card a tab draws is known here by its key, so one delegated click
   handler can vote, save, share or open it. A tab calls know() with the
   items it is about to draw. */
const ITEMS = new Map();
const NAMES = Object.create(null);   // source id -> display name, for Settings
export function know(items) {
  (items || []).forEach((it) => {
    if (!it || !it.k) return;
    ITEMS.set(it.k, it);
    if (it.sid && it.src) NAMES[it.sid] = it.src;
  });
  return items;
}
export const item = (k) => ITEMS.get(k) || null;
export const sourceName = (sid) => NAMES[sid] || sid;
const record = (it) => ({ k: it.k, kind: it.kind || 'wire', title: it.title || it.text || it.name || 'Untitled',
  from: it.src || it.author || '', href: it.href || '', art: /^https?:/.test(it.thumb || it.media || '') ? (it.thumb || it.media) : '' });

/* ------------------------------------------------------------- demo data */
/* data/demo/<tab>.json, one file per tab, plus shell.json (the placeholder
   palettes and the fake comments). Fetched once, cached. */
const demoCache = Object.create(null);
function fetchDemo(name) {
  if (!demoCache[name]) {
    demoCache[name] = fetch('data/demo/' + name + '.json').then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  return demoCache[name];
}
let shellDemo = null;
export function demoData(tab) {
  if (!shellDemo) shellDemo = fetchDemo('shell').then((j) => { setPalette(j.palette); return j; });
  return Promise.all([shellDemo, fetchDemo(tab)]).then(([, j]) => {
    /* a demo item links to its own deep link, so rule 4 (every item has a
       URL) holds for fake data too; opening one in demo mode only toasts */
    const stamp = (it) => { if (it && typeof it === 'object' && it.k && !it.href) it.href = '#' + tab + '/' + it.k; };
    const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { stamp(v); Object.values(v).forEach(walk); } };
    walk(j);
    return j;
  });
}

/* ------------------------------------------------------------- empty state */
/* A tab that is not built yet states its promise. In live mode that is all
   eight tabs but the Wire, until each tab's own session ships it. */
export function promise(host, key) {
  const mod = registry[key];
  host.innerHTML = '';
  const p = el('div', 'promise');
  p.innerHTML = '<div class="big">' + mod.icon + '</div><h2>' + esc(mod.label) + '</h2><p>' + esc(mod.promise) + '</p>' +
    '<span class="soon">Coming in the rebuild</span>' +
    '<a class="demo" href="?demo=1#' + esc(key) + '">See what it will look like</a>';
  host.appendChild(p);
}

/* ------------------------------------------------------------------ share */
/* One card, one link. The URL is this app with the tab and the card's key in
   the hash, so a text from a neighbour lands the reader inside All Day. Native
   share sheet where phones have one; the clipboard everywhere else. */
export function share(tab, key, title) {
  const base = demo ? location.origin + location.pathname + '?demo=1' : 'https://guide.btownbrief.com/all-day/';
  const url = base + '#' + tab + (key ? '/' + encodeURIComponent(key) : '');
  if (!demo && window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path: 'all-day-share-' + tab, title: 'All Day share: ' + tab, event: true });
  }
  if (navigator.share) {
    navigator.share({ title: title || 'All Day — Burlington Brief', url }).catch(() => {});
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast('Couldn’t copy the link'));
  } else toast('Couldn’t copy the link');
}

/* Scroll a shared-in card into view and let it glow once. Returns whether the
   key was found, so the caller can say something honest when it wasn't. */
export function flashHit(host, key) {
  const hit = [...(host || document).querySelectorAll('[data-k]')].find((n) => n.dataset.k === key);
  if (!hit) return false;
  requestAnimationFrame(() => {
    hit.scrollIntoView({ block: 'center' });
    hit.classList.remove('flash');
    void hit.offsetWidth;
    hit.classList.add('flash');
    setTimeout(() => hit.classList.remove('flash'), 2400);
  });
  return true;
}

export function go(tab, param) {
  const next = param ? tab + '/' + encodeURIComponent(param) : tab;
  if (location.hash.replace(/^#/, '') === next) route();
  else location.hash = next;
}

/* ------------------------------------------------------------ feed events */
/* One delegated handler per feed. Tabs never attach pointer handlers to
   cards (DESIGN.md section 9 rule 7); they pass optional handlers here:
   onSource(sid, item), onSave(item), onMute(sid, item), onPeek(item). */
let holdFired = false, holdDead = 0;

export function bindFeed(host, h = {}) {
  host.addEventListener('click', (e) => {
    if (holdFired && Date.now() < holdDead) { e.preventDefault(); e.stopPropagation(); return; }
    const c = e.target.closest('[data-k]');
    const it = c && ITEMS.get(c.dataset.k);
    const act = e.target.closest('[data-act]');
    if (act && it) {
      e.preventDefault();
      const a = act.dataset.act;
      if (a === 'up') toggleVote(it);
      else if (a === 'comment') comments(it);
      else if (a === 'share') share(active, it.k, it.title || it.text);
      else if (a === 'save') (h.onSave || toggleSave)(it);
      else if (ACTS[a]) ACTS[a](it, act);
      return;
    }
    const srcb = e.target.closest('[data-src]');
    if (srcb) {
      e.preventDefault();
      (h.onSource || sourceSheet)(srcb.dataset.src, it);
      return;
    }
    if (e.target.closest('[data-open]') && it) {
      store.markRead(it.k);
      document.querySelectorAll('.card[data-k="' + CSS.escape(it.k) + '"]').forEach((n) => n.classList.add('is-read'));
      if (demo || !/^https?:/.test(it.href || '')) {
        e.preventDefault();
        toast(it.open ? 'Opens the original on ' + it.open.replace(/^Open (on |the )?/, '') + ' in the real build'
          : it.kind === 'event' ? 'Opens the event page in the real build' : 'Opens the article in the real build');
      }
      return;
    }
    if (e.target.closest('[data-play]') && it) { e.preventDefault(); play(it); return; }
    if (e.target.closest('[data-zoom]') && it) { e.preventDefault(); lightbox(it); return; }
    if (e.target.closest('[data-cta]') && it) {
      e.preventDefault();
      toast(user() ? '“' + (it.cta || 'Go') + '” comes with this tab’s build.' : 'Sign in to continue.');
    }
  });
  host.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-play], [data-zoom]')) { e.preventDefault(); e.target.click(); }
  });
  bindGestures(host, {
    onSave(k) { const it = ITEMS.get(k); if (it) (h.onSave || toggleSave)(it); },
    onMute(k) { const it = ITEMS.get(k); if (it && (it.sid || it.src)) (h.onMute || mute)(it.sid || it.src, it); },
  });
  bindHold(host, h.onPeek || peek);
}

export function toggleVote(it) {
  store.toggleVote(record(it));
  const on = store.hasVoted(it.k);
  const n = (Number(it.votes) || 0) + store.voteCount(it.k);
  document.querySelectorAll('[data-k="' + CSS.escape(it.k) + '"] [data-act="up"]').forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    const c = b.querySelector('.n');
    if (c) c.textContent = n || '';
  });
}

export function toggleSave(it) {
  const on = store.toggleSaved(record(it));
  document.querySelectorAll('[data-k="' + CSS.escape(it.k) + '"] .act.star').forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  paintSavedBtn();
  toast(on ? 'Saved' : 'Removed from saved');
}

/* Mute a source everywhere. Asks first; the toast carries Undo. */
export function mute(sid, it) {
  const name = (it && (it.src || it.author)) || sourceName(sid);
  confirmBox({
    title: 'Mute ' + name + '?',
    body: 'You won’t see ' + name + ' anywhere in All Day. Bring it back any time in Settings.',
    yes: 'Mute',
    onYes() {
      store.setMuted(sid, true);
      refreshAll();
      toast('Muted ' + name, () => { store.setMuted(sid, false); refreshAll(); });
    },
  });
}

/* Comments open over the feed, never away from it. On-site comments are a
   later shell feature (sign-in, moderation); until then a card with a home
   elsewhere links there, and demo mode shows the prototype's sheet. */
function comments(it) {
  if (!demo) {
    if (it.open && /^https?:/.test(safeHref(it.href))) { window.open(safeHref(it.href), '_blank', 'noopener'); return; }
    toast('Comments are coming soon.');
    return;
  }
  sheet(it.kind === 'post' && it.comments ? (it.comments + ' replies') : 'Comments', (body, card) => {
    body.appendChild(el('p', 'sheet-note', esc(it.title || it.text)));
    shellDemo.then((j) => {
      const sets = j.comments || [];
      const set = sets.length ? sets[it.k.charCodeAt(it.k.length - 1) % sets.length] : [];
      set.forEach(([who, ago, text]) => {
        body.insertBefore(el('div', 'cmt', mark(who, 'round lg') + '<div><div class="who"><b>' + esc(who) + '</b> · ' + esc(ago) + '</div><p>' + esc(text) + '</p></div>'), body.querySelector('.sheet-row'));
      });
    });
    if (it.open) {
      const r = el('div', 'sheet-row');
      r.style.justifyContent = 'center';
      r.appendChild(button(esc(it.open) + ' ' + ICON.ext, 'ghost', () => toast('Opens the original thread in the real build')));
      body.appendChild(r);
    }
    const compose = el('div', 'compose', '<input class="field" type="text" placeholder="Add a comment" aria-label="Add a comment">');
    compose.appendChild(button('Post', '', () => toast('Demo: posting is off.')));
    card.appendChild(compose);
  });
}

/* The source sheet a tab gets for free: what the shell knows from that
   source, and Mute. The Wire draws its own, richer one. */
function sourceSheet(sid, it) {
  const name = (it && (it.src || it.author)) || sourceName(sid);
  const mine = [...ITEMS.values()].filter((x) => (x.sid || x.src) === sid).slice(0, 8);
  sheet(name, (body) => {
    const h = el('div', 'srchead', mark(name, 'xl') + '<div><div class="k">' + esc(name) + '</div><div class="n">' + mine.length + ' here today</div></div>');
    body.appendChild(h);
    const row = el('div', 'linkrow');
    row.appendChild(button('Mute', 'ghost', () => mute(sid, it)));
    body.appendChild(row);
    if (mine.length) {
      body.appendChild(el('div', 'sheet-h', 'Recent from ' + esc(name)));
      const f = el('div', 'feed tight');
      mine.forEach((x) => { const n = x.kind === 'headline' ? cards.row(x) : cards.any(x); if (n) f.appendChild(n); });
      body.appendChild(f);
      bindFeed(f, { onSource() {} });
    }
  });
}

/* ------------------------------------------------------------------ hold */
/* Hold any card for 550ms and it rises as a peek. Moving 10px cancels; the
   click that follows a peek is swallowed. */
let holdTimer = 0, holdStart = null;
function cancelHold() { clearTimeout(holdTimer); holdTimer = 0; holdStart = null; }
function bindHold(host, onPeek) {
  host.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const c = e.target.closest('[data-k]');
    if (!c || e.target.closest('button, .rail')) return;
    holdStart = { x: e.clientX, y: e.clientY };
    holdFired = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      const it = ITEMS.get(c.dataset.k);
      if (!it) return;
      holdFired = true; holdDead = Date.now() + 600;
      if (navigator.vibrate) navigator.vibrate(8);
      onPeek(it);
    }, 550);
  });
  host.addEventListener('pointermove', (e) => {
    if (!holdStart) return;
    if (Math.abs(e.clientX - holdStart.x) > 10 || Math.abs(e.clientY - holdStart.y) > 10) cancelHold();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => host.addEventListener(ev, cancelHold));
  host.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });
}

/* ------------------------------------------------------------------ peek */
let peekEl = null;
export function closePeek() {
  if (!peekEl) return;
  peekEl.remove(); peekEl = null;
  document.removeEventListener('pointerdown', onOutside, true);
}
function onOutside(e) { if (peekEl && !peekEl.contains(e.target)) closePeek(); }
export function peek(it) {
  if (!it) return;
  closePeek();
  const box = el('div', 'peek');
  box.setAttribute('role', 'dialog');
  const t = it.title || it.line || it.text;
  const from = it.author || it.name || it.src;
  const pic = it.media || it.thumb;
  const words = it.kind === 'board' ? [it.metaLine, it.text].filter(Boolean).join('. ') : (it.text || it.why || '');
  box.innerHTML = '<div class="peek-head"><span class="t">' + esc(t) + '</span><button class="iconbtn" aria-label="Close">' + ICON.x + '</button></div>' +
    '<div class="peek-body">' + (pic ? '<span class="c-media r169">' + art(pic) + '</span>' : '') +
    '<p class="from">' + esc(from) + (it.ago ? ' · ' + esc(it.ago) : '') + '</p><p>' + esc(words) + '</p></div>';
  const foot = el('div', 'peek-foot');
  /* a reader's board post lives here, in the card itself: nothing to open */
  if (it.kind !== 'board') {
    const open = el('a', 'btn', esc(it.open || 'Open') + ' ' + ICON.ext);
    open.href = safeHref(it.href);
    if (/^https?:/.test(it.href || '')) { open.target = '_blank'; open.rel = 'noopener'; }
    open.addEventListener('click', (e) => {
      store.markRead(it.k);
      if (demo || !/^https?:/.test(it.href || '')) { e.preventDefault(); toast('Opens in the real build'); }
      closePeek();
    });
    foot.appendChild(open);
  }
  foot.append(button(store.isSaved(it.k) ? 'Saved' : 'Save', 'ghost', () => { toggleSave(it); closePeek(); }));
  box.appendChild(foot);
  box.querySelector('.iconbtn').addEventListener('click', closePeek);
  document.body.appendChild(box);
  peekEl = box;
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
}

/* -------------------------------------------------------------- lightbox */
let lbEl = null;
export function lightbox(it) {
  closeLightbox();
  const lb = el('div', 'lb');
  lb.setAttribute('role', 'dialog');
  lb.innerHTML = '<span class="c-media ' + esc(it.ratio || 'r45') + '">' + art(it.media || it.thumb) + '</span>' +
    '<button class="iconbtn x" aria-label="Close">' + ICON.x + '</button><p class="cap">' + esc(it.text || it.title || '') + '</p>';
  lb.addEventListener('click', closeLightbox);
  document.body.appendChild(lb);
  lbEl = lb;
}
function closeLightbox() { if (lbEl) { lbEl.remove(); lbEl = null; } }

/* ----------------------------------------------------------------- sheets */
let sheetClose = null;
export function sheet(titleText, build) {
  if (sheetClose) sheetClose();
  const s = $('sheet');
  s.innerHTML = '';
  const scrim = el('div', 'sheet-scrim');
  const card = el('div', 'sheet-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', titleText);
  const head = el('div', 'sheet-head', '<h2>' + esc(titleText) + '</h2>');
  const x = el('button', 'iconbtn', ICON.x);
  x.setAttribute('aria-label', 'Close');
  head.appendChild(x);
  const body = el('div', 'sheet-body');
  card.append(el('div', 'grab'), head, body);
  s.append(scrim, card);
  s.hidden = false;
  const close = () => { s.hidden = true; s.innerHTML = ''; if (sheetClose === close) sheetClose = null; };
  sheetClose = close;
  x.addEventListener('click', close);
  scrim.addEventListener('click', close);
  build(body, card, close);
  return close;
}

function savedSheet() {
  sheet('Saved', (body, card, close) => {
    const paint = () => {
      body.innerHTML = '';
      const list = store.saved();
      if (!list.length) { body.appendChild(el('p', 'sheet-note', 'Nothing saved yet.')); return; }
      list.forEach((it) => {
        const r = el('div', 'sheet-row');
        const a = el('a', 't', esc(it.title) + '<div class="d">' + esc(it.from || '') + '</div>');
        const internal = /^#/.test(it.href || '');
        a.href = safeHref(it.href);
        if (internal) a.addEventListener('click', close); else { a.target = '_blank'; a.rel = 'noopener'; }
        const x = el('button', 'act star on', ICON.star);
        x.setAttribute('aria-label', 'Remove from saved');
        x.addEventListener('click', () => {
          store.toggleSaved(it);
          document.querySelectorAll('[data-k="' + CSS.escape(it.k) + '"] .act.star').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
          paintSavedBtn();
          paint();
        });
        r.append(a, x);
        body.appendChild(r);
      });
    };
    paint();
  });
}

const MORE = [
  ['The newsletter', 'https://www.btownbrief.com/'],
  ['The hub', 'https://hub.btownbrief.com/'],
  ['Weather', '../weather.html'],
  ['The board', '../live.html'],
  ['The arcade', 'https://play.btownbrief.com/'],
  ['Telegram chat', '../telegram.html'],
];

export function openSettings() { settingsSheet(); }
function settingsSheet() {
  sheet('Settings', (body) => {
    body.appendChild(el('div', 'sheet-h', 'Appearance'));
    body.appendChild(pills([['auto', 'Follow phone'], ['light', 'Light'], ['dark', 'Dark']], store.theme(), (v) => { store.setTheme(v); paintThemeBtn(); }));

    body.appendChild(el('div', 'sheet-h', 'Your account'));
    const acct = el('div');
    body.appendChild(acct);
    const paintAcct = () => {
      acct.innerHTML = '';
      const u = auth.user();
      if (u && accountPainter) { accountPainter(acct, paintAcct); return; }
      if (u) {
        const r = el('div', 'sheet-row', '<div class="t">Signed in</div>');
        r.appendChild(button('Sign out', 'ghost sm', () => { auth.signOut(); paintAcct(); toast('Signed out'); }));
        acct.appendChild(r);
        return;
      }
      if (demo) {
        const r = el('div', 'sheet-row', '<div class="t">Sign in<div class="d">Demo account</div></div>');
        r.appendChild(button('Sign in', 'ghost sm', () => { auth.demoSignIn(); paintAcct(); toast('Signed in to the demo account'); }));
        acct.appendChild(r);
        return;
      }
      const st = auth.status();
      if (st !== 'on') {
        acct.appendChild(el('div', 'sheet-row', '<div class="t">Sign in<div class="d">' +
          (st === 'checking' ? 'Checking…' : 'Coming soon.') + '</div></div>'));
        return;
      }
      acct.appendChild(el('p', 'sheet-note', 'An email link, no password.'));
      const f = el('form', 'signin');
      f.noValidate = true;   /* our own message, not the browser's bubble */
      const input = el('input', 'field');
      input.type = 'email'; input.placeholder = 'you@example.com'; input.autocomplete = 'email';
      input.setAttribute('aria-label', 'Email address');
      const go = button('Send link', '');
      go.type = 'submit';
      f.append(input, go);
      const msg = el('p', 'sheet-note');
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        go.disabled = true;
        auth.sendLink(input.value).then((r) => { msg.textContent = r.message; go.disabled = false; });
      });
      acct.append(f, msg);
    };
    paintAcct();
    auth.check().then(paintAcct);

    body.appendChild(el('div', 'sheet-h', 'Muted sources'));
    const muted = Object.keys(store.muted());
    if (!muted.length) body.appendChild(el('p', 'sheet-note', 'None.'));
    muted.forEach((sid) => {
      const r = el('div', 'sheet-row', '<div class="t">' + esc(sourceName(sid)) + '</div>');
      r.appendChild(button('Unmute', 'ghost sm', () => { store.setMuted(sid, false); r.remove(); refreshAll(); }));
      body.appendChild(r);
    });

    body.appendChild(el('div', 'sheet-h', 'More from the Brief'));
    const links = el('div', 'linkrow');
    MORE.forEach(([label, href]) => {
      const a = el('a', 'btn ghost sm', esc(label) + ' ' + ICON.ext);
      a.href = href;
      if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
      links.appendChild(a);
    });
    body.appendChild(links);

    /* the one place for what stays where and whose data it is (DESIGN.md
       section 10): the tabs say none of it */
    body.appendChild(el('div', 'sheet-h', 'About'));
    body.appendChild(el('p', 'sheet-note', demo
      ? 'This is the demo. Everything in it is invented, and nothing you do here is saved.'
      : 'All Day is the Btown Brief’s app for the rest of the day.'));
    body.appendChild(el('p', 'sheet-note', 'Saves, mutes, what you have read, your Watch dots and list, your People tile and quiz, your arcade name and your missions stay on this phone. '
      + 'Signed in, your tile, interests, Watch dots, missions and habits also go to your account. Your email is never shown to anyone.'));
    const tmdb = el('p', 'sheet-note');
    tmdb.dataset.credit = 'tmdb';
    tmdb.innerHTML = '<a href="https://www.themoviedb.org/" target="_blank" rel="noopener"><img src="../assets/img/tmdb.svg" alt="TMDB" width="92" height="12" loading="lazy" decoding="async"></a><br>'
      + esc('Watch’s film details, posters and trailers come from TMDB (The Movie Database). This product uses the TMDB API but is not endorsed or certified by TMDB.');
    body.appendChild(tmdb);
  });
}

/* ---------------------------------------------------------- toast, confirm */
let toastTimer = 0;
export function toast(msg, undo) {
  const t = $('toast');
  t.innerHTML = '';
  t.appendChild(document.createTextNode(msg));
  if (undo) {
    const b = el('button', null, 'Undo');
    b.addEventListener('click', () => { t.hidden = true; undo(); });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 2400);
}

export function confirmBox({ title, body, yes, onYes }) {
  const box = $('confirm');
  box.innerHTML = '<div class="confirm-card" role="alertdialog"><h3>' + esc(title) + '</h3><p>' + esc(body) + '</p>' +
    '<div class="confirm-btns"><button class="btn ghost" data-no>Cancel</button><button class="btn danger" data-yes>' + esc(yes) + '</button></div></div>';
  box.hidden = false;
  const close = () => { box.hidden = true; };
  box.querySelector('[data-no]').addEventListener('click', close);
  box.querySelector('[data-yes]').addEventListener('click', () => { close(); onYes(); });
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector('[data-yes]').focus();
}

/* ----------------------------------------------------------------- player */
/* ONE <audio>, in the shell, so it keeps playing across every tab switch.
   Anything else that can make a noise (a Bandcamp or YouTube embed a tab
   opens) registers a stop function, and when this player or the video box
   starts, all of them are torn down. Two things never play at once.
   Demo items have no sound; the dock pretends, as the prototype did. */
const audio = $('audio');
const dock = $('player');
let playing = null;        // the item in the dock
let fakeTimer = 0, fakePos = 0;

const foreign = new Set();
export function registerForeign(stop) { foreign.add(stop); return () => foreign.delete(stop); }
export function silenceForeign() { foreign.forEach((stop) => { try { stop(); } catch (e) { /* already gone */ } }); }

export const nowPlaying = () => (playing ? playing.k : null);
export const isPlaying = () => !!playing && (playing.src_audio ? !audio.paused : !!fakeTimer);

export function paintPlayButtons() {
  const on = isPlaying();
  document.querySelectorAll('[data-pk]').forEach((b) => {
    const me = on && playing && b.dataset.pk === playing.k;
    b.classList.toggle('is-playing', me);
    const label = b.dataset.label || '';
    b.innerHTML = (me ? ICON.pause : ICON.play) + (label ? ' ' + esc(label) : '');
  });
  $('p-toggle').innerHTML = on ? ICON.pause : ICON.play;
}

function showDock(it) {
  dock.hidden = false;
  document.body.classList.add('has-player');
  dock.querySelector('.p-art').innerHTML = art(it.media || it.thumb || 'coffee');
  $('p-title').textContent = it.title || '';
  $('p-show').textContent = (it.show || it.src || '') + (it.dur ? ' · ' + it.dur : '');
  measure();
}

/* Play anything: a YouTube id opens the video box, an audio URL plays in the
   dock, a demo item pretends. Pressing play on what is playing pauses it. */
export function play(it) {
  if (!it) return;
  if (it.yt && !demo) { showVideo(it.yt, it.title); return; }
  if (playing && playing.k === it.k) { togglePause(); return; }
  stopFake();
  if (it.src_audio && !demo) {
    playing = it;
    if (audio.getAttribute('src') !== it.src_audio) {
      audio.src = it.src_audio;
      const at = store.heardAt(it.k);
      if (at > 30) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = at; } catch (e) { /* not seekable yet */ } }, { once: true });
    }
    closeVideo();
    silenceForeign();
    showDock(it);
    audio.play().catch(() => {});
    paintPlayButtons();
    return;
  }
  /* demo, or an item with nothing playable behind it */
  if (!demo) { toast('Nothing to play here yet.'); return; }
  audio.pause();
  playing = it; fakePos = 0;
  showDock(it);
  startFake();
  paintPlayButtons();
  toast('Playing');
}
function startFake() {
  clearInterval(fakeTimer);
  fakeTimer = setInterval(() => {
    fakePos = Math.min(100, fakePos + 0.4);
    dock.querySelector('.p-bar i').style.width = fakePos + '%';
    if (fakePos >= 100) stopFake();
  }, 200);
}
function stopFake() { clearInterval(fakeTimer); fakeTimer = 0; }
function togglePause() {
  if (!playing) return;
  if (playing.src_audio && !demo) { if (audio.paused) { silenceForeign(); audio.play().catch(() => {}); } else audio.pause(); }
  else if (fakeTimer) stopFake(); else startFake();
  paintPlayButtons();
}
export function stop() {
  stopFake();
  audio.pause();
  playing = null;
  dock.hidden = true;
  document.body.classList.remove('has-player');
  paintPlayButtons();
  measure();
}
let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  if (!playing || !audio.duration) return;
  dock.querySelector('.p-bar i').style.width = (audio.currentTime / audio.duration * 100) + '%';
  if (Date.now() - lastSave > 5000) { lastSave = Date.now(); store.setHeardAt(playing.k, audio.currentTime); }
});
['play', 'pause', 'ended'].forEach((ev) => audio.addEventListener(ev, paintPlayButtons));
$('p-toggle').addEventListener('click', togglePause);
$('p-close').addEventListener('click', stop);
$('p-bar').addEventListener('click', (e) => {
  if (!playing || !playing.src_audio || !audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
});

/* ------------------------------------------------------------------ video */
/* The one video box. A tap opens it; YouTube's own player inside it starts on
   that tap, never on its own. */
const YT_RE = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (id) => YT_RE.test(String(id || ''));
let hintTimer = 0;
export function showVideo(id, title) {
  if (!YT_RE.test(id)) return;
  $('vbox-title').textContent = title || '';
  const frame = $('vbox-frame');
  frame.innerHTML = '';
  const f = document.createElement('iframe');
  f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.setAttribute('allowfullscreen', '');
  f.title = title || 'Video';
  frame.appendChild(f);
  $('vbox-open').href = 'https://www.youtube.com/watch?v=' + id;
  $('vbox-open').textContent = 'Open in YouTube ↗';
  $('vbox-hint').hidden = true;
  $('vbox').hidden = false;
  audio.pause();
  stopFake();
  silenceForeign();
  paintPlayButtons();
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { if (!$('vbox').hidden) $('vbox-hint').hidden = false; }, 3000);
}
/* The same box for a video that is a file, not a YouTube id: a reel from
   Instagram, a clip from a kitchen. A <video> with controls, started by the
   tap that opened it (never before), 9:16 when `vertical`. The Open link
   names where the original lives. Demo items have no file; the box shows
   the poster and says so. */
const OPEN_ON = [[/(^|\.)instagram\.com$/, 'Open on Instagram'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'Open in YouTube'],
  [/(^|\.)facebook\.com$/, 'Open on Facebook'], [/(^|\.)tiktok\.com$/, 'Open on TikTok'], [/(^|\.)vimeo\.com$/, 'Open on Vimeo']];
function openLabel(href) {
  let host = '';
  try { host = new URL(href, location.href).hostname; } catch (e) { host = ''; }
  const hit = OPEN_ON.find(([re]) => re.test(host));
  return hit ? hit[1] : 'Open the original';
}
export function showClip({ src, poster, title, href, vertical } = {}) {
  closeVideo();
  audio.pause();
  stopFake();
  silenceForeign();
  paintPlayButtons();
  $('vbox-title').textContent = title || '';
  const frame = $('vbox-frame');
  frame.classList.toggle('vertical', !!vertical);
  const ok = /^https?:\/\//.test(String(src || ''));
  if (demo || !ok) {
    frame.innerHTML = art(poster || 'paper');
    toast(demo ? 'The video plays here in the real build' : 'This video can’t play here. Open the original.');
  } else {
    const v = document.createElement('video');
    v.src = src;
    if (/^https?:\/\//.test(String(poster || ''))) v.poster = poster;
    v.controls = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'none';
    frame.appendChild(v);
    v.play().catch(() => {});
  }
  const open = $('vbox-open');
  open.href = safeHref(href || src);
  open.textContent = openLabel(href || src) + ' ↗';
  $('vbox-hint').hidden = true;
  $('vbox').hidden = false;
}
/* Closing gives the box back as YouTube expects it: 16:9, its own label. */
export function closeVideo() {
  clearTimeout(hintTimer);
  const frame = $('vbox-frame');
  frame.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch (e) { /* gone */ } v.removeAttribute('src'); });
  frame.innerHTML = '';
  frame.classList.remove('vertical');
  $('vbox-open').textContent = 'Open in YouTube ↗';
  $('vbox').hidden = true;
}
$('vbox-close').addEventListener('click', closeVideo);
$('vbox').addEventListener('click', (e) => { if (e.target === $('vbox')) closeVideo(); });

/* ------------------------------------------------------------------ theme */
function paintThemeBtn() {
  const dark = root.getAttribute('data-theme') === 'dark' ||
    (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const b = $('theme-btn');
  b.innerHTML = dark ? ICON.sun : ICON.moon;
  b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  root.style.background = '';
}
function paintSavedBtn() { $('saved-btn').classList.toggle('on', store.saved().length > 0); }

/* ------------------------------------------------------------------ chrome */
const mast = $('mast');
export function measure() {
  root.style.setProperty('--mast-total', mast.offsetHeight + 'px');
  root.style.setProperty('--player-h', dock.hidden ? '0px' : (dock.offsetHeight + 8) + 'px');
}
function showChrome() { document.body.classList.remove('chrome-away'); }
export function scrollTop(smooth) {
  const p = panels[active];
  if (p) p.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  showChrome();
}
/* scroll a panel so a node lands just under the mast */
export function jumpTo(node) {
  const p = panels[active];
  if (!p || !node) return;
  const top = node.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - mast.offsetHeight - 4;
  p.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/* the slot under the mast: a tab hands back nothing, one row, or two */
export function paintSubnav() {
  const s = $('subnav');
  s.innerHTML = '';
  const mod = registry[active];
  const n = mod && mod.subnav ? mod.subnav() : null;
  if (n) s.appendChild(n);
  measure();
}

function watchScroll(p) {
  let last = 0, tick = 0;
  p.addEventListener('scroll', () => {
    if (tick) return;
    tick = requestAnimationFrame(() => {
      tick = 0;
      const y = p.scrollTop;
      if (y < 40 || y < last - 8) showChrome();
      else if (y > last + 8 && y > 120 && !peekEl) document.body.classList.add('chrome-away');
      last = y;
    });
  }, { passive: true });
  bindPull(p);
}

/* pull down at the top to check for new */
function bindPull(p) {
  let y0 = null, pulling = false;
  const ptr = p.querySelector('.ptr');
  p.addEventListener('touchstart', (e) => { y0 = p.scrollTop <= 0 ? e.touches[0].clientY : null; pulling = false; }, { passive: true });
  p.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0) { if (pulling) { ptr.style.height = '0px'; pulling = false; } return; }
    pulling = true;
    const h = Math.min(88, dy * 0.5);
    ptr.classList.add('pulling');
    ptr.style.height = h + 'px';
    ptr.firstElementChild.textContent = '';
  }, { passive: true });
  p.addEventListener('touchend', () => {
    if (!pulling) { y0 = null; return; }
    ptr.classList.remove('pulling');
    const h = parseFloat(ptr.style.height) || 0;
    if (h >= 64) checkNew(); else ptr.style.height = '0px';
    y0 = null; pulling = false;
  });
}
let checking = false;
function checkNew() {
  const mod = registry[active];
  const p = panels[active];
  if (checking || !mod || !p) return;
  const ptr = p.querySelector('.ptr');
  checking = true;
  ptr.innerHTML = '<span class="spin"></span><span>Checking</span>';
  ptr.style.height = '56px';
  Promise.resolve(mod.pull ? mod.pull() : null).then((msg) => {
    checking = false;
    if (msg) { toast(msg); ptr.style.height = '0px'; ptr.innerHTML = '<span></span>'; return; }
    ptr.innerHTML = '<span>Nothing new</span>';
    setTimeout(() => { ptr.style.height = '0px'; ptr.innerHTML = '<span></span>'; }, 700);
  });
}

/* ------------------------------------------------------------ tab dots */
/* A dot on a tab you are not on, when it has something newer than your last
   visit. The tab reports the number; landing on the tab clears the dot. */
export function recount() {
  const base = store.visitBase();
  $('tabbar').querySelectorAll('button[data-tab]').forEach((b) => {
    const t = b.dataset.tab;
    const mod = registry[t];
    let n = 0;
    if (mod && t !== active && !landed.has(t)) { try { n = Number(mod.newSince(base)) || 0; } catch (e) { n = 0; } }
    const dot = b.querySelector('.nd');
    if (n > 0 && !dot) { const d = el('i', 'nd'); d.setAttribute('aria-label', 'New'); b.appendChild(d); }
    else if (n <= 0 && dot) dot.remove();
  });
}

/* --------------------------------------------------------------- refresh */
/* Redraw the tab on screen because something it reads changed (a mute, the
   Local switch). Tabs you cannot see are marked and redraw on the way in,
   which keeps their scroll position until then. */
export function refresh() { registry[active]?.refresh?.(); }
function refreshAll() {
  Object.keys(mounted).forEach((t) => { if (t !== active) stale[t] = true; });
  refresh();
}
window.addEventListener('allday-geo', () => {
  Object.keys(mounted).forEach((t) => { if (t !== active) stale[t] = true; });
});

/* ----------------------------------------------------------------- routing */
/* Links from before the New Nine, each to the nearest new tab. The old
   Listen tab and Btown TV videos shared as #watch/yt:<id> live in On Air and
   keep their key. An old Reddit card's key is its URL, the key the Wire's
   Unfiltered view still answers to; a bare #reddit opens the Wire's Reddit
   chip. Instagram goes to the Wire, Music to What Now's Tonight (the Vermont
   artists and their gigs), Wander to What Now. The Art tab was
   folded on 2026-10-17 (Habits took its slot, its shirt loop lives in
   Vintage, its sunset line in What Now's weather), and community photos
   moved into the Wire's Photo mode: #art and the older #photos open it, and
   a picture's key (#art/b-<post id>, #art/g-<gallery id>) opens that
   picture there. Any other old key or section means nothing now and is
   dropped. The address bar is rewritten so the next share carries the new
   link. */
function legacy(h) {
  if (h === 'listen' || h.startsWith('listen/')) return 'onair' + h.slice(6);
  if (/^watch\/yt:/.test(h)) return 'onair/' + h.slice(6);
  if (h === 'reddit' || h === 'reddit/') return 'wire/reddit';
  if (h.startsWith('reddit/')) return 'wire/' + h.slice(7);
  const m = h.match(/^(ig|music|wander|photos|art)(\/|$)/);
  if (!m) return null;
  if (m[1] === 'photos' || m[1] === 'art') {
    const key = h.slice(m[0].length);
    return 'wire/photos' + (/^[bg]-[\w-]+$/.test(key) ? '/' + key : '');
  }
  return { ig: 'wire', music: 'whatnow/tonight', wander: 'whatnow' }[m[1]];
}

function parseHash() {
  let h = location.hash.replace(/^#/, '');
  const moved = legacy(h);
  if (moved) { history.replaceState(null, '', location.pathname + location.search + '#' + moved); h = moved; }
  const m = h.match(/^([a-z]+)\/(.*)$/);
  if (m && TABS.includes(m[1]) && registry[m[1]]) {
    /* a shared link can carry broken percent-encoding, and an uncaught
       URIError here would take the whole router down. #food/ is #food. */
    let param;
    try { param = decodeURIComponent(m[2]); } catch (e) { param = m[2]; }
    return { tab: m[1], param: param || null };
  }
  return { tab: TABS.includes(h) && registry[h] ? h : 'wire', param: null };
}

function paintTabs() {
  $('tabbar').querySelectorAll('button[data-tab]').forEach((b) => {
    const on = b.dataset.tab === active;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
}

export function route() {
  const { tab, param } = parseHash();
  const mod = registry[tab];
  if (!mod) return;
  /* a new address is a new place: a sheet left open (Settings, a mission,
     a film) closes, as the peek already did; a tab that wants one for its
     deep link opens it again in activate() below */
  if (sheetClose) sheetClose();
  const prev = active;
  if (prev && prev !== tab) {
    scrollMemory[prev] = panels[prev].scrollTop;
    panels[prev].hidden = true;
    try { registry[prev]?.deactivate?.(); } catch (e) { console.error('[all-day] ' + prev + ' deactivate threw', e); }
  }
  const switched = prev !== tab;
  active = tab;
  landed.add(tab);
  panels[tab].hidden = false;
  const first = !mounted[tab];
  try {
    if (first) { mounted[tab] = true; mod.mount(bodies[tab]); }
    else if (stale[tab]) { delete stale[tab]; mod.refresh(); }
  } catch (e) { console.error('[all-day] ' + tab + ' mount threw', e); }
  paintTabs();
  paintSubnav();
  $('mast-title').textContent = mod.label;
  document.title = (tab === 'wire' ? 'All Day' : mod.label + ' · All Day') + ' — Burlington Brief';
  if (switched) panels[tab].scrollTop = scrollMemory[tab] || 0;
  showChrome();
  closePeek();
  try { mod.activate(param, first); } catch (e) { console.error('[all-day] ' + tab + ' activate threw', e); }
  store.touchVisit();
  recount();

  /* Which feeds people actually live in. GoatCounter events, one per tab
     LANDING (first paint or a real switch, never a same-tab re-route), so
     the dashboard reads as "times a tab was opened". count.js loads async
     and ad blockers eat it — the guard means tracking can never break the
     app. */
  if ((switched || first) && window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({
      path: 'all-day-tab-' + tab,
      title: 'All Day tab: ' + tab,
      event: true,
    });
  }
}

/* ------------------------------------------------------------------- boot */
/* main.js imports every tab (each calls register()), then calls start(). */
export function start() {
  if (started) return;
  started = true;
  const app = $('app');
  const bar = $('tabbar');
  bar.appendChild(el('div', 'rail-brand', 'All Day'));
  TABS.forEach((key) => {
    const mod = registry[key];
    if (!mod) return;
    const p = el('section', 'panel');
    p.id = 'panel-' + key;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', 'tab-' + key);
    p.hidden = true;
    const ptr = el('div', 'ptr', '<span></span>');
    const body = el('div', 'panel-body');
    p.append(ptr, body);
    app.appendChild(p);
    panels[key] = p;
    bodies[key] = body;
    watchScroll(p);

    const b = el('button', null, mod.icon + '<span>' + esc(mod.label) + '</span>');
    b.id = 'tab-' + key;
    b.dataset.tab = key;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'false');
    b.setAttribute('aria-controls', 'panel-' + key);
    b.addEventListener('click', () => {
      if (active === key) { scrollTop(true); checkNew(); }
      else go(key);
    });
    bar.appendChild(b);
  });

  /* the emailed sign-in link lands on a hash the router must not see */
  const signin = auth.consumeHash();
  if (signin) signin.then((msg) => { if (msg) toast(msg); });
  else auth.refresh();

  store.touchVisit();
  route();
}

store.applyTheme(store.theme());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (store.theme() === 'auto') store.applyTheme('auto');
  paintThemeBtn();
});
paintThemeBtn();
$('theme-btn').addEventListener('click', () => { store.setTheme(store.nextTheme()); paintThemeBtn(); });
$('saved-btn').innerHTML = ICON.star;
$('settings-btn').innerHTML = ICON.gear;
$('saved-btn').addEventListener('click', savedSheet);
$('settings-btn').addEventListener('click', settingsSheet);
$('p-close').innerHTML = ICON.x;
$('vbox-close').innerHTML = ICON.x;
paintSavedBtn();
paintPlayButtons();

$('wordmark').addEventListener('click', (e) => {
  e.preventDefault();
  if (active === 'wire') { scrollTop(true); checkNew(); } else go('wire');
});

/* A picture that fails to load disappears instead of leaving a grey hole; a
   row whose thumbnail fails reflows to full width. Error events do not
   bubble, so this listens in the capture phase. */
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.classList.contains('pic')) return;
  const box = img.closest('.c-thumb, .c-media, .th, .tile, .p-art, .mark');
  if (box && box.classList.contains('c-thumb')) { box.closest('.card')?.classList.remove('has-thumb'); box.remove(); }
  else if (box && box.classList.contains('c-media') && !box.closest('.poster, .vcard, .hero, .result, .lb, .peek')) box.remove();
  else img.remove();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (lbEl) closeLightbox();
  else if (peekEl) closePeek();
  else if (!$('vbox').hidden) closeVideo();
  else if (!$('confirm').hidden) $('confirm').hidden = true;
  else if (sheetClose) sheetClose();
});

window.addEventListener('hashchange', () => { if (started) route(); });
window.addEventListener('resize', measure);
if ('ResizeObserver' in window) new ResizeObserver(measure).observe(mast);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
