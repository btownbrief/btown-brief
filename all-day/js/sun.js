/* sun.js — one shared answer to "how good is tonight's sunset, 0-10?".

   photos.js drew this dial first; What Now needs the same number so its
   sunset suggestion can step aside on a gray-wall night (the engine's
   sunsetScore gate, dead until 9/2 because no caller ever filled it). One
   module so the score, its inputs and its caching cannot drift apart.

   The heavy lifting stays in the site-wide js/sunset-score.js — the parity
   contract with weather.html — loaded as a plain script (it is not a module).
   The src is resolved against the PAGE (/all-day/), not this file. */

const SCORE_LIB = '../js/sunset-score.js';
const FRESH_MS = 30 * 60 * 1000;   // a forecast-shaped number; re-ask gently

let libPromise = null;
let cached = null;
let cachedAt = 0;

function lib() {
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCORE_LIB;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('could not load ' + SCORE_LIB));
    document.head.appendChild(s);
  });
  return libPromise;
}

/* Resolves { score, degraded, sunsetMs, isTonight } or null — never rejects.
   `data` is the wire module (peek/load/fetchJSON). */
export function sunScore(data) {
  if (cached && Date.now() - cachedAt < FRESH_MS) return cached;
  cachedAt = Date.now();
  cached = new Promise((res) => {
    const weather = data.peek('weather');
    const withWeather = weather ? Promise.resolve(weather)
      : new Promise((r) => data.load('weather', r, () => r(null)));

    Promise.all([lib(), withWeather])
      .then(([, latest]) => {
        const S = window.BtownSunsetScore;
        if (!S || !latest) return null;
        return Promise.all([
          data.fetchJSON(S.OPEN_METEO_URL, 12000).catch(() => null),
          data.fetchJSON(S.AIR_URL, 12000).catch(() => null),
        ]).then(([om, aq]) => {
          if (!om) return null;
          /* selectTarget reads the NWS payload's sun block and takes "now" —
             it decides whether tonight's sunset has passed and we should be
             talking about tomorrow's. */
          const t = S.selectTarget(latest, Date.now());
          if (!t || !t.sunsetMs) return null;
          const r = S.computeScore(t.sunsetMs, om, latest, null, aq);
          return { score: r.score, degraded: r.degraded,
                   sunsetMs: t.sunsetMs, isTonight: t.isTonight };
        });
      })
      .then((sun) => res(sun || null))
      .catch(() => res(null));
  });
  return cached;
}
