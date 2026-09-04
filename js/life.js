/* ============================================================
   BURLINGTON RIGHT NOW — life.js
   Renders weather.html from data/weather/latest.json (committed
   hourly by the refresh-weather Action), data/weather/read.json
   (Steve's approved read), and data/weather/beaches.json.

   Sections, top to bottom:
     alerts → hero (now) → the next hours (strip + plain-English
     story + model check) → My read → the week ahead (range rows)
     → life scores (score, best window, sparkline, why?) → swim.

   The six LIFE SCORES are computed here, client-side, so they
   track the actual hour of day between data refreshes.

   ── HOW THE SCORES WORK ──────────────────────────────────────
   Every score starts from a comfort trapezoid on feels-like
   temperature — full credit inside an ideal band, sloping to
   zero over a tolerance range on each side — then subtracts
   activity-specific penalties (rain chance, wind, humidity/
   dewpoint, air quality, darkness, water state). Each score's
   ideal band and penalty weights encode a judgment call that is
   written out next to the math below, and the same breakdown is
   shown to readers in the "why?" drawer, so the formula is
   never a black box. Scores are 0–10; 8+ reads "great",
   6–8 "good", 4–6 "fair", under 4 "skip it".

   Each activity is scored for every remaining hour of the day
   (from the committed hourly forecast), which gives the "now"
   score, the best window ("best 6–8 PM") and the sparkline.
============================================================ */

(function () {
  'use strict';

  var DATA_URL = 'data/weather/latest.json';
  var READ_URL = 'data/weather/read.json';
  var BEACH_URL = 'data/weather/beaches.json';

  /* ---------- tiny helpers ---------- */

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Trapezoid comfort curve: 1 inside [idealLo, idealHi], falling
  // linearly to 0 across `slack` degrees on either side.
  function comfort(value, idealLo, idealHi, slackLo, slackHi) {
    if (value == null) return 0.5; // unknown → neutral, never fatal
    if (value >= idealLo && value <= idealHi) return 1;
    if (value < idealLo) return clamp(1 - (idealLo - value) / slackLo, 0, 1);
    return clamp(1 - (value - idealHi) / slackHi, 0, 1);
  }

  // All clocks and hour-of-day logic run on Burlington time, whatever
  // timezone the visitor is in. Timestamps in the data carry UTC offsets
  // (the pipeline serializes them that way), so instants are unambiguous.
  var BTV_TZ = 'America/New_York';
  var HOUR = 3600000;

  function fmtClock(iso) {
    return new Date(iso).toLocaleTimeString('en-US',
      { hour: 'numeric', minute: '2-digit', timeZone: BTV_TZ });
  }

  // "9 PM" / "9:30 PM" — minutes only when they carry information.
  function fmtHour(iso) {
    var d = new Date(iso);
    var m = parseInt(d.toLocaleString('en-US', { minute: 'numeric', timeZone: BTV_TZ }), 10);
    return d.toLocaleTimeString('en-US', m ? { hour: 'numeric', minute: '2-digit', timeZone: BTV_TZ }
                                           : { hour: 'numeric', timeZone: BTV_TZ });
  }

  function btvHour(dateOrIso) {
    var d = typeof dateOrIso === 'object' ? dateOrIso : new Date(dateOrIso);
    return parseInt(d.toLocaleString('en-US',
      { hour: 'numeric', hour12: false, timeZone: BTV_TZ }), 10) % 24;
  }

  function btvDayKey(dateOrIso) {
    var d = typeof dateOrIso === 'object' ? dateOrIso : new Date(dateOrIso);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BTV_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
  }

  // The Burlington calendar day after `key` ("2026-03-08" → "2026-03-09"),
  // by date arithmetic rather than +24h, so DST days don't shift it.
  function nextDayKey(key) {
    var p = key.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1)).toISOString().slice(0, 10);
  }

  function btvWeekday(dateOrIso, style) {
    var d = typeof dateOrIso === 'object' ? dateOrIso : new Date(dateOrIso);
    return d.toLocaleDateString('en-US', { weekday: style || 'long', timeZone: BTV_TZ });
  }

  function fmtAgo(iso) {
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var h = Math.round(mins / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return Math.round(h / 24) + 'd ago';
  }

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Compass → degrees the wind blows FROM. The arrow glyph points where
  // the air is going, so the rotation adds 180°.
  var COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
                  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  function windArrow(dir) {
    var deg = COMPASS[(dir || '').toUpperCase()];
    if (deg == null) return '';
    return '<span class="wx-arrow" aria-hidden="true" style="transform:rotate(' + ((deg + 180) % 360) + 'deg)">↑</span>';
  }

  // One glyph per sky. Order matters: the nastiest condition mentioned
  // in the short forecast wins, because "Mostly Sunny then Thunderstorms"
  // is a thunderstorm day to anyone making plans — unless the odds say
  // otherwise. NWS says "isolated" and "slight chance" for a reason, and
  // stamping a thunderhead on a 20% day that's mostly sun is a lie.
  function skyGlyph(short, pop, night) {
    var s = (short || '').toLowerCase();
    if (pop != null && pop < 30 && /sunny|clear/.test(s)) {
      // Low odds: ignore the "then Slight Chance Showers" tail and read the sky.
      if (/partly/.test(s)) return night ? '🌥️' : '⛅';
      if (/mostly sunny|mostly clear/.test(s)) return night ? '🌙' : '🌤️';
      return night ? '🌙' : '☀️';
    }
    if (/thunder/.test(s)) return '⛈️';
    if (/snow|flurr|sleet|wintry|ice/.test(s)) return '🌨️';
    if (/rain|shower|drizzle/.test(s)) return '🌧️';
    if (/fog|haze|smoke/.test(s)) return '🌫️';
    if (/mostly cloudy|cloudy|overcast/.test(s)) return '☁️';
    if (/partly sunny|partly cloudy|mostly sunny|mostly clear/.test(s)) return night ? '🌥️' : '⛅';
    if (/sunny|clear/.test(s)) return night ? '🌙' : '☀️';
    return night ? '🌙' : '🌤️';
  }

  /* ============================================================
     LIFE SCORES
     Each scorer takes (hour, ctx) where `hour` is one entry of
     latest.json's hourly array and ctx carries the slow-moving
     stuff (AQI, lake, sun times). Returns { score: 0-10,
     parts: [{label, delta}] } — parts power the "why?" drawer.
  ============================================================ */

  // Air quality penalty, shared. AQI ≤50 is clean air; the EPA
  // "Moderate" band mostly matters once you're breathing hard,
  // so `exertion` scales it (running > patio sitting).
  function airPenalty(aqi, exertion) {
    if (aqi == null || aqi <= 50) return 0;
    if (aqi <= 100) return 0.8 * exertion;
    if (aqi <= 150) return 2.5 * exertion;
    return 5 * exertion;
  }

  // Rain-chance penalty: pop is a probability, so penalties stay
  // proportional — a 30% chance shouldn't kill an outdoor score.
  function rainPenalty(pop, weight) {
    return (pop || 0) / 100 * weight;
  }

  function isDaylight(hourIso, ctx) {
    if (!ctx || !ctx.sunrise || !ctx.sunset) return true; // unknown → no darkness penalties
    var t = new Date(hourIso).getTime();
    // Today's daylight, or tomorrow's for hours past tonight's sunset.
    if (t >= new Date(ctx.sunrise).getTime() && t <= new Date(ctx.sunset).getTime()) return true;
    if (ctx.sunriseTomorrow && ctx.sunsetTomorrow &&
        t >= new Date(ctx.sunriseTomorrow).getTime() && t <= new Date(ctx.sunsetTomorrow).getTime()) return true;
    return false;
  }

  var SCORERS = {

    /* PATIO — sitting outside with a drink.
       Ideal feels-like 64–82 (shirtsleeve weather); rain is the
       main killer (weight 7 — you leave when it rains); wind over
       ~10 mph starts stealing napkins (0.35/mph); air quality at
       light exertion; big penalty after dark only if it's also
       cold — warm summer nights are patio prime time. */
    patio: function (h, ctx) {
      var parts = [];
      var base = comfort(h.feels_f, 64, 82, 22, 14) * 10;
      parts.push({ label: 'Feels like ' + h.feels_f + '°', delta: base });
      var rain = rainPenalty(h.pop, 7);
      if (rain >= 0.5) parts.push({ label: h.pop + '% chance of rain', delta: -rain });
      var wind = Math.max(0, (h.wind_mph || 0) - 10) * 0.35;
      if (wind >= 0.5) parts.push({ label: 'Wind ' + h.wind_mph + ' mph', delta: -wind });
      var air = airPenalty(ctx.aqi, 0.7);
      if (air) parts.push({ label: 'Air quality (AQI ' + ctx.aqi + ')', delta: -air });
      var dark = 0;
      if (!isDaylight(h.t, ctx) && h.feels_f < 62) {
        dark = 2;
        parts.push({ label: 'Dark and cool', delta: -2 });
      }
      return { score: clamp(base - rain - wind - air - dark, 0, 10), parts: parts };
    },

    /* SWIMMING — actually getting in the lake.
       Water temperature dominates: 72+ is easy swimming, the
       mid-60s are a gasp, under 60 caps the score at 3 no matter
       how hot the day is. Air feels-like 75+ for full credit.
       Waves over 2 ft on the broad lake are a real swim factor
       (weight from the REC forecast), thunder chance is a hard
       penalty (you must leave the water), and any posted beach
       advisory is handled separately on the swim board. */
    swimming: function (h, ctx) {
      var parts = [];
      var wt = ctx.lakeTempF;
      var water;
      if (wt == null) { water = 5; parts.push({ label: 'Water temp unknown', delta: 5 }); }
      else {
        water = wt >= 72 ? 10 : wt >= 68 ? 8.5 : wt >= 64 ? 6.5 : wt >= 60 ? 4.5 : 3;
        parts.push({ label: 'Water ' + wt + '°', delta: water });
      }
      var airC = comfort(h.feels_f, 75, 95, 15, 10);
      var airAdj = (airC - 1) * 4; // up to -4 when it's chilly on shore
      if (airAdj <= -0.5) parts.push({ label: 'Air feels like ' + h.feels_f + '°', delta: airAdj });
      var waves = 0;
      if (ctx.wavesFt != null && ctx.wavesFt >= 2) {
        waves = (ctx.wavesFt - 1) * 1.5;
        parts.push({ label: 'Waves to ' + ctx.wavesFt + ' ft on the broad lake', delta: -waves });
      }
      var rain = rainPenalty(h.pop, 6);
      if (rain >= 0.5) parts.push({ label: h.pop + '% chance of rain/storms', delta: -rain });
      var night = isDaylight(h.t, ctx) ? 0 : 4;
      if (night) parts.push({ label: 'After dark', delta: -night });
      var wcap = wt != null && wt < 60 ? 3 : 10;
      return { score: clamp(Math.min(water + airAdj - waves - rain - night, wcap), 0, 10), parts: parts };
    },

    /* RUNNING — dewpoint is the honest misery index, so humidity
       enters through it: under 55 is crisp, 65+ is muggy, 70+ is
       soup (VT summer's real enemy). Ideal feels-like 42–64 —
       runners run warm. Light rain barely matters (weight 3),
       but air quality matters MORE than for anything else here
       (exertion 1.5): you don't do tempo runs in wildfire smoke. */
    running: function (h, ctx) {
      var parts = [];
      var base = comfort(h.feels_f, 42, 64, 22, 20) * 10;
      parts.push({ label: 'Feels like ' + h.feels_f + '°', delta: base });
      var dp = ctx.dewpointF; // slow-moving; obs value is fine for the day
      var mug = 0;
      if (dp != null && dp > 55) {
        mug = clamp((dp - 55) * 0.25, 0, 4);
        parts.push({ label: 'Dewpoint ' + dp + '° (mugginess)', delta: -mug });
      }
      var rain = rainPenalty(h.pop, 3);
      if (rain >= 0.5) parts.push({ label: h.pop + '% chance of rain', delta: -rain });
      var air = airPenalty(ctx.aqi, 1.5);
      if (air) parts.push({ label: 'Air quality (AQI ' + ctx.aqi + ') — breathing hard', delta: -air });
      var wind = Math.max(0, (h.wind_mph || 0) - 15) * 0.2;
      if (wind >= 0.5) parts.push({ label: 'Wind ' + h.wind_mph + ' mph', delta: -wind });
      return { score: clamp(base - mug - rain - air - wind, 0, 10), parts: parts };
    },

    /* OPEN WINDOW — should tonight's air be your AC?
       Scored on the overnight hours: outside temp 55–68 is the
       sleep-science sweet spot; dewpoint over 65 means the air
       itself is sticky no matter the temp; rain blowing in and
       smoke coming in are the two closers. */
    open_window: function (h, ctx) {
      var parts = [];
      var base = comfort(h.temp_f, 55, 68, 12, 10) * 10;
      parts.push({ label: 'Outside ' + h.temp_f + '°', delta: base });
      var dp = ctx.dewpointF;
      var mug = 0;
      if (dp != null && dp > 60) {
        mug = clamp((dp - 60) * 0.3, 0, 3.5);
        parts.push({ label: 'Dewpoint ' + dp + '° (sticky air)', delta: -mug });
      }
      var rain = rainPenalty(h.pop, 5);
      if (rain >= 0.5) parts.push({ label: h.pop + '% chance of rain', delta: -rain });
      var air = airPenalty(ctx.aqi, 1.3); // smoke indoors is the worst trade
      if (air) parts.push({ label: 'Air quality (AQI ' + ctx.aqi + ')', delta: -air });
      return { score: clamp(base - mug - rain - air, 0, 10), parts: parts };
    },

    /* DOG WALK — comfort band is wide (dogs love brisk), but hot
       pavement is the hidden hazard: full sun + 85°+ afternoons
       burn paws, so that combination takes a hard hit. Storms
       (high pop + summer) are a bigger deal with a dog in tow. */
    dog_walk: function (h, ctx) {
      var parts = [];
      var base = comfort(h.feels_f, 35, 75, 25, 15) * 10;
      parts.push({ label: 'Feels like ' + h.feels_f + '°', delta: base });
      var paw = 0;
      if (h.temp_f >= 85 && (h.sky == null || h.sky < 50) && isDaylight(h.t, ctx)) {
        paw = 2.5;
        parts.push({ label: 'Hot pavement risk (sunny, ' + h.temp_f + '°)', delta: -paw });
      }
      var rain = rainPenalty(h.pop, 5);
      if (rain >= 0.5) parts.push({ label: h.pop + '% chance of rain', delta: -rain });
      var air = airPenalty(ctx.aqi, 1.0);
      if (air) parts.push({ label: 'Air quality (AQI ' + ctx.aqi + ')', delta: -air });
      return { score: clamp(base - paw - rain - air, 0, 10), parts: parts };
    }
  };

  var SCORE_META = [
    { key: 'patio',       icon: '🍺', name: 'Patio' },
    { key: 'sunset',      icon: '🌇', name: 'Sunset',
      link: 'sunset.html', linkText: 'The full sunset forecast →' },
    { key: 'swimming',    icon: '🏊', name: 'Swimming' },
    { key: 'running',     icon: '🏃', name: 'Running' },
    { key: 'open_window', icon: '🪟', name: 'Open window' },
    { key: 'dog_walk',    icon: '🐕', name: 'Dog walk' }
    // Ski slot is stubbed in render — formula lands with the snow.
  ];

  function verdict(score) {
    if (score >= 8) return { word: 'Great', cls: 'great' };
    if (score >= 6) return { word: 'Good', cls: 'good' };
    if (score >= 4) return { word: 'Fair', cls: 'fair' };
    return { word: 'Skip it', cls: 'skip' };
  }

  // "6–9 PM", "11 AM–2 PM", "around 7 PM"
  function fmtRange(startIso, endIso) {
    var a = fmtHour(startIso), b = fmtHour(endIso);
    if (a === b) return 'around ' + a;
    var am = a.slice(-2), bm = b.slice(-2);
    var short = new Date(endIso).getTime() - new Date(startIso).getTime() < 12 * HOUR;
    if (am === bm && short) a = a.slice(0, -3);
    return a + '–' + b;
  }

  /* Score an activity across the remaining hours of today to get the
     current score, the best window ("best 6–9 PM") and a sparkline
     series. `sunset` is special: it's always evaluated at the sunset
     hour by the shared sunset formula. */
  function scoreActivity(key, hours, ctx) {
    var now = Date.now();

    if (key === 'sunset') {
      if (!ctx.sunset) return null;
      try {
        var target = window.BtownSunsetScore.selectTarget(ctx.latest, now);
        var result = window.BtownSunsetScore.computeScore(
          target.sunsetMs, ctx.openMeteo, ctx.latest, null, ctx.sunsetAq);
        return {
          score: result.score,
          parts: result.parts,
          window: 'sunset at ' + fmtClock(target.sunsetMs),
          series: null
        };
      } catch (e) {
        return null; // sunset scorer couldn't run — skip the card rather than crash the grid
      }
    }
    var scorer = SCORERS[key];

    // hours still ahead of us in the Burlington day (open-window looks
    // 20h out so a morning visitor still sees tonight's overnight window)
    // "The rest of today" is a Burlington calendar day (DST-safe: we compare
    // day keys, not elapsed hours). Open-window looks 20h out so a morning
    // visitor still sees tonight's overnight window.
    var todayKey = btvDayKey(new Date());
    var elapsedHorizon = key === 'open_window' ? now + 20 * HOUR : null;
    var series = [];
    for (var k = 0; k < hours.length; k++) {
      var tk = new Date(hours[k].t).getTime();
      if (tk + HOUR <= now) continue;
      if (elapsedHorizon != null ? tk > elapsedHorizon : btvDayKey(hours[k].t) !== todayKey) continue;
      series.push({ h: hours[k], r: scorer(hours[k], ctx) });
    }
    if (!series.length) {
      // nothing left in the horizon (very late night): score the last hour we have
      var lastH = hours[hours.length - 1];
      series = [{ h: lastH, r: scorer(lastH, ctx) }];
    }

    var current = series[0];

    // "best around…" suggestions stay inside waking hours — nobody
    // wants to hear their best run is at 1 AM. Open-window is the
    // exception: overnight is exactly when it matters.
    function awake(entry) {
      var hh = btvHour(entry.h.t);
      // open-window is a night question: 8 PM through 9 AM
      if (key === 'open_window') return hh >= 20 || hh < 9;
      return hh >= 6 && hh < 22;
    }
    var eligible = series.map(function (e, i) { return { e: e, i: i }; })
      .filter(function (x) { return awake(x.e); });
    if (!eligible.length) eligible = [{ e: series[0], i: 0 }];

    var best = eligible[0];
    eligible.forEach(function (x) { if (x.e.r.score > best.e.r.score + 0.01) best = x; });

    // The window: contiguous eligible hours around the best one that stay
    // within 1.5 points of it and above "fair".
    var floor = Math.max(5, best.e.r.score - 1.5);
    var lo = best.i, hi = best.i;
    while (lo - 1 >= 0 && awake(series[lo - 1]) && series[lo - 1].r.score >= floor) lo--;
    while (hi + 1 < series.length && awake(series[hi + 1]) && series[hi + 1].r.score >= floor) hi++;

    var windowText = null, windowIdx = null;
    if (best.e.r.score >= 5) {
      windowIdx = [lo, hi];
      var endIso = new Date(new Date(series[hi].h.t).getTime() + HOUR).toISOString();
      var lastEligible = eligible[eligible.length - 1].i;
      if (lo === 0) {
        // we're in the window now
        if (hi >= lastEligible) {
          windowText = key === 'open_window' ? 'good all night' : 'good the rest of the day';
        } else {
          windowText = 'good now, through ' + fmtHour(endIso);
        }
      } else if (hi >= lastEligible) {
        windowText = 'best from ' + fmtHour(series[lo].h.t) + ' on';
      } else {
        windowText = 'best ' + fmtRange(series[lo].h.t, endIso);
      }
    } else if (series.length > 1) {
      windowText = key === 'open_window' ? 'not tonight' : 'no great window today';
    }

    return {
      score: current.r.score,
      parts: current.r.parts,
      window: windowText,
      series: series.map(function (e) { return { t: e.h.t, score: e.r.score }; }),
      windowIdx: windowIdx
    };
  }

  /* ============================================================
     RENDERING — hero
  ============================================================ */

  var SEVERITY_RANK = { extreme: 4, severe: 3, moderate: 2, minor: 1, unknown: 0 };

  function renderAlerts(d) {
    var ab = el('rn-alerts');
    if (!ab) return;
    var nowMs = Date.now();
    // The pipeline keeps last-good data per section, so an alert that has
    // since expired must never linger on the page.
    var alerts = ((d.alerts || {}).active || []).filter(function (a) {
      if (!a) return false;
      if (!a.expires) return true;
      var ex = new Date(a.expires).getTime();
      return isNaN(ex) || ex > nowMs;
    });
    if (!alerts.length) { ab.hidden = true; return; }
    var checkedAt = (d.sections_updated || {}).alerts;
    var staleNote = checkedAt && nowMs - new Date(checkedAt).getTime() > 2 * HOUR
      ? '<span class="wx-alerts-stale">last checked ' + esc(fmtAgo(checkedAt)) + '</span>' : '';
    var worst = 'minor';
    alerts.forEach(function (a) {
      var s = (a.severity || 'unknown').toLowerCase();
      if ((SEVERITY_RANK[s] || 0) > (SEVERITY_RANK[worst] || 0)) worst = s;
    });
    ab.className = 'wx-alerts wx-alerts-' + (SEVERITY_RANK[worst] >= 3 ? 'severe' : SEVERITY_RANK[worst] === 2 ? 'moderate' : 'minor');
    ab.innerHTML = '<div class="wx-alerts-inner">' +
      '<span class="wx-alerts-kicker">⚠ NWS alert' + (alerts.length > 1 ? 's' : '') + ' for Burlington</span>' +
      alerts.map(function (a) {
        // Event + expiry only — NWS headlines describe the whole warned
        // region ("portions of Vermont and northern New York"), and this
        // page speaks Burlington.
        var exp = a.expires ? '<span class="wx-alert-until">until ' + esc(fmtHour(a.expires)) + ' ' +
          esc(btvWeekday(a.expires, 'short')) + '</span>' : '';
        return '<div class="wx-alert">' +
          '<span class="wx-alert-event">' + esc(a.event || 'Weather alert') + '</span>' +
          exp + '</div>';
      }).join('') +
      '<a class="wx-alerts-link" href="https://forecast.weather.gov/MapClick.php?lat=44.4759&lon=-73.2121" target="_blank" rel="noopener">Read the full alert at weather.gov →</a>' +
      staleNote + '</div>';
    ab.hidden = false;
  }

  function renderNow(d) {
    var box = el('rn-stats');
    if (!box) return;
    var now = d.now || {};
    var sun = d.sun || {};
    var air = d.air || {};
    var gage = d.lake_gage || {};

    // Headline: the big number, the sky, and feels-like only when it
    // actually differs (5°+). Apple's "feels like" is a second number;
    // Dark Sky put it in words. We do words, and only when it matters.
    var head = [];
    if (now.temp_f != null) head.push('<span class="rn-big">' + now.temp_f + '°</span>');
    if (now.description) head.push('<span class="rn-desc">' + esc(now.description.toLowerCase()) + '</span>');
    if (now.temp_f != null && now.feels_like_f != null && Math.abs(now.feels_like_f - now.temp_f) >= 5) {
      head.push('<span class="rn-feels">feels like ' + now.feels_like_f + '°</span>');
    }
    box.innerHTML = head.join('');

    // Chips: the glanceable secondary numbers.
    var chips = [];
    if (now.wind_mph != null) {
      chips.push('<span class="rn-chip" title="Wind">' + windArrow(now.wind_dir) +
        ' ' + esc(now.wind_dir || '') + ' ' + now.wind_mph + ' mph' +
        (now.wind_gust_mph ? ', gusts ' + now.wind_gust_mph : '') + '</span>');
    }
    if (now.humidity != null) chips.push('<span class="rn-chip" title="Relative humidity">💧 ' + now.humidity + '%</span>');
    if (gage.water_temp_f != null) chips.push('<a class="rn-chip" href="#swim-section" title="Lake Champlain water temperature">🌊 lake ' + gage.water_temp_f + '°</a>');
    if (air.aqi != null) chips.push('<span class="rn-chip rn-chip-aqi-' + esc((air.category || '').toLowerCase().replace(/\s+/g, '-')) +
      '" title="Air quality index">AQI ' + air.aqi + ' ' + esc((air.category || '').toLowerCase()) + '</span>');
    if (sun.uv_max != null) chips.push('<span class="rn-chip" title="Peak UV index today">UV ' + Math.round(sun.uv_max) + ' max</span>');
    if (sun.sunset) chips.push('<a class="rn-chip" href="sunset.html" title="Sunset tracker">🌇 ' + fmtClock(sun.sunset) + '</a>');
    el('rn-chips').innerHTML = chips.join('');

    // One compact day line, not the full NWS paragraph — the wording
    // lives in the week strip's Today row.
    var sub = el('rn-sub');
    var fc = (d.forecast || {}).periods || [];
    if (fc.length) {
      var p0 = fc[0];
      var bits = [esc((p0.short || '').toLowerCase())];
      if (p0.temp_f != null) bits.push((p0.is_day ? 'high near ' : 'low near ') + p0.temp_f);
      if (p0.pop != null && p0.pop >= 30) bits.push(Math.round(p0.pop / 10) * 10 + '% chance of rain');
      sub.innerHTML = '<strong>' + esc(p0.name) + ':</strong> ' + bits.filter(Boolean).join(', ') + '.';
    } else {
      sub.innerHTML = '';
    }

    if (now.observed_at) {
      var observedAge = Date.now() - new Date(now.observed_at).getTime();
      el('rn-updated').textContent = 'Observed ' + fmtClock(now.observed_at) + ' at the airport' +
        (observedAge > 2 * HOUR ? ' · ' + fmtAgo(now.observed_at) : '');
    }
  }

  /* ============================================================
     THE NEXT HOURS — strip + story + model check
     Built from latest.json's `hourly` (36 rows). The strip is the
     Apple-style hour rail, with a temperature line and rain bars
     drawn behind it (Dark Sky / Yr meteogram) and sunrise/sunset
     dropped in as their own cells. The story is one sentence in
     plain English, generated from the same rows.
  ============================================================ */

  function upcomingHours(d) {
    var hours = ((d.hourly || {}).hours) || [];
    var now = Date.now();
    return hours.filter(function (h) { return new Date(h.t).getTime() + HOUR > now; }); // same rule as scoring
  }

  // What is this hour doing? 'wet' if rain is more likely than not-ish,
  // otherwise one of three sky words. NWS pop is the honest signal; the
  // short forecast breaks ties ("Slight Chance Showers" at 25% is dry).
  function hourClass(h) {
    var s = (h.short || '').toLowerCase();
    var wetWord = /thunder/.test(s) ? 'storms' : /snow|flurr|sleet|freezing|ice/.test(s) ? 'snow'
                : /drizzle/.test(s) ? 'drizzle' : /rain|shower/.test(s) ? 'showers' : null;
    if (/sleet|freezing|ice/.test(s)) wetWord = 'wintry mix';
    var pop = h.pop || 0;
    // Storms and frozen stuff are worth a mention at lower odds than plain
    // showers — a 30% thunderstorm chance changes a swim plan.
    var threshold = (wetWord === 'storms' || wetWord === 'snow' || wetWord === 'wintry mix') ? 25 : 45;
    if (pop >= threshold && wetWord) return { kind: 'wet', word: wetWord, pop: pop };
    if (pop >= 60) return { kind: 'wet', word: 'showers', pop: pop };
    var sky = h.sky;
    if (sky == null) sky = /clear|sunny/.test(s) ? 15 : /partly/.test(s) ? 50 : /cloudy|overcast/.test(s) ? 85 : 40;
    var word = sky <= 30 ? 'clear' : sky <= 70 ? 'partly cloudy' : 'cloudy';
    return { kind: 'dry', word: word, sky: sky };
  }

  // "through 9 PM" / "through Saturday afternoon" — clock times for the
  // near term, day-part names past ~12 hours.
  function dayPart(iso) {
    var hh = btvHour(iso);
    var todayKey = btvDayKey(new Date());
    var key = btvDayKey(iso);
    var part = hh < 5 ? 'overnight' : hh < 12 ? 'morning' : hh < 17 ? 'afternoon' : hh < 21 ? 'evening' : 'night';
    if (key === todayKey) {
      return part === 'night' || part === 'overnight' ? 'tonight' : 'this ' + part;
    }
    var day = btvWeekday(iso);
    if (part === 'overnight') return 'early ' + day;
    if (part === 'night') return day + ' night';
    return day + ' ' + part;
  }
  function whenPhrase(iso, prefixClock, prefixDay) {
    var dt = new Date(iso).getTime() - Date.now();
    if (dt < 12 * HOUR) {
      var clock = fmtHour(iso);
      if (clock === '12 AM') clock = 'midnight';
      if (clock === '12 PM') clock = 'noon';
      return prefixClock + ' ' + clock;
    }
    return (prefixDay ? prefixDay + ' ' : '') + dayPart(iso);
  }

  function renderHoursContext(d, hours) {
    var stamps = el('hours-stamps');
    if (stamps) {
      var issued = (d.hourly || {}).updated;
      stamps.textContent = issued ? 'NWS forecast issued ' + fmtClock(issued) : '';
      if (d.google && d.google.fetched_at) {
        stamps.textContent += (stamps.textContent ? ' · ' : '') + 'Google checked ' + fmtAgo(d.google.fetched_at);
      }
    }

    var second = el('hours-second');
    if (!second) return;
    second.hidden = true;
    second.innerHTML = '';
    var google = d.google || {};
    if (!Array.isArray(google.hours) || !google.hours.length || !google.fetched_at ||
        Date.now() - new Date(google.fetched_at).getTime() >= 3 * HOUR) return;

    var limit = Date.now() + 18 * HOUR;
    var byHour = {};
    google.hours.forEach(function (h) {
      var t = Math.floor(new Date(h.t).getTime() / HOUR) * HOUR;
      if (isFinite(t) && t <= limit) byHour[t] = h;
    });
    var pairs = [];
    hours.forEach(function (h) {
      var t = Math.floor(new Date(h.t).getTime() / HOUR) * HOUR;
      if (t <= limit && byHour[t]) pairs.push({ t: t, nws: h, google: byHour[t] });
    });
    if (!pairs.length) return;

    var sentence = '';
    var nwsRain = pairs.filter(function (p) { return p.nws.pop >= 40; })[0];
    var googleRain = pairs.filter(function (p) { return p.google.pop >= 40; })[0];
    if (nwsRain && googleRain && Math.abs(nwsRain.t - googleRain.t) >= 2 * HOUR) {
      if (nwsRain.t < googleRain.t) {
        sentence = 'Rain timing is uncertain: NWS brings it in ' + whenPhrase(nwsRain.nws.t, 'near', '') +
          ', Google holds it until ' + whenPhrase(googleRain.google.t, 'around', '') + '.';
      } else {
        sentence = 'Rain timing is uncertain: Google has it arriving earlier, ' +
          whenPhrase(googleRain.google.t, 'near', '') + '.';
      }
    }
    if (!sentence) {
      var rainGap = pairs.reduce(function (best, p) {
        var gap = Math.abs((p.nws.pop || 0) - (p.google.pop || 0));
        return !best || gap > best.gap ? { pair: p, gap: gap } : best;
      }, null);
      if (rainGap && rainGap.gap >= 25) {
        sentence = 'NWS gives the ' + fmtHour(rainGap.pair.nws.t) + ' hour a ' + rainGap.pair.nws.pop +
          '% rain chance; Google says ' + rainGap.pair.google.pop + '%.';
      }
    }
    if (!sentence) {
      var tempGap = pairs.reduce(function (best, p) {
        if (p.nws.temp_f == null || p.google.temp_f == null) return best;
        var gap = p.google.temp_f - p.nws.temp_f;
        return !best || Math.abs(gap) > Math.abs(best.gap) ? { pair: p, gap: gap } : best;
      }, null);
      if (tempGap && Math.abs(tempGap.gap) >= 3) {
        sentence = "Google's forecast runs " + Math.abs(Math.round(tempGap.gap)) + '° ' +
          (tempGap.gap > 0 ? 'warmer' : 'cooler') + ' than NWS ' + whenPhrase(tempGap.pair.google.t, 'around', '') + '.';
      }
    }
    if (!sentence) return;
    second.innerHTML = esc(sentence) +
      '<span class="hours-second-source">Source: Includes weather data from Google</span>';
    second.hidden = false;
  }

  function hoursStory(d, hours) {
    if (!hours.length) return '';
    var span = hours.slice(0, 36);

    // Runs of consecutive same-kind hours.
    var runs = [];
    span.forEach(function (h) {
      var c = hourClass(h);
      var last = runs[runs.length - 1];
      if (last && last.kind === c.kind && (c.kind === 'wet' || last.word === c.word)) {
        last.end = h.t; last.n++; last.maxPop = Math.max(last.maxPop, h.pop || 0);
        if (c.kind === 'wet' && c.word === 'storms') last.word = 'storms';
      } else {
        runs.push({ kind: c.kind, word: c.word, start: h.t, end: h.t, n: 1, maxPop: h.pop || 0 });
      }
    });
    // Absorb one-hour dry blips between dry runs ("partly cloudy" for
    // a single hour isn't a story) — merge into the previous run.
    var merged = [];
    runs.forEach(function (r) {
      var prev = merged[merged.length - 1];
      if (prev && r.kind === 'dry' && prev.kind === 'dry' && r.n <= 1) { prev.end = r.end; prev.n += r.n; return; }
      if (prev && r.kind === 'dry' && prev.kind === 'dry' && prev.n <= 1) { prev.word = r.word; prev.end = r.end; prev.n += r.n; return; }
      merged.push(r);
    });
    runs = merged;

    var first = runs[0];
    var endOfFirst = new Date(new Date(first.end).getTime() + HOUR).toISOString();
    var ctx = d.__ctx;

    function describe(run, lead) {
      if (run.kind === 'wet') {
        var w = run.word;
        if (run.maxPop >= 70) return lead ? cap(w) + ' likely' : w;
        if (run.maxPop >= 45) return lead ? cap(w) + ' possible' : w + ' possible';
        return lead ? 'A chance of ' + w : 'a chance of ' + w;
      }
      // Night-aware sky words: "clear" works any time, "sunny" only by day.
      var word = run.word;
      // "sunny" only for a stretch that starts and ends in daylight; a run
      // that crosses sunset is "clear".
      if (word === 'clear' && isDaylight(run.start, ctx) && isDaylight(run.end, ctx) && run.n <= 14) word = 'sunny';
      return lead ? cap(word) : word;
    }

    // Clause 1: what it's doing now and how long that lasts.
    var sentence;
    if (runs.length === 1) {
      // One run the whole way: "Clear through early Sunday".
      var endOfSpan = new Date(new Date(span[span.length - 1].t).getTime() + HOUR).toISOString();
      sentence = describe(first, true) + ' ' + whenPhrase(endOfSpan, 'through', 'through');
    } else {
      sentence = describe(first, true) + ' ' + whenPhrase(endOfFirst, 'through', 'into');
    }

    // Clause 2: the turn. Wet after dry (or dry after wet) is the story;
    // a dry sky change is worth a few words but not a time of its own —
    // it starts where clause 1 ends.
    var turn = null;
    for (var i = 1; i < runs.length; i++) {
      if (runs[i].kind !== first.kind) { turn = runs[i]; break; }
    }
    if (turn) {
      // The turn's start time only needs saying when something else sits
      // between clause 1 and the turn; otherwise "through 9 PM, then showers"
      // already says when.
      var when = turn === runs[1] ? '' : ' ' + whenPhrase(turn.start, 'around', '');
      if (turn.kind === 'wet') {
        sentence += ', then ' + describe(turn, false) + when +
          (turn.maxPop < 70 ? ' (' + Math.round(turn.maxPop / 10) * 10 + '%)' : '');
      } else {
        sentence += ', then drying out' + when +
          (turn.word !== 'cloudy' ? ' and turning ' + turn.word : '');
      }
    } else if (runs.length > 1) {
      sentence += ', then ' + describe(runs[1], false);
    }

    // Clause 3: temperatures — tonight's low if the span covers tonight,
    // tomorrow's high if it covers tomorrow's afternoon, today's high if
    // it's still morning.
    var sun = d.sun || {};
    var nowMs = Date.now();
    var sunsetMs = new Date(sun.sunset).getTime(), riseTmMs = new Date(sun.sunrise_tomorrow).getTime();
    var nightHours = span.filter(function (h) {
      var t = new Date(h.t).getTime();
      return t >= Math.max(sunsetMs, nowMs - HOUR) && t <= riseTmMs;
    });
    var tempBits = [];
    if (nightHours.length >= 3) {
      var low = Math.min.apply(null, nightHours.map(function (h) { return h.temp_f; }));
      tempBits.push('low near ' + low + ' tonight');
    }
    // Before mid-afternoon, today's high is the number that matters (the
    // week rows carry tomorrow's); after that, tomorrow's high is.
    var todayKey = btvDayKey(new Date());
    var todayRest = span.filter(function (h) { return btvDayKey(h.t) === todayKey && btvHour(h.t) <= 19; });
    if (btvHour(new Date()) < 15 && todayRest.length >= 2) {
      tempBits.unshift('topping out near ' + Math.max.apply(null, todayRest.map(function (h) { return h.temp_f; })) + ' today');
    } else {
      var tomorrowKey = nextDayKey(todayKey);
      var tmDay = span.filter(function (h) { return btvDayKey(h.t) === tomorrowKey && btvHour(h.t) >= 10 && btvHour(h.t) <= 18; });
      if (tmDay.length >= 4) {
        var hiT = Math.max.apply(null, tmDay.map(function (h) { return h.temp_f; }));
        tempBits.push('high near ' + hiT + ' ' + btvWeekday(tmDay[0].t));
      }
    }
    if (tempBits.length) sentence += '; ' + tempBits.join(', ');

    // Wind: only when it's a factor.
    var windy = span.slice(0, 12).filter(function (h) { return (h.wind_mph || 0) >= 15; });
    if (windy.length >= 2) {
      var wmax = Math.max.apply(null, windy.map(function (h) { return h.wind_mph; }));
      sentence += '; breezy, ' + windy[0].wind_dir + ' wind to ' + wmax + ' mph';
    }
    return sentence + '.';
  }

  function renderHours(d) {
    var sec = el('hours-section'), track = el('hr-track');
    if (!sec || !track) return;
    var hours = upcomingHours(d);
    if (hours.length < 3) { sec.hidden = true; return; }
    hours = hours.slice(0, 36);

    var sun = d.sun || {};
    var ctx = d.__ctx;
    var nowMs = Date.now();

    // Timeline: hour cells, with sun events dropped in between.
    var events = [];
    [['sunset', sun.sunset, '🌇', 'Sunset'], ['sunrise', sun.sunrise_tomorrow, '🌅', 'Sunrise'],
     ['sunset', sun.sunset_tomorrow, '🌇', 'Sunset'], ['sunrise', sun.sunrise, '🌅', 'Sunrise']].forEach(function (e) {
      if (!e[1]) return;
      var t = new Date(e[1]).getTime();
      if (t > nowMs && t < new Date(hours[hours.length - 1].t).getTime() + HOUR) {
        events.push({ kind: e[0], t: t, glyph: e[2], label: e[3], iso: e[1] });
      }
    });
    events.sort(function (a, b) { return a.t - b.t; });

    var temps = hours.map(function (h) { return h.temp_f; });
    var tMin = Math.min.apply(null, temps), tMax = Math.max.apply(null, temps);
    if (tMax - tMin < 6) { tMax += 3; tMin -= 3; } // flat days shouldn't look like cliffs

    var cells = [];
    var ei = 0;
    hours.forEach(function (h, i) {
      var t = new Date(h.t).getTime();
      // A sun event that happens before this hour starts (sunset 7:48 →
      // between the 7 PM and 8 PM cells) gets its own cell first.
      while (ei < events.length && events[ei].t < t) {
        cells.push({ kind: 'sun', ev: events[ei++] });
      }
      cells.push({ kind: 'hour', h: h, i: i });
    });
    while (ei < events.length) cells.push({ kind: 'sun', ev: events[ei++] });

    var html = cells.map(function (c) {
      if (c.kind === 'sun') {
        return '<div class="hr-cell hr-sun hr-' + c.ev.kind + '" data-t="' + c.ev.t + '">' +
          '<span class="hr-time">' + esc(fmtClock(c.ev.iso)) + '</span>' +
          '<span class="hr-glyph" aria-hidden="true">' + c.ev.glyph + '</span>' +
          '<span class="hr-band"></span>' +
          '<span class="hr-temp hr-sun-label">' + c.ev.label + '</span>' +
          '<span class="hr-pop"></span><span class="hr-wind"></span></div>';
      }
      var h = c.h, i = c.i;
      var night = !isDaylight(h.t, ctx);
      var hh = btvHour(h.t);
      var label = i === 0 ? 'Now' : hh === 0 ? btvWeekday(h.t, 'short') : fmtHour(h.t);
      var pop = h.pop || 0;
      var popTxt = pop >= 15 ? Math.round(pop / 10) * 10 + '%' : '';
      return '<div class="hr-cell hr-hour' + (i === 0 ? ' is-now' : '') + (night ? ' is-night' : '') +
        (hh === 0 && i !== 0 ? ' is-midnight' : '') + '" data-temp="' + h.temp_f + '" data-pop="' + pop + '">' +
        '<span class="hr-time">' + esc(label) + '</span>' +
        '<span class="hr-glyph" aria-hidden="true">' + skyGlyph(h.short, pop, night) + '</span>' +
        '<span class="hr-band"></span>' +
        '<span class="hr-temp">' + h.temp_f + '°</span>' +
        '<span class="hr-pop' + (pop >= 40 ? ' is-wet' : '') + '">' + popTxt + '</span>' +
        '<span class="hr-wind" title="Wind ' + esc(h.wind_dir || '') + ' ' + (h.wind_mph || 0) + ' mph">' +
          windArrow(h.wind_dir) + (h.wind_mph != null ? ' ' + h.wind_mph : '') + '</span>' +
        '<span class="sr-only">' + esc(label) + ': ' + h.temp_f + ' degrees, ' + esc(h.short || '') +
          (popTxt ? ', ' + popTxt + ' chance of rain' : '') + ', wind ' + esc(h.wind_dir || '') + ' ' + (h.wind_mph || 0) + ' mph</span>' +
        '</div>';
    }).join('');
    track.innerHTML = html + '<svg class="hr-chart" aria-hidden="true"></svg>';

    var story = el('hours-story');
    if (story) story.textContent = hoursStory(d, hours);
    renderHoursContext(d, hours);

    sec.hidden = false;
    // Draw the temperature line + rain bars once the cells have layout.
    requestAnimationFrame(function () { drawHourChart(track, tMin, tMax); });
    window.addEventListener('resize', function () { drawHourChart(track, tMin, tMax); });
  }

  function drawHourChart(track, tMin, tMax) {
    var svg = track.querySelector('.hr-chart');
    var hourCells = track.querySelectorAll('.hr-hour');
    var anyBand = track.querySelector('.hr-band');
    if (!svg || !hourCells.length || !anyBand) return;
    var W = track.scrollWidth, bandTop = anyBand.offsetTop, bandH = anyBand.offsetHeight;
    svg.setAttribute('width', W); svg.setAttribute('height', bandH);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + bandH);
    svg.style.top = bandTop + 'px';
    var pad = 6;
    var pts = [], bars = [];
    Array.prototype.forEach.call(hourCells, function (c) {
      var x = c.offsetLeft + c.offsetWidth / 2;
      var temp = parseFloat(c.getAttribute('data-temp'));
      var pop = parseFloat(c.getAttribute('data-pop')) || 0;
      var y = pad + (1 - (temp - tMin) / (tMax - tMin)) * (bandH - pad * 2);
      pts.push([x, y]);
      if (pop >= 10) {
        var bh = Math.max(2, (pop / 100) * (bandH - 4));
        bars.push('<rect class="hr-rain" x="' + (x - 9) + '" y="' + (bandH - bh) + '" width="18" height="' + bh + '" rx="2"></rect>');
      }
    });
    // Smooth-ish polyline: a Catmull-Rom-lite using midpoints.
    var dpath = '';
    pts.forEach(function (p, i) {
      if (i === 0) { dpath += 'M' + p[0] + ' ' + p[1]; return; }
      var prev = pts[i - 1];
      var mx = (prev[0] + p[0]) / 2;
      dpath += ' C' + mx + ' ' + prev[1] + ' ' + mx + ' ' + p[1] + ' ' + p[0] + ' ' + p[1];
    });
    var area = dpath + ' L' + pts[pts.length - 1][0] + ' ' + bandH + ' L' + pts[0][0] + ' ' + bandH + ' Z';
    svg.innerHTML = bars.join('') +
      '<path class="hr-area" d="' + area + '"></path>' +
      '<path class="hr-line" d="' + dpath + '"></path>' +
      '<circle class="hr-now-dot" cx="' + pts[0][0] + '" cy="' + pts[0][1] + '" r="3.5"></circle>';
  }

  /* ============================================================
     THE WEEK AHEAD — range rows
     NWS ships the 7-day as 14 half-day periods (day/night). We fold
     each pair into one calendar day and draw every day's low→high
     as a bar on ONE shared temperature scale for the week (the
     Apple 10-day idea), so a cool day visibly sits left of a warm
     one. Steve's one-line call rides on the row; the forecaster's
     full wording and the model check open underneath.
  ============================================================ */

  function groupForecastDays(periods) {
    var days = [], byKey = {};
    periods.forEach(function (p) {
      var key = p.start ? btvDayKey(p.start) : null;
      var day;
      if (key && byKey[key]) {
        day = byKey[key];
      } else if (!key && !p.is_day && days.length && days[days.length - 1].low == null) {
        // Data written before `start` existed: a night period belongs to
        // the day just before it.
        day = days[days.length - 1];
      } else {
        day = { key: key, start: p.start || null, high: null, low: null,
                dayShort: null, nightShort: null, dayPop: null, nightPop: null,
                wind: null, dayName: null, nightName: null,
                dayDetail: null, nightDetail: null };
        days.push(day);
        if (key) byKey[key] = day;
      }
      if (!day.start && p.start) day.start = p.start;
      if (p.is_day) {
        day.high = p.temp_f; day.dayShort = p.short; day.dayDetail = p.detailed;
        day.dayName = p.name; day.dayPop = p.pop; day.wind = p.wind;
      } else {
        day.low = p.temp_f; day.nightShort = p.short; day.nightDetail = p.detailed;
        day.nightName = p.name; day.nightPop = p.pop;
        if (!day.wind) day.wind = p.wind;
      }
    });
    return days;
  }

  // Temperature → hue on one fixed scale (not per-day, not per-week), so
  // 80° is always the same orange whatever the week looks like.
  function tempColor(t) {
    if (t == null) return 'var(--ink-4)';
    var x = clamp((t - 30) / 60, 0, 1); // 30°..90°
    var hue = 200 - x * 190;             // 200 (cool blue) → 10 (hot red-orange)
    var sat = 55 + x * 20, light = 52 - x * 4;
    return 'hsl(' + Math.round(hue) + ' ' + Math.round(sat) + '% ' + Math.round(light) + '%)';
  }

  function renderWeek(d, read) {
    var sec = el('week-section'), grid = el('week-grid');
    if (!sec || !grid) return;

    var periods = ((d.forecast || {}).periods) || [];
    var days = groupForecastDays(periods);
    if (days.length < 2) { sec.hidden = true; return; }

    var todayKey = btvDayKey(new Date());
    // Yesterday as a calendar day back from todayKey, not 24h of clock
    // time — the two disagree for an hour after the spring DST change.
    var tp = todayKey.split('-');
    var yesterdayKey = new Date(Date.UTC(+tp[0], +tp[1] - 1, +tp[2] - 1))
      .toISOString().slice(0, 10);

    // Steve's one-line call per day, from the same approved read the "My
    // read" section shows. Keyed by Burlington date so blurbs always land
    // on the right card. If the read is more than a day old (the pipeline
    // hiccuped), the fresh NWS wording is the honest fallback.
    var blurbs = {};
    if (read && Array.isArray(read.week) &&
        (read.date === todayKey || read.date === yesterdayKey)) {
      read.week.forEach(function (w) {
        if (w && w.date && w.blurb) blurbs[w.date] = w.blurb;
      });
    }

    var models = {};
    (((d.models || {}).days) || []).forEach(function (m) { if (m && m.date) models[m.date] = m; });

    // Shared scale for the week's bars.
    var allT = [];
    days.forEach(function (day) { if (day.high != null) allT.push(day.high); if (day.low != null) allT.push(day.low); });
    var sMin = Math.min.apply(null, allT), sMax = Math.max.apply(null, allT);
    if (sMax - sMin < 10) { sMin -= 5; sMax += 5; }
    function pct(t) { return clamp((t - sMin) / (sMax - sMin), 0, 1) * 100; }
    var nowTemp = (d.now || {}).temp_f;

    grid.innerHTML = days.map(function (day, i) {
      var label, sub = '';
      if (day.start) {
        var dt = new Date(day.start);
        label = day.key === todayKey ? 'Today' : btvWeekday(dt, 'short');
        sub = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: BTV_TZ });
      } else {
        label = (day.dayName || day.nightName || '').replace(/ Night$/, '');
      }
      var isToday = day.key === todayKey;
      // Daytime drives the row — it's what people plan around. A
      // night-only entry (the page loaded after dark) falls back to it.
      var short = day.dayShort || day.nightShort || '';
      var pop = day.dayPop != null ? day.dayPop : day.nightPop;
      // NWS rounds its prose to the nearest 10 ("Chance of precipitation
      // is 30%"); showing the raw API value (28%) next to that reads as a
      // contradiction, so the row rounds the same way.
      var popShown = pop != null && pop >= 20 ? Math.round(pop / 10) * 10 + '%' : '';
      var nightWet = day.dayPop != null && day.nightPop != null && day.nightPop - day.dayPop >= 30
        ? Math.round(day.nightPop / 10) * 10 + '% ' + (isToday ? 'tonight' : 'overnight') : '';

      // The bar: low → high on the shared scale, tinted by temperature.
      var lo = day.low, hi = day.high;
      var bar = '';
      if (lo != null || hi != null) {
        var a = lo != null ? lo : hi, b = hi != null ? hi : lo;
        if (a > b) { var tmp = a; a = b; b = tmp; }
        var left = pct(a), right = pct(b);
        var dot = '';
        if (isToday && nowTemp != null) {
          dot = '<span class="wk-now" style="left:' + pct(nowTemp) + '%" title="Right now: ' + nowTemp + '°"></span>';
        }
        bar = '<span class="wk-track"><span class="wk-fill" style="left:' + left + '%;width:' + Math.max(4, right - left) +
          '%;background:linear-gradient(90deg,' + tempColor(a) + ',' + tempColor(b) + ')"></span>' + dot + '</span>';
      }

      var model = day.key && models[day.key];
      var modelChip = '';
      if (model && model.high_f) {
        var names = Object.keys(model.high_f).filter(function (n) { return isFinite(model.high_f[n]); });
        var vals = names.map(function (n) { return Number(model.high_f[n]); });
        if (vals.length >= 2) {
          var spread = Math.max.apply(null, vals) - Math.min.apply(null, vals);
          if (spread >= 4) modelChip = ' <span class="wk-model-chip" title="The models disagree on the high">models ' +
            Math.min.apply(null, vals) + '–' + Math.max.apply(null, vals) + '</span>';
        }
      }

      var blurb = day.key && blurbs[day.key];
      var call = blurb ? '<span class="wk-call wk-call-steve">' + esc(blurb) + modelChip + '</span>'
                       : '<span class="wk-call">' + esc(short) + modelChip + '</span>';

      var nws = [];
      if (day.dayDetail) nws.push('<p><span class="week-detail-when">' + esc(day.dayName || 'Day') + '</span> ' + esc(day.dayDetail) + '</p>');
      if (day.nightDetail) nws.push('<p><span class="week-detail-when">' + esc(day.nightName || 'Night') + '</span> ' + esc(day.nightDetail) + '</p>');
      var more = (nightWet ? '<p class="wk-nightwet">' + esc(nightWet) + '</p>' : '') +
        (nws.length ? '<div class="wk-nws">' + nws.join('') + '</div>' : '');

      return '<div class="wk-row' + (isToday ? ' is-today' : '') + '" data-day="' + i + '">' +
        '<button class="wk-main" type="button" aria-expanded="false" aria-controls="wk-more-' + i + '">' +
          '<span class="wk-day"><span class="wk-day-name">' + esc(label) + '</span>' + (sub ? '<span class="wk-day-date">' + esc(sub) + '</span>' : '') + '</span>' +
          '<span class="wk-glyph" aria-hidden="true">' + skyGlyph(short, pop) + '</span>' +
          '<span class="wk-pop">' + popShown + '</span>' +
          '<span class="wk-lo">' + (lo != null ? lo + '°' : '—') + '</span>' +
          bar +
          '<span class="wk-hi">' + (hi != null ? hi + '°' : '—') + '</span>' +
          call +
          '<span class="wk-caret" aria-hidden="true">›</span>' +
        '</button>' +
        '<div class="wk-more" id="wk-more-' + i + '" hidden>' + more + '</div>' +
        '</div>';
    }).join('');

    grid.addEventListener('click', function (e) {
      var btn = e.target.closest('.wk-main');
      if (!btn) return;
      var row = btn.closest('.wk-row');
      var more = row.querySelector('.wk-more');
      var open = btn.getAttribute('aria-expanded') === 'true';
      // one open at a time keeps the rail scannable
      Array.prototype.forEach.call(grid.querySelectorAll('.wk-row'), function (r) {
        r.classList.remove('is-open');
        r.querySelector('.wk-main').setAttribute('aria-expanded', 'false');
        r.querySelector('.wk-more').hidden = true;
      });
      if (!open) {
        row.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        more.hidden = false;
      }
    });

    var issued = (d.forecast || {}).updated || (d.sections_updated || {}).forecast;
    var note = el('week-note');
    if (note && issued) {
      note.innerHTML = 'Forecast issued ' + esc(fmtAgo(issued)) +
        ' by <a href="https://www.weather.gov/btv/" target="_blank" rel="noopener">NWS Burlington</a>.';
    }
    sec.hidden = false;
  }

  /* ============================================================
     LIFE SCORES — cards
  ============================================================ */

  function sparkline(series, windowIdx) {
    if (!series || series.length < 2) return '';
    var W = 120, H = 30, pad = 3;
    var n = series.length;
    function x(i) { return pad + (i / (n - 1)) * (W - pad * 2); }
    function y(s) { return pad + (1 - s / 10) * (H - pad * 2); }
    var band = '';
    if (windowIdx) {
      var x0 = x(windowIdx[0]) - (W - pad * 2) / (n - 1) / 2, x1 = x(windowIdx[1]) + (W - pad * 2) / (n - 1) / 2;
      band = '<rect class="spark-window" x="' + Math.max(0, x0) + '" y="0" width="' + (Math.min(W, x1) - Math.max(0, x0)) + '" height="' + H + '" rx="2"></rect>';
    }
    var pts = series.map(function (s, i) { return x(i) + ',' + y(s.score); }).join(' ');
    var area = 'M' + x(0) + ',' + H + ' L' + pts.replace(/ /g, ' L') + ' L' + x(n - 1) + ',' + H + ' Z';
    // Axis labels: start hour and end hour of the series, in the card text below.
    return '<svg class="life-spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      band + '<path class="spark-area" d="' + area + '"></path><polyline class="spark-line" points="' + pts + '"></polyline>' +
      '<circle class="spark-now" cx="' + x(0) + '" cy="' + y(series[0].score) + '" r="2.5"></circle></svg>';
  }

  function renderScores(d, openMeteo, sunsetAq) {
    var grid = el('life-grid');
    if (!grid) return;
    if (!d.hourly || !Array.isArray(d.hourly.hours) || !d.hourly.hours.length) {
      grid.innerHTML = '<p class="swim-empty">No hourly forecast in the latest data, so no scores right now — check the NWS links below instead.</p>';
      return;
    }

    // If the pipeline has been down long enough that the hourly forecast
    // is a day old, stale scores are worse than no scores.
    var hourlyAt = (d.sections_updated || {}).hourly || d.updated;
    if (hourlyAt && Date.now() - new Date(hourlyAt).getTime() > 24 * HOUR) {
      grid.innerHTML = '<p class="swim-empty">The score data is over a day old (last refresh ' +
        fmtAgo(hourlyAt) + '), so no scores right now — check the NWS links below instead.</p>';
      return;
    }

    var ctx = d.__ctx;
    ctx.openMeteo = openMeteo;
    ctx.sunsetAq = sunsetAq;

    var html = SCORE_META.map(function (meta, idx) {
      var res = scoreActivity(meta.key, d.hourly.hours, ctx);
      if (!res) return '';
      var whyId = 'life-why-' + meta.key;
      var v = verdict(res.score);
      var scoreTxt = (Math.round(res.score * 10) / 10).toFixed(1).replace(/\.0$/, '');
      var whyRows = res.parts.map(function (p) {
        var sign = p.delta >= 0 ? '+' : '−';
        return '<div class="life-why-row"><span>' + esc(p.label) + '</span><span class="life-why-delta">' +
          sign + Math.abs(Math.round(p.delta * 10) / 10) + '</span></div>';
      }).join('');
      var spark = '';
      if (res.series && res.series.length > 1) {
        var endIso = new Date(new Date(res.series[res.series.length - 1].t).getTime() + HOUR).toISOString();
        spark = '<div class="life-spark-wrap" title="Score by the hour">' + sparkline(res.series, res.windowIdx) +
          '<span class="life-spark-axis"><span>now</span><span>' + esc(fmtHour(endIso)) + '</span></span></div>';
      }
      return '<div class="life-card life-' + v.cls + '">' +
        '<div class="life-head"><span class="life-icon" aria-hidden="true">' + meta.icon + '</span>' +
        '<span class="life-name">' + meta.name + '</span>' +
        '<button class="life-why-btn" type="button" aria-expanded="false" aria-controls="' + whyId + '" aria-label="Why this score?">why?</button></div>' +
        '<div class="life-score"><span class="life-num">' + scoreTxt + '</span><span class="life-outof">/10</span>' +
        '<span class="life-verdict">' + v.word + '</span></div>' +
        (res.window ? '<div class="life-window">' + esc(res.window) + '</div>' : '') +
        spark +
        (meta.link ? '<a class="life-deep-link" href="' + esc(meta.link) + '">' + esc(meta.linkText || 'More →') + '</a>' : '') +
        '<div class="life-why" id="' + whyId + '" hidden>' + whyRows + '</div>' +
        '</div>';
    }).join('');

    grid.innerHTML = html;

    grid.addEventListener('click', function (e) {
      var btn = e.target.closest('.life-why-btn');
      if (!btn) return;
      var card = btn.closest('.life-card');
      var why = card.querySelector('.life-why');
      var open = !why.hidden;
      why.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });
  }

  /* ---------- Can I Swim board ---------- */

  var STATUS_META = {
    green:   { dot: '🟢', word: 'Open — tested clean' },
    yellow:  { dot: '🟡', word: 'Caution' },
    red:     { dot: '🔴', word: 'Closed / advisory' },
    unknown: { dot: '⚪', word: 'No current data' }
  };

  function renderBeaches(d, beaches) {
    var wrap = el('swim-section');
    if (!wrap) return;
    var list = el('swim-board');
    var bd = (beaches && beaches.beaches) || [];

    // The one human sentence on top, from live conditions.
    var gage = d.lake_gage || {};
    var broad = ((d.lake_forecast || {}).broad || [])[0] || {};
    var greens = bd.filter(function (b) { return b.status === 'green'; });
    var reds = bd.filter(function (b) { return b.status === 'red'; });
    var sentence;
    if (bd.length && reds.length === bd.length) {
      sentence = 'Not today — every beach has a posted advisory. The lake will still be there tomorrow.';
    } else if (bd.length && !greens.length) {
      sentence = 'No beach has a confirmed-clean test right now — check the board below and believe the sign at the beach.';
    } else {
      var pick = greens.length ? greens[0].name : 'the lake';
      sentence = greens.length ? 'Best bet today is ' + pick : 'No beach results yet today';
      if (gage.water_temp_f != null) sentence += ' — the water is ' + gage.water_temp_f + '°';
      if ((broad.waves_ft_max != null && broad.waves_ft_max >= 2) ||
          (broad.wind_knots_max != null && broad.wind_knots_max >= 15)) {
        sentence += ', but wind builds on the broad lake' +
          (broad.waves_ft_max != null ? ', waves to ' + broad.waves_ft_max + ' ft' : '');
      } else if (broad.calm || (broad.wind_knots_max != null && broad.wind_knots_max <= 10)) {
        sentence += ' and the lake forecast is quiet';
      }
      sentence += '.';
    }
    el('swim-sentence').textContent = sentence;

    // One-word verdict (the Surfline "Fair / Good / Epic" idea): water
    // temp sets the ceiling, advisories and chop pull it down.
    var vEl = el('swim-verdict');
    if (vEl) {
      var wt = gage.water_temp_f, waves = broad.waves_ft_max;
      var vword = null, vcls = '';
      if (bd.length && reds.length === bd.length) { vword = 'Advisory — stay out'; vcls = 'swim-v-bad'; }
      else if (wt == null) { vword = null; }
      else if (wt < 60) { vword = 'Cold — ' + wt + '° water'; vcls = 'swim-v-bad'; }
      else if (wt < 66 || (waves != null && waves >= 3)) { vword = 'Fair'; vcls = 'swim-v-fair'; }
      else if (waves != null && waves >= 2) { vword = 'Good, some chop'; vcls = 'swim-v-good'; }
      else { vword = 'Good to swim'; vcls = 'swim-v-good'; }
      if (vword) { vEl.textContent = vword; vEl.className = 'swim-verdict ' + vcls; vEl.hidden = false; }
    }

    var cond = [];
    if (gage.water_temp_f != null) cond.push(['Water', gage.water_temp_f + '°']);
    if (broad.waves_ft_max != null) cond.push(['Waves', 'to ' + broad.waves_ft_max + ' ft']);
    if (broad.wind_knots_max != null) cond.push(['Wind', 'to ' + broad.wind_knots_max + ' kt']);
    if (gage.level_ft != null) cond.push(['Level', gage.level_ft + ' ft' + (gage.level_status ? ' · ' + gage.level_status : '')]);
    el('swim-conditions').innerHTML = cond.map(function (c) {
      return '<span class="swim-cond"><span class="swim-cond-k">' + esc(c[0]) + '</span><span class="swim-cond-v">' + esc(c[1]) + '</span></span>';
    }).join('');

    if (!bd.length) {
      list.innerHTML = '<p class="swim-empty">Beach test results load here once the season\'s data is flowing — ' +
        'check the city\'s <a href="https://enjoyburlington.com/" target="_blank" rel="noopener">beach page</a> meanwhile.</p>';
      return;
    }
    list.innerHTML = bd.map(function (b) {
      var s = STATUS_META[b.status] || STATUS_META.unknown;
      return '<div class="swim-row">' +
        '<span class="swim-dot" aria-hidden="true">' + s.dot + '</span>' +
        '<span class="swim-name">' + esc(b.name) + '</span>' +
        '<span class="swim-status">' + esc(b.reason || s.word) + '</span>' +
        (b.sampled ? '<span class="swim-when">' + esc(b.sampled) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  /* ---------- My Read ---------- */

  function renderRead(read) {
    var sec = el('read-section');
    if (!sec) return;
    if (!read || !read.text) {
      sec.hidden = true;
      return;
    }
    el('read-text').innerHTML = read.text.split(/\n\n+/).map(function (p) {
      return '<p>' + esc(p) + '</p>';
    }).join('');
    var editions = { morning: 'Morning read', midday: 'Midday update', evening: 'Evening update' };
    var stamp = (editions[read.edition] || 'Updated') + ' · ' + fmtAgo(read.approved_at);
    if (read.date) {
      var d = new Date(read.date + 'T12:00:00');
      stamp = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + stamp;
    }
    el('read-stamp').textContent = stamp;
    sec.hidden = false;
  }

  /* ---------- boot ---------- */

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function getNWS(url) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 6000);
    return fetch(url, {
      cache: 'no-cache',
      headers: { Accept: 'application/geo+json' },
      signal: controller ? controller.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (json) { clearTimeout(timer); return json; }, function (e) { clearTimeout(timer); throw e; });
  }

  function cToF(v) { return v == null ? null : Math.round(v * 9 / 5 + 32); }
  function kmToMph(v) { return v == null ? null : Math.round(v * 0.621371); }
  function valueOf(p, key) { return p[key] && p[key].value != null ? p[key].value : null; }
  function degreesToCompass(deg) {
    if (deg == null) return null;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
  }

  function patchLiveNWS(d, observationP, alertsP) {
    observationP.then(function (json) {
      var p = json && json.properties;
      if (!p || !p.timestamp || new Date(p.timestamp).getTime() <= new Date((d.now || {}).observed_at).getTime()) return;
      var temp = cToF(valueOf(p, 'temperature'));
      var heat = cToF(valueOf(p, 'heatIndex'));
      var chill = cToF(valueOf(p, 'windChill'));
      d.now = {
        observed_at: p.timestamp,
        temp_f: temp,
        feels_like_f: heat != null ? heat : chill != null ? chill : temp,
        humidity: valueOf(p, 'relativeHumidity') == null ? null : Math.round(valueOf(p, 'relativeHumidity')),
        dewpoint_f: cToF(valueOf(p, 'dewpoint')),
        wind_mph: kmToMph(valueOf(p, 'windSpeed')),
        wind_gust_mph: kmToMph(valueOf(p, 'windGust')),
        wind_dir: degreesToCompass(valueOf(p, 'windDirection')),
        description: p.textDescription || '',
        sky: null
      };
      d.__ctx = buildCtx(d);
      renderNow(d);
    }).catch(function () {});

    alertsP.then(function (json) {
      var features = json && json.features;
      if (!Array.isArray(features)) return;
      d.alerts = d.alerts || {};
      d.alerts.active = features.map(function (f) {
        var p = (f || {}).properties || {};
        return { event: p.event, headline: p.headline, severity: p.severity, expires: p.expires };
      });
      d.sections_updated = d.sections_updated || {};
      d.sections_updated.alerts = new Date().toISOString();
      renderAlerts(d);
    }).catch(function () {});
  }

  // The slow-moving context every renderer shares.
  function buildCtx(d) {
    var now = d.now || {};
    var broad = ((d.lake_forecast || {}).broad || [])[0] || {};
    var sun = d.sun || {};
    return {
      aqi: (d.air || {}).aqi,
      dewpointF: now.dewpoint_f,
      lakeTempF: (d.lake_gage || {}).water_temp_f,
      wavesFt: broad.waves_ft_max,
      uvMax: sun.uv_max,
      sunrise: sun.sunrise,
      sunset: sun.sunset,
      sunriseTomorrow: sun.sunrise_tomorrow,
      sunsetTomorrow: sun.sunset_tomorrow,
      latest: d,
      openMeteo: null
    };
  }

  function init() {
    // The week strip wants the read too (per-day blurbs), so fetch it once
    // and share the promise. A failed read is null — every consumer copes.
    var readP = getJSON(READ_URL).catch(function () { return null; });
    var sunsetP = getJSON(window.BtownSunsetScore.OPEN_METEO_URL)
      .catch(function () { return null; });
    var sunsetAqP = getJSON(window.BtownSunsetScore.AIR_URL)
      .catch(function () { return null; });
    // Start the live checks alongside the committed data request. Their
    // results are applied only after the file has painted successfully.
    var nwsObservationP = getNWS('https://api.weather.gov/stations/KBTV/observations/latest')
      .catch(function () { return null; });
    var nwsAlertsP = getNWS('https://api.weather.gov/alerts/active?point=44.4759,-73.2121')
      .catch(function () { return null; });

    getJSON(DATA_URL).then(function (d) {
      d.__ctx = buildCtx(d);
      window.btownWeatherData = d;
      window.dispatchEvent(new CustomEvent('btown:weather-data', { detail: d }));
      renderAlerts(d);
      renderNow(d);
      renderHours(d);
      patchLiveNWS(d, nwsObservationP, nwsAlertsP);
      readP.then(function (read) { renderWeek(d, read); });
      Promise.all([sunsetP, sunsetAqP]).then(function (r) { renderScores(d, r[0], r[1]); });
      getJSON(BEACH_URL).then(function (b) { renderBeaches(d, b); })
        .catch(function () { renderBeaches(d, null); });
      var page = el('rn-page');
      if (page) page.hidden = false;
    }).catch(function (e) {
      var err = el('rn-error');
      if (err) { err.hidden = false; }
      console.error('weather data failed to load', e);
    });

    readP.then(renderRead);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
