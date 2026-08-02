/* Jobs page v2 — renders data/jobs.json (written by scripts/refresh_jobs.py).
   The radar's digest framing: stat tiles up top, the list grouped by day
   (Today / Yesterday / Earlier this week / Last week), one category filter
   plus stackable quality chips. Postings auto-expire client-side after
   MAX_AGE_DAYS so a stalled refresh Action never leaves months-old "new"
   jobs on the page. Filter state lives in the URL hash so a filtered view
   is shareable. Rows carried forward from before the v2 pipeline may lack
   cat/pay_hr — both fall back gracefully. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var MAX_AGE_DAYS = 14;
  var DAY_MS = 24 * 60 * 60 * 1000;

  // Keep in step with SOURCES in scripts/refresh_jobs.py.
  var BOARDS_WATCHED = 13;

  var CATS = [
    ['healthcare', 'Healthcare & care'],
    ['government', 'Government & civic'],
    ['education', 'Education'],
    ['tech', 'Tech & manufacturing'],
    ['trades', 'Trades, food & service'],
    ['office', 'Office & finance'],
    ['community', 'Community & nonprofit'],
    ['other', 'Everything else'],
  ];
  var CAT_LABEL = {};
  CATS.forEach(function (c) { CAT_LABEL[c[0]] = c[1]; });

  var QUALS = [
    ['pay25', '$25+/hr'],
    ['paylisted', 'Pay listed'],
    ['no-degree', 'No degree needed'],
    ['weekend', 'Weekend'],
    ['seasonal', 'Seasonal'],
  ];

  var EMPLOYERS = [
    { name: 'UVM Medical Center', note: "Vermont's biggest employer — nursing, tech, food service, admin", url: 'https://www.uvmhealth.org/careers' },
    { name: 'University of Vermont', note: 'Staff & faculty openings, strong benefits', url: 'https://www.uvmjobs.com' },
    { name: 'State of Vermont', note: 'Every state agency, many Burlington-area desks', url: 'https://careers.vermont.gov' },
    { name: 'GlobalFoundries', note: 'Semiconductor fab in Essex Junction — manufacturing & engineering', url: 'https://gf.com/about-us/careers/' },
    { name: 'Beta Technologies', note: 'Electric aviation at the airport — engineering, ops, trades', url: 'https://www.beta.team/careers/' },
    { name: 'Howard Center', note: "Vermont's largest community mental-health agency — care & support roles", url: 'https://www.howardcenter.org/careers/' },
    { name: 'OnLogic', note: 'Industrial computers in South Burlington — tech, ops, sales', url: 'https://www.onlogic.com/company/careers/' },
    { name: 'Dealer.com / Cox Automotive', note: 'Burlington-based tech — software, design, support', url: 'https://www.coxenterprises.com/careers' },
  ];

  var jobs = [];
  var state = { cat: null, quals: [], q: '' };

  // Only http(s) links are ever rendered — esc() stops markup injection but
  // not a scraped "javascript:" URL, which would still run on click.
  function safeUrl(url) {
    return /^https?:\/\//i.test(url || '') ? url : '#';
  }

  // Calendar-day math, not elapsed-milliseconds: "posted" is a Burlington
  // date (YYYY-MM-DD), so age is the difference in whole days between that
  // date and today in Burlington — independent of the viewer's clock/timezone.
  function dayNumber(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : NaN;
  }

  function todayNumber() {
    // en-CA formats as YYYY-MM-DD; the timeZone pins it to Burlington's date.
    return dayNumber(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  }

  function daysAgo(iso) {
    return todayNumber() - dayNumber(iso);
  }

  function agoLabel(iso) {
    var d = daysAgo(iso);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return d + ' days ago';
  }

  /* ---------- filter state <-> URL hash ---------- */

  function readHash() {
    var params = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    if (params.cat && CAT_LABEL[params.cat]) state.cat = params.cat;
    if (params.q) {
      state.quals = params.q.split(',').filter(function (q) {
        return QUALS.some(function (item) { return item[0] === q; });
      });
    }
    if (params.s) state.q = params.s;
  }

  function writeHash() {
    var parts = [];
    if (state.cat) parts.push('cat=' + state.cat);
    if (state.quals.length) parts.push('q=' + state.quals.join(','));
    if (state.q) parts.push('s=' + encodeURIComponent(state.q));
    history.replaceState(null, '', parts.length
      ? '#' + parts.join('&')
      : location.pathname + location.search);
  }

  /* ---------- matching ---------- */

  function jobCat(job) {
    return CAT_LABEL[job.cat] ? job.cat : 'other';
  }

  function hasQual(job, qual) {
    if (qual === 'paylisted') return !!(job.pay || job.pay_hr);
    return (job.tags || []).indexOf(qual) !== -1;
  }

  function matchesQuals(job) {
    return state.quals.every(function (q) { return hasQual(job, q); });
  }

  function matchesSearch(job) {
    if (!state.q) return true;
    var needle = state.q.toLowerCase();
    return (job.title + ' ' + job.employer).toLowerCase().indexOf(needle) !== -1;
  }

  function matching() {
    return jobs.filter(function (job) {
      return (!state.cat || jobCat(job) === state.cat) &&
        matchesQuals(job) && matchesSearch(job);
    });
  }

  /* ---------- rendering ---------- */

  function payLabel(job) {
    var hr = job.pay_hr;
    if (hr && hr.length === 2 && hr[0] !== null) {
      var lo = Math.round(hr[0]), hi = Math.round(hr[1]);
      return lo === hi ? '≈$' + lo + '/hr' : '≈$' + lo + '–' + hi + '/hr';
    }
    return job.pay || '';
  }

  function jobHTML(job) {
    var pay = payLabel(job);
    var fresh = daysAgo(job.posted) <= 1;
    return (
      '<a class="job-row" href="' + esc(safeUrl(job.url)) + '" target="_blank" rel="noopener">' +
        '<div class="job-main">' +
          '<span class="job-title">' + esc(job.title) + '</span>' +
          '<span class="job-sub">' + esc(job.employer) +
            ' · ' + esc(CAT_LABEL[jobCat(job)]) + '</span>' +
        '</div>' +
        '<div class="job-meta">' +
          (pay ? '<span class="job-pay' +
            ((job.tags || []).indexOf('pay25') !== -1 ? ' pay-good' : '') +
            '"' + (job.pay ? ' title="' + esc(job.pay) + '"' : '') + '>' +
            esc(pay) + '</span>' : '') +
          '<span' + (fresh ? ' class="job-new"' : '') + '>' +
            esc(agoLabel(job.posted)) + '</span>' +
          '<span class="job-src">' + esc(job.source) + ' ↗</span>' +
        '</div>' +
      '</a>'
    );
  }

  // The radar's digest framing: the list reads as days, not as one long run.
  var GROUPS = [
    { title: 'Today', test: function (d) { return d <= 0; } },
    { title: 'Yesterday', test: function (d) { return d === 1; } },
    { title: 'Earlier this week', test: function (d) { return d >= 2 && d <= 7; } },
    { title: 'Last week', test: function (d) { return d >= 8; } },
  ];

  function listHTML(rows) {
    var used = 0;
    var html = GROUPS.map(function (group) {
      var inGroup = rows.filter(function (job) { return group.test(daysAgo(job.posted)); });
      if (!inGroup.length) return '';
      used += inGroup.length;
      return (
        '<section class="day-group">' +
          '<div class="day-head"><h2>' + group.title + '</h2>' +
            '<span class="day-n">' + inGroup.length +
            (inGroup.length === 1 ? ' posting' : ' postings') + '</span></div>' +
          '<div class="job-list">' + inGroup.map(jobHTML).join('') + '</div>' +
        '</section>'
      );
    }).join('');
    return used ? html : '';
  }

  function pillHTML(value, label, count, pressed) {
    return (
      '<button type="button" class="pill-btn" data-value="' + esc(value) + '"' +
        ' aria-pressed="' + (pressed ? 'true' : 'false') + '">' +
        esc(label) + '<span class="n">' + count + '</span></button>'
    );
  }

  function renderFilters() {
    var underQuals = jobs.filter(function (job) {
      return matchesQuals(job) && matchesSearch(job);
    });
    var catRow = pillHTML('', 'All fields', underQuals.length, !state.cat);
    CATS.forEach(function (c) {
      var count = underQuals.filter(function (job) { return jobCat(job) === c[0]; }).length;
      if (!count && state.cat !== c[0]) return; // nothing this week — no dead pill
      catRow += pillHTML(c[0], c[1], count, state.cat === c[0]);
    });
    document.getElementById('cat-filters').innerHTML = catRow;

    var qualRow = '';
    QUALS.forEach(function (q) {
      var count = jobs.filter(function (job) { return hasQual(job, q[0]); }).length;
      if (!count && state.quals.indexOf(q[0]) === -1) return;
      qualRow += pillHTML(q[0], q[1], count, state.quals.indexOf(q[0]) !== -1);
    });
    document.getElementById('qual-filters').innerHTML = qualRow;
  }

  function render() {
    var rows = matching();
    var list = document.getElementById('jobs-list');
    var count = document.getElementById('jobs-count');

    var html = rows.length ? listHTML(rows) : '';
    list.innerHTML = html ||
      (jobs.length
        ? '<p class="page-empty">Nothing matches that combination this week — try clearing a filter.</p>'
        : '<p class="page-empty">No fresh postings right now — check the big employers below, or come back after the next refresh.</p>');

    var filtered = state.cat || state.quals.length || state.q;
    count.textContent = filtered
      ? rows.length + ' of ' + jobs.length + ' postings match'
      : jobs.length + ' postings, newest first — every link goes to the real application';

    renderFilters();
  }

  function renderStats() {
    document.getElementById('stat-live').textContent = jobs.length;
    document.getElementById('stat-week').textContent = jobs.filter(function (job) {
      return daysAgo(job.posted) <= 7;
    }).length;
    document.getElementById('stat-sources').textContent = BOARDS_WATCHED;
  }

  function renderEmployers() {
    document.getElementById('employer-row').innerHTML = EMPLOYERS.map(function (e) {
      return (
        '<a class="card" href="' + esc(safeUrl(e.url)) + '" target="_blank" rel="noopener">' +
          '<h3>' + esc(e.name) + '</h3>' +
          '<p>' + esc(e.note) + '</p>' +
          '<span class="go" aria-hidden="true">↗</span>' +
        '</a>'
      );
    }).join('');
  }

  /* ---------- wiring ---------- */

  document.getElementById('cat-filters').addEventListener('click', function (e) {
    var btn = e.target.closest('.pill-btn');
    if (!btn) return;
    state.cat = btn.getAttribute('data-value') || null;
    writeHash();
    render();
  });

  document.getElementById('qual-filters').addEventListener('click', function (e) {
    var btn = e.target.closest('.pill-btn');
    if (!btn) return;
    var value = btn.getAttribute('data-value');
    var at = state.quals.indexOf(value);
    if (at === -1) state.quals.push(value); else state.quals.splice(at, 1);
    writeHash();
    render();
  });

  var searchTimer;
  document.getElementById('job-search').addEventListener('input', function (e) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.q = e.target.value.trim();
      writeHash();
      render();
    }, 120);
  });

  readHash();
  document.getElementById('job-search').value = state.q;
  renderEmployers();

  window.BTBC.fetchJSON('data/jobs.json').then(function (data) {
    jobs = (Array.isArray(data.jobs) ? data.jobs : [])
      .filter(function (job) {
        return job && typeof job.posted === 'string' &&
          job.url && daysAgo(job.posted) <= MAX_AGE_DAYS;
      })
      .sort(function (a, b) {
        return b.posted.localeCompare(a.posted) || String(b.id).localeCompare(String(a.id));
      });

    var line = '';
    var when = data.updated ? new Date(data.updated) : null;
    if (when && !isNaN(when.getTime())) {
      line = 'Last checked ' +
        when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) +
        ' · refreshes automatically';
    }

    // The digest hook, personalized: how many postings appeared since the
    // reader last opened the board. Same-day revisits stay quiet.
    try {
      var today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      var prev = localStorage.getItem('btb-jobs-last-visit');
      localStorage.setItem('btb-jobs-last-visit', today);
      if (prev && prev < today) {
        var since = jobs.filter(function (job) { return job.posted > prev; }).length;
        if (since) {
          line += (line ? ' · ' : '') + since + ' new since your last visit';
        }
      }
    } catch (e) { /* private browsing — the line just stays shorter */ }

    document.getElementById('jobs-updated').textContent = line;

    renderStats();
    render();
  }).catch(function () {
    document.getElementById('jobs-list').innerHTML =
      '<p class="page-empty">Could not load postings. Run a local server (<code>python3 -m http.server 8000</code>) if you’re previewing from disk.</p>';
  });
})();
