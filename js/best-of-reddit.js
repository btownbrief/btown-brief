/* Best of r/burlington — renders data/best-of-reddit.json.
   Skeleton stage: sample entries render with a SAMPLE badge until the
   merged 2023/2025 lists + ongoing collection replace the data file. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;

  function itemHTML(it) {
    return (
      '<a class="dir-card" href="' + esc(it.reddit_url) + '" target="_blank" rel="noopener">' +
        '<div class="dir-card-head">' +
          '<span class="dir-card-name">' + esc(it.name) + '</span>' +
          (it.sample ? '<span class="dir-card-when">SAMPLE</span>' :
            (it.mentions ? '<span class="dir-card-when">' + esc(String(it.mentions)) + ' mentions</span>' : '')) +
        '</div>' +
        '<p class="dir-card-what">' + esc(it.note || '') + '</p>' +
        '<span class="dir-card-arrow" aria-hidden="true">↗</span>' +
      '</a>'
    );
  }

  window.BTBC.fetchJSON('data/best-of-reddit.json').then(function (data) {
    var html = '';
    (data.categories || []).forEach(function (c) {
      if (!(c.items || []).length) return;
      html += '<h2 class="section-label">' + esc(c.title) + '</h2>' +
              c.items.map(itemHTML).join('');
    });
    document.getElementById('bor-list').innerHTML =
      html || '<p class="page-empty">Nothing here yet.</p>';
  }).catch(function () {
    document.getElementById('bor-list').innerHTML =
      '<p class="page-empty">Couldn’t load the list. Try a refresh.</p>';
  });
})();
