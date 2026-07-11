/* Jobs page — renders data/jobs.json (written by scripts/refresh_jobs.py).
   Postings auto-expire client-side after MAX_AGE_DAYS so a stalled
   refresh Action never leaves months-old "new" jobs on the page.
   Filter chips AND together; chips with zero matching postings hide
   themselves (tags come from the refresh script, so what's filterable
   depends on what this week's data supports). */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var MAX_AGE_DAYS = 14;
  var DAY_MS = 24 * 60 * 60 * 1000;

  var EMPLOYERS = [
    { name: 'UVM Medical Center', note: "Vermont's biggest employer — nursing, tech, food service, admin", url: 'https://www.uvmhealth.org/careers' },
    { name: 'University of Vermont', note: 'Staff & faculty openings, strong benefits', url: 'https://www.uvmjobs.com' },
    { name: 'State of Vermont', note: 'Every state agency, many Burlington-area desks', url: 'https://careers.vermont.gov' },
    { name: 'GlobalFoundries', note: 'Semiconductor fab in Essex Junction — manufacturing & engineering', url: 'https://gf.com/about-us/careers/' },
    { name: 'Dealer.com / Cox Automotive', note: 'Burlington-based tech — software, design, support', url: 'https://www.coxenterprises.com/careers' },
  ];

  var jobs = [];

  function activeTags() {
    return Array.prototype.slice
      .call(document.querySelectorAll('#job-filters input:checked'))
      .map(function (el) { return el.value; });
  }

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

  function jobHTML(job) {
    return (
      '<a class="job-row" href="' + esc(safeUrl(job.url)) + '" target="_blank" rel="noopener">' +
        '<div class="job-main">' +
          '<span class="job-title">' + esc(job.title) + '</span>' +
          '<span class="job-employer">' + esc(job.employer) + '</span>' +
        '</div>' +
        '<div class="job-meta">' +
          (job.pay ? '<span class="job-pay">' + esc(job.pay) + '</span>' : '') +
          '<span class="job-posted' + (daysAgo(job.posted) <= 1 ? ' job-posted-new' : '') + '">' +
            esc(agoLabel(job.posted)) + '</span>' +
          '<span class="job-source">' + esc(job.source) + ' ↗</span>' +
        '</div>' +
      '</a>'
    );
  }

  function render() {
    var tags = activeTags();
    var list = document.getElementById('jobs-list');
    var count = document.getElementById('jobs-count');

    var matching = jobs.filter(function (job) {
      return tags.every(function (t) { return (job.tags || []).indexOf(t) !== -1; });
    });

    if (!matching.length) {
      list.innerHTML = jobs.length
        ? '<p class="page-empty">Nothing matches that combination this week — try unchecking a filter.</p>'
        : '<p class="page-empty">No fresh postings right now — check the big employers below, or come back after the next refresh.</p>';
    } else {
      list.innerHTML = '<div class="job-list">' + matching.map(jobHTML).join('') + '</div>';
    }

    count.textContent = tags.length
      ? matching.length + ' of ' + jobs.length + ' postings match'
      : jobs.length + ' postings, newest first — every link goes to the real application';
  }

  // Hide filter chips the current data can't support (e.g. no seasonal
  // postings this week means no dead "Seasonal" chip).
  function pruneChips() {
    Array.prototype.slice
      .call(document.querySelectorAll('#job-filters input'))
      .forEach(function (input) {
        var any = jobs.some(function (job) {
          return (job.tags || []).indexOf(input.value) !== -1;
        });
        input.closest('.quick-chip').style.display = any ? '' : 'none';
      });
  }

  function renderEmployers() {
    document.getElementById('employer-row').innerHTML = EMPLOYERS.map(function (e) {
      return (
        '<a class="dir-card" href="' + esc(safeUrl(e.url)) + '" target="_blank" rel="noopener">' +
          '<div class="dir-card-head"><span class="dir-card-name">' + esc(e.name) + '</span></div>' +
          '<p class="dir-card-what">' + esc(e.note) + '</p>' +
          '<span class="dir-card-arrow" aria-hidden="true">↗</span>' +
        '</a>'
      );
    }).join('');
  }

  window.BTBC.fetchJSON('data/jobs.json').then(function (data) {
    jobs = (Array.isArray(data.jobs) ? data.jobs : [])
      .filter(function (job) {
        return job && typeof job.posted === 'string' &&
          job.url && daysAgo(job.posted) <= MAX_AGE_DAYS;
      })
      .sort(function (a, b) {
        return b.posted.localeCompare(a.posted) || String(b.id).localeCompare(String(a.id));
      });

    var updated = document.getElementById('jobs-updated');
    var when = data.updated ? new Date(data.updated) : null;
    if (when && !isNaN(when.getTime())) {
      updated.textContent = 'Last checked ' +
        when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) +
        ' · refreshes automatically';
    }

    pruneChips();
    render();
  }).catch(function () {
    document.getElementById('jobs-list').innerHTML =
      '<p class="page-empty">Could not load postings. Run a local server (<code>python3 -m http.server 8000</code>) if you’re previewing from disk.</p>';
  });

  renderEmployers();
  document.getElementById('job-filters').addEventListener('change', render);
})();
