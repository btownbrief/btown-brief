/* ============================================================
   SPONSOR FOOTER + HOUSE UNIT — shared by every guide page

   Include once, before nav.js:
     <div class="sponsor-footer" id="sponsor-footer" hidden></div>   (above the site footer)
     <script src="js/sponsor.js" defer></script>

   Reads data/sponsors.json. If a footer sponsor is active for this page and
   today's date, it renders "Sponsored · <name>". Otherwise it renders the
   HOUSE UNIT: one of three "this spot could be yours" lines pointing at
   advertise.html, rotating by day so the slot never looks static. Copy is
   advisor/data/drafts/money-2026-09/02-ad-introduction-letter.md Part 2;
   numbers come from data/media-kit-numbers.json (opens, never the list).

   Rules: never a price, never a scarcity claim, never a national brand.
   things-to-do's js/app.js delegates its footer to window.BtownSponsors.
============================================================ */
(function () {
  'use strict';
  var HOUSE = [
    { h: 'This spot is for rent.',
      p: '{opens} Burlington-area locals open this newsletter every time it goes out. One of them owns a business that belongs right here.',
      cta: 'Talk to Steve →', variant: 'direct' },
    { h: 'Your business, right here, twice a week.',
      p: 'Two sponsors an edition, no more. We design the ad for you. You get the numbers every month. Currently open.',
      cta: 'See how it works →', variant: 'specific' },
    { h: "Somebody's ad goes here soon.",
      p: 'If your business would like it to be yours, Burlington reads this thing twice a week.',
      cta: 'Get the details →', variant: 'quiet' }
  ];
  var ADVERTISE = 'advertise.html?utm_source=guide&utm_medium=house-unit';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
  function page() { return (location.pathname.split('/').pop() || 'index.html'); }
  function list(d) { return Array.isArray(d) ? d : (d && Array.isArray(d.sponsors) ? d.sponsors : []); }

  function active(s, placement) {
    if (!s || !s.active || s.placement !== placement) return false;
    var t = today();
    if (s.starts && t < s.starts) return false;
    if (s.ends && t > s.ends) return false;
    if (s.pages && s.pages.length && s.pages.indexOf(page()) === -1) return false;
    return true;
  }

  function dayIndex() {
    var d = new Date(today() + 'T12:00:00');
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }

  function houseUnit(numbers) {
    var opens = (numbers && numbers.opens_display) ? numbers.opens_display.charAt(0).toUpperCase() + numbers.opens_display.slice(1) : 'Nearly 2,000';
    var v = HOUSE[dayIndex() % HOUSE.length];
    var href = ADVERTISE + '&utm_content=' + v.variant + '&utm_page=' + encodeURIComponent(page());
    return '<span class="sponsor-label">Sponsor</span>' +
      '<div class="house-unit" data-variant="' + v.variant + '">' +
      '<strong>' + esc(v.h) + '</strong> ' +
      '<span>' + esc(v.p.replace('{opens}', opens)) + '</span> ' +
      '<a class="house-cta" href="' + href + '">' + esc(v.cta) + '</a></div>';
  }

  function sponsorRow(sponsors) {
    return '<span class="sponsor-label">Sponsored</span><div class="sponsor-row">' + sponsors.map(function (s) {
      var inner = s.image ? '<img src="' + esc(s.image) + '" alt="' + esc(s.name) + '" loading="lazy">' : esc(s.name);
      var tag = s.tagline ? '<span class="sponsor-tagline">' + esc(s.tagline) + '</span>' : '';
      return '<a class="sponsor-item" href="' + esc(s.url) + '" target="_blank" rel="noopener sponsored">' + inner + '</a>' + tag;
    }).join('') + '</div>';
  }

  var cache = null;
  function load() {
    if (cache) return cache;
    cache = Promise.all([
      fetch('data/sponsors.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      fetch('data/media-kit-numbers.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]);
    return cache;
  }

  function render(el) {
    el = el || document.getElementById('sponsor-footer');
    if (!el) return Promise.resolve();
    return load().then(function (res) {
      var sponsors = list(res[0]).filter(function (s) { return active(s, 'footer'); });
      el.innerHTML = sponsors.length ? sponsorRow(sponsors) : houseUnit(res[1]);
      el.classList.toggle('is-house', !sponsors.length);
      el.hidden = false;
    });
  }

  window.BtownSponsors = { render: render, active: active, list: list, HOUSE: HOUSE };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { render(); });
  else render();
})();
