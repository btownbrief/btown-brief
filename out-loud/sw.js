/* Btown Out Loud — service worker.
   Shell: cache-first (updated in the background). Data JSON: network-first.
   Story audio: cache-first, populated on demand by "Save stories for offline"
   (the page uses the Cache API directly) or by the first play.
   Map tiles are deliberately NEVER cached — OSM's tile policy forbids it. */
const VERSION = 'out-loud-v1';
const SHELL = `${VERSION}-shell`;
const AUDIO = 'out-loud-audio';      // unversioned: survives shell bumps
const SHELL_URLS = [
  './', './index.html', './app.js', './engine.js', './out-loud.css', './manifest.webmanifest',
  '../css/style.css', '../js/community.js', '../js/auto-theme.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS).catch(() => null)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('out-loud-v') && k !== SHELL).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch tiles or third-party scripts/fonts.
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/data/out-loud.json')) {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req)));
    return;
  }

  if (/\/out-loud\/audio\/.+\.(mp3|m4a|ogg)$/.test(url.pathname)) {
    e.respondWith(caches.open(AUDIO).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.pathname.includes('/out-loud/') || url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/')) {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    }));
  }
});
