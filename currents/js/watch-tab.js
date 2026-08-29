/* Currents — Watch: tonight's Btown TV edition plus the raw YouTube wire.

   btown-tv.json is the nightly hand-shaped edition: {pick, shelves[], live[]}
   where every entry already carries id/t/ch/dur/views and a one-line `why`.
   The same-origin copy of it exists but is only as fresh as main's last
   sync, so the live branch always wins (the wire handles that).

   pulse-youtube.json is the 3-hourly firehose (~580 videos) — it has no
   same-origin copy and fails soft into a hidden shelf.

   Ids are validated before they ever reach an iframe src, and thumbs come
   from i.ytimg.com/vi/{id}/hqdefault.jpg only: maxres 404s constantly.     */
(function () {
  'use strict';
  var YT_PAGE = 24;
  var state = { tv: null, yt: null, el: null, ytShown: YT_PAGE, view: 'tv' };

  Currents.register('watch', {
    mount: function (el) {
      state.el = el;
      el.innerHTML = '<p class="c-loading">Tuning the set…</p>';
      Currents.load('btown-tv', function (json) {
        state.tv = json;
        render();
      }, function () {
        state.tv = null;
        if (!state.yt) el.innerHTML = '<div class="c-error">Couldn\'t reach tonight\'s edition.</div>';
        else render();
      });
      Currents.load('pulse-youtube', function (json) {
        state.yt = json;
        render();
      }, function () { /* fail soft: no wire shelf */ });
    },
    activate: function () {},
    deactivate: function () {},
  });

  function thumb(id) { return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; }

  function render() {
    var el = state.el, esc = Currents.esc;
    if (!state.tv && !state.yt) return;
    el.innerHTML = '';

    var nav = document.createElement('div');
    nav.className = 'chip-row';
    nav.appendChild(chip('Tonight', state.view === 'tv', function () { state.view = 'tv'; render(); el.scrollTo({ top: 0 }); }));
    nav.appendChild(chip('Everything new', state.view === 'wire', function () { state.view = 'wire'; render(); el.scrollTo({ top: 0 }); }));
    el.appendChild(nav);

    if (state.view === 'wire') { renderWire(el); return; }
    if (!state.tv) { el.insertAdjacentHTML('beforeend', '<p class="c-empty">Tonight\'s edition isn\'t up yet.</p>'); return; }

    var pick = state.tv.pick;
    if (pick && typeof pick === 'object' && Currents.isVideoId(pick.id)) {
      var hero = document.createElement('button');
      hero.className = 'c-card w-hero';
      hero.innerHTML =
        '<img loading="lazy" src="' + thumb(pick.id) + '" alt="">' +
        '<span class="w-hero-body">' +
          '<span class="c-kicker">Tonight\'s pick</span>' +
          '<span class="w-hero-title">' + esc(pick.t) + '</span>' +
          '<span class="feed-src">' + esc(pick.ch || '') + (pick.dur ? ' · ' + esc(pick.dur) : '') + '</span>' +
          (pick.why ? '<span class="p-why">' + esc(pick.why) + '</span>' : '') +
        '</span>';
      hero.addEventListener('click', function () { Currents.showVideo(pick.id, pick.t); });
      el.appendChild(hero);
    }

    if (Array.isArray(state.tv.live) && state.tv.live.length) {
      el.appendChild(shelf('Live right now', 'Streaming as you read this', state.tv.live));
    }
    (Array.isArray(state.tv.shelves) ? state.tv.shelves : []).forEach(function (s) {
      if (s && Array.isArray(s.items) && s.items.length) el.appendChild(shelf(s.title, s.sub, s.items));
    });
    if (state.tv.generated) {
      el.insertAdjacentHTML('beforeend',
        '<p class="wiki-footer">Edition ' + esc(state.tv.edition || '') + ' · ' +
        '<a href="../tv.html">The full Btown TV board ↗</a></p>');
    }
  }

  function renderWire(el) {
    var esc = Currents.esc;
    if (!state.yt || !Array.isArray(state.yt.videos) || !state.yt.videos.length) {
      el.insertAdjacentHTML('beforeend', '<p class="c-empty">The YouTube wire isn\'t answering right now.</p>');
      return;
    }
    var vids = state.yt.videos.filter(function (v) { return v && Currents.isVideoId(v.id); });
    el.insertAdjacentHTML('beforeend', '<p class="c-kicker">Everything new · ' + vids.length + ' videos</p>');
    var grid = document.createElement('div');
    grid.className = 'v-grid';
    vids.slice(0, state.ytShown).forEach(function (v) { grid.appendChild(vcard(v, esc)); });
    el.appendChild(grid);
    if (state.ytShown < vids.length) {
      var more = document.createElement('button');
      more.className = 'feed-more';
      more.textContent = 'More';
      more.addEventListener('click', function () { state.ytShown += YT_PAGE; render(); });
      el.appendChild(more);
    }
  }

  function vcard(v, esc) {
    var card = document.createElement('div');
    card.className = 'c-card w-card';
    card.innerHTML =
      '<button class="w-card-hit" aria-label="Play ' + esc(v.t) + '">' +
        '<img loading="lazy" src="' + thumb(v.id) + '" alt="">' +
        (v.dur ? '<span class="w-dur">' + esc(v.dur) + '</span>' : '') +
        '<span class="feed-title">' + esc(v.t) + '</span>' +
        '<span class="feed-src">' + esc(v.ch || '') + (v.d ? ' · ' + Currents.ago(v.d) : '') + '</span>' +
        (v.why ? '<span class="p-why">' + esc(v.why) + '</span>' : '') +
      '</button>' +
      Currents.starBtn('https://www.youtube.com/watch?v=' + v.id);
    card.querySelector('.w-card-hit').addEventListener('click', function () {
      Currents.showVideo(v.id, v.t);
    });
    Currents.bindStar(card, {
      href: 'https://www.youtube.com/watch?v=' + v.id,
      title: v.t, from: v.ch || 'YouTube',
    });
    return card;
  }

  function shelf(title, sub, items) {
    var esc = Currents.esc;
    var wrap = document.createElement('section');
    wrap.className = 'w-sec';
    wrap.innerHTML = '<p class="c-kicker">' + esc(title) + '</p>' +
      (sub ? '<p class="w-sub">' + esc(sub) + '</p>' : '');
    var rail = document.createElement('div');
    rail.className = 'w-shelf';
    items.forEach(function (v) {
      if (!v || !Currents.isVideoId(v.id)) return;
      rail.appendChild(vcard(v, esc));
    });
    wrap.appendChild(rail);
    return wrap;
  }

  function chip(label, on, fn) {
    var b = document.createElement('button');
    b.className = 'chip' + (on ? ' is-on' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
})();
