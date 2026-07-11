/* ============================================================
   BTOWN COMMUNITY SHARED — loaded by every page.
   - Injects the BTown strip (donate + newsletter + about) above the footer
   - Donate copy variants: flip ACTIVE_DONATE_VARIANT to 'B' to test the
     civic framing; both live below so swapping is a one-character change
   - Lightweight click tracking via the shared games Supabase project
     (run db/quick-wins.sql once to create it — until then this no-ops)
   - Dark-mode toggle for standalone pages (index.html binds its own
     via app.js, so this only binds when <body data-standalone> is set)
============================================================ */
(function () {
  'use strict';

  var KOFI_URL = 'https://ko-fi.com/btownbrief';

  var DONATE_COPY = {
    A: { // personal
      heading: 'One local guy builds all of this',
      body: 'The newsletter, this site, the games — it’s just me, Steve, at a laptop in Burlington. If it ever saved your weekend, a coffee keeps it going.',
      button: '☕ Buy me a coffee',
    },
    B: { // civic
      heading: 'Keep Burlington’s local info free',
      body: 'No paywall, no pop-ups, no autoplay video — just a free resource for everyone who loves this city. Chip in to keep it that way.',
      button: '❤️ Chip in on Ko-fi',
    },
  };
  // 'A' or 'B' pins one copy variant for everyone; 'AB' gives each visitor
  // a random sticky 50/50 assignment so btb_events can compare them fairly.
  var ACTIVE_DONATE_VARIANT = 'AB';

  function donateVariant() {
    if (ACTIVE_DONATE_VARIANT !== 'AB') return ACTIVE_DONATE_VARIANT;
    var v = null;
    try { v = localStorage.getItem('btb-donate-variant'); } catch (e) {}
    if (v !== 'A' && v !== 'B') {
      v = Math.random() < 0.5 ? 'A' : 'B';
      try { localStorage.setItem('btb-donate-variant', v); } catch (e) {}
    }
    return v;
  }

  /* ---------- click tracking (best-effort, silent) ---------- */
  var SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';

  function track(event, meta) {
    try {
      var body = JSON.stringify({
        p_event: event,
        p_page: location.pathname.split('/').pop() || 'index.html',
        p_variant: (meta && meta.variant) || null,
      });
      fetch(SUPABASE_URL + '/rest/v1/rpc/btb_track_event', {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* never let analytics break the page */ }
  }

  /* ---------- shared helpers ---------- */
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function fetchJSON(path) {
    var res = await fetch(path);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + path);
    return res.json();
  }

  // Same per-domain identity the games use (for playlist upvotes).
  function visitorId() {
    var id = localStorage.getItem('btown-player-id');
    if (!id) {
      id = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('btown-player-id', id);
    }
    return id;
  }

  /* ---------- the BTown strip ---------- */
  function renderStrip() {
    if (document.querySelector('.btb-strip')) return; // one per page, always
    var footer = document.querySelector('.site-footer');
    if (!footer) return;

    var variant = donateVariant();
    var copy = DONATE_COPY[variant] || DONATE_COPY.A;
    var strip = document.createElement('section');
    strip.className = 'btb-strip';
    strip.setAttribute('aria-label', 'Support the Burlington Brief');
    strip.innerHTML =
      '<div class="btb-strip-inner">' +
        '<div class="btb-strip-card btb-strip-donate">' +
          '<h2 class="btb-strip-heading">' + esc(copy.heading) + '</h2>' +
          '<p class="btb-strip-body">' + esc(copy.body) + '</p>' +
          '<a class="btb-donate-btn" href="' + KOFI_URL + '" target="_blank" rel="noopener" data-track="donate">' + esc(copy.button) + '</a>' +
        '</div>' +
        '<div class="btb-strip-card">' +
          '<h2 class="btb-strip-heading">The free newsletter</h2>' +
          '<p class="btb-strip-body">Burlington news, events, and weather in your inbox — the project that started all of this.</p>' +
          '<a class="btb-strip-link" href="https://btownbrief.com" target="_blank" rel="noopener" data-track="newsletter">Get the BTown Brief →</a>' +
        '</div>' +
        '<div class="btb-strip-card">' +
          '<h2 class="btb-strip-heading">Who’s behind this?</h2>' +
          '<p class="btb-strip-body">Not a media company. One neighbor with a soft spot for this town.</p>' +
          '<a class="btb-strip-link" href="https://www.btownbrief.com/about-me" target="_blank" rel="noopener" data-track="about">It’s just me — meet Steve →</a>' +
        '</div>' +
      '</div>';

    strip.addEventListener('click', function (e) {
      var a = e.target.closest('[data-track]');
      if (a) track('strip-' + a.getAttribute('data-track'), { variant: variant });
    });

    footer.parentNode.insertBefore(strip, footer);
  }

  /* ---------- dark toggle on standalone pages ---------- */
  function bindDarkToggle() {
    if (!document.body.hasAttribute('data-standalone')) return;
    var btn = document.getElementById('dark-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var html = document.documentElement;
      html.setAttribute('data-theme', html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  function init() {
    renderStrip();
    bindDarkToggle();
  }

  window.BTBC = { esc: esc, fetchJSON: fetchJSON, track: track, visitorId: visitorId };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
