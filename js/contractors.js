/* Contractors directory — renders data/contractors.json (the licensed-
   trades backbone: master electricians/plumbers + licensed gas installers,
   from Vermont DFS licensing rolls, filterable by name or town) with a
   curated, business-level "Vetted picks" layer on top, sourced from
   data/contractors/directory.json — the business-level directory built
   from VBRA Remodelers Directory membership + Google Places verification
   (see SUMMARY-contractors-data.md for the full build method). Each
   published business there has a license/registration OR a verified
   trade-association membership; DFS individual license holders with no
   identifiable business stay in the plain licensing-rolls list below. */
(function () {
  'use strict';

  function curatedFromDirectory(dir) {
    // Adapts data/contractors/directory.json's business-listing shape into
    // the {name, trade, notes, review_links} shape curatedCard() expects.
    return (dir.listings || []).map(function (b) {
      var notes = [];
      if (b.town) notes.push(b.town);
      if (b.phone) notes.push(b.phone);
      notes.push('VBRA Remodelers Directory member');
      var links = [];
      if (b.google_maps_url) links.push({ url: b.google_maps_url, label: 'Google Maps' });
      if (b.website) links.push({ url: b.website, label: 'Website' });
      return {
        name: b.business_name,
        trade: b.category,
        notes: notes.join(' · '),
        review_links: links,
      };
    });
  }

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

  Promise.all([
    window.BTBC.fetchJSON('data/contractors.json'),
    window.BTBC.fetchJSON('data/contractors/directory.json').catch(function () { return null; }),
  ]).then(function (results) {
    var data = results[0];
    var dir = results[1];
    if (dir) data.curated = curatedFromDirectory(dir);

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
        ' from the State of Vermont (DFS Licensing MasterList, ODbL).' +
        (dir ? ' Vetted business picks last verified ' + dir.generated + '.' : '');
    }
  }).catch(function () {
    document.getElementById('con-list').innerHTML =
      '<p class="page-empty">Couldn’t load the directory. Try a refresh.</p>';
  });
})();
