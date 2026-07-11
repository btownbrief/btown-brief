/* ============================================================
   AUTO THEME — the guide follows the sun

   Light while the sun is up over Burlington, dark once it sets.
   Not the reader's OS preference and not a clock guess: the real
   sunrise/sunset out of data/weather/latest.json, the same times
   the sunset page scores against.

   Two rules:
   - If the reader hits the toggle, we stop. Their choice wins for
     as long as they're on the page. (It resets on reload, which is
     how the rest of the guide already behaves.)
   - The times are cached so the NEXT page load can theme itself
     before first paint, with no white flash at midnight. The inline
     snippet in each page's <head> reads that cache; this file
     refreshes it.
============================================================ */
(function () {
  'use strict';

  var KEY = 'btown-sun';       // { day: 'YYYY-MM-DD', rise: ms, set: ms }
  var manual = false;          // did the reader take over?

  function todayInBurlington() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());     // en-CA gives YYYY-MM-DD
  }

  function apply(rise, set) {
    if (manual) return;
    var now = Date.now();
    var isDay = now >= rise && now < set;
    var html = document.documentElement;
    var want = isDay ? 'light' : 'dark';
    if (html.getAttribute('data-theme') !== want) {
      html.setAttribute('data-theme', want);
    }
  }

  function cache(rise, set) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        day: todayInBurlington(), rise: rise, set: set
      }));
    } catch (e) { /* private browsing — we just re-fetch next time */ }
  }

  function start(rise, set) {
    apply(rise, set);
    // Re-check each minute so an open tab flips at sunset rather than at reload.
    setInterval(function () { apply(rise, set); }, 60000);
  }

  // The reader's hand always beats the sun.
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#dark-toggle')) {
      manual = true;
    }
  }, true);

  fetch('data/weather/latest.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var sun = (d && d.sun) || {};
      if (!sun.sunrise || !sun.sunset) throw new Error('no sun times');
      var rise = new Date(sun.sunrise).getTime();
      var set = new Date(sun.sunset).getTime();
      cache(rise, set);
      start(rise, set);
    })
    .catch(function () {
      // No weather data? Leave the page exactly as it is rather than guessing
      // wrong — a mistimed flip is worse than no flip.
    });
})();

/* Mobile chip rail (.mode-nav) — every page with the nav loads this file.
   Two affordances, both only meaningful when the rail actually overflows:
     - the right-edge fade ("more this way"), cleared once you reach the end
       so the last chip doesn't read as permanently cut off;
     - position dots underneath, so the rail announces up front that it
       scrolls instead of making you discover it by accident.
   Dots are decorative (aria-hidden) — the chips themselves are the real nav. */
(function chipRail() {
  var rail = document.querySelector('.mode-nav');
  if (!rail) return;

  /* The nav lives inside a flex ROW, so a bare sibling would land beside the
     chips and steal their width. Wrap rail + dots in a column instead. */
  var wrap = document.createElement('div');
  wrap.className = 'mode-rail-wrap';
  rail.parentNode.insertBefore(wrap, rail);
  wrap.appendChild(rail);

  var dots = document.createElement('div');
  dots.className = 'mode-rail-dots';
  dots.setAttribute('aria-hidden', 'true');
  wrap.appendChild(dots);

  var pages = 0;

  function update() {
    var overflow = rail.scrollWidth - rail.clientWidth;
    var noOverflow = overflow <= 1;
    var atEnd = rail.scrollLeft >= overflow - 2;
    rail.setAttribute('data-scroll-end', String(noOverflow || atEnd));

    if (noOverflow) { dots.hidden = true; return; }
    dots.hidden = false;

    var want = Math.ceil(rail.scrollWidth / rail.clientWidth);
    if (want !== pages) {                      // rebuild only when count changes
      pages = want;
      dots.innerHTML = '';
      for (var i = 0; i < pages; i++) {
        var d = document.createElement('span');
        d.className = 'dot';
        dots.appendChild(d);
      }
    }
    // last page is short, so bias to the end once you're actually there
    var active = atEnd ? pages - 1 : Math.round(rail.scrollLeft / rail.clientWidth);
    for (var j = 0; j < dots.children.length; j++) {
      dots.children[j].setAttribute('data-active', String(j === active));
    }
  }

  rail.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
