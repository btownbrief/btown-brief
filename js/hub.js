/* ============================================================
   THE LAKE HOUR — guide hub

   Everything on this page is real. The sky phase comes from the
   actual sunrise/sunset in data/weather/latest.json, the orb sits
   where the sun actually is, and the tiles count live rows out of
   the same files the individual pages use.

   Every panel degrades on its own: a fetch that fails leaves its
   tile quiet rather than taking the page down.
============================================================ */
(function () {
  'use strict';

  var TZ = 'America/New_York';
  var $ = function (id) { return document.getElementById(id); };

  // The real forecast, for Burlington. The conditions line links straight to it.
  var NWS_FORECAST = 'https://forecast.weather.gov/MapClick.php?lat=44.4774048&lon=-73.2110569';

  /* ---------- helpers ---------- */

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  // Burlington's wall clock, whatever timezone the reader is in.
  function btParts(d) {
    var f = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short'
    });
    var out = {};
    f.formatToParts(d).forEach(function (p) { out[p.type] = p.value; });
    return out;
  }

  function clockLabel(d) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour: 'numeric', minute: '2-digit'
    }).format(d);
  }

  function relMinutes(ms) { return Math.round(ms / 60000); }

  function humanGap(mins) {
    if (mins < 1) return 'any minute now';
    if (mins < 60) return mins + ' min';
    var h = Math.floor(mins / 60), m = mins % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }

  /* ---------- the sky ---------- */

  function skyPhase(now, rise, set) {
    var GOLD = 75 * 60000;   // the long Champlain golden hour
    var DUSK = 45 * 60000;   // afterglow once the sun is down
    var DAWN = 60 * 60000;
    var MORN = 90 * 60000;

    if (now < rise - DAWN) return 'night';
    if (now < rise) return 'dawn';
    if (now < rise + MORN) return 'morning';
    if (now < set - GOLD) return 'day';
    if (now < set) return 'golden';
    if (now < set + DUSK) return 'dusk';
    return 'night';
  }

  var GREY = /(cloud|overcast|rain|shower|snow|fog|mist|storm|drizzle|haze)/i;

  function paintSky(weather) {
    var root = document.documentElement;
    var now = Date.now();

    var sun = (weather && weather.sun) || {};
    var rise = sun.sunrise ? new Date(sun.sunrise).getTime() : null;
    var set = sun.sunset ? new Date(sun.sunset).getTime() : null;

    // No sun data? Fall back to a plausible clock-based guess rather
    // than leaving the page in its default blue. Without a real sun arc
    // the orb has nowhere honest to sit, so it stays hidden.
    if (!rise || !set) {
      var hr = parseInt(btParts(new Date(now)).hour, 10);
      var guess = hr < 5 || hr >= 21 ? 'night' : hr < 7 ? 'dawn' : hr < 9 ? 'morning' :
                  hr < 19 ? 'day' : hr < 20 ? 'golden' : 'dusk';
      root.setAttribute('data-phase', guess);
      var orb = $('orb');
      if (orb) orb.style.display = 'none';
      return;
    }

    // The sun may already have set today; look ahead to tomorrow so the
    // "sunrise in ..." line stays truthful through the night.
    var phase = skyPhase(now, rise, set);
    root.setAttribute('data-phase', phase);

    var cond = (weather.now && weather.now.description) || '';
    if (GREY.test(cond)) root.setAttribute('data-sky', 'grey');
    else root.removeAttribute('data-sky');

    placeOrb(now, rise, set, phase, sun);
    writeConditions(now, rise, set, phase, weather, sun);

    // Tonight's sunset time, on the sunset card.
    var nextSet = (now < set) ? set
      : (sun.sunset_tomorrow ? new Date(sun.sunset_tomorrow).getTime() : null);
    if (nextSet) stat('stat-sunset', clockLabel(new Date(nextSet)));
  }

  // Put the sun (or moon) where it actually is in its arc.
  function placeOrb(now, rise, set, phase, sun) {
    var orb = $('orb');
    var glint = $('glint');
    if (!orb) return;

    var isNight = (phase === 'night');
    var p;

    if (isNight) {
      orb.classList.add('moon');
      // Track the moon across the dark hours from last sunset to next sunrise.
      var nextRise = sun.sunrise_tomorrow ? new Date(sun.sunrise_tomorrow).getTime() : rise + 86400000;
      var from = (now > set) ? set : rise - 86400000;
      var to = (now > set) ? nextRise : rise;
      p = (now - from) / (to - from);
    } else {
      orb.classList.remove('moon');
      p = (now - rise) / (set - rise);
    }
    p = Math.max(0, Math.min(1, p));

    // Left to right across the sky; a sine arc for the height.
    var x = 8 + p * 84;                       // percent
    var y = 74 - Math.sin(p * Math.PI) * 56;  // percent, lower number = higher up

    orb.style.left = x + '%';
    orb.style.top = y + '%';

    // The glitter path on the water only makes sense under a low sun.
    if (glint) {
      var low = !isNight && (phase === 'golden' || phase === 'dusk' || phase === 'dawn');
      glint.style.left = x + '%';
      glint.style.opacity = low ? '0.9' : (isNight ? '0.35' : '0.25');
    }
  }

  function writeConditions(now, rise, set, phase, weather, sun) {
    var el = $('conditions');
    if (!el) return;

    var bits = [];
    bits.push('<strong>' + clockLabel(new Date(now)) + '</strong>');

    // The single most Burlington fact: how long until the sun hits the lake.
    if (now < set && now > rise) {
      bits.push('sunset in ' + humanGap(relMinutes(set - now)));
    } else if (now >= set) {
      var nr = sun.sunrise_tomorrow ? new Date(sun.sunrise_tomorrow).getTime() : rise + 86400000;
      bits.push('sunrise in ' + humanGap(relMinutes(nr - now)));
    } else {
      bits.push('sunrise in ' + humanGap(relMinutes(rise - now)));
    }

    var w = weather.now || {};
    if (typeof w.temp_f === 'number') bits.push('<strong>' + Math.round(w.temp_f) + '°</strong>');
    if (w.description) bits.push(w.description.toLowerCase());

    /* The whole line — time, sunset, temp, sky — is a link to the NWS forecast
       for Burlington. People read the conditions and immediately want the real
       forecast; making them hunt for it was a dead end. */
    /* The line itself goes to OUR forecast — Burlington Right Now. The raw NWS
       sits alongside it for anyone who wants the source. */
    el.innerHTML =
      '<a class="conditions-link" href="weather.html" ' +
        'title="Burlington Right Now — lake, beaches, life scores">' +
        bits.join('<span class="sep">·</span>') +
        '<span class="conditions-go">BTown Brief Forecast →</span>' +
      '</a>' +
      '<a class="conditions-nws" href="' + NWS_FORECAST + '" target="_blank" rel="noopener" ' +
        'title="Raw forecast from the National Weather Service">NWS ↗</a>';
  }

  /* ---------- the live tiles ---------- */

  function tileOpenNow() {
    return getJSON('data/restaurants.json').then(function (data) {
      var list = data.restaurants || [];
      if (!window.BTFood) throw new Error('food-lib missing');
      var t = window.BTFood.now();          // { day, minutes } in Burlington time
      var open = 0;
      list.forEach(function (r) {
        var hours = r.hours;
        if (typeof hours === 'string') { try { hours = JSON.parse(hours); } catch (e) { return; } }
        if (!hours) return;
        if (window.BTFood.isOpenAt(hours, t.day, t.minutes)) open++;
      });
      countUp('open-count', open);
      set$('open-sub', 'of ' + list.length + ' places serving now');
      stat('stat-restaurants', open + ' open');
    });
  }

  function tileTonight() {
    return getJSON('data/events/events.json').then(function (data) {
      var evs = data.events || [];
      var today = btParts(new Date());
      var key = today.year + '-' + today.month + '-' + today.day;
      var now = Date.now();

      // "Tonight" = starts today, Burlington time, and hasn't already ended.
      var left = evs.filter(function (e) {
        if (!e.start) return false;
        var p = btParts(new Date(e.start));
        if (p.year + '-' + p.month + '-' + p.day !== key) return false;
        var endMs = e.end ? new Date(e.end).getTime() : new Date(e.start).getTime() + 7200000;
        return endMs >= now;
      });

      // Everything happening today, including what's already finished — so the
      // big number reads as "N of the day's M", the way Open Now does.
      var todayTotal = evs.filter(function (e) {
        if (!e.start) return false;
        var p = btParts(new Date(e.start));
        return p.year + '-' + p.month + '-' + p.day === key;
      }).length;

      countUp('tonight-count', left.length);
      set$('tonight-sub', left.length
        ? 'out of ' + todayTotal + ' today<br>still to come across town'
        : 'all ' + todayTotal + ' wrapped up for today');
      stat('stat-events', left.length + ' today');
    });
  }

  function tileLake(weather) {
    var gage = (weather && weather.lake_gage) || {};
    var temp = gage.water_temp_f;
    if (typeof temp === 'number') {
      countUp('lake-temp', Math.round(temp), function (n) {
        return n + '<span class="unit">°F</span>';
      });
    } else {
      set$('lake-temp', '—');
    }

    return getJSON('data/weather/beaches.json').then(function (data) {
      var beaches = data.beaches || [];
      var green = beaches.filter(function (b) { return b.status === 'green'; }).length;
      var el = $('lake-sub');
      if (!el || !beaches.length) return;
      if (green === beaches.length) {
        el.innerHTML = '<span class="yes">All ' + green + ' beaches open</span>';
      } else if (green === 0) {
        el.innerHTML = '<span class="no">No beaches open</span>';
      } else {
        el.innerHTML = '<span class="yes">' + green + '</span> of ' + beaches.length + ' beaches open';
      }
      stat('stat-weather', green + '/' + beaches.length + ' beaches');
    });
  }

  function statChanges() {
    return getJSON('data/changes/changes.json').then(function (data) {
      var items = data.events || [];
      if (items.length) stat('stat-changes', items.length + ' new');
    });
  }

  function statDeals() {
    return getJSON('data/deals.json').then(function (data) {
      var list = data.deals || [];
      if (!list.length || !window.BTFood) return;
      var t = window.BTFood.now();
      var today = list.filter(function (d) {
        try { return window.BTFood.dealAppliesToday(d, t); } catch (e) { return false; }
      });
      if (today.length) stat('stat-deals', today.length + ' today');
    });
  }

  function set$(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function stat(id, text) { var el = $(id); if (el) el.textContent = text; }

  /* ---------- the numbers roll ----------
     Every tile number counts up from zero on load. The page claims to be
     reading the city live, so its numbers should arrive like they were just
     counted — not like they were printed from a cache.

     render() wraps the running value, because the tiles aren't all bare ints:
     the lake carries a °F unit, Things To Do carries a "+".

     Honours prefers-reduced-motion — if the OS has been asked for less
     movement, the number is simply there. */
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function countUp(id, target, render, ms) {
    var el = $(id);
    if (!el) return;
    render = render || String;

    // Nothing to roll to (data missing) — just print whatever it is.
    if (typeof target !== 'number' || !isFinite(target)) { el.innerHTML = render(target); return; }
    if (REDUCED || target === 0) { el.innerHTML = render(target); return; }

    // A refetch mid-roll must not race a roll already in flight.
    if (el._raf) { cancelAnimationFrame(el._raf); el._raf = null; }

    var dur = ms || 1100;
    var t0 = null;
    function frame(now) {
      if (t0 === null) t0 = now;
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);   // easeOutCubic: quick off the line, settles gently
      el.innerHTML = render(Math.round(target * eased));
      if (p < 1) {
        el._raf = requestAnimationFrame(frame);
      } else {
        el._raf = null;
        el.innerHTML = render(target);      // land exactly on the real value
      }
    }
    el.innerHTML = render(0);
    el._raf = requestAnimationFrame(frame);
  }

  /* ---------- go ---------- */

  function init() {
    /* Things To Do is a fixed figure, not a fetched one — so nothing else would
       ever set it, and it would be the one tile sitting still while the other
       three rolled. Roll it too. */
    countUp('things-count', 202, function (n) { return n + '+'; });

    // The sky is the whole point — paint it first, and keep it honest
    // by repainting every minute so an open tab doesn't drift.
    getJSON('data/weather/latest.json')
      .then(function (weather) {
        paintSky(weather);
        setInterval(function () { paintSky(weather); }, 60000);
        tileLake(weather).catch(noop);
      })
      .catch(function () {
        paintSky({});   // still pick a phase off the clock
      });

    motion();

    tileOpenNow().catch(noop);
    tileTonight().catch(noop);
    statChanges().catch(noop);
    statDeals().catch(noop);
  }

  function noop() {}

  /* ---------- arrival ----------
     Cards settle in on scroll; the band photographs drift slower than the page.
     Anyone who asked their OS for less motion gets neither. */
  function motion() {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm) return;

    var items = Array.prototype.slice.call(document.querySelectorAll('.card, .tile, .band-copy'));
    var bands = Array.prototype.slice.call(document.querySelectorAll('.band'));
    if (!items.length && !bands.length) return;

    items.forEach(function (el) { el.classList.add('reveal'); });

    /* A plain scroll sweep, NOT IntersectionObserver.
       An element that goes from below the fold to above it — a fast flick, an
       anchor jump, a restored scroll position — never changes intersection
       state, so the observer never fires and the card stays invisible forever.
       A sweep simply cannot miss: anything at or above the fold gets revealed. */
    var pending = items.slice();

    function sweep() {
      var vh = window.innerHeight;
      for (var i = pending.length - 1; i >= 0; i--) {
        var el = pending[i];
        var r = el.getBoundingClientRect();
        if (r.top >= vh * 0.94) continue;           // still below the fold
        if (r.top > 0 && el.parentNode) {           // arriving: stagger it
          var row = Array.prototype.indexOf.call(el.parentNode.children, el);
          el.style.transitionDelay = Math.min(row, 6) * 45 + 'ms';
        }
        el.classList.add('seen');                   // already passed: no delay
        pending.splice(i, 1);
      }

      // The band photographs drift a little slower than the page.
      for (var j = 0; j < bands.length; j++) {
        var band = bands[j];
        var img = band.querySelector('.band-img');
        if (!img) continue;
        var b = band.getBoundingClientRect();
        if (b.bottom < -200 || b.top > vh + 200) continue;
        var t = (vh / 2 - (b.top + b.height / 2)) / (vh / 2 + b.height / 2);
        img.style.transform = 'translate3d(0,' + (t * 22).toFixed(1) + 'px,0)';
      }
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { sweep(); ticking = false; });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('load', onScroll);
    sweep();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* Tile blurbs — one line per tile, redrawn on every load so the page never
   reads the same way twice. Keep them one sentence and roughly one line long;
   they sit under the number and are meant to be skimmed, not studied. */
(function tileLines() {
  /* A sentence, not a fragment. One or two lines is fine — an earlier pass cut
     these to the bone chasing a single line and they read clipped. */
  var LINES = {
    open: [
      'Who still has the lights on and the fryer going, right this minute.',
      'Every kitchen in town, filtered down to the ones actually serving.',
      'Hungry now? These are the doors that are still open tonight.',
      'Live hours for the whole city, so you never drive to a dark window.',
      'Bars, caf&eacute;s and kitchens, sorted by whether you can walk in.',
    ],
    things: [
      'Swims, hikes, dive bars, bookshops and the best sunset benches.',
      'Two hundred-odd ways to spend an afternoon without leaving town.',
      'Everything worth doing here, in one long and fairly honest list.',
      'The beaches, the breweries, the back roads and the quiet corners.',
      'Famous, obscure, free and occasionally strange &mdash; the whole list.',
    ],
    events: [
      'Shows, markets and meetups happening between now and midnight.',
      'What&rsquo;s actually on tonight, gathered from twenty-six sources.',
      'Gigs, games and gatherings &mdash; all of today, in one place.',
      'Tonight in Burlington, hour by hour, with nothing padded out.',
      'Everything on today, and the next thirty days if you keep scrolling.',
    ],
    lake: [
      'How warm Champlain is, and whether it&rsquo;s worth getting in.',
      'Water temp, wind, waves, and whether tonight&rsquo;s sunset delivers.',
      'The lake, the sky, and a straight answer about going outside.',
      'Beach reports, swim conditions, and the state of the water.',
      'Champlain right now &mdash; in it, on it, or just looking at it.',
    ],
  };

  var nodes = document.querySelectorAll('.tile-line[data-line]');
  for (var i = 0; i < nodes.length; i++) {
    var pool = LINES[nodes[i].getAttribute('data-line')];
    if (!pool || !pool.length) continue;
    nodes[i].innerHTML = pool[Math.floor(Math.random() * pool.length)];
  }
})();
