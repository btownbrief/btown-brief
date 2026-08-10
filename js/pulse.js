/* The Pulse — renders data/pulse.json (built by scripts/refresh_pulse.py).
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
  var META_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-data/data/pulse-meta.json';
  var LOCAL_URL = 'data/pulse.json';
  /* reddit rides shotgun after LOCAL — Burlington Pulse means the town's
     own conversation ranks above the national topic split */
  var TOPIC_ORDER = ['local', 'reddit', 'newsletters', 'news', 'tech', 'business',
                     'science', 'culture', 'politics', 'sports', 'gaming', 'pods'];
  var TOPIC_LABEL = { all: 'All topics', local: 'Local', reddit: 'Reddit', pods: 'Podcasts',
                      top: 'Top', popular: 'Popular', saved: 'Saved' };
  var FEED_PAGE = 120;      // headlines per MORE click — a page, not a pit
  var READ_CAP = 4000;      // read-marks kept before pruning oldest
  var SET_KEY = 'pulse2-settings';
  var READ_KEY = 'pulse2-read';

  /* V2.1 — the interaction layer */
  var TOP_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-top/data/pulse-top.json';
  var SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon/publishable — safe to ship
  var INTENT_KEY = 'pulse2-intent';   // url-key -> epoch sec, "read with intent" marks
  var SAVED_KEY = 'pulse2-saved';     // read-later list
  var DIG_KEY = 'pulse2-dug';         // url-key -> ET day, one dig vote per story per day
  var RQ_KEY = 'pulse2-rq';           // reactions that failed to send, retried next load
  var PING_KEY = 'pulse2-ping';       // last ET day we pinged the anonymous counter
  var NUDGE_KEY = 'pulse2-nudge';     // take-a-break nudge state
  var CLIENT_TABS = ['top', 'popular', 'saved'];  // rendered client-side, not payload topics
  var SAVED_CAP = 300;
  var SWIPE_COMMIT = 72;    // px of horizontal drag that commits a swipe

  var state = {
    data: null,
    stale: false,           // true when the live fetch failed and main's snapshot rendered
    topic: 'all',
    source: null,
    view: 'feed',
    q: '',
    shown: FEED_PAGE,
    set: { theme: 'auto', fs: 17, limit: 10, autohide: false, thumbs: true, hidden: {}, intent: false },
    read: {},
    intent: {},             // passed-with-intent marks
    saved: [],              // [{k,t,u,s,d,sv}] newest-saved first
    top: null,              // pulse-top.json payload (AI-picked TOP tab)
    popular: null,          // [{url,title,source,saves}] from Supabase
  };
  var srcMap = {};
  var byKey = {};           // url-key -> {t,u,s,d} for gesture + tab lookups
  /* items passed-with-intent before this moment are hidden; marks made during
     this session stay visible (dimmed) so the feed never shifts under you */
  var intentCutoff = Math.round(Date.now() / 1000);

  function $(id) { return document.getElementById(id); }

  /* ---------- storage ---------- */

  function loadStored() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
      if (s && typeof s === 'object') {
        ['theme', 'fs', 'limit', 'autohide', 'thumbs', 'intent'].forEach(function (k) {
          if (s[k] !== undefined) state.set[k] = s[k];
        });
        if (s.hidden && typeof s.hidden === 'object') state.set.hidden = s.hidden;
        if (s.view === 'sources' || s.view === 'feed') state.view = s.view;
      }
      var r = JSON.parse(localStorage.getItem(READ_KEY) || 'null');
      if (r && typeof r === 'object') state.read = r;
      var m = JSON.parse(localStorage.getItem(INTENT_KEY) || 'null');
      if (m && typeof m === 'object') state.intent = m;
      var sv = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null');
      if (Array.isArray(sv)) state.saved = sv;
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify({
        theme: state.set.theme, fs: state.set.fs, limit: state.set.limit,
        autohide: state.set.autohide, thumbs: state.set.thumbs,
        hidden: state.set.hidden, view: state.view, intent: state.set.intent,
      }));
    } catch (e) {}
  }

  function saveIntent() {
    try {
      var keys = Object.keys(state.intent);
      if (keys.length > READ_CAP) {
        keys.sort(function (a, b) { return state.intent[a] - state.intent[b]; });
        keys.slice(0, keys.length - READ_CAP).forEach(function (k) { delete state.intent[k]; });
      }
      localStorage.setItem(INTENT_KEY, JSON.stringify(state.intent));
    } catch (e) {}
  }

  function saveSaved() {
    try {
      if (state.saved.length > SAVED_CAP) state.saved.length = SAVED_CAP;
      localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved));
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

  function etDay() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function isClientTab(t) { return CLIENT_TABS.indexOf(t) !== -1; }

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
      var k = keyOf(item.u);
      if (state.set.autohide && state.read[k]) return false;
      /* read-with-intent: marks from previous visits vanish; marks made this
         session stay (dimmed) so the list never shifts mid-read. Search is
         explicit retrieval — it always sees everything. */
      if (state.set.intent && state.view === 'feed' && !state.source && !state.q &&
          state.intent[k] && state.intent[k] < intentCutoff) return false;
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

  function topFresh() {
    if (!state.top || !Array.isArray(state.top.picks) || !state.top.picks.length) return false;
    var age = Date.now() - Date.parse(state.top.generated || 0);
    return isFinite(age) && age < 30 * 3600 * 1000;   // 3x/day cadence + slack
  }

  function renderTabs() {
    var present = { all: true };
    state.data.sources.forEach(function (src) {
      if (state.set.hidden[src.id]) return;
      present[src.topic] = true;
      if (src.pod) present.pods = true;
      if (isReddit(src)) present.reddit = true;
    });
    /* client tabs appear once they have something to show */
    present.top = topFresh();
    present.popular = !!(state.popular && state.popular.length);
    present.saved = state.saved.length > 0;
    var html = ['top', 'popular', 'all'].concat(TOPIC_ORDER).concat(['saved'])
      .filter(function (t) { return present[t]; })
      .map(function (t) {
        var on = !state.source && state.topic === t;
        var accent = (t === 'local' || t === 'reddit' || t === 'top') ? ' t-' + t : '';
        return '<button class="tab' + accent +
          '" data-topic="' + t + '" aria-pressed="' + on + '">' +
          esc(topicLabel(t)) + '</button>';
      }).join('');
    $('topic-tabs').innerHTML = html;
  }

  function renderSourceBar() {
    if (isClientTab(state.topic) && !state.source) {
      $('source-bar').innerHTML = '';
      return;
    }
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
    if (state.checked) {
      /* quiet spell honesty: the pipeline looked recently, found nothing new */
      var checkedAge = Date.now() - Date.parse(state.checked);
      var genAge = age ? Date.now() - age : 0;
      if (age && genAge > 20 * 60000 && checkedAge < genAge - 4 * 60000) {
        bits.push('checked ' + fmtAge(Date.parse(state.checked) / 1000).toLowerCase() + ' ago');
      }
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

  function metaHTML(src, item, acts) {
    return '<div class="fi-meta">' +
      '<button class="chip c-' + esc(src.topic) + '" data-source="' + src.id +
      '" title="' + esc(src.name) + '">' + esc(src.short) + '</button>' +
      '<span class="age" data-ts="' + item.d + '">' + fmtAge(item.d) + '</span>' +
      (acts || '') +
      (item.a ? '<button class="play" data-audio="' + esc(safeUrl(item.a)) +
        '" data-title="' + esc(item.t) + '">▶ Play</button>' : '') +
      '</div>';
  }

  function feedItemHTML(item) {
    var src = srcMap[item.s];
    var k = keyOf(item.u);
    var read = state.read[k];
    var passed = state.set.intent && state.intent[k];
    var thumb = (state.set.thumbs && item.i) ?
      '<img class="thumb" src="' + esc(safeUrl(item.i)) + '" alt="" loading="lazy" ' +
      'referrerpolicy="no-referrer" ' +
      'onerror="this.parentNode.classList.remove(\'has-thumb\');this.remove()">' : '';
    var disc = discHTML(item);
    var headline = item.x
      ? '<span class="fi-t nolink">' + esc(item.t) + '</span>'
      : '<a class="fi-t" data-k="' + k + '" href="' + esc(safeUrl(item.u)) +
        '" target="_blank" rel="noopener">' + esc(item.t) + '</a>';
    var acts = '';
    if (!item.x) {
      byKey[k] = item;
      acts = '<div class="fi-acts">' +
        '<button class="act" data-act="save" data-k="' + k + '" title="Save to read later">+ Save</button>' +
        '<button class="act" data-act="dig" data-k="' + k + '" title="Vote for a deep-dive on this topic">Dig ↓</button></div>';
    }
    return '<article class="fi' + (src.local ? ' local' : '') + (read ? ' read' : '') +
      (passed ? ' passed' : '') + (thumb ? ' has-thumb' : '') +
      (item.x ? '' : '" data-k="' + k) + '">' +
      '<div class="fi-main">' + metaHTML(src, item, acts) + headline +
      (disc ? '<div class="fi-disc">' + disc + '</div>' : '') + '</div>' +
      thumb + '</article>';
  }

  function renderBody() {
    renderBodyInner();
    observeIntent();
  }

  function renderBodyInner() {
    var body = $('pulse-body');
    var more = $('more-btn');
    more.hidden = true;

    if (!state.source && state.topic === 'top') { renderTop(body); return; }
    if (!state.source && state.topic === 'popular') { renderPopular(body); return; }
    if (!state.source && state.topic === 'saved') { renderSaved(body); return; }

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
      /* the earned nudge: ~240 headlines deep (after the 2nd MORE click) */
      var nudge = (state.shown >= 3 * FEED_PAGE && !state.q && slice.length) ? nudgeHTML() : '';
      body.innerHTML = '<div class="feed">' +
        (slice.length ? slice.map(feedItemHTML).join('') + nudge :
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

  /* ---------- client tabs: TOP / POPULAR / SAVED ---------- */

  /* rows for items that may not exist in the payload (saved long ago,
     popular from other readers) — same look as the feed, minus thumbs */
  function liteItemHTML(o) {
    byKey[o.k] = { t: o.t, u: o.u, s: o.s || '', d: o.d };
    var read = state.read[o.k];
    var src = o.s ? srcMap[o.s] : null;
    var chip = src
      ? '<button class="chip c-' + esc(src.topic) + '" data-source="' + src.id +
        '" title="' + esc(src.name) + '">' + esc(src.short) + '</button>'
      : '<span class="chip">' + esc(o.short || 'PULSE') + '</span>';
    var meta = '<div class="fi-meta">' + chip +
      (o.d ? '<span class="age" data-ts="' + o.d + '">' + fmtAge(o.d) + '</span>' : '') +
      (o.saves ? '<span class="pop">' + (+o.saves || 0) + ' saved</span>' : '') +
      (o.unsave ? '<button class="unsave" data-unsave="' + o.k + '" aria-label="Remove from saved">✕</button>' : '') +
      '</div>';
    return '<article class="fi' + (o.local ? ' local' : '') + (read ? ' read' : '') +
      '" data-k="' + o.k + '">' +
      '<div class="fi-main">' + meta +
      '<a class="fi-t" data-k="' + o.k + '" href="' + esc(safeUrl(o.u)) +
      '" target="_blank" rel="noopener"' + (o.why ? ' title="' + esc(o.why) + '"' : '') + '>' +
      esc(o.t) + '</a></div></article>';
  }

  function clientQ(title) {
    if (!state.q) return true;
    var hay = title.toLowerCase();
    return state.q.toLowerCase().split(/\s+/).every(function (term) {
      return !term || hay.indexOf(term) !== -1;
    });
  }

  function renderTop(body) {
    if (!topFresh()) {
      body.innerHTML = '<p class="empty">The Top list is being picked. Back soon.</p>';
      renderCount(0, 0);
      return;
    }
    var rows = state.top.picks.filter(function (p) { return p && p.t && p.u && clientQ(p.t); })
      .map(function (p) {
        return liteItemHTML({ k: keyOf(p.u), t: p.t, u: p.u, s: p.s, short: p.short,
                              local: p.local, d: p.d, why: p.why });
      });
    body.innerHTML =
      '<p class="empty" style="margin:18px auto 0">Fifteen headlines worth your ten minutes · ' +
      'picked by an AI editor 3× a day · headlines verbatim, never rewritten</p>' +
      '<div class="feed">' + rows.join('') + '</div>';
    renderCount(rows.length, 0);
  }

  function renderPopular(body) {
    var list = state.popular || [];
    var rows = list.filter(function (r) { return r && r.title && r.url && clientQ(r.title); })
      .map(function (r) {
        var src = srcMap[r.source];
        return liteItemHTML({ k: keyOf(r.url), t: r.title, u: r.url, s: src ? r.source : '',
                              short: src ? src.short : r.source, local: src && src.local,
                              saves: r.saves });
      });
    body.innerHTML = rows.length
      ? '<p class="empty" style="margin:18px auto 0">What other readers saved for later in the last 48 hours · the feed itself is never ranked</p>' +
        '<div class="feed">' + rows.join('') + '</div>'
      : '<p class="empty">Nothing trending among readers yet.</p>';
    renderCount(rows.length, 0);
  }

  function renderSaved(body) {
    var rows = state.saved.filter(function (o) { return clientQ(o.t); })
      .map(function (o) {
        var src = srcMap[o.s];
        return liteItemHTML({ k: o.k, t: o.t, u: o.u, s: src ? o.s : '',
                              short: src ? src.short : (o.s || ''), local: src && src.local,
                              d: o.d, unsave: true });
      });
    body.innerHTML = rows.length
      ? '<div class="feed">' + rows.join('') + '</div>'
      : '<p class="empty">Nothing saved yet — swipe a headline right to keep it for later.</p>';
    renderCount(rows.length, 0);
  }

  /* ---------- confirm dialog + toast ---------- */

  var confirmYesFn = null;

  function confirmBox(o) {
    $('confirm-title').textContent = o.title;
    $('confirm-body').textContent = o.body;
    $('confirm-yes').textContent = o.yes;
    $('confirm-no').textContent = o.no || 'Cancel';
    confirmYesFn = o.onYes;
    $('confirm').hidden = false;
    $('confirm-scrim').hidden = false;
    $('confirm-yes').focus();
  }

  function closeConfirm() {
    $('confirm').hidden = true;
    $('confirm-scrim').hidden = true;
    confirmYesFn = null;
  }

  var toastTimer, toastUndoFn = null;

  function toastUndo(msg, undoFn) {
    $('toast-msg').textContent = msg;
    $('toast-undo').hidden = !undoFn;
    toastUndoFn = undoFn || null;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; toastUndoFn = null; }, 5000);
  }

  function toast(msg) { toastUndo(msg, null); }

  /* ---------- Supabase (same project + anon-key pattern as the games) ---------- */

  function rpc(fn, args) {
    var headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
    if (SB_KEY.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + SB_KEY;
    return fetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: headers, body: JSON.stringify(args), keepalive: true,
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function playerId() {
    var v = null;
    try { v = localStorage.getItem('btown-player-id'); } catch (e) {}
    if (!v) {
      v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
      try { localStorage.setItem('btown-player-id', v); } catch (e) {}
    }
    return v;
  }

  function queueReact(payload) {
    try {
      var q = JSON.parse(localStorage.getItem(RQ_KEY) || '[]');
      if (!Array.isArray(q)) q = [];
      q.push(payload);
      localStorage.setItem(RQ_KEY, JSON.stringify(q.slice(-50)));
    } catch (e) {}
  }

  function flushReacts() {
    var q;
    try { q = JSON.parse(localStorage.getItem(RQ_KEY) || '[]'); } catch (e) { return; }
    if (!Array.isArray(q) || !q.length) return;
    try { localStorage.setItem(RQ_KEY, '[]'); } catch (e) {}
    q.forEach(function (payload) {
      rpc('pulse_react', payload).catch(function () { queueReact(payload); });
    });
  }

  /* reactions are persist-first: the payload lands in the outbox immediately
     (so a closed tab can't lose it), undo pulls it back out, and the flush
     5.2s later — or the next visit — actually sends it */
  function outboxAdd(kind, item) {
    queueReact({
      p_player: playerId(), p_kind: kind,
      p_url: item.u, p_title: item.t, p_source: item.s || '',
    });
  }

  function outboxRemove(kind, url) {
    try {
      var q = JSON.parse(localStorage.getItem(RQ_KEY) || '[]');
      if (!Array.isArray(q)) return;
      localStorage.setItem(RQ_KEY, JSON.stringify(q.filter(function (x) {
        return !(x.p_kind === kind && x.p_url === url);
      })));
    } catch (e) {}
  }

  function pingDaily() {
    try {
      var day = etDay();
      if (localStorage.getItem(PING_KEY) === day) return;
      rpc('pulse_ping', { p_player: playerId(), p_day: day }).then(function () {
        try { localStorage.setItem(PING_KEY, day); } catch (e) {}
      }).catch(function () {});
    } catch (e) {}
  }

  function loadPopular() {
    rpc('pulse_popular', { p_hours: 48, p_min: 2, p_limit: 40 }).then(function (rows) {
      if (Array.isArray(rows) && rows.length) {
        state.popular = rows;
        if (state.data) render();
      }
    }).catch(function () {});   /* tab simply stays hidden until the SQL exists */
  }

  function loadTop() {
    if (isLocalDev() && location.protocol === 'file:') return;
    fetchJSON(TOP_URL, 8000).then(function (json) {
      if (json && Array.isArray(json.picks)) {
        state.top = json;
        if (state.data) render();
      }
    }).catch(function () {});
  }

  /* ---------- save / dig / mute actions ---------- */

  function isSaved(k) {
    return state.saved.some(function (o) { return o.k === k; });
  }

  function unsave(k) {
    state.saved = state.saved.filter(function (o) { return o.k !== k; });
    saveSaved();
    /* the SAVED tab disappears with its last item — don't strand the reader */
    if (state.topic === 'saved' && !state.saved.length) { setTopic('all'); return; }
    render();
  }

  function commitSave(k) {
    var item = byKey[k];
    if (!item || !item.u) return;
    if (isSaved(k)) { toast('Already saved'); return; }
    state.saved.unshift({ k: k, t: item.t, u: item.u, s: item.s || '',
                          d: item.d || Math.round(Date.now() / 1000),
                          sv: Math.round(Date.now() / 1000) });
    saveSaved();
    renderTabs();
    outboxAdd('save', item);
    var send = setTimeout(flushReacts, 5200);   /* after the undo window */
    toastUndo('Saved for later', function () {
      clearTimeout(send);
      outboxRemove('save', item.u);
      unsave(k);
    });
  }

  function commitDig(k) {
    var item = byKey[k];
    if (!item || !item.u) return;
    var dug;
    try { dug = JSON.parse(localStorage.getItem(DIG_KEY) || '{}') || {}; } catch (e) { dug = {}; }
    var day = etDay();
    if (dug[k] === day) { toast('Already voted on this one today'); return; }
    dug[k] = day;
    var keys = Object.keys(dug);
    if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(function (x) { delete dug[x]; });
    try { localStorage.setItem(DIG_KEY, JSON.stringify(dug)); } catch (e) {}
    outboxAdd('dig', item);
    var send = setTimeout(flushReacts, 5200);
    toastUndo('Voted — enough votes builds a deep-dive page', function () {
      clearTimeout(send);
      outboxRemove('dig', item.u);
      try {
        delete dug[k];
        localStorage.setItem(DIG_KEY, JSON.stringify(dug));
      } catch (e) {}
    });
  }

  function holdMute(k) {
    var item = byKey[k];
    var src = item && srcMap[item.s];
    if (!src) return;
    confirmBox({
      title: 'Mute ' + src.short + '?',
      body: 'You won’t see ' + src.short + ' anywhere on the page. Bring it back any time in Settings → Sources.',
      yes: 'Mute',
      onYes: function () {
        state.set.hidden[src.id] = 1;
        saveSettings(); renderSettingsPanel(); render();
        toastUndo('Muted ' + src.short, function () {
          delete state.set.hidden[src.id];
          saveSettings(); renderSettingsPanel(); render();
        });
      },
    });
  }

  /* ---------- the swipe layer ---------- */

  var G = { el: null, key: null, x0: 0, y0: 0, id: null, mode: '', hold: 0 };
  var suppressUntil = 0;
  var suppressEl = null;    // the row whose post-gesture click we swallow

  function gestureReset() {
    clearTimeout(G.hold);
    if (G.el && G.mode === 'swipe') {
      var el = G.el;
      el.classList.remove('swiping', 'sw-r', 'sw-l');
      el.classList.add('settling');
      el.style.transform = '';
      setTimeout(function () { el.classList.remove('settling'); }, 200);
    }
    G.el = null; G.key = null; G.mode = '';
  }

  function bindGestures() {
    if (!window.PointerEvent) return;

    /* anchors are natively draggable — a link-drag swallows the pointer
       stream and the swipe never sees another event */
    document.addEventListener('dragstart', function (ev) {
      if (ev.target.closest && ev.target.closest('#pulse-body .fi[data-k]')) ev.preventDefault();
    });

    /* Android's long-press link menu would beat the 550ms mute hold */
    document.addEventListener('contextmenu', function (ev) {
      if (G.el && ev.target.closest && ev.target.closest('#pulse-body .fi[data-k]')) {
        ev.preventDefault();
      }
    });

    document.addEventListener('pointerdown', function (ev) {
      if (!ev.isPrimary || ev.button) return;
      var row = ev.target.closest && ev.target.closest('#pulse-body .fi[data-k]');
      if (!row) return;
      if (ev.target.closest('.fi-acts, .unsave, .play, .chip, .disc')) return;
      clearTimeout(G.hold);
      G.el = row; G.key = row.dataset.k; G.x0 = ev.clientX; G.y0 = ev.clientY;
      G.id = ev.pointerId; G.mode = '';
      G.hold = setTimeout(function () {
        if (G.el && !G.mode) {
          G.mode = 'hold';   /* G stays live until release, so the eventual
                                click lands inside the suppression window */
          holdMute(G.key);
        }
      }, 550);
    });

    document.addEventListener('pointermove', function (ev) {
      if (!G.el || ev.pointerId !== G.id || G.mode === 'hold') return;
      var dx = ev.clientX - G.x0;
      var dy = ev.clientY - G.y0;
      if (!G.mode) {
        if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { gestureReset(); return; }
        if (Math.abs(dx) > 24) {
          G.mode = 'swipe';
          clearTimeout(G.hold);
          G.el.classList.add('swiping');
          try { G.el.setPointerCapture(ev.pointerId); } catch (e) {}
          try { getSelection().removeAllRanges(); } catch (e) {}
        }
      }
      if (G.mode === 'swipe') {
        var lim = Math.max(-120, Math.min(120, dx));
        G.el.style.transform = 'translateX(' + lim + 'px)';
        G.el.classList.toggle('sw-r', dx > 40);
        G.el.classList.toggle('sw-l', dx < -40);
      }
    });

    function up(ev) {
      if (!G.el || ev.pointerId !== G.id) return;
      clearTimeout(G.hold);
      if (G.mode === 'hold') {
        suppressUntil = Date.now() + 400;
        suppressEl = G.el;
        gestureReset();
        return;
      }
      if (G.mode === 'swipe') {
        var dx = ev.clientX - G.x0;
        var key = G.key;
        suppressUntil = Date.now() + 400;
        suppressEl = G.el;
        gestureReset();
        if (ev.type !== 'pointercancel') {
          if (dx >= SWIPE_COMMIT) commitSave(key);
          else if (dx <= -SWIPE_COMMIT) commitDig(key);
        }
      } else {
        gestureReset();
      }
    }
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);

    /* a committed swipe or hold must not also open the article — but only
       clicks on that row; the rest of the page stays responsive */
    document.addEventListener('click', function (ev) {
      if (Date.now() < suppressUntil && suppressEl &&
          (suppressEl === ev.target || suppressEl.contains(ev.target))) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    }, true);
  }

  /* ---------- read with intent ---------- */

  var io = null;
  var intentSaveTimer = 0;
  var intentSeen = {};   // keys that were actually on screen this render

  function onIntent(entries) {
    var marked = false;
    entries.forEach(function (e) {
      var k = e.target.dataset.k;
      if (!k) return;
      if (e.isIntersecting) { intentSeen[k] = 1; return; }
      /* only mark what the reader actually saw leave the top of the screen —
         a re-render while scrolled deep reports everything above the viewport
         as "not intersecting", and none of that was read */
      if (e.boundingClientRect.bottom <= 0 && intentSeen[k]) {
        if (!state.intent[k]) {
          state.intent[k] = Math.round(Date.now() / 1000);
          e.target.classList.add('passed');
          marked = true;
        }
        if (io) io.unobserve(e.target);
      }
    });
    if (marked) {
      clearTimeout(intentSaveTimer);
      intentSaveTimer = setTimeout(saveIntent, 800);
    }
  }

  function observeIntent() {
    if (!('IntersectionObserver' in window)) return;
    if (io) io.disconnect();
    intentSeen = {};
    if (!state.set.intent || state.view !== 'feed' || state.source || isClientTab(state.topic)) return;
    if (!io) io = new IntersectionObserver(onIntent, { threshold: 0 });
    document.querySelectorAll('#pulse-body .fi[data-k]').forEach(function (el) {
      io.observe(el);
    });
  }

  function applyIntentUI() {
    $('intent-btn').setAttribute('aria-pressed', state.set.intent);
  }

  function toggleIntent() {
    if (!state.set.intent) {
      confirmBox({
        title: 'Read with intent',
        body: 'While this is on, headlines you scroll past won’t reappear in your feed — ' +
          'every visit picks up where you stopped reading. Turning it off brings everything back. ' +
          'Make sure you’re sure.',
        yes: 'Turn on',
        onYes: function () {
          state.set.intent = true;
          saveSettings(); applyIntentUI(); render();
          toast('Reading with intent');
        },
      });
    } else {
      state.set.intent = false;
      saveSettings(); applyIntentUI(); render();
      toast('Intent mode off — everything’s back');
    }
  }

  /* ---------- the earned nudge ---------- */

  function nudgeHTML() {
    var ns;
    try { ns = JSON.parse(localStorage.getItem(NUDGE_KEY) || '{}') || {}; } catch (e) { ns = {}; }
    var day = etDay();
    if (ns.day !== day) {
      ns = { day: day, n: (ns.n || 0) + 1, off: 0 };
      try { localStorage.setItem(NUDGE_KEY, JSON.stringify(ns)); } catch (e) {}
    }
    if (ns.off) return '';
    var inner = (ns.n % 3 === 0)
      ? 'You’ve been reading a lot. Take a break — ' +
        '<a href="https://play.btownbrief.com?utm_source=pulse&utm_medium=nudge" target="_blank" rel="noopener">go play something at the Btown Digital Arcade →</a>'
      : 'You’ve been reading a lot. How about reading the Btown Brief? ' +
        '<a href="https://btownbrief.com?utm_source=guide&utm_medium=referral&utm_campaign=pulse-nudge" target="_blank" rel="noopener">The daily email for Burlington — free →</a>';
    return '<div class="nudge">' + inner +
      '<button class="nudge-x" data-nudge-dismiss aria-label="Dismiss for today">✕</button></div>';
  }

  /* ---------- the rail: Burlington right now ---------- */

  var railBits = { wx: [], civic: '' };

  function renderRail() {
    var bits = railBits.wx.concat(railBits.civic ? [railBits.civic] : []);
    if (bits.length < 2) return;
    $('rail').innerHTML = bits.map(esc).join(' · ') +
      ' · <a href="https://btownbrief.com?utm_source=guide&utm_medium=referral&utm_campaign=pulse-rail" target="_blank" rel="noopener">The Brief →</a>';
    $('rail').hidden = false;
  }

  function loadRail() {
    fetchJSON('data/weather/latest.json', 8000).then(function (w) {
      var bits = [];
      if (w && w.now && w.now.temp_f != null) {
        bits.push(Math.round(w.now.temp_f) + '°' +
          (w.now.description ? ' ' + w.now.description : ''));
      }
      if (w && w.lake_gage && w.lake_gage.water_temp_f != null) {
        bits.push('Lake ' + Math.round(w.lake_gage.water_temp_f) + '°');
      }
      if (w && w.sun && w.sun.sunset) {
        var t = new Date(w.sun.sunset).toLocaleTimeString('en-US',
          { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
        bits.push('Sunset ' + t.replace(/\s?[AP]M$/i, ''));
      }
      railBits.wx = bits;
      renderRail();
    }).catch(function () {});
    fetchJSON('data/civic.json', 8000).then(function (c) {
      if (!c || !Array.isArray(c.upcoming)) return;
      var now = Date.now();
      var next = null;
      c.upcoming.forEach(function (m) {
        if (next || !m.start || !m.body) return;
        var t = Date.parse(m.start);
        if (t > now && t < now + 7 * 86400000) next = m;
      });
      if (!next) return;
      var d = new Date(next.start);
      var label = next.body.length > 22 ? next.body.slice(0, 21) + '…' : next.body;
      var when = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
      if (!next.time_uncertain) {
        when += ' ' + d.toLocaleTimeString('en-US',
          { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
          .replace(':00', '').replace(/\s/, '');
      }
      railBits.civic = label + ' ' + when;
      renderRail();
    }).catch(function () {});
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
    /* client tabs only exist in feed form — fall back to the full grid */
    if (view === 'sources' && isClientTab(state.topic)) state.topic = 'all';
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
    if (h.t && (h.t === 'all' || TOPIC_ORDER.indexOf(h.t) !== -1 ||
                CLIENT_TABS.indexOf(h.t) !== -1)) state.topic = h.t;
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
    /* fresh payload = a fresh visit: intent marks made before now take effect */
    intentCutoff = Math.round(Date.now() / 1000);
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

  function pollMeta() {
    if (isLocalDev()) return;
    fetchJSON(META_URL, 6000).then(function (meta) {
      if (!meta || !meta.checked) return;
      state.checked = meta.checked;
      if (state.data && state.lastCount) renderCount(state.lastCount[0], state.lastCount[1]);
    }).catch(function () {});
  }

  function checkFresh() {
    if (!state.data || document.hidden || isLocalDev()) return;
    pollMeta();
    loadTop();
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
      var el = ev.target.closest('[data-topic],[data-source],[data-togsrc],[data-audio],' +
        '[data-act],[data-unsave],[data-nudge-dismiss],a[data-k]');
      if (!el) return;
      if (el.dataset.topic) { setTopic(el.dataset.topic); return; }
      if (el.dataset.act) {
        if (el.dataset.act === 'save') commitSave(el.dataset.k);
        else commitDig(el.dataset.k);
        return;
      }
      if (el.dataset.unsave) { unsave(el.dataset.unsave); return; }
      if (el.hasAttribute('data-nudge-dismiss')) {
        try {
          var ns = JSON.parse(localStorage.getItem(NUDGE_KEY) || '{}') || {};
          ns.day = etDay(); ns.off = 1;
          localStorage.setItem(NUDGE_KEY, JSON.stringify(ns));
        } catch (e) {}
        var box = el.closest('.nudge');
        if (box) box.remove();
        return;
      }
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

    $('intent-btn').onclick = toggleIntent;
    $('confirm-yes').onclick = function () {
      var fn = confirmYesFn;
      closeConfirm();
      if (fn) fn();
    };
    $('confirm-no').onclick = closeConfirm;
    $('confirm-scrim').onclick = closeConfirm;
    $('toast-undo').onclick = function () {
      if (toastUndoFn) toastUndoFn();
      toastUndoFn = null;
      $('toast').hidden = true;
    };

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
      if (ev.key === 'Escape') { openDrawer(false); openSearch(false); closeConfirm(); return; }
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
  applyIntentUI();
  $('view-feed').setAttribute('aria-pressed', state.view === 'feed');
  $('view-sources').setAttribute('aria-pressed', state.view === 'sources');
  if (state.q) { $('search-row').hidden = false; $('search-input').value = state.q; }
  bind();
  bindGestures();
  loadData();
  pollMeta();
  loadTop();
  loadPopular();
  loadRail();
  flushReacts();
  pingDaily();
})();
