/* Best of r/burlington — renders data/best-of-reddit.json (18 categories of
   merged 2023+2025 "best X" questions, repeat asks collapsed into one card
   with all their threads — Tier 1: a link directory, no named-winner
   extraction, see SUMMARY-best-of-reddit.md), with Seven Daysies picks shown
   alongside for comparison where one exists, plus a "Recently on
   r/GoodBurlington" strip from data/reddit.json. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var YEAR_LABEL = { 2025: '2025', 2023: '2023' };

  function fmtCount(n, singular, plural) {
    return n + ' ' + (n === 1 ? singular : (plural || singular + 's'));
  }

  // Sources that point at the exact same Reddit thread (common for the 7
  // entries present in both editions, plus one within-2025 duplicate label)
  // collapse into one link with a combined year badge, rather than two
  // rows pointing at the same URL.
  function groupSources(sources) {
    var byUrl = [];
    var index = {};
    sources.forEach(function (s) {
      if (!(s.thread_url in index)) {
        index[s.thread_url] = byUrl.length;
        byUrl.push({ url: s.thread_url, label: s.label, years: [] });
      }
      var row = byUrl[index[s.thread_url]];
      if (row.years.indexOf(s.year) === -1) row.years.push(s.year);
    });
    byUrl.forEach(function (row) { row.years.sort(function (a, b) { return b - a; }); });
    return byUrl;
  }

  function sourceLinkHTML(row) {
    var badges = row.years.map(function (y) {
      return '<span class="bor-badge bor-badge-' + y + '">' + esc(YEAR_LABEL[y] || y) + '</span>';
    }).join('');
    return (
      '<a class="bor-source-link" href="' + esc(row.url) + '" target="_blank" rel="noopener">' +
        badges + esc(row.label) + ' ↗' +
      '</a>'
    );
  }

  function entryHTML(entry) {
    var links = groupSources(entry.sources).map(sourceLinkHTML).join('');
    var tip = entry.status === 'comment-suggestion'
      ? '<span class="bor-badge-tip">💬 comment tip</span>' : '';
    // The Seven Daysies pick renders on its own row under the Reddit
    // threads: crowd's take above, ballot-box take below.
    var sevendays = entry.sevendays_url
      ? '<div class="bor-entry-links bor-compare">' +
          '<a class="bor-sevendays-link" href="' + esc(entry.sevendays_url) + '" target="_blank" rel="noopener">' +
          '🏆 ' + esc(entry.sevendays_note || "Seven Days' take") + ' ↗</a>' +
        '</div>' : '';
    var note = entry.notes ? '<p class="bor-entry-note">' + esc(entry.notes) + '</p>' : '';
    return (
      '<div class="bor-entry" data-q="' + esc(entry.question.toLowerCase()) + '">' +
        '<div class="bor-entry-head">' +
          '<span class="bor-entry-q">' + esc(entry.question) + '</span>' + tip +
        '</div>' +
        '<div class="bor-entry-links">' + links + '</div>' +
        sevendays +
        note +
      '</div>'
    );
  }

  function categoryHTML(cat) {
    var primary = cat.entries.filter(function (e) { return e.status !== '2023-only'; });
    var legacy = cat.entries.filter(function (e) { return e.status === '2023-only'; });
    // Rendered inside the category body, not the <summary> — a link in a
    // summary both navigates and toggles the details on one click.
    var sevendays = cat.sevendays_url
      ? '<div class="bor-entry-links bor-compare"><a class="bor-sevendays-link" href="' + esc(cat.sevendays_url) + '" target="_blank" rel="noopener">' +
        '🏆 ' + esc(cat.sevendays_note || "Seven Days' take") + ' ↗</a></div>' : '';
    var legacyHTML = legacy.length ? (
      '<details class="bor-legacy">' +
        '<summary>From the 2023 edition (' + fmtCount(legacy.length, 'question') + ', not reconfirmed in 2025)</summary>' +
        '<div class="bor-entries">' + legacy.map(entryHTML).join('') + '</div>' +
      '</details>'
    ) : '';
    return (
      '<details class="bor-category" id="cat-' + esc(cat.id) + '">' +
        '<summary>' +
          '<span class="bor-category-title">' + esc(cat.title) + '</span>' +
          '<span class="bor-category-count">' + fmtCount(cat.counts.total, 'question') + '</span>' +
        '</summary>' +
        '<div class="bor-category-body">' +
          sevendays +
          '<div class="bor-entries">' + (primary.map(entryHTML).join('') || '<p class="bor-empty">Nothing current — see the 2023 edition below.</p>') + '</div>' +
          legacyHTML +
        '</div>' +
      '</details>'
    );
  }

  function jumpChipHTML(cat) {
    return (
      '<a class="bor-jump-chip" href="#cat-' + esc(cat.id) + '" data-jump="' + esc(cat.id) + '">' +
        esc(cat.title) + ' <span class="bor-jump-count">' + cat.counts.total + '</span>' +
      '</a>'
    );
  }

  function renderReddit(data) {
    var block = document.getElementById('bor-goodburlington-block');
    var list = document.getElementById('bor-goodburlington-list');
    var empty = document.getElementById('bor-goodburlington-empty');
    var posts = (data && data.posts) || [];
    if (!posts.length) {
      if (block) block.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    list.innerHTML = posts.map(function (p) {
      return (
        '<a class="reddit-post" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
          (p.score ? '<span class="reddit-score" aria-label="' + esc(p.score) + ' upvotes">▲ ' + esc(p.score) + '</span>' : '') +
          '<span class="reddit-title">' + esc(p.title) + '</span>' +
        '</a>'
      );
    }).join('');
    block.hidden = false;
    empty.hidden = true;
  }

  function init(data) {
    var listEl = document.getElementById('bor-list');
    var jumpEl = document.getElementById('bor-jump-row');
    var categories = data.categories || [];

    listEl.innerHTML = categories.map(categoryHTML).join('') ||
      '<p class="page-empty">Nothing here yet.</p>';
    jumpEl.innerHTML = categories.map(jumpChipHTML).join('');

    var totalEntries = categories.reduce(function (sum, c) { return sum + c.counts.total; }, 0);
    document.getElementById('bor-result-count').textContent =
      totalEntries + ' recurring questions across ' + categories.length + ' categories.';

    // --- Expand all / collapse all ---
    var toggleBtn = document.getElementById('bor-toggle-all');
    var allDetails = function () { return listEl.querySelectorAll('details.bor-category'); };
    toggleBtn.addEventListener('click', function () {
      var expand = toggleBtn.textContent === 'Expand all';
      allDetails().forEach(function (d) { d.open = expand; });
      toggleBtn.textContent = expand ? 'Collapse all' : 'Expand all';
    });

    // Clicking a jump chip should open its category, not just scroll past a
    // closed one.
    jumpEl.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-jump]');
      if (!chip) return;
      var target = document.getElementById('cat-' + chip.getAttribute('data-jump'));
      if (target) target.open = true;
    });

    // --- Search: filters entries by question text, auto-opens matching
    // categories (including the 2023-only expander), hides categories with
    // zero matches. Clearing search restores the default collapsed state. ---
    var searchInput = document.getElementById('bor-search');
    var clearBtn = document.getElementById('bor-search-clear');
    var resultCount = document.getElementById('bor-result-count');

    function applyFilter(query) {
      query = query.trim().toLowerCase();
      clearBtn.hidden = !query;
      if (!query) {
        listEl.querySelectorAll('.bor-entry').forEach(function (el) { el.classList.remove('bor-hidden'); });
        listEl.querySelectorAll('details.bor-category, details.bor-legacy').forEach(function (d) { d.classList.remove('bor-hidden'); d.open = false; });
        toggleBtn.textContent = 'Expand all';
        resultCount.textContent = totalEntries + ' recurring questions across ' + categories.length + ' categories.';
        return;
      }
      var shown = 0;
      listEl.querySelectorAll('details.bor-category').forEach(function (catEl) {
        var matchInCat = 0;
        catEl.querySelectorAll('.bor-entry').forEach(function (entryEl) {
          var hit = entryEl.getAttribute('data-q').indexOf(query) !== -1;
          entryEl.classList.toggle('bor-hidden', !hit);
          if (hit) { matchInCat++; shown++; }
        });
        var legacyEl = catEl.querySelector('.bor-legacy');
        if (legacyEl) {
          var legacyMatches = legacyEl.querySelectorAll('.bor-entry:not(.bor-hidden)').length;
          legacyEl.classList.toggle('bor-hidden', legacyMatches === 0);
          if (legacyMatches) legacyEl.open = true;
        }
        catEl.classList.toggle('bor-hidden', matchInCat === 0);
        if (matchInCat) catEl.open = true;
      });
      resultCount.textContent = shown === 0 ? 'No matches — try a different word.' :
        fmtCount(shown, 'match', 'matches') + ' for “' + query + '”.';
    }

    searchInput.addEventListener('input', function () { applyFilter(searchInput.value); });
    clearBtn.addEventListener('click', function () {
      searchInput.value = '';
      applyFilter('');
      searchInput.focus();
    });
  }

  Promise.all([
    window.BTBC.fetchJSON('data/best-of-reddit.json'),
    window.BTBC.fetchJSON('data/reddit.json').catch(function () { return { posts: [] }; }),
  ]).then(function (results) {
    init(results[0]);
    renderReddit(results[1]);
  }).catch(function () {
    document.getElementById('bor-list').innerHTML =
      '<p class="page-empty">Couldn’t load the list. Try a refresh.</p>';
  });
})();
