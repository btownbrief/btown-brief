/* Vermont Hobbies — renders data/hobbies.json in two tiers.
   tier 'vermont' (the only-really-works-here list) renders first,
   'anywhere' below it. Adding a hobby is a data edit, not a code edit. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var LINK_LABEL = { shop: 'Shop', club: 'Club', spot: 'Spot', guide: 'On the guide' };

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
    return (
      '<article class="hob-card" id="' + esc(h.id) + '">' +
        '<div class="hob-card-head">' +
          '<span class="hob-card-emoji" aria-hidden="true">' + esc(h.emoji || '') + '</span>' +
          '<h3 class="hob-card-name">' + esc(h.name) + '</h3>' +
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

  window.BTBC.fetchJSON('data/hobbies.json').then(function (data) {
    var hobbies = data.hobbies || [];
    var vermont = hobbies.filter(function (h) { return h.tier === 'vermont'; });
    var anywhere = hobbies.filter(function (h) { return h.tier !== 'vermont'; });

    document.getElementById('hobbies-vermont').innerHTML =
      vermont.map(cardHTML).join('') || '<p class="page-empty">Nothing yet.</p>';
    document.getElementById('hobbies-anywhere').innerHTML =
      anywhere.map(cardHTML).join('') || '<p class="page-empty">Nothing yet.</p>';

    document.getElementById('hobbies-count').textContent =
      hobbies.length + ' hobbies with local on-ramps — got one we missed? Scroll down.';
  }).catch(function () {
    document.getElementById('hobbies-vermont').innerHTML =
      '<p class="page-empty">Could not load the list. Run a local server (<code>python3 -m http.server 8000</code>) if you’re previewing from disk.</p>';
  });
})();
