/* ============================================================
   THINGS TO DO IN BURLINGTON — sun.js
   A live daylight arc: sunrise on the left, sunset on the right,
   the sun riding a gradient arc between them, and a countdown of
   how much daylight is left (ticking to the second in the final
   hour). Data from Open-Meteo (no key). Absolute UTC timestamps
   are used for all math, so it's correct from any timezone.

   Test hook: ?sunf=0.7 forces a daytime fraction (0=sunrise,
   1=sunset); ?sunf=night forces a nighttime state.
============================================================ */

(function () {
  'use strict';

  var LAT = 44.4759, LON = -73.2121;
  var DAY_SECONDS = 14 * 3600; // synthetic day length for the test hook

  // Arc geometry (SVG user units)
  var G = { W: 320, H: 104, padX: 18, horizonY: 78, amp: 58 };

  var sun = null;   // { offset, riseToday, setToday, riseTomorrow }
  var els = {};     // cached DOM refs updated on each tick
  var timer = null;

  function ax(f) { return G.padX + f * (G.W - 2 * G.padX); }
  function ay(f) {
    var c = Math.max(0, Math.min(1, f));
    return G.horizonY - Math.sin(c * Math.PI) * G.amp;
  }

  function arcPath(f0, f1) {
    var n = 60, pts = [];
    for (var i = 0; i <= n; i++) {
      var f = f0 + (f1 - f0) * (i / n);
      pts.push((i ? 'L' : 'M') + ax(f).toFixed(1) + ' ' + ay(f).toFixed(1));
    }
    return pts.join(' ');
  }

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
        '<div class="sun-arc-graphic">' +
          '<svg class="sun-arc-svg" viewBox="0 0 ' + G.W + ' ' + G.H + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
            '<defs>' +
              '<linearGradient id="sunArcGrad" x1="0" y1="0" x2="1" y2="0">' +
                '<stop offset="0" stop-color="#F2683C"/>' +
                '<stop offset="0.5" stop-color="#F5B44A"/>' +
                '<stop offset="1" stop-color="#2E7D8A"/>' +
              '</linearGradient>' +
              '<radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">' +
                '<stop offset="0" stop-color="#FDBE5E" stop-opacity="0.9"/>' +
                '<stop offset="1" stop-color="#FDBE5E" stop-opacity="0"/>' +
              '</radialGradient>' +
            '</defs>' +
            '<line class="sun-horizon" x1="' + G.padX + '" y1="' + G.horizonY + '" x2="' + (G.W - G.padX) + '" y2="' + G.horizonY + '"/>' +
            '<path class="sun-arc-track" d="' + arcPath(0, 1) + '"/>' +
            '<path class="sun-arc-elapsed" id="sun-elapsed" d=""/>' +
            '<g id="sun-marker">' +
              '<circle class="sun-marker-glow" r="13" fill="url(#sunGlow)"/>' +
              '<circle class="sun-marker-core" r="6"/>' +
            '</g>' +
          '</svg>' +
        '</div>' +
        '<div class="sun-end sun-end-set">' +
          '<span class="sun-end-time" id="sun-set-time"></span>' +
          '<span class="sun-end-label">Sunset</span>' +
        '</div>' +
        '<div class="sun-countdown">' +
          '<span class="sun-count-num" id="sun-count-num">—</span>' +
          '<span class="sun-count-label" id="sun-count-label"></span>' +
        '</div>' +
      '</div>';

    els = {
      wrap: c,
      elapsed: document.getElementById('sun-elapsed'),
      marker: document.getElementById('sun-marker'),
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
    if (!sun || !els.marker) return;
    var now = Date.now() / 1000;
    var rise = sun.riseToday, set = sun.setToday;
    var isDay = now >= rise && now <= set;
    var f, secLeft, label;

    if (isDay) {
      f = (now - rise) / (set - rise);
      secLeft = set - now;
      label = 'until sunset';
    } else if (now < rise) {
      f = 0;
      secLeft = rise - now;
      label = 'until sunrise';
    } else {
      f = 1;
      secLeft = sun.riseTomorrow - now;
      label = 'until sunrise';
    }

    var mf = Math.max(0, Math.min(1, f));
    els.marker.setAttribute('transform', 'translate(' + ax(mf).toFixed(1) + ' ' + ay(mf).toFixed(1) + ')');
    els.elapsed.setAttribute('d', isDay ? arcPath(0, mf) : '');
    els.num.textContent = fmtDur(secLeft);
    els.label.textContent = label;
    els.wrap.classList.toggle('is-night', !isDay);
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
