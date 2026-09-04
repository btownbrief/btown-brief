/* ============================================================
   BTOWN BRIEF — sun.js
   The daylight scene: a living Lake Champlain panorama.

   You are standing on the Burlington waterfront looking west
   over the lake at the Adirondacks. The sky follows the day's
   real light — pre-dawn, sunrise, midday Champlain blue, golden
   hour, the sunset, twilight, night with stars and a moon in its
   actual phase. The sun rides a real arc from the north end of
   the ridge to the south; the moon takes its own arc at night.

   When the page hands us live conditions (weather.html sets
   window.btownWeatherData; things-to-do gets them from
   js/weather.js via window.btownNowWeather) the scene answers:
   cloud cover raises cloud decks, rain draws streaks, snow
   drifts flakes, fog lowers a band over the water, and the wind
   sets how fast the decks drift and how much chop is on the lake.

   Sunrise sits bottom-left, sunset bottom-right, the countdown
   between them, and the whole card links to the sunset tracker.
   Absolute UTC timestamps drive all the math, so it is correct
   from any timezone.

   Test hooks: ?sunf=0.7 forces a daytime fraction (0=sunrise,
   1=sunset); ?sunf=night forces night; ?sunart=sunrise|day|
   sunset|night forces a scene state; ?sunwx=rain|snow|fog|
   overcast|clear forces the weather layer.
============================================================ */

(function () {
  'use strict';

  var LAT = 44.4759, LON = -73.2121;
  var DAY_SECONDS = 14 * 3600; // synthetic day length for the test hook

  /* Scene geometry. The SVG is drawn in this box and cropped
     (xMidYMid slice) to whatever aspect the card happens to be. */
  var W = 1200, H = 520;
  var HORIZON = 336;          // where the far shore meets the water
  var ARC_LEFT = 96, ARC_RIGHT = 1104;
  var ARC_TOP = 170;          // apex of the noon arc — low enough to clear the desktop crop (xMidYMid slice at 3.3:1 and 4.4:1)
  var ARC_BASE = 296;         // where the arc meets the far ridge

  var sun = null;   // { riseToday, setToday, riseTomorrow }
  var els = {};     // cached DOM refs updated on each tick
  var timer = null;
  var wx = null;    // { cloud 0..1, precip null|'rain'|'snow', fog 0..1, wind mph }
  var built = false;

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&]+)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* Deterministic-per-load noise: the star field and cloud shapes
     are laid out once at build time, never re-randomised on a tick. */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ================= palette =================
     Colour families borrowed from the hub's living cover so the
     two properties read as one hand: dawn peach over slate blue,
     Champlain blue at noon, coral/tangerine at golden hour, a
     violet dusk, and a deep indigo night. */
  var PAL = {
    night: {
      skyTop: '#040a1c', skyMid: '#0a1633', skyBot: '#16294c',
      ridgeFar: '#22375c', ridgeMid: '#14243f', ridgeNear: '#080f1e',
      waterTop: '#152a48', waterBot: '#050b17',
      glow: '#94b0d8', haze: '#1d3157', ink: '#dfe9ff', star: 1
    },
    dawn: {
      skyTop: '#2b3d68', skyMid: '#7d7aa4', skyBot: '#f0b088',
      ridgeFar: '#6f7396', ridgeMid: '#494c72', ridgeNear: '#262a45',
      waterTop: '#5b5f85', waterBot: '#1d2340',
      glow: '#ffcf9b', haze: '#8a86a8', ink: '#ffeede', star: 0.35
    },
    sunrise: {
      skyTop: '#4a6ea8', skyMid: '#b58c99', skyBot: '#ffc48a',
      ridgeFar: '#8c8bab', ridgeMid: '#5c5c7f', ridgeNear: '#2e2f4b',
      waterTop: '#7f7fa2', waterBot: '#2b3050',
      glow: '#ffd7a1', haze: '#a89fb8', ink: '#fff3e4', star: 0.12
    },
    day: {
      skyTop: '#2f74c0', skyMid: '#6fa8de', skyBot: '#c6e2f2',
      ridgeFar: '#8fb0c9', ridgeMid: '#5f83a3', ridgeNear: '#33536f',
      waterTop: '#5b93bd', waterBot: '#1f4a70',
      glow: '#fff3cf', haze: '#bcd6e6', ink: '#ffffff', star: 0
    },
    golden: {
      skyTop: '#3f74b4', skyMid: '#9db6d2', skyBot: '#ffce93',
      ridgeFar: '#93a0b4', ridgeMid: '#5f6a84', ridgeNear: '#333b52',
      waterTop: '#7d90ad', waterBot: '#2c3a55',
      glow: '#ffd28a', haze: '#c3c6cf', ink: '#fff4e2', star: 0
    },
    sunset: {
      skyTop: '#42477f', skyMid: '#b06a8d', skyBot: '#ff9a5e',
      ridgeFar: '#8a6f8e', ridgeMid: '#5b4767', ridgeNear: '#2c2340',
      waterTop: '#8a6079', waterBot: '#2a2244',
      glow: '#ffb06a', haze: '#a3789a', ink: '#ffeadb', star: 0.05
    },
    dusk: {
      skyTop: '#161f48', skyMid: '#4b3f74', skyBot: '#c4707a',
      ridgeFar: '#5a4d78', ridgeMid: '#342d52', ridgeNear: '#161431',
      waterTop: '#4a3f66', waterBot: '#120f26',
      glow: '#ff9d84', haze: '#5c5080', ink: '#ffe3dc', star: 0.55
    }
  };

  /* the flat pewter light of an overcast Champlain Valley day */
  var GLOOM = {
    skyTop: '#6d7c8c', skyMid: '#8d9aa7', skyBot: '#b3bcc4',
    ridgeFar: '#93a0aa', ridgeMid: '#6f7d89', ridgeNear: '#41505c',
    waterTop: '#6d7f8c', waterBot: '#2f3d48',
    glow: '#d5dde3', haze: '#aab5bd', ink: '#eef3f7', star: 0
  };

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixColor(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return '#' + x.map(function (v, i) {
      return Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0');
    }).join('');
  }
  function mixPal(a, b, t) {
    var out = {};
    Object.keys(a).forEach(function (k) {
      out[k] = typeof a[k] === 'number'
        ? a[k] + (b[k] - a[k]) * t
        : mixColor(a[k], b[k], t);
    });
    return out;
  }

  /* Keyframes along one continuous clock. u runs 0→1 across the
     day (sunrise→sunset) and again 0→1 across the night. */
  function keyframe(stops, u) {
    for (var i = 0; i < stops.length - 1; i++) {
      if (u <= stops[i + 1][0]) {
        var a = stops[i], b = stops[i + 1];
        var t = (u - a[0]) / (b[0] - a[0] || 1);
        return mixPal(a[1], b[1], clamp(t, 0, 1));
      }
    }
    return stops[stops.length - 1][1];
  }

  var DAY_STOPS = [
    [0.00, PAL.sunrise], [0.10, PAL.golden], [0.22, PAL.day],
    [0.76, PAL.day], [0.90, PAL.golden], [1.00, PAL.sunset]
  ];
  var NIGHT_STOPS = [
    [0.00, PAL.sunset], [0.10, PAL.dusk], [0.28, PAL.night],
    [0.74, PAL.night], [0.90, PAL.dawn], [1.00, PAL.sunrise]
  ];

  /* ================= moon phase =================
     Simple synodic count from a known new moon. Good to a few
     hours, which is plenty for a crescent-versus-gibbous mask. */
  function moonPhase(ts) {
    var SYN = 29.530588853 * 86400;
    var known = 947182440; // 2000-01-06 18:14 UTC, a new moon
    var age = ((ts - known) % SYN + SYN) % SYN;
    var frac = age / SYN;                    // 0 new → 0.5 full → 1 new
    return {
      frac: frac,
      illum: (1 - Math.cos(2 * Math.PI * frac)) / 2,
      waxing: frac < 0.5
    };
  }

  /* ================= scene construction =================
     Everything below is built once. A tick only rewrites colours,
     transforms and opacities — never the node list. */

  /* Three ridge lines, near to far. Real Adirondack profile from
     the waterfront: long low shoulders with a few taller humps
     (Whiteface off to the north, the high peaks due west). */
  function smoothRidge(pts, baseY) {
    var d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i][0] + pts[i + 1][0]) / 2;
      var my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ' Q' + pts[i][0] + ' ' + pts[i][1] + ' ' + mx.toFixed(1) + ' ' + my.toFixed(1);
    }
    var last = pts[pts.length - 1];
    d += ' L' + last[0] + ' ' + last[1];
    return d + ' L' + W + ' ' + baseY + ' L0 ' + baseY + ' Z';
  }

  var BASE = HORIZON + 6;
  /* The Adirondack wall as it actually reads from the waterfront:
     a long low band with a handful of real summits, not a sawtooth. */
  var RIDGE_FAR = smoothRidge([[0, 300], [70, 286], [140, 292], [210, 258], [268, 276],
    [330, 240], [386, 270], [446, 252], [512, 282], [576, 236], [634, 268], [694, 250],
    [752, 274], [812, 244], [872, 272], [932, 254], [996, 280], [1058, 248], [1122, 270],
    [1200, 262]], BASE);
  var RIDGE_MID = smoothRidge([[0, 312], [100, 306], [190, 310], [280, 294], [360, 302],
    [450, 284], [530, 300], [620, 290], [710, 274], [800, 294], [890, 286], [980, 300],
    [1070, 290], [1140, 298], [1200, 302]], BASE);
  var RIDGE_NEAR = smoothRidge([[0, 324], [90, 318], [180, 325], [268, 312], [352, 322],
    [440, 308], [524, 320], [610, 306], [694, 318], [780, 309], [866, 320], [950, 310],
    [1036, 321], [1120, 313], [1200, 322]], BASE);

  function cloudPath(x, y, s) {
    /* one soft cumulus bundle: overlapping lobes with a settled base,
       softened by the blur filter on the deck */
    var out = '';
    var lobes = [[0, -4, 28], [30, 4, 22], [-32, 5, 20], [16, -18, 20], [-16, -12, 17],
                 [54, 9, 14], [-54, 10, 13], [0, 10, 24], [26, 11, 18], [-26, 11, 17]];
    for (var i = 0; i < lobes.length; i++) {
      var r = lobes[i][2] * s;
      var cx = x + lobes[i][0] * s, cy = y + lobes[i][1] * s;
      out += 'M' + (cx - r).toFixed(1) + ' ' + cy.toFixed(1) +
        ' a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 1 ' + (r * 2).toFixed(1) + ' 0' +
        ' a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 1 ' + (-r * 2).toFixed(1) + ' 0 Z';
    }
    return out;
  }

  function cloudDeck(seed, y, scale, count, cls) {
    var R = rng(seed);
    var d = '';
    for (var i = 0; i < count; i++) {
      var x = (i + R() * 0.7) * (W / count) - 60;
      d += cloudPath(x, y + (R() - 0.5) * 40, scale * (0.75 + R() * 0.5));
    }
    /* two copies side by side so the drift loops seamlessly */
    return '<g class="' + cls + '">' +
      '<g class="wx-cloud-run"><path d="' + d + '"/>' +
      '<g transform="translate(' + W + ',0)"><path d="' + d + '"/></g></g></g>';
  }

  function stars(seed) {
    var R = rng(seed), out = '';
    for (var i = 0; i < 90; i++) {
      var x = R() * W;
      var y = R() * (HORIZON - 40);
      /* thin them toward the horizon, the way haze does */
      if (R() < y / (HORIZON * 1.5)) continue;
      var r = 0.8 + R() * 1.6;
      out += '<circle class="wx-star" cx="' + x.toFixed(0) + '" cy="' + y.toFixed(0) +
        '" r="' + r.toFixed(1) + '" style="animation-delay:' + (R() * 6).toFixed(1) +
        's;animation-duration:' + (3 + R() * 4).toFixed(1) + 's"/>';
    }
    return out;
  }

  function rainLines(seed) {
    var R = rng(seed), out = '';
    for (var i = 0; i < 70; i++) {
      var x = (R() * (W + 200) - 100).toFixed(0);
      var len = 14 + R() * 20;
      out += '<line class="wx-drop" x1="' + x + '" y1="0" x2="' + (x - len * 0.34).toFixed(1) +
        '" y2="' + len.toFixed(1) + '" style="animation-delay:' + (-R() * 1.2).toFixed(2) +
        's;animation-duration:' + (0.65 + R() * 0.45).toFixed(2) + 's"/>';
    }
    return out;
  }

  function snowFlakes(seed) {
    var R = rng(seed), out = '';
    for (var i = 0; i < 40; i++) {
      out += '<circle class="wx-flake" cx="' + (R() * W).toFixed(0) + '" cy="-20" r="' +
        (1.4 + R() * 2.2).toFixed(1) + '" style="animation-delay:' + (-R() * 9).toFixed(2) +
        's;animation-duration:' + (7 + R() * 6).toFixed(1) + 's"/>';
    }
    return out;
  }

  function glitter(seed) {
    var R = rng(seed), out = '';
    for (var i = 0; i < 26; i++) {
      var t = i / 25;
      var y = HORIZON + 4 + t * (H - HORIZON - 10);
      var half = 12 + t * t * 150;
      var w = 6 + R() * (10 + t * 46);
      var x = (R() - 0.5) * 2 * half;
      out += '<rect class="wx-glint" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + w.toFixed(1) + '" height="' + (1.2 + t * 2.4).toFixed(1) +
        '" rx="1.2" style="animation-delay:' + (-R() * 4).toFixed(2) +
        's;animation-duration:' + (2.4 + R() * 2.6).toFixed(1) + 's"/>';
    }
    return out;
  }

  function chop(seed) {
    var R = rng(seed), out = '';
    for (var i = 0; i < 22; i++) {
      var t = R();
      var y = HORIZON + 10 + t * (H - HORIZON - 16);
      var w = 40 + t * 220 + R() * 80;
      var x = R() * (W - w);
      out += '<rect class="wx-chop" x="' + x.toFixed(0) + '" y="' + y.toFixed(0) +
        '" width="' + w.toFixed(0) + '" height="' + (1 + t * 1.6).toFixed(1) +
        '" rx="1" style="animation-delay:' + (-R() * 5).toFixed(2) + 's"/>';
    }
    return out;
  }

  /* The breakwater light off the Burlington shore, and one boat
     still out. Silhouettes only — no cuteness. */
  var LIGHTHOUSE =
    '<g class="wx-fg" transform="translate(150,0)">' +
      '<rect x="-170" y="404" width="340" height="7" rx="2" opacity="0.75"/>' +
      '<rect x="-26" y="399" width="52" height="8" rx="2"/>' +
      '<path d="M-8 400 L-6.5 374 h13 l1.5 26 Z"/>' +
      '<rect x="-8.5" y="369" width="17" height="5.5" rx="1.5"/>' +
      '<path d="M-5.5 369 L0 360 L5.5 369 Z"/>' +
    '</g>';
  var SAILBOAT =
    '<g class="wx-fg wx-boat" transform="translate(880,0)">' +
      '<path d="M-11 396 h22 l-4 5 h-14 Z"/>' +
      '<rect x="-0.8" y="368" width="1.6" height="28"/>' +
      '<path d="M1.2 370 L10 395 H1.2 Z"/>' +
      '<path d="M-1.2 374 L-8 395 H-1.2 Z"/>' +
    '</g>';

  function build() {
    if (built || !els.art) return;
    var seed = Math.floor(Date.now() / 86400000) * 7919 + 13; // steady within a day
    els.art.innerHTML =
      '<svg class="wx-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="wx-sky" x1="0" y1="0" x2="0" y2="1">' +
          '<stop id="wx-sky-0" offset="0"/><stop id="wx-sky-1" offset="0.58"/><stop id="wx-sky-2" offset="1"/>' +
        '</linearGradient>' +
        '<linearGradient id="wx-water" x1="0" y1="0" x2="0" y2="1">' +
          '<stop id="wx-water-0" offset="0"/><stop id="wx-water-1" offset="1"/>' +
        '</linearGradient>' +
        '<radialGradient id="wx-halo" cx="0.5" cy="0.5" r="0.5">' +
          '<stop id="wx-halo-0" offset="0" stop-opacity="0.85"/>' +
          '<stop id="wx-halo-1" offset="0.4" stop-opacity="0.32"/>' +
          '<stop id="wx-halo-2" offset="1" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<radialGradient id="wx-horizonglow" cx="0.5" cy="1" r="0.72">' +
          '<stop id="wx-hg-0" offset="0" stop-opacity="0.72"/>' +
          '<stop id="wx-hg-1" offset="1" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<radialGradient id="wx-milky" cx="0.5" cy="0.5" r="0.5">' +
          '<stop offset="0" stop-color="#cdd8ff" stop-opacity="0.20"/>' +
          '<stop offset="1" stop-color="#cdd8ff" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<linearGradient id="wx-fogg" x1="0" y1="0" x2="0" y2="1">' +
          '<stop id="wx-fog-0" offset="0" stop-opacity="0"/>' +
          '<stop id="wx-fog-1" offset="0.45" stop-opacity="0.85"/>' +
          '<stop id="wx-fog-2" offset="1" stop-opacity="0.25"/>' +
        '</linearGradient>' +
        '<filter id="wx-soft" x="-25%" y="-60%" width="150%" height="220%">' +
          '<feGaussianBlur stdDeviation="3.2"/></filter>' +
        '<filter id="wx-haze" x="-10%" y="-40%" width="120%" height="180%">' +
          '<feGaussianBlur stdDeviation="2.2"/></filter>' +
        '<linearGradient id="wx-reflect" x1="0" y1="0" x2="0" y2="1">' +
          '<stop id="wx-refl-0" offset="0" stop-opacity="0.34"/>' +
          '<stop id="wx-refl-1" offset="1" stop-opacity="0"/>' +
        '</linearGradient>' +
        '<radialGradient id="wx-streak" cx="0.5" cy="0.5" r="0.5">' +
          '<stop id="wx-st-0" offset="0" stop-opacity="0.85"/>' +
          '<stop id="wx-st-1" offset="0.45" stop-opacity="0.4"/>' +
          '<stop id="wx-st-2" offset="1" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<linearGradient id="wx-scrimg" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#050b1a" stop-opacity="0"/>' +
          '<stop offset="1" stop-color="#050b1a" stop-opacity="0.46"/>' +
        '</linearGradient>' +
        '<mask id="wx-moon-mask">' +
          '<circle cx="0" cy="0" r="26" fill="#fff"/>' +
          '<rect id="wx-moon-half" x="-26" y="-26" width="26" height="52" fill="#000"/>' +
          '<ellipse id="wx-moon-term" cx="0" cy="0" rx="13" ry="26" fill="#000"/>' +
        '</mask>' +
      '</defs>' +

      '<rect id="wx-skyrect" x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#wx-sky)"/>' +
      '<g id="wx-night" class="wx-night">' +
        '<ellipse id="wx-milkyway" cx="700" cy="120" rx="520" ry="120" fill="url(#wx-milky)" transform="rotate(-18 700 120)"/>' +
        stars(seed) +
      '</g>' +

      '<ellipse id="wx-hglow" cx="600" cy="' + HORIZON + '" rx="620" ry="200" fill="url(#wx-horizonglow)"/>' +

      '<g id="wx-moon" class="wx-body">' +
        '<circle class="wx-moon-halo" cx="0" cy="0" r="70"/>' +
        '<circle class="wx-moon-disc" cx="0" cy="0" r="26" mask="url(#wx-moon-mask)"/>' +
      '</g>' +

      '<g id="wx-sun" class="wx-body">' +
        '<circle id="wx-sunhalo" cx="0" cy="0" r="150" fill="url(#wx-halo)"/>' +
        '<circle id="wx-sundisc" cx="0" cy="0" r="30"/>' +
      '</g>' +

      '<g id="wx-clouds" class="wx-clouds">' +
        cloudDeck(seed + 3, 132, 1.05, 3, 'wx-deck wx-deck-a') +
        cloudDeck(seed + 41, 196, 0.72, 4, 'wx-deck wx-deck-b') +
        cloudDeck(seed + 97, 250, 0.44, 5, 'wx-deck wx-deck-c') +
      '</g>' +

      '<path id="wx-ridge-far" class="wx-ridge" filter="url(#wx-haze)" d="' + RIDGE_FAR + '"/>' +
      '<path id="wx-ridge-mid" class="wx-ridge" d="' + RIDGE_MID + '"/>' +
      '<path id="wx-ridge-near" class="wx-ridge" d="' + RIDGE_NEAR + '"/>' +

      '<ellipse id="wx-ridgeglow" cx="600" cy="' + (HORIZON - 12) + '" rx="380" ry="52" fill="url(#wx-streak)"/>' +
      '<rect id="wx-waterrect" x="0" y="' + HORIZON + '" width="' + W + '" height="' + (H - HORIZON) + '" fill="url(#wx-water)"/>' +
      '<rect id="wx-reflectband" x="0" y="' + HORIZON + '" width="' + W + '" height="150" fill="url(#wx-reflect)"/>' +
      '<g id="wx-glitter" class="wx-glitter">' + glitter(seed + 5) + '</g>' +
      '<g id="wx-chop" class="wx-chopg">' + chop(seed + 61) + '</g>' +

      LIGHTHOUSE + SAILBOAT +

      '<rect id="wx-fogband" x="0" y="' + (HORIZON - 66) + '" width="' + W + '" height="150" fill="url(#wx-fogg)"/>' +

      '<g id="wx-rain" class="wx-rain">' + rainLines(seed + 7) + '</g>' +
      '<g id="wx-snow" class="wx-snow">' + snowFlakes(seed + 11) + '</g>' +
      '<rect class="wx-scrim" x="0" y="' + (H - 200) + '" width="' + W + '" height="200" fill="url(#wx-scrimg)"/>' +
      '</svg>';

    els.svg = els.art.querySelector('.wx-svg');
    ['sky-0', 'sky-1', 'sky-2', 'water-0', 'water-1', 'halo-0', 'halo-1', 'halo-2',
     'hg-0', 'hg-1', 'fog-0', 'fog-1', 'fog-2',
     'refl-0', 'refl-1', 'st-0', 'st-1', 'st-2'].forEach(function (id) {
      els[id] = document.getElementById('wx-' + id);
    });
    els.night = document.getElementById('wx-night');
    els.hglow = document.getElementById('wx-hglow');
    els.ridgeGlow = document.getElementById('wx-ridgeglow');
    els.reflect = document.getElementById('wx-reflectband');
    els.moon = document.getElementById('wx-moon');
    els.moonHalf = document.getElementById('wx-moon-half');
    els.moonTerm = document.getElementById('wx-moon-term');
    els.sunG = document.getElementById('wx-sun');
    els.sunDisc = document.getElementById('wx-sundisc');
    els.sunHalo = document.getElementById('wx-sunhalo');
    els.clouds = document.getElementById('wx-clouds');
    els.ridgeFar = document.getElementById('wx-ridge-far');
    els.ridgeMid = document.getElementById('wx-ridge-mid');
    els.ridgeNear = document.getElementById('wx-ridge-near');
    els.glitterG = document.getElementById('wx-glitter');
    els.chopG = document.getElementById('wx-chop');
    els.fog = document.getElementById('wx-fogband');
    els.rain = document.getElementById('wx-rain');
    els.snow = document.getElementById('wx-snow');
    built = true;
  }

  /* ================= weather layer ================= */

  function skyToCloud(pct) { return clamp((pct || 0) / 100, 0, 1); }

  function readWeather() {
    var forced = param('sunwx');
    if (forced) {
      if (forced === 'rain') return { cloud: 0.92, precip: 'rain', fog: 0, wind: 14 };
      if (forced === 'snow') return { cloud: 0.9, precip: 'snow', fog: 0.15, wind: 8 };
      if (forced === 'fog') return { cloud: 0.55, precip: null, fog: 0.85, wind: 3 };
      if (forced === 'overcast') return { cloud: 1, precip: null, fog: 0.1, wind: 12 };
      return { cloud: 0.12, precip: null, fog: 0, wind: 6 };
    }

    var d = window.btownWeatherData;
    if (d) {
      var now = d.now || {};
      var hrs = (d.hourly && d.hourly.hours) || [];
      var t = Date.now();
      var best = null, bestGap = Infinity;
      for (var i = 0; i < hrs.length; i++) {
        var gap = Math.abs(new Date(hrs[i].t).getTime() - t);
        if (gap < bestGap) { bestGap = gap; best = hrs[i]; }
      }
      var text = ((now.description || '') + ' ' + ((best && best.short) || '')).toLowerCase();
      var cloud = best && typeof best.sky === 'number' ? skyToCloud(best.sky) : textCloud(text);
      return {
        cloud: cloud,
        precip: /snow|flurr|sleet|winter mix|wintry/.test(text) ? 'snow'
          : (/rain|shower|drizzle|storm|thunder/.test(text) && (!best || best.pop >= 30) ? 'rain' : null),
        fog: /fog|mist|haze/.test(text) ? 0.8 : 0,
        wind: now.wind_mph || (best && best.wind_mph) || 6
      };
    }

    var n = window.btownNowWeather; // things-to-do.html, from js/weather.js
    if (n && typeof n.code === 'number') return fromWmo(n.code);
    return null;
  }

  function textCloud(text) {
    if (/overcast|cloudy/.test(text)) return /partly|mostly sunny/.test(text) ? 0.45 : 0.9;
    if (/partly|few|scattered/.test(text)) return 0.4;
    if (/clear|sunny|fair/.test(text)) return 0.1;
    return 0.35;
  }

  function fromWmo(code) {
    var w = { cloud: 0.1, precip: null, fog: 0, wind: 7 };
    if (code === 1 || code === 2) w.cloud = 0.45;
    else if (code === 3) w.cloud = 0.95;
    else if (code === 45 || code === 48) { w.cloud = 0.6; w.fog = 0.85; }
    else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) { w.cloud = 0.92; w.precip = 'rain'; w.wind = 13; }
    else if ((code >= 71 && code <= 77) || code === 85 || code === 86) { w.cloud = 0.9; w.precip = 'snow'; }
    else if (code >= 95) { w.cloud = 1; w.precip = 'rain'; w.wind = 20; }
    return w;
  }

  function applyWeather() {
    if (!built) return;
    var w = wx || { cloud: 0.18, precip: null, fog: 0, wind: 6 };
    var c = w.cloud;
    els.clouds.style.opacity = (0.10 + 0.72 * Math.min(1, c * 1.15)).toFixed(3);
    els.svg.style.setProperty('--wx-deck-a', (0.25 + 0.75 * clamp((c - 0.15) / 0.5, 0, 1)).toFixed(2));
    els.svg.style.setProperty('--wx-deck-b', clamp((c - 0.3) / 0.5, 0, 1).toFixed(2));
    els.svg.style.setProperty('--wx-deck-c', clamp((c - 0.55) / 0.45, 0, 1).toFixed(2));
    /* wind sets drift; a 5 mph day takes ~5 minutes to cross, a gale ~40s */
    var base = clamp(560 - w.wind * 20, 60, 560);
    els.svg.style.setProperty('--wx-drift', base.toFixed(0) + 's');
    els.svg.style.setProperty('--wx-chop-amp', (0.25 + clamp(w.wind / 30, 0, 1) * 0.75).toFixed(2));
    els.fog.style.opacity = (w.fog || 0).toFixed(2);
    els.rain.style.opacity = w.precip === 'rain' ? '1' : '0';
    els.snow.style.opacity = w.precip === 'snow' ? '1' : '0';
    els.svg.classList.toggle('is-overcast', c > 0.85);
  }

  /* ================= state + draw ================= */

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
    var isDay = now >= rise && now <= set;
    var colors;

    if (forced === 'sunrise') {
      dayP = 0.02; nightP = 1; sunOpacity = 0.55; isDay = true;
      colors = mixPal(PAL.sunrise, PAL.golden, 0.15);
    } else if (forced === 'day') {
      dayP = 0.5; nightP = 0; sunOpacity = 1; isDay = true; colors = PAL.day;
    } else if (forced === 'sunset') {
      dayP = 0.955; nightP = 0; sunOpacity = 0.72; isDay = true; colors = PAL.sunset;
    } else if (forced === 'night') {
      nightP = 0.45; dayP = 1; sunOpacity = 0; isDay = false; colors = PAL.night;
    } else {
      colors = isDay ? keyframe(DAY_STOPS, dayP) : keyframe(NIGHT_STOPS, nightP);
    }

    return {
      dayP: dayP, nightP: nightP, isDay: isDay,
      sunOpacity: sunOpacity, moonOpacity: clamp(1 - sunOpacity * 1.4, 0, 1),
      colors: colors
    };
  }

  function arcPos(p, lift) {
    return {
      x: ARC_LEFT + (ARC_RIGHT - ARC_LEFT) * p,
      y: ARC_BASE - (ARC_BASE - ARC_TOP) * Math.sin(Math.PI * p) * lift
    };
  }

  function drawArt(now) {
    build();
    if (!built) return;
    var s = sceneState(now);
    var c = s.colors;

    /* A thick overcast flattens the light: the sky goes grey-blue and
       the whole scene loses a stop or two, exactly as it does here. */
    var cover = wx ? wx.cloud : 0.18;
    if (cover > 0.5) c = mixPal(c, GLOOM, Math.min(0.72, (cover - 0.5) * 1.35));

    els['sky-0'].style.stopColor = c.skyTop;
    els['sky-1'].style.stopColor = c.skyMid;
    els['sky-2'].style.stopColor = c.skyBot;
    els['water-0'].style.stopColor = c.waterTop;
    els['water-1'].style.stopColor = c.waterBot;
    els.ridgeFar.style.fill = c.ridgeFar;
    els.ridgeMid.style.fill = c.ridgeMid;
    els.ridgeNear.style.fill = c.ridgeNear;
    els['fog-0'].style.stopColor = c.haze;
    els['fog-1'].style.stopColor = c.haze;
    els['fog-2'].style.stopColor = c.haze;
    els.night.style.opacity = c.star.toFixed(3);

    var sp = arcPos(s.dayP, 1);
    var mp = arcPos(s.nightP, 0.82);

    /* Low sun burns orange and swells; high sun is a small white coin. */
    var high = Math.sin(Math.PI * s.dayP);
    var discColor = mixColor('#ff7a3c', '#fff6d8', clamp(high * 1.5, 0, 1));
    els.sunDisc.style.fill = discColor;
    els.sunDisc.setAttribute('r', (30 + (1 - high) * 12).toFixed(1));
    els.sunHalo.setAttribute('r', (120 + (1 - high) * 110).toFixed(0));
    els['halo-0'].style.stopColor = discColor;
    els['halo-1'].style.stopColor = c.glow;
    els['halo-2'].style.stopColor = c.glow;
    els.sunG.style.transform = 'translate(' + sp.x.toFixed(1) + 'px,' + sp.y.toFixed(1) + 'px)';
    els.sunG.style.opacity = (s.sunOpacity * (1 - (wx ? wx.cloud : 0.2) * 0.45)).toFixed(3);

    els.moon.style.transform = 'translate(' + mp.x.toFixed(1) + 'px,' + mp.y.toFixed(1) + 'px)';
    els.moon.style.opacity = s.moonOpacity.toFixed(3);

    var ph = moonPhase(now);
    var k = 1 - 2 * ph.illum;                 // +1 new … −1 full
    els.moonTerm.setAttribute('rx', (26 * Math.abs(k)).toFixed(1));
    els.moonTerm.setAttribute('fill', k > 0 ? '#000' : '#fff');
    /* dark limb is on the west side while waxing */
    els.moonHalf.setAttribute('x', ph.waxing ? -26 : 0);

    /* Warm band along the ridge, strongest right at the horizon. */
    var horizonHeat = Math.pow(1 - high, 3) * s.sunOpacity;
    els.hglow.setAttribute('cx', sp.x.toFixed(0));
    els.hglow.style.opacity = (0.15 + 0.85 * horizonHeat).toFixed(3);
    els['hg-0'].style.stopColor = c.glow;
    els['hg-1'].style.stopColor = c.glow;

    /* the famous streak of gold laid along the ridge line */
    var streakC = mixColor(c.glow, discColor, 0.45);
    els['st-0'].style.stopColor = streakC;
    els['st-1'].style.stopColor = streakC;
    els['st-2'].style.stopColor = streakC;
    els.ridgeGlow.setAttribute('cx', sp.x.toFixed(0));
    els.ridgeGlow.style.opacity = (0.95 * horizonHeat).toFixed(3);

    /* the sky's own colour laid back on the water at the horizon */
    els['refl-0'].style.stopColor = mixColor(c.skyBot, c.glow, 0.25 * horizonHeat);
    els['refl-1'].style.stopColor = c.skyBot;

    /* The glitter path sits under whichever body is up. */
    var lit = s.sunOpacity > s.moonOpacity;
    var lx = lit ? sp.x : mp.x;
    els.glitterG.style.transform = 'translateX(' + lx.toFixed(1) + 'px)';
    els.glitterG.style.opacity = (lit
      ? (0.55 + 0.45 * s.sunOpacity) * (1 - (wx ? wx.cloud : 0.2) * 0.5)
      : 0.42 * s.moonOpacity).toFixed(3);
    els.glitterG.style.fill = lit ? mixColor(discColor, '#fff8e8', 0.5) : '#e2ecff';
    els.chopG.style.fill = c.ink;
    /* clouds take the colour of the sky they hang in — the pink
       undersides at sunset are half the reason anyone looks up */
    els.clouds.style.fill = mixColor(c.skyBot, '#ffffff', 0.55);

    els.wrap.className = els.wrap.className.replace(/\s*is-night/, '') +
      (s.sunOpacity < 0.5 ? ' is-night' : '');
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

  function synth(sf) {
    var now = Date.now() / 1000;
    if (sf === 'night') {
      return { riseToday: now - DAY_SECONDS, setToday: now - 3600,
               riseTomorrow: now + 9 * 3600 };
    }
    var f = Math.max(0, Math.min(1, parseFloat(sf) || 0.5));
    return { riseToday: now - f * DAY_SECONDS,
             setToday: now + (1 - f) * DAY_SECONDS,
             riseTomorrow: now + (1 - f) * DAY_SECONDS + 10 * 3600 };
  }

  function render() {
    var c = document.getElementById('sun-arc');
    if (!c) return;
    var isLink = c.tagName === 'A';
    var cta = 'See the full sunset tracker <span aria-hidden="true">→</span>';

    c.innerHTML =
      '<div class="sun-scene" id="sun-art"></div>' +
      '<div class="sun-scene-hud">' +
        '<div class="sun-end sun-end-rise">' +
          '<span class="sun-end-label">Sunrise</span>' +
          '<span class="sun-end-time" id="sun-rise-time"></span>' +
        '</div>' +
        '<div class="sun-countdown">' +
          '<span class="sun-count-num" id="sun-count-num">—</span>' +
          '<span class="sun-count-label" id="sun-count-label"></span>' +
        '</div>' +
        '<div class="sun-end sun-end-set">' +
          '<span class="sun-end-label">Sunset</span>' +
          '<span class="sun-end-time" id="sun-set-time"></span>' +
        '</div>' +
      '</div>' +
      (isLink
        ? '<span class="sun-tracker-cta">' + cta + '</span>'
        : '<a class="sun-tracker-cta" href="sunset.html">' + cta + '</a>');

    els = {
      wrap: c,
      art: document.getElementById('sun-art'),
      num: document.getElementById('sun-count-num'),
      label: document.getElementById('sun-count-label'),
      rise: document.getElementById('sun-rise-time'),
      set: document.getElementById('sun-set-time')
    };
    built = false;
    els.wrap.className = 'sun-arc' + (isLink ? ' is-compact' : ' rn-sun-arc');
    els.rise.textContent = fmtClock(sun.riseToday);
    els.set.textContent = fmtClock(sun.setToday);
    c.hidden = false;
    build();
    refreshWeather();
    tick();
  }

  function refreshWeather() {
    var w = readWeather();
    if (w) wx = w;
    applyWeather();
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
    setInterval(refreshWeather, 5 * 60 * 1000);
    window.addEventListener('btown:weather-data', refreshWeather);
    window.addEventListener('btown:now-weather', refreshWeather);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { tick(); timer = setInterval(tick, 1000); }
    });
  }

  function init() {
    var sf = param('sunf');
    if (sf != null) { start(synth(sf)); return; }

    // weather.html already loaded these exact times with its forecast;
    // reuse them instead of asking a second feed for the same answer.
    if (document.getElementById('rn-page')) {
      if (window.btownWeatherData) {
        start(fromWeather(window.btownWeatherData));
      } else {
        window.addEventListener('btown:weather-data', function (e) {
          start(fromWeather(e.detail));
        }, { once: true });
      }
      return;
    }

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
