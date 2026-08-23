/* Btown Out Loud — service worker (scope: /out-loud/).
   Everything the app needs offline lives inside this scope on purpose:
   stories.json, vendor/style.css, app.js, engine.js, audio/. The SW cannot
   respond for /css, /js or /data at the site root, so those are loaded live
   and simply absent offline (the vendored stylesheet covers the look).
   Strategy: navigations + code/data = network-first, cache fallback;
   audio = cache-first (Range requests handled for Safari's media loader).
   Map tiles are NEVER cached — OSM's tile policy forbids it. */
const VERSION = 'out-loud-v2';
const SHELL = `${VERSION}-shell`;
const AUDIO = 'out-loud-audio';      // unversioned: survives shell bumps
const SHELL_URLS = ['./', './index.html', './app.js', './engine.js', './out-loud.css', './vendor/style.css', './stories.json', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return;           // tiles, unpkg, fonts: never touched
  if (!url.pathname.includes('/out-loud/')) return;           // out of scope anyway

  // Installed-app launches arrive as /out-loud/?source=pwa — serve the shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { caches.open(SHELL).then((c) => c.put('./index.html', res.clone())); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }

  if (/\/out-loud\/audio\/.+\.(mp3|m4a|ogg)$/.test(url.pathname)) {
    e.respondWith(serveAudio(req));
    return;
  }

  // Code, styles, data: network-first so deploys land immediately; cache fallback offline.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});

async function serveAudio(req) {
  const cache = await caches.open(AUDIO);
  const range = req.headers.get('range');
  const key = new Request(req.url);                            // cache by URL, ignore Range
  let full = await cache.match(key);
  if (!full) {
    const net = await fetch(key);                              // fetch the whole file once
    if (net.ok && net.status === 200) { await cache.put(key, net.clone()); full = net; }
    else return fetch(req);                                    // pass through anything odd
  }
  if (!range) return full;
  // Safari asks for bytes=N- ; answer with a real 206 built from the cached body.
  const buf = await full.clone().arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const size = buf.byteLength;
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': full.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
