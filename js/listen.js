/* Listen & Watch — podcasts with in-place playback + the watch cards.

   Episodes ride the Pulse's wire: data/pulse.json on the pulse-data branch
   (raw.githubusercontent.com is CORS-open, ~5 min edge cache), refreshed every
   20 minutes by the same Action that feeds pulse.html. Sources flagged pod:1
   are podcasts; items carry a = audio URL and i = artwork when the feed
   provides them. No new infrastructure — add a feed to the Inoreader
   Podcasts folder and it appears here on its own. */
(function () {
  'use strict';

  var LIVE_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-data/data/pulse.json';
  var LOCAL_URL = 'data/pulse.json';
  var TV_URL = 'data/btown-tv.json';
  var EPISODES_PER_SHOW = 3;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) {
    try { var p = new URL(u); if (p.protocol === 'http:' || p.protocol === 'https:') return u; } catch (e) {}
    return '';
  }
  function ago(sec) {
    var days = Math.floor((Date.now() / 1000 - sec) / 86400);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + 'd ago';
    var months = Math.floor(days / 30);
    return months < 12 ? months + 'mo ago' : Math.floor(months / 12) + 'y ago';
  }

  /* Shows worth the habit that aren't on the wire yet — follow links only.
     When one joins the wire (the Inoreader Podcasts folder, or
     EXTRA_NATIONAL_FEEDS in scripts/refresh_pulse.py) its episodes start
     rendering above automatically and its card here can be retired —
     Reuters World News graduated that way in Aug 2026. */
  var STATIC_NATIONAL = [];

  function podCardHTML(src, eps) {
    var art = '';
    for (var i = 0; i < eps.length; i++) { if (eps[i].i) { art = safeUrl(eps[i].i); break; } }
    var site = safeUrl(src.site || '');
    var name = site
      ? '<a href="' + esc(site) + '">' + esc(src.name) + '</a>'
      : esc(src.name);
    return '<article class="l-pod">' +
      '<div class="l-pod-head">' +
        (art ? '<img class="l-pod-art" src="' + esc(art) + '" alt="" loading="lazy">'
             : '<span class="l-pod-art" aria-hidden="true"></span>') +
        '<h3 class="l-pod-name">' + name + '</h3>' +
      '</div>' +
      '<ul class="l-eps">' + eps.map(function (e) {
        var a = safeUrl(e.a || ''), u = safeUrl(e.u || '');
        return '<li>' +
          (a ? '<button class="play" data-audio="' + esc(a) + '" data-title="' +
               esc(src.short || src.name) + ' — ' + esc(e.t) + '">▶</button>' : '') +
          (u ? '<a href="' + esc(u) + '">' + esc(e.t) + '</a>' : esc(e.t)) +
          (e.d ? '<time>' + ago(e.d) + '</time>' : '') +
        '</li>';
      }).join('') + '</ul>' +
      '<p class="l-pod-more"><a href="pulse.html#s=' + esc(src.id) + '">All episodes on the Pulse →</a></p>' +
    '</article>';
  }

  function staticCardHTML(p) {
    return '<article class="l-pod">' +
      '<div class="l-pod-head"><span class="l-pod-art" aria-hidden="true"></span>' +
      '<h3 class="l-pod-name">' + esc(p.name) + '</h3></div>' +
      '<p class="l-tv-body">' + esc(p.blurb) + '</p>' +
      '<div class="l-pod-links">' + p.links.map(function (l) {
        return '<a href="' + esc(l[1]) + '">' + esc(l[0]) + ' →</a>';
      }).join('') + '</div>' +
    '</article>';
  }

  function render(data) {
    var pods = (data.sources || []).filter(function (s) { return s.pod; });
    var byId = {};
    pods.forEach(function (s) { byId[s.id] = []; });
    (data.items || []).forEach(function (it) {
      // Only real episodes (they carry audio) — some pod-flagged sources also
      // publish articles on the same feed, and those belong to the Pulse.
      if (byId[it.s] && it.a) byId[it.s].push(it);
    });
    pods.forEach(function (s) {
      byId[s.id].sort(function (a, b) { return (b.d || 0) - (a.d || 0); });
    });

    function grid(list) {
      // Freshest show first, silent feeds last.
      list.sort(function (a, b) {
        return ((byId[b.id][0] || {}).d || 0) - ((byId[a.id][0] || {}).d || 0);
      });
      return list.map(function (s) {
        var eps = byId[s.id].slice(0, EPISODES_PER_SHOW);
        return eps.length ? podCardHTML(s, eps) : '';
      }).join('');
    }

    var locals = pods.filter(function (s) { return s.topic === 'local'; });
    var nationals = pods.filter(function (s) { return s.topic !== 'local'; });

    document.getElementById('local-pods').innerHTML =
      grid(locals) || '<p class="l-empty">The wire is quiet — try a refresh.</p>';
    document.getElementById('national-pods').innerHTML =
      grid(nationals) + STATIC_NATIONAL.map(staticCardHTML).join('');
  }

  /* ---------- the shared mini player ---------- */
  var player = document.getElementById('l-player');
  var audio = document.getElementById('l-audio');
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-audio]');
    if (btn) {
      audio.src = btn.getAttribute('data-audio');
      document.getElementById('l-player-title').textContent = btn.getAttribute('data-title') || '';
      player.hidden = false;
      document.body.classList.add('has-player');
      audio.play().catch(function () {});
    }
  });
  document.getElementById('l-player-close').addEventListener('click', function () {
    audio.pause(); audio.removeAttribute('src');
    player.hidden = true;
    document.body.classList.remove('has-player');
  });

  /* ---------- tonight's BTown TV: the pick + a strip of the shelves ----------
     Everything links to tv.html — the nightly page is the show, and its
     reactions live there; this is the storefront window, not a second store. */
  function ytThumb(id) { return /^[\w-]{6,20}$/.test(id) ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : ''; }
  fetch(TV_URL).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.pick) return;
    var p = d.pick;
    var thumb = document.getElementById('tv-thumb');
    var tsrc = ytThumb(p.id || '');
    if (tsrc) { thumb.src = tsrc; thumb.hidden = false; }
    document.getElementById('tv-body').innerHTML =
      '<b>' + esc(p.t) + '</b> — ' + esc(p.ch) +
      (p.dur ? ' · ' + esc(p.dur) : '') +
      (p.why ? '<br>' + esc(p.why) : '');
    // One taste from each shelf, up to six — tonight's spread at a glance.
    var picks = [];
    (d.shelves || []).forEach(function (sh) {
      (sh.items || []).slice(0, 2).forEach(function (v) {
        if (picks.length < 6 && v.id !== p.id) picks.push(v);
      });
    });
    document.getElementById('tv-strip').innerHTML = picks.map(function (v) {
      var t = ytThumb(v.id || '');
      return '<a class="l-tvpick" href="tv.html">' +
        (t ? '<img src="' + esc(t) + '" alt="" loading="lazy">' : '') +
        '<span>' + esc(v.t) + '</span>' +
      '</a>';
    }).join('');
  }).catch(function () {});

  /* ---------- the podcast wire ---------- */
  fetch(LIVE_URL)
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .catch(function () { return fetch(LOCAL_URL).then(function (r) { return r.json(); }); })
    .then(render)
    .catch(function () {
      document.getElementById('local-pods').innerHTML =
        '<p class="l-empty">Couldn’t reach the wire — try a refresh.</p>';
    });
})();
