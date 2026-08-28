/* wire.js — the one place this app fetches anything.

   Three of the five modes (Read, Reddit, Listen) all live off a single file:
   data/pulse.json on the pulse-data branch, ~894 KB raw and ~262 KB over the
   wire. Today pulse.html and listen.html each download that separately. Here
   they share one request, because every caller asking for the same key while
   a fetch is in flight gets the same promise back.

   Everything is memory-cached with a per-source TTL. Nothing large goes into
   localStorage or sessionStorage — serialising a 900 KB payload synchronously
   would block the main thread and double the memory for no gain. The service
   worker handles cold starts instead.

   Data branches are orphan branches force-pushed by the refresh workflows and
   served from raw.githubusercontent.com, which is CORS-open with a ~5 minute
   edge cache. Each has a first-paint fallback committed on main that may be
   up to a day stale. */

const RAW = 'https://raw.githubusercontent.com/btownbrief/btown-brief/';

export const SOURCES = {
  pulse: {
    live: RAW + 'pulse-data/data/pulse.json',
    fallback: '/data/pulse.json',
    ttl: 5 * 60 * 1000,
  },
  pulseMeta: {
    live: RAW + 'pulse-data/data/pulse-meta.json',
    ttl: 60 * 1000,
  },
  top: {
    live: RAW + 'pulse-top/data/pulse-top.json',
    ttl: 10 * 60 * 1000,
  },
  youtube: {
    live: RAW + 'pulse-youtube/data/pulse-youtube.json',
    ttl: 10 * 60 * 1000,
  },
  tv: {
    // tv.html reads the branch; listen.html reads main's copy, which has been
    // frozen since 2026-08-23. One source of truth, branch first.
    live: RAW + 'btown-tv/data/btown-tv.json',
    fallback: '/data/btown-tv.json',
    ttl: 30 * 60 * 1000,
  },
  tvEditions: {
    live: RAW + 'btown-tv/data/tv-editions.json',
    ttl: 6 * 60 * 60 * 1000,
  },
  weather: { live: '/data/weather/latest.json', ttl: 10 * 60 * 1000 },
  wanderPool: { live: 'data/wander-pool.json', ttl: 12 * 60 * 60 * 1000 },
};

const mem = new Map();      // key -> { at, data, stale }
const inflight = new Map(); // key -> promise

/* Note there is deliberately no "prefer the local copy on localhost" flip.
   pulse.html has one, and it means local development quietly reads a
   different file from production — which is exactly how listen.html ended up
   shipping a five-day-old BTown TV edition without anyone noticing. Live
   first, everywhere, so what you test is what people get. */

function fetchJSON(url, timeoutMs = 15000, noCache = false) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const opts = { signal: ctl.signal };
  if (noCache) opts.cache = 'no-cache';
  return fetch(url, opts)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    })
    .finally(() => clearTimeout(timer));
}

/* get(key) resolves to { data, stale, at }. `stale` means the live branch
   could not be reached and this is main's committed fallback. */
export function get(key, opts = {}) {
  const src = SOURCES[key];
  if (!src) return Promise.reject(new Error('unknown source: ' + key));

  const force = !!opts.force;
  const hit = mem.get(key);
  if (!force && hit && Date.now() - hit.at < src.ttl) return Promise.resolve(hit);
  if (!force && inflight.has(key)) return inflight.get(key);

  const p = fetchJSON(src.live, opts.timeout, force)
    .then((data) => ({ data, stale: false, at: Date.now() }))
    .catch((err) => {
      if (!src.fallback) throw err;
      return fetchJSON(src.fallback, opts.timeout, force).then((data) => ({
        data,
        stale: true,
        at: Date.now(),
      }));
    })
    .then((res) => {
      mem.set(key, res);
      inflight.delete(key);
      return res;
    })
    .catch((err) => {
      inflight.delete(key);
      // A previous good copy beats an error screen.
      if (hit) return hit;
      throw err;
    });

  inflight.set(key, p);
  return p;
}

/* What we already have, without touching the network. */
export function peek(key) {
  return mem.get(key) || null;
}

/* Ad-hoc JSON with the same in-flight de-duplication, for the Wikipedia API
   where the URL itself is the key. Small responses only. */
const adhoc = new Map();
const adhocInflight = new Map();

export function getURL(url, ttl = 10 * 60 * 1000) {
  const hit = adhoc.get(url);
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
  if (adhocInflight.has(url)) return adhocInflight.get(url);

  const p = fetchJSON(url, 12000)
    .then((data) => {
      adhoc.set(url, { data, at: Date.now() });
      adhocInflight.delete(url);
      // Keep the ad-hoc cache from growing without bound over a long session.
      if (adhoc.size > 400) {
        const oldest = [...adhoc.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 120);
        oldest.forEach(([k]) => adhoc.delete(k));
      }
      return data;
    })
    .catch((err) => {
      adhocInflight.delete(url);
      throw err;
    });

  adhocInflight.set(url, p);
  return p;
}
