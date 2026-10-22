/* asks.js — the shell's two gentle asks, and its easy ways out (Stephen,
   2026-10-22, walking: "I should show people how to bookmark this page",
   and "make people give me their email after a certain amount of time on
   the app ... foolproof ... super secure where if someone were to try and
   hack me ... people couldn't find my email list").

   1. Keep All Day on your home screen. After three visits, at most once a
      week, never when it is already installed (standalone, or opened from
      the home screen's ?source=pwa). Chrome's own install prompt where the
      browser offers one; an iPhone gets the two taps drawn small (Share,
      then Add to Home Screen); anything else the bookmark keys.
   2. Get the Btown Brief in your inbox. After real use (three visits over
      two Burlington days, or ten minutes on screen), a small card with
      Beehiiv's own signup form in it. The form is Beehiiv's page in a
      frame: the address is typed into beehiiv.com, never into this app, so
      no script here can read it and nothing we host ever holds it. The
      frame is sandboxed without top navigation, so a signup can never yank
      the reader out of the app. Never shown again once they are a reader:
      a visit from a newsletter link (Beehiiv's _bhlid, or its
      utm_medium=newsletter from btownbrief), Beehiiv's own "submitted"
      message from the frame, or "I'm already subscribed".

   One ask per page load, in the tab the reader lands on, above the tab's
   own first section. Never a modal, never in the way: a card in the page
   with a close button. Demo mode shows neither. Settings keeps a permanent
   "Add to home screen" row, and Settings and the Wire's foot carry the
   easy buttons out: X, Facebook, Reddit (r/burlington), for when you do
   want them. */

import * as store from './store.js';
import { el, esc, ICON, button } from './ui.js';

/* the Brief's own Beehiiv embed, the one the hub uses (hub.btownbrief.com #subscribe) */
export const BEEHIIV_EMBED = 'https://embeds.beehiiv.com/a1c106df-f519-4dfc-a892-61261d0f8389?slim=true';
const BEEHIIV_ORIGIN = 'https://embeds.beehiiv.com';
const DAY_MS = 86400000;

export const OUT = [
  ['X', 'https://x.com/'],
  ['Facebook', 'https://www.facebook.com/'],
  ['Reddit', 'https://www.reddit.com/r/burlington/'],
];

let demo = false;
let deferred = null;     // Chrome's install prompt, held until the reader asks
let shown = false;       // one ask per page load
let toastFn = () => {};

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; store.setAsk('installed', true); });

const ua = () => navigator.userAgent || '';
const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/.test(ua());
const isMac = () => /Mac/.test(navigator.platform || ua());

export function installed() {
  try { if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) return true; } catch (e) { /* old browser */ }
  return /[?&]source=pwa(&|$)/.test(location.search) || !!store.asks().installed;
}
export const subscribed = () => !!store.asks().subscribed;

/* real use, so the ask is earned */
const realUse = (u) => (u.visits >= 3 && u.days.length >= 2) || u.secs >= 600;
const due = (key, now) => now >= (Number(store.asks()[key]) || 0);
export function newsDue(now = Date.now()) { return !demo && !subscribed() && due('newsNext', now) && realUse(store.use()); }
export function homeDue(now = Date.now()) { return !demo && !installed() && due('homeNext', now) && store.use().visits >= 3; }

/* once, before the first route */
export function boot(isDemo, toast) {
  demo = !!isDemo;
  if (toast) toastFn = toast;
  if (demo) return;
  let q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  if (q) {
    const fromEmail = q.has('_bhlid') || (q.get('utm_medium') === 'newsletter' && /btownbrief/i.test(q.get('utm_source') || ''));
    if (fromEmail) store.setAsk('subscribed', true);
    /* the reader's own tracking id stays out of the address bar, so a copied link doesn't carry it */
    if (q.has('_bhlid')) {
      q.delete('_bhlid');
      const rest = q.toString();
      try { history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash); } catch (e) { /* fine */ }
    }
  }
  if (installed()) store.setAsk('installed', true);
  store.countVisit();
  setInterval(() => { if (document.visibilityState === 'visible') store.addUse(15); }, 15000);
  window.addEventListener('message', (e) => {
    if (e.origin !== BEEHIIV_ORIGIN) return;
    const t = e.data && typeof e.data === 'object' ? e.data.type : '';
    if (t !== 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED' && t !== 'BEEHIIV_SUBSCRIBER_FORM_REDIRECT') return;
    /* the message carries the address; it is not read, logged or kept */
    store.setAsk('subscribed', true);
    document.querySelectorAll('.askcard[data-ask="news"]').forEach((c) => {
      c.innerHTML = '';
      c.appendChild(el('p', 'ask-t', esc('You’re in. Thanks for reading.')));
      setTimeout(() => c.remove(), 4000);
    });
  });
}

/* a tab was landed on: maybe one ask, at its top */
export function landed(slot) {
  if (demo || shown || !slot) return;
  const now = Date.now();
  const kind = newsDue(now) ? 'news' : homeDue(now) ? 'home' : null;
  if (!kind) return;
  shown = true;
  slot.innerHTML = '';
  slot.appendChild(kind === 'news' ? newsCard() : homeCard());
  /* shown is counted: the home ask waits a week, the newsletter three days */
  store.setAsk(kind === 'news' ? 'newsNext' : 'homeNext', now + (kind === 'news' ? 3 : 7) * DAY_MS);
}

function card(kind, title, onClose) {
  const c = el('div', 'askcard');
  c.dataset.ask = kind;
  c.setAttribute('role', 'region');
  c.setAttribute('aria-label', title);
  const head = el('div', 'ask-head', '<b class="ask-t">' + esc(title) + '</b>');
  const x = el('button', 'iconbtn ask-x', ICON.x);
  x.type = 'button';
  x.setAttribute('aria-label', 'Not now');
  x.addEventListener('click', () => { onClose(); c.remove(); });
  head.appendChild(x);
  c.appendChild(head);
  return c;
}

/* ------------------------------------------------------- home screen */
function homeCard() {
  const c = card('home', 'Keep All Day on your home screen', () => store.setAsk('homeNext', Date.now() + 7 * DAY_MS));
  c.appendChild(howTo(() => c.remove()));
  return c;
}

/* the browser's own install prompt, if it offered one: false when it didn't */
function promptInstall(done) {
  if (!deferred) return false;
  const p = deferred;
  deferred = null;
  try { p.prompt(); } catch (e) { return false; }
  Promise.resolve(p.userChoice).then((r) => {
    if (r && r.outcome === 'accepted') { store.setAsk('installed', true); toastFn('Added'); if (done) done(); }
  }).catch(() => {});
  return true;
}

/* The way in on this phone: the browser's own install button where it
   offers one, else the two taps drawn small. */
export function howTo(done) {
  const box = el('div', 'ask-how');
  if (deferred) {
    box.appendChild(button(ICON.plus + ' Add to home screen', 'sm', () => promptInstall(done)));
    return box;
  }
  const key = (icon, label) => '<span class="ask-step"><span class="ask-key">' + icon + '</span>' + esc(label) + '</span>';
  const then = '<span class="ask-then" aria-hidden="true">' + ICON.right + '</span>';
  const DOTS = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/></svg>';
  if (isIOS()) box.innerHTML = key(ICON.share, 'Share') + then + key(ICON.plus, 'Add to Home Screen');
  else if (isAndroid()) box.innerHTML = key(DOTS, 'Menu') + then + key(ICON.plus, 'Add to Home screen');
  else box.innerHTML = '<span class="ask-step"><span class="ask-key wide">' + esc(isMac() ? '⌘ D' : 'Ctrl D') + '</span>' + esc('Bookmark it') + '</span>';
  return box;
}

/* ------------------------------------------------------- newsletter */
function newsCard() {
  const c = card('news', 'Get the Btown Brief in your inbox', () => store.setAsk('newsNext', Date.now() + 14 * DAY_MS));
  const f = document.createElement('iframe');
  f.className = 'ask-embed';
  f.src = BEEHIIV_EMBED;
  f.title = 'Subscribe to the Btown Brief';
  f.height = '52';
  f.loading = 'lazy';
  f.setAttribute('frameborder', '0');
  f.setAttribute('scrolling', 'no');
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  /* Beehiiv's page may run and submit its form, never steer this one */
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
  c.appendChild(f);
  const foot = el('div', 'ask-foot');
  foot.appendChild(button('I’m already subscribed', 'ghost sm', () => { store.setAsk('subscribed', true); c.remove(); toastFn('Thanks for reading'); }));
  c.appendChild(foot);
  return c;
}

/* ------------------------------------------------------- the ways out */
export function outRow(cls) {
  const row = el('div', 'outrow' + (cls ? ' ' + cls : ''));
  row.appendChild(el('span', 'outrow-l', 'Open'));
  OUT.forEach(([label, href]) => {
    const a = el('a', 'btn ghost sm', esc(label) + ' ' + ICON.ext);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.out = label.toLowerCase();
    row.appendChild(a);
  });
  return row;
}

/* Settings: the permanent home-screen row and the ways out */
export function settingsRows(body) {
  body.appendChild(el('div', 'sheet-h', 'Your phone'));
  const r = el('div', 'sheet-row homerow');
  if (installed()) {
    r.appendChild(el('div', 't', esc('On your home screen') + ' ' + ICON.check));
    body.appendChild(r);
  } else {
    r.appendChild(el('div', 't', esc('Add to home screen')));
    const how = el('div', 'homehow');
    how.hidden = true;
    const b = button('Show me', 'ghost sm', () => {
      if (promptInstall()) return;
      how.hidden = !how.hidden;
      if (!how.hidden) { how.innerHTML = ''; how.appendChild(howTo()); }
    });
    b.dataset.home = '1';
    r.appendChild(b);
    body.append(r, how);
  }
  body.appendChild(el('div', 'sheet-h', 'Elsewhere'));
  body.appendChild(outRow());
}

/* for the tests */
export const _reset = () => { shown = false; };
