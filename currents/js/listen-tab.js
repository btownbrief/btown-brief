/* Currents — Listen: the podcast side of the same pulse.json wire.

   Sources with pod===1 are shows; their items with an `a` are episodes.
   Local shows (topic 'local' / local 1) lead, everything else follows.
   Shows collapse into cards; tapping one opens its episode list in place,
   so 871 episodes never all land on screen at once.

   The feature card and the Spotify embed are the Brief's own show — the
   markup mirrors listen.html so the two pages stay recognisably the same.
   Playback is entirely the shell's: one <audio> that survives tab switches. */
(function () {
  'use strict';
  var SHOW = 'https://open.spotify.com/show/6ejf0OFAyNTZNKDzFLWbKp';
  var state = { data: null, el: null, open: {}, local: true };

  Currents.register('listen', {
    mount: function (el) {
      state.el = el;
      el.innerHTML = '<p class="c-loading">Tuning in…</p>';
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

  function epKey(ep) { return ep.a; }
  function resumeOf(ep) {
    return parseFloat(Currents.store(Currents.stateKey('resume-' + epKey(ep))) || '0');
  }

  function build() {
    var shows = {}, order = [];
    state.data.sources.forEach(function (s) {
      if (s.pod !== 1) return;
      shows[s.id] = { src: s, eps: [], local: s.local === 1 || s.topic === 'local' };
      order.push(s.id);
    });
    state.data.items.forEach(function (it) {
      if (!it.a || !shows[it.s]) return;
      shows[it.s].eps.push(it);
    });
    var list = order.map(function (id) { return shows[id]; })
      .filter(function (s) { return s.eps.length; });
    list.forEach(function (s) {
      s.eps.sort(function (a, b) { return (b.d || 0) - (a.d || 0); });
      s.art = (s.eps.filter(function (e) { return e.i; })[0] || {}).i || null;
    });
    return list;
  }

  function render() {
    var el = state.el, esc = Currents.esc;
    var shows = build();
    el.innerHTML = '';

    var feat = document.createElement('section');
    feat.className = 'c-card l-feature';
    feat.innerHTML =
      '<img src="../assets/btown-arts-cover.jpg" alt="BTown Arts Podcast cover art">' +
      '<div>' +
        '<p class="c-kicker">The Brief\'s own show</p>' +
        '<h2>BTown Arts Podcast</h2>' +
        '<p>Interviews with the artists coming through Burlington and the people making the ' +
          'scene here, hosted by radio veteran Kwame Dankwa.</p>' +
        '<div class="l-btns">' +
          '<a class="w-btn" href="https://www.youtube.com/watch?v=W6LBJ72UKvo" target="_blank" rel="noopener">▶ Watch the HAYLA interview</a>' +
          '<a class="w-btn w-btn-quiet" href="' + SHOW + '" target="_blank" rel="noopener">Follow on Spotify</a>' +
        '</div>' +
      '</div>';
    el.appendChild(feat);

    var embed = document.createElement('iframe');
    embed.className = 'l-show-embed';
    embed.title = 'BTown Arts Podcast — all episodes';
    embed.src = 'https://open.spotify.com/embed/show/6ejf0OFAyNTZNKDzFLWbKp?theme=0';
    embed.loading = 'lazy';
    embed.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    el.appendChild(embed);

    var half = shows.filter(function (s) { return s.local === state.local; });
    var chips = document.createElement('div');
    chips.className = 'chip-row';
    chips.appendChild(chip('Vermont shows', state.local, function () { state.local = true; render(); el.scrollTo({ top: 0 }); }));
    chips.appendChild(chip('Everything else', !state.local, function () { state.local = false; render(); el.scrollTo({ top: 0 }); }));
    el.appendChild(chips);

    var resumes = resumeShelf(shows, esc);
    if (resumes) el.appendChild(resumes);

    el.insertAdjacentHTML('beforeend', '<p class="c-kicker">' +
      (state.local ? 'Local podcasts' : 'More shows') + ' · ' + half.length + '</p>');
    var grid = document.createElement('div');
    grid.className = 'l-shows';
    half.forEach(function (s) { grid.appendChild(showCard(s, esc)); });
    el.appendChild(grid);
  }

  /* an episode you left part-way through is the single most useful row on
     this tab — pull it back to the top */
  function resumeShelf(shows, esc) {
    var open = [];
    shows.forEach(function (s) {
      s.eps.slice(0, 20).forEach(function (ep) {
        var at = resumeOf(ep);
        if (at > 30) open.push({ ep: ep, show: s, at: at });
      });
    });
    if (!open.length) return null;
    var sec = document.createElement('section');
    sec.className = 'w-sec';
    sec.innerHTML = '<p class="c-kicker">Pick up where you left off</p>';
    var card = document.createElement('div');
    card.className = 'c-card';
    open.slice(0, 5).forEach(function (o) {
      card.appendChild(epRow(o.ep, o.show, esc));
    });
    sec.appendChild(card);
    return sec;
  }

  function showCard(s, esc) {
    var wrap = document.createElement('div');
    wrap.className = 'l-show';
    var open = !!state.open[s.src.id];
    var head = document.createElement('button');
    head.className = 'c-card l-show-head' + (open ? ' is-open' : '');
    head.innerHTML =
      (s.art ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(s.art) + '" alt="">' : '<span class="l-noart">🎙</span>') +
      '<span class="l-show-meta">' +
        '<span class="feed-title">' + esc(s.src.short || s.src.name) + '</span>' +
        '<span class="feed-src">' + s.eps.length + ' episodes · newest ' +
          Currents.ago(s.eps[0].d) + '</span>' +
      '</span>' +
      '<span class="l-chev">' + (open ? '▴' : '▾') + '</span>';
    head.addEventListener('click', function () {
      state.open[s.src.id] = !open;
      render();
    });
    wrap.appendChild(head);
    if (open) {
      var list = document.createElement('div');
      list.className = 'c-card l-eps';
      s.eps.slice(0, 30).forEach(function (ep) { list.appendChild(epRow(ep, s, esc)); });
      wrap.appendChild(list);
    }
    return wrap;
  }

  function epRow(ep, s, esc) {
    var row = document.createElement('div');
    row.className = 'feed-row';
    var at = resumeOf(ep);
    row.innerHTML =
      '<button class="feed-main l-play" aria-label="Play ' + esc(ep.t) + '">' +
        '<span class="feed-title">' + esc(ep.t || 'Untitled') + '</span>' +
        '<span class="feed-src">' + esc(s.src.short || s.src.name) +
          (ep.d ? ' · ' + Currents.ago(ep.d) : '') +
          (at > 30 ? ' · ' + Math.round(at / 60) + ' min in' : '') + '</span>' +
      '</button>' +
      Currents.starBtn(ep.a);
    row.querySelector('.l-play').addEventListener('click', function () {
      Currents.playAudio({
        src: ep.a, title: ep.t, show: s.src.short || s.src.name,
        art: ep.i || s.art, key: epKey(ep),
      });
    });
    Currents.bindStar(row, {
      href: ep.u || ep.a, title: ep.t || 'Untitled', from: s.src.short || s.src.name,
    });
    return row;
  }

  function chip(label, on, fn) {
    var b = document.createElement('button');
    b.className = 'chip' + (on ? ' is-on' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
})();
