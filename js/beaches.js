/* ============================================================
   THE LAKE — beaches.html

   Same honest sky as the hub: phase and orb come from the real
   sunrise/sunset in data/weather/latest.json. The swim chips come
   from data/weather/beaches.json — the same file the weather page
   reads, so the two never disagree. The challenge checklist lives
   in localStorage; the lake keeps no accounts.

   Every panel degrades on its own: a fetch that fails leaves its
   chip quiet rather than taking the page down.
============================================================ */
(function () {
  'use strict';

  var TZ = 'America/New_York';
  var $ = function (id) { return document.getElementById(id); };

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function clockLabel(d) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour: 'numeric', minute: '2-digit'
    }).format(d);
  }

  function humanGap(mins) {
    if (mins < 1) return 'any minute now';
    if (mins < 60) return mins + ' min';
    var h = Math.floor(mins / 60), m = mins % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }

  /* ---------- the sky (same rules as the hub) ---------- */

  function skyPhase(now, rise, set) {
    var GOLD = 75 * 60000;
    var DUSK = 45 * 60000;
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

    if (!rise || !set) {
      var hr = new Date(now).getHours();
      var guess = hr < 5 || hr >= 21 ? 'night' : hr < 7 ? 'dawn' : hr < 9 ? 'morning' :
                  hr < 19 ? 'day' : hr < 20 ? 'golden' : 'dusk';
      root.setAttribute('data-phase', guess);
      var orb = $('orb');
      if (orb) orb.style.display = 'none';
      return;
    }

    var phase = skyPhase(now, rise, set);
    root.setAttribute('data-phase', phase);

    var cond = (weather.now && weather.now.description) || '';
    if (GREY.test(cond)) root.setAttribute('data-sky', 'grey');
    else root.removeAttribute('data-sky');

    placeOrb(now, rise, set, phase, sun);
    writeConditions(now, rise, set, weather, sun);
  }

  function placeOrb(now, rise, set, phase, sun) {
    var orb = $('orb');
    var glint = $('glint');
    if (!orb) return;

    var isNight = (phase === 'night');
    var p;

    if (isNight) {
      orb.classList.add('moon');
      var nextRise = sun.sunrise_tomorrow ? new Date(sun.sunrise_tomorrow).getTime() : rise + 86400000;
      var from = (now > set) ? set : rise - 86400000;
      var to = (now > set) ? nextRise : rise;
      p = (now - from) / (to - from);
    } else {
      orb.classList.remove('moon');
      p = (now - rise) / (set - rise);
    }
    p = Math.max(0, Math.min(1, p));

    var x = 8 + p * 84;
    var y = 74 - Math.sin(p * Math.PI) * 56;

    orb.style.left = x + '%';
    orb.style.top = y + '%';

    if (glint) {
      var low = !isNight && (phase === 'golden' || phase === 'dusk' || phase === 'dawn');
      glint.style.left = x + '%';
      glint.style.opacity = low ? '0.9' : (isNight ? '0.35' : '0.25');
    }
  }

  /* The hero line: the water, then the day around it. */
  function writeConditions(now, rise, set, weather, sun) {
    var el = $('conditions');
    if (!el) return;

    var bits = [];

    var gage = (weather && weather.lake_gage) || {};
    if (typeof gage.water_temp_f === 'number') {
      bits.push('the water is <strong>' + Math.round(gage.water_temp_f) + '°F</strong>');
    }

    if (now < set && now > rise) {
      bits.push('sunset in ' + humanGap(Math.round((set - now) / 60000)) +
        ' <span class="cond-at">(' + clockLabel(new Date(set)) + ')</span>');
    } else if (now >= set) {
      var nr = sun.sunrise_tomorrow ? new Date(sun.sunrise_tomorrow).getTime() : rise + 86400000;
      bits.push('sunrise in ' + humanGap(Math.round((nr - now) / 60000)));
    } else {
      bits.push('sunrise in ' + humanGap(Math.round((rise - now) / 60000)));
    }

    var w = weather.now || {};
    if (typeof w.temp_f === 'number') bits.push('<strong>' + Math.round(w.temp_f) + '°</strong> on shore');

    el.innerHTML =
      '<a class="conditions-link" href="weather.html" ' +
        'title="Burlington Right Now — lake, beaches, life scores">' +
        bits.join('<span class="sep">·</span>') +
        '<span class="conditions-go">Full conditions →</span>' +
      '</a>';
  }

  /* ---------- the swim chips ----------
     data/weather/beaches.json tracks the five city-tested beaches by name.
     Cards carry data-swim="<that name>"; anything else (Red Rocks, the
     waterfront) simply never gets a chip. */

  function chipFor(b) {
    var cls = b.status === 'green' ? 'chip-open' :
              b.status === 'red' ? 'chip-closed' : 'chip-caution';
    var word = b.status === 'green' ? 'Open' :
               b.status === 'red' ? 'Closed' : 'Caution';
    var title = b.reason || '';
    return '<span class="swim-chip ' + cls + '" title="' + title.replace(/"/g, '&quot;') + '">' +
      '<span class="chip-dot"></span>' + word + ' for swimming</span>';
  }

  function liveStatuses() {
    return getJSON('data/weather/beaches.json').then(function (data) {
      var beaches = data.beaches || [];
      if (!beaches.length) return;

      beaches.forEach(function (b) {
        var slots = document.querySelectorAll('[data-swim="' + b.name + '"]');
        for (var i = 0; i < slots.length; i++) slots[i].innerHTML = chipFor(b);
      });

      var green = beaches.filter(function (b) { return b.status === 'green'; }).length;
      var el = $('swim-count');
      if (el) {
        if (green === beaches.length) {
          el.innerHTML = '<span class="yes">All ' + green + ' tested beaches are open</span> for swimming today.';
        } else if (green === 0) {
          el.innerHTML = '<span class="no">No tested beaches are open</span> for swimming today — check the chips below.';
        } else {
          el.innerHTML = '<span class="yes">' + green + ' of ' + beaches.length + '</span> tested beaches are open for swimming today.';
        }
      }
    });
  }

  /* ---------- the hunt ----------
     Every challenge is a checkbox; ticks live in localStorage under one key.
     The running tally is the whole scoreboard — no accounts, no server,
     nothing to lose except your phone. */

  var HUNT_KEY = 'btown-beach-hunt';

  function loadHunt() {
    try { return JSON.parse(localStorage.getItem(HUNT_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function saveHunt(state) {
    try { localStorage.setItem(HUNT_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function initHunt() {
    var boxes = Array.prototype.slice.call(document.querySelectorAll('.hunt-item input[type="checkbox"]'));
    if (!boxes.length) return;

    var state = loadHunt();

    boxes.forEach(function (box) {
      var id = box.getAttribute('data-hunt');
      if (state[id]) box.checked = true;
      box.addEventListener('change', function () {
        if (box.checked) state[id] = 1;
        else delete state[id];
        saveHunt(state);
        tally();
      });
    });

    function tally() {
      var done = boxes.filter(function (b) { return b.checked; }).length;
      var el = $('hunt-tally');
      if (!el) return;
      if (!done) {
        el.textContent = boxes.length + ' challenges along the shore. Your phone remembers which ones you’ve done.';
      } else if (done === boxes.length) {
        el.innerHTML = '<strong>All ' + boxes.length + ' found.</strong> You know this lake better than most people who grew up here.';
      } else {
        el.innerHTML = '<strong>' + done + ' of ' + boxes.length + '</strong> found so far. The lake isn’t going anywhere.';
      }
    }

    tally();
  }

  /* ---------- arrival (same sweep as the hub) ---------- */

  function motion() {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm) return;

    var items = Array.prototype.slice.call(document.querySelectorAll('.spot, .card'));
    if (!items.length) return;

    items.forEach(function (el) { el.classList.add('reveal'); });
    var pending = items.slice();

    function sweep() {
      var vh = window.innerHeight;
      for (var i = pending.length - 1; i >= 0; i--) {
        var el = pending[i];
        var r = el.getBoundingClientRect();
        if (r.top >= vh * 0.94) continue;
        el.classList.add('seen');
        pending.splice(i, 1);
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

  /* ---------- go ---------- */

  function init() {
    getJSON('data/weather/latest.json')
      .then(function (weather) {
        paintSky(weather);
        setInterval(function () { paintSky(weather); }, 60000);
      })
      .catch(function () { paintSky({}); });

    liveStatuses().catch(function () {});
    initHunt();
    motion();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
