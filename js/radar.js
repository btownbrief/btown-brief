/* ============================================================
   BTOWN BRIEF — radar.js
   weather.html's Radar: the last two hours of rain and snow
   around Burlington, moving, on a map.

   The frames are NOAA's MRMS base reflectivity (the national
   radar mosaic radar.weather.gov draws), from the National Weather
   Service's own map server. It is public-domain data with no use
   limits. RainViewer's free tiles were the other choice; since
   January 2026 they are for personal and educational use only,
   capped at zoom 7, and have no nowcast any more, so they buy
   nothing NOAA does not give us freely.

   Cost: nothing loads until the section is about to scroll into
   view. Then Leaflet (the same pinned unpkg copy, integrity
   hashes and OpenStreetMap tiles events.html uses), one small
   GetCapabilities read for the list of frame times, and one image
   per frame for the whole map (13 of them, ten minutes apart), not
   a tile grid per frame. A pan or zoom asks for the frames again
   at the new view, once the map stops moving.

   The loop plays by default, holds on the newest frame, pauses
   while the page is hidden or the map is off screen, and starts
   paused on the newest frame for readers who ask for reduced
   motion. Scrubbing pauses it.

   Test hooks: window.btownRadar exposes the frame list and the
   current index once mounted.
============================================================ */

(function () {
  'use strict';

  var CENTER = [44.4759, -73.2121];
  var ZOOM = 7;
  var LEAFLET = {
    js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', jsSri: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
    css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', cssSri: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
  };
  var TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  var WMS = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
  var LAYER = 'conus_bref_qcd';
  var RADAR_CREDIT = 'Radar: <a href="https://www.nssl.noaa.gov/projects/mrms/" target="_blank" rel="noopener">NOAA MRMS</a>';
  var FRAMES = 13;               // two hours, ten minutes apart, the newest last
  var STEP_MIN = 10;
  var FRAME_MS = 550;            // one frame on screen
  var HOLD_MS = 1800;            // the newest frame, before the loop starts over
  var OPACITY = 0.78;
  var MAX_PX = 2048;             // the largest frame image asked for, per side

  var root, mapEl, controls, playBtn, scrub, timeEl, stamp, failEl;
  var map = null, frames = [], overlays = [], idx = 0, playing = false, timer = null;
  var onScreen = false, started = false, rebuildT = null;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clockFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  function clock(ms) { return clockFmt.format(new Date(ms)).replace(' AM', ' am').replace(' PM', ' pm'); }

  /* ---------------- Leaflet, on demand ---------------- */
  var leafletP = null;
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (!leafletP) {
      if (!document.querySelector('link[data-leaflet]')) {
        var css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = LEAFLET.css; css.integrity = LEAFLET.cssSri; css.crossOrigin = '';
        css.setAttribute('data-leaflet', '1');
        document.head.appendChild(css);
      }
      leafletP = new Promise(function (resolve, reject) {
        var js = document.createElement('script');
        js.src = LEAFLET.js; js.integrity = LEAFLET.jsSri; js.crossOrigin = '';
        js.onload = function () { return window.L && window.L.map ? resolve(window.L) : reject(new Error('no Leaflet')); };
        js.onerror = function () { leafletP = null; js.remove(); reject(new Error('no Leaflet')); };
        document.head.appendChild(js);
      });
    }
    return leafletP;
  }

  /* ---------------- the frame times ----------------
     GetCapabilities lists every scan of the last two hours (about
     every two minutes). Thirteen are picked, ten minutes apart,
     counting back from the newest. */
  function readTimes(xml) {
    var m = /<Dimension[^>]*name="time"[^>]*>([^<]+)<\/Dimension>/.exec(xml) ||
            /<Extent[^>]*name="time"[^>]*>([^<]+)<\/Extent>/.exec(xml);
    if (!m) return [];
    return m[1].split(',').map(function (s) { return s.trim(); })
      .filter(function (s) { return /^\d{4}-\d{2}-\d{2}T/.test(s) && Date.parse(s); })
      .sort(function (a, b) { return Date.parse(a) - Date.parse(b); });
  }

  function pickFrames(times) {
    if (!times.length) return [];
    var ms = times.map(Date.parse);
    var newest = ms[ms.length - 1];
    var out = [];
    for (var k = FRAMES - 1; k >= 0; k--) {
      var want = newest - k * STEP_MIN * 60000;
      var best = -1, gap = Infinity;
      for (var i = 0; i < ms.length; i++) {
        var g = Math.abs(ms[i] - want);
        if (g < gap) { gap = g; best = i; }
      }
      /* a gap in the feed bigger than half a step leaves that slot out */
      if (best < 0 || gap > STEP_MIN * 30000) continue;
      if (out.length && out[out.length - 1].iso === times[best]) continue;
      out.push({ iso: times[best], ms: ms[best] });
    }
    return out;
  }

  /* ---------------- the frames on the map ---------------- */
  function frameUrl(iso, b, size) {
    var crs = window.L.CRS.EPSG3857;
    var sw = crs.project(b.getSouthWest()), ne = crs.project(b.getNorthEast());
    return WMS + '?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=' + LAYER + '&STYLES=' +
      '&FORMAT=image%2Fpng&TRANSPARENT=true&SRS=EPSG%3A3857' +
      '&WIDTH=' + size.w + '&HEIGHT=' + size.h +
      '&BBOX=' + [sw.x, sw.y, ne.x, ne.y].map(function (v) { return v.toFixed(0); }).join(',') +
      '&TIME=' + encodeURIComponent(iso);
  }

  function frameSize() {
    var s = map.getSize();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var scale = Math.min(dpr, MAX_PX / Math.max(s.x, s.y, 1));
    return { w: Math.max(1, Math.round(s.x * scale)), h: Math.max(1, Math.round(s.y * scale)) };
  }

  function buildOverlays() {
    if (!map || !frames.length) return;
    var b = map.getBounds(), size = frameSize();
    var old = overlays;
    overlays = frames.map(function (f, i) {
      var o = window.L.imageOverlay(frameUrl(f.iso, b, size), b, {
        opacity: i === idx ? OPACITY : 0, interactive: false,
        className: 'radar-frame', attribution: i === 0 ? RADAR_CREDIT : undefined
      });
      return o.addTo(map);
    });
    old.forEach(function (o) { map.removeLayer(o); });
  }

  function show(i) {
    if (!frames.length) return;
    idx = (i + frames.length) % frames.length;
    overlays.forEach(function (o, k) { o.setOpacity(k === idx ? OPACITY : 0); });
    var f = frames[idx];
    var ago = Math.round((Date.now() - f.ms) / 60000);
    timeEl.textContent = clock(f.ms);
    scrub.value = String(idx);
    scrub.setAttribute('aria-valuetext', clock(f.ms));
    stamp.textContent = idx === frames.length - 1
      ? (ago <= 1 ? 'Latest, just now' : 'Latest, ' + ago + ' min ago')
      : ago + ' min ago';
    root.setAttribute('data-frame', String(idx));
  }

  /* ---------------- the loop ---------------- */
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!playing || !onScreen || document.hidden) return;
    timer = setTimeout(function () { show(idx + 1); schedule(); }, idx === frames.length - 1 ? HOLD_MS : FRAME_MS);
  }

  function setPlaying(on) {
    playing = !!on && frames.length > 1;
    playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    root.classList.toggle('is-playing', playing);
    schedule();
  }

  /* ---------------- mount ---------------- */
  function fail() {
    root.classList.add('is-failed');
    if (mapEl) mapEl.hidden = true;
    controls.hidden = true;
    failEl.hidden = false;
  }

  function start() {
    if (started) return;
    started = true;
    root.classList.add('is-loading');
    var timesP = fetch(WMS + '?service=WMS&version=1.3.0&request=GetCapabilities', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
    Promise.all([loadLeaflet(), timesP]).then(function (got) {
      var L = got[0];
      frames = pickFrames(readTimes(got[1]));
      if (!frames.length) throw new Error('no frames');
      idx = frames.length - 1;
      map = L.map(mapEl, {
        center: CENTER, zoom: ZOOM, minZoom: 5, maxZoom: 11,
        scrollWheelZoom: false,
        /* one finger scrolls the page on a phone; the buttons zoom */
        dragging: !(L.Browser && L.Browser.mobile),
        attributionControl: true
      });
      L.tileLayer(TILES, { maxZoom: 19, attribution: TILE_CREDIT }).addTo(map);
      L.circleMarker(CENTER, { radius: 5, weight: 2, color: '#16191D', fillColor: '#ffffff', fillOpacity: 1, className: 'radar-home' }).addTo(map);
      buildOverlays();
      map.on('moveend', function () {
        clearTimeout(rebuildT);
        rebuildT = setTimeout(buildOverlays, 250);
      });
      scrub.max = String(frames.length - 1);
      controls.hidden = false;
      root.classList.remove('is-loading');
      show(idx);
      setPlaying(!reduced);
      window.btownRadar = {
        frames: frames.map(function (f) { return f.iso; }),
        index: function () { return idx; },
        playing: function () { return playing; },
        map: map
      };
    }).catch(fail);
  }

  function init() {
    root = document.getElementById('radar');
    if (!root) return;
    mapEl = document.getElementById('radar-map');
    controls = document.getElementById('radar-controls');
    playBtn = document.getElementById('radar-play');
    scrub = document.getElementById('radar-scrub');
    timeEl = document.getElementById('radar-time');
    stamp = document.getElementById('radar-stamp');
    failEl = document.getElementById('radar-fail');

    playBtn.addEventListener('click', function () {
      if (!playing && idx === frames.length - 1) show(0);
      setPlaying(!playing);
    });
    scrub.addEventListener('input', function () {
      setPlaying(false);
      show(parseInt(scrub.value, 10) || 0);
    });
    document.addEventListener('visibilitychange', schedule);

    /* nothing loads until the radar is about to come into view */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          onScreen = e.isIntersecting;
          if (onScreen) start();
          schedule();
        });
      }, { rootMargin: '300px 0px' }).observe(root);
    } else {
      onScreen = true;
      start();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
