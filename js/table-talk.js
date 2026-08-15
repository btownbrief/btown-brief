/* Table Talk — a meetup companion board. One huge card at a time: icebreaker
   questions, whole-table prompts, friendly local fights, this-weekend events,
   in-season hobbies, discussion-worthy headlines, a little weather. Built to
   be propped on a coffee table and glanced at, so cards hold for minutes, not
   seconds (Pulse Live is the fast sibling).

   SYNC mode is the trick: several phones show the SAME card at the SAME time
   with no server. The card is a pure function of the wall clock — time is
   cut into fixed 150s slots, a per-day seed (America/New_York date) shuffles
   every deck, and slot k walks the same weighted sequence on every device.
   Headlines only join sync once they're an hour old, so two devices whose
   data snapshots differ by a few minutes still agree. All other state is
   localStorage-local. */
(function () {
  'use strict';

  var NEWS_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/pulse-data/data/pulse.json';
  var NEWS_LOCAL_URL = 'data/pulse.json';
  var STAY_URL = 'https://play.btownbrief.com/stay-awhile/data/questions.json';
  var DECK_URL = 'data/table-talk.json';
  var RAIL_URL = 'data/events/rail.json';
  var WEEK_URL = 'data/events-week.json';
  var READ_URL = 'data/weather/read.json';
  var HOBBIES_URL = 'data/hobbies.json';
  var HISTORY_URL = 'data/history-facts.json';
  var SET_KEY = 'table-talk-set';

  var REFRESH_MS = 10 * 60 * 1000;         // quiet re-fetch of the live-ish feeds
  var SYNC_SLOT_S = 150;                   // one card per 2m30s, every device
  var PACE_S = { relaxed: 300, normal: 180, lively: 75 };
  var PACES = ['relaxed', 'normal', 'lively'];
  /* quick cards burn faster than conversation cards */
  var KIND_FACTOR = { pick: 0.55, news: 0.8, event: 0.8, weather: 0.7 };

  /* categories: key -> chip label, pick weight, card tag, palette */
  var CATS = [
    { key: 'talk',   label: 'TALK',       w: 0.30 },
    { key: 'room',   label: 'THE ROOM',   w: 0.10 },
    { key: 'fight',  label: 'FIGHTS',     w: 0.10 },
    { key: 'pick',   label: 'PICK ONE',   w: 0.10 },
    { key: 'event',  label: 'WEEKEND',    w: 0.14 },
    { key: 'news',   label: 'HEADLINES',  w: 0.12 },
    { key: 'hobby',  label: 'HOBBIES',    w: 0.07 },
    { key: 'btown',  label: 'BTOWN',      w: 0.07 },
  ];

  var KIND_TAG = {
    ice: 'ICEBREAKER', room: 'THE ROOM', fight: 'FRIENDLY FIGHT',
    pick: 'PICK ONE', event: 'THIS WEEK', news: 'TALK ABOUT IT',
    hobby: 'HOBBY IDEA', history: 'BTOWN 101', weather: 'WEATHER',
  };
  var KIND_KICKER = {
    room: 'EVERYONE PLAYS', pick: 'QUICK ONE — AROUND THE TABLE',
    fight: 'SETTLE IT AS A TABLE',
  };
  var KIND_COLORS = {
    ice: ['bg-orange', 'bg-cream', 'bg-brown', 'bg-black-cream'],
    room: ['bg-teal'],
    fight: ['bg-orange', 'bg-brown'],
    pick: ['bg-black', 'bg-cream'],
    event: ['bg-cream', 'bg-teal'],
    news: ['bg-black-cream', 'bg-brown'],
    hobby: ['bg-brown', 'bg-cream'],
    history: ['bg-black-cream'],
    weather: ['bg-cream'],
  };
  var NEWS_KICKERS = ['WHAT DOES THE TABLE THINK?', 'ANYONE FOLLOWING THIS?',
                      'GOOD NEWS OR BAD NEWS?', 'WHO HAS A TAKE?'];
  /* the wire carries everything; a coffee table shouldn't. Violence, tragedy
     and hot-button national politics don't become icebreakers because a
     kicker asks nicely — screen them out up front. Crude but effective;
     local civic news (city council, housing, the bike path) sails through. */
  var TABLE_UNSAFE = new RegExp(
    '\\b(dead|death|die[sd]?|dying|kill(?:ed|ing|s)?|murder|shooting|shot|' +
    'stabb\\w*|assault|rape|suicide|overdose|fatal\\w*|crash|wildfire|' +
    'war|missile|airstrike|bomb\\w*|hostage|troops|gaza|israel|ukraine|' +
    'russia|trump|white house|congress|senate|supreme court|abortion|' +
    'immigration|deport\\w*|shutdown|tariff\\w*|epstein|indict\\w*|arrest\\w*)\\b',
    'i');

  var TV = /(?:^|[?&])tv=1/.test(window.location.search);
  var WANT_SYNC = /(?:^|[?&])sync=1/.test(window.location.search);

  var state = {
    decks: {},              // cat key -> [card, ...] deterministic order
    queues: {},             // solo mode: cat key -> {perm:[], ptr:0}
    enabled: {},            // cat key -> bool
    pace: 'normal',
    sync: false,
    held: false,
    holdTimer: 0,           // auto-release so a table can't strand the board
    history: [],            // solo: cards shown, for BACK
    histAt: -1,
    timer: 0,               // solo flip timeout
    shownAt: 0,             // when the current card landed (solo fuse math)
    current: null,
    syncSlot: -1,           // last rendered sync slot
    raw: {},                // fetched payloads, kept for deterministic rebuilds
    wakeLock: null,
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  /* ---------- deterministic randomness ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* the shared day seed: same for every phone at the same table */
  function daySeed() {
    var d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
      .format(new Date());                       // "2026-08-15"
    return hashStr('table-talk-' + d);
  }

  function seededShuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- deck building ----------
     Every builder must be deterministic given the same payloads: cards are
     pushed in payload order, never sampled with Math.random — sync depends
     on two phones building byte-identical decks. */

  function firstSentence(text, max) {
    var s = String(text || '').split(/(?<=[.!?])\s/)[0] || '';
    if (s.length > max) s = s.slice(0, max - 3).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  function fmt12(dt) {
    var h = dt.getHours(), m = dt.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + ap;
  }

  function buildDecks() {
    var raw = state.raw;
    var decks = { talk: [], room: [], fight: [], pick: [], event: [],
                  news: [], hobby: [], btown: [] };

    /* the house deck */
    var own = (raw.deck && raw.deck.prompts) || [];
    own.forEach(function (p) {
      if (!p || !p.q || !p.id) return;
      var cat = p.kind === 'room' ? 'room' : p.kind === 'fight' ? 'fight'
        : p.kind === 'either' ? 'pick' : 'talk';
      decks[cat].push({
        id: 'tt:' + p.id, kind: cat === 'talk' ? 'ice' : cat,
        text: p.q, src: 'BTOWN BRIEF TABLE DECK',
      });
    });

    /* Stay Awhile visits — the lighter half of the deck. A first coffee is
       not the place for the love/confess shelves or deep water, and its
       room-flagged cards assume the table already knows each other
       ("your first memory of each person here") — strangers get the house
       room deck instead. */
    var stay = (raw.stay && raw.stay.questions) || [];
    stay.forEach(function (q) {
      if (!q || !q.q || !q.id || q.deck) return;
      if (q.d !== 'light' && q.d !== 'warm') return;
      var t = q.t || [], f = q.f || [];
      if (t.indexOf('love') !== -1 || t.indexOf('confess') !== -1) return;
      if (f.indexOf('room') !== -1 || f.indexOf('heavy') !== -1) return;
      decks.talk.push({
        id: 'sa:' + q.id, kind: 'ice', text: q.q, src: 'STAY AWHILE',
      });
    });

    /* events: counts for the next few days, named picks for today+tomorrow,
       and his week-blurb sentences */
    var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    var todayMs = dayStart.getTime();
    var dayDiff = function (dateStr) {
      if (!dateStr) return null;
      var d = Date.parse(dateStr + 'T12:00:00');
      if (isNaN(d)) return null;
      return Math.round((d - (todayMs + 12 * 3600 * 1000)) / 86400000);
    };
    var rail = raw.rail;
    if (rail && Array.isArray(rail.days)) {
      rail.days.forEach(function (day) {
        var diff = dayDiff(day.date);
        if (diff === null || diff < 0 || diff > 3 || !day.n) return;
        var when = diff === 0 ? 'today' : diff === 1 ? 'tomorrow'
          : new Date(day.date + 'T12:00:00')
              .toLocaleDateString('en-US', { weekday: 'long' });
        decks.event.push({
          id: 'evn:' + day.date, kind: 'event',
          text: day.n + ' things to do in Burlington ' + when,
          kicker: day.t ? ('LIKE: ' + day.t).toUpperCase() : '',
          src: 'BTOWN EVENTS',
        });
      });
      rail.days.forEach(function (day) {
        var diff = dayDiff(day.date);
        if ((diff !== 0 && diff !== 1) || !Array.isArray(day.picks)) return;
        day.picks.forEach(function (p, j) {
          if (!p || !p.t) return;
          var start = p.s ? new Date(p.s) : null;
          if (start && isNaN(start)) start = null;
          // date-only starts are all-day events; Date would misread them as
          // UTC midnight and put "tonight" on the wrong evening
          if (start && String(p.s).indexOf('T') === -1) start = null;
          if (diff === 0 && start && Date.now() - start.getTime() > 2 * 3600 * 1000) return;
          var when = diff === 1 ? 'Tomorrow'
            : (start && start.getHours() >= 17) ? 'Tonight' : 'Today';
          decks.event.push({
            id: 'evp:' + (day.date || '') + ':' + j, kind: 'event',
            text: p.t + (p.v && p.v.toLowerCase() !== p.t.toLowerCase()
              ? ' — ' + p.v : ''),
            kicker: (when + (start ? ' · ' + fmt12(start) : '')).toUpperCase(),
            src: 'BTOWN EVENTS',
          });
        });
      });
    }
    var week = raw.week;
    if (week && Array.isArray(week.days)) {
      week.days.forEach(function (dy) {
        if (!dy.text || !dy.label) return;
        // the issue's blurbs cover the whole weekend — drop days already gone
        if (dy.date) {
          var wdiff = dayDiff(dy.date);
          if (wdiff !== null && wdiff < 0) return;
        }
        var s = firstSentence(dy.text, 140);
        if (s.length < 8) return;
        decks.event.push({
          id: 'evw:' + (dy.date || dy.label), kind: 'event', text: s,
          kicker: String(dy.label).toUpperCase(), src: 'BTOWN BRIEF PICKS',
        });
      });
    }

    /* headlines as conversation: local first, then the interesting national
       shelves. Sorted newest-first for solo; sync applies its own age gate. */
    var news = raw.news;
    if (news && Array.isArray(news.items)) {
      var topicOf = {};
      (news.sources || []).forEach(function (s) {
        if (s && s.id) topicOf[s.id] = s;
      });
      var wanted = { local: 26, news: 8, tech: 6, science: 6, culture: 6 };
      var taken = { local: 0, news: 0, tech: 0, science: 0, culture: 0 };
      var seenUrl = {};
      var items = news.items.slice().sort(function (a, b) { return (b.d || 0) - (a.d || 0); });
      items.forEach(function (it) {
        if (!it || !it.t || !it.u || seenUrl[it.u]) return;
        if (TABLE_UNSAFE.test(it.t)) return;
        var src = topicOf[it.s];
        var topic = src && src.topic;
        if (!(topic in wanted) || taken[topic] >= wanted[topic]) return;
        seenUrl[it.u] = true;
        taken[topic]++;
        // a wire headline can run 25 words; a table card shouldn't
        var title = String(it.t);
        if (title.length > 110) {
          title = title.slice(0, 107).replace(/\s+\S*$/, '') + '…';
        }
        decks.news.push({
          id: 'nw:' + it.u, kind: 'news', text: title, d: it.d || 0,
          kicker: NEWS_KICKERS[hashStr(it.u) % NEWS_KICKERS.length],
          src: ((src && src.short) || 'THE PULSE').toUpperCase(),
          local: topic === 'local',
        });
      });
    }

    /* in-season hobbies, pitched as a question the table can pick up */
    var month = new Date().getMonth() + 1;
    var hobbies = (raw.hobbies && (raw.hobbies.hobbies || raw.hobbies.entries)) || [];
    hobbies.forEach(function (h) {
      if (!h || !h.name) return;
      if (Array.isArray(h.months) && h.months.indexOf(month) === -1) return;
      decks.hobby.push({
        id: 'hb:' + (h.id || h.name), kind: 'hobby',
        text: (h.emoji ? h.emoji + ' ' : '') + h.name + ' — anyone at this table into it?',
        kicker: firstSentence(h.what, 90).toUpperCase(),
        src: 'VERMONT HOBBIES',
      });
    });

    /* Btown 101: history facts + the weather read */
    var hist = raw.history;
    if (hist && Array.isArray(hist.facts)) {
      hist.facts.forEach(function (f) {
        var t = String((f && f.t) || '').trim();
        if (t.length < 20) return;
        // content-keyed id: editing the file mid-day can't shift every
        // fact's identity under a synced table
        decks.btown.push({
          id: 'hf:' + hashStr(t), kind: 'history', text: t,
          kicker: 'DID EVERYONE KNOW THIS?', src: (f.src || 'BTOWN HISTORY').toUpperCase(),
        });
      });
    }
    var read = raw.read;
    if (read && read.text) {
      var rs = firstSentence(read.text, 150);
      if (rs.length >= 8) {
        decks.btown.push({
          id: 'wx:read', kind: 'weather', text: rs,
          kicker: 'THE WEATHER READ', src: 'BTOWN BRIEF WEATHER',
        });
      }
    }
    if (read && Array.isArray(read.week)) {
      var todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
        .format(new Date());
      read.week.forEach(function (w) {
        if (!w || !w.blurb || !w.date) return;
        var diff = dayDiff(w.date);
        if (diff === null || diff < 0 || diff > 2) return;
        var when = diff === 0 ? 'TODAY' : diff === 1 ? 'TOMORROW'
          : new Date(w.date + 'T12:00:00')
              .toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
        decks.btown.push({
          id: 'wx:' + w.date, kind: 'weather', text: w.blurb,
          kicker: when, src: 'BTOWN BRIEF WEATHER',
        });
      });
    }

    state.decks = decks;
    state.queues = {};           // solo queues rebuild lazily from new decks
  }

  /* ---------- picking: solo ---------- */

  function soloQueue(key) {
    var q = state.queues[key];
    var deck = state.decks[key] || [];
    if (!q || q.n !== deck.length) {
      q = state.queues[key] = { perm: shuffleLive(deck), ptr: 0, n: deck.length };
    }
    return q;
  }

  function shuffleLive(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pickSolo() {
    var cats = CATS.filter(function (c) {
      return state.enabled[c.key] && (state.decks[c.key] || []).length;
    });
    if (!cats.length) return null;
    var total = 0;
    cats.forEach(function (c) { total += c.w; });
    var r = Math.random() * total;
    var cat = cats[cats.length - 1];
    for (var i = 0; i < cats.length; i++) {
      r -= cats[i].w;
      if (r <= 0) { cat = cats[i]; break; }
    }
    var q = soloQueue(cat.key);
    var card = q.perm[q.ptr % q.perm.length];
    q.ptr++;
    if (q.ptr >= q.perm.length) {
      q.perm = shuffleLive(state.decks[cat.key]); q.ptr = 0;
    }
    return card;
  }

  /* ---------- picking: sync ----------
     Slot s (since the NY midnight) replays the same weighted walk on every
     device: an rng seeded per-slot chooses the category, a per-day seeded
     permutation of each deck supplies the item, and the item index is how
     many times that category has come up today — counted by replaying the
     (cheap) category choices from slot 0. */

  function nySecondsSinceMidnight() {
    var p = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    var g = {};
    p.forEach(function (x) { g[x.type] = +x.value; });
    return g.hour * 3600 + g.minute * 60 + g.second;
  }

  function syncDecks() {
    var seed = daySeed();
    var out = {};
    CATS.forEach(function (c) {
      var deck = (state.decks[c.key] || []).slice();
      if (c.key === 'news') {
        /* only headlines at least an hour old join sync — both phones will
           have them even if one's snapshot is stale */
        var cutoff = Math.floor(Date.now() / 3600000) * 3600 - 3600;
        deck = deck.filter(function (card) { return (card.d || 0) < cutoff; });
      }
      deck.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      out[c.key] = seededShuffle(deck, mulberry32(seed ^ hashStr(c.key)));
    });
    return out;
  }

  /* every deck may claim a slot, whether or not THIS device managed to
     fetch it — the category walk must be a function of the clock alone, or
     one failed fetch would shift every later slot on one phone and the
     table falls out of step. A device missing the chosen deck falls back
     down a fixed order; it diverges on that slot only. */
  var SYNC_FALLBACK = ['talk', 'fight', 'pick', 'room', 'btown', 'hobby',
                       'event', 'news'];

  function pickSync() {
    var seed = daySeed();
    var decks = syncDecks();
    var total = 0;
    CATS.forEach(function (c) { total += c.w; });
    var slot = Math.floor(nySecondsSinceMidnight() / SYNC_SLOT_S);
    var counts = {};
    var chosen = null;
    for (var s = 0; s <= slot; s++) {
      var rng = mulberry32(seed ^ Math.imul(s + 1, 2654435761));
      var r = rng() * total;
      chosen = CATS[CATS.length - 1];
      for (var i = 0; i < CATS.length; i++) {
        r -= CATS[i].w;
        if (r <= 0) { chosen = CATS[i]; break; }
      }
      counts[chosen.key] = (counts[chosen.key] || 0) + 1;
    }
    var key = chosen.key;
    if (!decks[key].length) {
      for (var j = 0; j < SYNC_FALLBACK.length; j++) {
        if (decks[SYNC_FALLBACK[j]].length) { key = SYNC_FALLBACK[j]; break; }
      }
    }
    var deck = decks[key];
    if (!deck.length) return null;
    return deck[((counts[chosen.key] || 1) - 1) % deck.length];
  }

  function syncSlotProgress() {
    var s = nySecondsSinceMidnight();
    return (s % SYNC_SLOT_S) / SYNC_SLOT_S;
  }

  /* ---------- rendering ---------- */

  function cardColor(card) {
    var palette = KIND_COLORS[card.kind] || ['bg-brown'];
    if (card.kind === 'news' && card.local) return 'bg-teal';
    return palette[hashStr(card.id) % palette.length];
  }

  function autoFit(el, box) {
    var hi = Math.max(30, Math.min(120, Math.floor(box.clientHeight * 0.3)));
    var lo = 16;
    while (hi - lo > 1) {
      var mid = (hi + lo) >> 1;
      el.style.fontSize = mid + 'px';
      if (el.scrollHeight <= box.clientHeight * 0.92 &&
          el.scrollWidth <= box.clientWidth) lo = mid; else hi = mid;
    }
    el.style.fontSize = lo + 'px';
  }

  function render(card) {
    if (!card) return;
    state.current = card;
    var el = $('card');
    el.className = 'card ' + cardColor(card) + (state.held ? ' held' : '');
    $('kind-tag').textContent = KIND_TAG[card.kind] || 'CARD';
    var big = $('big');
    big.textContent = card.text;
    $('kicker').textContent = card.kicker || KIND_KICKER[card.kind] || '';
    $('src').textContent = card.src || '';
    autoFit(big, $('body'));
    startFuse();
  }

  function startFuse() {
    var fuse = $('fuse');
    fuse.style.transition = 'none';
    var dur, done;
    if (state.sync) {
      done = syncSlotProgress();
      dur = SYNC_SLOT_S * (1 - done);
    } else {
      dur = cardSeconds(state.current);
      done = Math.min(1, (Date.now() - state.shownAt) / (dur * 1000));
      dur = dur * (1 - done);
    }
    fuse.style.transform = 'scaleX(' + (1 - done) + ')';
    // force a reflow so the new start point lands before the burn resumes
    void fuse.offsetWidth;
    if (state.held) return;
    fuse.style.transition = 'transform ' + dur + 's linear';
    fuse.style.transform = 'scaleX(0)';
  }

  function cardSeconds(card) {
    var base = PACE_S[state.pace] || PACE_S.normal;
    var f = (card && KIND_FACTOR[card.kind]) || 1;
    return base * f;
  }

  /* ---------- scheduling ---------- */

  function showNext(fromHistory) {
    clearTimeout(state.timer);
    var card;
    if (state.sync) {
      card = pickSync();
      state.syncSlot = Math.floor(nySecondsSinceMidnight() / SYNC_SLOT_S);
    } else if (fromHistory && state.histAt < state.history.length - 1) {
      state.histAt++;
      card = state.history[state.histAt];
    } else {
      card = pickSolo();
      if (card) {
        state.history.push(card);
        if (state.history.length > 100) state.history.shift();
        state.histAt = state.history.length - 1;
      }
    }
    if (!card) {
      $('big').textContent = 'NOTHING TO DEAL — TURN A DECK BACK ON BELOW';
      return;
    }
    state.shownAt = Date.now();
    render(card);
    armFlip();
  }

  function armFlip() {
    clearTimeout(state.timer);
    if (state.held) return;
    var ms;
    if (state.sync) {
      ms = (SYNC_SLOT_S - (nySecondsSinceMidnight() % SYNC_SLOT_S)) * 1000 + 150;
    } else {
      ms = Math.max(500, cardSeconds(state.current) * 1000 -
                    (Date.now() - state.shownAt));
    }
    state.timer = setTimeout(function () { showNext(); }, ms);
  }

  function showPrev() {
    if (state.sync || state.histAt <= 0) return;
    clearTimeout(state.timer);
    state.histAt--;
    state.shownAt = Date.now();
    render(state.history[state.histAt]);
    armFlip();
  }

  function setHeld(held) {
    state.held = held;
    clearTimeout(state.holdTimer);
    var el = $('card');
    el.classList.toggle('held', held);
    if (held) {
      clearTimeout(state.timer);
      $('fuse').style.transition = 'none';
      /* a held card releases itself after 10 minutes — a table that
         wandered off shouldn't strand the board till someone notices */
      state.holdTimer = setTimeout(function () { setHeld(false); }, 10 * 60 * 1000);
    } else {
      state.shownAt = Date.now();     // the clock restarts on release
      if (state.sync && state.syncSlot !==
          Math.floor(nySecondsSinceMidnight() / SYNC_SLOT_S)) {
        showNext();                   // rejoin the table's slot
        return;
      }
      startFuse();
      armFlip();
    }
  }

  /* ---------- sync toggle ---------- */

  function setSync(on) {
    state.sync = on;
    setHeld(false);
    $('sync-badge').classList.toggle('on', on);
    $('sync-badge').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('sync-badge-label').textContent = on ? 'SYNCED' : 'SYNC';
    /* pace + decks are pinned while synced — every phone must agree */
    document.querySelectorAll('#pace-group .lopt, .lopt.deck, #prev-btn, #next-btn')
      .forEach(function (b) { b.disabled = on; });
    saveSet();
    showNext();
  }

  /* ---------- settings ---------- */

  function loadSet() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch (e) {}
    state.pace = PACES.indexOf(s.pace) !== -1 ? s.pace : 'normal';
    CATS.forEach(function (c) {
      state.enabled[c.key] = s.decks && (c.key in s.decks)
        ? !!s.decks[c.key] : true;
    });
    state.sync = WANT_SYNC || !!s.sync;
  }

  function saveSet() {
    try {
      localStorage.setItem(SET_KEY, JSON.stringify({
        pace: state.pace, decks: state.enabled, sync: state.sync,
      }));
    } catch (e) {}
  }

  /* ---------- wake lock: the phone is propped up, it must not sleep ---------- */

  function grabWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      state.wakeLock = lock;
      /* the OS can yank it back (low battery, app switch) — re-grab the
         moment we're visible again; it's best-effort, never guaranteed */
      lock.addEventListener('release', function () {
        state.wakeLock = null;
        if (document.visibilityState === 'visible') grabWakeLock();
      });
    }).catch(function () { state.wakeLock = null; });
  }

  /* ---------- boot ---------- */

  function wireUi() {
    document.querySelectorAll('#pace-group .lopt').forEach(function (b) {
      b.addEventListener('click', function () {
        state.pace = b.dataset.pace;
        document.querySelectorAll('#pace-group .lopt').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        saveSet();
        state.shownAt = Date.now();
        startFuse();
        armFlip();
      });
    });

    var deckRow = $('deck-group');
    CATS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lopt deck';
      b.textContent = c.label;
      b.setAttribute('aria-pressed', state.enabled[c.key] ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.enabled[c.key] = !state.enabled[c.key];
        b.setAttribute('aria-pressed', state.enabled[c.key] ? 'true' : 'false');
        saveSet();
      });
      deckRow.appendChild(b);
    });

    $('card').addEventListener('click', function () { setHeld(!state.held); });
    $('next-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (state.sync) return;
      setHeld(false);
      showNext(true);
    });
    $('prev-btn').addEventListener('click', function (e) {
      e.stopPropagation(); showPrev();
    });
    $('sync-badge').addEventListener('click', function () { setSync(!state.sync); });

    function togglePanel(id) {
      var p = $(id), open = p.hidden;
      ['help-panel', 'join-panel'].forEach(function (x) { $(x).hidden = true; });
      p.hidden = !open;
      $('panel-scrim').hidden = !open;
    }
    $('help-btn').addEventListener('click', function () { togglePanel('help-panel'); });
    $('join-btn').addEventListener('click', function () { togglePanel('join-panel'); });

    var JOIN_URL = 'https://guide.btownbrief.com/table.html?sync=1';
    if ($('copy-link')) $('copy-link').addEventListener('click', function () {
      var b = $('copy-link');
      (navigator.clipboard ? navigator.clipboard.writeText(JOIN_URL)
        : Promise.reject()).then(function () {
        b.textContent = 'COPIED';
        setTimeout(function () { b.textContent = 'COPY LINK'; }, 1600);
      }).catch(function () {});
    });
    if (navigator.share && $('share-link')) {
      $('share-link').hidden = false;
      $('share-link').addEventListener('click', function () {
        navigator.share({ title: 'Table Talk', url: JOIN_URL }).catch(function () {});
      });
    }
    $('panel-scrim').addEventListener('click', function () {
      ['help-panel', 'join-panel'].forEach(function (x) { $(x).hidden = true; });
      $('panel-scrim').hidden = true;
    });
    document.querySelectorAll('.panel-close').forEach(function (b) {
      b.addEventListener('click', function () {
        b.closest('.panel').hidden = true;
        $('panel-scrim').hidden = true;
      });
    });

    document.querySelectorAll('#pace-group .lopt').forEach(function (b) {
      b.classList.toggle('on', b.dataset.pace === state.pace);
    });

    /* coming back from a locked screen, an app switch, or the BFCache: the
       wall clock moved on while our timers didn't — land on the live card */
    function resync() {
      if (document.visibilityState !== 'visible') return;
      grabWakeLock();
      if (!state.current) return;
      if (state.sync) {
        if (state.syncSlot !== Math.floor(nySecondsSinceMidnight() / SYNC_SLOT_S)) {
          setHeld(false);
          showNext();
        } else { startFuse(); armFlip(); }
      } else if (!state.held) {
        if (Date.now() - state.shownAt > cardSeconds(state.current) * 1000) {
          showNext();
        } else { startFuse(); armFlip(); }
      }
    }
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('pageshow', resync);
    /* iOS grants wake locks more readily on a gesture — re-grab on touch
       whenever we've lost it */
    document.addEventListener('pointerdown', function () {
      if (!state.wakeLock) grabWakeLock();
    });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (state.current) autoFit($('big'), $('body'));
      }, 200);
    });

    function tickClock() {
      var now = new Date();
      var h = now.getHours() % 12 || 12;
      var m = now.getMinutes();
      $('clock').textContent = h + ':' + (m < 10 ? '0' : '') + m;
    }
    tickClock();
    setInterval(tickClock, 5000);
  }

  function loadAll(first) {
    var jobs = [
      fetchJson(DECK_URL).catch(function () { return null; }),
      fetchJson(STAY_URL).catch(function () { return null; }),
      fetchJson(RAIL_URL).catch(function () { return null; }),
      fetchJson(WEEK_URL).catch(function () { return null; }),
      fetchJson(READ_URL).catch(function () { return null; }),
      fetchJson(HOBBIES_URL).catch(function () { return null; }),
      fetchJson(HISTORY_URL).catch(function () { return null; }),
      fetchJson(NEWS_URL).catch(function () { return fetchJson(NEWS_LOCAL_URL).catch(function () { return null; }); }),
    ];
    return Promise.all(jobs).then(function (r) {
      /* on refresh, a failed fetch keeps the previous payload */
      var keys = ['deck', 'stay', 'rail', 'week', 'read', 'hobbies', 'history', 'news'];
      keys.forEach(function (k, i) { if (r[i] || first) state.raw[k] = r[i] || state.raw[k]; });
      buildDecks();
    });
  }

  function start() {
    if (TV) document.body.classList.add('tv');
    loadSet();
    wireUi();
    grabWakeLock();
    loadAll(true).then(function () {
      var any = CATS.some(function (c) { return (state.decks[c.key] || []).length; });
      if (!any) {
        $('big').textContent = 'NO SIGNAL — CHECK YOUR CONNECTION';
        return;
      }
      var kickoff = function () {
        if (state.sync) setSync(true); else showNext();
      };
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(kickoff);
      } else kickoff();
    });
    setInterval(function () { loadAll(false); }, REFRESH_MS);
  }

  start();
})();
