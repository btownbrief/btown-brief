/* ============================================================
   THINGS TO DO IN BURLINGTON — sun.js
   The daylight widget: sunrise on the left, sunset on the right,
   a hand-etched almanac scene in the middle, with sun, moon, sky,
   and lighting following the day's actual progress, and
   a countdown of the daylight left. The whole strip links to the
   sunset tracker page. Data from Open-Meteo (no key). Absolute UTC
   timestamps are used for all math, so it's correct from any
   timezone.

   The art is drawn fresh each page load from a random seed —
   ray angles, star fields and water strokes shift a little every
   visit, like a new pull of the same engraving plate.

   Test hooks: ?sunf=0.7 forces a daytime fraction (0=sunrise,
   1=sunset); ?sunf=night forces night; ?sunart=sunrise|day|sunset|night
   forces a specific scene state.
============================================================ */

(function () {
  'use strict';

  var LAT = 44.4759, LON = -73.2121;
  var DAY_SECONDS = 14 * 3600; // synthetic day length for the test hook

  var sun = null;   // { riseToday, setToday, riseTomorrow }
  var els = {};     // cached DOM refs updated on each tick
  var timer = null;
  var sceneSeed = null;

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  /* ---------- tiny seeded rng so each load pulls a fresh print ---------- */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function pickSeed() {
    // Fresh art each load; remember the last seed so a reload never
    // repeats the exact same pull.
    var seed = Math.floor(Math.random() * 100000);
    try {
      var last = parseInt(localStorage.getItem('btb-sunart-seed'), 10);
      if (seed === last) seed = (seed + 7919) % 100000;
      localStorage.setItem('btb-sunart-seed', String(seed));
    } catch (e) { /* private mode — fine */ }
    return seed;
  }

  /* ================= engraved medallion art =================
     All pieces are stroke-drawn SVG in the hand-etched almanac
     style: triangular and wavy flame rays, rim hatching, a serene
     face, sparkle stars. Colors come from CSS custom properties
     set per state class, so light/dark themes just work. */

  function polar(cx, cy, r, aDeg) {
    var a = (aDeg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function pt(p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }

  function spikeRay(cx, cy, aDeg, rBase, rTip, halfW) {
    var tip = polar(cx, cy, rTip, aDeg);
    var b1 = polar(cx, cy, rBase, aDeg - halfW);
    var b2 = polar(cx, cy, rBase, aDeg + halfW);
    return 'M' + pt(b1) + ' L' + pt(tip) + ' L' + pt(b2);
  }

  function flameRay(cx, cy, aDeg, rBase, rTip, halfW, sway) {
    var tip = polar(cx, cy, rTip, aDeg + sway);
    var b1 = polar(cx, cy, rBase, aDeg - halfW);
    var b2 = polar(cx, cy, rBase, aDeg + halfW);
    var m1 = polar(cx, cy, (rBase + rTip) * 0.55, aDeg - halfW * 2.1);
    var m2 = polar(cx, cy, (rBase + rTip) * 0.55, aDeg + halfW * 2.1);
    return 'M' + pt(b1) + ' Q' + pt(m1) + ' ' + pt(tip) + ' Q' + pt(m2) + ' ' + pt(b2);
  }

  /* short curved hatch strokes hugging the rim — engraved shading */
  function rimHatch(r, fromDeg, toDeg, n, inset) {
    var d = '';
    for (var i = 0; i < n; i++) {
      var a0 = fromDeg + (toDeg - fromDeg) * (i / (n - 1));
      var p0 = polar(60, 62, r - inset, a0 - 7);
      var p1 = polar(60, 62, r - inset, a0 + 7);
      var mid = polar(60, 62, r - inset + 2.2, a0);
      d += 'M' + pt(p0) + ' Q' + pt(mid) + ' ' + pt(p1) + ' ';
    }
    return d;
  }

  /* the serene face all the suns share; dy shifts it for horizon suns */
  function faceArt(dy) {
    var y = dy || 0;
    return '<path class="sunart-ln" d="M49 ' + (54 + y) + ' q 5 -3.4 9 0"/>' +
      '<path class="sunart-ln" d="M62 ' + (54 + y) + ' q 4 -3.4 9 0"/>' +
      '<path class="sunart-ln" d="M49.5 ' + (59 + y) + ' q 4.2 2.6 8.4 0"/>' +
      '<path class="sunart-ln" d="M62.1 ' + (59 + y) + ' q 4.2 2.6 8.4 0"/>' +
      '<path class="sunart-ln" d="M59.6 ' + (60 + y) + ' q -2.4 5.4 1.6 6.4"/>' +
      '<path class="sunart-ln" d="M54.5 ' + (70 + y) + ' q 5.5 3.6 11 0"/>' +
      '<path class="sunart-lnf" d="M53.4 ' + (69.4 + y) + ' l 1.4 1.1"/>' +
      '<path class="sunart-lnf" d="M66.6 ' + (69.4 + y) + ' l -1.4 1.1"/>' +
      '<path class="sunart-lnf" d="M45 ' + (66 + y) + ' q 2 2.4 4.6 2.8"/>' +
      '<path class="sunart-lnf" d="M46 ' + (69.4 + y) + ' q 1.6 1.8 3.6 2.1"/>' +
      '<path class="sunart-lnf" d="M70.4 ' + (68.8 + y) + ' q 2.4 0.8 4.6 -0.4"/>' +
      '<path class="sunart-lnf" d="M70.4 ' + (71.5 + y) + ' q 2 0.6 3.6 -0.5"/>';
  }

  function starArt(cx, cy, r) {
    var k = r * 0.22;
    return '<path class="sunart-star" d="M' + cx + ' ' + (cy - r) +
      ' Q' + (cx + k) + ' ' + (cy - k) + ' ' + (cx + r) + ' ' + cy +
      ' Q' + (cx + k) + ' ' + (cy + k) + ' ' + cx + ' ' + (cy + r) +
      ' Q' + (cx - k) + ' ' + (cy + k) + ' ' + (cx - r) + ' ' + cy +
      ' Q' + (cx - k) + ' ' + (cy - k) + ' ' + cx + ' ' + (cy - r) + ' Z"/>';
  }

  /* full sun, for the middle of the day */
  function daySunArt(seed) {
    var R = rng(seed);
    var nPairs = R() < 0.5 ? 8 : 6;
    var phase = R() * 360 / nPairs;
    var rays = '';
    for (var i = 0; i < nPairs; i++) {
      var aS = phase + i * (360 / nPairs);
      var aF = aS + 180 / nPairs;
      rays += '<path class="sunart-ray" d="' + spikeRay(60, 62, aS, 30, 50 + R() * 3, 4.5) + '"/>';
      rays += '<path class="sunart-rayw" d="' + flameRay(60, 62, aF, 30, 44 + R() * 4, 3.2, (R() - 0.5) * 6) + '"/>';
    }
    return '<g>' + rays + '</g>' +
      '<circle class="sunart-disc" cx="60" cy="62" r="26"/>' +
      '<circle class="sunart-ring" cx="60" cy="62" r="22.5"/>' +
      '<path class="sunart-lnf" d="' + rimHatch(26, 120, 220, 9, 3.4) + '"/>' +
      '<path class="sunart-lnf" d="' + rimHatch(26, 300, 350, 4, 3.4) + '"/>' +
      faceArt(0);
  }

  /* crescent moon with a sleeping face, for night */
  function moonArt(seed) {
    var R = rng(seed);
    var stars = '';
    var fields = [
      [[92, 26, 3.6], [30, 24, 2.6], [98, 62, 2.2], [22, 78, 3]],
      [[26, 30, 3.6], [94, 34, 2.6], [88, 78, 3], [20, 58, 2.2]],
      [[90, 22, 3], [24, 40, 3.4], [98, 50, 2.2], [30, 88, 2.6]]
    ];
    var f = fields[Math.floor(R() * fields.length)];
    for (var i = 0; i < f.length; i++) stars += starArt(f[i][0], f[i][1], f[i][2]);
    stars += '<circle class="sunart-dot" cx="' + (18 + R() * 20).toFixed(0) + '" cy="' + (18 + R() * 12).toFixed(0) + '" r="1"/>';
    stars += '<circle class="sunart-dot" cx="' + (84 + R() * 20).toFixed(0) + '" cy="' + (86 + R() * 10).toFixed(0) + '" r="1"/>';

    var hatch = '';
    for (var h = 0; h < 8; h++) {
      var a0 = 210 + h * 17;
      var p0 = polar(60, 62, 25.4, a0 - 6);
      var p1 = polar(60, 62, 25.4, a0 + 6);
      var mid = polar(60, 62, 27.2, a0);
      hatch += 'M' + pt(p0) + ' Q' + pt(mid) + ' ' + pt(p1) + ' ';
    }

    return stars +
      '<path class="sunart-disc" d="M 66 36 A 28 28 0 1 0 66 88 A 34 34 0 0 1 66 36 Z"/>' +
      '<path class="sunart-lnf" d="' + hatch + '"/>' +
      '<path class="sunart-ln" d="M40 51 q 4.6 -2.6 8 -0.6"/>' +
      '<path class="sunart-ln" d="M41 56.5 q 3.4 2.2 6.6 0"/>' +
      '<path class="sunart-ln" d="M46.2 60.5 q -2 4.2 1.3 5.2"/>' +
      '<path class="sunart-ln" d="M42 70.5 q 3.6 2.6 7.2 0.4"/>' +
      '<path class="sunart-lnf" d="M36.2 62.5 q 1.5 2 3.6 2.3"/>' +
      '<path class="sunart-lnf" d="M36.8 65.8 q 1.2 1.5 2.8 1.7"/>';
  }

  /* Continuous scene state. Color and position are interpolated from
     the real sunrise/sunset instants instead of swapping four drawings. */
  var SKY = {
    dawn:  { top: '#68759b', bottom: '#f3ae7d', ink: '#824633', ink2: '#a95f46', warm: '#ffd184' },
    noon:  { top: '#69afe0', bottom: '#d9eef5', ink: '#79431f', ink2: '#a9612f', warm: '#f7bc4c' },
    dusk:  { top: '#574e7a', bottom: '#ed876d', ink: '#713748', ink2: '#9f5360', warm: '#ff9a72' },
    night: { top: '#111a35', bottom: '#3b4968', ink: '#bdd9df', ink2: '#8db6c0', warm: '#d7edf1' }
  };

  function mixColor(a, b, t) {
    function rgb(hex) {
      var n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var x = rgb(a), y = rgb(b);
    var out = x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); });
    return '#' + out.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  function mixSky(a, b, t) {
    var out = {};
    Object.keys(a).forEach(function (key) { out[key] = mixColor(a[key], b[key], t); });
    return out;
  }

  function sceneState(now) {
    var forced = param('sunart');
    var rise = sun.riseToday, set = sun.setToday;
    var dayP = clamp((now - rise) / (set - rise), 0, 1);
    var nightStart = now < rise ? set - 86400 : set;
    var nightEnd = now < rise ? rise : sun.riseTomorrow;
    var nightP = clamp((now - nightStart) / (nightEnd - nightStart), 0, 1);
    var twilight = 40 * 60;
    var sunOpacity = clamp(Math.min(
      (now - rise + twilight) / (2 * twilight),
      (set + twilight - now) / (2 * twilight)
    ), 0, 1);
    var colors;

    if (forced === 'sunrise') {
      dayP = 0; nightP = 1; sunOpacity = 0.5; colors = SKY.dawn;
    } else if (forced === 'day') {
      dayP = 0.5; sunOpacity = 1; colors = SKY.noon;
    } else if (forced === 'sunset') {
      dayP = 1; nightP = 0; sunOpacity = 0.5; colors = SKY.dusk;
    } else if (forced === 'night') {
      nightP = 0.5; sunOpacity = 0; colors = SKY.night;
    } else if (now >= rise && now <= set) {
      colors = dayP < 0.5
        ? mixSky(SKY.dawn, SKY.noon, dayP * 2)
        : mixSky(SKY.noon, SKY.dusk, (dayP - 0.5) * 2);
    } else {
      colors = nightP < 0.5
        ? mixSky(SKY.dusk, SKY.night, nightP * 2)
        : mixSky(SKY.night, SKY.dawn, (nightP - 0.5) * 2);
    }

    return {
      dayP: dayP,
      nightP: nightP,
      sunOpacity: sunOpacity,
      moonOpacity: 1 - sunOpacity,
      colors: colors
    };
  }

  function ensureScene() {
    if (els.scene || !els.art) return;
    sceneSeed = sceneSeed == null ? pickSeed() : sceneSeed;
    els.art.innerHTML =
      '<svg class="sunart-svg sunart-scene" viewBox="0 0 120 124" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
        '<defs><linearGradient id="sunart-sky" x1="0" y1="0" x2="0" y2="1">' +
          '<stop id="sunart-sky-top" offset="0"/><stop id="sunart-sky-bottom" offset="1"/>' +
        '</linearGradient><clipPath id="sunart-scene-clip"><rect x="4" y="4" width="112" height="116" rx="56"/></clipPath></defs>' +
        '<g clip-path="url(#sunart-scene-clip)">' +
          '<rect class="sunart-sky" x="4" y="4" width="112" height="116" fill="url(#sunart-sky)"/>' +
          '<circle class="sunart-glow" id="sunart-glow" cx="60" cy="88" r="43"/>' +
          '<g class="sunart-body" id="sunart-moon">' + moonArt(sceneSeed + 17) + '</g>' +
          '<g class="sunart-body" id="sunart-sun">' + daySunArt(sceneSeed) + '</g>' +
          '<path class="sunart-ridge sunart-ridge-far" d="M0 100 L18 83 31 94 48 77 67 96 84 81 103 94 120 78 120 124 0 124Z"/>' +
          '<path class="sunart-ridge" d="M0 108 L20 96 35 104 54 89 70 105 91 93 120 106 120 124 0 124Z"/>' +
        '</g><circle class="sunart-scene-ring" cx="60" cy="62" r="57.5"/>' +
      '</svg>';
    els.scene = els.art.querySelector('.sunart-scene');
    els.sunBody = document.getElementById('sunart-sun');
    els.moonBody = document.getElementById('sunart-moon');
    els.skyTop = document.getElementById('sunart-sky-top');
    els.skyBottom = document.getElementById('sunart-sky-bottom');
    els.glow = document.getElementById('sunart-glow');
  }

  function drawArt(now) {
    ensureScene();
    if (!els.scene) return;
    var s = sceneState(now);
    var sunX = 18 + 84 * s.dayP;
    var sunY = 91 - 58 * Math.sin(Math.PI * s.dayP);
    var moonX = 18 + 84 * s.nightP;
    var moonY = 91 - 48 * Math.sin(Math.PI * s.nightP);

    els.sunBody.style.transform = 'translate(' + (sunX - 60).toFixed(2) + 'px,' +
      (sunY - 62).toFixed(2) + 'px) scale(.42)';
    els.moonBody.style.transform = 'translate(' + (moonX - 60).toFixed(2) + 'px,' +
      (moonY - 62).toFixed(2) + 'px) scale(.42)';
    els.sunBody.style.opacity = s.sunOpacity.toFixed(3);
    els.moonBody.style.opacity = s.moonOpacity.toFixed(3);
    els.skyTop.style.stopColor = s.colors.top;
    els.skyBottom.style.stopColor = s.colors.bottom;
    els.glow.style.opacity = (0.08 + 0.34 * s.sunOpacity).toFixed(3);
    els.scene.style.setProperty('--sunart-ink', s.colors.ink);
    els.scene.style.setProperty('--sunart-ink2', s.colors.ink2);
    els.scene.style.setProperty('--sunart-warm', s.colors.warm);
    els.wrap.className = 'sun-arc' + (s.sunOpacity < 0.5 ? ' is-night' : '');
  }
  /* ================= data + clock plumbing ================= */

  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    return s + 's';
  }

  function fmtClock(ts) {
    return new Date(ts * 1000).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
    });
  }

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&]+)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function fromApi(data) {
    var d = data && data.daily;
    if (!d || !d.sunrise || !d.sunset) throw new Error('bad payload');
    return {
      riseToday: d.sunrise[0],
      setToday: d.sunset[0],
      riseTomorrow: d.sunrise[1] != null ? d.sunrise[1] : d.sunrise[0] + 86400
    };
  }

  function fromWeather(data) {
    var d = data && data.sun;
    if (!d || !d.sunrise || !d.sunset || !d.sunrise_tomorrow) throw new Error('bad payload');
    return {
      riseToday: new Date(d.sunrise).getTime() / 1000,
      setToday: new Date(d.sunset).getTime() / 1000,
      riseTomorrow: new Date(d.sunrise_tomorrow).getTime() / 1000
    };
  }

  function btvDateKey(ts) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(ts * 1000));
  }

  function isCurrentSun(sunObj) {
    var now = Date.now() / 1000;
    return sunObj &&
      Number.isFinite(sunObj.riseToday) &&
      Number.isFinite(sunObj.setToday) &&
      Number.isFinite(sunObj.riseTomorrow) &&
      sunObj.riseToday < sunObj.setToday &&
      sunObj.setToday < sunObj.riseTomorrow &&
      sunObj.riseTomorrow > now &&
      btvDateKey(sunObj.riseToday) === btvDateKey(now);
  }

  function fetchCurrentSun() {
    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + LAT + '&longitude=' + LON
      + '&daily=sunrise,sunset&timezone=America%2FNew_York&timeformat=unixtime&forecast_days=2';
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { start(fromApi(data)); })
      .catch(function () { /* stay hidden on failure */ });
  }

  function startWeatherSun(data) {
    try {
      var weatherSun = fromWeather(data);
      if (!isCurrentSun(weatherSun)) throw new Error('stale payload');
      start(weatherSun);
    } catch (e) {
      fetchCurrentSun();
    }
  }

  function synth(sf) {
    var now = Date.now() / 1000;
    if (sf === 'night') {
      // Sun already set an hour ago; next sunrise ~9h out.
      return { riseToday: now - DAY_SECONDS, setToday: now - 3600,
               riseTomorrow: now + 9 * 3600 };
    }
    var f = Math.max(0, Math.min(1, parseFloat(sf) || 0.5));
    return { riseToday: now - f * DAY_SECONDS,
             setToday: now + (1 - f) * DAY_SECONDS, riseTomorrow: now + (1 - f) * DAY_SECONDS + 10 * 3600 };
  }

  function render() {
    var c = document.getElementById('sun-arc');
    if (!c) return;

    c.innerHTML =
      '<a class="sun-arc-inner" href="sunset.html" aria-label="Open the full sunset tracker">' +
        '<div class="sun-end sun-end-rise">' +
          '<span class="sun-end-time" id="sun-rise-time"></span>' +
          '<span class="sun-end-label">Sunrise</span>' +
        '</div>' +
        '<div class="sunart-medallion" id="sun-art"></div>' +
        '<div class="sun-end sun-end-set">' +
          '<span class="sun-end-time" id="sun-set-time"></span>' +
          '<span class="sun-end-label">Sunset</span>' +
        '</div>' +
        '<div class="sun-countdown">' +
          '<span class="sun-count-num" id="sun-count-num">—</span>' +
          '<span class="sun-count-label" id="sun-count-label"></span>' +
        '</div>' +
        '<span class="sun-tracker-cta">See the full sunset tracker <span aria-hidden="true">→</span></span>' +
      '</a>';

    els = {
      wrap: c,
      art: document.getElementById('sun-art'),
      num: document.getElementById('sun-count-num'),
      label: document.getElementById('sun-count-label'),
      rise: document.getElementById('sun-rise-time'),
      set: document.getElementById('sun-set-time')
    };
    els.rise.textContent = fmtClock(sun.riseToday);
    els.set.textContent = fmtClock(sun.setToday);
    c.hidden = false;
    tick();
  }

  function tick() {
    if (!sun || !els.num) return;
    var now = Date.now() / 1000;
    var rise = sun.riseToday, set = sun.setToday;
    var secLeft, label;

    if (now >= rise && now <= set) {
      secLeft = set - now;
      label = 'until sunset';
    } else if (now < rise) {
      secLeft = rise - now;
      label = 'until sunrise';
    } else {
      secLeft = sun.riseTomorrow - now;
      label = 'until sunrise';
    }

    els.num.textContent = fmtDur(secLeft);
    els.label.textContent = label;
    drawArt(now);
  }

  function start(sunObj) {
    sun = sunObj;
    render();
    timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { tick(); timer = setInterval(tick, 1000); }
    });
  }

  function init() {
    var sf = param('sunf');
    if (sf != null) { start(synth(sf)); return; }

    // weather.html already loaded these exact times with its forecast. Reuse
    // current data, but bypass a stale Pages deployment with the live API.
    if (document.getElementById('rn-page')) {
      if (window.btownWeatherData) {
        startWeatherSun(window.btownWeatherData);
      } else {
        window.addEventListener('btown:weather-data', function (e) {
          startWeatherSun(e.detail);
        }, { once: true });
      }
      return;
    }

    fetchCurrentSun();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
