/* Burlington Pulse — renders data/pulse.json (built by scripts/refresh_pulse.py).
   The live copy lives on the `pulse-data` branch and is fetched from
   raw.githubusercontent.com (CORS-open, ~5 min edge cache) so headlines stay
   ~20 minutes fresh without a Pages deploy; the copy committed on main is a
   first-paint / offline fallback only.

   Two ways to read the same payload, both borrowed from the Brutalist Report:
     FEED       one dense newest-first column across every source (their iOS app)
     BY SOURCE  a grid of per-source blocks, last N headlines each (their site)
   Plus the app's creature comforts: topic tabs, tap-a-source-to-filter,
   full-text search, read dimming with optional auto-hide, adjustable type,
   and inline playback for podcast items. All state is localStorage-local. */
(function () {
  'use strict';

  var LIVE_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-data/data/pulse.json';
  var LOCAL_URL = 'data/pulse.json';
  /* reddit rides shotgun after LOCAL — Burlington Pulse means the town's
     own conversation ranks above the national topic split */
  var TOPIC_ORDER = ['local', 'reddit', 'newsletters', 'news', 'tech', 'business',
                     'science', 'culture', 'politics', 'sports', 'gaming', 'pods'];
  var TOPIC_LABEL = { all: 'All topics', local: 'Local', reddit: 'Reddit', pods: 'Podcasts' };
  var FEED_PAGE = 120;      // headlines per MORE click — a page, not a pit
  var READ_CAP = 4000;      // read-marks kept before pruning oldest
  var SET_KEY = 'pulse2-settings';
  var READ_KEY = 'pulse2-read';

  var state = {
    data: null,
    stale: false,           // true when the live fetch failed and main's snapshot rendered
    topic: 'all',
    source: null,
    view: 'feed',
    q: '',
    shown: FEED_PAGE,
    set: { theme: 'auto', fs: 17, limit: 10, autohide: false, thumbs: true, hidden: {} },
    read: {},
  };
  var srcMap = {};

  function $(id) { return document.getElementById(id); }

  /* ---------- storage ---------- */

  function loadStored() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
      if (s && typeof s === 'object') {
        ['theme', 'fs', 'limit', 'autohide', 'thumbs'].forEach(function (k) {
          if (s[k] !== undefined) state.set[k] = s[k];
        });
        if (s.hidden && typeof s.hidden === 'object') state.set.hidden = s.hidden;
        if (s.view === 'sources' || s.view === 'feed') state.view = s.view;
      }
      var r = JSON.parse(localStorage.getItem(READ_KEY) || 'null');
      if (r && typeof r === 'object') state.read = r;
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify({
        theme: state.set.theme, fs: state.set.fs, limit: state.set.limit,
        autohide: state.set.autohide, thumbs: state.set.thumbs,
        hidden: state.set.hidden, view: state.view,
      }));
    } catch (e) {}
  }

  function saveRead() {
    try {
      var keys = Object.keys(state.read);
      if (keys.length > READ_CAP) {
        keys.sort(function (a, b) { return state.read[a] - state.read[b]; });
        keys.slice(0, keys.length - READ_CAP).forEach(function (k) { delete state.read[k]; });
      }
      localStorage.setItem(READ_KEY, JSON.stringify(state.read));
    } catch (e) {}
  }

  /* ---------- little helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeUrl(u) {
    return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : '#';
  }

  /* djb2 — tiny stable key so the read-list stores 8 chars per URL, not 120 */
  function keyOf(u) {
    var h = 5381;
    for (var i = 0; i < u.length; i++) h = ((h << 5) + h + u.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function fmtAge(ts) {
    var s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 90) return 'NOW';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'M';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'H';
    var d = Math.round(h / 24);
    if (d < 7) return d + 'D';
    var w = Math.round(d / 7);
    if (w < 52) return w + 'W';
    return Math.round(d / 365) + 'Y';
  }

  function topicLabel(t) {
    return TOPIC_LABEL[t] || (t.charAt(0).toUpperCase() + t.slice(1));
  }

  /* ---------- derivations ---------- */

  function isReddit(src) {
    return (src.site || '').indexOf('reddit.com') !== -1;
  }

  function inTopic(src, topic) {
    if (topic === 'all') return true;
    if (topic === 'pods') return !!src.pod;
    if (topic === 'reddit') return isReddit(src);
    return src.topic === topic;
  }

  function visibleSources(topic) {
    if (!state.data) return [];
    return state.data.sources.filter(function (src) {
      return !state.set.hidden[src.id] && inTopic(src, topic);
    });
  }

  function matchesQuery(item, src) {
    if (!state.q) return true;
    var hay = (item.t + ' ' + src.short + ' ' + src.name).toLowerCase();
    return state.q.toLowerCase().split(/\s+/).every(function (term) {
      return !term || hay.indexOf(term) !== -1;
    });
  }

  function filteredItems() {
    if (!state.data) return [];
    return state.data.items.filter(function (item) {
      var src = srcMap[item.s];
      if (!src || state.set.hidden[src.id]) return false;
      if (state.source ? src.id !== state.source : !inTopic(src, state.topic)) return false;
      if (state.set.autohide && state.read[keyOf(item.u)]) return false;
      return matchesQuery(item, src);
    });
  }

  /* ---------- rendering ---------- */

  function render() {
    if (!state.data) return;
    if (state.source && !srcMap[state.source]) state.source = null;
    renderTabs();
    renderSourceBar();
    renderBody();
    writeHash();
  }

  function renderTabs() {
    var present = { all: true };
    state.data.sources.forEach(function (src) {
      if (state.set.hidden[src.id]) return;
      present[src.topic] = true;
      if (src.pod) present.pods = true;
      if (isReddit(src)) present.reddit = true;
    });
    var html = ['all'].concat(TOPIC_ORDER).filter(function (t) { return present[t]; })
      .map(function (t) {
        var on = !state.source && state.topic === t;
        var accent = (t === 'local' || t === 'reddit') ? ' t-' + t : '';
        return '<button class="tab' + accent +
          '" data-topic="' + t + '" aria-pressed="' + on + '">' +
          esc(topicLabel(t)) + '</button>';
      }).join('');
    $('topic-tabs').innerHTML = html;
  }

  function renderSourceBar() {
    var pool = visibleSources(state.topic).filter(function (src) { return src.n > 0; });
    pool.sort(function (a, b) {
      if (!!a.local !== !!b.local) return a.local ? -1 : 1;
      var pa = a.pr || 500, pb = b.pr || 500;   /* curated leads, then A–Z */
      if (pa !== pb) return pa - pb;
      return a.short.localeCompare(b.short);
    });
    var html = '<button class="srcchip" data-source="" aria-pressed="' + !state.source +
      '">All sources</button>' +
      pool.map(function (src) {
        return '<button class="srcchip' + (src.local ? ' s-local' : '') +
          '" data-source="' + src.id + '" aria-pressed="' + (state.source === src.id) +
          '">' + esc(src.short) + '</button>';
      }).join('');
    $('source-bar').innerHTML = html;
  }

  function renderCount(shownItems, sections) {
    state.lastCount = [shownItems, sections];
    var bits = ['<strong>' + shownItems.toLocaleString('en-US') + '</strong> headlines'];
    if (state.view === 'sources' && !state.source) bits.unshift(sections + ' sources');
    if (state.source && srcMap[state.source]) bits.push(esc(srcMap[state.source].short));
    else if (state.topic !== 'all') bits.push(esc(topicLabel(state.topic)));
    if (state.q) bits.push('“' + esc(state.q) + '”');
    var age = Date.parse(state.data.generated);
    if (age) {
      var label = fmtAge(age / 1000);
      bits.push(label === 'NOW' ? 'updated just now'
                                : 'updated ' + label.toLowerCase() + ' ago');
    }
    if (state.stale) bits.push('cached copy');
    var line = bits.join(' · ');
    var el = $('count-line');
    /* aria-live region: only touch it when the text really changed, or the
       45-second age timer re-announces the whole line to screen readers */
    if (el.getAttribute('data-line') !== line) {
      el.setAttribute('data-line', line);
      el.innerHTML = line;
    }
  }

  /* [r/sub] / [hn·N] thread links, matched server-side from the streams —
     the brutalist.report [hn] suffix, minus any Reddit/HN API. */
  function discHTML(item) {
    var bits = '';
    if (item.r) {
      var sub = /reddit\.com\/(r\/[^/]+)/.exec(item.r);
      bits += ' <a class="disc" href="' + esc(safeUrl(item.r)) +
        '" target="_blank" rel="noopener">[' + esc(sub ? sub[1].toLowerCase() : 'reddit') + ']</a>';
    }
    var thread = item.h || item.du;
    if (thread) {
      var n = (item.hc != null) ? item.hc : item.dn;
      bits += ' <a class="disc" href="' + esc(safeUrl(thread)) +
        '" target="_blank" rel="noopener">[hn' + (n != null ? '·' + (+n || 0) : '') + ']</a>';
    }
    return bits;
  }

  function metaHTML(src, item) {
    return '<div class="fi-meta">' +
      '<button class="chip c-' + esc(src.topic) + '" data-source="' + src.id +
      '" title="' + esc(src.name) + '">' + esc(src.short) + '</button>' +
      '<span class="age" data-ts="' + item.d + '">' + fmtAge(item.d) + '</span>' +
      (item.a ? '<button class="play" data-audio="' + esc(safeUrl(item.a)) +
        '" data-title="' + esc(item.t) + '">▶ Play</button>' : '') +
      '</div>';
  }

  function feedItemHTML(item) {
    var src = srcMap[item.s];
    var read = state.read[keyOf(item.u)];
    var thumb = (state.set.thumbs && item.i) ?
      '<img class="thumb" src="' + esc(safeUrl(item.i)) + '" alt="" loading="lazy" ' +
      'referrerpolicy="no-referrer" ' +
      'onerror="this.parentNode.classList.remove(\'has-thumb\');this.remove()">' : '';
    var disc = discHTML(item);
    var headline = item.x
      ? '<span class="fi-t nolink">' + esc(item.t) + '</span>'
      : '<a class="fi-t" data-k="' + keyOf(item.u) + '" href="' + esc(safeUrl(item.u)) +
        '" target="_blank" rel="noopener">' + esc(item.t) + '</a>';
    return '<article class="fi' + (src.local ? ' local' : '') + (read ? ' read' : '') +
      (thumb ? ' has-thumb' : '') + '">' +
      '<div class="fi-main">' + metaHTML(src, item) + headline +
      (disc ? '<div class="fi-disc">' + disc + '</div>' : '') + '</div>' +
      thumb + '</article>';
  }

  function renderBody() {
    var body = $('pulse-body');
    var more = $('more-btn');
    more.hidden = true;

    if (state.source) {                       /* single source, app-style list */
      var src = srcMap[state.source];
      var items = filteredItems();
      body.innerHTML =
        '<div class="solo-head"><h2 class="solo-name' + '">' + esc(src.short) + '</h2>' +
        (src.site ? '<a class="mlink" href="' + esc(safeUrl(src.site)) +
          '" target="_blank" rel="noopener">Visit site ↗</a>' : '') +
        '<button class="mlink" data-source="">← All sources</button></div>' +
        '<div class="feed">' +
        (items.length ? items.map(feedItemHTML).join('') :
          '<p class="empty">Nothing here right now.</p>') + '</div>';
      renderCount(items.length, 0);
      return;
    }

    if (state.view === 'feed') {
      var all = filteredItems();
      var slice = all.slice(0, state.shown);
      body.innerHTML = '<div class="feed">' +
        (slice.length ? slice.map(feedItemHTML).join('') :
          '<p class="empty">No headlines match.</p>') + '</div>';
      if (all.length > slice.length) {
        more.hidden = false;
        more.textContent = 'MORE HEADLINES ↓ (' + (all.length - slice.length) + ' MORE)';
      }
      renderCount(all.length, 0);
      return;
    }

    /* by-source grid — the brutalist.report front page */
    var sections = [];
    var count = 0;
    visibleSources(state.topic).forEach(function (src) {
      var items = state.data.items.filter(function (item) {
        return item.s === src.id &&
          !(state.set.autohide && state.read[keyOf(item.u)]) &&
          matchesQuery(item, src);
      }).slice(0, state.set.limit);
      if (!items.length) return;
      count += items.length;
      sections.push({ src: src, items: items, newest: items[0].d });
    });
    sections.sort(function (a, b) { return b.newest - a.newest; });
    body.innerHTML = sections.length ? '<div class="grid">' +
      sections.map(function (sec) {
        var src = sec.src;
        return '<section class="src-sec' + (src.local ? ' local' : '') + '">' +
          '<h3 class="src-head"><button class="src-name c-' + esc(src.topic) +
          '" data-source="' + src.id +
          '" title="See only ' + esc(src.name) + '">' + esc(src.short) + '</button>' +
          (src.site ? '<a class="src-out" href="' + esc(safeUrl(src.site)) +
            '" target="_blank" rel="noopener" aria-label="Open ' + esc(src.name) +
            '">↗</a>' : '') +
          '<span class="src-tag">' + (src.local ? 'Local' : esc(src.topic)) +
          ' · ' + src.n + '</span></h3><ul>' +
          sec.items.map(function (item) {
            var read = state.read[keyOf(item.u)];
            var headline = item.x
              ? '<span class="si-t nolink">' + esc(item.t) + '</span>'
              : '<a class="si-t" data-k="' + keyOf(item.u) + '" href="' +
                esc(safeUrl(item.u)) + '" target="_blank" rel="noopener">' +
                esc(item.t) + '</a>';
            return '<li' + (read ? ' class="read"' : '') + '>' + headline +
              '<span class="age" data-ts="' + item.d + '">' + fmtAge(item.d) + '</span>' +
              discHTML(item) +
              (item.a ? '<button class="play" data-audio="' + esc(safeUrl(item.a)) +
                '" data-title="' + esc(item.t) + '">▶</button>' : '') +
              '</li>';
          }).join('') + '</ul></section>';
      }).join('') + '</div>' :
      '<p class="empty">No headlines match.</p>';
    renderCount(count, sections.length);
  }

  function renderSettingsPanel() {
    document.querySelectorAll('[data-theme-pick]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.themePick === state.set.theme);
    });
    document.querySelectorAll('[data-limit]').forEach(function (b) {
      b.setAttribute('aria-pressed', +b.dataset.limit === state.set.limit);
    });
    document.querySelectorAll('[data-hide]').forEach(function (b) {
      b.setAttribute('aria-pressed', (b.dataset.hide === 'on') === state.set.autohide);
    });
    document.querySelectorAll('[data-thumbs]').forEach(function (b) {
      b.setAttribute('aria-pressed', (b.dataset.thumbs === 'on') === state.set.thumbs);
    });
    $('fs-range').value = state.set.fs;
    $('fs-val').textContent = state.set.fs;

    if (!state.data) return;
    var groups = [
      { label: 'Local', match: function (s) { return s.local; } },
      { label: 'Newsletters', match: function (s) { return s.topic === 'newsletters'; } },
      { label: 'National', match: function (s) { return !s.local && s.topic !== 'newsletters'; } },
    ];
    $('source-toggles').innerHTML = groups.map(function (g) {
      var rows = state.data.sources.filter(g.match)
        .sort(function (a, b) { return a.short.localeCompare(b.short); })
        .map(function (src) {
          var off = !!state.set.hidden[src.id];
          return '<button class="srctog' + (off ? ' off' : '') + '" data-togsrc="' + src.id +
            '" aria-pressed="' + !off + '"><span class="nm">' + esc(src.short) +
            '</span><span class="eye">' + (off ? '✕' : '👁') + '</span></button>';
        }).join('');
      return '<p class="srctog-group">' + g.label + '</p>' + rows;
    }).join('');
  }

  /* ---------- state changes ---------- */

  function applyFont() {
    document.body.style.setProperty('--fs', state.set.fs + 'px');
  }

  function applyTheme() {
    var pick = state.set.theme;
    if (pick !== 'light' && pick !== 'dark') {
      pick = 'dark';
      try {
        var sun = JSON.parse(localStorage.getItem('btown-sun') || 'null');
        var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
          year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        if (sun && sun.day === today) {
          var now = Date.now();
          pick = (now >= sun.rise && now < sun.set) ? 'light' : 'dark';
        }
      } catch (e) {}
    }
    document.documentElement.setAttribute('data-theme', pick);
  }

  function setTopic(topic) {
    state.topic = topic;
    state.source = null;
    state.shown = FEED_PAGE;
    render();
  }

  function setSource(id) {
    state.source = id || null;
    state.shown = FEED_PAGE;
    if (id && srcMap[id] && !inTopic(srcMap[id], state.topic)) state.topic = 'all';
    render();
    if (id) window.scrollTo({ top: 0 });
  }

  function setView(view) {
    state.view = view;
    state.source = null;
    state.shown = FEED_PAGE;
    $('view-feed').setAttribute('aria-pressed', view === 'feed');
    $('view-sources').setAttribute('aria-pressed', view === 'sources');
    saveSettings();
    render();
  }

  function markRead(key, node) {
    if (state.read[key]) return;
    state.read[key] = Math.round(Date.now() / 1000);
    saveRead();
    if (node) node.classList.add('read');
  }

  /* ---------- URL hash (shareable filters) ---------- */

  function writeHash() {
    var parts = [];
    if (state.view !== 'feed') parts.push('v=' + state.view);
    if (state.topic !== 'all') parts.push('t=' + state.topic);
    if (state.source) parts.push('s=' + state.source);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    var next = parts.length ? '#' + parts.join('&') : '';
    if (next !== location.hash) {
      history.replaceState(null, '', location.pathname + location.search + next);
    }
  }

  function readHash(reset) {
    var h = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i > 0) h[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    });
    if (reset) {
      /* back/forward navigation: absent keys mean their defaults, otherwise
         going back from #t=tech to a bare URL would leave the filter stuck */
      state.topic = 'all';
      state.source = null;
      state.q = '';
      state.view = (h.v === 'sources') ? 'sources' : 'feed';
    }
    /* the fragment is attacker-writable (anyone can craft a link) — only
       known topics and slug-shaped source ids may enter state */
    if (h.v === 'sources') state.view = 'sources';
    if (h.t && (h.t === 'all' || TOPIC_ORDER.indexOf(h.t) !== -1)) state.topic = h.t;
    if (h.s && /^[a-z0-9-]+$/.test(h.s)) state.source = h.s;
    if (h.q) state.q = h.q;
  }

  /* ---------- data loading ---------- */

  function fetchJSON(url, timeoutMs) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, timeoutMs);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  function applyData(json, stale) {
    if (!json || !Array.isArray(json.sources) || !Array.isArray(json.items)) return;
    var map = {};
    json.sources.forEach(function (src) { map[src.id] = src; });
    state.data = json;
    state.stale = !!stale;
    srcMap = map;
    if (state.source && !srcMap[state.source]) state.source = null;
    render();
    renderSettingsPanel();
  }

  function isLocalDev() {
    return location.protocol === 'file:' ||
      /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname);
  }

  function loadData() {
    var local = isLocalDev();
    var first = local ? LOCAL_URL : LIVE_URL;
    var second = local ? LIVE_URL : LOCAL_URL;
    /* "cached copy" means production had to fall back to main's snapshot;
       local dev reading its own snapshot is just… local dev. */
    fetchJSON(first, 8000).then(function (json) { applyData(json, false); })
      .catch(function () {
        fetchJSON(second, 8000).then(function (json) { applyData(json, !local); })
          .catch(function () {
            $('pulse-body').innerHTML =
              '<p class="empty">Couldn\'t reach the feed. Refresh to try again.</p>';
          });
      });
  }

  var pendingFresh = null;

  function checkFresh() {
    if (!state.data || document.hidden || isLocalDev()) return;
    fetchJSON(LIVE_URL, 8000).then(function (json) {
      if (!json || json.generated === state.data.generated) return;
      if (window.scrollY < 300) { applyData(json); return; }
      pendingFresh = json;   /* keep the newest, even if the pill already exists */
      if ($('fresh-pill')) return;
      var pill = document.createElement('button');
      pill.className = 'fresh';
      pill.id = 'fresh-pill';
      pill.textContent = '↑ FRESH HEADLINES';
      pill.onclick = function () {
        pill.remove();
        if (pendingFresh) applyData(pendingFresh);
        pendingFresh = null;
        window.scrollTo({ top: 0 });
      };
      document.body.appendChild(pill);
    }).catch(function () {});
  }

  /* ---------- wiring ---------- */

  function openDrawer(open) {
    $('drawer').hidden = !open;
    $('scrim').hidden = !open;
    $('settings-btn').setAttribute('aria-expanded', open);
    if (open) renderSettingsPanel();
  }

  var searchTimer;

  function openSearch(open) {
    $('search-row').hidden = !open;
    $('search-btn').setAttribute('aria-expanded', open);
    if (open) { $('search-input').focus(); return; }
    clearTimeout(searchTimer);   /* a keystroke in flight must not resurrect the query */
    if (state.q) { state.q = ''; $('search-input').value = ''; render(); }
  }

  function bind() {
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-topic],[data-source],[data-togsrc],[data-audio],a[data-k]');
      if (!el) return;
      if (el.dataset.topic) { setTopic(el.dataset.topic); return; }
      if (el.dataset.togsrc !== undefined) {
        if (state.set.hidden[el.dataset.togsrc]) delete state.set.hidden[el.dataset.togsrc];
        else state.set.hidden[el.dataset.togsrc] = 1;
        saveSettings(); renderSettingsPanel(); render();
        return;
      }
      if (el.dataset.audio) {
        var audio = $('player-audio');
        $('player').hidden = false;
        $('player-title').textContent = el.dataset.title || '';
        if (audio.src !== el.dataset.audio) audio.src = el.dataset.audio;
        if (audio.paused) audio.play(); else audio.pause();
        return;
      }
      if (el.dataset.k) {           /* headline link — let it open, remember it */
        markRead(el.dataset.k, el.closest('.fi, li'));
        return;
      }
      if (el.dataset.source !== undefined) { setSource(el.dataset.source); }
    });
    document.addEventListener('auxclick', function (ev) {
      var el = ev.target.closest('a[data-k]');
      if (el) markRead(el.dataset.k, el.closest('.fi, li'));
    });

    $('view-feed').onclick = function () { setView('feed'); };
    $('view-sources').onclick = function () { setView('sources'); };
    $('more-btn').onclick = function () { state.shown += FEED_PAGE; renderBody(); };

    $('theme-btn').onclick = function () {
      var cur = document.documentElement.getAttribute('data-theme');
      state.set.theme = (cur === 'dark') ? 'light' : 'dark';
      saveSettings(); applyTheme(); renderSettingsPanel();
    };

    $('settings-btn').onclick = function () { openDrawer($('drawer').hidden); };
    $('drawer-close').onclick = function () { openDrawer(false); };
    $('scrim').onclick = function () { openDrawer(false); };

    $('search-btn').onclick = function () { openSearch($('search-row').hidden); };
    $('search-clear').onclick = function () { openSearch(false); };
    $('search-input').addEventListener('input', function () {
      clearTimeout(searchTimer);
      var value = this.value;
      searchTimer = setTimeout(function () {
        state.q = value.trim();
        state.shown = FEED_PAGE;
        render();
      }, 130);
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { openDrawer(false); openSearch(false); return; }
      if (ev.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        ev.preventDefault();
        openSearch(true);
      }
    });

    document.addEventListener('click', function (ev) {
      var pick = ev.target.closest('[data-theme-pick]');
      if (pick) {
        state.set.theme = pick.dataset.themePick;
        saveSettings(); applyTheme(); renderSettingsPanel();
      }
      var limit = ev.target.closest('[data-limit]');
      if (limit) {
        state.set.limit = +limit.dataset.limit;
        saveSettings(); renderSettingsPanel(); render();
      }
      var hide = ev.target.closest('[data-hide]');
      if (hide) {
        state.set.autohide = hide.dataset.hide === 'on';
        saveSettings(); renderSettingsPanel(); render();
      }
      var thumbs = ev.target.closest('[data-thumbs]');
      if (thumbs) {
        state.set.thumbs = thumbs.dataset.thumbs === 'on';
        saveSettings(); renderSettingsPanel(); render();
      }
    });

    $('show-all-btn').onclick = function () {
      state.set.hidden = {};
      saveSettings(); renderSettingsPanel(); render();
    };

    $('fs-range').addEventListener('input', function () {
      state.set.fs = +this.value;
      $('fs-val').textContent = this.value;
      applyFont();
      saveSettings();
    });

    $('player-close').onclick = function () {
      $('player-audio').pause();
      $('player').hidden = true;
    };

    window.addEventListener('hashchange', function () {
      readHash(true);
      $('view-feed').setAttribute('aria-pressed', state.view === 'feed');
      $('view-sources').setAttribute('aria-pressed', state.view === 'sources');
      var box = $('search-input');
      if (box.value !== state.q) box.value = state.q;
      render();
    });
  }

  /* keep the little [4M] ages honest without re-rendering anything */
  setInterval(function () {
    document.querySelectorAll('.age[data-ts]').forEach(function (el) {
      el.textContent = fmtAge(+el.dataset.ts);
    });
    if (state.data && state.lastCount) renderCount(state.lastCount[0], state.lastCount[1]);
  }, 45000);
  setInterval(checkFresh, 10 * 60 * 1000);

  loadStored();
  readHash();
  applyFont();
  applyTheme();
  $('view-feed').setAttribute('aria-pressed', state.view === 'feed');
  $('view-sources').setAttribute('aria-pressed', state.view === 'sources');
  if (state.q) { $('search-row').hidden = false; $('search-input').value = state.q; }
  bind();
  loadData();
})();
