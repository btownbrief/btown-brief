/* ============================================================
   THINGS TO DO IN BURLINGTON — sun.js
   The daylight widget: sunrise on the left, sunset on the right,
   a hand-etched almanac medallion in the middle (sun-with-face by
   day, crescent moon by night, horizon suns at dawn and dusk), and
   a countdown of the daylight left. The whole strip links to the
   sunset tracker page. Data from Open-Meteo (no key). Absolute UTC
   timestamps are used for all math, so it's correct from any
   timezone.

   The art is drawn fresh each page load from a random seed —
   ray angles, star fields and water strokes shift a little every
   visit, like a new pull of the same engraving plate.

   Test hooks: ?sunf=0.7 forces a daytime fraction (0=sunrise,
   1=sunset); ?sunf=night forces night; ?sunart=sunrise|day|sunset|night
   forces a specific medallion.
============================================================ */

(function () {
  'use strict';

  var LAT = 44.4759, LON = -73.2121;
  var DAY_SECONDS = 14 * 3600; // synthetic day length for the test hook
  var EDGE = 40 * 60;          // ± window (sec) that counts as sunrise/sunset

  var sun = null;   // { offset, riseToday, setToday, riseTomorrow }
  var els = {};     // cached DOM refs updated on each tick
  var timer = null;
  var artState = ''; // which medallion is currently drawn

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

  /* sun on the horizon — rising (warm, eager) or setting (deeper, softer) */
  function horizonSunArt(seed, setting) {
    var R = rng(seed);
    var HY = 76;
    var cy = HY + (setting ? 13 : 8);
    var rays = '';
    var nRays = setting ? 5 : 7;
    var spread = setting ? 96 : 128;
    for (var i = 0; i < nRays; i++) {
      var a = -spread / 2 + spread * (i / (nRays - 1)) + (R() - 0.5) * 6;
      var alt = i % 2 === 0;
      var tipR = alt ? (50 + R() * 4) : (41 + R() * 3);
      if (setting) tipR -= 5;
      var tip = polar(60, cy, tipR, a);
      if (tip[1] > HY - 2) continue; // rays stay above the waterline
      rays += alt
        ? '<path class="sunart-ray" d="' + spikeRay(60, cy, a, 30, tipR, 4.2) + '"/>'
        : '<path class="sunart-rayw" d="' + flameRay(60, cy, a, 30, tipR, 3, (R() - 0.5) * 5) + '"/>';
    }
    /* engraved lake: rows of horizontal strokes below the horizon */
    var water = '';
    for (var r2 = 0; r2 < 5; r2++) {
      var y = HY + 5 + r2 * 7 + R() * 2;
      var n = 4 - (r2 > 2 ? 1 : 0);
      for (var k = 0; k < n; k++) {
        var x0 = 12 + R() * 88;
        var len = 9 + R() * 17;
        if (x0 + len > 110) len = 110 - x0;
        water += '<path class="sunart-lnf" d="M' + x0.toFixed(0) + ' ' + y.toFixed(1) + ' h ' + len.toFixed(0) + '"/>';
      }
    }
    var extra = setting
      ? starArt(94, 24, 4) + starArt(26, 32, 2.6)
      : '<path class="sunart-lnf" d="M22 30 q 3 -3 6 0 q 3 -3 6 0"/>' +
        '<path class="sunart-lnf" d="M88 22 q 2.4 -2.4 4.8 0 q 2.4 -2.4 4.8 0"/>';
    var clip = 'sunartHorizon' + (setting ? 'S' : 'R');
    return '<g>' + rays + '</g>' +
      '<clipPath id="' + clip + '"><rect x="0" y="0" width="120" height="' + HY + '"/></clipPath>' +
      '<g clip-path="url(#' + clip + ')">' +
        '<circle class="sunart-disc" cx="60" cy="' + cy + '" r="26"/>' +
        '<circle class="sunart-ring" cx="60" cy="' + cy + '" r="22.5"/>' +
        faceArt(cy - 68) +
      '</g>' +
      '<path class="sunart-hor" d="M8 ' + HY + ' H 112"/>' +
      water + extra;
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

  /* which medallion fits this moment */
  function artFor(now) {
    var forced = param('sunart');
    if (forced) return forced;
    if (Math.abs(now - sun.riseToday) <= EDGE) return 'sunrise';
    if (Math.abs(now - sun.setToday) <= EDGE) return 'sunset';
    if (now > sun.riseToday && now < sun.setToday) return 'day';
    return 'night';
  }

  function drawArt(state) {
    if (state === artState || !els.art) return;
    artState = state;
    var seed = pickSeed();
    var inner;
    if (state === 'sunrise') inner = horizonSunArt(seed, false);
    else if (state === 'sunset') inner = horizonSunArt(seed, true);
    else if (state === 'night') inner = moonArt(seed);
    else inner = daySunArt(seed);
    els.art.innerHTML =
      '<svg class="sunart-svg" viewBox="0 0 120 124" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      inner + '</svg>';
    els.wrap.className = 'sun-arc sunart-' + state + (state === 'night' ? ' is-night' : '');
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
    // Shift by Burlington's UTC offset, then read UTC fields → local clock.
    var d = new Date((ts + sun.offset) * 1000);
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&]+)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function fromApi(data) {
    var d = data && data.daily;
    if (!d || !d.sunrise || !d.sunset) throw new Error('bad payload');
    return {
      offset: data.utc_offset_seconds || 0,
      riseToday: d.sunrise[0],
      setToday: d.sunset[0],
      riseTomorrow: d.sunrise[1] != null ? d.sunrise[1] : d.sunrise[0] + 86400
    };
  }

  function synth(sf) {
    var now = Date.now() / 1000;
    var offset = -4 * 3600; // EDT, for the test hook only
    if (sf === 'night') {
      // Sun already set an hour ago; next sunrise ~9h out.
      return { offset: offset, riseToday: now - DAY_SECONDS, setToday: now - 3600,
               riseTomorrow: now + 9 * 3600 };
    }
    var f = Math.max(0, Math.min(1, parseFloat(sf) || 0.5));
    return { offset: offset, riseToday: now - f * DAY_SECONDS,
             setToday: now + (1 - f) * DAY_SECONDS, riseTomorrow: now + (1 - f) * DAY_SECONDS + 10 * 3600 };
  }

  function render() {
    var c = document.getElementById('sun-arc');
    if (!c) return;

    c.innerHTML =
      '<div class="sun-arc-inner">' +
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
      '</div>';

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
    drawArt(artFor(now));
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

    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + LAT + '&longitude=' + LON
      + '&daily=sunrise,sunset&timezone=America%2FNew_York&timeformat=unixtime&forecast_days=2';
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { start(fromApi(data)); })
      .catch(function () { /* stay hidden on failure */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
