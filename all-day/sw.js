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

const VERSION = 'all-day-v7';
const SHELL = VERSION + '-shell';
const DATA = 'all-day-data';   // unversioned on purpose: survives shell bumps

const SHELL_URLS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/main.js', './js/app.js', './js/store.js', './js/wire.js', './js/ui.js',
  './js/rows.js', './js/gestures.js',
  './js/modes/wire.js', './js/modes/reddit.js', './js/modes/watch.js',
  './js/modes/listen.js', './js/modes/wander.js',
  './data/wander-pool.json',
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
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('./index.html', copy)).catch(() => {});
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
