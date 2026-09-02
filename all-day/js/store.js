/* store.js — everything this app remembers, and the one way it talks to
   Supabase.

   Deliberate reuse. Read-state, the player id, muted sources and the TV
   reactions live under the SAME localStorage keys the existing pages use, so
   an article you read on pulse.html shows as read here, a source you mute
   here disappears there too, and a ✓ on a video still teaches tomorrow's
   BTown TV edition. Saved is the exception: pulse2-saved holds article rows
   only, and this app saves across five kinds of thing, so it gets its own key
   and imports the old list once.

   Votes are the one genuinely new thing, under the reserved `ad_` prefix.
   They are anonymous — keyed to the same btown-player-id the games use, no
   login — and they fail soft in every direction: if the SQL has not been
   pasted into Supabase yet, every call returns null, counts stay hidden and
   nothing on the page breaks.

   Every localStorage touch is wrapped. Safari in private mode throws on
   write, and an uncaught QuotaExceededError here would take down the app. */

const SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon — safe to ship

/* Shared with pulse.html, tv.html and the games. Do not rename. */
const PLAYER_KEY = 'btown-player-id';
const READ_KEY = 'pulse2-read';          // { urlKey: epochSec }
const INTENT_KEY = 'pulse2-intent';      // { urlKey: epochSec } — scrolled past
const PULSE_SET_KEY = 'pulse2-settings'; // { hidden: { sourceId: 1 }, ... }
const OLD_SAVED_KEY = 'pulse2-saved';
const TV_REACT_KEY = 'btown-tv-reacts';  // { videoId: 'watched'|'skip'|'more' }

/* This app's own. */
const SAVED_KEY = 'allday-saved';
const SET_KEY = 'allday-settings';
const HEARD_KEY = 'allday-heard';        // { episodeKey: seconds }
const TRAIL_KEY = 'allday-trail';
const VISIT_KEY = 'allday-visit';
const THEME_KEY = 'allday-theme';        // 'light' | 'dark' | absent = follow the phone
const VOTED_KEY = 'allday-voted';        // optimistic mirror of what you upvoted
const WELCOME_KEY = 'allday-welcomed';   // the intro card, shown once

const READ_CAP = 4000;
const SAVED_CAP = 400;
const HEARD_CAP = 300;
const TRAIL_CAP = 40;
const VISIT_GAP = 1800; // 30 quiet minutes starts a new visit

/* ------------------------------------------------------------ primitives */

export function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

/* A stored value that should be an array can come back as anything — a
   corrupt write, a half-finished migration, someone poking at devtools. */
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/* Trim a { key: number } map to its most recent entries. */
function capMap(map, cap) {
  const keys = Object.keys(map);
  if (keys.length <= cap) return map;
  keys.sort((a, b) => (map[b] || 0) - (map[a] || 0));
  const out = {};
  for (let i = 0; i < cap; i++) out[keys[i]] = map[keys[i]];
  return out;
}

/* --------------------------------------------------------------- player */

export function playerId() {
  let id = null;
  try { id = localStorage.getItem(PLAYER_KEY); } catch (e) { /* private mode */ }
  if (id) return id;
  id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  try { localStorage.setItem(PLAYER_KEY, id); } catch (e) { /* ephemeral is fine */ }
  return id;
}

/* ------------------------------------------------------------- welcome */
/* Shown once, ever. A returning reader who has already been told what this
   is does not need telling again. */
export function needsWelcome() {
  try { return !localStorage.getItem(WELCOME_KEY); } catch (e) { return false; }
}
/* One-shot UI hints, keyed by name: { tipName: 1 } once dismissed. */
const TIPS_KEY = 'allday-tips';
export const tipDone = (name) => !!obj(read(TIPS_KEY, {}))[name];
export function dismissTip(name) {
  const m = obj(read(TIPS_KEY, {}));
  m[name] = 1;
  write(TIPS_KEY, m);
}

export function markWelcomed() {
  try { localStorage.setItem(WELCOME_KEY, String(Date.now())); } catch (e) { /* fine */ }
}

/* --------------------------------------------------------------- theme */

export function theme() {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; }
}

export function setTheme(mode) {
  try {
    if (mode === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch (e) { /* the class below still applies for this session */ }
  applyTheme(mode);
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  paintStatusBar();
}

/* Added to the home screen the app runs under the iOS clock, and iOS reads
   theme-color to decide whether to draw that clock in black or white. The
   strip it lands on is whatever is at the very top of the page: the shared
   network bar, which is navy in BOTH themes. So the meta has to say navy —
   answer with the page's own ground and a light-mode phone paints a black
   clock onto the navy. If the bar never loaded, the masthead is the top strip
   and the theme's own colour is the right answer again. app.js calls this
   back when nav.js lands. */
const NAV_BG = '#0E2230';

export function paintStatusBar() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  /* nav.js is deferred and cross-origin, so for the first moment of every load
     the bar is merely late rather than absent. Hold navy until the page has
     finished loading and we can tell the difference — flipping the meta twice
     on the way in makes the clock blink. */
  if (document.querySelector('.btnav') || document.readyState !== 'complete') {
    meta.setAttribute('content', NAV_BG);
    return;
  }
  const t = theme();
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  meta.setAttribute('content', dark ? '#06080A' : '#FBF9F5');
}

/* What the toggle should flip to: whatever you are NOT looking at now. */
export function nextTheme() {
  const t = theme();
  if (t === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
  return t === 'dark' ? 'light' : 'dark';
}

/* ------------------------------------------------------------- settings */

const SETTING_DEFAULTS = {
  focus: false,      // read items disappear instead of dimming
  topic: 'all',
  /* Local first since 9/2 — the app's identity is Burlington, and Stephen
     himself read the wire as local-only before the switch existed. Anyone
     who has ever touched the switch keeps their own answer; this is only
     the starting position for people who never chose. */
  localOnly: true,
  layout: 'newest',  // 'newest' one stream, or 'sources' the by-outlet grid
  source: '',        // one outlet only, '' for all
};

export function settings() {
  return { ...SETTING_DEFAULTS, ...obj(read(SET_KEY, {})) };
}

export function setSetting(key, value) {
  const s = settings();
  s[key] = value;
  write(SET_KEY, s);
  return s;
}

/* ---------------------------------------------------------------- mutes */
/* Shared with pulse.html: state.set.hidden is a { sourceId: 1 } map inside
   pulse2-settings. Muting here mutes there, which is the whole point. */

export function muted() {
  return obj(obj(read(PULSE_SET_KEY, {})).hidden);
}

export function isMuted(sourceId) {
  return !!muted()[sourceId];
}

export function setMuted(sourceId, on) {
  const s = obj(read(PULSE_SET_KEY, {}));
  s.hidden = obj(s.hidden);
  if (on) s.hidden[sourceId] = 1;
  else delete s.hidden[sourceId];
  write(PULSE_SET_KEY, s);
}

/* ----------------------------------------------------------------- read */

export function readMap() { return obj(read(READ_KEY, {})); }

export function isRead(key) { return !!readMap()[key]; }

export function markRead(key) {
  if (!key) return;
  const m = readMap();
  if (m[key]) return;
  m[key] = Math.floor(Date.now() / 1000);
  write(READ_KEY, capMap(m, READ_CAP));
}

/* --------------------------------------------------------------- passed */
/* Headlines that scrolled off the top while you were looking at them. Pulse
   calls this "read with intent" and dims them; the same key, so a headline
   you scrolled past there is already grey here. */

/* Cached, because hasPassed() is asked once per row: parsing a 500-entry map
   sixty times to draw one screen is the kind of thing that makes a phone
   feel slow for no reason. */
let passedCache = null;
export function passedMap() {
  if (!passedCache) passedCache = obj(read(INTENT_KEY, {}));
  return passedCache;
}
export function hasPassed(key) { return !!passedMap()[key]; }
export function markPassed(keys) {
  const m = passedMap();
  let touched = false;
  keys.forEach((k) => { if (k && !m[k]) { m[k] = Math.floor(Date.now() / 1000); touched = true; } });
  if (!touched) return;
  passedCache = capMap(m, READ_CAP);
  write(INTENT_KEY, passedCache);
}

/* ---------------------------------------------------------------- saved */
/* One list across all five kinds of thing: { k, kind, title, from, href, art } */

export function saved() {
  const list = arr(read(SAVED_KEY, null));
  if (list.length) {
    /* reader saves keyed on the bare title before 9/2; door saves on
       'wiki:'+title. Normalise to the prefixed shape once, deduped, so the
       same article can never carry two independent stars. */
    let dirty = false;
    const seen = {};
    const clean = list.filter((i) => i && i.k).map((i) => {
      if (i.kind === 'wiki' && !String(i.k).startsWith('wiki:')) {
        dirty = true;
        return { ...i, k: 'wiki:' + i.k };
      }
      return i;
    }).filter((i) => (seen[i.k] ? (dirty = true, false) : (seen[i.k] = 1, true)));
    if (dirty) write(SAVED_KEY, clean);
    return clean;
  }
  /* first run: inherit whatever pulse.html had starred */
  const old = arr(read(OLD_SAVED_KEY, null));
  if (!old.length) return [];
  const migrated = old
    .filter((i) => i && (i.u || i.href))
    .map((i) => ({
      k: i.u || i.href,
      kind: 'wire',
      title: i.t || i.title || 'Untitled',
      from: i.short || i.from || '',
      href: i.u || i.href,
    }));
  write(SAVED_KEY, migrated);
  return migrated;
}

export function isSaved(k) { return saved().some((i) => i.k === k); }

export function toggleSaved(item) {
  const list = saved();
  const at = list.findIndex((i) => i.k === item.k);
  if (at >= 0) list.splice(at, 1);
  else list.unshift(item);
  write(SAVED_KEY, list.slice(0, SAVED_CAP));
  return at < 0;
}

/* -------------------------------------------------------------- listened */

export function heard() { return obj(read(HEARD_KEY, {})); }

export function heardAt(key) { return Number(heard()[key]) || 0; }

export function setHeardAt(key, seconds) {
  if (!key) return;
  const m = heard();
  m[key] = Math.round(seconds);
  write(HEARD_KEY, capMap(m, HEARD_CAP));
}

/* ------------------------------------------------------- TV reactions */
/* Same key tv.html writes, so a ✓ here still teaches the next edition. */

export function tvReacts() { return obj(read(TV_REACT_KEY, {})); }

export function tvReact(videoId, kind, title, channel) {
  const m = tvReacts();
  const was = m[videoId] || null;
  if (was === kind) delete m[videoId];
  else m[videoId] = kind;
  write(TV_REACT_KEY, m);
  const now = m[videoId] || null;
  if (was && was !== now) rpc('tv_unreact', { p_player: playerId(), p_kind: was, p_vid: videoId });
  /* title and channel label the row for the editor building tomorrow's
     edition — tv.html sent them, and an unlabelled reaction is near useless
     on that side, so pass them through rather than defaulting to '' */
  if (now) {
    rpc('tv_react', {
      p_player: playerId(), p_kind: now, p_vid: videoId,
      p_title: (title || '').slice(0, 200), p_channel: (channel || '').slice(0, 120),
    });
  }
  return now;
}

/* ---------------------------------------------------------------- trail */

/* The previous version of this app wrote objects into the same key, so a
   returning reader can have entries that stringify to "[object Object]".
   Normalise on read — pull the title out of an object, keep strings, drop
   anything else — so old storage heals itself instead of showing junk. */
export function trail() {
  const raw = arr(read(TRAIL_KEY, []));
  const clean = [];
  raw.forEach((entry) => {
    const title = typeof entry === 'string' ? entry
      : (entry && typeof entry === 'object' ? (entry.t || entry.title || entry.k) : null);
    if (typeof title === 'string' && title.trim() && clean.indexOf(title) === -1) clean.push(title);
  });
  if (clean.length !== raw.length) write(TRAIL_KEY, clean);   // rewrite once
  return clean;
}

export function pushTrail(title) {
  const list = trail().filter((t) => t !== title);
  list.push(title);
  write(TRAIL_KEY, list.slice(-TRAIL_CAP));
}

export function clearTrail() { write(TRAIL_KEY, []); }

/* ---------------------------------------------------------------- visit */
/* The baseline for "new since you last looked". Touched on every activation
   so a reload does not reset it; restarted after 30 minutes away. */

export function visitBase() {
  const v = obj(read(VISIT_KEY, {}));
  return Number(v.base) || 0;
}

export function touchVisit() {
  const now = Math.floor(Date.now() / 1000);
  const v = obj(read(VISIT_KEY, {}));
  const last = Number(v.last) || 0;
  write(VISIT_KEY, { base: (!last || now - last > VISIT_GAP) ? (last || now) : (Number(v.base) || now), last: now });
}

/* ------------------------------------------------------------- Supabase */
/* Raw REST against security-definer functions. RLS is on with no policies,
   so the anon key can only reach data through these. Analytics must never
   break the page: every call swallows its own failure and resolves null. */

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

/* ---------------------------------------------------------------- votes */
/* An upvote is one row per (player, item). The server owns the count; the
   local mirror only decides whether YOUR arrow is filled, so the button
   responds instantly and a failed request cannot leave it lying.
   `voteReady` stays false until a call actually comes back, which is how the
   whole feature stays invisible until the SQL is pasted. */

let voteCounts = Object.create(null);
let voteReady = false;

export function votedSet() { return obj(read(VOTED_KEY, {})); }
export function hasVoted(k) { return !!votedSet()[k]; }
export function voteCount(k) { return Number(voteCounts[k]) || 0; }
export function votesLive() { return voteReady; }

/* One request for a screenful of keys, not one per card. */
export function loadVotes(keys) {
  const want = [...new Set(arr(keys).filter(Boolean))].slice(0, 300);
  if (!want.length) return Promise.resolve(false);
  return rpc('ad_counts', { p_keys: want }).then((rows) => {
    if (!Array.isArray(rows)) return false;
    voteReady = true;
    rows.forEach((r) => { if (r && r.k) voteCounts[r.k] = Number(r.n) || 0; });
    return true;
  });
}

export function toggleVote(item) {
  const mine = votedSet();
  const on = !mine[item.k];
  if (on) mine[item.k] = 1; else delete mine[item.k];
  write(VOTED_KEY, mine);
  voteCounts[item.k] = Math.max(0, voteCount(item.k) + (on ? 1 : -1));
  rpc(on ? 'ad_vote' : 'ad_unvote', {
    p_player: playerId(),
    p_key: item.k,
    p_kind: item.kind || 'wire',
    p_title: (item.title || '').slice(0, 300),
    p_from: (item.from || '').slice(0, 120),
    p_href: (item.href || '').slice(0, 600),
  }).then((n) => {
    /* the server is the authority — adopt its number when it answers */
    if (typeof n === 'number') { voteCounts[item.k] = n; voteReady = true; return; }
    /* the call failed (offline, RLS, outage): undo the optimistic write so a
       vote that never landed doesn't survive reloads forever — but only if
       the flag still reads the way this toggle left it */
    const cur = votedSet();
    if (on ? cur[item.k] : !cur[item.k]) {
      if (on) delete cur[item.k]; else cur[item.k] = 1;
      write(VOTED_KEY, cur);
      voteCounts[item.k] = Math.max(0, voteCount(item.k) + (on ? -1 : 1));
    }
  });
  return on;
}

/* The Popular view: whatever readers actually upvoted, newest window first. */
export function topVoted(limit) {
  return rpc('ad_top', { p_limit: limit || 60 }).then((rows) => {
    if (!Array.isArray(rows)) return null;
    voteReady = true;
    rows.forEach((r) => { if (r && r.k) voteCounts[r.k] = Number(r.n) || 0; });
    return rows;
  });
}
