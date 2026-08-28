/* store.js — everything this app remembers, and the one way it talks to
   Supabase.

   Deliberate reuse: read-state, the player id and the TV reactions live under
   the SAME localStorage keys the existing pages use, so what you have already
   read on pulse.html shows as read here, and a ✓ here still teaches tomorrow's
   BTown TV edition. Saved is the exception — the existing pulse2-saved holds
   article rows only, and this app saves across five kinds of thing, so it gets
   its own key and imports the old list once on first run.

   No new Supabase tables. The existing pulse_* and tv_* functions already do
   what this app needs, and feeding them from here keeps both signal loops
   whole. The `ad_` prefix stays reserved for anything genuinely new. */

const SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon — safe to ship

/* Shared with pulse.html, tv.html and every game. */
const PLAYER_KEY = 'btown-player-id';
const READ_KEY = 'pulse2-read';          // { urlKey: epochSec }
const OLD_SAVED_KEY = 'pulse2-saved';    // imported once
const TV_REACT_KEY = 'btown-tv-reacts';  // { videoId: 'watched'|'skip'|'more' }

/* This app's own. */
const SAVED_KEY = 'allday-saved';
const SET_KEY = 'allday-settings';
const HEARD_KEY = 'allday-heard';        // { episodeKey: seconds }
const TRAIL_KEY = 'allday-trail';        // Wander history
const VISIT_KEY = 'allday-visit';

const READ_CAP = 4000;
const SAVED_CAP = 400;
const HEARD_CAP = 300;

/* ------------------------------------------------------------ primitives */

export function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* Private mode, or the quota is full. Losing a preference is survivable;
       throwing in the middle of a render is not. */
  }
}

/* djb2, base36 — the same 8-character url key pulse.js uses, so read-state is
   genuinely interoperable rather than merely similarly named. */
export function keyOf(u) {
  const s = String(u || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function playerId() {
  let id = null;
  try {
    id = localStorage.getItem(PLAYER_KEY);
  } catch (e) { /* no storage */ }
  if (!id) {
    id = (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(PLAYER_KEY, id); } catch (e) { /* no storage */ }
  }
  return id;
}

/* ------------------------------------------------------------- settings */

const DEFAULTS = {
  fs: 16.5,          // headline size in px
  thumbs: true,
  autohideRead: false,
  showRail: true,
  ythidden: {},      // channel key -> 1
  hidden: {},        // source id -> 1
};

let settings = Object.assign({}, DEFAULTS, read(SET_KEY, {}));

export function setting(name) { return settings[name]; }

export function setSetting(name, value) {
  settings[name] = value;
  write(SET_KEY, settings);
}

export function allSettings() { return settings; }

/* Muting a source on the Pulse should follow you here. Pulse keeps its mutes
   under pulse2-settings; read them, but never write back — that file belongs
   to the other page. */
export function inheritedMutes() {
  const p = read('pulse2-settings', null);
  if (!p) return { hidden: {}, ythidden: {} };
  return { hidden: p.hidden || {}, ythidden: p.ythidden || {} };
}

/* ----------------------------------------------------------- read state */

let readMap = read(READ_KEY, {}) || {};

export function isRead(k) { return !!readMap[k]; }

export function markRead(k) {
  if (!k || readMap[k]) return;
  readMap[k] = Math.floor(Date.now() / 1000);
  const keys = Object.keys(readMap);
  if (keys.length > READ_CAP) {
    keys.sort((a, b) => readMap[a] - readMap[b])
      .slice(0, keys.length - READ_CAP)
      .forEach((old) => delete readMap[old]);
  }
  write(READ_KEY, readMap);
}

/* ---------------------------------------------------------------- saved */
/* One list across all five modes. Each row is
   { k, kind, t, u, s, d, i, sv } where kind is
   'article' | 'video' | 'episode' | 'wiki' and sv is when it was saved. */

let saved = read(SAVED_KEY, null);

if (saved === null) {
  // First run: bring over whatever pulse.html already had.
  const old = read(OLD_SAVED_KEY, []) || [];
  saved = old.map((r) => ({
    k: r.k, kind: 'article', t: r.t, u: r.u, s: r.s, d: r.d, sv: r.sv || Math.floor(Date.now() / 1000),
  }));
  write(SAVED_KEY, saved);
}

export function savedList() { return saved; }
export function savedCount() { return saved.length; }
export function isSaved(k) { return saved.some((r) => r.k === k); }

export function toggleSave(row) {
  const at = saved.findIndex((r) => r.k === row.k);
  if (at >= 0) {
    saved.splice(at, 1);
    write(SAVED_KEY, saved);
    return false;
  }
  saved.unshift(Object.assign({ sv: Math.floor(Date.now() / 1000) }, row));
  if (saved.length > SAVED_CAP) saved.length = SAVED_CAP;
  write(SAVED_KEY, saved);
  return true;
}

/* ------------------------------------------------- podcast resume points */

let heard = read(HEARD_KEY, {}) || {};

export function heardAt(k) { return heard[k] ? heard[k].t : 0; }

export function setHeard(k, seconds, duration) {
  if (!k) return;
  // Finished is not a resume point — start it over next time.
  if (duration && seconds > duration - 25) { delete heard[k]; }
  else heard[k] = { t: Math.floor(seconds), at: Math.floor(Date.now() / 1000) };
  const keys = Object.keys(heard);
  if (keys.length > HEARD_CAP) {
    keys.sort((a, b) => heard[a].at - heard[b].at)
      .slice(0, keys.length - HEARD_CAP)
      .forEach((old) => delete heard[old]);
  }
  write(HEARD_KEY, heard);
}

/* --------------------------------------------------------- TV reactions */

let tvReacts = read(TV_REACT_KEY, {}) || {};

export function tvReact(id) { return tvReacts[id] || null; }

export function setTvReact(id, kind) {
  if (!id) return;
  if (kind) tvReacts[id] = kind; else delete tvReacts[id];
  write(TV_REACT_KEY, tvReacts);
}

/* ------------------------------------------------------- Wander's trail */

export function trail() { return read(TRAIL_KEY, []) || []; }
export function setTrail(list) { write(TRAIL_KEY, list.slice(0, 40)); }

/* ---------------------------------------------------- the visit baseline */
/* A gap of 30 minutes or more starts a new visit, which is what the "since
   you were here" divider measures against. */

export function visitBaseline() {
  const v = read(VISIT_KEY, null);
  const now = Math.floor(Date.now() / 1000);
  if (!v || now - v.last > 1800) {
    const base = v ? v.last : now;
    write(VISIT_KEY, { base, last: now });
    return base;
  }
  if (now - v.last > 300) write(VISIT_KEY, { base: v.base, last: now });
  return v.base;
}

export function touchVisit() {
  const v = read(VISIT_KEY, null);
  const now = Math.floor(Date.now() / 1000);
  write(VISIT_KEY, { base: v ? v.base : now, last: now });
}

/* -------------------------------------------------------------- Supabase */
/* Raw REST against the security-definer functions. RLS is on with no
   policies, so the anon key can only reach data through these. Analytics must
   never break the page: every call swallows its own failure. */

export function rpc(fn, args) {
  return fetch(SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    keepalive: true,
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
    .then((r) => (r.ok ? r.json().catch(() => null) : null))
    .catch(() => null);
}
