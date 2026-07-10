/* Burlington Pulse — renders data/chatter.json (written by
   scripts/refresh_chatter.py a few times a day). Three blocks:
   trending topics with direction arrows, highlight slots, and the
   collapsed "rougher stuff" list. Everything links back to the
   original thread; rumors are always badged unverified. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;

  var DIRECTIONS = {
    hot:    { mark: '🔥', word: 'hot' },
    rising: { mark: '↗', word: 'rising' },
    fading: { mark: '↘', word: 'fading' },
    steady: { mark: '•', word: 'steady' },
  };

  /* Same shape as fmtAgo in js/life.js (not exported there). */
  function fmtAgo(iso) {
    if (!iso) return '';
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!isFinite(mins) || mins < 0) return '';
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var h = Math.round(mins / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function metaBits(item) {
    var bits = [];
    if (item.sub) bits.push(esc(item.sub));
    var ago = fmtAgo(item.when);
    if (ago) bits.push(esc(ago));
    if (typeof item.comments === 'number') {
      bits.push(item.comments + (item.comments === 1 ? ' comment' : ' comments'));
    }
    return bits.join(' · ');
  }

  function sourceRowHTML(s) {
    return (
      '<a class="pulse-source" href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
        '<span class="pulse-source-title">' + esc(s.title) + '</span>' +
        '<span class="pulse-source-meta">' + metaBits(s) + ' ↗</span>' +
      '</a>'
    );
  }

  function topicHTML(t) {
    var dir = DIRECTIONS[t.direction] || DIRECTIONS.steady;
    var meta = [];
    if (t.posts) meta.push(t.posts + (t.posts === 1 ? ' post' : ' posts'));
    if (typeof t.comments === 'number' && t.comments > 0) meta.push(t.comments + ' comments');
    return (
      '<details class="pulse-topic pulse-topic-' + esc(t.direction || 'steady') + '">' +
        '<summary>' +
          '<span class="pulse-topic-mark" aria-hidden="true">' + dir.mark + '</span>' +
          '<span class="pulse-topic-label">' + esc(t.label) +
            '<span class="visually-hidden"> (' + dir.word + ')</span></span>' +
          '<span class="pulse-topic-meta">' + esc(meta.join(' · ')) + '</span>' +
        '</summary>' +
        '<div class="pulse-topic-sources">' + (t.sources || []).map(sourceRowHTML).join('') + '</div>' +
      '</details>'
    );
  }

  function highlightHTML(h) {
    var badge = h.unverified
      ? '<span class="pulse-badge-unverified">Unverified</span>'
      : '';
    return (
      '<a class="pulse-hl' + (h.unverified ? ' pulse-hl-rumor' : '') + '" href="' + esc(h.url) + '" target="_blank" rel="noopener">' +
        '<span class="pulse-hl-slot">' + esc(h.slot_label) + badge + '</span>' +
        '<span class="pulse-hl-title">' + esc(h.title) + '</span>' +
        (h.blurb ? '<span class="pulse-hl-blurb">' + esc(h.blurb) + '</span>' : '') +
        '<span class="pulse-hl-meta">' + metaBits(h) + ' ↗</span>' +
      '</a>'
    );
  }

  function roughHTML(r) {
    return (
      '<a class="pulse-source" href="' + esc(r.url) + '" target="_blank" rel="noopener">' +
        '<span class="pulse-source-title">' + esc(r.title) + '</span>' +
        '<span class="pulse-source-meta">' + metaBits(r) + ' ↗</span>' +
      '</a>'
    );
  }

  window.BTBC.fetchJSON('data/chatter.json').then(function (data) {
    var topics = data.topics || [];
    var highlights = data.highlights || [];
    var rough = data.rough || [];

    var updated = document.getElementById('pulse-updated');
    var ago = fmtAgo(data.updated);
    updated.textContent = topics.length
      ? topics.length + ' topics from the last ' + (data.window_hours || 72) + ' hours' + (ago ? ' · updated ' + ago : '')
      : '';

    document.getElementById('pulse-topics').innerHTML = topics.length
      ? topics.map(topicHTML).join('')
      : '<p class="page-empty">Quiet out there right now — check back after the next refresh.</p>';

    if (highlights.length) {
      document.getElementById('pulse-highlights').innerHTML = highlights.map(highlightHTML).join('');
      document.getElementById('pulse-highlights-wrap').hidden = false;
    }

    if (rough.length) {
      document.getElementById('pulse-rough').innerHTML = rough.map(roughHTML).join('');
      document.getElementById('pulse-rough-wrap').hidden = false;
    }
  }).catch(function () {
    document.getElementById('pulse-topics').innerHTML =
      '<p class="page-empty">Could not load the chatter. Run a local server (<code>python3 -m http.server 8000</code>) if you’re previewing from disk.</p>';
  });
})();
