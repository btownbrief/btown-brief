/* Contractors directory — renders data/contractors.json.
   Today this is the licensed-trades backbone (Vermont DFS licensing
   rolls): master electricians and plumbers plus licensed gas
   installers, filterable by name or town. The curated, review-linked
   layer (data.curated) renders on top when Steve fills it in. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var SHOW = 30; // rows shown per trade before "show all"

  function proRow(p) {
    return (
      '<div class="con-row">' +
        '<span class="con-row-name">' + esc(p.name) + '</span>' +
        '<span class="con-row-city">' + esc(p.city) + '</span>' +
        '<span class="con-row-lic">' + esc(p.license) +
          (p.level && p.level !== 'Master' ? ' · ' + esc(p.level) : '') + '</span>' +
      '</div>'
    );
  }

  function curatedCard(c) {
    var links = (c.review_links || []).map(function (l) {
      return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + ' ↗</a>';
    }).join(' · ');
    return (
      '<div class="dir-card dir-card-featured">' +
        '<div class="dir-card-head">' +
          '<span class="dir-card-name">' + esc(c.name) + '</span>' +
          '<span class="dir-card-when">' + esc(c.trade) + '</span>' +
        '</div>' +
        '<p class="dir-card-what">' + esc(c.notes || '') + '</p>' +
        (links ? '<p class="dir-card-what">' + links + '</p>' : '') +
      '</div>'
    );
  }

  function render(data, query) {
    var q = (query || '').toLowerCase();
    var out = document.getElementById('con-list');
    var html = '';

    var curated = (data.curated || []).filter(function (c) {
      return !q || (c.name + ' ' + (c.trade || '')).toLowerCase().indexOf(q) !== -1;
    });
    if (curated.length) {
      html += '<h2 class="section-label">Vetted picks</h2>' + curated.map(curatedCard).join('');
    }

    (data.trades || []).forEach(function (t) {
      var pros = (t.pros || []).filter(function (p) {
        return !q || (p.name + ' ' + p.city).toLowerCase().indexOf(q) !== -1;
      });
      if (!pros.length) return;
      var open = q || pros.length <= SHOW;
      html +=
        '<section class="con-trade">' +
          '<h2 class="section-label">' + esc(t.title) +
            ' <span class="con-count">' + pros.length + '</span></h2>' +
          '<div class="con-rows">' +
            pros.slice(0, open ? pros.length : SHOW).map(proRow).join('') +
          '</div>' +
          (open ? '' :
            '<button class="con-more" data-trade="' + esc(t.id) + '">' +
              'Show all ' + pros.length + '</button>') +
        '</section>';
    });

    out.innerHTML = html || '<p class="page-empty">No one matches that search.</p>';
  }

  window.BTBC.fetchJSON('data/contractors.json').then(function (data) {
    var input = document.getElementById('con-search');
    render(data, '');

    input.addEventListener('input', function () { render(data, input.value); });
    document.getElementById('con-list').addEventListener('click', function (e) {
      if (!e.target.classList.contains('con-more')) return;
      SHOW = Infinity; // one click opens everything; the lists aren't huge
      render(data, input.value);
    });

    var stamp = document.getElementById('con-updated');
    if (stamp && data.generated) {
      stamp.textContent = 'Licensing data refreshed ' + data.generated.slice(0, 10) +
        ' from the State of Vermont (DFS Licensing MasterList, ODbL).';
    }
  }).catch(function () {
    document.getElementById('con-list').innerHTML =
      '<p class="page-empty">Couldn’t load the directory. Try a refresh.</p>';
  });
})();
