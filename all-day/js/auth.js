/* auth.js — optional email sign-in, by magic link, on the fleet's one
   Supabase project. Nothing in All Day requires it: the Wire, saves, votes
   and mutes all work signed out. It exists so later tabs (People, Watch's
   shared log, comments) can ask app.user() and get a real person.

   How it works, in plain terms: you type your email in Settings, Supabase
   emails a link, the link opens All Day with a one-time token in the URL,
   and this file swaps that token for a session it keeps in localStorage.
   Raw REST against Supabase Auth (GoTrue) with the publishable key, the same
   way store.js talks to the database, so there is no library to load.

   Fails soft in every direction. If Email sign-in is switched off in the
   project, or the settings call fails, status() is 'off' and the Settings
   row says "coming soon". Demo mode never calls out at all. */

import * as store from './store.js';

const SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon — safe to ship
/* Where the emailed link lands. Production is the address readers use; on a
   preview or a laptop it is wherever this page is, which Supabase will only
   honour if that address is in the project's redirect allow-list. */
const HOME = 'https://guide.btownbrief.com/all-day/';

let state = 'checking';        // 'checking' | 'on' | 'off'
let probe = null;
const listeners = new Set();

export const status = () => state;
export const user = () => store.user();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const tell = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* a listener's bug is its own */ } });

function call(path, opts = {}) {
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  return fetch(SB_URL + '/auth/v1/' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then((r) => r.json().catch(() => ({})).then((j) => ({ ok: r.ok, status: r.status, json: j })))
    .catch(() => ({ ok: false, status: 0, json: {} }));
}

/* Is Email sign-in switched on in the project? Asked once per visit. */
export function check() {
  if (store.isDemo()) { state = 'off'; return Promise.resolve(state); }
  if (probe) return probe;
  probe = call('settings').then((r) => {
    state = r.ok && r.json && r.json.external && r.json.external.email === true ? 'on' : 'off';
    tell();
    return state;
  });
  return probe;
}

const redirectTo = () => (/^(localhost|127\.|\[?::1)/.test(location.hostname) || location.protocol === 'file:'
  ? HOME : location.origin + location.pathname);

/* Send the link. Resolves { ok, message } for the Settings row to show. */
export function sendLink(email) {
  if (store.isDemo()) return Promise.resolve({ ok: false, message: 'Sign-in is off in the demo.' });
  const e = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return Promise.resolve({ ok: false, message: 'That doesn’t look like an email address.' });
  if (state !== 'on') return Promise.resolve({ ok: false, message: 'Sign-in is coming soon.' });
  return call('otp?redirect_to=' + encodeURIComponent(redirectTo()), { method: 'POST', body: { email: e, create_user: true } })
    .then((r) => {
      if (r.ok) return { ok: true, message: 'Check your email for a sign-in link.' };
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

function keep(tok, u) {
  const now = Math.floor(Date.now() / 1000);
  store.setSession({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Number(tok.expires_at) || now + (Number(tok.expires_in) || 3600),
    user: { id: u.id, email: u.email || '' },
  });
  tell();
}

/* The emailed link lands here with the token in the URL hash, which is also
   where the router looks. Called before the first route: when the hash is a
   sign-in, it is taken out of the address bar (so a shared link never carries
   it) and the reader lands on the Wire. Returns a promise of a message for
   the toast, or null when the hash was not ours. */
export function consumeHash() {
  if (store.isDemo()) return null;
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error_code|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search + '#wire');
  if (p.get('error') || p.get('error_code')) {
    return Promise.resolve(p.get('error_code') === 'otp_expired'
      ? 'That sign-in link has expired. Send a new one from Settings.'
      : 'Sign-in didn’t work. Send a new link from Settings.');
  }
  const tok = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
    expires_at: p.get('expires_at'), expires_in: p.get('expires_in') };
  if (!tok.access_token) return Promise.resolve(null);
  return call('user', { token: tok.access_token }).then((r) => {
    if (r.ok && r.json && r.json.id) { keep(tok, r.json); return 'Signed in as ' + (r.json.email || 'you'); }
    /* Offline or a blip, not a refusal: the tokens came straight from
       Supabase's redirect, so keep them, naming the reader from the token's
       own claims; the next refresh() checks them with the server. */
    const claims = r.status === 0 ? jwtClaims(tok.access_token) : null;
    if (claims && claims.sub) { keep(tok, { id: claims.sub, email: claims.email || '' }); return 'Signed in as ' + (claims.email || 'you'); }
    return 'Sign-in didn’t work. Send a new link from Settings.';
  });
}

/* Keep a session alive: refresh when it is within five minutes of expiring.
   A refresh that is refused (revoked, expired) signs out quietly. */
export function refresh() {
  const s = store.session();
  if (!s || store.isDemo()) return Promise.resolve(null);
  const now = Math.floor(Date.now() / 1000);
  if (Number(s.expires_at) - now > 300) return Promise.resolve(s);
  return call('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } }).then((r) => {
    if (r.ok && r.json && r.json.access_token && r.json.user) { keep(r.json, r.json.user); return store.session(); }
    if (r.status >= 400 && r.status < 500) { store.setSession(null); tell(); }
    return null;
  });
}

export function signOut() {
  if (store.isDemo()) return;
  const s = store.session();
  store.setSession(null);
  tell();
  if (s) call('logout?scope=local', { method: 'POST', token: s.access_token });
}

/* A fresh access token for a later tab that calls Supabase as the reader. */
export function token() { return refresh().then((s) => (s ? s.access_token : null)); }
