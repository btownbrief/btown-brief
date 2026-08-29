/* Currents — Pulse: the wire.

   Two payloads. pulse-top.json carries the three-times-a-day editorial picks
   (each with a one-line `why`) and rides at the top; pulse.json is the full
   2,500-item wire underneath it, newest first, 60 rows at a time. pulse-top
   has no same-origin copy, so when it fails the strip simply is not there.

   Rows use source.short — the wire's display name. Reddit lives on its own
   tab, so its sources are filtered out of this one.                        */
(function () {
  'use strict';
  var PAGE = 60;
  var state = { data: null, top: null, shown: PAGE, el: null, local: false };

  Currents.register('pulse', {
    mount: function (el) {
      state.el = el;
      el.innerHTML = '<p class="c-loading">Loading the wire…</p>';
      Currents.load('pulse', function (json) {
        state.data = json;
        render();
      }, function () {
        el.innerHTML = '<div class="c-error">Couldn\'t reach the feed. Pull down or refresh to try again.</div>';
      });
      Currents.load('pulse-top', function (json) {
        state.top = json;
        if (state.data) render();
      }, function () { /* fail soft: no picks strip */ });
    },
    activate: function () {},
    deactivate: function () {},
  });

  function srcMap() {
    var m = {};
    (Array.isArray(state.data.sources) ? state.data.sources : [])
      .forEach(function (s) { if (s && s.id) m[s.id] = s; });
    return m;
  }

  function render() {
    var el = state.el, map = srcMap(), esc = Currents.esc;
    var base = Currents.visitBase();
    var items = (Array.isArray(state.data.items) ? state.data.items : []).filter(function (it) {
      var s = it && map[it.s];
      if (!s || /reddit\.com/.test(s.site || '')) return false;
      if (state.local && !(s.local === 1 || s.topic === 'local')) return false;
      return true;
    });
    el.innerHTML = '';

    if (state.top && Array.isArray(state.top.picks) && state.top.picks.length) {
      var top = document.createElement('section');
      top.className = 'p-top';
      top.innerHTML = '<p class="c-kicker">The picks · ' +
        esc(Currents.ago(Math.floor(new Date(state.top.generated).getTime() / 1000))) + ' ago</p>';
      var rail = document.createElement('div');
      rail.className = 'w-shelf';
      state.top.picks.slice(0, 8).filter(Boolean).forEach(function (p) {
        var card = document.createElement('a');
        card.className = 'c-card p-pick';
        card.href = Currents.safeHref(p.u); card.target = '_blank'; card.rel = 'noopener';
        card.innerHTML =
          '<span class="feed-src">' + esc(p.short || '') + (p.local ? ' · Local' : '') + '</span>' +
          '<span class="p-pick-title">' + esc(p.t) + '</span>' +
          (p.why ? '<span class="p-why">' + esc(p.why) + '</span>' : '');
        rail.appendChild(card);
      });
      top.appendChild(rail);
      el.appendChild(top);
    }

    var head = document.createElement('div');
    head.className = 'p-head';
    head.innerHTML = '<p class="c-kicker">The wire</p>';
    var toggle = document.createElement('button');
    toggle.className = 'chip' + (state.local ? ' is-on' : '');
    toggle.textContent = 'Local only';
    toggle.addEventListener('click', function () {
      state.local = !state.local;
      state.shown = PAGE;
      render();
      el.scrollTo({ top: 0 });
    });
    head.appendChild(toggle);
    el.appendChild(head);

    if (!items.length) {
      el.insertAdjacentHTML('beforeend', '<p class="c-empty">Nothing on the wire for that.</p>');
      return;
    }

    var card = document.createElement('div');
    card.className = 'c-card';
    items.slice(0, state.shown).forEach(function (it) {
      card.appendChild(row(it, map[it.s] || {}, base, esc));
    });
    el.appendChild(card);

    if (state.shown < items.length) {
      var more = document.createElement('button');
      more.className = 'feed-more';
      more.textContent = 'More';
      more.addEventListener('click', function () {
        state.shown += PAGE;
        render();
      });
      el.appendChild(more);
    } else {
      el.insertAdjacentHTML('beforeend', '<p class="caught-up">You\'re caught up ✓</p>');
    }
  }

  function row(it, src, base, esc) {
    var href = it.u;
    var wrap = document.createElement('div');
    wrap.className = 'feed-row';
    wrap.innerHTML =
      '<a class="feed-main" href="' + esc(Currents.safeHref(href)) + '" target="_blank" rel="noopener">' +
        '<span class="feed-title">' + esc(it.t || 'Untitled') + '</span>' +
        '<span class="feed-src">' + esc(src.short || src.name || '') +
          (it.d ? ' · ' + Currents.ago(it.d) : '') +
          (base && it.d * 1000 > base ? ' · <b class="is-new">new</b>' : '') +
        '</span>' +
      '</a>' +
      (it.i ? '<img class="feed-thumb" loading="lazy" referrerpolicy="no-referrer" src="' + esc(it.i) + '" alt="">' : '') +
      Currents.starBtn(href);
    Currents.bindStar(wrap, { href: href, title: it.t || 'Untitled', from: src.short || src.name || 'The wire' });
    return wrap;
  }

})();
