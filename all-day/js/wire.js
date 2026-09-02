/* wire.js — one fetch per payload, shared by every tab.

   Ported from js/pulse.js's loadData/retryLive/checkFresh, which is the
   behaviour the site already has and readers already expect:

   - production: the live data branch first, the same-origin snapshot as
     fallback. That snapshot is only as fresh as main's daily sync, so
     falling back to it marks the app STALE, says so, and keeps retrying the
     live branch on a [8s, 20s, 60s] backoff.
   - local dev: same-origin first, so the app works with no network.
   - pulse-top and pulse-youtube have no same-origin copy. They fail soft:
     the strip they feed simply is not rendered.
   - the wander pool is committed to the repo, so it is same-origin only and
     always present — no branch to miss.

   Every ten minutes a poll re-checks. It never re-renders underneath
   someone: the swap goes through freshGate(), which the shell answers with
   either "apply now" (barely scrolled) or a "fresh" pill.

   A payload that arrives malformed is treated as a failure, not as data.
   Without that check a truncated file reaches a tab's renderer, throws
   inside the subscriber loop, and leaves the tab on "Loading…" forever. */

const LIVE = 'https://raw.githubusercontent.com/btownbrief/btown-brief/';

const FILES = {
  pulse: {
    live: LIVE + 'pulse-data/data/pulse.json',
    local: '../data/pulse.json',
    poll: true,
    ok: (j) => j && Array.isArray(j.sources) && Array.isArray(j.items),
  },
  top: {
    live: LIVE + 'pulse-top/data/pulse-top.json',
    local: null,
    poll: true,
    ok: (j) => j && Array.isArray(j.picks),
  },
  tv: {
    live: LIVE + 'btown-tv/data/btown-tv.json',
    local: '../data/btown-tv.json',
    poll: true,
    ok: (j) => j && (j.pick || Array.isArray(j.shelves)),
  },
  youtube: {
    live: LIVE + 'pulse-youtube/data/pulse-youtube.json',
    local: null,
    ok: (j) => j && Array.isArray(j.videos),
  },
  pool: {
    live: null,
    local: 'data/wander-pool.json',
    ok: (j) => j && j.pools && typeof j.pools === 'object',
  },
  /* The Brief's own stories, pulled out of the newsletter. Same-origin: the
     file is committed to main by its workflow and main is what Pages serves. */
  newsletter: {
    live: null,
    local: '../data/newsletter-picks.json',
    ok: (j) => j && Array.isArray(j.editions),
  },
  /* Weather is committed to main by its own workflow, and main is what Pages
     serves — so same-origin is already the freshest copy there is. No poll:
     the poller only re-fetches `live`, and a temperature is fine until the
     next page load. */
  /* Both of these are committed to main by their own workflow and live
     inside /all-day/, so the service worker can cache them. Instagram is the
     one payload with a shelf life: its image URLs are signed about three days
     out, which is why its workflow runs daily rather than weekly. */
  /* The Brief's own episode list. Spotify's show embed only ever plays the
     newest one, so the archive has to come from a file. */
  podcast: {
    live: null,
    local: 'data/podcast.json',
    ok: (j) => j && Array.isArray(j.episodes),
  },
  /* Who is winning at the arcade. Published every six hours by the arcade's
     own champions workflow, and it is the ONLY cheap way to get an
     arcade-wide answer: `scores` is not readable by anon and
     get_leaderboard() is one call per board, so computing this in the client
     would be 32 requests. Lives in the btownbrief.github.io repo, hence the
     full URL rather than LIVE + a path. No same-origin copy, so it fails
     soft the way `top` and `youtube` do: no payload, no card. */
  champions: {
    live: 'https://raw.githubusercontent.com/btownbrief/btownbrief.github.io/' +
      'champions-data/data/champions.json',
    local: null,
    ok: (j) => j && Array.isArray(j.royalty) && Array.isArray(j.games),
  },
  /* Just the games. What Now shows the next couple of days and hands off to
     sports.html for the rest — a schedule is something you act on, so it lives
     with the calendar rather than in a tab you scroll. */
  sports: {
    live: null,
    local: '../data/sports.json',
    ok: (j) => j && Array.isArray(j.games),
  },
  whatnow: {
    live: null,
    local: 'data/whatnow.json',
    ok: (j) => j && Array.isArray(j.events),
  },
  instagram: {
    live: null,
    local: 'data/instagram.json',
    ok: (j) => j && Array.isArray(j.posts),
  },
  /* Music is committed to main by its own workflow and lives inside
     /all-day/, so the service worker can cache it — same reasoning as the
     wander pool. No poll: the roster changes once a morning. */
  music: {
    live: null,
    local: 'data/music.json',
    ok: (j) => j && Array.isArray(j.artists),
  },
  weather: {
    live: null,
    local: '../data/weather/latest.json',
    ok: (j) => j && typeof j === 'object' && (j.now || j.lake_gage || j.sun),
  },
};

const STALE_RETRIES = [8000, 20000, 60000];
const POLL_MS = 600000;
const DEAD_FOR = 120000;   // a startup blip must not disable a feed for the session

const cache = Object.create(null);
const subs = Object.create(null);
const fails = Object.create(null);
const inflight = Object.create(null);
const dead = Object.create(null);
const stale = Object.create(null);

let gate = (apply) => apply();
let onStaleChange = () => {};

export function setFreshGate(fn) { gate = fn; }
export function setStaleHandler(fn) { onStaleChange = fn; }

export function isLocalDev() {
  const h = location.hostname;
  /* 127.x is a prefix, not a whole hostname — anchoring the alternation
     would quietly send 127.0.0.1 down the production path */
  return location.protocol === 'file:' ||
    /^(localhost|0\.0\.0\.0|\[?::1\]?)$/.test(h) || /^127\./.test(h);
}

function request(url, timeoutMs, asText) {
  const ctl = 'AbortController' in window ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), timeoutMs || 8000);
  return fetch(url, ctl ? { signal: ctl.signal } : {})
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return asText ? res.text() : res.json();
    })
    .finally(() => { if (timer) clearTimeout(timer); });
}

export const fetchJSON = (url, ms) => request(url, ms, false);
export const fetchText = (url, ms) => request(url, ms, true);

const anyStale = () => Object.keys(stale).some((k) => stale[k]);

function emit(key, json) {
  (subs[key] || []).forEach((cb) => {
    try {
      cb(json);
    } catch (e) {
      /* One tab's bug is not another's — but swallowing it silently means a
         renderer that throws leaves a blank panel and no clue anywhere. */
      console.error('[all-day] ' + key + ' subscriber threw', e);
    }
  });
}

function settle(key, json, isStale) {
  delete dead[key];
  cache[key] = json;
  stale[key] = !!isStale;
  delete inflight[key];
  emit(key, json);
  onStaleChange(anyStale());
  if (isStale) setTimeout(() => retryLive(key, 0), STALE_RETRIES[0]);
}

function bust(key) {
  dead[key] = Date.now();
  delete inflight[key];
  (fails[key] || []).forEach((cb) => { try { cb(); } catch (e) { /* ignore */ } });
}

const isDead = (key) => dead[key] && Date.now() - dead[key] < DEAD_FOR;

/* A live payload arriving after first render must not yank the page out from
   under a reader — the shell decides when it lands. */
function offerFresh(key, json) {
  const spec = FILES[key];
  if (!spec.ok(json)) return;
  /* two payloads with no `generated` stamp would compare undefined ===
     undefined and read as identical forever — fall back to content */
  const same = (json.generated != null || (cache[key] && cache[key].generated != null))
    ? cache[key] && json.generated === cache[key].generated
    : cache[key] && JSON.stringify(json) === JSON.stringify(cache[key]);
  if (!cache[key] || same) {
    if (stale[key]) { stale[key] = false; onStaleChange(anyStale()); }
    return;
  }
  gate(() => {
    cache[key] = json;
    stale[key] = false;
    onStaleChange(anyStale());
    emit(key, json);
  });
}

function retryLive(key, attempt) {
  const spec = FILES[key];
  if (!spec || !spec.live || !stale[key]) return;
  fetchJSON(spec.live, 8000)
    .then((json) => { if (stale[key]) offerFresh(key, json); })
    .catch(() => {
      const next = attempt + 1;
      if (next < STALE_RETRIES.length) setTimeout(() => retryLive(key, next), STALE_RETRIES[next]);
    });
}

function start(key) {
  const spec = FILES[key];
  const local = isLocalDev();
  const preferLocal = local || !spec.live;
  const first = preferLocal && spec.local ? spec.local : spec.live;
  const second = preferLocal ? (spec.local ? spec.live : null) : spec.local;
  inflight[key] = true;

  const take = (json, isStale) => {
    if (!spec.ok(json)) throw new Error('bad shape');
    settle(key, json, isStale);
  };

  fetchJSON(first, 8000)
    .then((json) => take(json, false))
    .catch(() => {
      if (!second) { bust(key); return; }
      /* stale means production had to fall back to main's snapshot;
         local dev reading its own snapshot is just… local dev */
      fetchJSON(second, 8000).then((json) => take(json, !local)).catch(() => bust(key));
    });
}

/* onOk may fire more than once — on load, and again when a fresh payload is
   accepted. Every tab must be able to re-render from it. */
export function load(key, onOk, onFail) {
  const spec = FILES[key];
  if (!spec) { if (onFail) onFail(); return; }
  if (onOk) (subs[key] = subs[key] || []).push(onOk);
  if (onFail) (fails[key] = fails[key] || []).push(onFail);
  if (cache[key]) { if (onOk) onOk(cache[key]); return; }
  if (isDead(key)) { if (onFail) onFail(); return; }
  if (!inflight[key]) start(key);
}

export const peek = (key) => cache[key] || null;

setInterval(() => {
  if (document.hidden || isLocalDev()) return;
  Object.keys(FILES).forEach((key) => {
    const spec = FILES[key];
    if (cache[key]) {
      if (!spec.poll || !spec.live) return;
      fetchJSON(spec.live, 8000).then((json) => offerFresh(key, json)).catch(() => {});
    } else if (dead[key] && !inflight[key] && (subs[key] || []).length) {
      /* nobody ever got this payload — try again for the tabs waiting on it */
      delete dead[key];
      start(key);
    }
  });
}, POLL_MS);
