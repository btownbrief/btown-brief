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
  /* reddit rides shotgun after LOCAL — the town's own conversation ranks
     above the national topic split; NEWS leads the nationals */
  var TOPIC_ORDER = ['local', 'reddit', 'news', 'newsletters', 'tech', 'business',
                     'science', 'culture', 'politics', 'sports', 'gaming', 'pods'];
  var TOPIC_LABEL = { all: 'All topics', local: 'Local', reddit: 'Reddit', pods: 'Podcasts',
                      top: 'Top', youtube: 'YouTube', popular: 'Popular', saved: 'Saved', digs: 'Digs',
                      dives: 'Deep Dives' };
  var FEED_PAGE = 120;      // headlines per MORE click — a page, not a pit
  var READ_CAP = 4000;      // read-marks kept before pruning oldest
  var SET_KEY = 'pulse2-settings';
  var READ_KEY = 'pulse2-read';

  /* V2.1 — the interaction layer */
  var TOP_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-top/data/pulse-top.json';
  var YT_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-youtube/data/pulse-youtube.json';
  var SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon/publishable — safe to ship
  var INTENT_KEY = 'pulse2-intent';   // url-key -> epoch sec, focus-mode marks
  var SAVED_KEY = 'pulse2-saved';     // read-later list
  var DIG_KEY = 'pulse2-dug';         // url-key -> ET day, one dig vote per story per day
  var DIGS_KEY = 'pulse2-digs';       // the headlines behind those votes, for the DIGS tab
  var RQ_KEY = 'pulse2-rq';           // reactions that failed to send, retried next load
  var PING_KEY = 'pulse2-ping';       // last ET day we pinged the anonymous counter
  var NUDGE_KEY = 'pulse2-nudge';     // take-a-break nudge state
  var HINT_KEY = 'pulse2-hints';      // gesture how-to card dismissed / learned
  var SEEN_KEY = 'pulse2-focus-seen'; // focus mode used once — stop the pulsing arrows
  var CLIENT_TABS = ['top', 'youtube', 'popular', 'saved', 'digs', 'dives'];  // rendered client-side
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
    set: { theme: 'auto', fs: 17, limit: 15, autohide: false, thumbs: true, hidden: {}, intent: false, ytview: 'list' },
    read: {},
    intent: {},             // focus-mode passed marks
    saved: [],              // [{k,t,u,s,d,sv}] newest-saved first
    digs: [],               // [{k,t,u,s,d,dv}] headlines this reader dig-voted
    top: null,              // pulse-top.json payload (AI-picked TOP tab)
    youtube: null,          // pulse-youtube.json payload (followed channels + trending)
    popular: null,          // [{url,title,source,saves}] from Supabase
    digVotes: null,         // url-key -> today's community vote count (DIGS tab)
    dives: null,            // data/topic-pages.json — published deep-dive pages
  };
  var srcMap = {};
  var popMap = {};          // url-key -> distinct savers, for the "N saved" badges
  var gridSeed = {};        // per-visit shuffle of the by-source grid
  var byKey = {};           // url-key -> {t,u,s,d} for gesture + tab lookups
  /* items passed-with-intent before this moment are hidden; marks made during
     this session stay visible (dimmed) so the feed never shifts under you */
  var intentCutoff = Math.round(Date.now() / 1000);
  var lastGenerated = null;

  function $(id) { return document.getElementById(id); }

  /* ---------- storage ---------- */

  function loadStored() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
      if (s && typeof s === 'object') {
        ['theme', 'fs', 'limit', 'autohide', 'thumbs', 'intent', 'ytview'].forEach(function (k) {
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
      var dg = JSON.parse(localStorage.getItem(DIGS_KEY) || 'null');
      if (Array.isArray(dg)) state.digs = dg;
    } catch (e) {}
  }

  function saveDigs() {
    try {
      if (state.digs.length > 200) state.digs.length = 200;
      localStorage.setItem(DIGS_KEY, JSON.stringify(state.digs));
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify({
        theme: state.set.theme, fs: state.set.fs, limit: state.set.limit,
        autohide: state.set.autohide, thumbs: state.set.thumbs,
        hidden: state.set.hidden, view: state.view, intent: state.set.intent,
        ytview: state.set.ytview,
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
    updateScrollRows();
  }

  /* every chip row gets a "more ›" cue plus a thin thumb showing where you
     are in the scroll — both vanish when the row fits */
  function updateScrollRows() {
    var jobs = [];
    document.querySelectorAll('.srow').forEach(function (row) {
      if (row.hidden) return;
      var nav = row.querySelector('.tabs, .srcbar');
      var more = row.querySelector('.srow-more');
      var less = row.querySelector('.srow-less');
      var bar = row.querySelector('.srow-bar');
      if (!nav || !more || !bar) return;
      jobs.push({ more: more, less: less, bar: bar, thumb: bar.querySelector('i'),
                  sw: nav.scrollWidth, cw: nav.clientWidth, sl: nav.scrollLeft });
    });
    jobs.forEach(function (j) {   /* all reads above, all writes here */
      var overflow = j.sw - j.cw;
      if (overflow < 8) {
        j.more.hidden = true;
        if (j.less) j.less.hidden = true;
        j.bar.hidden = true;
        return;
      }
      j.bar.hidden = false;
      j.more.hidden = j.sl >= overflow - 8;
      if (j.less) j.less.hidden = j.sl < 8;
      if (j.thumb) {
        j.thumb.style.width = Math.max(8, j.cw / j.sw * 100) + '%';
        j.thumb.style.marginLeft = (j.sl / j.sw * 100) + '%';
      }
    });
  }

  /* the two source rails eat a quarter of a phone screen — they collapse
     while you read downward and come back the moment you scroll up.
     Toggling them resizes the sticky header, which would shove the line
     you're reading — so every toggle compensates the scroll position by
     exactly the height the header gained or lost. */
  var srcRowsHidden = false;
  var srcScrollRaf = 0;
  var srcLastY = 0;
  var srcUpRun = 0;         // consecutive upward px — one flick, not jitter

  function setSrcRowsHidden(hide) {
    srcRowsHidden = hide;
    /* browsers with scroll anchoring absorb the header resize themselves,
       ones without it don't — so measure a real content element and correct
       only by whatever net shift actually happened */
    var anchor = null, beforeTop = 0;
    if (window.scrollY > 140) {
      var probeY = Math.min(window.innerHeight - 40, $('mast').offsetHeight + 80);
      anchor = document.elementFromPoint(20, probeY);
      if (anchor) beforeTop = anchor.getBoundingClientRect().top;
    }
    document.body.classList.toggle('src-hidden', hide);
    if (anchor) {
      var moved = anchor.getBoundingClientRect().top - beforeTop;
      if (moved) window.scrollBy(0, moved);
    }
    srcLastY = window.scrollY;
    if (!hide) updateScrollRows();
  }

  function srcRowsOnScroll() {
    srcScrollRaf = 0;
    var y = window.scrollY;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    /* rubber-band overscroll reads as a direction flip — ignore it */
    if (y < 0 || y > max) { srcLastY = Math.min(Math.max(y, 0), max); return; }
    var dy = y - srcLastY;
    srcLastY = y;
    srcUpRun = dy < 0 ? srcUpRun - dy : 0;
    if (!srcRowsHidden && dy > 0 && y > 140) {
      setSrcRowsHidden(true);
    } else if (srcRowsHidden && (y < 40 || srcUpRun > 48)) {
      setSrcRowsHidden(false);
    }
  }

  function bindSrcRowHiding() {
    window.addEventListener('scroll', function () {
      if (!srcScrollRaf) srcScrollRaf = requestAnimationFrame(srcRowsOnScroll);
    }, { passive: true });
  }

  function bindScrollRows() {
    document.querySelectorAll('.srow .tabs, .srow .srcbar').forEach(function (nav) {
      nav.addEventListener('scroll', updateScrollRows, { passive: true });
      /* a mouse wheel only scrolls vertically — feed it to the row */
      nav.addEventListener('wheel', function (ev) {
        if (nav.scrollWidth <= nav.clientWidth) return;
        var delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        if (!delta) return;
        nav.scrollLeft += delta;
        ev.preventDefault();
      }, { passive: false });
    });
    document.querySelectorAll('.srow-more, .srow-less').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nav = btn.parentElement.querySelector('.tabs, .srcbar');
        if (!nav) return;
        var step = Math.round(nav.clientWidth * 0.6) *
          (btn.classList.contains('srow-less') ? -1 : 1);
        nav.scrollBy({ left: step, behavior: 'smooth' });
      });
    });
    window.addEventListener('resize', updateScrollRows);
  }

  function topFresh() {
    if (!state.top || !Array.isArray(state.top.picks) || !state.top.picks.length) return false;
    var age = Date.now() - Date.parse(state.top.generated || 0);
    return isFinite(age) && age < 30 * 3600 * 1000;   // 3x/day cadence + slack
  }

  function ytFresh() {
    if (!state.youtube || !Array.isArray(state.youtube.videos) ||
        !state.youtube.videos.length) return false;
    var age = Date.now() - Date.parse(state.youtube.generated || 0);
    return isFinite(age) && age < 9 * 3600 * 1000;    // 3-hourly cadence + slack
  }

  function tabBtn(t) {
    var on = !state.source && state.topic === t;
    var accent = (t === 'local' || t === 'reddit' || t === 'top' || t === 'youtube') ? ' t-' + t : '';
    return '<button class="tab' + accent +
      '" data-topic="' + t + '" aria-pressed="' + on + '">' +
      esc(topicLabel(t)) + '</button>';
  }

  function renderTabs() {
    var present = { all: true };
    state.data.sources.forEach(function (src) {
      if (state.set.hidden[src.id]) return;
      present[src.topic] = true;
      if (src.pod) present.pods = true;
      if (isReddit(src)) present.reddit = true;
    });
    $('topic-tabs').innerHTML = ['all'].concat(TOPIC_ORDER)
      .filter(function (t) { return present[t]; }).map(tabBtn).join('');
    /* your tabs live on their own line and appear once they have something */
    present.top = topFresh();
    present.youtube = ytFresh();
    present.popular = !!(state.popular && state.popular.length);
    present.saved = state.saved.length > 0;
    present.digs = state.digs.length > 0;
    present.dives = !!(state.dives && state.dives.length);
    var client = CLIENT_TABS.filter(function (t) { return present[t]; }).map(tabBtn).join('');
    $('client-tabs').innerHTML = client;
    $('client-row').hidden = !client;
    updateScrollRows();
  }

  function srcChip(src) {
    return '<button class="srcchip' + (src.local ? ' s-local' : '') +
      '" data-source="' + src.id + '" aria-pressed="' + (state.source === src.id) +
      '">' + esc(src.short) + '</button>';
  }

  function renderSourceBar() {
    if (isClientTab(state.topic) && !state.source) {
      $('source-bar-local').innerHTML = '';
      $('source-bar-national').innerHTML = '';
      $('nat-row').hidden = true;
      return;
    }
    var pool = visibleSources(state.topic).filter(function (src) { return src.n > 0; });
    pool.sort(function (a, b) {
      var pa = a.pr || 500, pb = b.pr || 500;   /* curated leads, then A–Z */
      if (pa !== pb) return pa - pb;
      return a.short.localeCompare(b.short);
    });
    /* locals get the top line, the wire gets its own line below */
    var locals = pool.filter(function (s) { return s.local; });
    var nationals = pool.filter(function (s) { return !s.local; });
    $('source-bar-local').innerHTML =
      '<button class="srcchip" data-source="" aria-pressed="' + !state.source +
      '">All sources</button>' + locals.map(srcChip).join('');
    $('source-bar-national').innerHTML = nationals.map(srcChip).join('');
    $('nat-row').hidden = !nationals.length;
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
    var acts = popMap[k] ? '<span class="pop">' + popMap[k] + ' saved</span>' : '';
    if (!item.x) {
      byKey[k] = item;
      acts += '<div class="fi-acts">' +
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
    if (!state.source && state.topic === 'youtube') { renderYouTube(body); return; }
    if (!state.source && state.topic === 'popular') { renderPopular(body); return; }
    if (!state.source && state.topic === 'saved') { renderSaved(body); return; }
    if (!state.source && state.topic === 'digs') { renderDigs(body); return; }
    if (!state.source && state.topic === 'dives') { renderDives(body); return; }

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
        (slice.length ? hintHTML() + slice.map(feedItemHTML).join('') + nudge :
          '<p class="empty">No headlines match.</p>') + '</div>';
      if (all.length > slice.length) {
        more.hidden = false;
        more.textContent = 'MORE HEADLINES ↓ (' + (all.length - slice.length) + ' MORE)';
      }
      renderCount(all.length, 0);
      return;
    }

    /* by-source grid — the brutalist.report front page, shuffled per visit */
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
      if (gridSeed[src.id] === undefined) gridSeed[src.id] = Math.random();
      sections.push({ src: src, items: items });
    });
    sections.sort(function (a, b) { return gridSeed[a.src.id] - gridSeed[b.src.id]; });
    body.innerHTML = sections.length ? hintHTML() + '<div class="grid">' +
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
            var ik = keyOf(item.u);
            var read = state.read[ik];
            var headline = item.x
              ? '<span class="si-t nolink">' + esc(item.t) + '</span>'
              : '<a class="si-t" data-k="' + ik + '" href="' +
                esc(safeUrl(item.u)) + '" target="_blank" rel="noopener">' +
                esc(item.t) + '</a>';
            if (!item.x) byKey[ik] = item;
            return '<li' + (read ? ' class="read"' : '') +
              (item.x ? '' : ' data-k="' + ik + '"') + '>' + headline +
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
      (o.votes ? '<span class="pop">' + (+o.votes || 0) + ' vote' + (o.votes === 1 ? '' : 's') + ' today</span>' : '') +
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
      '<p class="empty" style="margin:18px auto 0">The 25 headlines worth your time · ' +
      'refreshed through the day · headlines verbatim, never rewritten</p>' +
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

  var digVotesAt = 0;

  function renderDigs(body) {
    var rows = state.digs.filter(function (o) { return clientQ(o.t); })
      .map(function (o) {
        var src = srcMap[o.s];
        var votes = state.digVotes && state.digVotes[o.k];
        return liteItemHTML({ k: o.k, t: o.t, u: o.u, s: src ? o.s : '',
                              short: src ? src.short : (o.s || ''), local: src && src.local,
                              d: o.d, votes: votes });
      });
    body.innerHTML = rows.length
      ? '<p class="empty" style="margin:18px auto 0">Topics you voted to dig into — 3 readers in a day builds the deep-dive page</p>' +
        '<div class="feed">' + rows.join('') + '</div>'
      : '<p class="empty">No votes yet — swipe a headline left when you want the full story.</p>';
    renderCount(rows.length, 0);
    /* pull today's community tallies so your votes show their momentum */
    if (rows.length && Date.now() - digVotesAt > 5 * 60 * 1000) {
      digVotesAt = Date.now();
      rpc('pulse_dig_leaders', { p_day: etDay() }).then(function (leaders) {
        if (!Array.isArray(leaders)) return;
        state.digVotes = {};
        leaders.forEach(function (l) { state.digVotes[keyOf(l.url)] = +l.votes || 0; });
        if (state.topic === 'digs') renderBody();
      }).catch(function () {});
    }
  }

  /* the swipe-left payoff: published deep-dive pages, newest first */
  function renderDives(body) {
    var rows = (state.dives || []).filter(function (p) {
      return p && p.slug && p.title && clientQ(p.title);
    }).map(function (p) {
      return '<article class="fi dive">' +
        '<div class="fi-main"><div class="fi-meta">' +
        '<span class="chip c-science">Deep dive</span>' +
        (p.date ? '<span class="age">' + esc(p.date) + '</span>' : '') +
        '</div>' +
        '<a class="fi-t" href="topics/' + esc(p.slug) + '.html">' + esc(p.title) + '</a>' +
        (p.dek ? '<p class="dive-dek">' + esc(p.dek) + '</p>' : '') +
        '</div></article>';
    });
    body.innerHTML = rows.length
      ? '<p class="empty" style="margin:18px auto 0">Full pages built because readers swiped left · ' +
        'drafted from Wikipedia and real coverage, every link checked</p>' +
        '<div class="feed">' + rows.join('') + '</div>'
      : '<p class="empty">No deep dives published yet — swipe a headline left to ask for one.</p>';
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
        popMap = {};
        rows.forEach(function (r) { popMap[keyOf(r.url)] = +r.saves || 0; });
        if (state.data) render();
      }
    }).catch(function () {});   /* tab simply stays hidden until the SQL exists */
  }

  function fmtViews(n) {
    n = +n || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M views';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K views';
    return n ? n + ' views' : '';
  }

  var YT_GROUPS = [
    ['vt', 'Vermont & local'], ['news', 'News & docs'],
    ['sci', 'Science & explainers'], ['food', 'Food & cooking'],
    ['music', 'Music'], ['fun', 'Wholesome & fun'],
  ];
  var ytSort = 'new';

  function durSec(fmt) {
    if (!fmt) return null;
    var parts = String(fmt).split(':').map(Number);
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  function ytVelocity(v) {
    var days = Math.max((Date.now() / 1000 - (v.d || 0)) / 86400, 0.05);
    return (v.views || 0) / (days + 0.5);
  }

  function ytOrder(list) {
    var out = list.slice();
    if (ytSort === 'hot') out.sort(function (a, b) { return ytVelocity(b) - ytVelocity(a); });
    else if (ytSort === 'short') {
      out = out.filter(function (v) {
        var sec = durSec(v.dur);
        return sec !== null && sec < 300;
      });
      out.sort(function (a, b) { return ytVelocity(b) - ytVelocity(a); });
    } else out.sort(function (a, b) { return (b.d || 0) - (a.d || 0); });
    return out;
  }

  function sampleN(list, n) {
    var pool = list.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, n);
  }

  function ytReg(v) {
    var u = 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id);
    var k = keyOf(u);
    byKey[k] = { t: v.t, u: u, s: '', d: v.d };
    return { u: u, k: k };
  }

  function ytRow(v) {
    var reg = ytReg(v);
    var read = state.read[reg.k];
    var meta = '<div class="fi-meta">' +
      '<span class="chip c-youtube">' + esc(v.ch || 'YouTube') + '</span>' +
      (v.d ? '<span class="age" data-ts="' + v.d + '">' + fmtAge(v.d) + '</span>' : '') +
      (v.dur ? '<span class="age">' + esc(v.dur) + '</span>' : '') +
      (v.views ? '<span class="age">' + esc(fmtViews(v.views)) + '</span>' : '') +
      '</div>';
    return '<article class="fi' + (read ? ' read' : '') + '" data-k="' + reg.k + '">' +
      '<div class="fi-main">' + meta +
      '<a class="fi-t" data-k="' + reg.k + '" href="' + reg.u +
      '" target="_blank" rel="noopener">' + esc(v.t) + '</a></div></article>';
  }

  function ytCard(v) {
    var reg = ytReg(v);
    var read = state.read[reg.k];
    return '<article class="vcard' + (read ? ' read' : '') + '" data-k="' + reg.k + '">' +
      '<a class="vthumb" data-k="' + reg.k + '" href="' + reg.u +
      '" target="_blank" rel="noopener" tabindex="-1">' +
      '<img src="https://i.ytimg.com/vi/' + encodeURIComponent(v.id) +
      '/mqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">' +
      (v.dur ? '<span class="vdur">' + esc(v.dur) + '</span>' : '') + '</a>' +
      '<a class="vtitle" data-k="' + reg.k + '" href="' + reg.u +
      '" target="_blank" rel="noopener">' + esc(v.t) + '</a>' +
      '<div class="vmeta">' + esc(v.ch || '') +
      (v.views ? ' · ' + esc(fmtViews(v.views)) : '') +
      (v.d ? ' · <span class="age" data-ts="' + v.d + '">' + fmtAge(v.d) + '</span>' : '') +
      '</div></article>';
  }

  function ytSection(title, list, extra) {
    if (!list.length) return '';
    return '<div class="vsec"><p class="vsec-head">' + esc(title) +
      (extra || '') + '</p><div class="vgrid">' +
      list.map(ytCard).join('') + '</div></div>';
  }

  function renderYouTube(body) {
    if (!ytFresh()) {
      body.innerHTML = '<p class="empty">The video shelf is loading. Back soon.</p>';
      renderCount(0, 0);
      return;
    }
    var vids = state.youtube.videos.filter(function (v) {
      return v && v.id && v.t && clientQ(v.t);
    });
    var vt = vids.filter(function (v) { return v.vt; });
    var deep = vids.filter(function (v) { return v.dc; });
    var own = vids.filter(function (v) { return !v.trend && !v.vt && !v.dc; });
    var trend = vids.filter(function (v) { return v.trend; });
    var shelves = state.set.ytview === 'shelves';

    var bar = '<div class="ytbar">' +
      '<div class="viewtog"><button class="vt" data-ytview="list" aria-pressed="' + !shelves +
      '">Feed</button><button class="vt" data-ytview="shelves" aria-pressed="' + shelves +
      '">Grid</button></div>' +
      (shelves
        ? '<div class="ytsorts">' +
          ['new', 'hot', 'short'].map(function (mode) {
            var label = mode === 'new' ? 'Newest' : mode === 'hot' ? 'Most viewed/day' : 'Under 5 min';
            return '<button class="pill" data-ytsort="' + mode +
              '" aria-pressed="' + (ytSort === mode) + '">' + label + '</button>';
          }).join('') + '</div>'
        : '') + '</div>';

    var html = bar;
    if (shelves) {
      /* national leads (the production values), local sits between national
         blocks, and anything too thin to stand alone pools at the end —
         a category should never be one lonely video */
      var g = function (key) { return own.filter(function (v) { return (v.g || 'sci') === key; }); };
      var culture = g('food').concat(g('music'), g('fun'));
      var candidates = [
        ['News & documentary', g('news'), 10],
        ['Vermont & local', g('vt'), 10],
        ['Science & explainers', g('sci'), 10],
        ['Filmed in Vermont this week', vt, 8],
        ['Food, music & fun', culture, 8],
      ];
      var also = [];
      candidates.forEach(function (section) {
        if (section[1].length >= 2) {
          html += ytSection(section[0], ytOrder(section[1]).slice(0, section[2]));
        } else {
          also = also.concat(section[1]);
        }
      });
      if (also.length) {
        html += ytSection('Also this week', ytOrder(also));
      }
      if (deep.length) {
        html += ytSection('Deep cuts — the back catalog', sampleN(deep, 8),
          deep.length > 8 ? ' <button class="pill vshuffle" data-ytshuffle>Shuffle ↻</button>' : '');
      }
      html += ytSection('Trending in the US', ytOrder(trend));
    } else {
      /* the Feed is a subscriptions page: every new upload, newest first */
      var chrono = own.slice().sort(function (a, b) { return (b.d || 0) - (a.d || 0); });
      html += chrono.length
        ? '<p class="empty" style="margin:18px auto 0">Every new upload from the channels the Pulse follows · newest first</p>' +
          '<div class="feed">' + chrono.map(ytRow).join('') + '</div>' +
          '<p class="empty" style="margin:22px auto 0">Vermont finds, deep cuts and trending live in the Grid view ↑</p>'
        : '';
    }
    body.innerHTML = (vt.length + own.length + deep.length + trend.length)
      ? html : '<p class="empty">No videos right now.</p>';
    renderCount(shelves ? vt.length + own.length + deep.length + trend.length : own.length, 0);
  }

  function loadYouTube() {
    if (isLocalDev() && location.protocol === 'file:') return;
    fetchJSON(YT_URL, 8000).then(function (json) {
      if (json && Array.isArray(json.videos)) {
        state.youtube = json;
        if (state.data) render();
      }
    }).catch(function () {});
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

  /* published deep-dive pages ship with the site itself — the index is a
     plain relative fetch, and no file simply means no tab yet */
  function loadDives() {
    if (location.protocol === 'file:') return;
    fetchJSON('data/topic-pages.json', 8000).then(function (json) {
      if (json && Array.isArray(json.pages) && json.pages.length) {
        state.dives = json.pages;
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
    learnedGestures();
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
    var addedEntry = !state.digs.some(function (o) { return o.k === k; });
    if (addedEntry) {
      state.digs.unshift({ k: k, t: item.t, u: item.u, s: item.s || '',
                           d: item.d || Math.round(Date.now() / 1000),
                           dv: Math.round(Date.now() / 1000) });
      saveDigs();
      renderTabs();
    }
    learnedGestures();
    outboxAdd('dig', item);
    var send = setTimeout(flushReacts, 5200);
    toastUndo('Voted — enough votes builds a deep-dive page', function () {
      clearTimeout(send);
      outboxRemove('dig', item.u);
      if (addedEntry) {
        state.digs = state.digs.filter(function (o) { return o.k !== k; });
        saveDigs();
        if (state.topic === 'digs' && !state.digs.length) { setTopic('all'); }
        else renderTabs();
      }
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
        learnedGestures();
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
      if (ev.target.closest && ev.target.closest('#pulse-body [data-k]')) ev.preventDefault();
    });

    /* Android's long-press link menu would beat the 550ms mute hold */
    document.addEventListener('contextmenu', function (ev) {
      if (G.el && ev.target.closest && ev.target.closest('#pulse-body [data-k]')) {
        ev.preventDefault();
      }
    });

    document.addEventListener('pointerdown', function (ev) {
      if (!ev.isPrimary || ev.button) return;
      var row = ev.target.closest && ev.target.closest('#pulse-body .fi[data-k], #pulse-body li[data-k], #pulse-body .vcard[data-k]');
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
    var seen = state.set.intent;
    try { seen = seen || !!localStorage.getItem(SEEN_KEY); } catch (e) {}
    /* the pulsing come-hither arrows retire once Focus Mode has been used */
    $('focus-wrap').classList.toggle('seen', seen);
  }

  function toggleIntent() {
    if (!state.set.intent) {
      confirmBox({
        title: 'Focus Mode',
        body: 'Clear as you read: while this is on, headlines you scroll past won’t ' +
          'reappear in your feed — every visit picks up where you stopped. Turning it ' +
          'off brings everything back. Make sure you’re sure.',
        yes: 'Turn on',
        onYes: function () {
          state.set.intent = true;
          try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
          saveSettings(); applyIntentUI(); render();
          toast('Focus Mode on — headlines clear as you read');
        },
      });
    } else {
      state.set.intent = false;
      saveSettings(); applyIntentUI(); render();
      toast('Focus Mode off — everything’s back');
    }
  }

  /* ---------- gesture how-to (one-time) ---------- */

  function learnedGestures() {
    try { localStorage.setItem(HINT_KEY, 'done'); } catch (e) {}
  }

  function snoozeHints() {
    try { localStorage.setItem(HINT_KEY, JSON.stringify({ d: etDay() })); } catch (e) {}
  }

  /* used a gesture → never again; only dismissed → gentle reminder in 10 days */
  function hintDue() {
    try {
      var v = localStorage.getItem(HINT_KEY);
      if (!v) return true;
      if (v === 'done') return false;
      var d = (JSON.parse(v) || {}).d;
      if (!d) return true;
      return Date.now() - Date.parse(d) > 10 * 86400000;
    } catch (e) { return true; }
  }

  function hintHTML() {
    if (!hintDue()) return '';
    return '<div class="hintcard">' +
      '<b>New:</b> swipe a headline <b>right</b> to save it for later · swipe <b>left</b> to ' +
      'vote for a deep-dive page on that topic · <b>press and hold</b> to mute the source.' +
      '<span class="hint-desk"> On a computer, hover a headline for the buttons.</span>' +
      '<button class="nudge-x" data-hint-dismiss aria-label="Got it">✕</button></div>';
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
        '<a href="https://btownbrief.com?utm_source=guide&utm_medium=referral&utm_campaign=pulse-nudge" target="_blank" rel="noopener">Burlington in your inbox, a few mornings a week — free →</a>';
    return '<div class="nudge">' + inner +
      '<button class="nudge-x" data-nudge-dismiss aria-label="Dismiss for today">✕</button></div>';
  }

  /* ---------- the rail: Burlington right now ---------- */

  var railBits = { wx: [], events: null };

  function renderRail() {
    var bits = railBits.wx.map(esc);
    if (railBits.events) {
      bits.push('<a href="/events.html">' + esc(railBits.events) + ' →</a>');
    }
    if (bits.length < 2) return;
    $('rail').innerHTML = bits.join(' · ') +
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
    /* the fun stuff: a tiny per-day digest the events pipeline derives —
       never the full 1.7MB events corpus */
    fetchJSON('data/events/rail.json', 8000).then(function (ev) {
      if (!ev || !Array.isArray(ev.days)) return;
      var today = etDay();
      var now = Date.now();
      var pick = null;
      for (var i = 0; i < ev.days.length && !pick; i++) {
        var d0 = ev.days[i];
        if (!d0 || !d0.date || !d0.t || d0.date < today) continue;
        /* today's last event already started a while ago → look to tomorrow */
        if (d0.date === today && d0.last && Date.parse(d0.last) < now - 60 * 60000) continue;
        pick = d0;
      }
      if (!pick) return;
      var when;
      if (pick.date === today) {
        when = (pick.s && +pick.s.slice(11, 13) >= 16) ? 'Tonight' : 'Today';
      } else {
        when = new Date(pick.date + 'T12:00:00-04:00').toLocaleDateString('en-US',
          { weekday: 'short', timeZone: 'America/New_York' });
      }
      var first = pick.t.length > 32 ? pick.t.slice(0, 31) + '…' : pick.t;
      railBits.events = when + ': ' + first +
        (pick.n > 1 ? ' +' + (pick.n - 1) + ' more' : '');
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
    var entering = view === 'sources' && state.view !== 'sources';
    state.view = view;
    state.source = null;
    state.shown = FEED_PAGE;
    /* client tabs only exist in feed form — fall back to the full grid */
    if (view === 'sources' && isClientTab(state.topic)) state.topic = 'all';
    if (entering) gridSeed = {};   /* fresh shuffle per visit, not per tap */
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
    /* fresh payload = a fresh visit: focus marks made before now take effect.
       A refresh that returns the same generation changes nothing. */
    if (json.generated !== lastGenerated) {
      lastGenerated = json.generated;
      intentCutoff = Math.round(Date.now() / 1000);
    }
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
        '[data-act],[data-unsave],[data-nudge-dismiss],[data-hint-dismiss],[data-ytview],[data-ytsort],[data-ytshuffle],a[data-k]');
      if (!el) return;
      if (el.dataset.topic) { setTopic(el.dataset.topic); return; }
      if (el.hasAttribute('data-ytview')) {
        state.set.ytview = el.getAttribute('data-ytview');
        saveSettings(); renderBody();
        return;
      }
      if (el.hasAttribute('data-ytsort')) {
        ytSort = el.getAttribute('data-ytsort');
        renderBody();
        return;
      }
      if (el.hasAttribute('data-ytshuffle')) {
        renderBody();
        return;
      }
      if (el.dataset.act) {
        if (el.dataset.act === 'save') commitSave(el.dataset.k);
        else commitDig(el.dataset.k);
        return;
      }
      if (el.dataset.unsave) { unsave(el.dataset.unsave); return; }
      if (el.hasAttribute('data-hint-dismiss')) {
        snoozeHints();
        var card = el.closest('.hintcard');
        if (card) card.remove();
        return;
      }
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
    $('refresh-btn').onclick = function () {
      var btn = $('refresh-btn');
      btn.classList.add('spin');
      setTimeout(function () { btn.classList.remove('spin'); }, 1200);
      window.scrollTo({ top: 0 });
      loadData();
      loadTop();
      loadYouTube();
      loadPopular();
      pollMeta();
    };
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
  bindScrollRows();
  bindSrcRowHiding();
  loadData();
  pollMeta();
  loadTop();
  loadYouTube();
  loadPopular();
  loadDives();
  loadRail();
  flushReacts();
  pingDaily();
})();
