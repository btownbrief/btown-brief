/* Burlington Wild — renders wild.html from data/wild.json. No API calls from the
   browser; the JSON is written every six hours by scripts/refresh_wild.py.
   Everything degrades: a missing section shows a short honest line, never a blank. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var n = function (x) { return (x == null ? 0 : x).toLocaleString('en-US'); };
  var DATA = null;

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function who(u) {
    var label = u && (u.name || u.login) || 'someone';
    var small = u && u.name && u.login && u.name !== u.login ? '<small>' + esc(u.login) + '</small>' : '';
    return u && u.url ? '<a href="' + esc(u.url) + '" target="_blank" rel="noopener">' + esc(label) + '</a>' + small : esc(label);
  }

  function renderCounts(i) {
    var el = $('wild-counts');
    if (!i) { el.innerHTML = '<p class="wild-empty">The counts have not loaded yet. <a href="https://www.inaturalist.org/observations?place_id=50939" target="_blank" rel="noopener">See them on iNaturalist</a>.</p>'; return; }
    var c = [
      [i.month.observations, 'observations this month'],
      [i.month.species.total_species, 'species this month'],
      [i.month.observers.total_observers, 'people counting this month'],
      [i.year.observations, 'observations this year']
    ];
    el.innerHTML = c.map(function (x) { return '<div class="wild-count"><b>' + n(x[0]) + '</b><span>' + x[1] + '</span></div>'; }).join('');
  }

  function renderRoll(span) {
    var i = DATA && DATA.inat, e = DATA && DATA.ebird;
    var inat = $('roll-inat'), eb = $('roll-ebird');
    if (!i) { inat.innerHTML = '<li class="wild-empty">Not loaded. <a href="https://www.inaturalist.org/observations?place_id=50939&view=observers" target="_blank" rel="noopener">See the observers on iNaturalist</a>.</li>'; }
    else {
      var rows = (i[span].observers.top || []).slice(0, 8);
      inat.innerHTML = rows.length ? rows.map(function (r, k) {
        return '<li><span class="wild-rank">' + (k + 1) + '</span><span class="wild-who">' + who(r) + '</span><span class="wild-num">' + n(r.species) + ' <em>species</em> · ' + n(r.observations) + ' <em>obs</em></span></li>';
      }).join('') : '<li class="wild-empty">Nobody has logged an observation in Burlington ' + (span === 'month' ? 'this month' : 'this year') + ' yet. You could be first.</li>';
    }
    if (e && e.enabled && e.top && e.top.length) {
      eb.innerHTML = e.top.slice(0, 8).map(function (r, k) {
        var name = r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a>' : esc(r.name);
        return '<li><span class="wild-rank">' + (k + 1) + '</span><span class="wild-who">' + name + '</span><span class="wild-num">' + n(r.species) + ' <em>species</em>' + (r.checklists ? ' · ' + n(r.checklists) + ' <em>lists</em>' : '') + '</span></li>';
      }).join('') + '<li class="wild-empty">This year, Chittenden County. eBird keeps this board by the year.</li>';
    } else {
      eb.innerHTML = '<li class="wild-off">The bird board is switched off here until eBird says yes to showing it. Until then it lives on <a href="https://ebird.org/region/US-VT-007/top100" target="_blank" rel="noopener">eBird\'s own Chittenden County top 100</a>, which is the same list.</li>';
    }
  }

  function renderSpecies(i) {
    var el = $('species-chips');
    if (!i || !i.month.species.top.length) { $('species-wrap').hidden = true; return; }
    el.innerHTML = i.month.species.top.map(function (s) {
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener"><b>' + n(s.count) + '</b> ' + esc(s.common || s.name) + (s.common ? ' <i>' + esc(s.name) + '</i>' : '') + '</a></li>';
    }).join('');
  }

  function card(o, flag, flagClass) {
    var lat = o.name && o.common ? '<p class="wild-lat">' + esc(o.name) + '</p>' : '';
    var meta = [o.place, o.observed_on ? fmtDate(o.observed_on) : ''].filter(Boolean).join(' · ');
    var cred = o.photo ? esc(o.attribution || ('(c) ' + (o.observer.name || o.observer.login) + ', ' + o.photo_license)) : 'Recorded by ' + who(o.observer);
    return '<div class="wild-card">' +
      (o.photo ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener"><img src="' + esc(o.photo) + '" alt="' + esc(o.common || o.name) + '" loading="lazy"></a>' : '') +
      '<div class="wild-card-body"><span class="wild-flag ' + flagClass + '">' + flag + '</span>' +
      '<h4><a href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.common || o.name) + '</a></h4>' + lat +
      '<p class="wild-meta">' + esc(meta) + '</p><span class="wild-cred">' + cred + (o.photo ? ' · <a href="' + esc(o.url) + '" target="_blank" rel="noopener">on iNaturalist</a>' : '') + '</span></div></div>';
  }
  function fmtDate(s) {
    var d = new Date(s + 'T12:00:00'); if (isNaN(d)) return s;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function groupFlag(o) {
    if (o.threatened) return ['Threatened species', 'rare'];
    if (o.introduced) return ['Introduced', ''];
    var g = { Aves: 'Bird', Insecta: 'Insect', Plantae: 'Plant', Fungi: 'Fungus', Mammalia: 'Mammal', Amphibia: 'Amphibian', Reptilia: 'Reptile', Arachnida: 'Arachnid', Mollusca: 'Mollusc', Actinopterygii: 'Fish' };
    return [g[o.group] || 'Wild', ''];
  }

  function renderSeen(i) {
    var el = $('seen-grid');
    if (!i || !i.seen.length) { el.innerHTML = '<p class="wild-empty">No shareable photos this month yet. Observers choose their own license; only Creative Commons photos appear here. <a href="https://www.inaturalist.org/observations?place_id=50939&photos=true" target="_blank" rel="noopener">Browse everything on iNaturalist</a>.</p>'; return; }
    el.innerHTML = i.seen.map(function (o) { var f = groupFlag(o); return card(o, f[0], f[1]); }).join('');
  }

  function renderRare(i, e) {
    var el = $('rare-list');
    if (!i || !i.rare.length) { el.innerHTML = '<p class="wild-empty">Nothing flagged as threatened in the city this month. That is either good news or nobody looked.</p>'; }
    else el.innerHTML = i.rare.map(function (o) { return card(o, 'Threatened species', 'rare'); }).join('');
    var eb = $('ebird-notable');
    if (e && e.enabled && e.notable && e.notable.length) {
      eb.innerHTML = '<h3 class="wild-species-h">Notable birds, Chittenden County, last 7 days</h3><div class="wild-rare">' + e.notable.map(function (o) {
        var meta = [o.place, o.observed_on ? fmtDate(o.observed_on) : '', o.count ? n(o.count) + ' seen' : ''].filter(Boolean).join(' · ');
        return '<div class="wild-card"><div class="wild-card-body"><span class="wild-flag rare">Notable' + (o.reviewed ? ', reviewed' : '') + '</span><h4>' + (o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.common) + '</a>' : esc(o.common)) + '</h4><p class="wild-lat">' + esc(o.name) + '</p><p class="wild-meta">' + esc(meta) + '</p><span class="wild-cred">Reported by ' + esc(o.observer || 'an eBirder') + ' · eBird</span></div></div>';
      }).join('') + '</div>';
    } else {
      eb.innerHTML = '<div class="note-card"><strong>Birds are coming.</strong> eBird\'s notable-sightings feed for the county is written into this page but switched off until the Brief has eBird\'s written permission to show it (their API terms are for non-commercial use). Meanwhile: <a href="https://ebird.org/region/US-VT-007" target="_blank" rel="noopener">eBird\'s Chittenden County page</a>, which has the same list.</div>';
    }
  }

  function renderVs(i) {
    var el = $('vs-bars');
    if (!i || !i.rival) { $('vs').hidden = true; return; }
    $('vs-name').textContent = i.rival.name;
    var home = i.month.species.total_species || 0, away = i.rival.month.species || 0, max = Math.max(home, away, 1);
    el.innerHTML =
      '<div class="wild-bar home"><span class="wild-bar-name">Burlington</span><div class="wild-bar-track"><div class="wild-bar-fill" style="width:' + Math.round(home / max * 100) + '%"></div></div><span class="wild-bar-num">' + n(home) + '</span></div>' +
      '<div class="wild-bar"><span class="wild-bar-name">' + esc(i.rival.name) + '</span><div class="wild-bar-track"><div class="wild-bar-fill" style="width:' + Math.round(away / max * 100) + '%"></div></div><span class="wild-bar-num">' + n(away) + '</span></div>' +
      '<p class="wild-vs-note">Species recorded on iNaturalist since ' + esc(fmtDate(i.month.since)) + '. This year: Burlington ' + n(i.year.species.total_species) + ', ' + esc(i.rival.name) + ' ' + n(i.rival.year.species) + '. Burlington is bigger and has UVM, so keep the gloating proportional.</p>';
  }

  function briefHTML(d) {
    var i = d && d.inat; if (!i) return '';
    var top = (i.month.observers.top || [])[0];
    var sp = (i.month.species.top || []).slice(0, 3).map(function (s) { return s.common || s.name; });
    var seen = (i.seen || [])[0];
    var rare = (i.rare || [])[0];
    var out = '<h3>This week in Burlington\'s wild</h3>';
    out += '<p>Burlington has logged <strong>' + n(i.month.observations) + ' observations</strong> of <strong>' + n(i.month.species.total_species) + ' species</strong> on iNaturalist this month, from ' + n(i.month.observers.total_observers) + ' people.' +
      (top ? ' Out front is <a href="' + esc(top.url) + '">' + esc(top.name || top.login) + '</a> with ' + n(top.species) + ' species.' : '') +
      (sp.length ? ' The most recorded: ' + sp.map(esc).join(', ') + '.' : '') + '</p>';
    if (rare) out += '<p>Flagged as threatened this month: <a href="' + esc(rare.url) + '">' + esc(rare.common || rare.name) + '</a>' + (rare.place ? ' at ' + esc(rare.place) : '') + ', recorded ' + esc(fmtDate(rare.observed_on)) + '.</p>';
    if (seen) out += '<p>Worth a look: a <a href="' + esc(seen.url) + '">' + esc(seen.common || seen.name) + '</a>' + (seen.place ? ' near ' + esc(seen.place) : '') + ', photographed by ' + esc(seen.observer.name || seen.observer.login) + '.</p>';
    out += '<p>Burlington vs ' + esc(i.rival.name) + ' this month: ' + n(i.month.species.total_species) + ' species to ' + n(i.rival.month.species) + '. The whole board, and how to get on it, is at <a href="https://guide.btownbrief.com/wild.html">guide.btownbrief.com/wild</a>.</p>';
    return out;
  }

  function renderBrief(d) {
    var el = $('brief-block'), html = briefHTML(d);
    if (!html) { el.innerHTML = '<p class="wild-empty">The block builds itself once the counts load.</p>'; $('brief-copy').hidden = true; return; }
    el.innerHTML = html;
    $('brief-copy').addEventListener('click', function () {
      var ok = function () { $('brief-copied').hidden = false; setTimeout(function () { $('brief-copied').hidden = true; }, 2000); };
      if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([el.innerText], { type: 'text/plain' }) })]).then(ok, function () { navigator.clipboard.writeText(el.innerText).then(ok); });
      } else if (navigator.clipboard) { navigator.clipboard.writeText(el.innerText).then(ok); }
    });
  }

  function render(d) {
    DATA = d || {};
    var i = DATA.inat, e = DATA.ebird;
    $('wild-updated').textContent = DATA.updated_local ? 'Last refreshed ' + DATA.updated_local + ' Burlington time.' : '';
    renderCounts(i); renderRoll('month'); renderSpecies(i); renderSeen(i); renderRare(i, e); renderVs(i); renderBrief(DATA);
    Array.prototype.forEach.call(document.querySelectorAll('.wild-tab'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.wild-tab'), function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
        renderRoll(b.dataset.span);
      });
    });
  }

  fetchJSON('data/wild.json').then(render, function () { render(null); });
  window.wild = { briefHTML: briefHTML, data: function () { return DATA; } };
})();
