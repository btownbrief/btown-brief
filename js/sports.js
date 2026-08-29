/* sports.js — the Burlington sports page.

   This lives on the guide rather than inside All Day on purpose. All Day's
   tabs are things to consume on a phone — a wire, video, podcasts, photos.
   A schedule is something you act on, so it sits with the calendar instead,
   and What Now links to it from the "things to do" side of the app.

   Data: data/sports.json, rebuilt through the day by scripts/build_sports.py.
   Local is UVM, Burlington High and the local clubs; National is the five
   New England teams (Montreal included — Burlington is closer to the Bell
   Centre than to Fenway).

   Two rules carried over from the research, because they are what stop a
   schedule reading like a spreadsheet:
     · A finished game DIMS. The winner is not bolded; the loser recedes, in
       colour rather than opacity — opacity took the text under 4.5:1.
     · One slot carries the state, in a fixed column: a time, or a result, or
       the word the game was called off with. */
(function () {
  'use strict';

  var esc = (window.BTBC && window.BTBC.esc) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var state = { data: null, scope: 'local', org: null };

  function $(id) { return document.getElementById(id); }

  var isLocal = function (g) { return g.level !== 'national'; };
  var finished = function (g) { return !!g.result || g.state === 'post'; };

  function scoped() {
    return (state.data.games || []).filter(function (g) {
      return (state.scope === 'local') === isLocal(g);
    });
  }

  function when(g) {
    if (g.allDay) return 'All day';
    return new Date(g.start).toLocaleTimeString('en-US',
      { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  }

  function dayLabel(iso) {
    var d = new Date(iso + 'T12:00:00');
    var t = new Date(); t.setHours(12, 0, 0, 0);
    var n = Math.round((d - t) / 86400000);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US',
      { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function away(iso) {
    var d = new Date(iso + 'T12:00:00');
    var t = new Date(); t.setHours(12, 0, 0, 0);
    var n = Math.round((d - t) / 86400000);
    if (n <= 0) return '';
    if (n === 1) return 'tomorrow';
    if (n < 7) return 'in ' + n + ' days';
    if (n < 14) return 'next week';
    return 'in ' + Math.round(n / 7) + ' weeks';
  }

  /* The lede: whatever is live, else the next one, else the last result. */
  function lede(list) {
    var now = Date.now();
    var live = list.filter(function (g) { return g.live; })[0];
    if (live) return live;
    var next = list.filter(function (g) {
      return new Date(g.start).getTime() >= now - 7200000 && !finished(g);
    })[0];
    if (next) return next;
    var done = list.filter(finished);
    return done.length ? done[done.length - 1] : (list[0] || null);
  }

  function ledeHTML(g) {
    var top = [];
    if (g.live) top.push('<b class="sp-live"><i></i>' + esc(g.live) + '</b>');
    else if (finished(g)) top.push('Final');
    else top.push(esc(dayLabel(g.date)) + ' · ' + esc(when(g)));
    if (g.venue) top.push(esc(g.venue));

    var score = '';
    if (finished(g) && g.score) {
      var parts = String(g.score).split('-');
      score = '<p class="sp-bigscore' + (g.result === 'L' ? ' lost' : '') + '">' +
        esc(parts[0]) + '<span class="sp-dash">–</span>' + esc(parts[1]) + '</p>';
    }

    var sub = [];
    if (g.org) sub.push(esc(g.org));
    if (g.sport) sub.push(esc(g.sport));
    if (!finished(g) && !g.live) { var a = away(g.date); if (a) sub.push(esc(a)); }
    if (g.tv) sub.push('on ' + esc(g.tv));

    var btns = '';
    if (g.tickets) btns += '<a class="sp-btn" href="' + esc(g.tickets) + '" target="_blank" rel="noopener">Tickets</a>';
    if (g.watch || g.url) {
      btns += '<a class="sp-btn sp-btn-quiet" href="' + esc(g.watch || g.url) +
        '" target="_blank" rel="noopener">' + (g.watch ? 'Watch' : 'Details') + '</a>';
    }

    return '<div class="sp-lede' + (g.live ? ' is-live' : '') + '">' +
      '<p class="sp-lede-top">' + top.join(' · ') + '</p>' + score +
      '<h2 class="sp-lede-t">' + esc(g.title) + '</h2>' +
      '<p class="sp-lede-s">' + sub.join(' · ') + '</p>' +
      (btns ? '<div class="sp-btns">' + btns + '</div>' : '') +
      '</div>';
  }

  function rowHTML(g) {
    var done = finished(g);
    var slot;
    if (g.status) slot = '<span class="sp-off">' + esc(g.status) + '</span>';
    else if (g.live) slot = '<span class="sp-livedot"><i></i>LIVE</span>';
    else if (done && g.score) slot = '<span class="sp-res sp-' + esc(g.result || '') + '">' +
      esc(g.result || '') + ' ' + esc(g.score) + '</span>';
    else if (done) slot = '<span class="sp-res">Final</span>';
    else slot = esc(when(g));

    var meta = [];
    if (g.org) meta.push(esc(g.org));
    if (g.sport && g.sport !== g.org) meta.push(esc(g.sport));
    if (g.venue && !done) meta.push(esc(g.venue));
    if (g.tv) meta.push(esc(g.tv));

    var open = g.url ? '<a class="sp-row' + (done ? ' is-done' : '') +
      (g.status ? ' is-off' : '') + '" href="' + esc(g.url) +
      '" target="_blank" rel="noopener" role="text">'
      : '<div class="sp-row' + (done ? ' is-done' : '') + (g.status ? ' is-off' : '') + '" role="text">';
    return open +
      '<span class="sp-when">' + slot + '</span>' +
      '<span class="sp-body"><span class="sp-t">' + esc(g.title) + '</span>' +
      '<span class="sp-m">' + meta.join(' · ') + '</span></span>' +
      (g.url ? '</a>' : '</div>');
  }

  function chipsHTML(items, active, allLabel) {
    var out = '<button class="quick-chip' + (active ? '' : ' on') +
      '" data-pick="">' + esc(allLabel) + '</button>';
    items.forEach(function (o) {
      out += '<button class="quick-chip' + (active === o ? ' on' : '') +
        '" data-pick="' + esc(o) + '">' + esc(o) + '</button>';
    });
    return out;
  }

  function render() {
    var d = state.data;
    var list = scoped();
    var now = Date.now();

    $('sp-scope').innerHTML =
      '<button class="quick-chip' + (state.scope === 'local' ? ' on' : '') + '" data-scope="local">Local</button>' +
      '<button class="quick-chip' + (state.scope === 'national' ? ' on' : '') + '" data-scope="national">National</button>';

    var orgs = [];
    list.forEach(function (g) { if (g.org && orgs.indexOf(g.org) === -1) orgs.push(g.org); });
    $('sp-orgs').innerHTML = orgs.length > 1 ? chipsHTML(orgs, state.org, 'Everyone') : '';

    var shown = state.org ? list.filter(function (g) { return g.org === state.org; }) : list;
    var head = lede(shown);
    $('sp-lede').innerHTML = head ? ledeHTML(head) : '';

    var future = shown.filter(function (g) {
      return !finished(g) && new Date(g.start).getTime() >= now - 7200000;
    });
    var past = shown.filter(finished).reverse();

    $('sp-count').textContent = future.length
      ? future.length + (future.length === 1 ? ' game' : ' games') + ' coming up'
      : 'Nothing scheduled right now';

    var html = '';
    if (future.length) {
      var day = null;
      future.slice(0, 120).forEach(function (g) {
        if (g.date !== day) { day = g.date; html += '<p class="sp-day">' + esc(dayLabel(g.date)) + '</p>'; }
        html += rowHTML(g);
      });
    } else {
      /* Never a bare "no games" — the seasons genuinely go quiet, and saying
         so is better than an empty box. */
      html += '<p class="page-empty">' + (state.org
        ? esc(state.org) + ' has nothing scheduled in the next few months.'
        : 'Nothing scheduled right now — the seasons are between.') + '</p>';
    }
    if (past.length) {
      html += '<h2 class="section-label">Already played</h2>';
      past.slice(0, 40).forEach(function (g) { html += rowHTML(g); });
    }
    $('sp-list').innerHTML = html;

    /* Clubs that exist but have nothing on. Dropping them would read as the
       page not knowing about them. */
    var dorm = (state.scope === 'local' && !state.org && d.dormant) || [];
    $('sp-dormant').innerHTML = dorm.length
      ? '<h2 class="section-label">Not in season</h2>' + dorm.map(function (t) {
          var open = t.url ? '<a class="sp-dorm" href="' + esc(t.url) + '" target="_blank" rel="noopener">'
                           : '<div class="sp-dorm">';
          return open + '<span class="sp-dorm-t">' + esc(t.name) +
            (t.sport ? ' <span class="sp-dorm-sport">' + esc(t.sport) + '</span>' : '') + '</span>' +
            (t.note ? '<span class="sp-dorm-n">' + esc(t.note) + '</span>' : '') +
            (t.url ? '</a>' : '</div>');
        }).join('')
      : '';

    var notes = (d.notes || []).slice();
    if (d.generated) {
      notes.push('Updated ' + new Date(d.generated).toLocaleString('en-US',
        { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.');
    }
    $('sp-foot').textContent = notes.join(' ');
  }

  function wire() {
    $('sp-scope').addEventListener('click', function (e) {
      var b = e.target.closest('[data-scope]');
      if (!b) return;
      state.scope = b.dataset.scope;
      state.org = null;
      render();
    });
    $('sp-orgs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]');
      if (!b) return;
      state.org = b.dataset.pick || null;
      render();
    });
  }

  fetch('data/sports.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (json) {
      if (!json || !Array.isArray(json.games)) throw new Error('bad shape');
      state.data = json;
      wire();
      render();
    })
    .catch(function () {
      $('sp-list').innerHTML =
        '<p class="page-empty">Couldn’t load the schedule. It is rebuilt through the day — try again shortly.</p>';
    });
})();
