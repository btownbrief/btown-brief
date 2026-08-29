/* Currents — Reddit: the same pulse.json payload, filtered to the sources
   whose site is reddit.com. There is no Reddit API call here and never will
   be (standing rule): titles come off the wire, the row links out to the
   thread. source.short is already r/sub shaped, so it doubles as the chip.  */
(function () {
  'use strict';
  var state = { data: null, el: null, sub: null };

  Currents.register('reddit', {
    mount: function (el) {
      state.el = el;
      el.innerHTML = '<p class="c-loading">Loading threads…</p>';
      Currents.load('pulse', function (json) {
        state.data = json;
        render();
      }, function () {
        el.innerHTML = '<div class="c-error">Couldn\'t reach the feed. Refresh to try again.</div>';
      });
    },
    activate: function () {},
    deactivate: function () {},
  });

  function render() {
    var el = state.el, esc = Currents.esc, map = {};
    var subs = [];
    state.data.sources.forEach(function (s) {
      map[s.id] = s;
      if (/reddit\.com/.test(s.site || '')) subs.push(s);
    });
    subs.sort(function (a, b) { return (a.short || '').localeCompare(b.short || ''); });
    if (state.sub && !subs.some(function (s) { return s.id === state.sub; })) state.sub = null;

    var items = state.data.items.filter(function (it) {
      var s = map[it.s];
      if (!s || !/reddit\.com/.test(s.site || '')) return false;
      return !state.sub || it.s === state.sub;
    });

    el.innerHTML = '<p class="c-kicker">Threads</p>';
    var chips = document.createElement('div');
    chips.className = 'chip-row';
    chips.appendChild(chip('All', state.sub === null, function () { state.sub = null; render(); el.scrollTo({ top: 0 }); }));
    subs.forEach(function (s) {
      chips.appendChild(chip(s.short || s.id, state.sub === s.id, function () {
        state.sub = s.id; render(); el.scrollTo({ top: 0 });
      }));
    });
    el.appendChild(chips);

    if (!items.length) {
      el.insertAdjacentHTML('beforeend', '<p class="c-empty">No threads on the wire right now.</p>');
      return;
    }
    var card = document.createElement('div');
    card.className = 'c-card';
    items.slice(0, 200).forEach(function (it) {
      var src = map[it.s] || {};
      var wrap = document.createElement('div');
      wrap.className = 'feed-row';
      wrap.innerHTML =
        '<a class="feed-main" href="' + esc(it.u) + '" target="_blank" rel="noopener">' +
          '<span class="feed-title">' + esc(it.t || 'Untitled') + '</span>' +
          '<span class="feed-src">' + esc(src.short || '') +
            (it.d ? ' · ' + Currents.ago(it.d) : '') + ' · thread ↗</span>' +
        '</a>' +
        Currents.starBtn(it.u);
      Currents.bindStar(wrap, { href: it.u, title: it.t || 'Untitled', from: src.short || 'Reddit' });
      card.appendChild(wrap);
    });
    el.appendChild(card);
  }

  function chip(label, on, fn) {
    var b = document.createElement('button');
    b.className = 'chip' + (on ? ' is-on' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
})();
