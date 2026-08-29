/* whatnow-data.js — the feeds the What Now engine eats.

   Adapted from the standalone app's js/data.js, with one change that matters:
   it reads SAME-ORIGIN. All Day is served from guide.btownbrief.com, which is
   where those feeds live, so there is no CORS round trip and a branch preview
   reads that branch's own data instead of production's.

   Two of the seven are already in the app's shared wire, so they are taken
   from there rather than fetched twice: the weather payload every tab uses,
   and the trimmed ten-day events slice the tab renders underneath the answer.

   Everything is fetched only when the tab first opens. things.json alone is
   236 KB and no reader who never taps What Now should pay for it.

   Every request has a hard timeout, because one stalled feed must not hold
   the tab at "reading the sky". Each feed reports what it actually is, so the
   footer can say "live" only when it earned it. */

import * as wire from './wire.js';

const BASE = '../data/';
const CACHE_PREFIX = 'ad_wn_';
const CACHE_TTL_MS = 10 * 60 * 1000;
const STALE_MAX_MS = 24 * 3600 * 1000;
const TIMEOUT_MS = 8000;

/* weather and events come from the shared wire; the rest are this tab's. */
const ENDPOINTS = {
  beaches: 'weather/beaches.json',
  things: 'things.json',
  clubs: 'clubs.json',
  sunsetSpots: 'sunset-spots.json',
  hobbies: 'hobbies.json',
};

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function cacheSet(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch (e) { /* private mode or full — we just refetch next time */ }
}

function one(key, path) {
  const hit = cacheGet(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < CACHE_TTL_MS) {
    return Promise.resolve({ key, data: hit.data, state: 'cache', ageMin: Math.round(age / 60000) });
  }
  return wire.fetchJSON(BASE + path, TIMEOUT_MS)
    .then((data) => {
      cacheSet(key, data);
      return { key, data, state: 'live', ageMin: 0 };
    })
    .catch(() => {
      /* stale beats nothing, but not forever, and it says so */
      if (hit && age < STALE_MAX_MS) {
        return { key, data: hit.data, state: 'stale', ageMin: Math.round(age / 60000) };
      }
      return { key, data: null, state: 'absent', ageMin: null };
    });
}

/* Resolves { data, status }. Any feed may be null — the engine fails closed
   on whatever is missing rather than guessing. */
export function loadAll() {
  const own = Object.entries(ENDPOINTS).map(([k, path]) => one(k, path));

  const shared = (key) => new Promise((res) => {
    const cached = wire.peek(key);
    if (cached) { res({ key, data: cached, state: 'live', ageMin: 0 }); return; }
    wire.load(key,
      (json) => res({ key, data: json, state: 'live', ageMin: 0 }),
      () => res({ key, data: null, state: 'absent', ageMin: null }));
  });

  return Promise.all(own.concat([shared('weather'), shared('whatnow')]))
    .then((rows) => {
      const data = {};
      const status = {};
      rows.forEach((r) => {
        /* the engine calls the events feed `events`; the wire calls the
           trimmed slice `whatnow` */
        const name = r.key === 'whatnow' ? 'events' : r.key;
        data[name] = r.data;
        status[name] = { state: r.state, ageMin: r.ageMin };
      });
      /* Do NOT unwrap: the engine reads data.events.events, so it wants the
         whole payload object, exactly like the events.json it was written
         against. build_whatnow.py emits that same {events:[...]} shape. */
      return { data, status };
    });
}
