/* ============================================================
   BTOWN BRIEF — radar.js
   weather.html's Radar: where the rain and snow are heading.
   Stephen, 2026-10-19: "the radar needs to be about the future,
   not the past per se ... people only care about when the rain is
   approaching."

   The timeline is mostly forecast: the last fifty minutes of real
   radar, a Now frame, then the next twelve hours, half an hour apart.

   - The radar (the past and Now) is NOAA's MRMS base reflectivity,
     the national mosaic radar.weather.gov draws, from the National
     Weather Service's own map server: public domain, no use limits,
     one image per frame for the whole view.
   - The forecast is NOAA's HRRR model (simulated radar; a new run
     every hour, fifteen-minute steps out to eighteen hours), as map
     tiles from the Iowa Environmental Mesonet at Iowa State, which
     publishes them free for any use and paints them in radar's
     colours. Each run is asked for by its own start time, the way
     IEM asks real-time users to, so a new run arriving midway never
     mixes two runs in one loop. RainViewer (personal use only since
     2026, no nowcast) and nowCOAST (no forecast radar) had nothing
     to add.

   Above the map, one plain line answers the question people bring
   to a radar: when does the rain (or snow) start and stop in the
   next twelve hours. It is written from the NWS hourly forecast in
   data/weather/latest.json with the weather brief's own bars
   (scripts/weather_brief.py), so the two agree.

   Cost: nothing loads until the section is about to scroll into
   view. Then Leaflet (the same pinned unpkg copy, integrity hashes
   and OpenStreetMap tiles events.html uses), NOAA's list of radar
   times, IEM's note of its newest forecast run, the Now image
   first and the rest behind it. The loop starts at Now and plays
   forward, holds on the last forecast frame and starts again from
   Now; the scrubber goes back into the past. It pauses while the
   page is hidden or the map is off screen, and waits paused on Now
   for readers who ask for reduced motion.

   Wethr's radar (Stephen, 2026-10-22): the same line is the page's
   headline, a chance-of-rain timeline sits under it, time chips jump
   the map (Now, +1h … +12h), and Full screen opens the map over the
   whole page with the controls on a glass sheet.

   Test hooks: window.btownRadar exposes the frame list, the Now
   index and the current index once mounted.
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
  var HRRR_RUN = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json';
  var HRRR_TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F{fmin}-{run}/{z}/{x}/{y}.png';
  var FORECAST_CREDIT = 'Forecast: <a href="https://mesonet.agron.iastate.edu/GIS/model.phtml" target="_blank" rel="noopener">NOAA HRRR via IEM</a>';
  var PAST = 6;                  // radar frames, Now included: fifty minutes, ten apart
  var STEP_MIN = 10;
  var FC_STEP_MIN = 30;          // forecast frames, half an hour apart
  var FC_HOURS = 12;             // how far ahead
  var FC_GAP_MIN = 10;           // the first forecast frame is at least this far past Now
  var HRRR_REACH_MIN = 1080;     // every HRRR run goes out eighteen hours
  var RUN_MAX_AGE_H = 12;        // an older run is not a forecast any more
  var FRAME_MS = 550;            // one frame on screen
  var NOW_MS = 1200;             // Now, a beat longer, so it registers
  var HOLD_MS = 1800;            // the last frame, before the loop starts again at Now
  var OPACITY = 0.78;
  var MAX_PX = 1600;             // the largest radar image asked for, per side
  var REFRESH_MS = 10 * 60000;   // a fresh frame list while the radar is on screen
  var SETTLE_MS = 8000;          // the loop starts by then even if a frame is slow
  var MIN = 60000, HOUR = 3600000;

  var root, mapEl, controls, playBtn, scrub, timeEl, stamp, failEl, badge, nowMark, answerEl, heroEl, jumpsEl, fullBtn, rainBox, peakEl, lineEl;
  var full = false, pushed = false;
  var map = null, frames = [], nowIdx = 0, idx = 0, playing = false, timer = null;
  var pastLayers = [], retired = [], fcLayers = {}, fcAdded = false, pastDone = false, fcLeft = 0, lastRun = null;
  var onScreen = false, started = false, rebuildT = null, gen = 0, settled = false, shown = false, lastCheck = 0;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clockFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  function clock(ms) { return clockFmt.format(new Date(ms)).replace(' AM', ' am').replace(' PM', ' pm'); }

  /* "in 40 min", "in 2 hr", "in 2½ hr" (the frames are half an hour apart) */
  function ahead(ms) {
    var m = Math.max(0, Math.round(ms / MIN));
    if (m < 60) return 'in ' + m + ' min';
    var halves = Math.round(m / 30);
    return 'in ' + Math.floor(halves / 2) + (halves % 2 ? '½' : '') + ' hr';
  }

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

  /* ---------------- the radar times ----------------
     GetCapabilities lists every scan of the last two hours (about
     every two minutes). Six are picked, ten minutes apart, counting
     back from the newest, which is Now. */
  function readTimes(xml) {
    var m = /<Dimension[^>]*name="time"[^>]*>([^<]+)<\/Dimension>/.exec(xml) ||
            /<Extent[^>]*name="time"[^>]*>([^<]+)<\/Extent>/.exec(xml);
    if (!m) return [];
    return m[1].split(',').map(function (s) { return s.trim(); })
      .filter(function (s) { return /^\d{4}-\d{2}-\d{2}T/.test(s) && Date.parse(s); })
      .sort(function (a, b) { return Date.parse(a) - Date.parse(b); });
  }

  function pickPast(times) {
    if (!times.length) return [];
    var ms = times.map(Date.parse);
    var newest = ms[ms.length - 1];
    var out = [];
    for (var k = PAST - 1; k >= 0; k--) {
      var want = newest - k * STEP_MIN * MIN;
      var best = -1, gap = Infinity;
      for (var i = 0; i < ms.length; i++) {
        var g = Math.abs(ms[i] - want);
        if (g < gap) { gap = g; best = i; }
      }
      /* a gap in the feed bigger than half a step leaves that slot out */
      if (best < 0 || gap > STEP_MIN * MIN / 2) continue;
      if (out.length && out[out.length - 1].iso === times[best]) continue;
      out.push({ iso: times[best], ms: ms[best], kind: 'radar' });
    }
    return out;
  }

  /* ---------------- the forecast frames ----------------
     From the newest HRRR run IEM has finished (its eighteen-hour file
     is written last), every half hour from just after Now to twelve
     hours on, or to the end of the run if that comes first. */
  function runStamp(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes());
  }

  function forecastFrames(runIso, nowMs) {
    var run = Date.parse(runIso);
    if (!isFinite(run) || run > nowMs + HOUR || nowMs - run > RUN_MAX_AGE_H * HOUR) return [];
    var step = FC_STEP_MIN * MIN;
    var first = Math.ceil((nowMs + FC_GAP_MIN * MIN) / step) * step;
    var last = Math.min(nowMs + FC_HOURS * HOUR, run + HRRR_REACH_MIN * MIN);
    var out = [];
    for (var t = first; t <= last; t += step) {
      var fmin = Math.round((t - run) / MIN);
      if (fmin < 0 || fmin % 15) continue;          // HRRR steps are fifteen minutes
      out.push({ iso: new Date(t).toISOString(), ms: t, kind: 'forecast', run: runStamp(run), fmin: ('000' + fmin).slice(-4) });
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

  /* One CSS pixel per image pixel, not two: MRMS is a one-kilometre grid,
     coarser than a pixel at the zooms this map opens on, so a 2x image
     would be four times the bytes for nothing. */
  function frameSize() {
    var s = map.getSize();
    var scale = Math.min(1, MAX_PX / Math.max(s.x, s.y, 1));
    return { w: Math.max(1, Math.round(s.x * scale)), h: Math.max(1, Math.round(s.y * scale)) };
  }

  function fcKey(f) { return f.kind === 'forecast' ? f.run + '/' + f.fmin : ''; }

  /* The forecast frames are tile layers (Leaflet fetches what the view
     needs and follows a pan by itself). They sit in their own pane, so
     the base map's grey filter never touches them. A layer the last
     frame list already had is kept, not asked for again. */
  function syncForecast() {
    var keep = {};
    frames.forEach(function (f) {
      if (f.kind !== 'forecast') return;
      var k = fcKey(f);
      keep[k] = true;
      if (!fcLayers[k]) {
        fcLayers[k] = window.L.tileLayer(HRRR_TILES.replace('{run}', f.run).replace('{fmin}', f.fmin), {
          pane: 'radarForecast', opacity: 0, maxZoom: 11, maxNativeZoom: 10,
          className: 'radar-frame radar-fc', attribution: FORECAST_CREDIT
        });
      }
      f.layer = fcLayers[k];
    });
    Object.keys(fcLayers).forEach(function (k) {
      if (!keep[k]) { map.removeLayer(fcLayers[k]); delete fcLayers[k]; }
    });
  }

  /* Now loads first. Once it has, the forecast frames (nearest first) and
     the rest of the past follow, so the map shows the rain at once and
     the loop fills in behind it. A pan or zoom redraws the radar images
     as a new generation; answers from an old one are ignored. */
  function buildPast() {
    if (!map || !frames.length) return;
    var my = ++gen;
    var b = map.getBounds(), size = frameSize();
    /* every set this one replaces, including a set a quicker pan cut off
       before it ever showed, leaves the map once this one's Now has loaded */
    retired = retired.concat(pastLayers);
    var past = frames.filter(function (f) { return f.kind === 'radar'; });
    var left = past.length, failed = 0;
    var done = function (ok) {
      if (my !== gen) return;
      if (!ok) failed++;
      if (--left === 0) {
        if (failed === past.length) fail();
        else { pastDone = true; trySettle(); }
      }
    };
    pastLayers = past.map(function (f, i) {
      var o = window.L.imageOverlay(frameUrl(f.iso, b, size), b, {
        opacity: frames[idx] === f ? OPACITY : 0, interactive: false,
        className: 'radar-frame', attribution: i === 0 ? RADAR_CREDIT : undefined
      });
      o.on('load', function () { done(true); });
      o.on('error', function () { done(false); });
      f.layer = o;
      return o;
    });
    var first = frames[nowIdx].layer;
    var rest = function () {
      if (my !== gen) return;
      retired.forEach(function (o) { map.removeLayer(o); });
      retired = [];
      if (!fcAdded) {
        fcAdded = true;
        /* The loop waits for each new forecast frame's first tiles too (or
           SETTLE_MS). If not one of their tiles came, IEM is down: the
           forecast leaves the timeline rather than play as blank frames. */
        var tally = { ok: 0, err: 0, left: 0 };
        frames.forEach(function (f) {
          if (f.kind !== 'forecast' || map.hasLayer(f.layer)) return;
          var once = false;
          fcLeft++;
          tally.left++;
          f.layer.on('tileload', function () { tally.ok++; });
          f.layer.on('tileerror', function () { tally.err++; });
          f.layer.on('load', function () {
            if (once) return;
            once = true;
            fcLeft--;
            if (--tally.left === 0 && !tally.ok && tally.err) dropForecast();
            trySettle();
          });
          f.layer.addTo(map);
        });
      }
      pastLayers.forEach(function (o) { if (o !== first) o.addTo(map); });
    };
    first.on('load', function () {
      if (my !== gen) return;
      root.classList.remove('is-loading');
      rest();
    });
    first.on('error', function () {
      if (my !== gen) return;
      if (!shown) { fail(); return; }   // the very first picture did not come: say so
      rest();
    });
    first.addTo(map);
  }

  function dropForecast() {
    if (!frames.some(function (f) { return f.kind === 'forecast'; })) return;
    frames = frames.filter(function (f) { return f.kind !== 'forecast'; });
    fcLeft = 0;
    syncForecast();
    markNow();
    show(Math.min(idx, nowIdx));
  }

  /* every frame has answered (or SETTLE_MS has passed): the loop may run */
  function trySettle() { if (pastDone && fcLeft <= 0) settle(); }
  function settle() {
    if (settled || root.classList.contains('is-failed')) return;
    settled = true;
    shown = true;
    setPlaying(!reduced);
  }

  function show(i) {
    if (!frames.length) return;
    idx = Math.max(0, Math.min(frames.length - 1, i));
    frames.forEach(function (f, k) { if (f.layer) f.layer.setOpacity(k === idx ? OPACITY : 0); });
    var f = frames[idx];
    var fc = f.kind === 'forecast';
    badge.textContent = (fc ? 'Forecast' : idx === nowIdx ? 'Now' : 'Radar') + ' · ' + clock(f.ms);
    timeEl.textContent = idx === nowIdx ? 'Now' : fc ? ahead(f.ms - frames[nowIdx].ms) : Math.round((frames[nowIdx].ms - f.ms) / MIN) + ' min ago';
    scrub.value = String(idx);
    scrub.setAttribute('aria-valuetext', badge.textContent);
    root.classList.toggle('is-forecast', fc);
    root.setAttribute('data-frame', String(idx));
    paintJumps();
    paintCursor();
  }

  /* the Now tick on the scrubber, and the line beside the title */
  function markNow() {
    var n = frames.length;
    scrub.max = String(n - 1);
    nowMark.style.setProperty('--now', String(n > 1 ? nowIdx / (n - 1) : 0));
    var fc = frames.filter(function (f) { return f.kind === 'forecast'; });
    var age = Math.round((Date.now() - frames[nowIdx].ms) / MIN);
    stamp.textContent = (age <= 1 ? 'Radar just now' : 'Radar ' + age + ' min ago') +
      (fc.length ? ' · forecast to ' + clock(fc[fc.length - 1].ms) : ' · no forecast right now');
    root.classList.toggle('has-forecast', !!fc.length);
  }

  /* ---------------- the loop ----------------
     Forward from wherever it is, a beat on Now, a hold on the last
     forecast frame, then back to Now (not into the past). With no
     forecast to show it loops the past hour, as the radar used to. */
  function loopStart() { return nowIdx < frames.length - 1 ? nowIdx : 0; }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!playing || !(onScreen || full) || document.hidden) return;
    var last = frames.length - 1;
    timer = setTimeout(function () { show(idx >= last ? loopStart() : idx + 1); schedule(); },
      idx >= last ? HOLD_MS : idx === nowIdx ? NOW_MS : FRAME_MS);
  }

  function setPlaying(on) {
    playing = !!on && frames.length > 1;
    playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    root.classList.toggle('is-playing', playing);
    paintJumps();
    schedule();
  }

  /* ---------------- mount ---------------- */
  function fail() {
    gen++;
    setPlaying(false);
    root.classList.remove('is-loading');
    root.classList.add('is-failed');
    if (mapEl) mapEl.hidden = true;
    controls.hidden = true;
    badge.hidden = true;
    if (jumpsEl) jumpsEl.hidden = true;
    failEl.hidden = false;
    if (full) closeFull();
  }

  /* The radar list is required; the forecast run is not (without it the
     map still shows the last hour, and the line by the title says there
     is no forecast right now). */
  function frameList() {
    lastCheck = Date.now();
    var radarP = fetch(WMS + '?service=WMS&version=1.3.0&request=GetCapabilities', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (xml) { return pickPast(readTimes(xml)); });
    var runP = fetch(HRRR_RUN, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { lastRun = j && typeof j.model_init_utc === 'string' ? j.model_init_utc : null; return lastRun; })
      /* a failed read keeps the run already showing (forecastFrames drops it once it is too old) */
      .catch(function () { return lastRun; });
    return Promise.all([radarP, runP]).then(function (got) {
      var past = got[0];
      if (!past.length) return { frames: [], now: 0 };
      var nowMs = past[past.length - 1].ms;
      return { frames: past.concat(got[1] ? forecastFrames(got[1], nowMs) : []), now: past.length - 1 };
    });
  }

  /* NOAA adds a scan every two minutes and IEM a forecast run every hour.
     While the radar is on screen the list is read again every ten minutes.
     A reader on Now (or watching it play) moves with Now; one parked on a
     frame stays on the nearest frame in time. */
  function refresh() {
    if (!map || !(onScreen || full) || document.hidden || root.classList.contains('is-failed') || Date.now() - lastCheck < REFRESH_MS) return;
    frameList().then(function (next) {
      if (!next.frames.length) return;
      var same = next.frames.length === frames.length && next.frames.every(function (f, i) {
        return f.iso === frames[i].iso && fcKey(f) === fcKey(frames[i]);
      });
      if (same) return;
      var atNow = playing || idx === nowIdx, was = frames[idx].ms;
      frames = next.frames;
      nowIdx = next.now;
      var nearest = 0;
      frames.forEach(function (f, i) { if (Math.abs(f.ms - was) < Math.abs(frames[nearest].ms - was)) nearest = i; });
      idx = atNow ? nowIdx : nearest;
      fcAdded = false;
      syncForecast();
      markNow();
      buildPast();
      show(idx);
    }).catch(function () { /* keep looping what we have */ });
  }

  function start() {
    if (started) return;
    started = true;
    root.classList.add('is-loading');
    Promise.all([loadLeaflet(), frameList()]).then(function (got) {
      var L = got[0];
      frames = got[1].frames;
      nowIdx = got[1].now;
      if (!frames.length) throw new Error('no frames');
      idx = nowIdx;
      map = L.map(mapEl, {
        center: CENTER, zoom: ZOOM, minZoom: 5, maxZoom: 11,
        scrollWheelZoom: false,
        /* one finger scrolls the page on a phone; the buttons zoom */
        dragging: !(L.Browser && L.Browser.mobile),
        attributionControl: true
      });
      /* the forecast's own pane: level with the radar images, above the base map */
      map.createPane('radarForecast').style.zIndex = '400';
      L.tileLayer(TILES, { maxZoom: 19, attribution: TILE_CREDIT }).addTo(map);
      L.circleMarker(CENTER, { radius: 5, weight: 2, color: '#16191D', fillColor: '#ffffff', fillOpacity: 1, className: 'radar-home' }).addTo(map);
      syncForecast();
      markNow();
      controls.hidden = false;
      badge.hidden = false;
      if (jumpsEl) jumpsEl.hidden = false;
      if (full) setTimeout(fitMap, 0);
      buildPast();
      show(idx);
      map.on('moveend', function () {
        clearTimeout(rebuildT);
        rebuildT = setTimeout(buildPast, 250);
      });
      setTimeout(settle, SETTLE_MS);
      setInterval(refresh, 60000);
      setInterval(function () { if (frames.length) markNow(); }, 60000);
      window.btownRadar = {
        frames: function () { return frames.map(function (f) { return f.iso; }); },
        kinds: function () { return frames.map(function (f) { return f.kind; }); },
        nowIndex: function () { return nowIdx; },
        index: function () { return idx; },
        playing: function () { return playing; },
        ready: function () { return settled; },
        map: map
      };
    }).catch(fail);
  }

  /* ============================================================
     The one-line answer above the map: rain (or snow) in the next
     twelve hours, from the NWS hourly chances in latest.json. The
     bars are scripts/weather_brief.py's: a chance under 25% is dry;
     the wet hours are those at 50% or more when the peak is 60% or
     more, else those at 25% or more; 75%+ is said flat, 55%+ is
     "likely", below that "a chance of". Times are Burlington's clock,
     written the brief's way ("3pm", "from 2 to 7pm").
  ============================================================ */
  var PRECIP_WORDS = [
    [/thunder|t-storm/, 'thunderstorms'],
    [/freezing rain|freezing drizzle|sleet|ice pellets|wintry/, 'a wintry mix'],
    [/snow|flurr/, 'snow'],
    [/shower/, 'showers'],
    [/drizzle/, 'drizzle'],
    [/rain/, 'rain']
  ];
  function precipKind(texts) {
    var found = [];
    texts.forEach(function (t) {
      var low = String(t || '').toLowerCase();
      for (var i = 0; i < PRECIP_WORDS.length; i++) {
        if (PRECIP_WORDS[i][0].test(low)) {
          if (found.indexOf(PRECIP_WORDS[i][1]) < 0) found.push(PRECIP_WORDS[i][1]);
          break;
        }
      }
    });
    if (!found.length) return 'rain';
    if (found.indexOf('thunderstorms') >= 0) return 'thunderstorms';
    if (found.indexOf('a wintry mix') >= 0) return 'a wintry mix';
    if (found.indexOf('snow') >= 0 && found.length > 1) return 'rain and snow';
    return found[0];
  }
  function likelihood(kind, chance) {
    if (chance >= 75) return kind;
    if (chance >= 55) return kind + ' likely';
    return 'a chance of ' + kind;
  }
  var hourFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/New_York' });
  /* 2pm, 11am, noon, midnight, 2:30pm */
  function briefClock(ms) {
    var p = hourFmt.format(new Date(ms)).split(':');
    var h = Number(p[0]) % 24, m = Number(p[1]);
    if (!m && h === 0) return 'midnight';
    if (!m && h === 12) return 'noon';
    return (h % 12 || 12) + (m ? ':' + p[1] : '') + (h < 12 ? 'am' : 'pm');
  }
  /* "from about 2 to 7pm", "from about 10am to 3pm", "from about 9pm to 2am" */
  function briefSpan(a, b) {
    var ca = briefClock(a), cb = briefClock(b);
    var half = ca.slice(-2);
    if (half === cb.slice(-2) && (half === 'am' || half === 'pm') && b - a < 12 * HOUR) ca = ca.slice(0, -2);
    return 'from about ' + ca + ' to ' + cb;
  }

  function rainLine(d, now) {
    var hours = (((d || {}).hourly || {}).hours) || [];
    var end = now + FC_HOURS * HOUR;
    var rows = hours.filter(function (h) {
      var t = Date.parse(h && h.t);
      return isFinite(t) && t + HOUR > now && t < end;
    });
    /* an old file that no longer covers the next twelve hours says nothing */
    if (rows.length < FC_HOURS) return '';
    var pop = function (h) { return Number(h.pop) || 0; };
    var chance = Math.max.apply(null, rows.map(pop));
    var cold = rows.some(function (h) { return h.temp_f != null && h.temp_f <= 34; });
    if (chance < 25) return cold ? 'No rain or snow expected in the next 12 hours.' : 'No rain expected in the next 12 hours.';
    var bar = chance >= 60 ? 50 : 25;
    var wet = rows.filter(function (h) { return pop(h) >= bar; });
    var say = likelihood(precipKind(wet.map(function (h) { return h.short; })), chance);
    say = say.charAt(0).toUpperCase() + say.slice(1);
    var a = Date.parse(wet[0].t), b = Date.parse(wet[wet.length - 1].t) + HOUR;
    var runs = 1;
    for (var i = 1; i < wet.length; i++) if (Date.parse(wet[i].t) - Date.parse(wet[i - 1].t) > HOUR) runs++;
    var lead = runs > 1 ? ' on and off' : '';
    var started = a <= now, toEnd = b >= Date.parse(rows[rows.length - 1].t) + HOUR;
    if (started && toEnd) return say + lead + ' for the next 12 hours.';
    if (started) return say + lead + ' until about ' + briefClock(b) + '.';
    if (toEnd) return say + lead + ' from about ' + briefClock(a) + ' on.';
    return say + lead + ' ' + briefSpan(a, b) + '.';
  }

  var weather = null;
  function renderAnswer() {
    if (!answerEl) return;
    var line = weather ? rainLine(weather, Date.now()) : '';
    answerEl.textContent = line;
    answerEl.hidden = !line;
    /* the same line is the hero's headline (Wethr's "Dry for the next 105 min") */
    if (heroEl) { heroEl.textContent = line; heroEl.hidden = !line; }
    renderTimeline(line ? weather : null);
  }

  /* ============================================================
     The chance-of-rain timeline under the answer (Wethr's Next 2 Hours
     card, stretched to twelve): one bar per hour from Now, its height the
     NWS hourly chance, in the colour of what is falling. No intensity:
     the only hourly amount the NWS grid gives is a six-hour total split
     evenly, which would draw a flat, made-up rate. A thin line marks the
     forecast frame the map is showing.
  ============================================================ */
  var tlStart = 0;
  function renderTimeline(d) {
    if (!rainBox) return;
    var now = Date.now();
    var rows = ((((d || {}).hourly || {}).hours) || []).filter(function (h) {
      var t = Date.parse(h && h.t);
      return isFinite(t) && t + HOUR > now && t < now + FC_HOURS * HOUR;
    }).slice(0, FC_HOURS);
    if (rows.length < FC_HOURS) { rainBox.hidden = true; return; }
    tlStart = Date.parse(rows[0].t);
    var pop = function (h) { return Math.max(0, Math.min(100, Number(h.pop) || 0)); };
    var peak = rows[0];
    rows.forEach(function (h) { if (pop(h) > pop(peak)) peak = h; });
    var cold = rows.some(function (h) { return h.temp_f != null && h.temp_f <= 34; });
    var what = cold ? 'rain or snow' : 'rain';
    peakEl.textContent = !pop(peak) ? 'Chance of ' + what + ': 0% every hour.'
      : 'Highest chance of ' + what + ': ' + pop(peak) + '%' + (Date.parse(peak.t) <= now ? ' right now' : ' at ' + briefClock(Date.parse(peak.t)));
    var bars = rows.map(function (h) {
      var sh = String(h.short || '');
      var cls = /thunder|t-storm/i.test(sh) ? 'is-storm' : /snow|flurr|sleet|ice|wintry|freezing/i.test(sh) ? 'is-snow' : '';
      return '<span class="tl-bar ' + cls + (pop(h) >= 50 ? ' is-likely' : '') + '" style="--p:' + pop(h) + '" title="' +
        briefClock(Date.parse(h.t)) + ': ' + pop(h) + '%"></span>';
    }).join('');
    /* each label sits under its own bar */
    var tick = function (i) { return '<span style="left:' + ((i + 0.5) / FC_HOURS * 100) + '%">' + (i ? briefClock(tlStart + i * HOUR) : 'Now') + '</span>'; };
    lineEl.innerHTML = '<div class="tl-plot"><div class="tl-bars">' + bars + '</div>' +
      '<span class="tl-y tl-y-100">100%</span><span class="tl-y tl-y-50">50%</span><span class="tl-y tl-y-0">0%</span>' +
      '<span class="tl-cursor" hidden></span></div>' +
      '<div class="tl-x">' + tick(0) + tick(3) + tick(6) + tick(9) + tick(FC_HOURS - 1) + '</div>';
    rainBox.hidden = false;
    paintCursor();
  }
  function paintCursor() {
    if (!lineEl) return;
    var c = lineEl.querySelector('.tl-cursor');
    if (!c) return;
    var f = frames[idx];
    var at = f && f.kind === 'forecast' ? (f.ms - tlStart) / (FC_HOURS * HOUR) : -1;
    c.hidden = !(at >= 0 && at <= 1);
    if (!c.hidden) c.style.left = (at * 100) + '%';
  }

  /* ============================================================
     The time chips (Wethr's −1 h · +1 h · +2 h · +8 h · +24 h): each
     jumps to the frame nearest that far from Now and pauses there. The
     oldest frame is fifty minutes back, so that chip says so.
  ============================================================ */
  function jumpTarget(mins) {
    if (!frames.length) return -1;
    if (mins < 0) return 0;
    if (!mins) return nowIdx;
    var want = frames[nowIdx].ms + mins * MIN, best = -1;
    frames.forEach(function (f, i) {
      if (f.kind !== 'forecast') return;
      if (best < 0 || Math.abs(f.ms - want) < Math.abs(frames[best].ms - want)) best = i;
    });
    return best;
  }
  function paintJumps() {
    if (!jumpsEl) return;
    Array.prototype.forEach.call(jumpsEl.querySelectorAll('button'), function (b) {
      var t = jumpTarget(Number(b.getAttribute('data-jump')));
      b.disabled = t < 0;
      var on = t === idx && !playing;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ============================================================
     Full screen (Wethr's Radar tab): the map fills the screen, the
     answer, timeline and controls ride a glass sheet at the bottom, the
     map drags with one finger, and Done (or Escape, or Back) returns to
     the page where it was. Opening it wakes the radar if it was asleep.
  ============================================================ */
  function fitMap() {
    if (!map) return;
    if (map.invalidateSize) map.invalidateSize();
    if (map.dragging && window.L && window.L.Browser && window.L.Browser.mobile) {
      if (full) map.dragging.enable(); else map.dragging.disable();
    }
    if (map.getSize && frames.length) { clearTimeout(rebuildT); rebuildT = setTimeout(buildPast, 250); }
  }
  function setFull(on) {
    if (on === full) return;
    full = on;
    /* hold the section's place so the page under the overlay does not move */
    root.style.minHeight = on ? root.offsetHeight + 'px' : '';
    root.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('wx-radar-open', on);
    fullBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    fullBtn.querySelector('.radar-full-label').textContent = on ? 'Done' : 'Full screen';
    if (on) {
      start();
      fullBtn.focus({ preventScroll: true });
    } else {
      root.scrollIntoView({ block: 'start' });
    }
    setTimeout(fitMap, 30);
    schedule();
  }
  function openFull() {
    if (full) return;
    /* a radar that failed has nothing to fill the screen with: show its card and links instead */
    if (root.classList.contains('is-failed')) { root.scrollIntoView({ block: 'start' }); return; }
    try { history.pushState({ wxRadar: 1 }, '', '#radar'); pushed = true; } catch (e) { pushed = false; }
    setFull(true);
  }
  function closeFull() {
    if (!full) return;
    if (pushed) { pushed = false; try { history.back(); return; } catch (e) { /* fall through */ } }
    setFull(false);
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
    badge = document.getElementById('radar-badge');
    nowMark = document.getElementById('radar-now');
    answerEl = document.getElementById('radar-answer');
    heroEl = document.getElementById('rn-rain');
    jumpsEl = document.getElementById('radar-jumps');
    fullBtn = document.getElementById('radar-full');
    rainBox = document.getElementById('radar-rainline');
    peakEl = document.getElementById('radar-peak');
    lineEl = document.getElementById('radar-timeline');

    /* the answer needs only the page's own forecast file, so it shows
       straight away, whether or not the map ever loads */
    weather = window.btownWeatherData || null;
    renderAnswer();
    window.addEventListener('btown:weather-data', function (e) { weather = e.detail; renderAnswer(); });
    setInterval(renderAnswer, REFRESH_MS);

    playBtn.addEventListener('click', function () {
      if (!playing && idx >= frames.length - 1) show(loopStart());
      setPlaying(!playing);
    });
    scrub.addEventListener('input', function () {
      setPlaying(false);
      show(parseInt(scrub.value, 10) || 0);
    });
    if (jumpsEl) jumpsEl.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-jump]');
      if (!b || b.disabled) return;
      var t = jumpTarget(Number(b.getAttribute('data-jump')));
      if (t < 0) return;
      setPlaying(false);
      show(t);
    });
    if (fullBtn) fullBtn.addEventListener('click', function () { if (full) closeFull(); else openFull(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-radar-open]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openFull(); });
    });
    document.addEventListener('keydown', function (e) { if (full && e.key === 'Escape') closeFull(); });
    window.addEventListener('popstate', function () { if (full) { pushed = false; setFull(false); } });
    document.addEventListener('visibilitychange', function () { schedule(); refresh(); });

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
