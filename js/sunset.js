/* ============================================================
   THE SUNSET PAGE — sunset.js
   Renders sunset.html from:
   - data/weather/latest.json  (committed hourly by the refresh
     Action: NWS obs/hourly, AirNow AQI, USGS lake temp, AFD text,
     sun times, model spread)
   - Open-Meteo, fetched live client-side (keyless, like js/sun.js
     and js/weather.js) for the one thing the pipeline lacks:
     CLOUD LAYERS (low/mid/high) + visibility at sunset hour.
   - data/sunset-spots.json + data/sunset-gallery.json
   - Supabase RPCs (same project as the games/playlist) for spot
     upvotes, nightly "was it good?" ratings, and the photo queue.
     Until db/sunset.sql runs, all of that degrades silently.

   ── HOW THE SCORE WORKS ──────────────────────────────────────
   A sunset is light hitting the underside of clouds. So:
   - HIGH/MID CLOUDS are the canvas: a 25–60% deck of cirrus or
     altocumulus catches color for a great show (up to +2.5).
   - LOW CLOUDS are the killer: a deck near the horizon blocks
     the light path entirely (down to −7 at full overcast).
   - Clean dry air = crisp color; high humidity mutes it;
     smoke/haze (AQI) dims it; great visibility sharpens it.
   - POST-FRONTAL nights — cold front through, dry air behind —
     are Burlington's classic bangers, read from the NWS
     forecast discussion (+0.75).
   Every factor is shown to readers with its delta, so the page
   teaches you to read the sky yourself. Scores are 0–10.

   Confidence comes from lead time, NWS-vs-Open-Meteo agreement
   on cloud cover, model precip spread, and data freshness.

   ── PREVIEW OVERRIDES (same spirit as ?wx= and ?sunf=) ───────
   ?ssmin=38     pretend it's 38 minutes before sunset
   ?ssmin=-90    pretend sunset was 90 minutes ago
   ?sscore=8.2   force the final score (sky + verdict follow)
============================================================ */

(function () {
  'use strict';

  var DATA_URL = 'data/weather/latest.json';
  var SPOTS_URL = 'data/sunset-spots.json';
  var GALLERY_URL = 'data/sunset-gallery.json';
  var OM_URL = window.BtownSunsetScore.OPEN_METEO_URL;

  // Same Supabase project + anon key the rest of the site uses
  // (community.js / playlist.js). Anon key is public by design.
  var SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';

  var BTV_TZ = 'America/New_York';
  var GOLDEN_MIN = 45;   // golden hour ≈ last 45 min before sunset
  var LEAVE_MIN = 25;    // Church St → waterfront ≈ 15 min + settle in

  /* ---------- tiny helpers ---------- */

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtClock(ms) {
    return new Date(ms).toLocaleTimeString('en-US',
      { hour: 'numeric', minute: '2-digit', timeZone: BTV_TZ });
  }

  function btvDateKey(ms) { // YYYY-MM-DD in Burlington time
    return new Date(ms).toLocaleDateString('en-CA', { timeZone: BTV_TZ });
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  function rpc(fn, args) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    }).then(function (r) {
      if (!r.ok) throw new Error('rpc ' + fn + ' HTTP ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  // Same per-domain identity the games + playlist use.
  function visitorId() {
    var id = null;
    try { id = localStorage.getItem('btown-player-id'); } catch (e) {}
    if (!id) {
      id = 'v-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem('btown-player-id', id); } catch (e) {}
    }
    return id;
  }

  function lsGet(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  /* ---------- preview overrides ---------- */

  var params = new URLSearchParams(location.search);
  function numParam(name) {
    var v = parseFloat(params.get(name));
    return params.has(name) && isFinite(v) ? v : null;
  }
  var FORCE_SCORE = numParam('sscore');
  var FORCE_MIN = numParam('ssmin');

  /* The tracker formula lives in one shared module so this page and
     weather.html always use the same code, inputs, and target night. */
  var SunsetScore = window.BtownSunsetScore;
  var omIndexAt = SunsetScore.omIndexAt;
  var nwsHourAt = SunsetScore.nwsHourAt;

  function computeScore(sunsetMs, om, latest) {
    return SunsetScore.computeScore(sunsetMs, om, latest, FORCE_SCORE);
  }

  /* ---------- confidence ---------- */

  function computeConfidence(sunsetMs, nowMs, om, latest, degraded) {
    var pts = 0;
    var why = [];

    var hrsOut = (sunsetMs - nowMs) / 3600000;
    if (hrsOut <= 3) { pts += 2; why.push('sunset is close, so the forecast has little room to drift'); }
    else if (hrsOut <= 6) { pts += 1; why.push('a few hours out — clouds can still reshuffle'); }
    else if (hrsOut > 18) { pts -= 1; why.push('this far out, cloud forecasts are sketchy'); }

    var i = omIndexAt(om, sunsetMs);
    var nws = nwsHourAt(latest, sunsetMs);
    if (i >= 0 && nws && nws.sky != null) {
      var diff = Math.abs(om.hourly.cloud_cover[i] - nws.sky);
      if (diff <= 15) { pts += 1; why.push('NWS and Open-Meteo agree on cloud cover'); }
      else if (diff >= 35) { pts -= 1; why.push('our two cloud sources disagree by ' + Math.round(diff) + ' points'); }
    }

    var dateKey = btvDateKey(sunsetMs);
    var day = ((latest.models || {}).days || []).find(function (d) { return d.date === dateKey; });
    if (day && day.pop_max) {
      var pops = Object.values(day.pop_max);
      if (Math.max.apply(null, pops) - Math.min.apply(null, pops) >= 50) {
        pts -= 1; why.push('the big weather models disagree about rain');
      }
    }

    var ageH = (nowMs - new Date(latest.updated).getTime()) / 3600000;
    if (ageH > 3) { pts -= 1; why.push('our data refresh is running behind'); }
    if (degraded) { pts = Math.min(pts, 1); why.push('cloud-layer detail is missing'); }

    var level = pts >= 2 ? 'High' : pts >= 0 ? 'Medium' : 'Low';
    return { level: level, why: why.join('; ') || 'normal forecast uncertainty' };
  }

  /* ---------- verdict ---------- */

  function verdictFor(score, nowMs, sunsetMs, isTonight) {
    var goldenStart = sunsetMs - GOLDEN_MIN * 60000;
    var inWindow = nowMs >= goldenStart - 15 * 60000 && nowMs <= sunsetMs + 15 * 60000;
    if (score >= 6.5) {
      if (isTonight && inWindow) return 'GO OUTSIDE NOW';
      return isTonight ? 'Tonight’s a go' : 'Tomorrow looks like a go';
    }
    if (score >= 4.5) return 'Worth a walk';
    return isTonight ? 'Skip it tonight' : 'Probably skip it';
  }

  function subline(result, latest) {
    var best = null, worst = null;
    result.parts.forEach(function (p) {
      if (p.label === 'Starting point') return;
      if (!best || p.delta > best.delta) best = p;
      if (!worst || p.delta < worst.delta) worst = p;
    });
    if (result.score >= 6.5 && best && best.delta > 0.5) return best.note;
    if (result.score < 4.5 && worst && worst.delta < -0.5) return worst.note;
    return 'A middle-of-the-road sky — glance west around golden hour and decide for yourself.';
  }

  /* ============================================================
     THE SKY — paint the hero from the score + cloud mix
  ============================================================ */

  function hexLerp(a, b, t) {
    function ch(h, i) { return parseInt(h.slice(i, i + 2), 16); }
    function pad(n) { return ('0' + Math.round(n).toString(16)).slice(-2); }
    return '#' + pad(ch(a, 1) + (ch(b, 1) - ch(a, 1)) * t)
               + pad(ch(a, 3) + (ch(b, 3) - ch(a, 3)) * t)
               + pad(ch(a, 5) + (ch(b, 5) - ch(a, 5)) * t);
  }

  // Two skies, interpolated by score: a flat gray-blue dud and a
  // molten purple-to-coral banger. The lake darkens to match.
  var SKY_DUD  = { zen: '#46536A', mid: '#8A93A3', hor: '#C3C9D2', glow: 'rgba(255,224,190,0.28)', cloud: '#9AA3B0', lake: '#2A3A50' };
  var SKY_EPIC = { zen: '#2A3560', mid: '#8A5C86', hor: '#F2683C', glow: 'rgba(255,158,80,0.85)',  cloud: '#E8896B', lake: '#16263D' };
  var SKY_NIGHT = { zen: '#0F1A30', mid: '#16243D', hor: '#2B3A57', glow: 'rgba(255,170,110,0.12)', cloud: '#22314B', lake: '#0B1524' };

  function paintSky(score, inputs, isNight) {
    var hero = el('ss-hero');
    if (!hero) return;
    var t = clamp(score / 10, 0, 1);
    var set;
    if (isNight) {
      set = SKY_NIGHT;
      hero.classList.add('is-night');
    } else {
      hero.classList.remove('is-night');
      set = {
        zen: hexLerp(SKY_DUD.zen, SKY_EPIC.zen, t),
        mid: hexLerp(SKY_DUD.mid, SKY_EPIC.mid, t),
        hor: hexLerp(SKY_DUD.hor, SKY_EPIC.hor, t),
        glow: t >= 0.5 ? SKY_EPIC.glow : SKY_DUD.glow,
        cloud: hexLerp(SKY_DUD.cloud, SKY_EPIC.cloud, t),
        lake: hexLerp(SKY_DUD.lake, SKY_EPIC.lake, t),
      };
    }
    var canvas = inputs.canvas != null ? inputs.canvas : (inputs.sky != null ? inputs.sky : 35);
    hero.style.setProperty('--sky-zenith', set.zen);
    hero.style.setProperty('--sky-mid', set.mid);
    hero.style.setProperty('--sky-horizon', set.hor);
    hero.style.setProperty('--sky-glow', set.glow);
    hero.style.setProperty('--sky-cloud', set.cloud);
    hero.style.setProperty('--sky-cloud-o', clamp(canvas / 100 * (0.25 + 0.4 * t), 0.06, 0.6).toFixed(2));
    var lakeEl = el('ss-lake');
    if (lakeEl) lakeEl.style.setProperty('--lake', set.lake);
    if (lakeEl) lakeEl.style.setProperty('--sky-glow', set.glow);
  }

  /* ============================================================
     RENDER — hero, timing, vitals, factors
  ============================================================ */

  var state = {}; // shared render state for the ticker

  function nowMs() {
    if (FORCE_MIN != null && state.tonightSunset) {
      return state.tonightSunset - FORCE_MIN * 60000;
    }
    return Date.now();
  }

  function fmtDur(ms) {
    var m = Math.round(ms / 60000);
    if (m >= 100) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    if (m > 1) return m + ' min';
    var s = Math.max(0, Math.round(ms / 1000));
    return m === 1 ? '1 min' : s + 's';
  }

  function renderHero(latest, om) {
    var now = nowMs();
    var tonight = state.tonightSunset;

    // After the show (sunset + 20 min), the hero looks ahead.
    var selection = SunsetScore.selectTarget(latest, now);
    var isTonight = selection.isTonight;
    var target = selection.sunsetMs;
    state.targetSunset = target;
    state.isTonight = isTonight;

    var result = computeScore(target, om, latest);
    var conf = computeConfidence(target, now, om, latest, result.degraded);
    state.result = result;

    var dateLabel = new Date(target).toLocaleDateString('en-US',
      { weekday: 'long', month: 'long', day: 'numeric', timeZone: BTV_TZ });
    el('ss-hero-eyebrow').textContent =
      (isTonight ? 'Tonight over Lake Champlain · ' : 'Tomorrow over Lake Champlain · ') + dateLabel;

    el('ss-verdict').textContent = verdictFor(result.score, now, target, isTonight);
    el('ss-score-num').textContent = result.score.toFixed(1);
    el('ss-confidence').textContent = conf.level + ' confidence';
    el('ss-confidence').title = 'Why: ' + conf.why;
    el('ss-hero-sub').textContent = subline(result, latest);

    // Actual darkness (stars), independent of which night we score.
    var isNight = now > tonight + 40 * 60000 || now < new Date(latest.sun.sunrise).getTime() - 40 * 60000;
    paintSky(result.score, result.inputs, isNight);

    renderTiming();
    renderFactors(result, conf);
  }

  function renderTiming() {
    var now = nowMs();
    var target = state.targetSunset;
    var golden = target - GOLDEN_MIN * 60000;
    var leaveBy = target - LEAVE_MIN * 60000;

    // Countdown
    var cd = el('ss-countdown'), cdNote = el('ss-countdown-note');
    if (now < target) {
      cd.textContent = fmtDur(target - now);
      cdNote.textContent = 'sunset at ' + fmtClock(target);
    } else {
      cd.textContent = fmtClock(target);
      cdNote.textContent = 'the sun is down';
    }

    // Golden hour
    var g = el('ss-golden'), gNote = el('ss-golden-note');
    if (now < golden) {
      g.textContent = fmtClock(golden);
      gNote.textContent = 'golden hour starts';
    } else if (now < target + 10 * 60000) {
      g.textContent = 'Now';
      gNote.textContent = 'golden hour is on';
    } else {
      g.textContent = '—';
      gNote.textContent = 'golden hour has passed';
    }

    // Leave by (downtown → waterfront)
    var l = el('ss-leaveby'), lNote = el('ss-leaveby-note');
    if (now < leaveBy) {
      l.textContent = fmtClock(leaveBy);
      lNote.textContent = 'leave downtown by';
    } else if (now < target) {
      l.textContent = 'Hustle';
      lNote.textContent = 'you can still make Battery Park';
    } else {
      l.textContent = '—';
      lNote.textContent = 'catch tomorrow’s';
    }
  }

  function renderFactors(result, conf) {
    el('ss-factors-title').textContent =
      'How we read ' + (state.isTonight ? 'tonight' : 'tomorrow') + '’s sky';
    var list = el('ss-factors');
    var maxAbs = Math.max.apply(null, result.parts.map(function (p) {
      return p.label === 'Starting point' ? 0 : Math.abs(p.delta);
    }).concat([1]));

    list.innerHTML = result.parts.map(function (p) {
      var isBase = p.label === 'Starting point';
      var cls = p.delta > 0.05 ? 'is-plus' : p.delta < -0.05 ? 'is-minus' : 'is-zero';
      var sign = p.delta > 0 ? '+' : '';
      var width = isBase ? 0 : clamp(Math.abs(p.delta) / maxAbs * 50, 0, 50);
      return '<li class="ss-factor">' +
        '<span class="ss-factor-name">' + esc(p.label) + '</span>' +
        '<span class="ss-factor-delta ' + cls + '">' +
          (isBase ? p.delta.toFixed(1) : sign + p.delta.toFixed(1)) + '</span>' +
        '<span class="ss-factor-bar" aria-hidden="true">' +
          (width ? '<span class="ss-factor-fill ' + cls + '" style="width:' + width.toFixed(1) + '%"></span>' : '') +
        '</span>' +
        '<p class="ss-factor-note">' + esc(p.note) + '</p>' +
      '</li>';
    }).join('');

    el('ss-conf-foot').textContent =
      'Confidence is ' + conf.level.toLowerCase() + ' because ' + conf.why + '. The score refreshes with each hourly data update and as sunset gets closer.';
  }

  function renderVitals(latest) {
    var nowW = latest.now || {};
    if (nowW.temp_f != null) {
      el('ss-temp').textContent = Math.round(nowW.temp_f) + '°';
      el('ss-temp-note').textContent = (nowW.description || '') +
        (nowW.humidity != null ? ' · ' + nowW.humidity + '% humidity' : '');
    }

    var water = latest.lake_gage && latest.lake_gage.water_temp_f;
    if (water != null) {
      el('ss-water').textContent = Math.round(water) + '°';
      el('ss-water-note').textContent =
        water >= 72 ? 'Yes, you can stand in it — comfortably.' :
        water >= 65 ? 'You can stand in it. Brisk, but you’ll adjust.' :
        water >= 58 ? 'You can stand in it for about five minutes of regret.' :
        'No. That’s cold-plunge territory.';
    }

    if (nowW.wind_mph != null) {
      el('ss-wind').textContent = nowW.wind_mph + ' mph';
      el('ss-wind-note').textContent = (nowW.wind_dir ? 'from the ' + nowW.wind_dir + ' · ' : '') +
        (nowW.wind_mph <= 5 ? 'glassy lake tonight' : nowW.wind_mph <= 12 ? 'light chop, bring a layer' : 'windbreaker weather on the breakwater');
    }
  }

  /* ============================================================
     SPOTS — seed order, re-sorted by community votes
  ============================================================ */

  function renderSpots(spotsData, counts) {
    var votedIds = lsGet('btb-sunset-voted', {});
    var byId = {};
    (counts || []).forEach(function (r) {
      var n = Number(r.votes); // never trust a fetched value into innerHTML
      if (isFinite(n) && n >= 0) byId[r.spot_id] = Math.floor(n);
    });

    var spots = spotsData.spots.slice().map(function (s, idx) {
      s._votes = byId[s.id] || 0;
      s._seed = idx;
      return s;
    }).sort(function (a, b) { return b._votes - a._votes || a._seed - b._seed; });

    el('ss-spots').innerHTML = spots.map(function (s, i) {
      var voted = !!votedIds[s.id];
      return '<li class="ss-spot">' +
        '<span class="ss-spot-rank">' + (i + 1) + '</span>' +
        '<div>' +
          '<h3 class="ss-spot-name">' + esc(s.name) + '</h3>' +
          '<p class="ss-spot-meta">' + esc(s.area) +
            (s.walk_min ? ' · ' + s.walk_min + ' min walk from Church St' : '') + '</p>' +
          '<p class="ss-spot-why">' + esc(s.why) + '</p>' +
        '</div>' +
        '<button class="ss-spot-vote' + (voted ? ' voted' : '') + '" data-id="' + esc(s.id) + '" type="button" ' +
          'aria-pressed="' + (voted ? 'true' : 'false') + '" aria-label="Upvote ' + esc(s.name) + '">' +
          '<span class="ss-spot-vote-count">' + s._votes + '</span>' +
          '<span>' + (voted ? 'voted' : 'best spot?') + '</span>' +
        '</button>' +
      '</li>';
    }).join('');
  }

  function bindSpotVotes(spotsData) {
    el('ss-spots').addEventListener('click', function (e) {
      var btn = e.target.closest('.ss-spot-vote');
      if (!btn || btn.classList.contains('voted')) return;
      var id = btn.getAttribute('data-id');
      var votedIds = lsGet('btb-sunset-voted', {});
      if (votedIds[id]) return;
      votedIds[id] = true;
      lsSet('btb-sunset-voted', votedIds);
      btn.classList.add('voted');
      btn.setAttribute('aria-pressed', 'true');
      btn.querySelector('span:last-child').textContent = 'voted';
      var countEl = btn.querySelector('.ss-spot-vote-count');
      countEl.textContent = (parseInt(countEl.textContent, 10) || 0) + 1;
      rpc('btb_sunset_spot_vote', { p_spot: id, p_voter: visitorId() })
        .then(function (n) {
          if (typeof n === 'number') countEl.textContent = n;
          return rpc('btb_sunset_spot_counts');
        })
        .then(function (counts) { if (counts) renderSpots(spotsData, counts); })
        .catch(function () { /* table not created yet — local echo stands */ });
    });
  }

  /* ============================================================
     GALLERY + SUBMISSIONS
  ============================================================ */

  function renderGallery(gal) {
    var photos = (gal.photos || []).slice().sort(function (a, b) {
      return (b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : 0;
    });
    var grid = el('ss-gallery');
    if (!photos.length) {
      grid.innerHTML = '<div class="ss-gallery-empty">No nights archived yet — tonight could be the first. Send us your shot below.</div>';
      return;
    }
    grid.innerHTML = photos.map(function (p) {
      return '<a class="ss-photo" href="' + esc(p.image) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(p.image) + '" alt="' + esc(p.caption || 'Lake Champlain sunset') + '" loading="lazy">' +
        '<div class="ss-photo-caption">' +
          (p.caption ? '<strong>' + esc(p.caption) + '</strong>' : '') +
          '<span>📷 ' + esc(p.credit || 'Community submission') +
            (p.date ? ' · ' + esc(p.date) : '') + '</span>' +
        '</div>' +
      '</a>';
    }).join('');
  }

  function bindSubmitForm() {
    var form = el('ss-submit-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = el('ss-form-msg');
      var credit = el('ss-f-credit').value.trim();
      if (!credit) {
        msg.className = 'ss-form-msg err';
        msg.textContent = 'Add your name so we can credit you.';
        return;
      }
      rpc('btb_sunset_photo_submit', {
        p_credit: credit.slice(0, 80),
        p_contact: el('ss-f-contact').value.trim().slice(0, 120),
        p_photo_url: el('ss-f-url').value.trim().slice(0, 500),
        p_note: el('ss-f-note').value.trim().slice(0, 500),
      }).then(function () {
        form.reset();
        msg.className = 'ss-form-msg ok';
        msg.textContent = 'Got it — it’s in the review queue. If you have the photo as a file, email it and we’ll match it up.';
      }).catch(function () {
        msg.className = 'ss-form-msg err';
        msg.textContent = 'Couldn’t reach the queue — email your photo instead (link below).';
      });
    });
  }

  /* ============================================================
     RATING — "was tonight actually good?" (1–5), logged against
     the score we predicted. The seed of a self-correcting model.
  ============================================================ */

  function renderRating(latest, om) {
    var card = el('ss-rate-card');
    var now = nowMs();
    var tonight = state.tonightSunset;

    // The card opens 15 min before sunset and closes 4 h after.
    if (now < tonight - 15 * 60000 || now > tonight + 4 * 3600000) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    var nightKey = btvDateKey(tonight);
    var predicted = computeScore(tonight, om, latest).score;
    var rated = lsGet('btb-sunset-rated', {});

    el('ss-rate-sub').textContent =
      'We said ' + predicted.toFixed(1) + '/10. One tap — it trains the forecast.';

    var row = el('ss-rate-row');
    if (rated[nightKey]) {
      row.querySelectorAll('.ss-rate-btn').forEach(function (b) {
        b.classList.toggle('selected', parseInt(b.dataset.v, 10) === rated[nightKey]);
        b.disabled = true;
      });
      el('ss-rate-thanks').hidden = false;
      return;
    }

    if (state.rateBound) return; // renderRating runs every tick — bind once
    state.rateBound = true;
    row.addEventListener('click', function (e) {
      var btn = e.target.closest('.ss-rate-btn');
      if (!btn || btn.disabled) return;
      var v = parseInt(btn.dataset.v, 10);
      var seen = lsGet('btb-sunset-rated', {});
      if (seen[nightKey]) return;
      seen[nightKey] = v;
      lsSet('btb-sunset-rated', seen);
      row.querySelectorAll('.ss-rate-btn').forEach(function (b) {
        b.classList.toggle('selected', b === btn);
        b.disabled = true;
      });
      el('ss-rate-thanks').hidden = false;
      rpc('btb_sunset_rate', {
        p_night: nightKey, p_voter: visitorId(), p_rating: v, p_predicted: predicted,
      }).catch(function () { /* queue not created yet — local record stands */ });
    });
  }

  function renderAccuracy() {
    rpc('btb_sunset_accuracy', { p_limit: 14 }).then(function (rows) {
      if (!rows || !rows.length) return;
      var sec = el('ss-accuracy');
      sec.hidden = false;
      el('ss-accuracy-body').innerHTML = rows.map(function (r) {
        var d = new Date(r.night_key + 'T12:00:00');
        var label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        var pred = Number(r.avg_predicted), avg = Number(r.avg_rating), n = Number(r.n);
        var said = isFinite(pred) ? (Math.round(pred * 10) / 10).toFixed(1) : '—';
        var you = isFinite(avg) ? (Math.round(avg * 10) / 10).toFixed(1) : '—';
        return '<tr><td>' + esc(label) + '</td><td>' + said + ' / 10</td><td>' +
          you + ' / 5</td><td>' + (isFinite(n) ? Math.floor(n) : 0) + '</td></tr>';
      }).join('');
    }).catch(function () { /* not set up yet */ });
  }

  /* ============================================================
     BOOT
  ============================================================ */

  function boot() {
    Promise.all([
      fetchJSON(DATA_URL),
      fetchJSON(OM_URL).catch(function () { return null; }),
      fetchJSON(SPOTS_URL),
      fetchJSON(GALLERY_URL).catch(function () { return { photos: [] }; }),
    ]).then(function (res) {
      var latest = res[0], om = res[1], spots = res[2], gallery = res[3];

      state.tonightSunset = new Date(latest.sun.sunset).getTime();
      state.tomorrowSunset = new Date(latest.sun.sunset_tomorrow).getTime();
      // If the pipeline's "today" already rolled over (early morning),
      // sunset may be in the past by hours; the hero handles it by
      // targeting tomorrow.

      el('ss-page').hidden = false;
      renderHero(latest, om);
      renderVitals(latest);
      renderSpots(spots, null);
      bindSpotVotes(spots);
      rpc('btb_sunset_spot_counts')
        .then(function (counts) { if (counts && counts.length) renderSpots(spots, counts); })
        .catch(function () {});
      renderGallery(gallery);
      bindSubmitForm();
      renderRating(latest, om);
      renderAccuracy();

      // Ticker: every second inside the final 90 minutes, else every 30 s.
      var tick = function () {
        // A tab left open past tomorrow's sunset has outrun the data it
        // booted with — reload for fresh sun times (at most once an hour,
        // so a stalled data pipeline can't cause a reload loop).
        if (FORCE_MIN == null && Date.now() > state.tomorrowSunset + 20 * 60000) {
          var last = Number(sessionStorage.getItem('ss-reload') || 0);
          if (Date.now() - last > 3600000) {
            sessionStorage.setItem('ss-reload', String(Date.now()));
            location.reload();
            return;
          }
        }
        renderTiming();
        renderRating(latest, om);
        // Re-render hero on phase change (tonight → tomorrow flip).
        var shouldBeTonight = nowMs() <= state.tonightSunset + 20 * 60000;
        if (shouldBeTonight !== state.isTonight) renderHero(latest, om);
        var msTo = state.targetSunset - nowMs();
        setTimeout(tick, msTo > 0 && msTo < 90 * 60000 ? 1000 : 30000);
      };
      setTimeout(tick, 1000);
    }).catch(function (err) {
      var pg = el('ss-page');
      pg.hidden = false;
      el('ss-hero-inner').innerHTML =
        '<p class="ss-hero-eyebrow">Tonight over Lake Champlain</p>' +
        '<h1 class="ss-verdict">The sky is offline</h1>' +
        '<p class="ss-hero-sub">Couldn’t load the forecast data (' + esc(err.message) +
        '). The sunset is still happening — trust your eyes and walk west.</p>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
