/* auth.js — optional email sign-in, by magic link, on the fleet's one
   Supabase project. Nothing in All Day requires it: the Wire, saves, votes
   and mutes all work signed out. Posting on a board, reporting a post and
   syncing missions ask app.user() and get a real person.

   How it works, in plain terms: you type your email in Settings, Supabase
   emails a link, the link opens All Day with a one-time token in the URL,
   and this file swaps that token for a session it keeps in localStorage
   (store.js 'allday-auth'). The access token is refreshed on each visit and
   before it runs out, on a timer and whenever the app comes back to the
   front, so a reader stays
   signed in for weeks without seeing a sign-in again. Raw REST against
   Supabase Auth (GoTrue) with the publishable key, the same way store.js
   talks to the database, so there is no library to load.

   What is kept: the refresh token and the account id, in localStorage. The
   access token lives in memory only, because Supabase's access token is a
   JWT that carries the email among its claims. Nothing here stores, prints
   or decodes the email; Supabase knows it, the page does not keep it.

   Fails soft in every direction. If Email sign-in is switched off in the
   project, or the settings call fails, status() is 'off' and the Settings
   row says "coming soon". Demo mode never calls out at all: it has its own
   pretend reader, held in memory for the visit: the demo starts signed
   out, and its Settings "Sign in" signs into the pretend account at once. */

import * as store from './store.js';

/* Where the emailed link lands. Production is the address readers use; on a
   preview or a laptop it is wherever this page is, which Supabase will only
   honour if that address is in the project's redirect allow-list. */
const HOME = 'https://guide.btownbrief.com/all-day/';
const EARLY = 300;   // refresh when a session has five minutes or less to run

let state = 'checking';        // 'checking' | 'on' | 'off' | 'demo'
let probe = null;
const listeners = new Set();

/* The demo's pretend reader: no email, no token, nothing stored. Same id
   as boards-fake.js's DEMO_ME. */
const DEMO_ID = 'demo-0000-4000-8000-00000000me00';
let demoUser = null;

export const status = () => state;
export function user() {
  if (store.isDemo()) return demoUser ? { id: demoUser } : null;
  return store.user();
}
/* Tabs subscribe here: fn(user) runs on every sign-in, sign-out and
   session loss. Returns the unsubscribe. */
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const tell = () => { const u = user(); listeners.forEach((fn) => { try { fn(u); } catch (e) { /* a listener's bug is its own */ } }); };

function call(path, opts = {}) {
  const headers = { apikey: store.SB_KEY, 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  return fetch(store.SB_URL + '/auth/v1/' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then((r) => r.json().catch(() => ({})).then((j) => ({ ok: r.ok, status: r.status, json: j })))
    .catch(() => ({ ok: false, status: 0, json: {} }));
}

/* Is Email sign-in switched on in the project? Asked once per visit. */
export function check() {
  if (store.isDemo()) { state = 'demo'; return Promise.resolve(state); }
  if (probe) return probe;
  probe = call('settings').then((r) => {
    state = r.ok && r.json && r.json.external && r.json.external.email === true ? 'on' : 'off';
    tell();
    return state;
  });
  return probe;
}

/* The link comes back to the page that asked, production or a laptop's
   test copy; Supabase only honours addresses on the project's Redirect URLs
   list (SETUP-STEPHEN.md part A), so a file: page asks for production. */
const redirectTo = () => (location.protocol === 'file:' ? HOME : location.origin + location.pathname);

/* Send the link. Resolves { ok, message } for the Settings row to show. */
export function sendLink(email) {
  if (store.isDemo()) return Promise.resolve({ ok: false, message: 'Sign-in is off in the demo.' });
  const e = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return Promise.resolve({ ok: false, message: 'That doesn’t look like an email address.' });
  if (state !== 'on') return Promise.resolve({ ok: false, message: 'Sign-in is coming soon.' });
  return call('otp?redirect_to=' + encodeURIComponent(redirectTo()), { method: 'POST', body: { email: e, create_user: true } })
    .then((r) => {
      if (r.ok) return { ok: true, message: 'Check your email for a sign-in link. It works once, for an hour.' };
      if (r.status === 429) return { ok: false, message: 'Too many tries. Wait a minute and send it again.' };
      return { ok: false, message: 'Couldn’t send the link. Try again in a moment.' };
    });
}

function jwtClaims(t) {
  try {
    const part = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)));
  } catch (e) { return null; }
}

/* Keep a session. The refresh token and the account id go to storage (they
   carry no email); the access token, a JWT whose claims include the email,
   stays in this module's memory and is gone when the page is. */
let access = null;   // { token, expires_at, uid } for this page only
let gen = 0;         // bumped on every sign-in and sign-out: a late answer from before is ignored
function keep(tok, id) {
  const now = Math.floor(Date.now() / 1000);
  const before = store.user();
  if (!before || before.id !== id) gen++;
  store.setSession({ refresh_token: tok.refresh_token, user: { id } });
  access = { token: tok.access_token, expires_at: Number(tok.expires_at) || now + (Number(tok.expires_in) || 3600), uid: id };
  schedule();
  if (!before || before.id !== id) tell();
}

/* The emailed link lands here with the token in the URL hash, which is also
   where the router looks. Called before the first route: when the hash is a
   sign-in, it is taken out of the address bar (so a shared link never carries
   it) and the reader lands on the Wire. Returns a promise of a message for
   the toast, or null when the hash was not ours. */
/* the tab a sign-in lands on: the app's first (app.js sets it; All Day's is the Wire) */
let LAND = 'wire';
export function setHome(k) { if (k) LAND = String(k); }
export function consumeHash() {
  if (store.isDemo()) return null;
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error_code|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search + '#' + LAND);
  if (p.get('error') || p.get('error_code')) {
    return Promise.resolve(p.get('error_code') === 'otp_expired'
      ? 'That sign-in link has expired. Send a new one from Settings.'
      : 'Sign-in didn’t work. Send a new link from Settings.');
  }
  const tok = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
    expires_at: p.get('expires_at'), expires_in: p.get('expires_in') };
  if (!tok.access_token) return Promise.resolve(null);
  return call('user', { token: tok.access_token }).then((r) => {
    if (r.ok && r.json && r.json.id) { keep(tok, r.json.id); return 'You’re signed in.'; }
    /* Offline or a blip, not a refusal: the tokens came straight from
       Supabase's redirect, so keep them, naming the reader from the token's
       own claims; the next refresh() checks them with the server. */
    const claims = r.status === 0 ? jwtClaims(tok.access_token) : null;
    if (claims && claims.sub) { keep(tok, claims.sub); return 'You’re signed in.'; }
    return 'Sign-in didn’t work. Send a new link from Settings.';
  });
}

/* A live access token, refreshing when there is none on this page yet or it
   is within five minutes of running out. Resolves the token, or null.
   One refresh at a time: Supabase rotates the refresh token, so two racing
   requests would spend it twice and the loser would sign the reader out.
   A refresh that is refused (revoked, expired) signs out quietly; one that
   cannot reach the server keeps the session for the next try. An answer
   that arrives after the reader signed out (or in as someone else) is
   dropped, so a slow refresh can never sign a reader back in. */
let inflight = null;
export function refresh() {
  const s = store.session();
  if (!s || store.isDemo()) return Promise.resolve(null);
  /* the token in memory belongs to one account; if another tab has since
     signed in as someone else, it is not this reader's to use */
  if (access && access.uid !== s.user.id) { gen++; access = null; inflight = null; }
  const now = Math.floor(Date.now() / 1000);
  if (access && access.expires_at - now > EARLY) { schedule(); return Promise.resolve(access.token); }
  if (inflight) return inflight;
  const mine = gen;
  inflight = call('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } }).then((r) => {
    if (mine !== gen) return null;
    inflight = null;
    const cur = store.session();
    if (!cur || cur.user.id !== s.user.id) return null;
    if (r.ok && r.json && r.json.access_token && r.json.refresh_token) { keep(r.json, s.user.id); return access.token; }
    if (r.status >= 400 && r.status < 500) { gen++; store.setSession(null); access = null; unschedule(); tell(); }
    return null;
  });
  return inflight;
}

/* A timer for just before the access token runs out, plus a check whenever
   the app comes back to the front (a phone that slept through the timer). */
let timer = 0;
function unschedule() { clearTimeout(timer); timer = 0; }
function schedule() {
  unschedule();
  if (!access || !store.session()) return;
  const wait = (access.expires_at - EARLY - Math.floor(Date.now() / 1000)) * 1000;
  timer = setTimeout(() => { refresh(); }, Math.max(1000, Math.min(wait, 2147483000)));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store.session()) refresh(); });

/* Another All Day tab signed in, out, or as someone else: this tab drops its
   token and tells its listeners, so it never acts for the wrong account. */
window.addEventListener('storage', (e) => {
  if (e.key !== 'allday-auth' && e.key !== null) return;
  const s = store.session();
  if (access && (!s || access.uid !== s.user.id)) { gen++; access = null; inflight = null; unschedule(); }
  tell();
});

export function signOut() {
  if (store.isDemo()) { demoUser = null; tell(); return; }
  const tok = access && access.token;
  gen++;
  inflight = null;
  access = null;
  store.setSession(null);
  unschedule();
  tell();
  if (tok) call('logout?scope=local', { method: 'POST', token: tok });
}

/* The demo's sign-in button: the pretend reader is back. */
export function demoSignIn() { if (store.isDemo()) { demoUser = DEMO_ID; tell(); } }

/* A fresh access token for a tab that calls Supabase as the reader. */
export function token() { return refresh(); }
