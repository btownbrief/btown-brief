/* ============================================================
   THINGS TO DO IN BURLINGTON — weather.js
   Live current conditions for the header, via Open-Meteo
   (no API key, free, CORS-enabled).
   Swappable: replace fetchWeather() to use another source
   (e.g. api.weather.gov) without touching the rest of the app.
============================================================ */

(function () {
  'use strict';

  var LAT = 44.4759;
  var LON = -73.2121;

  // WMO weather codes → { label, icon }
  function describe(code) {
    if (code === 0) return { label: 'Clear', icon: '☀' };
    if (code === 1 || code === 2) return { label: 'Partly cloudy', icon: '⛅' };
    if (code === 3) return { label: 'Cloudy', icon: '☁' };
    if (code === 45 || code === 48) return { label: 'Fog', icon: '☁' };
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: '🌧' };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: '❄' };
    if (code >= 95) return { label: 'Thunderstorm', icon: '⛈' };
    return { label: 'Weather', icon: '☁' };
  }

  function fetchWeather() {
    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + LAT + '&longitude=' + LON
      + '&current=temperature_2m,weather_code,is_day'
      + '&temperature_unit=fahrenheit';
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var cur = data && data.current;
        if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('bad payload');
        return { temp: Math.round(cur.temperature_2m), code: cur.weather_code, isDay: cur.is_day !== 0 };
      });
  }

  function render(weather) {
    var el = document.getElementById('weather-indicator');
    var wrap = document.getElementById('weather-wrap');
    if (!el) return;
    var desc = describe(weather.code);
    el.innerHTML = '<span class="weather-icon" aria-hidden="true">' + desc.icon + '</span>'
      + '<span class="weather-temp">' + weather.temp + '°</span>'
      + '<span class="weather-label">' + desc.label + '</span>'
      + '<span class="weather-caret" aria-hidden="true">▾</span>';
    el.title = desc.label + ', ' + weather.temp + '°F in Burlington';
    el.setAttribute('aria-label', 'Current weather: ' + desc.label + ', ' + weather.temp + ' degrees Fahrenheit. Tap for forecast links.');
    if (wrap) wrap.hidden = false;
    wireMenu();
  }

  var menuWired = false;
  function wireMenu() {
    if (menuWired) return;
    var btn = document.getElementById('weather-indicator');
    var menu = document.getElementById('weather-menu');
    if (!btn || !menu) return;
    menuWired = true;

    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function open() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  /* ----------------------------------------------------------
     AMBIENT WEATHER LAYER
     A full-screen, non-interactive canvas that lets you *feel*
     the current weather while scrolling: falling snow, rain
     streaks (drizzle through downpour), or a soft sun glow.

     Particles are split across three depth bands — far ones are
     small, faint and slow; near ones are big, bright and fast.
     That parallax is what makes it read as weather rather than
     as speckle. Each band draws as a single batched path, so a
     downpour is ~3 draw calls, not 400.

     Readability comes first: the layer sits over the page, so
     rain stays thin and snow stays soft enough to read through.
  ---------------------------------------------------------- */

  // [ lenMin, lenSpan, speedMin, speedSpan, drift, lineWidth, alpha, share ]
  var RAIN_BANDS = [
    { lenMin: 12, lenSpan: 8,  speedMin: 10, speedSpan: 5, drift: 0.9, width: 0.9, alpha: 0.34, share: 0.45 },
    { lenMin: 18, lenSpan: 10, speedMin: 16, speedSpan: 5, drift: 1.6, width: 1.3, alpha: 0.50, share: 0.35 },
    { lenMin: 26, lenSpan: 14, speedMin: 22, speedSpan: 8, drift: 2.5, width: 1.9, alpha: 0.66, share: 0.20 },
  ];
  // [ radius, speed, sway amplitude, alpha, share ]
  var SNOW_BANDS = [
    { rMin: 1.0, rSpan: 0.8, speedMin: 0.6, speedSpan: 0.5, sway: 9,  alpha: 0.48, share: 0.40 },
    { rMin: 1.8, rSpan: 1.0, speedMin: 1.1, speedSpan: 0.7, sway: 15, alpha: 0.70, share: 0.35 },
    { rMin: 2.8, rSpan: 1.6, speedMin: 1.8, speedSpan: 0.8, sway: 21, alpha: 0.88, share: 0.25 },
  ];

  function initAmbient(weather) {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var code = weather.code;
    var kind = null;      // 'rain' | 'snow' | 'sun'
    var intensity = 1;    // rain/snow density multiplier

    if ((code >= 51 && code <= 57) || code === 61 || code === 80) { kind = 'rain'; intensity = 0.45; }  // drizzle / light rain
    else if (code === 63 || code === 81) { kind = 'rain'; intensity = 0.85; }
    else if (code === 65 || code === 82 || code >= 95) { kind = 'rain'; intensity = 1.4; }
    else if ((code >= 66 && code <= 77) || code === 85 || code === 86) { kind = 'snow'; intensity = 1; }
    else if (code === 0 && weather.isDay) { kind = 'sun'; }
    else if ((code === 1 || code === 2) && weather.isDay) { kind = 'sun'; intensity = 0.5; }
    if (!kind) return;

    var canvas = document.createElement('canvas');
    canvas.id = 'weather-ambient';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var W = 0, H = 0, bands = [];
    var lastW = -1, lastH = -1, lastDpr = -1, resizeTimer = 0;

    function applySize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = window.innerWidth;
      var h = window.innerHeight;
      if (w === lastW && h === lastH && dpr === lastDpr) return;
      lastW = w; lastH = h; lastDpr = dpr;

      W = w; H = h;
      // Back the canvas at device resolution so 1px rain stays crisp instead
      // of smearing into invisibility on a retina screen. The element itself
      // is sized by CSS (inset: 0), so it always fills the viewport even while
      // a resize is still debounced — only the bitmap resolution lags.
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // assigning width/height resets it

      // Reseed only when the viewport changed enough to want a materially
      // different particle count. A phone's URL bar sliding in and out fires
      // resize continuously mid-scroll; re-randomising the whole field on each
      // of those would both cost allocations and visibly teleport the rain.
      var want = targetCount();
      var have = 0;
      for (var b = 0; b < bands.length; b++) have += bands[b].list.length;
      if (!bands.length || Math.abs(want - have) > want * 0.2) seed();

      if (reduced) draw(false);   // static layer still needs a repaint on resize
    }

    function isDark() {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function targetCount() {
      var per = kind === 'rain' ? 4200 : 5200;
      return Math.min(750, Math.round((W * H) / per * intensity));
    }

    function seed() {
      bands = [];
      if (kind === 'sun') return;
      var specs = kind === 'rain' ? RAIN_BANDS : SNOW_BANDS;
      var total = targetCount();

      for (var b = 0; b < specs.length; b++) {
        var spec = specs[b];
        var list = [];
        var count = Math.round(total * spec.share);
        for (var i = 0; i < count; i++) {
          list.push(kind === 'rain' ? {
            x: Math.random() * (W + 80) - 40, y: Math.random() * H,
            len: spec.lenMin + Math.random() * spec.lenSpan,
            speed: spec.speedMin + Math.random() * spec.speedSpan,
          } : {
            x: Math.random() * W, y: Math.random() * H,
            r: spec.rMin + Math.random() * spec.rSpan,
            speed: spec.speedMin + Math.random() * spec.speedSpan,
            phase: Math.random() * Math.PI * 2,
          });
        }
        bands.push({ spec: spec, list: list });
      }
    }

    var t = 0, running = true, rafId = 0, lastTs = 0;

    // Paint one frame. `step` false = repaint without advancing (reduced
    // motion). `dt` is elapsed time in 60fps-frames, so a 120Hz ProMotion
    // phone doesn't run the rain at double speed.
    function draw(step, dt) {
      var k = dt || 1;
      ctx.clearRect(0, 0, W, H);
      var dark = isDark();

      if (kind === 'sun') {
        // Soft warm glow breathing in the top corner — dusk-lake gold.
        var pulse = 0.13 + 0.05 * Math.sin(t * 0.35);
        var g = ctx.createRadialGradient(W * 0.85, -H * 0.1, 0, W * 0.85, -H * 0.1, Math.max(W, H) * 0.75);
        var warm = dark ? '244,166,90' : '242,150,60';
        g.addColorStop(0, 'rgba(' + warm + ',' + (pulse * intensity) + ')');
        g.addColorStop(1, 'rgba(' + warm + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        return;
      }

      var rgb = kind === 'rain'
        ? (dark ? '162,206,236' : '58,110,145')
        : (dark ? '240,246,252' : '116,142,176');

      for (var b = 0; b < bands.length; b++) {
        var spec = bands[b].spec;
        var list = bands[b].list;

        if (kind === 'rain') {
          ctx.strokeStyle = 'rgba(' + rgb + ',' + spec.alpha + ')';
          ctx.lineWidth = spec.width;
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (var i = 0; i < list.length; i++) {
            var p = list[i];
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - spec.drift * 2.2, p.y + p.len);
            if (step === false) continue;
            p.y += p.speed * k;
            p.x -= spec.drift * k;
            if (p.y > H) { p.y = -p.len; p.x = Math.random() * (W + 80); }
          }
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(' + rgb + ',' + spec.alpha + ')';
          ctx.beginPath();
          for (var j = 0; j < list.length; j++) {
            var s = list[j];
            var sx = s.x + Math.sin(t * 0.9 + s.phase) * spec.sway;
            ctx.moveTo(sx + s.r, s.y);
            ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
            if (step === false) continue;
            s.y += s.speed * k;
            if (s.y > H + 6) { s.y = -6; s.x = Math.random() * W; }
          }
          ctx.fill();
        }
      }
    }

    function frame(ts) {
      rafId = 0;
      if (!running) return;
      // Clamp so a long pause (background tab, sleeping laptop) doesn't
      // teleport every particle down the screen on the first frame back.
      var dt = lastTs ? Math.min((ts - lastTs) / 16.667, 3) : 1;
      lastTs = ts;
      t += 0.016 * dt;
      draw(true, dt);
      rafId = requestAnimationFrame(frame);
    }

    // start()/stop() are guarded by rafId so we can never end up with two
    // concurrent loops (which would run the weather at double speed).
    function start() {
      if (rafId || reduced || !running) return;
      lastTs = 0;
      rafId = requestAnimationFrame(frame);
    }
    function stop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    document.addEventListener('visibilitychange', function () {
      // Cancel the pending frame rather than just flagging it: a queued rAF
      // survives the tab being hidden and would otherwise fire on return
      // alongside the one we schedule here.
      if (document.hidden) { running = false; stop(); }
      else { running = true; start(); }
    });

    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applySize, 120);
    });

    // Reduced motion still gets the weather — applySize() paints one still
    // frame and we never start the loop.
    applySize();
    start();
  }

  // Preview hook: append ?wx=sun|rain|lightrain|snow|storm to the URL
  // to force an ambient mode for testing, regardless of real weather.
  function forcedWeather() {
    var m = /[?&]wx=(\w+)/.exec(window.location.search);
    if (!m) return null;
    var codes = { sun: 0, lightrain: 51, rain: 63, storm: 95, snow: 73 };
    if (!(m[1] in codes)) return null;
    return { temp: 65, code: codes[m[1]], isDay: true };
  }

  function init() {
    var forced = forcedWeather();
    if (forced) {
      render(forced);
      initAmbient(forced);
      return;
    }
    fetchWeather().then(function (weather) {
      render(weather);
      initAmbient(weather);
    }).catch(function () {
      // Fail silently — the indicator just stays hidden, no ambient layer.
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
