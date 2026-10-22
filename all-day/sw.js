/* sw.js — offline shell for /all-day/, and nothing else.

   The scope is the directory, so this worker can never answer for the rest of
   guide.btownbrief.com. That is a hard limit rather than a preference: a
   worker registered at /all-day/sw.js is not allowed to intercept /css/ or
   /data/ at the site root, which is why this app carries its own stylesheet
   instead of riding css/hub.css.

   Posture: code and markup are network-first so a deploy lands immediately
   and the cache is only a fallback; the wire payloads are network-first with
   a cached copy behind them so opening the app on a bad connection still
   shows the last thing you saw rather than an error. Nothing here caches
   audio — episodes are large and the browser's own HTTP cache handles them
   better than we would. */

const VERSION = 'all-day-v97';   // the shell: Full page links, the two asks, bigger pills
const SHELL = VERSION + '-shell';
const DATA = 'all-day-data';   // unversioned on purpose: survives shell bumps

const SHELL_URLS = [
  './', './index.html', './manifest.webmanifest', './css/tokens.css', './css/app.css',
  './js/main.js', './js/app.js', './js/store.js', './js/wire.js', './js/ui.js',
  './js/liquid.js', './js/sections.js', './js/gestures.js', './js/auth.js', './js/asks.js',
  './js/modes/wire.js', './js/modes/wire-demo.js', './js/modes/wire-photos.js', './js/modes/wire-square.js', './js/modes/wire-recaps.js', './js/modes/watch.js', './js/modes/food.js',
  './js/modes/people.js', './js/modes/whatnow.js', './js/modes/vintage.js', './js/modes/habits.js',
  './js/modes/onair.js', './js/modes/onair-sports.js', './js/modes/games.js',
  /* The Build: the tab, its API (live, this phone, the demo) and the site */
  './js/modes/build.js', './js/build-core.js', './js/build-local.js', './js/build-fake.js', './js/build-site.js', './js/build-site-shared.js', './js/build-site-art.js', './js/build-site-world.js', './js/build-site-building.js', './js/build-site-crew.js', './js/build-site-director.js',
  './data/build-foreman.json', './data/build-config.json', './data/build-starters.json',
  /* What Now's engine and its feeds' loader, imported by modes/whatnow.js */
  './js/whatnow-engine.js', './js/whatnow-data.js', './js/sun.js',
  /* Habits' rules, its demo server, the signed-out phone's copy and its trees, imported by modes/habits.js */
  './js/habits-core.js', './js/habits-fake.js', './js/habits-local.js', './js/forest.js',
  /* the photo wall's helpers, imported by the Wire's Photo mode */
  './js/photo-wall.js',
  /* the run clubs' week, imported by ui.js, People and What Now */
  './js/clubs-week.js',
  /* what People's tiles mean and which events are mixers, imported by People */
  './js/people-match.js',
  /* Food's Reddit asks and Best of r/burlington shapers, imported by modes/food.js */
  './js/food-asks.js',
  /* the boards: imported by main.js, so every tab can draw one offline */
  './js/boards.js', './js/boards-core.js', './js/boards-fake.js',
  /* Watch's starter list, so the tab has films to show offline */
  './data/films-seed.json',
  /* the No-algorithm challenge, loaded by app.js after the first route */
  './js/challenge.js', './js/challenge-core.js', './css/challenge.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // One bad URL must not fail the whole install.
      .then((c) => Promise.allSettled(SHELL_URLS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isWire(url) {
  return url.hostname === 'raw.githubusercontent.com' ||
    (url.origin === self.location.origin && url.pathname.startsWith('/data/'));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  /* Sound and video are never ours to answer, from any host: the Brief's MP3
     lives on raw.githubusercontent.com, which isWire() below would otherwise
     claim, and a media element's byte-range requests must reach the network
     untouched (a 206 cannot be cached, and Safari will not play a range
     answered with the whole file). */
  if (req.destination === 'audio' || req.destination === 'video' || req.headers.has('range')) return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // The data branches: network first, last good copy behind.
  if (isWire(url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  // Everything else this worker touches is our own directory.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/all-day/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          /* only a good page becomes the offline shell; a 404 must not */
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || Response.error()))
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  );
});
