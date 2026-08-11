/* The Pulse Live — a lean-back rotating board over the same wire as pulse.js.
   Engine study: brutalist.mov. Each visible cell runs its own refresh clock
   (different cadences + staggered starts so the board never flips all at
   once), a progress bar rides the same clock, and hovering a cell freezes
   both — the deadline shifts forward by however long you hovered.
   On top of that, Pulse-specific moves: Reddit / newsletters / podcasts /
   YouTube ride as first-class topics, LOCAL owns green cells and gets a
   guaranteed beat in the lead cell, picks are weighted toward fresh items,
   and holding a topic chip solos it. All state is localStorage-local. */
(function () {
  'use strict';

  var LIVE_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-data/data/pulse.json';
  var LOCAL_URL = 'data/pulse.json';
  var YT_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-youtube/data/pulse-youtube.json';
  var SET_KEY = 'pulse-live-set';
  var PULSE_SET_KEY = 'pulse2-settings';   // read-only: reuse muted sources

  var TOPICS = ['local', 'reddit', 'news', 'newsletters', 'tech', 'business',
                'science', 'culture', 'politics', 'sports', 'gaming', 'pods', 'video'];
  var TOPIC_LABEL = { newsletters: 'letters', pods: 'pods', video: 'video' };

  var MAX_AGE_S = 48 * 3600;       // headlines older than this stay off the board
  var MAX_VIDEO_AGE_S = 7 * 24 * 3600;
  var MIN_POOL = 24;               // below this, the age cap relaxes
  var API_REFRESH_MS = 5 * 60 * 1000;

  /* Cadence (ms) per slot — brutalist.mov's calibration: ~300ms per word plus
     settle time; the lead holds longest because it's the focal cell. Offsets
     stagger the first fire so cells never flip together. */
  var SLOTS = [
    { id: 'lead', cadence: 16000, offset: 300, type: 'lead' },
    { id: 'r1', cadence: 11500, offset: 2400, type: 'rail' },
    { id: 'r2', cadence: 13500, offset: 4800, type: 'rail' },
    { id: 'r3', cadence: 10000, offset: 7200, type: 'rail' },
  ];
  var PACE = { slow: 1.45, normal: 1, fast: 0.72 };
  var PACES = ['slow', 'normal', 'fast'];

  var LEAD_COLORS = ['bg-yellow', 'bg-yellow', 'bg-red', 'bg-cream', 'bg-cream'];
  var RAIL_COLORS = ['bg-yellow', 'bg-yellow', 'bg-red', 'bg-red', 'bg-cream',
                     'bg-cream', 'bg-black', 'bg-black'];
  var LOCAL_COLORS = ['bg-green', 'bg-green', 'bg-yellow', 'bg-cream', 'bg-black'];
  var ALL_COLORS = ['bg-yellow', 'bg-red', 'bg-cream', 'bg-black', 'bg-green'];

  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    pool: [],                // every eligible item across topics
    generated: 0,            // epoch sec of the payload build
    used: {},                // url -> true, recently shown
    usedCount: 0,
    perSlot: {},             // slot id -> current item
    enabled: null,           // Set of topic keys
    solo: null,              // topic key while soloed
    prevTopics: null,        // enabled set saved when a solo began
    leadsSinceLocal: 0,      // local-heartbeat counter for the lead cell
    set: { pace: 'normal', cells: 'auto', heldOnce: false },
    hiddenSources: {},       // from the main Pulse page's settings
    timers: {},              // slot id -> cadence / kickoff timeout
    swapTimers: {},          // slot id -> pending 320ms exit-animation timeout
    endsAt: {},
    pausedBy: {},            // slot id -> {hover:bool, vis:bool}
    pausedAt: {},
    needsKick: {},           // slots activated while the tab was hidden
    activeCount: 3,
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeUrl(u) {
    return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : '#';
  }

  function fmtAge(ts) {
    var s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 90) return 'NOW';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'M';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'H';
    return Math.round(h / 24) + 'D';
  }

  function topicLabel(t) { return (TOPIC_LABEL[t] || t).toUpperCase(); }

  function isLocalItem(it) { return !!it.tags && it.tags.indexOf('local') !== -1; }

  function inEnabled(it) {
    if (!it.tags) return false;
    for (var i = 0; i < it.tags.length; i++)
      if (state.enabled.has(it.tags[i])) return true;
    return false;
  }

  /* ---------- settings ---------- */

  function loadStored() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (PACES.indexOf(s.pace) !== -1) state.set.pace = s.pace;
        if (['auto', '2', '3', '4'].indexOf(String(s.cells)) !== -1) state.set.cells = String(s.cells);
        state.set.heldOnce = !!s.heldOnce;
        if (Array.isArray(s.topics)) {
          state.enabled = new Set(s.topics.filter(function (t) { return TOPICS.indexOf(t) !== -1; }));
        }
        if (typeof s.solo === 'string' && TOPICS.indexOf(s.solo) !== -1) state.solo = s.solo;
        if (Array.isArray(s.prevTopics)) {
          state.prevTopics = new Set(s.prevTopics.filter(function (t) { return TOPICS.indexOf(t) !== -1; }));
        }
      }
    } catch (e) {}
    if (!state.enabled) state.enabled = new Set(TOPICS);
    // solo invariant: soloed means exactly that one topic runs, with a set to return to
    if (state.solo) {
      if (!state.prevTopics) { state.solo = null; }
      else { state.enabled = new Set([state.solo]); }
    } else {
      state.prevTopics = null;
    }
    try {
      var p = JSON.parse(localStorage.getItem(PULSE_SET_KEY) || 'null');
      if (p && p.hidden && typeof p.hidden === 'object') state.hiddenSources = p.hidden;
    } catch (e) {}
  }

  function saveStored() {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify({
        pace: state.set.pace,
        cells: state.set.cells,
        heldOnce: state.set.heldOnce,
        topics: Array.from(state.enabled),
        solo: state.solo,
        prevTopics: state.prevTopics ? Array.from(state.prevTopics) : null,
      }));
    } catch (e) {}
  }

  /* ---------- clock ---------- */

  var DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function tickClock() {
    var d = new Date();
    $('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    $('day').textContent = DAYS[d.getDay()];
    $('date').textContent = MONTHS[d.getMonth()] + ' ' + pad(d.getDate()) + ' · ' + d.getFullYear();
  }

  function tickUpdated() {
    var el = $('updated');
    if (!el || !state.generated) return;
    el.textContent = 'UPDATED ' + fmtAge(state.generated) + ' AGO';
  }

  /* ---------- data ---------- */

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  function isReddit(src) { return (src.site || '').indexOf('reddit.com') !== -1; }

  /* Topics overlap, exactly like the main Pulse tabs: a local podcast lives
     in LOCAL and PODS both; r/burlington is LOCAL and REDDIT. `tags` drive
     the filter, the first tag is what the cell displays — local wins. */
  function tagsOf(src) {
    var tags = [];
    if (src.topic === 'local') tags.push('local');
    if (isReddit(src)) tags.push('reddit');
    if (src.pod) tags.push('pods');
    if (src.topic && src.topic !== 'local') tags.push(src.topic);
    if (!tags.length) tags.push('news');
    return tags;
  }

  function buildPool(data, yt) {
    var pool = [];
    var srcMap = {};
    (data.sources || []).forEach(function (s) { srcMap[s.id] = s; });
    (data.items || []).forEach(function (it) {
      var src = srcMap[it.s];
      if (!src || state.hiddenSources[src.id]) return;
      var t = String(it.t || '').trim();
      if (t.length < 10) return;
      var tags = tagsOf(src);
      pool.push({
        t: t,
        u: safeUrl(it.u),
        d: it.d || 0,
        src: src.short || src.name || '',
        tags: tags,
        topic: tags[0],
      });
    });
    if (yt && Array.isArray(yt.videos)) {
      yt.videos.forEach(function (v) {
        var t = String(v.t || '').trim();
        if (!v.id || t.length < 10) return;
        pool.push({
          t: t,
          u: 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id),
          d: v.d || 0,
          src: v.ch || 'YouTube',
          tags: ['video'],
          topic: 'video',
          dur: v.dur || '',
        });
      });
    }
    // newest first — the recency-weighted pick below leans on this order
    pool.sort(function (a, b) { return b.d - a.d; });
    // dedupe by url
    var seen = {};
    return pool.filter(function (it) {
      if (it.u === '#' || seen[it.u]) return false;
      seen[it.u] = true;
      return true;
    });
  }

  function freshEnough(it, now) {
    if (!it.d) return true;
    var cap = it.topic === 'video' ? MAX_VIDEO_AGE_S : MAX_AGE_S;
    return now / 1000 - it.d <= cap;
  }

  function updateWire() {
    var el = $('wire');
    if (!el) return;
    el.textContent = state.pool.length ? state.pool.length.toLocaleString() + ' IN THE WIRE' : '';
  }

  /* ---------- picking ---------- */

  function pickItem(cfg) {
    var now = Date.now();
    var eligible = state.pool.filter(inEnabled);
    var base = eligible.filter(function (it) { return !state.used[it.u]; });
    if (!base.length && eligible.length) {
      // a small pool ran dry before the periodic reset — start the lap over
      state.used = {};
      state.usedCount = 0;
      base = eligible.slice();
    }

    // freshness cap, with a relief valve: top up with the NEWEST stale items
    // only as far as MIN_POOL, so the recency weighting stays meaningful
    var fresh = base.filter(function (it) { return freshEnough(it, now); });
    if (fresh.length >= MIN_POOL || fresh.length === base.length) {
      base = fresh.length ? fresh : base;
    } else {
      var stale = base.filter(function (it) { return !freshEnough(it, now); });
      base = fresh.concat(stale.slice(0, MIN_POOL - fresh.length));
    }

    // the lead cell reads best with headlines that aren't paragraph-length
    var maxLen = cfg.type === 'lead' ? 120 : 160;
    var sized = base.filter(function (it) { return it.t.length <= maxLen; });
    if (sized.length) base = sized;

    // local heartbeat: every third lead swap comes home if local is on
    if (cfg.type === 'lead' && state.enabled.has('local') && state.leadsSinceLocal >= 2) {
      var locals = base.filter(isLocalItem);
      if (locals.length) base = locals;
    }

    if (!base.length) {
      return {
        t: state.enabled.size === 0
          ? 'Pick a topic above to start the wire.'
          : 'No fresh stories in those topics. Tap a few more back on.',
        u: '#', src: 'system', tags: [], topic: 'system', d: 0, system: true,
      };
    }

    // recency-weighted: pool is newest-first, pow() bends picks toward the top
    var idx = Math.floor(Math.pow(Math.random(), 1.6) * base.length);
    var item = base[Math.min(idx, base.length - 1)];
    state.used[item.u] = true;
    state.usedCount++;
    if (state.usedCount > Math.max(8, Math.floor(eligible.length * 0.7))) {
      state.used = {};
      state.used[item.u] = true;
      state.usedCount = 1;
    }
    return item;
  }

  /* ---------- type fitting (binary search, from brutalist.mov) ---------- */

  function autoFit(head, body) {
    head.style.fontSize = '';
    head.style.display = '';
    head.style.webkitBoxOrient = '';
    head.style.webkitLineClamp = '';
    head.style.overflow = '';
    head.style.overflowWrap = 'normal';

    var availW = body.clientWidth;
    var availH = body.clientHeight;
    if (availW <= 0 || availH <= 0) return;

    /* line-height .92 packs tighter than the font's metrics, so descenders
       can paint past scrollHeight — the margin scales with the chosen size */
    function safetyFor(size) { return Math.max(8, Math.ceil(size * 0.12)); }

    function fits(size) {
      head.style.fontSize = size + 'px';
      return head.scrollWidth <= availW &&
             head.scrollHeight + safetyFor(size) <= availH;
    }

    function findLargest() {
      var lo = 8, hi = 320;
      if (fits(hi)) return hi;
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      head.style.fontSize = lo + 'px';
      return lo;
    }

    var chosen = findLargest();

    // a single glued token wider than the cell: allow mid-word breaks, retry
    if (head.scrollWidth > availW) {
      head.style.overflowWrap = 'anywhere';
      chosen = findLargest();
    }

    // last resort: clamp to whole lines with ellipsis
    var guard = safetyFor(chosen);
    if (head.scrollHeight + guard > availH) {
      var lh = parseFloat(getComputedStyle(head).lineHeight) || chosen;
      var maxLines = Math.max(1, Math.floor((availH - guard) / lh));
      head.style.display = '-webkit-box';
      head.style.webkitBoxOrient = 'vertical';
      head.style.webkitLineClamp = String(maxLines);
      head.style.overflow = 'hidden';
    }
  }

  /* ---------- cell colors ---------- */

  function currentColorClass(cell) {
    for (var i = 0; i < ALL_COLORS.length; i++)
      if (cell.classList.contains(ALL_COLORS[i])) return ALL_COLORS[i];
    return null;
  }

  /* Prefer a color no other visible cell is wearing, then at most one other,
     then anything but this cell's current color. LOCAL items pick from a
     green-leaning pool so local reads unmistakably local. */
  function chooseColor(cfg, cell, item) {
    var pool = item && isLocalItem(item) ? LOCAL_COLORS
             : cfg.type === 'lead' ? LEAD_COLORS : RAIL_COLORS;
    var current = currentColorClass(cell);
    var others = Array.prototype.filter.call(document.querySelectorAll('.cell'), function (c) {
      return c !== cell && c.offsetParent !== null;
    }).map(currentColorClass).filter(Boolean);

    var strict = pool.filter(function (c) { return c !== current && others.indexOf(c) === -1; });
    if (strict.length) return strict[Math.floor(Math.random() * strict.length)];

    var medium = pool.filter(function (c) {
      return c !== current && others.filter(function (o) { return o === c; }).length < 2;
    });
    if (medium.length) return medium[Math.floor(Math.random() * medium.length)];

    var loose = pool.filter(function (c) { return c !== current; });
    return loose[Math.floor(Math.random() * loose.length)] || pool[0];
  }

  /* ---------- progress bar ---------- */

  function startProgressBar(cell, durationMs) {
    var bar = cell.querySelector('.pbar');
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    void bar.offsetWidth;
    bar.style.transition = 'width ' + durationMs + 'ms linear';
    bar.style.width = '100%';
  }

  /* freeze as a percentage, not pixels — an orientation flip while paused
     resizes the cell, and a percentage keeps the bar visually honest */
  function pauseProgressBar(cell) {
    var bar = cell.querySelector('.pbar');
    if (!bar) return;
    var track = bar.parentElement.getBoundingClientRect().width;
    var px = bar.getBoundingClientRect().width;
    bar.style.transition = 'none';
    bar.style.width = track > 0 ? (Math.min(100, px / track * 100)) + '%' : '0%';
  }

  function resumeProgressBar(cell, remainingMs) {
    var bar = cell.querySelector('.pbar');
    if (!bar) return;
    void bar.offsetWidth;
    bar.style.transition = 'width ' + remainingMs + 'ms linear';
    bar.style.width = '100%';
  }

  /* ---------- scheduling (pause shifts the deadline, never loses time) ----------
     A slot can be paused for two independent reasons — the pointer is on it,
     or the tab is hidden. The clock stops when the first reason appears and
     restarts only when the last one clears. */

  function cadenceOf(cfg) { return Math.round(cfg.cadence * (PACE[state.set.pace] || 1)); }

  function cellOf(cfg) { return document.querySelector('[data-slot="' + cfg.id + '"]'); }

  function isPaused(id) {
    var p = state.pausedBy[id];
    return !!(p && (p.hover || p.vis));
  }

  function scheduleNext(cfg, delay) {
    clearTimeout(state.timers[cfg.id]);
    state.endsAt[cfg.id] = performance.now() + delay;
    state.timers[cfg.id] = setTimeout(function () {
      if (isPaused(cfg.id)) return;   // resumeSlot reschedules on unpause
      refreshSlot(cfg);
    }, delay);
  }

  function pauseSlot(cfg, reason) {
    var p = state.pausedBy[cfg.id] || (state.pausedBy[cfg.id] = {});
    if (p[reason]) return;
    var already = isPaused(cfg.id);
    p[reason] = true;
    if (already) return;             // clock is stopped for the other reason
    state.pausedAt[cfg.id] = performance.now();
    clearTimeout(state.timers[cfg.id]);
    var cell = cellOf(cfg);
    if (cell) pauseProgressBar(cell);
  }

  function resumeSlot(cfg, reason) {
    var p = state.pausedBy[cfg.id];
    if (!p || !p[reason]) return;
    p[reason] = false;
    if (isPaused(cfg.id)) return;    // still held by the other reason
    var pausedFor = performance.now() - (state.pausedAt[cfg.id] || 0);
    state.endsAt[cfg.id] = (state.endsAt[cfg.id] || performance.now()) + pausedFor;
    var remaining = Math.max(0, state.endsAt[cfg.id] - performance.now());
    var cell = cellOf(cfg);
    if (cell) resumeProgressBar(cell, remaining);
    clearTimeout(state.timers[cfg.id]);
    state.timers[cfg.id] = setTimeout(function () { refreshSlot(cfg); }, remaining);
  }

  /* ---------- the swap ---------- */

  function refreshSlot(cfg) {
    clearTimeout(state.timers[cfg.id]);
    clearTimeout(state.swapTimers[cfg.id]);   // supersede a mid-flight swap
    var cell = cellOf(cfg);
    if (!cell || cell.offsetParent === null) return;
    var head = cell.querySelector('.head');
    var body = cell.querySelector('.body');
    var top = cell.querySelector('.top');
    var meta = cell.querySelector('.meta');
    var topicTag = cell.querySelector('.topic-tag');
    var ageTag = cell.querySelector('.age-tag');

    var item = pickItem(cfg);
    state.perSlot[cfg.id] = item;
    if (cfg.type === 'lead' && !item.system) {
      state.leadsSinceLocal = isLocalItem(item) ? 0 : state.leadsSinceLocal + 1;
    }

    cell.setAttribute('href', item.u || '#');

    var isFirst = !head.dataset.loaded;

    function swap() {
      var cur = currentColorClass(cell);
      var next = chooseColor(cfg, cell, item);
      if (cur) cell.classList.remove(cur);
      cell.classList.add(next);

      head.style.transition = 'none';
      head.style.opacity = '0';
      if (!REDUCED_MOTION) head.style.transform = 'translateY(30px)';
      meta.style.transition = 'none';
      meta.style.opacity = '0';
      top.style.transition = 'none';
      top.style.opacity = '0';

      /* auxiliary rows first — autoFit measures the leftover 1fr track,
         so the other grid rows must settle before we measure */
      topicTag.textContent = topicLabel(item.topic);
      ageTag.textContent = item.d ? fmtAge(item.d) : '';

      var dot = '<span class="dot"></span>';
      var parts = ['<span>' + esc(item.src) + '</span>', '<span>' + topicLabel(item.topic) + '</span>'];
      if (item.dur) parts.push('<span>' + esc(item.dur) + '</span>');
      parts.push('<span>' + (item.d ? fmtAge(item.d) : '—') + '</span>');
      meta.innerHTML = '<span class="ptrack"></span><span class="pbar"></span>' + parts.join(dot);

      head.textContent = item.t.toUpperCase();
      autoFit(head, body);
      head.dataset.loaded = '1';

      var cadence = cadenceOf(cfg);
      startProgressBar(cell, cadence);
      scheduleNext(cfg, cadence);

      /* if a pause landed during the 320ms exit animation, honor it now:
         stop the clock we just armed and hold the bar at zero */
      if (isPaused(cfg.id)) {
        clearTimeout(state.timers[cfg.id]);
        state.pausedAt[cfg.id] = performance.now();
        pauseProgressBar(cell);
      }

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          head.style.transition = 'opacity .55s cubic-bezier(.2,.85,.3,1), transform .6s cubic-bezier(.2,.85,.3,1)';
          head.style.opacity = '1';
          head.style.transform = 'translateY(0)';
          meta.style.transition = 'opacity .55s ease-out';
          meta.style.opacity = '1';
          top.style.transition = 'opacity .5s ease-out';
          top.style.opacity = '1';
        });
      });
    }

    if (isFirst) { swap(); return; }

    head.style.transition = 'opacity .3s ease-out, transform .3s cubic-bezier(.55,0,.85,0)';
    head.style.opacity = '0';
    if (!REDUCED_MOTION) head.style.transform = 'translateY(-22px)';
    meta.style.transition = 'opacity .3s ease-out';
    meta.style.opacity = '0';
    top.style.transition = 'opacity .3s ease-out';
    top.style.opacity = '0';
    state.swapTimers[cfg.id] = setTimeout(swap, 320);
  }

  function activeSlots() { return SLOTS.slice(0, state.activeCount); }

  /* ---------- topic chips: tap toggles, hold solos ---------- */

  function renderChips() {
    var wrap = $('chips');
    wrap.innerHTML = '';
    TOPICS.forEach(function (topic) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.topic = topic;
      btn.style.setProperty('--tc', 'var(--c-' + topic + ')');
      btn.textContent = topicLabel(topic);
      var on = state.enabled.has(topic);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (state.solo === topic) btn.classList.add('solo');
      wrap.appendChild(btn);
    });
    $('hint').hidden = state.set.heldOnce;
  }

  function afterTopicChange() {
    state.used = {};
    state.usedCount = 0;
    saveStored();
    renderChips();
    // force-refresh any visible cell whose story just got filtered out
    activeSlots().forEach(function (cfg) {
      var cur = state.perSlot[cfg.id];
      if (cur && (cur.system || !inEnabled(cur))) refreshSlot(cfg);
    });
  }

  function toggleTopic(topic) {
    // tapping while soloed grows the set outward from the solo
    state.solo = null;
    state.prevTopics = null;
    if (state.enabled.has(topic)) state.enabled.delete(topic);
    else state.enabled.add(topic);
    afterTopicChange();
  }

  function soloTopic(topic) {
    if (state.solo === topic) {
      // hold the soloed chip again → back to the set you had before
      state.enabled = state.prevTopics || new Set(TOPICS);
      state.solo = null;
      state.prevTopics = null;
    } else {
      if (!state.solo) state.prevTopics = new Set(state.enabled);
      state.solo = topic;
      state.enabled = new Set([topic]);
    }
    if (!state.set.heldOnce) { state.set.heldOnce = true; }
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
    afterTopicChange();
  }

  function bindChips() {
    var wrap = $('chips');
    var holdTimer = null;
    var heldTopic = null;
    var pressed = false;
    var moved = false;
    var startX = 0, startY = 0;
    var justHeld = false;

    wrap.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    wrap.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      heldTopic = btn.dataset.topic;
      pressed = true;
      moved = false;
      startX = e.clientX; startY = e.clientY;
      justHeld = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () {
        justHeld = true;
        soloTopic(heldTopic);
      }, 450);
    });

    wrap.addEventListener('pointermove', function (e) {
      // a drag is a scroll, not a hold — and not a tap either
      if (!pressed) return;
      if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
        moved = true;
        clearTimeout(holdTimer);
      }
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      wrap.addEventListener(ev, function () {
        pressed = false;
        clearTimeout(holdTimer);
      });
    });

    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      if (justHeld || moved) { justHeld = false; moved = false; return; }
      toggleTopic(btn.dataset.topic);
    });
  }

  /* ---------- layout: orientation + cell count ---------- */

  function computeLayout() {
    var landscape = window.innerWidth > window.innerHeight;
    var count;
    if (state.set.cells === 'auto') {
      if (landscape) count = window.innerWidth >= 1000 ? 4 : 2;
      else count = 3;
    } else {
      count = parseInt(state.set.cells, 10);
    }
    var board = $('board');
    var prevCount = state.activeCount;
    board.dataset.o = landscape ? 'l' : 'p';
    board.dataset.n = String(count);
    state.activeCount = count;

    // slots that just appeared need content + a clock; hidden ones go quiet
    SLOTS.forEach(function (cfg, i) {
      if (i >= count) {
        clearTimeout(state.timers[cfg.id]);
        clearTimeout(state.swapTimers[cfg.id]);
        state.pausedBy[cfg.id] = {};       // a hidden cell can't be hovered
        delete state.needsKick[cfg.id];
      } else if (i >= prevCount && state.pool.length) {
        if (document.visibilityState === 'visible') refreshSlot(cfg);
        else state.needsKick[cfg.id] = true;   // wake it when the tab returns
      }
    });
    refitAll();
  }

  function refitAll() {
    activeSlots().forEach(function (cfg) {
      var cell = cellOf(cfg);
      if (!cell || cell.offsetParent === null) return;
      var item = state.perSlot[cfg.id];
      if (!item) return;
      var head = cell.querySelector('.head');
      head.textContent = item.t.toUpperCase();
      autoFit(head, cell.querySelector('.body'));
    });
  }

  /* ---------- bottom bar ---------- */

  function paintOptions() {
    Array.prototype.forEach.call(document.querySelectorAll('#pace-group .lopt'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.pace === state.set.pace ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#cells-group .lopt'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.cells === state.set.cells ? 'true' : 'false');
    });
  }

  function bindOptions() {
    $('pace-group').addEventListener('click', function (e) {
      var b = e.target.closest('.lopt');
      if (!b) return;
      state.set.pace = b.dataset.pace;
      saveStored();
      paintOptions();   // takes effect as each cell schedules its next swap
    });
    $('cells-group').addEventListener('click', function (e) {
      var b = e.target.closest('.lopt');
      if (!b) return;
      state.set.cells = b.dataset.cells;
      saveStored();
      paintOptions();
      computeLayout();
    });
  }

  /* ---------- wake lock: the point is to put the phone down ---------- */

  var wakeLock = null;

  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (wl) {
      wakeLock = wl;
    }).catch(function () {});
  }

  /* ---------- start ---------- */

  function start() {
    loadStored();
    renderChips();
    bindChips();
    paintOptions();
    bindOptions();
    tickClock();
    setInterval(tickClock, 1000);
    setInterval(tickUpdated, 30000);
    requestWakeLock();

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        activeSlots().forEach(function (cfg) {
          if (state.needsKick[cfg.id]) {
            delete state.needsKick[cfg.id];
            refreshSlot(cfg);
          } else {
            resumeSlot(cfg, 'vis');
          }
        });
      } else {
        activeSlots().forEach(function (cfg) { pauseSlot(cfg, 'vis'); });
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') window.location.href = 'pulse.html';
    });

    // hover pause — real pointers only; touch taps must stay taps
    if (window.matchMedia('(hover: hover)').matches) {
      SLOTS.forEach(function (cfg) {
        var cell = cellOf(cfg);
        if (!cell) return;
        cell.addEventListener('mouseenter', function () { pauseSlot(cfg, 'hover'); });
        cell.addEventListener('mouseleave', function () { resumeSlot(cfg, 'hover'); });
      });
    }

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(computeLayout, 240);
    });

    function applyData(data, yt) {
      state.pool = buildPool(data, yt);
      state.generated = data.generated ? Date.parse(data.generated) / 1000 : 0;
      updateWire();
      tickUpdated();
    }

    var ytPromise = fetchJson(YT_URL).catch(function () { return null; });

    fetchJson(LIVE_URL)
      .catch(function () { return fetchJson(LOCAL_URL); })
      .then(function (data) { return ytPromise.then(function (yt) { applyData(data, yt); }); })
      .catch(function () {
        $('board').querySelector('.head').textContent = 'NO SIGNAL — CHECK YOUR CONNECTION';
      })
      .then(function () {
        if (!state.pool.length) return;
        computeLayout();
        activeSlots().forEach(function (cfg) {
          // kickoff timers live in state.timers so a layout change can cancel
          // them; clear first — computeLayout may have already armed a clock
          clearTimeout(state.timers[cfg.id]);
          state.timers[cfg.id] = setTimeout(function () { refreshSlot(cfg); }, cfg.offset);
        });
      });

    // quiet re-fetch; the board just starts drawing from the fresher pool
    setInterval(function () {
      Promise.all([
        fetchJson(LIVE_URL).catch(function () { return null; }),
        fetchJson(YT_URL).catch(function () { return null; }),
      ]).then(function (res) {
        if (res[0]) applyData(res[0], res[1]);
      });
    }, API_REFRESH_MS);
  }

  start();
})();
