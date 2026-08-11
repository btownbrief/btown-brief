/* The Pulse Live — a lean-back rotating board over the same wire as pulse.js.
   Engine study: brutalist.mov. Each visible cell runs its own refresh clock
   (different cadences + staggered starts so the board never flips all at
   once), a progress bar rides the same clock, and hovering a cell freezes
   both — the deadline shifts forward by however long you hovered.
   Pulse-specific moves: Reddit / newsletters / podcasts / YouTube ride as
   first-class topics; BRIEF carries his own paper (newsletter posts, the
   curated archive, tonight's events); PLAY drops the occasional arcade
   card; LOCAL owns teal and gets a guaranteed beat in the lead cell; picks
   are recency-weighted with rarity seasoning so deep content surfaces
   without flooding; holding a topic chip solos it; SURF visits one topic
   for a minute every few minutes; ?tv=1 strips the chrome for a spare
   screen. All state is localStorage-local. */
(function () {
  'use strict';

  var LIVE_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-data/data/pulse.json';
  var LOCAL_URL = 'data/pulse.json';
  var YT_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-youtube/data/pulse-youtube.json';
  var RAIL_URL = 'data/events/rail.json';
  var WEEK_URL = 'data/events-week.json';
  var GAMES_URL = 'https://play.btownbrief.com/games.json';
  var ARCHIVE_URL = 'https://play.btownbrief.com/archive/data/stories-lite.json';
  var READ_URL = 'data/weather/read.json';
  var OPENINGS_URL = 'data/openings.json';
  var BEACHES_URL = 'data/weather/beaches.json';
  var HOBBIES_URL = 'data/hobbies.json';
  var THINGS_URL = 'data/things.json';
  var SET_KEY = 'pulse-live-set';
  var PULSE_SET_KEY = 'pulse2-settings';   // read-only: reuse muted sources

  var TOPICS = ['local', 'brief', 'todo', 'reddit', 'newsletters', 'news', 'video',
                'tech', 'business', 'science', 'culture', 'politics', 'sports', 'gaming',
                'pods', 'play'];
  var TOPIC_LABEL = { newsletters: 'letters', todo: 'to do' };

  /* How often a topic surfaces relative to its share of the pool.
     Deep or evergreen content should visit, not move in. Old editions are
     the rarest guest — headlines and events carry the BRIEF chip. */
  var RARITY = { newsletters: 0.45, pods: 0.5, video: 0.5, play: 0.3,
                 archive: 0.45, edition: 0.15, hobby: 0.35, idea: 0.3 };
  var ARCHIVE_SAMPLE = 80;    // per-visit sample of the 1,600-story archive

  var MAX_VIDEO_AGE_S = 7 * 24 * 3600;
  var WINDOWS = ['1h', '6h', 'today', '48h'];   // reader-set reach of the board
  var MIN_POOL = 24;               // below this, the age cap relaxes
  var API_REFRESH_MS = 5 * 60 * 1000;
  var SURF_PERIOD_MS = 4 * 60 * 1000;
  var SURF_LEN_MS = 60 * 1000;

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

  /* Btown Brief brand cells. Teal belongs to LOCAL alone. */
  var LEAD_COLORS = ['bg-orange', 'bg-orange', 'bg-cream', 'bg-cream', 'bg-brown'];
  var RAIL_COLORS = ['bg-orange', 'bg-orange', 'bg-brown', 'bg-brown', 'bg-cream',
                     'bg-cream', 'bg-black', 'bg-black-cream'];
  var LOCAL_COLORS = ['bg-teal', 'bg-teal', 'bg-cream', 'bg-orange', 'bg-black-cream'];
  var ALL_COLORS = ['bg-orange', 'bg-cream', 'bg-brown', 'bg-teal', 'bg-black', 'bg-black-cream'];

  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TV = /(?:^|[?&])tv=1/.test(window.location.search);

  /* last-visit baseline, shared with the Pulse page: a 30+ minute gap
     starts a new visit; the first lap of the board favors what's new */
  var visitBaseline = 0;
  (function () {
    try {
      var nowS = Math.floor(Date.now() / 1000);
      var last = +localStorage.getItem('pulse2-visit-last') || 0;
      if (last && nowS - last > 30 * 60) {
        localStorage.setItem('pulse2-visit-base', String(last));
      }
      visitBaseline = +localStorage.getItem('pulse2-visit-base') || 0;
      localStorage.setItem('pulse2-visit-last', String(nowS));
    } catch (e) {}
  })();

  var state = {
    pool: [],                // every eligible item across topics
    extras: null,            // [rail, week, games, archive] cached from first load
    generated: 0,            // epoch sec of the payload build
    used: {},                // url -> true, recently shown
    usedCount: 0,
    perSlot: {},             // slot id -> current item
    enabled: null,           // Set of topic keys
    solo: null,              // topic key while soloed
    prevTopics: null,        // enabled set saved when a solo began
    surfTopic: null,         // topic a channel-surf is visiting
    armed: null,             // slot id armed by a first touch-tap
    leadsSinceLocal: 0,      // local-heartbeat counter for the lead cell
    frozen: false,           // global freeze — every cell holds its story
    firstLap: 0,             // picks made so far; the first lap favors
                             // stories newer than the last visit
    set: { pace: 'normal', cells: 'auto', surf: false, window: '48h', heldOnce: false },
    hiddenSources: {},       // from the main Pulse page's settings
    hiddenChannels: {},      // muted YouTube channels, same settings key
    timers: {},              // slot id -> cadence / kickoff timeout
    swapTimers: {},          // slot id -> pending 320ms exit-animation timeout
    endsAt: {},
    pausedBy: {},            // slot id -> {hover, vis, tap}
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
    var d = Math.round(h / 24);
    if (d < 30) return d + 'D';
    if (d < 365) return Math.round(d / 30.4) + 'MO';
    return Math.round(d / 365) + 'Y';
  }

  function topicLabel(t) { return (TOPIC_LABEL[t] || t).toUpperCase(); }

  function isLocalItem(it) { return !!it.tags && it.tags.indexOf('local') !== -1; }

  function inEnabled(it) {
    if (!it.tags) return false;
    for (var i = 0; i < it.tags.length; i++)
      if (state.enabled.has(it.tags[i])) return true;
    return false;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- settings ---------- */

  function loadStored() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (PACES.indexOf(s.pace) !== -1) state.set.pace = s.pace;
        if (['auto', '2', '3', '4'].indexOf(String(s.cells)) !== -1) state.set.cells = String(s.cells);
        if (WINDOWS.indexOf(s.window) !== -1) state.set.window = s.window;
        state.set.surf = !!s.surf;
        state.set.heldOnce = !!s.heldOnce;
        if (Array.isArray(s.topics)) {
          state.enabled = new Set(s.topics.filter(function (t) { return TOPICS.indexOf(t) !== -1; }));
          // topics added to the board since this reader last saved arrive ON
          var known = Array.isArray(s.known) ? s.known : s.topics;
          TOPICS.forEach(function (t) {
            if (known.indexOf(t) === -1) state.enabled.add(t);
          });
        }
        if (typeof s.solo === 'string' && TOPICS.indexOf(s.solo) !== -1) state.solo = s.solo;
        if (Array.isArray(s.prevTopics)) {
          state.prevTopics = new Set(s.prevTopics.filter(function (t) { return TOPICS.indexOf(t) !== -1; }));
          // the return-from-solo set gets the new arrivals too, or a reader
          // soloed at upgrade time would never see them
          if (Array.isArray(s.topics)) {
            var known2 = Array.isArray(s.known) ? s.known : s.topics;
            TOPICS.forEach(function (t) {
              if (known2.indexOf(t) === -1) state.prevTopics.add(t);
            });
          }
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
    if (TV) state.set.surf = true;   // a spare screen wants motion; not saved back
    try {
      var p = JSON.parse(localStorage.getItem(PULSE_SET_KEY) || 'null');
      if (p && p.hidden && typeof p.hidden === 'object') state.hiddenSources = p.hidden;
      if (p && p.ythidden && typeof p.ythidden === 'object') state.hiddenChannels = p.ythidden;
    } catch (e) {}
  }

  function saveStored() {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify({
        pace: state.set.pace,
        cells: state.set.cells,
        window: state.set.window,
        surf: TV ? false : state.set.surf,
        heldOnce: state.set.heldOnce,
        topics: Array.from(state.enabled),
        known: TOPICS,
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
     in LOCAL and PODS both; r/burlington is LOCAL and REDDIT; his own paper
     is BRIEF and LOCAL. `tags` drive the filter, the first tag is what the
     cell displays. */
  function tagsOf(src) {
    var tags = [];
    if (src.id === 'btown-brief') tags.push('brief');
    if (src.topic === 'local') tags.push('local');
    if (isReddit(src)) tags.push('reddit');
    if (src.pod) tags.push('pods');
    if (src.topic && src.topic !== 'local') tags.push(src.topic);
    if (!tags.length) tags.push('news');
    return tags;
  }

  function normTitle(t) {
    return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function buildPool(data, yt, extras) {
    var pool = [];
    var srcMap = {};
    (data.sources || []).forEach(function (s) { srcMap[s.id] = s; });
    (data.items || []).forEach(function (it) {
      var src = srcMap[it.s];
      if (!src || state.hiddenSources[src.id]) return;
      var t = String(it.t || '').trim();
      if (t.length < 10) return;
      var tags = tagsOf(src);
      // his own paper: the fresh editions read as BRIEF; older ones become
      // EDITION, the rarest guest on the board — headlines over back issues
      var isBrief = tags[0] === 'brief';
      var oldEdition = isBrief && it.d &&
        (Date.now() / 1000 - it.d > 7 * 86400);
      pool.push({
        t: t,
        u: safeUrl(it.u),
        d: it.d || 0,
        src: src.short || src.name || '',
        tags: tags,
        topic: oldEdition ? 'edition' : tags[0],
        // exempt from the age cap so a BRIEF solo always has editions
        evergreen: isBrief,
      });
    });

    if (yt && Array.isArray(yt.videos)) {
      var vseen = {};   // livestream restarts share a title across video ids
      yt.videos.forEach(function (v) {
        var t = String(v.t || '').trim();
        if (!v.id || t.length < 10) return;
        if (state.hiddenChannels[normTitle(v.ch || '')]) return;
        var nt = normTitle(t);
        if (vseen[nt]) return;
        vseen[nt] = true;
        pool.push({
          t: t,
          u: 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id),
          d: v.d || 0,
          src: v.ch || 'YouTube',
          tags: ['video'],
          topic: 'video',
          dur: v.dur || '',
          img: 'https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/hqdefault.jpg',
        });
      });
    }

    var rail = extras && extras[0], week = extras && extras[1];
    var games = extras && extras[2], archive = extras && extras[3];

    if (rail && Array.isArray(rail.days)) {
      var gen = (Date.parse(rail.generated) / 1000) || 0;
      rail.days.forEach(function (day, i) {
        if (!day.n) return;
        var when = i === 0 ? 'today' : i === 1 ? 'tomorrow'
          : new Date(day.date + 'T12:00:00')
              .toLocaleDateString('en-US', { weekday: 'long' });
        pool.push({
          t: day.n + ' things to do in Burlington ' + when + (day.t ? ' — like ' + day.t : ''),
          // unique per card — the pool dedupes by url, shared urls would
          // silently keep only the first card
          u: 'events.html#' + (day.date || when),
          d: gen,
          src: 'Btown events',
          tags: ['todo', 'brief', 'local'],
          topic: 'events',
        });
      });
    }

    if (week && Array.isArray(week.days)) {
      var wd = (Date.parse(week.updated) / 1000) || 0;
      week.days.slice(0, 3).forEach(function (dy) {
        if (!dy.text || !dy.label) return;
        // his prose runs 700-1250 chars; a board card gets the first
        // sentence, trimmed to headline length
        var sentence = String(dy.text).split(/(?<=[.!?])\s/)[0] || '';
        if (sentence.length > 110) {
          sentence = sentence.slice(0, 107).replace(/\s+\S*$/, '') + '…';
        }
        if (sentence.length < 8) return;
        var base = safeUrl(week.issue_url) !== '#' ? week.issue_url : 'events.html';
        pool.push({
          t: dy.label + ': ' + sentence,
          u: base + '#' + encodeURIComponent(dy.label),
          d: wd,
          src: 'Btown Brief picks',
          tags: ['todo', 'brief', 'local'],
          topic: 'events',
        });
      });
    }

    var read = extras && extras[4], openings = extras && extras[5];
    var beaches = extras && extras[6];

    if (read && read.text) {
      // his daily weather prose — first sentence, linking the full read
      var rs = String(read.text).split(/(?<=[.!?])\s/)[0] || '';
      if (rs.length > 110) rs = rs.slice(0, 107).replace(/\s+\S*$/, '') + '…';
      if (rs.length >= 8) {
        pool.push({
          t: 'My weather read: ' + rs,
          u: 'weather.html',
          d: (Date.parse(read.approved_at || read.date) / 1000) || 0,
          src: 'Btown Brief',
          tags: ['brief', 'local'],
          topic: 'weather',
        });
      }
    }

    if (openings && Array.isArray(openings.entries)) {
      openings.entries.slice().sort(function (a, b) {
        return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
      }).slice(0, 2).forEach(function (entry) {
        if (!entry.name) return;
        var verb = entry.status === 'closed' ? 'Closing news: '
          : entry.status === 'opening-soon' ? 'Coming soon: ' : 'Now open: ';
        pool.push({
          t: verb + entry.name + (entry.area ? ' — ' + entry.area : ''),
          u: 'openings.html#' + encodeURIComponent(entry.name),
          d: (Date.parse(entry.date) / 1000) || 0,
          src: 'Openings radar',
          tags: ['brief', 'local'],
          topic: 'openings',
        });
      });
    }

    if (beaches && Array.isArray(beaches.beaches) && beaches.beaches.length) {
      var total = beaches.beaches.length;
      var green = beaches.beaches.filter(function (b) {
        return b.status === 'green';
      }).length;
      pool.push({
        t: green === total
          ? 'All ' + total + ' beaches green for swimming today'
          : green + ' of ' + total + ' beaches green for swimming today',
        u: 'beaches.html',
        d: (Date.parse(beaches.updated) / 1000) || 0,
        src: 'Lake report',
        tags: ['brief', 'local'],
        topic: 'lake',
      });
    }

    /* TO DO beyond events: in-season hobbies, curated spots, and the
       one-answer app — ideas visit the rotation, events lead it */
    var hobbies = extras && extras[7], things = extras && extras[8];
    var month = new Date().getMonth() + 1;

    if (hobbies) {
      var hobbyList = hobbies.hobbies || hobbies.entries || [];
      shuffle(hobbyList.filter(function (h) {
        return h && h.name &&
          (!Array.isArray(h.months) || h.months.indexOf(month) !== -1);
      }).slice()).slice(0, 6).forEach(function (h) {
        var about = String(h.what || '').split(/(?<=[.!?])\s/)[0] || '';
        if (about.length > 100) about = about.slice(0, 97).replace(/\s+\S*$/, '') + '…';
        pool.push({
          t: (h.emoji ? h.emoji + ' ' : '') + h.name + (about ? ' — ' + about : ''),
          u: 'hobbies.html#' + encodeURIComponent(h.id || h.name),
          d: 0,
          src: 'Vermont hobbies',
          tags: ['todo'],
          topic: 'hobby',
          evergreen: true,
        });
      });
    }

    if (Array.isArray(things)) {
      shuffle(things.slice()).slice(0, 8).forEach(function (th) {
        if (!th || !th.name) return;
        var bits = [th.category, th.neighborhood].filter(Boolean).join(', ');
        pool.push({
          t: th.name + (bits ? ' — ' + bits : ''),
          u: 'index.html#' + encodeURIComponent(th.id || th.name),
          d: 0,
          src: 'Things to do',
          tags: ['todo'],
          topic: 'idea',
          evergreen: true,
        });
      });
    }

    pool.push({
      t: "Can't decide? What Now hands you one thing to do right now",
      u: 'https://play.btownbrief.com/what-now/',
      d: 0,
      src: 'What Now',
      tags: ['todo', 'play'],
      topic: 'idea',
      evergreen: true,
    });

    if (games && Array.isArray(games.games)) {
      shuffle(games.games.filter(function (g) {
        return g.live && g.slug && g.name && g.pitch;
      }).slice()).slice(0, 12).forEach(function (g) {
        pool.push({
          t: (g.emoji ? g.emoji + ' ' : '') + g.name + ' — ' + g.pitch,
          u: 'https://play.btownbrief.com/' + encodeURIComponent(g.slug) + '/',
          d: 0,
          src: 'Btown Arcade',
          tags: ['play'],
          topic: 'play',
          evergreen: true,
        });
      });
    }

    if (Array.isArray(archive)) {
      shuffle(archive.slice()).slice(0, ARCHIVE_SAMPLE).forEach(function (st) {
        var t = String(st.h || '').trim();
        if (t.length < 10) return;
        pool.push({
          t: t,
          u: safeUrl(st.u),
          d: (Date.parse(st.d) / 1000) || 0,
          src: 'From the Brief',
          tags: ['brief'],
          topic: 'archive',
          evergreen: true,
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

  function windowCapS() {
    var w = state.set.window;
    if (w === '1h') return 3600;
    if (w === '6h') return 6 * 3600;
    if (w === 'today') {
      var midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      return Math.max(1, Date.now() / 1000 - midnight.getTime() / 1000);
    }
    return 48 * 3600;
  }

  function freshEnough(it, now) {
    if (it.evergreen || !it.d) return true;
    var cap = windowCapS();
    // videos get a wider default reach, but a narrowed window narrows them too
    if (it.topic === 'video' && state.set.window === '48h') cap = MAX_VIDEO_AGE_S;
    return now / 1000 - it.d <= cap;
  }

  function updateWire() {
    var el = $('wire');
    if (!el) return;
    el.textContent = state.pool.length ? state.pool.length.toLocaleString() + ' IN THE WIRE' : '';
  }

  /* ---------- picking ---------- */

  function drawFrom(base) {
    // recency-weighted: base is newest-first, pow() bends picks toward the top
    var idx = Math.floor(Math.pow(Math.random(), 1.6) * base.length);
    return base[Math.min(idx, base.length - 1)];
  }

  function pickItem(cfg) {
    var now = Date.now();
    // a narrowed window shrinks ELIGIBILITY itself — otherwise stale unused
    // items mask the moment the fresh pool runs dry and the used-set never
    // resets, leaving the board on the system card forever
    var narrow = state.set.window !== '48h';
    var eligible = state.pool.filter(function (it) {
      return inEnabled(it) && (!narrow || freshEnough(it, now));
    });
    var base = eligible.filter(function (it) { return !state.used[it.u]; });
    if (!base.length && eligible.length) {
      // a small pool ran dry before the periodic reset — start the lap over
      state.used = {};
      state.usedCount = 0;
      base = eligible.slice();
    }

    // a channel-surf narrows the pool to one topic while it lasts
    if (state.surfTopic) {
      var surfed = base.filter(function (it) {
        return it.tags.indexOf(state.surfTopic) !== -1;
      });
      if (surfed.length) base = surfed;
    }

    // freshness cap, with a relief valve: top up with the NEWEST stale items
    // only as far as MIN_POOL, so the recency weighting stays meaningful
    if (!narrow) {
      var fresh = base.filter(function (it) { return freshEnough(it, now); });
      if (fresh.length >= MIN_POOL || fresh.length === base.length) {
        base = fresh.length ? fresh : base;
      } else {
        var stale = base.filter(function (it) { return !freshEnough(it, now); });
        base = fresh.concat(stale.slice(0, MIN_POOL - fresh.length));
      }
    }

    // the first lap after arriving favors what's new since the last visit
    if (visitBaseline && state.firstLap < 8) {
      var unseen = base.filter(function (it) {
        return !it.evergreen && it.d > visitBaseline;
      });
      if (unseen.length >= 3) base = unseen;
    }

    // the lead cell reads best with headlines that aren't paragraph-length
    var maxLen = cfg.type === 'lead' ? 120 : 160;
    var sized = base.filter(function (it) { return it.t.length <= maxLen; });
    if (sized.length) base = sized;

    // local heartbeat: every third lead swap comes home if local is on
    if (cfg.type === 'lead' && !state.surfTopic &&
        state.enabled.has('local') && state.leadsSinceLocal >= 2) {
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

    var item = drawFrom(base);

    /* seasoning: rare topics step back sometimes, a cell avoids showing the
       same topic twice in a row, and one outlet shouldn't hold two cells at
       once or follow itself — no channel gets to flood the board. Rarity
       applies even inside a solo — a BRIEF solo should lead with the fresh
       editions and let the archive visit — but the repeat-nudges only
       matter in a mixed pool. */
    if (!state.surfTopic && base.length > 6) {
      var onScreen = {};
      activeSlots().forEach(function (other) {
        if (other.id === cfg.id) return;
        var showing = state.perSlot[other.id];
        if (showing && !showing.system) onScreen[showing.src] = true;
      });
      for (var tries = 0; tries < 2; tries++) {
        var rar = RARITY[item.topic];
        var prev = state.perSlot[cfg.id];
        var mixed = state.enabled.size > 1;
        var repeatTopic = prev && !prev.system && prev.topic === item.topic;
        var repeatSrc = prev && !prev.system && prev.src === item.src;
        if ((rar != null && Math.random() > rar) ||
            (onScreen[item.src] && Math.random() < 0.8) ||
            (repeatSrc && Math.random() < 0.8) ||
            (repeatTopic && mixed && Math.random() < 0.5)) {
          item = drawFrom(base);
        } else break;
      }
    }

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

    /* line-height .9 packs tighter than the font's metrics, so descenders
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
     teal-leaning pool so local reads unmistakably local. */
  function chooseColor(cfg, cell, item) {
    // video cells wear their thumbnail over near-black — cream text always
    if (item && item.img) return 'bg-black-cream';
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
     A slot can be paused for independent reasons — pointer hover, hidden
     tab, or an armed touch-tap. The clock stops when the first reason
     appears and restarts only when the last one clears. */

  function cadenceOf(cfg) { return Math.round(cfg.cadence * (PACE[state.set.pace] || 1)); }

  function cellOf(cfg) { return document.querySelector('[data-slot="' + cfg.id + '"]'); }

  function isPaused(id) {
    var p = state.pausedBy[id];
    if (!p) return false;
    for (var k in p) if (p[k]) return true;
    return false;
  }

  function scheduleNext(cfg, delay) {
    clearTimeout(state.timers[cfg.id]);
    state.endsAt[cfg.id] = performance.now() + delay;
    state.timers[cfg.id] = setTimeout(function () {
      if (isPaused(cfg.id)) return;   // resumeSlot reschedules on unpause
      refreshSlot(cfg);
    }, delay);
  }

  /* a deliberate hold (tap-arm or freeze) shows the ▶ release button;
     a passing hover doesn't */
  function paintHeld(cfg) {
    var cell = cellOf(cfg);
    if (!cell) return;
    var p = state.pausedBy[cfg.id] || {};
    cell.classList.toggle('held', !!(p.tap || p.freeze));
  }

  function pauseSlot(cfg, reason) {
    var p = state.pausedBy[cfg.id] || (state.pausedBy[cfg.id] = {});
    if (p[reason]) return;
    var already = isPaused(cfg.id);
    p[reason] = true;
    paintHeld(cfg);
    if (already) return;             // clock is stopped for another reason
    state.pausedAt[cfg.id] = performance.now();
    clearTimeout(state.timers[cfg.id]);
    var cell = cellOf(cfg);
    if (cell) pauseProgressBar(cell);
  }

  function resumeSlot(cfg, reason) {
    var p = state.pausedBy[cfg.id];
    if (!p || !p[reason]) return;
    p[reason] = false;
    paintHeld(cfg);
    if (isPaused(cfg.id)) return;    // still held by another reason
    var pausedFor = performance.now() - (state.pausedAt[cfg.id] || 0);
    state.endsAt[cfg.id] = (state.endsAt[cfg.id] || performance.now()) + pausedFor;
    var remaining = Math.max(0, state.endsAt[cfg.id] - performance.now());
    var cell = cellOf(cfg);
    if (cell) resumeProgressBar(cell, remaining);
    clearTimeout(state.timers[cfg.id]);
    state.timers[cfg.id] = setTimeout(function () { refreshSlot(cfg); }, remaining);
  }

  /* global freeze: hold every cell where it is; the per-cell ▶ releases one */
  function setFrozen(on) {
    state.frozen = on;
    activeSlots().forEach(function (cfg) {
      if (on) pauseSlot(cfg, 'freeze');
      else resumeSlot(cfg, 'freeze');
    });
    var btn = $('freeze-btn');
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    if (!item.system) state.firstLap++;
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
      topicTag.textContent = (item.img ? '▶ ' : '') + topicLabel(item.topic);
      ageTag.textContent = item.d ? fmtAge(item.d) : '';

      var bgLayer = cell.querySelector('.cellbg');
      if (bgLayer) {
        bgLayer.style.backgroundImage = item.img ? 'url("' + item.img + '")' : '';
      }
      cell.classList.toggle('video-cell', !!item.img);

      var dot = '<span class="dot"></span>';
      var parts = ['<span>' + esc(item.src) + '</span>', '<span>' + esc(topicLabel(item.topic)) + '</span>'];
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
      btn.textContent = topicLabel(topic);
      var on = state.enabled.has(topic);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (state.solo === topic) btn.classList.add('solo');
      if (state.surfTopic === topic) btn.classList.add('surfing');
      wrap.appendChild(btn);
    });
    $('hint').hidden = state.set.heldOnce || TV;
    updateChipsMore();
  }

  function afterTopicChange() {
    endSurf();
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

  /* ---------- channel surf: a minute of one topic, every few minutes ---------- */

  var surfEndTimer = null;

  function surfNote(topic) {
    var el = $('surf-note');
    if (!el) return;
    if (topic) {
      el.textContent = 'CHANNEL SURF — A MINUTE OF ' + topicLabel(topic);
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  function pickSurfTopic() {
    var counts = {};
    state.pool.forEach(function (it) {
      if (!inEnabled(it)) return;
      it.tags.forEach(function (tag) {
        if (state.enabled.has(tag)) counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    var cands = Object.keys(counts).filter(function (t) { return counts[t] >= 6; });
    if (cands.length < 2) return null;
    // the surf comes home more often than chance
    if (counts.local >= 6 && Math.random() < 0.35) return 'local';
    return cands[Math.floor(Math.random() * cands.length)];
  }

  function startSurf() {
    if (!state.set.surf || state.solo || state.surfTopic ||
        state.frozen || document.hidden) return;
    var t = pickSurfTopic();
    if (!t) return;
    state.surfTopic = t;
    surfNote(t);
    renderChips();
    activeSlots().forEach(function (cfg, i) {
      setTimeout(function () {
        if (state.surfTopic === t && !isPaused(cfg.id)) refreshSlot(cfg);
      }, i * 400);
    });
    clearTimeout(surfEndTimer);
    surfEndTimer = setTimeout(endSurf, SURF_LEN_MS);
  }

  function endSurf() {
    clearTimeout(surfEndTimer);
    if (!state.surfTopic) return;
    state.surfTopic = null;
    surfNote(null);
    renderChips();
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
        if (state.armed === cfg.id) disarm();   // before the pause state resets
        state.pausedBy[cfg.id] = {};       // a hidden cell can't be hovered
        delete state.needsKick[cfg.id];
      } else if (i >= prevCount && state.pool.length) {
        if (document.visibilityState === 'visible') {
          refreshSlot(cfg);
          if (state.frozen) pauseSlot(cfg, 'freeze');
        } else {
          state.needsKick[cfg.id] = true;   // wake it when the tab returns
        }
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

  /* ---------- touch: first tap arms + pauses, second tap opens ---------- */

  var armTimer = null;

  function disarm() {
    clearTimeout(armTimer);
    if (!state.armed) return;
    var cfg = null;
    SLOTS.forEach(function (c) { if (c.id === state.armed) cfg = c; });
    var cell = cfg && cellOf(cfg);
    if (cell) cell.classList.remove('armed');
    state.armed = null;
    if (cfg) resumeSlot(cfg, 'tap');
  }

  function bindTouchArm() {
    if (!window.matchMedia('(hover: none)').matches) return;
    SLOTS.forEach(function (cfg) {
      var cell = cellOf(cfg);
      if (!cell) return;
      cell.addEventListener('click', function (e) {
        if (state.armed === cfg.id) {
          // second tap: let the link open, hand the cell back to the clock
          disarm();
          return;
        }
        e.preventDefault();
        disarm();
        state.armed = cfg.id;
        cell.classList.add('armed');
        pauseSlot(cfg, 'tap');
        clearTimeout(armTimer);
        armTimer = setTimeout(disarm, 10000);
      });
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
    Array.prototype.forEach.call(document.querySelectorAll('#surf-group .lopt'), function (b) {
      b.setAttribute('aria-pressed',
        (b.dataset.surf === 'on') === !!state.set.surf ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#window-group .lopt'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.window === state.set.window ? 'true' : 'false');
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
    $('surf-group').addEventListener('click', function (e) {
      var b = e.target.closest('.lopt');
      if (!b) return;
      state.set.surf = b.dataset.surf === 'on';
      if (!state.set.surf) endSurf();
      saveStored();
      paintOptions();
    });
    $('window-group').addEventListener('click', function (e) {
      var b = e.target.closest('.lopt');
      if (!b) return;
      state.set.window = b.dataset.window;
      saveStored();
      paintOptions();
      // stories now outside the window leave immediately
      state.used = {};
      state.usedCount = 0;
      var now = Date.now();
      activeSlots().forEach(function (cfg) {
        var cur = state.perSlot[cfg.id];
        if (cur && (cur.system || !freshEnough(cur, now)) && !isPaused(cfg.id)) {
          refreshSlot(cfg);
        }
      });
    });
    $('freeze-btn').addEventListener('click', function () {
      setFrozen(!state.frozen);
    });
    // per-cell release: let one cell rotate again without opening its story
    SLOTS.forEach(function (cfg) {
      var cell = cellOf(cfg);
      var go = cell && cell.querySelector('.cellgo');
      if (!go) return;
      go.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (state.armed === cfg.id) disarm();
        resumeSlot(cfg, 'freeze');
      });
    });
  }

  /* ---------- the chips row scrolls — show an arrow while it can ---------- */

  function updateChipsMore() {
    var wrap = $('chipwrap');
    var row = $('chips');
    if (!wrap || !row) return;
    wrap.classList.toggle('more',
      row.scrollLeft + row.clientWidth < row.scrollWidth - 8);
  }

  function bindChipsMore() {
    var row = $('chips');
    var btn = $('chips-more');
    if (!row || !btn) return;
    row.addEventListener('scroll', updateChipsMore, { passive: true });
    window.addEventListener('resize', updateChipsMore);
    btn.addEventListener('click', function () {
      row.scrollBy({ left: Math.round(row.clientWidth * 0.7), behavior: 'smooth' });
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

  /* ---------- TV mode: nothing but the board on a spare screen ---------- */

  function setupTv() {
    if (!TV) return;
    document.body.classList.add('tv');
    var idleTimer = null;
    function wake() {
      document.body.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        document.body.classList.add('idle');
      }, 3000);
    }
    document.addEventListener('mousemove', wake);
    wake();
  }

  /* ---------- start ---------- */

  function start() {
    loadStored();
    setupTv();
    renderChips();
    bindChips();
    bindChipsMore();
    updateChipsMore();
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
            if (state.frozen) pauseSlot(cfg, 'freeze');
          } else {
            resumeSlot(cfg, 'vis');
          }
        });
      } else {
        endSurf();
        activeSlots().forEach(function (cfg) { pauseSlot(cfg, 'vis'); });
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') window.location.href = 'pulse.html';
    });

    // hover pause — real pointers only; touch gets tap-to-arm instead
    if (window.matchMedia('(hover: hover)').matches) {
      SLOTS.forEach(function (cfg) {
        var cell = cellOf(cfg);
        if (!cell) return;
        cell.addEventListener('mouseenter', function () { pauseSlot(cfg, 'hover'); });
        cell.addEventListener('mouseleave', function () { resumeSlot(cfg, 'hover'); });
      });
    }
    bindTouchArm();

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(computeLayout, 240);
    });

    function applyData(data, yt) {
      state.pool = buildPool(data, yt, state.extras);
      state.generated = data.generated ? Date.parse(data.generated) / 1000 : 0;
      updateWire();
      tickUpdated();
    }

    var ytPromise = fetchJson(YT_URL).catch(function () { return null; });
    var extrasPromise = Promise.all([
      fetchJson(RAIL_URL).catch(function () { return null; }),
      fetchJson(WEEK_URL).catch(function () { return null; }),
      fetchJson(GAMES_URL).catch(function () { return null; }),
      fetchJson(ARCHIVE_URL).catch(function () { return null; }),
      fetchJson(READ_URL).catch(function () { return null; }),
      fetchJson(OPENINGS_URL).catch(function () { return null; }),
      fetchJson(BEACHES_URL).catch(function () { return null; }),
      fetchJson(HOBBIES_URL).catch(function () { return null; }),
      fetchJson(THINGS_URL).catch(function () { return null; }),
    ]);

    fetchJson(LIVE_URL)
      .catch(function () { return fetchJson(LOCAL_URL); })
      .then(function (data) {
        return Promise.all([ytPromise, extrasPromise]).then(function (res) {
          state.extras = res[1];
          applyData(data, res[0]);
        });
      })
      .catch(function () {
        $('board').querySelector('.head').textContent = 'NO SIGNAL — CHECK YOUR CONNECTION';
      })
      .then(function () {
        // the display face changes autoFit's math — wait for it before sizing
        return (document.fonts && document.fonts.ready) || null;
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
        setInterval(startSurf, SURF_PERIOD_MS);
      });

    // quiet re-fetch; the board just starts drawing from the fresher pool.
    // rail/week/read/beaches ride along so a kiosk that crosses midnight
    // stays right; games/archive stay cached — they barely change
    setInterval(function () {
      Promise.all([
        fetchJson(LIVE_URL).catch(function () { return null; }),
        fetchJson(YT_URL).catch(function () { return null; }),
        fetchJson(RAIL_URL).catch(function () { return null; }),
        fetchJson(WEEK_URL).catch(function () { return null; }),
        fetchJson(READ_URL).catch(function () { return null; }),
        fetchJson(BEACHES_URL).catch(function () { return null; }),
      ]).then(function (res) {
        if (!res[0]) return;
        if (state.extras) {
          if (res[2]) state.extras[0] = res[2];
          if (res[3]) state.extras[1] = res[3];
          if (res[4]) state.extras[4] = res[4];
          if (res[5]) state.extras[6] = res[5];
        }
        applyData(res[0], res[1]);
      });
      try {
        localStorage.setItem('pulse2-visit-last',
          String(Math.floor(Date.now() / 1000)));
      } catch (e) {}
    }, API_REFRESH_MS);
  }

  start();
})();
