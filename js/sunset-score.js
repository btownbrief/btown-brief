/* ============================================================
   SHARED SUNSET SCORE
   The Sunset Tracker owns this formula. Both sunset.html and
   weather.html call this module with the same weather feeds so
   their score and factor breakdown cannot drift apart.
============================================================ */

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BtownSunsetScore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BTV_TZ = 'America/New_York';
  var OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast' +
    '?latitude=44.4759&longitude=-73.2121' +
    '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m' +
    '&timezone=America%2FNew_York&forecast_days=3';

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Open-Meteo hourly arrays are local-time strings "2026-07-10T20:00".
  function omIndexAt(om, ms) {
    if (!om || !om.hourly || !om.hourly.time) return -1;
    var key = new Date(ms).toLocaleString('sv-SE',
      { timeZone: BTV_TZ }).slice(0, 13).replace(' ', 'T'); // "YYYY-MM-DDTHH"
    for (var i = 0; i < om.hourly.time.length; i++) {
      if (om.hourly.time[i].slice(0, 13) === key) return i;
    }
    return -1;
  }

  function nwsHourAt(latest, ms) {
    var hours = (latest.hourly && latest.hourly.hours) || [];
    var best = null, bestDiff = Infinity;
    for (var i = 0; i < hours.length; i++) {
      var diff = Math.abs(new Date(hours[i].t).getTime() - ms);
      if (diff < bestDiff) { bestDiff = diff; best = hours[i]; }
    }
    return bestDiff <= 90 * 60000 ? best : null;
  }

  // Piecewise: the high/mid "canvas" bonus. Peak reward for a
  // 30–55% deck; a fully sheeted sky blocks the sun itself.
  function canvasBonus(canvasPct) {
    if (canvasPct <= 0) return 0;
    if (canvasPct < 30) return 2.5 * canvasPct / 30;
    if (canvasPct <= 55) return 2.5;
    if (canvasPct <= 90) return 2.5 - 2.0 * (canvasPct - 55) / 35;
    return 0.5;
  }

  function detectPostFrontal(latest) {
    var raw = (latest.afd && latest.afd.raw) || '';
    return (
      /(cold front|frontal (passage|boundary))[^.]{0,160}(passed|moved through|crossed|exited|pushed)/i.test(raw) ||
      /behind the (cold )?front/i.test(raw) ||
      /(significantly |much )?drier air(mass)?/i.test(raw)
    );
  }

  function selectTarget(latest, nowMs) {
    var tonight = new Date(latest.sun.sunset).getTime();
    var tomorrow = new Date(latest.sun.sunset_tomorrow).getTime();
    var isTonight = nowMs <= tonight + 20 * 60000;
    return { sunsetMs: isTonight ? tonight : tomorrow, isTonight: isTonight };
  }

  function computeScore(sunsetMs, om, latest, forceScore) {
    var parts = [];
    var inputs = { low: null, mid: null, high: null, canvas: null, sky: null };

    // The floor: a clear Champlain evening with the Adirondack
    // silhouette is never a zero. Everything moves from here.
    parts.push({
      label: 'Starting point', delta: 5.0,
      note: 'A clear evening over the Adirondacks is already decent — the rest of the sky decides how far up or down it goes.',
    });

    var i = omIndexAt(om, sunsetMs);
    var nws = nwsHourAt(latest, sunsetMs);
    if (nws) inputs.sky = nws.sky;

    // A null mid-array (Open-Meteo gap) must not score as "clear" —
    // drop to the degraded NWS path instead.
    if (i >= 0) {
      var H = om.hourly;
      var low = H.cloud_cover_low[i], mid = H.cloud_cover_mid[i], high = H.cloud_cover_high[i];
      var rh = H.relative_humidity_2m[i];
      if (![low, mid, high, rh].every(function (v) { return typeof v === 'number' && isFinite(v); })) {
        i = -1;
      }
    }
    if (i >= 0) {
      var visM = H.visibility && typeof H.visibility[i] === 'number' ? H.visibility[i] : null;
      inputs.low = low; inputs.mid = mid; inputs.high = high;
      inputs.total = H.cloud_cover[i];

      // High + mid clouds — the canvas.
      var canvas = clamp(high + 0.6 * mid, 0, 100);
      inputs.canvas = canvas;
      var cb = canvasBonus(canvas);
      parts.push({
        label: 'High-cloud canvas (' + Math.round(canvas) + '%)',
        delta: cb,
        note: cb >= 2 ? 'A broken deck of high clouds to catch the color — this is what great sunsets are made of.'
          : canvas <= 5 ? 'Almost no high clouds. Clean light, but nothing up there to paint.'
          : canvas > 90 ? 'The high deck is nearly solid — it can smother the sun instead of catching it.'
          : 'Some high clouds to work with.',
      });

      // Low clouds — the killer.
      var lp = -7 * Math.pow(low / 100, 1.6);
      parts.push({
        label: 'Low cloud deck (' + Math.round(low) + '%)',
        delta: lp,
        note: low >= 70 ? 'A low overcast wall on the horizon blocks the light path — the single biggest sunset killer.'
          : low >= 30 ? 'Some low clouds near the horizon may eat the last minutes of light.'
          : 'The horizon path is basically open — light can get under whatever is above.',
      });

      // Humidity mutes the palette.
      var hp = -1.5 * clamp((rh - 65) / 25, 0, 1);
      parts.push({
        label: 'Humidity (' + Math.round(rh) + '%)',
        delta: hp,
        note: hp < -0.7 ? 'Muggy air scatters light every which way — colors go milky instead of crisp.'
          : 'Dry air keeps the reds and oranges saturated.',
      });

      // Visibility.
      if (visM != null) {
        var visKm = visM / 1000;
        var vp = visKm >= 24 ? 0.5 : visKm >= 10 ? 0 : -2 * clamp((10 - visKm) / 7, 0, 1);
        parts.push({
          label: 'Visibility (' + (visKm >= 15 ? Math.round(visKm) : visKm.toFixed(1)) + ' km)',
          delta: vp,
          note: vp > 0 ? 'Champlain-crystal air — you’ll see the ridgeline like a paper cutout.'
            : vp < 0 ? 'Hazy air is already swallowing the horizon.'
            : 'Ordinary summer visibility.',
        });
      }
    } else {
      // Open-Meteo unavailable → score on NWS total sky cover only.
      var sky = nws ? nws.sky : null;
      if (sky != null) {
        var skyDelta = sky <= 10 ? 0.3
          : sky <= 60 ? 1.5 - Math.abs(sky - 35) / 25
          : -6 * Math.pow((sky - 60) / 40, 1.3);
        parts.push({
          label: 'Total cloud cover (' + sky + '%)',
          delta: clamp(skyDelta, -6, 1.5),
          note: 'Cloud-layer data is unavailable right now, so this is scored on total cloud cover only — a rougher read.',
        });
      } else {
        parts.push({ label: 'Cloud data unavailable', delta: 0, note: 'No cloud forecast reachable — treat tonight as a coin flip and look west anyway.' });
      }
    }

    // Rain chance at sunset (NWS hourly).
    if (nws && nws.pop != null && nws.pop > 5) {
      parts.push({
        label: 'Rain chance (' + nws.pop + '%)',
        delta: -3 * nws.pop / 100,
        note: nws.pop >= 50 ? 'Decent odds you’re watching this from under an awning.'
          : 'A small rain chance — though a passing shower can set up a rainbow-and-fire sky.',
      });
    }

    // Smoke / air quality (AirNow, from the pipeline).
    var aqi = latest.air && latest.air.aqi;
    if (aqi != null) {
      var ap = aqi <= 50 ? 0 : aqi <= 100 ? -0.5 : aqi <= 150 ? -1.5 : -3.5;
      var smoky = /smoke|wildfire/i.test((latest.air && latest.air.discussion) || '');
      parts.push({
        label: 'Air quality (AQI ' + aqi + (smoky ? ', wildfire smoke' : '') + ')',
        delta: ap,
        note: ap === 0 ? 'Clean air — full-strength color.'
          : aqi <= 100 ? 'A touch of haze' + (smoky ? ' from wildfire smoke' : '') + ' dims the show a little — though thin smoke can deepen the reds.'
          : 'Thick haze mutes everything to a dull orange smudge.',
      });
    }

    // Post-frontal clarity — Burlington's classic banger setup.
    if (detectPostFrontal(latest)) {
      parts.push({
        label: 'Post-frontal air',
        delta: 0.75,
        note: 'The forecast discussion says a front just cleared the region — scrubbed, dry air behind a front is how Champlain gets its famous ones.',
      });
    }

    var score = clamp(parts.reduce(function (s, p) { return s + p.delta; }, 0), 0, 10);
    if (forceScore != null && !isNaN(forceScore)) score = clamp(forceScore, 0, 10);
    return { score: Math.round(score * 10) / 10, parts: parts, inputs: inputs, degraded: i < 0 };
  }

  return {
    OPEN_METEO_URL: OPEN_METEO_URL,
    computeScore: computeScore,
    omIndexAt: omIndexAt,
    nwsHourAt: nwsHourAt,
    selectTarget: selectTarget,
  };
});
