/* ============================================================
   SHARED SUNSET SCORE
   The Sunset Tracker owns this formula. Both sunset.html and
   weather.html call this module with the same weather feeds so
   their score and factor breakdown cannot drift apart.

   v2 additions:
   - THE LIGHT PATH: a sunset is lit from below the horizon, so
     the light that paints Burlington's clouds first crosses the
     air 60–130 km to the west. The forecast URL now samples the
     cloud layers at two points along tonight's actual sunset
     azimuth (it swings 236°–304° across the year) — a low/mid
     deck out there is a wall between us and the sun even when
     our own sky is a perfect canvas.
   - HAZE ALOFT: aerosol optical depth from Open-Meteo's
     air-quality feed. Ground AQI misses smoke layers aloft; AOD
     sees the whole column. A little aerosol deepens the reds
     (the sweet spot), a thick column smothers them.
============================================================ */

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BtownSunsetScore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BTV_TZ = 'America/New_York';
  var BTV_LAT = 44.4759, BTV_LON = -73.2121;

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  /* ---------- sunset geometry ---------- */

  // Solar declination (degrees) for a date — the standard cosine
  // approximation, good to ~0.5°, plenty for an azimuth label. Day of
  // year is taken in Burlington time so a late-night viewer in another
  // timezone doesn't shift the date.
  function declination(ms) {
    var p = new Date(ms).toLocaleDateString('en-CA', { timeZone: BTV_TZ }).split('-');
    var doy = Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(+p[0], 0, 0)) / 86400000);
    return -23.44 * Math.cos(2 * Math.PI / 365 * (doy + 10));
  }

  // Where on the horizon the sun goes down, degrees from true north.
  // Burlington range: ~236° (SW, winter) to ~304° (NW, summer).
  function sunsetAzimuth(ms) {
    var dec = declination(ms) * Math.PI / 180;
    var lat = BTV_LAT * Math.PI / 180;
    return 270 + Math.asin(Math.sin(dec) / Math.cos(lat)) * 180 / Math.PI;
  }

  // A point d km from Burlington along the azimuth (flat-earth math —
  // fine at 130 km for picking a forecast grid cell).
  function pointAlong(azDeg, km) {
    var az = azDeg * Math.PI / 180;
    return {
      lat: BTV_LAT + (km / 111.32) * Math.cos(az),
      lon: BTV_LON + (km / (111.32 * Math.cos(BTV_LAT * Math.PI / 180))) * Math.sin(az),
    };
  }

  // The light-path sample points, computed once at load. The azimuth
  // drifts under a degree per day, so scoring tomorrow with today's
  // sample coordinates moves the far grid point by a km or two —
  // noise at Open-Meteo's resolution. The azimuth NUMBER shown to
  // readers is computed per scored night in computeScore.
  var AZIMUTH = sunsetAzimuth(Date.now());
  var WEST_KM = [60, 130];
  var SAMPLES = [{ lat: BTV_LAT, lon: BTV_LON, km: 0 }].concat(
    WEST_KM.map(function (km) {
      var p = pointAlong(AZIMUTH, km);
      return { lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4, km: km };
    }));

  // One request, three points: Burlington + the two west samples.
  // Open-Meteo returns an ARRAY of result objects for multi-point URLs.
  var OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast' +
    '?latitude=' + SAMPLES.map(function (s) { return s.lat; }).join(',') +
    '&longitude=' + SAMPLES.map(function (s) { return s.lon; }).join(',') +
    '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m' +
    '&timezone=America%2FNew_York&forecast_days=3';

  // Aerosol optical depth for the whole air column over Burlington.
  var AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality' +
    '?latitude=' + BTV_LAT + '&longitude=' + BTV_LON +
    '&hourly=aerosol_optical_depth' +
    '&timezone=America%2FNew_York&forecast_days=3';

  // Burlington's slice of the (possibly multi-point) Open-Meteo reply.
  function primary(om) {
    return Array.isArray(om) ? om[0] : om;
  }

  /* ---------- lookups ---------- */

  // Open-Meteo hourly arrays are local-time strings "2026-07-10T20:00".
  function omIndexAt(om, ms) {
    var o = primary(om);
    if (!o || !o.hourly || !o.hourly.time) return -1;
    var key = new Date(ms).toLocaleString('sv-SE',
      { timeZone: BTV_TZ }).slice(0, 13).replace(' ', 'T'); // "YYYY-MM-DDTHH"
    for (var i = 0; i < o.hourly.time.length; i++) {
      if (o.hourly.time[i].slice(0, 13) === key) return i;
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

  // Cloud layers at one sample point for the sunset hour, or null.
  function layersAt(result, i) {
    if (!result || !result.hourly || i < 0) return null;
    var H = result.hourly;
    var low = H.cloud_cover_low && H.cloud_cover_low[i];
    var mid = H.cloud_cover_mid && H.cloud_cover_mid[i];
    var high = H.cloud_cover_high && H.cloud_cover_high[i];
    if (![low, mid, high].every(function (v) { return typeof v === 'number' && isFinite(v); })) return null;
    return { low: low, mid: mid, high: high };
  }

  // AOD at the sunset hour, or null.
  function aodAt(aq, ms) {
    if (!aq || !aq.hourly || !aq.hourly.time || !aq.hourly.aerosol_optical_depth) return null;
    var key = new Date(ms).toLocaleString('sv-SE',
      { timeZone: BTV_TZ }).slice(0, 13).replace(' ', 'T');
    for (var i = 0; i < aq.hourly.time.length; i++) {
      if (aq.hourly.time[i].slice(0, 13) === key) {
        var v = aq.hourly.aerosol_optical_depth[i];
        return typeof v === 'number' && isFinite(v) ? v : null;
      }
    }
    return null;
  }

  /* ---------- factor curves ---------- */

  // Piecewise: the high/mid "canvas" bonus. Peak reward for a
  // 30–55% deck; a fully sheeted sky blocks the sun itself.
  function canvasBonus(canvasPct) {
    if (canvasPct <= 0) return 0;
    if (canvasPct < 30) return 2.5 * canvasPct / 30;
    if (canvasPct <= 55) return 2.5;
    if (canvasPct <= 90) return 2.5 - 2.0 * (canvasPct - 55) / 35;
    return 0.5;
  }

  // Aerosol optical depth → color delta. Piecewise-linear so the
  // score doesn't jump between refreshes. The 0.05–0.30 band is the
  // photographer's sweet spot: enough particles to scatter deep reds,
  // not enough to smother them.
  var AOD_CURVE = [[0, 0.1], [0.05, 0.3], [0.15, 0.6], [0.30, 0], [0.5, -1.2], [1.0, -3.0]];
  function aodDelta(aod) {
    var c = AOD_CURVE;
    if (aod <= c[0][0]) return c[0][1];
    for (var i = 1; i < c.length; i++) {
      if (aod <= c[i][0]) {
        var t = (aod - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
        return c[i - 1][1] + t * (c[i][1] - c[i - 1][1]);
      }
    }
    return c[c.length - 1][1];
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

  /* ---------- the score ---------- */

  function computeScore(sunsetMs, om, latest, forceScore, aq) {
    var parts = [];
    var inputs = { low: null, mid: null, high: null, canvas: null, sky: null,
                   west: null, aod: null, azimuth: Math.round(sunsetAzimuth(sunsetMs)) };

    // The floor: a clear Champlain evening with the Adirondack
    // silhouette is never a zero. Everything moves from here.
    parts.push({
      label: 'Starting point', delta: 5.0,
      note: 'A clear evening over the Adirondacks is already decent — the rest of the sky decides how far up or down it goes.',
    });

    var i = omIndexAt(om, sunsetMs);
    var nws = nwsHourAt(latest, sunsetMs);
    if (nws) inputs.sky = nws.sky;
    var aod = aodAt(aq, sunsetMs);

    var o = primary(om);
    var here = i >= 0 ? layersAt(o, i) : null;
    var rh = here && o.hourly.relative_humidity_2m ? o.hourly.relative_humidity_2m[i] : null;
    // A null layer array (Open-Meteo gap) must not score as "clear" —
    // drop to the degraded NWS path instead.
    var degraded = !(here && typeof rh === 'number' && isFinite(rh));

    if (!degraded) {
      inputs.low = here.low; inputs.mid = here.mid; inputs.high = here.high;
      inputs.total = o.hourly.cloud_cover ? o.hourly.cloud_cover[i] : null;

      // High + mid clouds — the canvas.
      var canvas = clamp(here.high + 0.6 * here.mid, 0, 100);
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

      // Low clouds overhead — the local killer.
      var lp = -7 * Math.pow(here.low / 100, 1.6);
      parts.push({
        label: 'Low cloud deck (' + Math.round(here.low) + '%)',
        delta: lp,
        note: here.low >= 70 ? 'A low overcast wall on the horizon blocks the light path — the single biggest sunset killer.'
          : here.low >= 30 ? 'Some low clouds near the horizon may eat the last minutes of light.'
          : 'The horizon path is basically open — light can get under whatever is above.',
      });

      // THE LIGHT PATH — low/mid decks 60–130 km west, along tonight's
      // actual sunset azimuth. That air is where our color comes from:
      // after the sun drops, everything overhead is lit from out there.
      if (Array.isArray(om) && om.length >= 3) {
        var near = layersAt(om[1], omIndexAt(om[1], sunsetMs));
        var far = layersAt(om[2], omIndexAt(om[2], sunsetMs));
        if (near && far) {
          var block = function (l) { return clamp(l.low + 0.7 * l.mid, 0, 100); };
          var wall = 0.55 * block(near) + 0.45 * block(far);
          inputs.west = { near: near, far: far, wall: Math.round(wall) };
          var wp = -3.5 * Math.pow(wall / 100, 1.4);
          var slot = canvas >= 20 && wall <= 15;
          if (slot) wp += 0.5;
          parts.push({
            label: 'The sky out west (' + Math.round(wall) + '% wall)',
            delta: wp,
            note: slot ? 'Clear air over the Adirondacks with a canvas overhead — the classic under-lit setup. This is how the bangers happen.'
              : wall >= 60 ? 'A cloud wall sits over the mountains where the light has to come from — it can shut the show off even if our sky looks promising.'
              : wall >= 25 ? 'Some cloud out along the light path west of the lake — the color may arrive patchy.'
              : 'The path west over the Adirondacks is open — whatever is above us will get its light.',
          });
        }
      }

      // Humidity mutes the palette.
      var hp = -1.5 * clamp((rh - 65) / 25, 0, 1);
      parts.push({
        label: 'Humidity (' + Math.round(rh) + '%)',
        delta: hp,
        note: hp < -0.7 ? 'Muggy air scatters light every which way — colors go milky instead of crisp.'
          : 'Dry air keeps the reds and oranges saturated.',
      });

      // Visibility.
      var visM = o.hourly.visibility && typeof o.hourly.visibility[i] === 'number' ? o.hourly.visibility[i] : null;
      if (visM != null) {
        var visKm = visM / 1000;
        var vp = visKm >= 24 ? 0.5 : visKm >= 10 ? 0 : -2 * clamp((10 - visKm) / 7, 0, 1);
        // When the visibility loss IS the smoke the haze factor below
        // already charges for, don't charge it twice in full.
        if (vp < -0.7 && aod != null && aod >= 0.4) vp = -0.7;
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

    // Haze — one factor, not three. AOD (whole column, catches smoke
    // riding high) and AirNow AQI (ground level) describe the same
    // event; summing them double-charged smoke days, so the factor
    // takes the WORSE of the two penalties, and the AOD sweet-spot
    // bonus applies only when the ground air is clean too.
    var aqi = latest.air && latest.air.aqi;
    var smoky = /smoke|wildfire/i.test((latest.air && latest.air.discussion) || '');
    var aqiPen = aqi == null ? null : aqi <= 50 ? 0 : aqi <= 100 ? -0.5 : aqi <= 150 ? -1.5 : -3.5;
    var hazeDelta = null;
    if (aod != null) {
      inputs.aod = Math.round(aod * 100) / 100;
      var ad = aodDelta(aod);
      hazeDelta = ad >= 0 ? (aqiPen === 0 || aqiPen == null ? ad : aqiPen)
                          : Math.min(ad, aqiPen == null ? 0 : aqiPen);
    } else if (aqiPen != null) {
      hazeDelta = aqiPen;
    }
    if (hazeDelta != null) {
      var hazeLabel = 'Haze (' +
        (aod != null ? 'AOD ' + aod.toFixed(2) : '') +
        (aod != null && aqi != null ? ' · ' : '') +
        (aqi != null ? 'AQI ' + aqi : '') +
        (smoky ? ', wildfire smoke' : '') + ')';
      parts.push({
        label: hazeLabel,
        delta: Math.round(hazeDelta * 10) / 10,
        note: hazeDelta > 0 ? 'Just enough aerosol in the column to deepen the reds, with clean air at the ground — the photographer’s sweet spot.'
          : hazeDelta === 0 ? 'Clean air, top to bottom — full-strength color.'
          : hazeDelta >= -1.2 ? 'A hazy column overhead mutes the palette a little.'
          : 'A thick aerosol layer' + (smoky ? ' of wildfire smoke' : '') + ' smothers the color into a dull disc.',
      });
      inputs.haze = hazeDelta;
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
    return { score: Math.round(score * 10) / 10, parts: parts, inputs: inputs, degraded: degraded };
  }

  return {
    OPEN_METEO_URL: OPEN_METEO_URL,
    AIR_URL: AIR_URL,
    SAMPLES: SAMPLES,
    AZIMUTH: AZIMUTH,
    computeScore: computeScore,
    omIndexAt: omIndexAt,
    nwsHourAt: nwsHourAt,
    selectTarget: selectTarget,
    primary: primary,
    layersAt: layersAt,
    aodAt: aodAt,
    sunsetAzimuth: sunsetAzimuth,
  };
});
