/* Currents — service worker, scope /currents/ only.

   The app shell (index.html, css, js, manifest) is inside the scope, so it
   caches. The payloads are NOT: pulse.json et al live on raw.githubusercontent
   and /data at the site root, both outside this scope, so they are always
   fetched live and simply absent offline. Wikipedia is never cached — the
   rabbit hole is an online activity by definition.

   Strategy: navigations and in-scope code = network-first with a cache
   fallback, so a deploy lands immediately and a dead connection still opens
   the app.                                                                  */
const VERSION = 'currents-v1';
const SHELL = `${VERSION}-shell`;
const SHELL_URLS = [
  './', './index.html', './manifest.webmanifest', './css/currents.css',
  './js/wire.js', './js/shell.js', './js/pulse-tab.js', './js/reddit-tab.js',
  './js/watch-tab.js', './js/listen-tab.js', './js/wander.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('currents-v') && k !== SHELL).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // wikipedia, raw.github, fonts: untouched
  if (!url.pathname.includes('/currents/')) return;      // /data and /assets stay live

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put('./index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
