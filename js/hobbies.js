/* Vermont Hobbies — renders data/hobbies.json in two tiers.
   tier 'vermont' (the only-really-works-here list) renders first,
   'anywhere' below it. Like the rest of the guide, the page knows
   what time it is: hobbies in season this month sort to the top of
   their tier and get a badge; year-round ones hold the middle;
   off-season ones wait at the bottom for their month to come around.
   Adding a hobby is a data edit, not a code edit. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var LINK_LABEL = { shop: 'Shop', club: 'Club', spot: 'Spot', guide: 'On the guide' };

  // Month in Burlington, not wherever the reader's laptop thinks it is.
  var MONTH = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'numeric'
  }).format(new Date()), 10);

  // 0 = in season now, 1 = year-round, 2 = waiting for its month.
  function seasonRank(h) {
    var m = h.months || [];
    if (m.length >= 12) return 1;
    return m.indexOf(MONTH) !== -1 ? 0 : 2;
  }

  function linkHTML(link) {
    var external = /^https?:/i.test(link.url);
    return (
      '<a class="hob-link hob-link-' + esc(link.type) + '" href="' + esc(link.url) + '"' +
        (external ? ' target="_blank" rel="noopener"' : '') + '>' +
        '<span class="hob-link-type">' + esc(LINK_LABEL[link.type] || link.type) + '</span>' +
        esc(link.name) +
      '</a>'
    );
  }

  function cardHTML(h) {
    var inSeason = seasonRank(h) === 0;
    return (
      '<article class="hob-card' + (inSeason ? ' hob-card-now' : '') + '" id="' + esc(h.id) + '">' +
        '<div class="hob-card-head">' +
          '<span class="hob-card-emoji" aria-hidden="true">' + esc(h.emoji || '') + '</span>' +
          '<h3 class="hob-card-name">' + esc(h.name) + '</h3>' +
          (inSeason ? '<span class="hob-badge">In season</span>' : '') +
          '<span class="hob-card-season">' + esc(h.season) + '</span>' +
        '</div>' +
        '<p class="hob-card-what">' + esc(h.what) + '</p>' +
        '<p class="hob-card-start"><strong>Get started:</strong> ' + esc(h.start) + '</p>' +
        (h.links && h.links.length
          ? '<div class="hob-card-links">' + h.links.map(linkHTML).join('') + '</div>'
          : '') +
      '</article>'
    );
  }

  function tierHTML(list) {
    // Stable sort: seasonRank groups, data-file order within each group.
    return list
      .map(function (h, i) { return { h: h, i: i }; })
      .sort(function (a, b) {
        return (seasonRank(a.h) - seasonRank(b.h)) || (a.i - b.i);
      })
      .map(function (x) { return cardHTML(x.h); })
      .join('');
  }

  window.BTBC.fetchJSON('data/hobbies.json').then(function (data) {
    var hobbies = data.hobbies || [];
    var vermont = hobbies.filter(function (h) { return h.tier === 'vermont'; });
    var anywhere = hobbies.filter(function (h) { return h.tier !== 'vermont'; });

    document.getElementById('hobbies-vermont').innerHTML =
      tierHTML(vermont) || '<p class="page-empty">Nothing yet.</p>';
    document.getElementById('hobbies-anywhere').innerHTML =
      tierHTML(anywhere) || '<p class="page-empty">Nothing yet.</p>';

    var now = hobbies.filter(function (h) { return seasonRank(h) === 0; }).length;
    document.getElementById('hobbies-count').textContent =
      hobbies.length + ' hobbies with local on-ramps, ' + now +
      ' in season right now — got one we missed? Scroll down.';

    // Landed on a shared link like hobbies.html#ice-fishing? The cards render
    // after the browser's native anchor jump, so finish the trip ourselves.
    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target && target.classList.contains('hob-card')) {
        target.scrollIntoView();
      }
    }
  }).catch(function () {
    var msg = '<p class="page-empty">The hobby list isn’t loading right now — try a refresh in a minute.</p>';
    document.getElementById('hobbies-vermont').innerHTML = msg;
    document.getElementById('hobbies-anywhere').innerHTML = msg;
    document.getElementById('hobbies-count').textContent = 'The list is unavailable right now.';
  });
})();
