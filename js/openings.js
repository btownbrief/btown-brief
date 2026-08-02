/* Openings & Closings — renders data/openings.json newest first,
   with status filter pills. Self-contained: this page rides on
   hub.css, not the app.js/BTBC stack the Lora pages share. */
(function () {
  'use strict';

  var STATUS_LABEL = {
    'open': 'Now open',
    'opening-soon': 'Coming soon',
    'closed': 'Closed',
  };

  var feed = document.getElementById('o-feed');
  var note = document.getElementById('o-note');
  var pills = Array.prototype.slice.call(document.querySelectorAll('.o-pill'));
  var entries = [];
  var active = 'all';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cardHTML(e) {
    var status = STATUS_LABEL[e.status] ? e.status : 'open';
    // Curated data, but still: only ever link http(s).
    var host = '', linkable = false;
    try {
      var u = new URL(e.source);
      linkable = u.protocol === 'http:' || u.protocol === 'https:';
      host = u.hostname.replace(/^www\./, '');
    } catch (err) {}
    return (
      '<article class="o-card">' +
        '<div class="o-meta">' +
          '<span class="o-status ' + status + '">' + esc(STATUS_LABEL[status]) + '</span>' +
          '<span>' + esc(e.dateLabel || e.date || '') + '</span>' +
        '</div>' +
        '<h3>' + esc(e.name) + '</h3>' +
        (e.area ? '<p class="o-area">' + esc(e.area) + '</p>' : '') +
        (e.story ? '<p class="o-story">' + esc(e.story) + '</p>' : '') +
        (linkable
          ? '<p class="o-source"><a href="' + esc(e.source) + '" target="_blank" rel="noopener">' +
              esc(e.sourceName || host || 'Source') + ' →</a></p>'
          : '') +
      '</article>'
    );
  }

  function render() {
    var shown = entries.filter(function (e) {
      return active === 'all' || e.status === active;
    });
    if (!shown.length) {
      feed.innerHTML = '<p class="o-empty">Nothing in this column right now — check back soon.</p>';
      return;
    }
    // A year marker whenever the feed crosses into an older year.
    var html = '', year = '';
    shown.forEach(function (e) {
      var y = String(e.date || '').slice(0, 4);
      if (y && y !== year) {
        year = y;
        html += '<h2 class="o-year">' + esc(y) + '</h2>';
      }
      html += cardHTML(e);
    });
    feed.innerHTML = html;
  }

  pills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      active = pill.getAttribute('data-filter');
      pills.forEach(function (p) {
        var on = p === pill;
        p.classList.toggle('is-active', on);
        p.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    });
  });

  fetch('data/openings.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      // Month-only dates ("2026-07") sort as the newest thing in their
      // month, so a fresh announcement isn't buried under day-stamped
      // entries from earlier in the month.
      function key(e) {
        var d = String(e.date || '');
        return d.length === 7 ? d + '-99' : d;
      }
      entries = (data.entries || []).slice().sort(function (a, b) {
        return key(b).localeCompare(key(a));
      });
      var counts = { all: entries.length };
      entries.forEach(function (e) {
        counts[e.status] = (counts[e.status] || 0) + 1;
      });
      pills.forEach(function (p) {
        var n = counts[p.getAttribute('data-filter')] || 0;
        p.insertAdjacentHTML('beforeend', '<span class="n">' + n + '</span>');
      });
      note.hidden = false;
      render();
    })
    .catch(function () {
      feed.innerHTML = '<p class="o-empty">Couldn’t load the list — try a refresh.</p>';
    });
})();
