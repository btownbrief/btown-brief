/* Burlington Pulse — renders data/chatter.json (written by
   scripts/refresh_chatter.py a few times a day). Four blocks:
   trending topics with direction arrows, highlight slots, and the
   local-news wire, and collapsed "rougher stuff" list. Everything
   links back to the original source; rumors are always badged unverified. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;

  /* esc() stops HTML injection but not scheme tricks — only reddit
     permalinks belong in these hrefs, so anything else becomes '#'. */
  function safeUrl(url) {
    return (typeof url === 'string' && url.indexOf('https://www.reddit.com/') === 0) ? url : '#';
  }

  function safeNewsUrl(url) {
    return (typeof url === 'string' && /^https?:\/\//i.test(url)) ? url : '#';
  }

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

  function fmtWireAgo(iso) {
    if (!iso) return '';
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!isFinite(mins) || mins < 0) return '';
    if (mins < 60) return Math.max(1, mins) + 'm ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.round(hours / 24) + 'd ago';
  }

  function sourceRowHTML(s) {
    return (
      '<a class="pulse-source" href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener">' +
        '<span class="pulse-source-title">' + esc(s.title) + '</span>' +
        '<span class="pulse-source-meta">' + metaBits(s) + ' ↗</span>' +
      '</a>'
    );
  }

  /* sources arrives pre-filtered by the subreddit chips; the cluster-wide
     comment total only stays truthful when nothing was filtered out. */
  function topicHTML(t, sources, unfiltered) {
    var dir = DIRECTIONS[t.direction] || DIRECTIONS.steady;
    var meta = [];
    meta.push(sources.length + (sources.length === 1 ? ' post' : ' posts'));
    if (unfiltered && typeof t.comments === 'number' && t.comments > 0) meta.push(t.comments + ' comments');
    return (
      '<details class="pulse-topic pulse-topic-' + esc(t.direction || 'steady') + '">' +
        '<summary>' +
          '<span class="pulse-topic-mark" aria-hidden="true">' + dir.mark + '</span>' +
          '<span class="pulse-topic-label">' + esc(t.label) +
            '<span class="visually-hidden"> (' + dir.word + ')</span></span>' +
          '<span class="pulse-topic-meta">' + esc(meta.join(' · ')) + '</span>' +
        '</summary>' +
        '<div class="pulse-topic-sources">' + sources.map(sourceRowHTML).join('') + '</div>' +
      '</details>'
    );
  }

  function highlightHTML(h) {
    var badge = h.unverified
      ? '<span class="pulse-badge-unverified">Unverified</span>'
      : '';
    return (
      '<a class="pulse-hl' + (h.unverified ? ' pulse-hl-rumor' : '') + '" href="' + esc(safeUrl(h.url)) + '" target="_blank" rel="noopener">' +
        '<span class="pulse-hl-slot">' + esc(h.slot_label) + badge + '</span>' +
        '<span class="pulse-hl-title">' + esc(h.title) + '</span>' +
        (h.blurb ? '<span class="pulse-hl-blurb">' + esc(h.blurb) + '</span>' : '') +
        '<span class="pulse-hl-meta">' + metaBits(h) + ' ↗</span>' +
      '</a>'
    );
  }

  function roughHTML(r) {
    return (
      '<a class="pulse-source" href="' + esc(safeUrl(r.url)) + '" target="_blank" rel="noopener">' +
        '<span class="pulse-source-title">' + esc(r.title) + '</span>' +
        '<span class="pulse-source-meta">' + metaBits(r) + ' ↗</span>' +
      '</a>'
    );
  }

  function newsHTML(item) {
    var ago = fmtWireAgo(item.published);
    return (
      '<a class="pulse-wire-item" href="' + esc(safeNewsUrl(item.url)) + '" target="_blank" rel="noopener">' +
        '<span class="pulse-wire-title">' + esc(item.title) + '</span>' +
        '<span class="pulse-wire-meta">' + esc(item.outlet) + (ago ? ' · ' + esc(ago) : '') + ' ↗</span>' +
      '</a>'
    );
  }

  function wire(news) {
    var wrap = document.getElementById('pulse-wire-wrap');
    var list = document.getElementById('pulse-wire');
    var more = document.getElementById('pulse-wire-more');
    var showAll = false;

    function render() {
      var shown = showAll ? news : news.slice(0, 60);
      list.innerHTML = shown.map(newsHTML).join('');
      more.hidden = news.length <= 60 || showAll;
      if (!more.hidden) more.textContent = 'Show ' + (news.length - 60) + ' more';
    }

    more.addEventListener('click', function () {
      showAll = true;
      render();
    });
    wrap.hidden = false;
    render();
  }

  function feedItemHTML(p) {
    return (
      '<a class="pulse-wire-item" href="' + esc(safeUrl(p.url)) + '" target="_blank" rel="noopener">' +
        '<span class="pulse-wire-title">' + esc(p.title) + '</span>' +
        '<span class="pulse-wire-meta">' + metaBits(p) + ' ↗</span>' +
      '</a>'
    );
  }

  /* Older chatter.json files predate the "feed" key — rebuild an
     approximation from the topic sources so the section still works. */
  function fallbackFeed(topics) {
    var seen = {};
    var posts = [];
    topics.forEach(function (t) {
      (t.sources || []).forEach(function (s) {
        if (s.url && !seen[s.url]) { seen[s.url] = true; posts.push(s); }
      });
    });
    return posts.sort(function (a, b) {
      return new Date(b.when || 0) - new Date(a.when || 0);
    });
  }

  window.BTBC.fetchJSON('data/chatter.json').then(function (data) {
    var topics = data.topics || [];
    var highlights = data.highlights || [];
    var rough = data.rough || [];
    var news = data.news || [];
    var feed = (data.feed && data.feed.length) ? data.feed : fallbackFeed(topics);

    var sub = 'all';
    var feedExpanded = false;
    var FEED_PREVIEW = 15;

    function matchesSub(item) { return sub === 'all' || item.sub === sub; }

    function renderTopics() {
      var updated = document.getElementById('pulse-updated');
      var shown = topics.map(function (t) {
        var sources = (t.sources || []).filter(matchesSub);
        return sources.length ? topicHTML(t, sources, sub === 'all') : null;
      }).filter(Boolean);
      var ago = fmtAgo(data.updated);
      updated.textContent = shown.length
        ? shown.length + ' topics from the last ' + (data.window_hours || 72) + ' hours' + (ago ? ' · updated ' + ago : '')
        : '';
      document.getElementById('pulse-topics').innerHTML = shown.length
        ? shown.join('')
        : '<p class="page-empty">' + (sub === 'all'
            ? 'Quiet out there right now — check back after the next refresh.'
            : 'Nothing from ' + esc(sub) + ' in the current window.') + '</p>';
    }

    function renderFeed() {
      var wrap = document.getElementById('pulse-feed-wrap');
      var list = document.getElementById('pulse-feed');
      var more = document.getElementById('pulse-feed-more');
      if (!feed.length) { wrap.hidden = true; return; }
      var visible = feed.filter(matchesSub);
      var shown = feedExpanded ? visible : visible.slice(0, FEED_PREVIEW);
      list.innerHTML = shown.length
        ? shown.map(feedItemHTML).join('')
        : '<p class="page-empty">Nothing from ' + esc(sub) + ' in this window.</p>';
      more.hidden = visible.length <= FEED_PREVIEW || feedExpanded;
      if (!more.hidden) more.textContent = 'Show ' + (visible.length - FEED_PREVIEW) + ' more';
      wrap.hidden = false;
    }

    function renderRough() {
      var visible = rough.filter(matchesSub);
      document.getElementById('pulse-rough').innerHTML = visible.map(roughHTML).join('');
      document.getElementById('pulse-rough-wrap').hidden = !visible.length;
    }

    function renderAll() {
      renderTopics();
      renderFeed();
      renderRough();
    }

    var chips = document.querySelectorAll('.pulse-sub-chip');
    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener('click', function () {
        sub = chip.getAttribute('data-sub') || 'all';
        Array.prototype.forEach.call(chips, function (c) {
          var on = c === chip;
          c.classList.toggle('active', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        renderAll();
      });
    });

    document.getElementById('pulse-feed-more').addEventListener('click', function () {
      feedExpanded = true;
      renderFeed();
    });

    renderAll();

    if (highlights.length) {
      document.getElementById('pulse-highlights').innerHTML = highlights.map(highlightHTML).join('');
      document.getElementById('pulse-highlights-wrap').hidden = false;
    }

    if (news.length) wire(news);
  }).catch(function () {
    document.getElementById('pulse-topics').innerHTML =
      '<p class="page-empty">Could not load the chatter. Run a local server (<code>python3 -m http.server 8000</code>) if you’re previewing from disk.</p>';
  });
})();
