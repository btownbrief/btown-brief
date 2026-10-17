/* Clubs & groups (clubs.html).

   Reads two hand-checked files and one live list:
   - data/groups.json: leagues, pickup games, games, trivia, books, languages,
     music, dance, making, outdoors, social (scripts/build_groups.py checks it)
   - data/run-clubs.json: the run and fitness directory (build_run_clubs.py);
     its run clubs lead the page and link into All Day's run week
   - groups_public(): groups readers sent in that Stephen approved
     (db/groups-submit.sql), drawn as text, never as HTML

   Two views over the same filters (kind, search, free, beginner friendly):
   "This week", seven Burlington days from today, each meet in time order,
   and "Browse all", every group as a card with its next meet and how to
   join. The form at the bottom posts to groups_submit() into Stephen's
   queue (groups-mod.html).

   Every date here is a Burlington wall-clock date, worked out with Intl in
   America/New_York, so the week is right wherever the reader's phone is.
   State lives in the query string (?view=browse&kind=pickup&q=chess&free=1)
   so any view can be linked. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
  var ALLDAY_RUN_WEEK = '/all-day/#people/clubs';
  var TZ = 'America/New_York';
  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  var DAY_LONG = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* The kinds a reader can send in. db/groups-submit.sql's groups_rules()
     lists the same ones; tests/test_build_groups.py fails when they differ. */
  var FORM_KINDS = ['run', 'league', 'pickup', 'games', 'trivia', 'books', 'language', 'music', 'dance', 'making', 'outdoors', 'social', 'other'];
  var KIND_LABEL = {
    run: 'Run clubs', league: 'Leagues', pickup: 'Pickup & drop-in', games: 'Games', trivia: 'Trivia',
    books: 'Books', language: 'Languages', music: 'Music & choirs', dance: 'Dance', making: 'Making & crafts',
    outdoors: 'Outdoors', social: 'Social', other: 'Other',
  };
  var KIND_ONE = {
    run: 'Run club', league: 'League', pickup: 'Pickup', games: 'Games', trivia: 'Trivia', books: 'Books',
    language: 'Language', music: 'Music', dance: 'Dance', making: 'Making', outdoors: 'Outdoors', social: 'Social', other: 'Other',
  };
  var CATEGORY_LABEL = {
    'flag-football': 'Flag football', 'disc-golf': 'Disc golf', 'table-tennis': 'Table tennis',
    'rowing-paddling': 'Rowing & paddling', 'multi-sport': 'Several sports', 'board-games': 'Board games',
    'tabletop-rpg': 'Tabletop RPG', 'card-games': 'Card games', 'video-games': 'Video games', 'music-jam': 'Music jam',
    go: 'Go', running: 'Running', walking: 'Walking',
  };
  var LINK_LABEL = { site: 'Website', instagram: 'Instagram', facebook: 'Facebook', meetup: 'Meetup', discord: 'Discord',
    calendar: 'Calendar', strava: 'Strava', reddit: 'Reddit', youtube: 'YouTube' };
  var RUN_KIND = { run: 'run', other: 'run', pickup: 'pickup', bike: 'outdoors', hike: 'outdoors', 'row-paddle': 'outdoors', climb: 'outdoors', yoga: 'outdoors' };
  var RUN_CATEGORY = { run: 'running', other: 'walking', pickup: '', bike: 'cycling', hike: 'hiking', 'row-paddle': 'rowing-paddling', climb: 'climbing', yoga: 'other' };
  var BEGINNER_WORDS = /beginner|all (experience )?levels|all paces|all abilities|any (level|pace|ability)|no experience|never leave anyone|everyone is welcome|all are welcome|first.timers?/i;

  var state = { view: 'week', kind: 'all', q: '', free: false, beginner: false, day: 0 };
  var all = [];          // every group, normalized
  var readers = [];      // approved reader submissions
  var week = [];         // the seven days from today
  var now = null;        // Burlington wall clock
  var flashId = null;    // the card a #g- link just opened, flashed until it settles

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------ time */
  function wallNow() {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var hour = parts.hour === '24' ? '00' : parts.hour;
    return { y: +parts.year, mo: +parts.month, d: +parts.day, hm: hour + ':' + parts.minute };
  }
  function dayFrom(base, add) {
    var t = new Date(Date.UTC(base.y, base.mo - 1, base.d + add));
    var y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1, d = t.getUTCDate();
    return { y: y, mo: mo, d: d, wd: DAYS[(t.getUTCDay() + 6) % 7], add: add,
      key: y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d };
  }
  function clock(hm) {
    if (!hm) return '';
    var h = +hm.slice(0, 2), m = hm.slice(3);
    return ((h % 12) || 12) + (m === '00' ? '' : ':' + m) + (h < 12 ? 'am' : 'pm');
  }
  function plusMinutes(hm, mins) {
    var t = Math.min(+hm.slice(0, 2) * 60 + +hm.slice(3) + mins, 24 * 60 - 1);
    var h = Math.floor(t / 60), m = t % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function dayLabel(day) {
    if (day.add === 0) return 'Today';
    if (day.add === 1) return 'Tomorrow';
    return DAY_LONG[day.wd];
  }
  function shortDate(day) { return MONTHS[day.mo - 1] + ' ' + day.d; }

  /* months, from, until and skip, on the group or the meet (the run
     directory's rules, as in all-day's clubs-week inSeason) */
  function inSeason(item, meet, day) {
    var months = (meet && meet.months && meet.months.length) ? meet.months : (item.months && item.months.length ? item.months : null);
    if (months && months.indexOf(day.mo) === -1) return false;
    var scopes = [item, meet || {}];
    for (var i = 0; i < scopes.length; i++) {
      var x = scopes[i];
      if (x.from && day.key < x.from) return false;
      if (x.until && day.key > x.until) return false;
      if (Array.isArray(x.skip) && x.skip.indexOf(day.key) !== -1) return false;
    }
    return true;
  }
  /* a meet that already finished today drops off */
  function stillOn(meet, day) {
    if (day.add !== 0 || !meet.time) return true;
    return (meet.end || plusMinutes(meet.time, 60)) > now.hm;
  }
  function meetsOn(items, day) {
    var out = [];
    items.forEach(function (item) {
      (item.meets || []).forEach(function (meet) {
        if (meet.day === day.wd && inSeason(item, meet, day) && stillOn(meet, day)) out.push({ item: item, meet: meet, day: day });
      });
    });
    return out.sort(function (a, b) {
      var ta = a.meet.time || '99', tb = b.meet.time || '99';
      return ta < tb ? -1 : ta > tb ? 1 : a.item.name.localeCompare(b.item.name);
    });
  }
  function nextMeet(item) {
    for (var add = 0; add < 28; add++) {
      var found = meetsOn([item], dayFrom(now, add))[0];
      if (found) return found;
    }
    return null;
  }

  /* ------------------------------------------------------------ data */
  function safeHref(u) { return typeof u === 'string' && /^https?:\/\/[^\s"'<>`]+$/i.test(u) ? u : ''; }
  function townOf(address) {
    var parts = String(address || '').split(',');
    return parts.length > 1 ? parts[parts.length - 1].trim() : '';
  }

  function fromGroup(g) {
    return {
      id: g.id, src: 'groups', name: g.name, kind: g.kind, category: g.category, what: g.what,
      meets: g.meets || [], scheduleNote: g.schedule_note || '', season: g.season || '',
      months: g.months, from: g.from, until: g.until, skip: g.skip,
      where: g.where || '', town: g.town || '', cost: g.cost || '', free: g.free === true,
      level: g.level || '', beginner: g.beginner === true, how: (g.signup && g.signup.how) || '',
      join: safeHref(g.signup && g.signup.url) || safeHref(g.url), url: safeHref(g.url),
      newcomers: g.newcomers || '', links: g.links || {}, checked: g.checked || {}, featured: g.featured === true,
    };
  }
  function fromRunClub(c) {
    var first = (c.meets || []).filter(function (m) { return !/^varies/i.test(m.where || ''); })[0];
    var town = first ? townOf(first.address) : '';
    var links = {};
    ['instagram', 'meetup', 'strava'].forEach(function (k) { if (safeHref(c[k])) links[k] = c[k]; });
    return {
      id: c.id, src: 'run', name: c.name, kind: RUN_KIND[c.kind] || 'outdoors', category: RUN_CATEGORY[c.kind] || '',
      what: c.what, meets: c.meets || [], scheduleNote: c.schedule_note || '', season: c.season || '',
      months: c.months, from: c.from, until: c.until, skip: c.skip,
      where: first ? first.where + (town && first.where.indexOf(town) === -1 ? ', ' + town : '') : '',
      town: town, cost: c.cost || '', free: /\bfree\b/i.test(c.cost || ''),
      level: c.level || '', beginner: BEGINNER_WORDS.test((c.level || '') + ' ' + (c.newcomers || '')),
      how: '', join: safeHref(c.url), url: safeHref(c.url), newcomers: c.newcomers || '', links: links,
      checked: c.checked || {}, featured: false,
    };
  }
  function fromReader(r) {
    return {
      id: 'r-' + String(r.id || '').replace(/[^a-z0-9-]/gi, ''), src: 'reader', name: String(r.name || ''),
      kind: FORM_KINDS.indexOf(r.kind) === -1 ? 'other' : r.kind, category: '', what: '', meets: [],
      scheduleNote: String(r.when || ''), season: '', where: String(r.where || ''), town: '',
      cost: '', free: false, level: '', beginner: false, how: '', join: safeHref(r.url), url: safeHref(r.url),
      newcomers: '', links: {}, checked: {}, featured: false,
    };
  }

  function categoryLabel(c) {
    if (!c) return '';
    return CATEGORY_LABEL[c] || (c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, ' '));
  }
  function haystack(item) {
    var days = (item.meets || []).map(function (m) { return DAY_LONG[m.day] + ' ' + (m.where || '') + ' ' + (m.address || '') + ' ' + (m.note || ''); }).join(' ');
    return [item.name, item.what, categoryLabel(item.category), KIND_LABEL[item.kind], item.where, item.town, item.scheduleNote,
      item.season, item.cost, item.level, item.newcomers, days].join(' ').toLowerCase();
  }
  function matches(item, ignoreKind) {
    if (!ignoreKind && state.kind !== 'all' && item.kind !== state.kind) return false;
    if (state.free && !item.free) return false;
    if (state.beginner && !item.beginner) return false;
    if (state.q) {
      var hay = item._hay || (item._hay = haystack(item));
      var words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
    }
    return true;
  }
  function everyone() { return all.concat(readers); }

  /* ------------------------------------------------------------ cards */
  function meetLine(found) {
    var m = found.meet;
    var when = (found.day.add < 2 ? dayLabel(found.day) : DAY_SHORT[found.day.wd] + ', ' + shortDate(found.day)) +
      (m.time ? ' · ' + clock(m.time) + (m.end ? '–' + clock(m.end) : '') : (m.note ? ' · ' + m.note : ''));
    return when + (m.where && !/^varies/i.test(m.where) ? ' · ' + m.where : '');
  }
  function tagsHTML(item) {
    var t = [];
    if (item.src === 'reader') t.push('<span class="gx-tag gx-tag-reader">Added by a reader</span>');
    if (item.free) t.push('<span class="gx-tag gx-tag-free">Free</span>');
    if (item.beginner) t.push('<span class="gx-tag gx-tag-new">Beginner friendly</span>');
    if (item.season && !/^year-round/i.test(item.season)) t.push('<span class="gx-tag">' + esc(item.season) + '</span>');
    return t.length ? '<div class="gx-tags">' + t.join('') + '</div>' : '';
  }
  function slotList(item) {
    var slots = item.meets.map(function (m) { return DAY_LONG[m.day] + 's' + (m.time ? ' ' + clock(m.time) : ''); });
    return slots.filter(function (s, i) { return slots.indexOf(s) === i; }).join(', ');
  }
  function scheduleHTML(item) {
    var next = nextMeet(item);
    if (next) return '<p class="gx-next"><span class="gx-next-k">Next</span> ' + esc(meetLine(next)) + '</p>';
    if (item.meets && item.meets.length) {
      return '<p class="gx-next gx-off"><span class="gx-next-k">Off season</span> ' + esc(slotList(item)) +
        (item.season ? ' · ' + esc(item.season) : '') + '</p>';
    }
    return item.scheduleNote ? '<p class="gx-next gx-loose"><span class="gx-next-k">When</span> ' + esc(item.scheduleNote) + '</p>' : '';
  }
  function factsHTML(item) {
    var rows = [];
    if (item.meets && item.meets.length) {
      rows.push(['Meets', item.meets.map(function (m) {
        return DAY_LONG[m.day] + 's' + (m.time ? ' ' + clock(m.time) + (m.end ? '–' + clock(m.end) : '') : '') +
          (m.where ? ', ' + m.where : '') + (m.season ? ' (' + m.season + ')' : '') + (m.note ? '. ' + m.note : '');
      }).join('; ')]);
      if (item.scheduleNote) rows.push(['Also', item.scheduleNote]);
    }
    if (item.where && item.src !== 'reader') rows.push(['Where', item.where]);
    if (item.cost) rows.push(['Cost', item.cost]);
    if (item.level) rows.push(['Level', item.level]);
    if (item.newcomers) rows.push(['New?', item.newcomers]);
    if (item.how) rows.push(['To join', item.how]);
    if (!rows.length) return '';
    return '<details class="gx-more"><summary>Details</summary><dl class="gx-facts">' +
      rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl></details>';
  }
  function actionsHTML(item) {
    var out = [];
    if (item.join) {
      out.push('<a class="gx-btn gx-btn-primary gx-join" href="' + esc(item.join) + '" target="_blank" rel="noopener nofollow">' +
        (item.src === 'reader' ? 'Their page' : (item.how && item.join !== item.url ? 'Sign up' : 'How to join')) + ' ↗</a>');
    }
    if (item.src === 'run' && item.kind === 'run') {
      out.push('<a class="gx-btn" href="/all-day/#people/club-' + esc(item.id) + '">In the run week</a>');
    }
    Object.keys(item.links || {}).forEach(function (k) {
      var href = safeHref(item.links[k]);
      if (href && href !== item.join) out.push('<a class="gx-link" href="' + esc(href) + '" target="_blank" rel="noopener nofollow">' + esc(LINK_LABEL[k] || k) + '</a>');
    });
    if (item.url && item.url !== item.join) out.push('<a class="gx-link" href="' + esc(item.url) + '" target="_blank" rel="noopener nofollow">Website</a>');
    return out.length ? '<div class="gx-actions">' + out.join('') + '</div>' : '';
  }
  function checkedHTML(item) {
    if (item.src === 'reader') return '<p class="gx-checked">Sent in by a reader and approved. Check their page before you go.</p>';
    var c = item.checked || {};
    var src = safeHref(c.source);
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.date || '');
    if (!d || !src) return '';
    return '<p class="gx-checked">Checked ' + esc(MONTHS[+d[2] - 1] + ' ' + (+d[3])) + ' on <a href="' + esc(src) +
      '" target="_blank" rel="noopener nofollow">their own page</a></p>';
  }
  function cardBody(item, inRow) {
    return (inRow ? '' : scheduleHTML(item)) + (item.what ? '<p class="gx-what">' + esc(item.what) + '</p>' : '') +
      (item.src === 'reader' && item.where ? '<p class="gx-what">' + esc(item.where) + '</p>' : '') +
      tagsHTML(item) + factsHTML(item) + actionsHTML(item) + checkedHTML(item);
  }
  function cardHTML(item) {
    var label = KIND_ONE[item.kind] + (item.category ? ' · ' + categoryLabel(item.category) : '');
    return '<article class="gx-card' + (item.featured ? ' gx-card-featured' : '') + (item.id === flashId ? ' gx-flash' : '') + '" id="g-' + esc(item.id) + '" data-k="' + esc(item.kind) + '">' +
      '<div class="gx-card-head"><h3 class="gx-name">' + esc(item.name) + '</h3><span class="gx-kind">' + esc(label) + '</span></div>' +
      cardBody(item) + '</article>';
  }

  /* ------------------------------------------------------------ views */
  function countWeek(items) {
    var n = 0;
    week.forEach(function (day) { n += meetsOn(items, day).length; });
    return n;
  }
  function drawStats() {
    var meeting = all.filter(function (item) { return countWeek([item]) > 0; }).length;
    $('gx-stats').textContent = all.length + ' groups, ' + meeting + ' of them meeting this week. Know one that’s missing? Add it at the bottom.';
  }

  function drawRun() {
    var runs = all.filter(function (i) { return i.kind === 'run'; });
    var rows = [];
    for (var a = 0; a < 7 && rows.length < 5; a++) rows = rows.concat(meetsOn(runs, week[a]));
    $('gx-run-count').textContent = runs.length + ' clubs · ' + countWeek(runs) + ' runs this week';
    $('gx-run-list').innerHTML = rows.slice(0, 5).map(function (f) {
      return '<li><a href="#g-' + esc(f.item.id) + '" data-goto="' + esc(f.item.id) + '"><span class="gx-run-when">' +
        esc((f.day.add < 2 ? dayLabel(f.day) : DAY_SHORT[f.day.wd]) + (f.meet.time ? ' ' + clock(f.meet.time) : '')) +
        '</span><span class="gx-run-name">' + esc(f.item.name) + '</span></a></li>';
    }).join('') || '<li class="gx-run-none">No runs on the calendar this week. Check each club’s page.</li>';
  }

  function drawKinds() {
    var counts = { all: 0 };
    everyone().forEach(function (item) {
      if (!matches(item, true)) return;
      counts.all++;
      counts[item.kind] = (counts[item.kind] || 0) + 1;
    });
    $('gx-kinds').innerHTML = ['all'].concat(FORM_KINDS).filter(function (k) { return k === 'all' || counts[k] || state.kind === k; }).map(function (k) {
      return '<button type="button" class="gx-kind-chip" data-kind="' + k + '" aria-pressed="' + (state.kind === k) + '">' +
        esc(k === 'all' ? 'All' : KIND_LABEL[k]) + ' <span class="gx-count">' + (counts[k] || 0) + '</span></button>';
    }).join('');
  }

  function drawWeek() {
    var pool = everyone().filter(function (i) { return matches(i); });
    $('gx-days').innerHTML = week.map(function (day, i) {
      return '<button type="button" role="tab" class="gx-day" data-day="' + i + '" aria-selected="' + (state.day === i) + '">' +
        '<span class="gx-day-name">' + esc(i === 0 ? 'Today' : DAY_SHORT[day.wd]) + '</span>' +
        '<span class="gx-day-date">' + day.d + '</span><span class="gx-day-n">' + meetsOn(pool, day).length + '</span></button>';
    }).join('');
    var day = week[state.day];
    var rows = meetsOn(pool, day);
    $('gx-day-title').textContent = dayLabel(day) + (day.add < 2 ? ', ' + DAY_LONG[day.wd] : '') + ' ' + shortDate(day) +
      ' · ' + rows.length + (rows.length === 1 ? ' meet' : ' meets');
    $('gx-rows').innerHTML = rows.map(function (f) {
      var m = f.meet;
      var place = m.where && !/^varies/i.test(m.where) ? m.where : (m.where || f.item.where);
      return '<li class="gx-row"><details><summary>' +
        '<span class="gx-row-time">' + esc(m.time ? clock(m.time) : 'Time varies') + '</span>' +
        '<span class="gx-row-main"><span class="gx-row-name">' + esc(f.item.name) + '</span>' +
        '<span class="gx-row-sub">' + esc([KIND_ONE[f.item.kind], place].filter(Boolean).join(' · ')) + '</span></span>' +
        (f.item.free ? '<span class="gx-tag gx-tag-free">Free</span>' : '') +
        '</summary><div class="gx-row-body">' + (m.note ? '<p class="gx-row-note">' + esc(m.note) + '</p>' : '') + cardBody(f.item, true) + '</div></details></li>';
    }).join('') || '<li class="page-empty">Nothing ' + esc(day.add === 0 ? 'left today' : 'on ' + DAY_LONG[day.wd]) +
      ' with these filters. Try another day, or Browse all for groups without a fixed weekly time.</li>';
    var loose = pool.filter(function (i) { return !(i.meets && i.meets.length); }).length;
    $('gx-week-foot').innerHTML = loose ? esc(loose + ' more ' + (loose === 1 ? 'group meets' : 'groups meet') + ' on a changing schedule (monthly, by season, or posted week to week). ') +
      '<button type="button" class="gx-textbtn" data-view-jump="browse">See them in Browse all</button>' : '';
  }

  function drawBrowse() {
    var list = $('gx-list');
    var items = everyone().filter(function (i) { return matches(i); });
    if (!items.length) {
      list.innerHTML = '<p class="page-empty">Nothing matches. Try fewer words, or turn off a filter.</p>';
      return;
    }
    var soon = {};
    items.forEach(function (i) { soon[i.src + i.id] = countWeek([i]) > 0 ? 1 : 0; });
    var sort = function (a, b) {
      return (b.featured - a.featured) || ((a.src === 'reader') - (b.src === 'reader')) ||
        (soon[b.src + b.id] - soon[a.src + a.id]) || a.name.localeCompare(b.name);
    };
    if (state.kind === 'all' && !state.q) {
      list.innerHTML = FORM_KINDS.map(function (k) {
        var group = items.filter(function (i) { return i.kind === k; }).sort(sort);
        if (!group.length) return '';
        return '<h2 class="section-label gx-section" id="kind-' + k + '">' + esc(KIND_LABEL[k]) + ' <span class="gx-count">' + group.length + '</span></h2>' +
          (k === 'run' ? '<p class="gx-section-sub">Every run club’s week, with maps and an “I’m going” button, is in <a href="' + ALLDAY_RUN_WEEK + '">All Day’s People tab</a>.</p>' : '') +
          '<div class="gx-grid">' + group.map(cardHTML).join('') + '</div>';
      }).join('');
    } else {
      list.innerHTML = '<div class="gx-grid">' + items.sort(sort).map(cardHTML).join('') + '</div>';
    }
  }

  function draw() {
    drawKinds();
    $('gx-week').hidden = state.view !== 'week';
    $('gx-browse').hidden = state.view !== 'browse';
    Array.prototype.forEach.call(document.querySelectorAll('.gx-seg'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === state.view));
    });
    if (state.view === 'week') drawWeek(); else drawBrowse();
    writeURL();
  }

  /* ------------------------------------------------------------ url state */
  function readURL() {
    var p = new URLSearchParams(location.search);
    if (p.get('view') === 'browse') state.view = 'browse';
    var k = p.get('kind');
    if (k && FORM_KINDS.indexOf(k) !== -1) state.kind = k;
    state.q = (p.get('q') || '').slice(0, 80);
    state.free = p.get('free') === '1';
    state.beginner = p.get('beginner') === '1';
    $('gx-q').value = state.q;
    $('gx-free').checked = state.free;
    $('gx-beginner').checked = state.beginner;
  }
  function writeURL() {
    var p = new URLSearchParams();
    if (state.view !== 'week') p.set('view', state.view);
    if (state.kind !== 'all') p.set('kind', state.kind);
    if (state.q) p.set('q', state.q);
    if (state.free) p.set('free', '1');
    if (state.beginner) p.set('beginner', '1');
    var qs = p.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
  }

  function goTo(id) {
    state.view = 'browse'; state.kind = 'all'; state.q = ''; state.free = false; state.beginner = false;
    $('gx-q').value = ''; $('gx-free').checked = false; $('gx-beginner').checked = false;
    flashId = id;
    draw();
    var card = document.getElementById('g-' + id);
    if (card) card.scrollIntoView({ block: 'center' });
    setTimeout(function () { if (flashId === id) flashId = null; }, 2000);
  }

  /* ------------------------------------------------------------ the form */
  var URL_RE = /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d{1,5})?([/?#][^\s<>"'`]*)?$/i;
  var EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
  var LINKISH = /(https?:\/\/|www\.|\.(com|net|org|ru|xyz|top|io)\b)/gi;
  var SERVER_ERRORS = {
    bad_name: ['name', 'Give the group a name (3 to 80 characters, no < or >).'],
    bad_kind: ['kind', 'Pick what kind of group it is.'],
    bad_when: ['when', 'Say when it meets.'],
    bad_where: ['where', 'Say where it meets.'],
    bad_url: ['url', 'That link doesn’t look right. It should start with https://'],
    bad_email: ['email', 'That email doesn’t look right.'],
    bad_note: ['note', 'Keep the note under 500 characters, with no < or >.'],
    too_many_links: ['note', 'Put the link in the Link box; the other boxes can’t hold links.'],
    slow_down: [null, 'That’s a few from this device today. Try again tomorrow, or email BtownBrief@gmail.com.'],
    busy: [null, 'Lots of submissions this hour. Try again in a bit.'],
    queue_full: [null, 'The queue is full while I catch up. Email BtownBrief@gmail.com instead.'],
    bad_device: [null, 'Something went wrong on this page. Reload and try again.'],
  };
  function clean(s) { return String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }

  function readForm(form) {
    var v = {};
    ['name', 'kind', 'when', 'where', 'url', 'email', 'note', 'company'].forEach(function (k) { v[k] = clean(form.elements[k].value); });
    if (v.url && !/^[a-z]+:/i.test(v.url) && /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(v.url)) v.url = 'https://' + v.url;
    return v;
  }
  function validate(v) {
    var e = {};
    var len = function (s, lo, hi) { return s.length >= lo && s.length <= hi; };
    if (!len(v.name, 3, 80) || /[<>]/.test(v.name)) e.name = SERVER_ERRORS.bad_name[1];
    if (FORM_KINDS.indexOf(v.kind) === -1) e.kind = SERVER_ERRORS.bad_kind[1];
    if (!len(v.when, 3, 120) || /[<>]/.test(v.when)) e.when = 'Say when it meets (a day and time, or “first Thursday of the month”).';
    if (!len(v.where, 2, 120) || /[<>]/.test(v.where)) e.where = 'Say where it meets.';
    if (v.url && (v.url.length > 300 || !URL_RE.test(v.url))) e.url = SERVER_ERRORS.bad_url[1];
    if (!v.email) e.email = 'Add your email so I can ask a question if I have one. It’s never shown.';
    else if (v.email.length > 200 || !EMAIL_RE.test(v.email)) e.email = SERVER_ERRORS.bad_email[1];
    if (v.note.length > 500 || /[<>]/.test(v.note)) e.note = SERVER_ERRORS.bad_note[1];
    if (!e.note && ((v.name + ' ' + v.when + ' ' + v.where + ' ' + v.note).match(LINKISH) || []).length > 1) e.note = SERVER_ERRORS.too_many_links[1];
    return e;
  }
  function showErrors(form, errors) {
    Array.prototype.forEach.call(form.querySelectorAll('.gx-err'), function (p) {
      var k = p.getAttribute('data-for');
      p.textContent = errors[k] || '';
      var input = form.elements[k];
      if (input) input.setAttribute('aria-invalid', errors[k] ? 'true' : 'false');
    });
    var first = Object.keys(errors)[0];
    if (first && form.elements[first]) form.elements[first].focus();
  }
  function deviceId() {
    try { return window.BTBC.visitorId(); } catch (e) {
      return 'g-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function bindForm() {
    var form = $('gx-form');
    form.elements.kind.innerHTML = '<option value="">Pick one</option>' + FORM_KINDS.map(function (k) {
      return '<option value="' + k + '">' + esc(KIND_LABEL[k]) + '</option>';
    }).join('');
    var msg = $('gx-form-msg');
    var busy = false;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy) return;
      var v = readForm(form);
      var errors = validate(v);
      showErrors(form, errors);
      msg.className = 'gx-form-msg';
      if (Object.keys(errors).length) { msg.textContent = 'A couple of things to fix above.'; msg.classList.add('gx-bad'); return; }
      var thanks = function () {
        form.reset();
        msg.textContent = 'Thanks! It’s in my queue. I check every one, and it shows up on this page once I’ve looked it over.';
        msg.classList.add('gx-good');
      };
      if (v.company) { thanks(); return; }   // the hidden box only a bot fills in
      busy = true;
      $('gx-submit').disabled = true;
      msg.textContent = 'Sending…';
      fetch(SUPABASE_URL + '/rest/v1/rpc/groups_submit', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_name: v.name, p_kind: v.kind, p_when: v.when, p_where: v.where, p_url: v.url,
          p_email: v.email, p_note: v.note, p_device: deviceId() }),
      }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }).then(function (res) {
        if (res && res.ok) { thanks(); try { window.BTBC.track('groups-submit'); } catch (e) {} return; }
        var known = SERVER_ERRORS[res && res.error];
        if (known && known[0]) { var e = {}; e[known[0]] = known[1]; showErrors(form, e); }
        msg.textContent = known ? known[1] : 'That didn’t go through. Try again, or email BtownBrief@gmail.com.';
        msg.classList.add('gx-bad');
      }).catch(function () {
        msg.textContent = 'Couldn’t reach the server. Try again, or email the details to BtownBrief@gmail.com.';
        msg.classList.add('gx-bad');
      }).then(function () { busy = false; $('gx-submit').disabled = false; });
    });
  }

  /* ------------------------------------------------------------ events */
  function bind() {
    var timer = null;
    $('gx-q').addEventListener('input', function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = e.target.value.trim().slice(0, 80); draw(); }, 120);
    });
    $('gx-free').addEventListener('change', function (e) { state.free = e.target.checked; draw(); });
    $('gx-beginner').addEventListener('change', function (e) { state.beginner = e.target.checked; draw(); });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-kind], [data-view], [data-day], [data-goto], [data-kind-jump], [data-view-jump]');
      if (!t) return;
      if (t.hasAttribute('data-goto')) { e.preventDefault(); goTo(t.getAttribute('data-goto')); return; }
      if (t.hasAttribute('data-kind-jump')) {
        state.kind = t.getAttribute('data-kind-jump'); state.view = 'browse'; draw();
        $('gx-tools').scrollIntoView({ block: 'start' });
        return;
      }
      if (t.hasAttribute('data-view-jump')) { state.view = t.getAttribute('data-view-jump'); draw(); return; }
      if (t.hasAttribute('data-view')) { state.view = t.getAttribute('data-view'); draw(); return; }
      if (t.hasAttribute('data-day')) { state.day = +t.getAttribute('data-day'); drawWeek(); return; }
      if (t.hasAttribute('data-kind')) { state.kind = t.getAttribute('data-kind'); draw(); }
    });
    window.addEventListener('hashchange', function () {
      var m = /^#g-([a-z0-9-]+)$/i.exec(location.hash);
      if (m) goTo(m[1]);
    });
  }

  function loadReaders() {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/groups_public', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      readers = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.id && r.name; }).map(fromReader);
    }).catch(function () { readers = []; });
  }

  function start() {
    now = wallNow();
    week = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return dayFrom(now, i); });
    readURL();
    bind();
    bindForm();
    var fetchJSON = window.BTBC.fetchJSON;
    Promise.all([
      fetchJSON('data/groups.json'),
      fetchJSON('data/run-clubs.json').catch(function () { return { clubs: [] }; }),
    ]).then(function (res) {
      all = (res[0].groups || []).map(fromGroup).concat((res[1].clubs || []).map(fromRunClub));
      drawStats();
      drawRun();
      // open on the first day that has something, when today is done
      var pool = all.filter(function (i) { return matches(i); });
      if (!meetsOn(pool, week[0]).length) {
        for (var i = 1; i < 7; i++) if (meetsOn(pool, week[i]).length) { state.day = i; break; }
      }
      draw();
      var m = /^#g-([a-z0-9-]+)$/i.exec(location.hash);
      if (m) goTo(m[1]);
      loadReaders().then(function () { if (readers.length) draw(); });
    }).catch(function () {
      $('gx-list').innerHTML = '<p class="page-empty">Could not load the list. Run a local server (<code>python3 -m http.server 8000</code>) if you’re previewing from disk.</p>';
      $('gx-rows').innerHTML = '<li class="page-empty">Could not load the list.</li>';
    });
  }

  start();
})();
