/* ============================================================
   THINGS TO DO IN BURLINGTON — theme.js
   Dark-mode toggle for pages that don't load app.js
   (weather.html). Same in-memory behavior as the list page:
   resets on reload, no settings saved.
============================================================ */

(function () {
  'use strict';
  function wire() {
    var btn = document.getElementById('dark-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var html = document.documentElement;
      var isDark = html.getAttribute('data-theme') === 'dark';
      html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
