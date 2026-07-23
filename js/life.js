/* ============================================================
   BURLINGTON RIGHT NOW — life.js
   Renders weather.html from data/weather/latest.json (committed
   hourly by the refresh-weather Action), data/weather/read.json
   (Steve's approved morning read), and data/weather/beaches.json.

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
   (from the committed hourly forecast), which gives both the
   "now" score and the best-window hint ("best before 3 PM").
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

  function fmtClock(iso) {
    return new Date(iso).toLocaleTimeString('en-US',
      { hour: 'numeric', minute: '2-digit', timeZone: BTV_TZ });
  }

  function btvHour(dateOrIso) {
    var d = typeof dateOrIso === 'object' ? dateOrIso : new Date(dateOrIso);
    return parseInt(d.toLocaleString('en-US',
      { hour: 'numeric', hour12: false, timeZone: BTV_TZ }), 10) % 24;
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
    var t = new Date(hourIso).getTime();
    return t >= new Date(ctx.sunrise).getTime() && t <= new Date(ctx.sunset).getTime();
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

    /* SUNSET — is tonight's sunset worth walking to the water for?
       Scored against conditions at the sunset hour, not "now".
       Sky cover 25–60% is the sweet spot — clouds are the canvas;
       clear skies score decently (8-ish), overcast kills it.
       Rain at sunset kills it. Heavy wildfire smoke (AQI 100+)
       mutes color more than it adds drama, so it costs points.
       Comfort at the waterfront is a minor term — people bring
       layers for a great sky. */
    sunset: function (h, ctx) {
      var parts = [];
      var sky = h.sky;
      var skyScore;
      if (sky == null) skyScore = 6;
      else if (sky <= 10) skyScore = 7.5;                       // bare blue — fine, not epic
      else if (sky <= 65) skyScore = 10 - Math.abs(sky - 40) / 12; // clouds to light up
      else skyScore = clamp(10 - (sky - 65) * 0.22, 0, 7);      // filling in fast
      parts.push({ label: sky == null ? 'Sky cover unknown' : sky + '% sky cover at sunset', delta: skyScore });
      var rain = rainPenalty(h.pop, 8);
      if (rain >= 0.5) parts.push({ label: h.pop + '% chance of rain at sunset', delta: -rain });
      var smoke = ctx.aqi != null && ctx.aqi > 100 ? 2 : 0;
      if (smoke) parts.push({ label: 'Heavy smoke/haze (AQI ' + ctx.aqi + ')', delta: -smoke });
      var chill = (1 - comfort(h.feels_f, 55, 85, 25, 15)) * 1.5;
      if (chill >= 0.5) parts.push({ label: 'Feels like ' + h.feels_f + '° at the water', delta: -chill });
      return { score: clamp(skyScore - rain - smoke - chill, 0, 10), parts: parts };
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

  /* Score an activity across the remaining hours of today to get
     the current score and a best-window hint. `sunset` is special:
     it's always evaluated at the sunset hour. */
  function scoreActivity(key, hours, ctx) {
    var scorer = SCORERS[key];
    var now = Date.now();

    if (key === 'sunset') {
      // decide today vs tomorrow FIRST, then find that hour — otherwise a
      // just-past sunset still present in the hourly array gets scored but
      // labeled with tomorrow's time
      var sunsetIso = now > new Date(ctx.sunset).getTime() ? ctx.sunsetTomorrow : ctx.sunset;
      var setT = new Date(sunsetIso).getTime();
      var target = null;
      for (var i = 0; i < hours.length; i++) {
        var t = new Date(hours[i].t).getTime();
        if (t <= setT && setT < t + 3600000) { target = hours[i]; break; }
      }
      if (!target) target = hours[0];
      var r = scorer(target, ctx);
      return { score: r.score, parts: r.parts, window: 'sunset at ' + fmtClock(sunsetIso) };
    }

    // hours still ahead of us in the Burlington day (open-window looks
    // 20h out so a morning visitor still sees tonight's overnight window)
    var hoursToMidnight = 24 - btvHour(new Date());
    var horizon = key === 'open_window' ? now + 20 * 3600000
                                        : now + hoursToMidnight * 3600000;
    var series = [];
    for (var k = 0; k < hours.length; k++) {
      var tk = new Date(hours[k].t).getTime();
      if (tk + 3600000 < now || tk > horizon) continue;
      series.push({ h: hours[k], r: scorer(hours[k], ctx) });
    }
    if (!series.length) series = [{ h: hours[0], r: scorer(hours[0], ctx) }];

    var current = series[0];
    // "better around…" suggestions stay inside waking hours — nobody
    // wants to hear their best run is at 1 AM. Open-window is the
    // exception: overnight is exactly when it matters.
    var best = series[0];
    for (var m = 1; m < series.length; m++) {
      var hh = btvHour(series[m].h.t);
      if (key !== 'open_window' && (hh >= 22 || hh < 6)) continue;
      if (series[m].r.score > best.r.score + 0.01) best = series[m];
    }

    var windowHint = null;
    if (best.r.score - current.r.score >= 1.5) {
      windowHint = 'better around ' + fmtClock(best.h.t);
    } else if (current.r.score >= 6) {
      // how long does the good stretch last?
      var until = null;
      for (var n = 0; n < series.length; n++) {
        if (series[n].r.score < 5) { until = series[n].h.t; break; }
      }
      if (until) windowHint = 'good until about ' + fmtClock(until);
    }
    return { score: current.r.score, parts: current.r.parts, window: windowHint };
  }

  /* ============================================================
     RENDERING
  ============================================================ */

  function renderNow(d) {
    var box = el('rn-stats');
    if (!box) return;
    var now = d.now || {};
    var sun = d.sun || {};
    var air = d.air || {};
    var gage = d.lake_gage || {};

    var bits = [];
    if (now.temp_f != null) {
      bits.push('<span class="rn-big">' + now.temp_f + '°</span>');
      if (now.feels_like_f != null && now.feels_like_f !== now.temp_f) {
        bits.push('feels like ' + now.feels_like_f);
      }
    }
    if (now.description) bits.push(esc(now.description.toLowerCase()));
    if (now.wind_mph != null) bits.push('wind ' + esc(now.wind_dir || '') + ' ' + now.wind_mph + ' mph');
    if (gage.water_temp_f != null) bits.push('lake ' + gage.water_temp_f + '°');
    if (air.aqi != null) bits.push('AQI ' + air.aqi + ' ' + esc((air.category || '').toLowerCase()));
    if (sun.sunset) bits.push('sunset ' + fmtClock(sun.sunset));
    box.innerHTML = bits.join('<span class="rn-dot">·</span>');

    var sub = el('rn-sub');
    var subBits = [];
    var fc = (d.forecast || {}).periods || [];
    if (fc.length) subBits.push(esc(fc[0].name) + ': ' + esc(fc[0].detailed));
    if (air.discussion) subBits.push(esc(air.discussion));
    sub.innerHTML = subBits.join(' ');

    if (now.observed_at) {
      // honest freshness: the top-level `updated` advances even when a
      // section failed and kept last-good data — report the forecast
      // section's own timestamp
      var su = d.sections_updated || {};
      var freshT = su.hourly || su.now || d.updated;
      el('rn-updated').textContent = 'Observed at the airport ' + fmtAgo(now.observed_at) +
        ' · forecast data ' + fmtAgo(freshT);
    }

    // alerts banner
    var alerts = (d.alerts || {}).active || [];
    var ab = el('rn-alerts');
    if (alerts.length) {
      ab.hidden = false;
      ab.innerHTML = alerts.map(function (a) {
        return '<a href="https://forecast.weather.gov/MapClick.php?lat=44.4759&lon=-73.2121" target="_blank" rel="noopener">⚠ ' +
          esc(a.headline || a.event) + '</a>';
      }).join('<br>');
    }
  }

  function renderScores(d) {
    var grid = el('life-grid');
    if (!grid || !d.hourly || !d.hourly.hours) return;

    // If the pipeline has been down long enough that the hourly forecast
    // is a day old, stale scores are worse than no scores.
    var hourlyAt = (d.sections_updated || {}).hourly || d.updated;
    if (hourlyAt && Date.now() - new Date(hourlyAt).getTime() > 24 * 3600000) {
      grid.innerHTML = '<p class="swim-empty">The score data is over a day old (last refresh ' +
        fmtAgo(hourlyAt) + '), so no scores right now — check the NWS links above instead.</p>';
      return;
    }

    var now = d.now || {};
    var lakeFc = d.lake_forecast || {};
    var broad = (lakeFc.broad || [])[0] || {};
    var ctx = {
      aqi: (d.air || {}).aqi,
      dewpointF: now.dewpoint_f,
      lakeTempF: (d.lake_gage || {}).water_temp_f,
      wavesFt: broad.waves_ft_max,
      uvMax: (d.sun || {}).uv_max,
      sunrise: (d.sun || {}).sunrise,
      sunset: (d.sun || {}).sunset,
      sunsetTomorrow: (d.sun || {}).sunset_tomorrow || (d.sun || {}).sunset
    };

    var html = SCORE_META.map(function (meta) {
      var res = scoreActivity(meta.key, d.hourly.hours, ctx);
      var v = verdict(res.score);
      var scoreTxt = (Math.round(res.score * 10) / 10).toFixed(1).replace(/\.0$/, '');
      var whyRows = res.parts.map(function (p) {
        var sign = p.delta >= 0 ? '+' : '−';
        return '<div class="life-why-row"><span>' + esc(p.label) + '</span><span class="life-why-delta">' +
          sign + Math.abs(Math.round(p.delta * 10) / 10) + '</span></div>';
      }).join('');
      return '<div class="life-card life-' + v.cls + '">' +
        '<div class="life-head"><span class="life-icon" aria-hidden="true">' + meta.icon + '</span>' +
        '<span class="life-name">' + meta.name + '</span>' +
        '<button class="life-why-btn" type="button" aria-expanded="false" aria-label="Why this score?">why?</button></div>' +
        '<div class="life-score"><span class="life-num">' + scoreTxt + '</span><span class="life-outof">/10</span>' +
        '<span class="life-verdict">' + v.word + '</span></div>' +
        (res.window ? '<div class="life-window">' + esc(res.window) + '</div>' : '') +
        (meta.link ? '<a class="life-deep-link" href="' + esc(meta.link) + '">' + esc(meta.linkText || 'More →') + '</a>' : '') +
        '<div class="life-why" hidden>' + whyRows +
        '<p class="life-why-note">Started from the feels-like comfort curve, then adjusted for what actually ruins ' +
        meta.name.toLowerCase() + '. Recomputed every hour.</p></div>' +
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
    if (reds.length === bd.length && bd.length) {
      sentence = 'Not today — every beach has a posted advisory. The lake will still be there tomorrow.';
    } else {
      var pick = greens.length ? greens[0].name : 'North Beach';
      sentence = 'Best bet today is ' + pick;
      if (gage.water_temp_f != null) sentence += ' — the water is ' + gage.water_temp_f + '°';
      if ((broad.waves_ft_max != null && broad.waves_ft_max >= 2) ||
          (broad.wind_knots_max != null && broad.wind_knots_max >= 15)) {
        sentence += ', but wind builds on the broad lake (' + esc(broad.text || '') + ')';
      } else if (broad.calm || (broad.wind_knots_max != null && broad.wind_knots_max <= 10)) {
        sentence += ' and the lake forecast is quiet';
      }
      sentence += '.';
    }
    el('swim-sentence').textContent = sentence;

    var condBits = [];
    if (gage.water_temp_f != null) condBits.push('Lake ' + gage.water_temp_f + '°');
    if (broad.waves_ft_max != null) condBits.push('waves to ' + broad.waves_ft_max + ' ft');
    if (broad.wind_knots_max != null) condBits.push('wind to ' + broad.wind_knots_max + ' kt on the broad lake');
    if (gage.level_ft != null) condBits.push('level ' + gage.level_ft + ' ft (' + gage.level_status + ')');
    el('swim-conditions').textContent = condBits.join(' · ');

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
    if (beaches.note) el('swim-note').textContent = beaches.note;
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

  function init() {
    getJSON(DATA_URL).then(function (d) {
      renderNow(d);
      renderScores(d);
      getJSON(BEACH_URL).then(function (b) { renderBeaches(d, b); })
        .catch(function () { renderBeaches(d, null); });
      var page = el('rn-page');
      if (page) page.hidden = false;
    }).catch(function (e) {
      var err = el('rn-error');
      if (err) { err.hidden = false; }
      console.error('weather data failed to load', e);
    });

    getJSON(READ_URL).then(renderRead).catch(function () { renderRead(null); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
