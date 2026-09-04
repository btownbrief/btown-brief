/* The Countdown page.
   Reads data/countdowns.json, drops anything already over, sorts soonest
   first, paints one colour block per event and ticks the clocks once a
   second. No dependencies; the file is the whole app. */

(function () {
  'use strict';

  var SB = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
  var PLAYER_KEY = 'btown-player-id'; /* same key All Day uses, on purpose */

  /* Burlington, drawn out of the year: lake, maple, sunset, foliage, sap,
     evergreen, twilight, slate, plum, moss. Neighbours never repeat — the
     assignment pass below enforces it whatever order the data arrives in. */
  var HUES = {
    lake: '#12496f',
    maple: '#a52a2a',
    coral: '#c9503f',
    foliage: '#bf5a12',
    sap: '#a06a06',
    evergreen: '#1d5340',
    twilight: '#43356f',
    slate: '#39424c',
    plum: '#7a2c50',
    moss: '#4c5f1e'
  };
  var ORDER = Object.keys(HUES);

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* A date-only string is a local wall-clock date, not UTC. new Date('2027-05-30')
     would land on the 29th west of Greenwich, so parse the parts by hand. */
  function atLocal(iso, time) {
    var d = String(iso || '').split('-');
    if (d.length !== 3) return null;
    var t = (time && /^\d{1,2}:\d{2}$/.test(time)) ? time.split(':') : ['0', '0'];
    return new Date(+d[0], +d[1] - 1, +d[2], +t[0], +t[1], 0, 0);
  }

  function endOfDay(iso) {
    var d = atLocal(iso);
    if (!d) return null;
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function fmtDate(iso) {
    var d = atLocal(iso);
    if (!d) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function fmtRange(ev) {
    var a = atLocal(ev.start);
    if (!a) return '';
    if (!ev.end || ev.end === ev.start) return fmtDate(ev.start);
    var b = atLocal(ev.end);
    if (b && b.getFullYear() === a.getFullYear() && b.getMonth() === a.getMonth()) {
      return MONTHS[a.getMonth()] + ' ' + a.getDate() + '–' + b.getDate() + ', ' + a.getFullYear();
    }
    return fmtDate(ev.start) + ' – ' + fmtDate(ev.end);
  }

  /* Google Calendar's template URL wants all-day ranges as [start, end+1). */
  function gcal(ev) {
    var a = atLocal(ev.start);
    if (!a) return null;
    var b = atLocal(ev.end || ev.start);
    b.setDate(b.getDate() + 1);
    function stamp(d) {
      return d.getFullYear() +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0');
    }
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(ev.name) +
      '&dates=' + stamp(a) + '/' + stamp(b) +
      '&location=' + encodeURIComponent(ev.venue || 'Burlington, VT') +
      '&details=' + encodeURIComponent((ev.why || '') + (ev.link ? '\n' + ev.link : ''));
  }

  /* --------------------------------------------------------------- render */

  var live = []; /* [{el, ev, startAt, endAt}] for the ticker */

  /* A rank number on a card that is already in date order says nothing. The
     month does: it gives the stack a spine you can scan without reading. */
  function eyebrow(ev, startAt, happening) {
    if (happening) return 'On now';
    var d = startAt || atLocal(ev.start);
    if (!d) return '';
    var m = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    return (ev.status === 'expected' ? 'Around ' + m : m);
  }

  function card(ev, i) {
    var a = document.createElement(ev.link ? 'a' : 'div');
    a.className = 'cd-card';
    if (ev.link) { a.href = ev.link; a.target = '_blank'; a.rel = 'noopener'; }
    a.style.setProperty('--cd-hue', HUES[ev.color] || HUES.lake);

    var startAt = atLocal(ev.start, ev.time);
    var endAt = endOfDay(ev.end || ev.start);
    var happening = startAt && endAt && Date.now() >= startAt.getTime() && Date.now() <= endAt.getTime();
    if (happening) a.classList.add('cd-card-live');

    var clock;
    if (ev.status === 'expected' || !startAt) {
      clock = '<p class="cd-tag">Date not announced yet</p>' +
        '<p class="cd-window">' + esc(ev.window || 'Watch this space') + '</p>';
    } else {
      clock = '<div class="cd-clock" data-clock role="timer" aria-live="off"></div>';
    }

    var when = (ev.status === 'expected')
      ? ''
      : '<p class="cd-when">' + esc(fmtRange(ev)) + (ev.time ? ' · ' + esc(ev.timeLabel || ev.time) : '') + '</p>';

    var cal = (ev.status === 'expected') ? null : gcal(ev);

    a.innerHTML =
      '<p class="cd-rank">' + esc(eyebrow(ev, startAt, happening)) + '</p>' +
      '<h2 class="cd-name">' + esc(ev.name) + '</h2>' +
      clock +
      when +
      (ev.venue ? '<p class="cd-where">' + esc(ev.venue) + '</p>' : '') +
      (ev.why ? '<p class="cd-why">' + esc(ev.why) + '</p>' : '') +
      '<div class="cd-links">' +
        (ev.link ? '<span class="cd-btn">Details ↗</span>' : '') +
        (cal ? '<span class="cd-btn" data-cal="' + esc(cal) + '">+ Calendar</span>' : '') +
      '</div>';

    /* The whole card is the link, so the calendar chip has to intercept. */
    var chip = a.querySelector('[data-cal]');
    if (chip) {
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.open(chip.getAttribute('data-cal'), '_blank', 'noopener');
      });
    }

    var slot = a.querySelector('[data-clock]');
    if (slot) live.push({ slot: slot, startAt: startAt, endAt: endAt, end: ev.end || ev.start });
    return a;
  }

  function unit(n, label) {
    return '<div class="cd-unit"><span class="cd-num">' + n +
      '</span><span class="cd-lab">' + label + '</span></div>';
  }

  function tick() {
    var now = Date.now();
    for (var i = 0; i < live.length; i++) {
      var L = live[i];
      var ms = L.startAt.getTime() - now;
      if (ms <= 0) {
        /* multi-day event in progress: say so, and say how much is left */
        var daysLeft = Math.ceil((L.endAt.getTime() - now) / 86400000);
        L.slot.outerHTML = '<p class="cd-window">Happening now' +
          (daysLeft > 0 ? ' · ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left' : '') +
          '</p>';
        live.splice(i, 1); i--;
        continue;
      }
      var s = Math.floor(ms / 1000);
      var d = Math.floor(s / 86400);
      var h = Math.floor((s % 86400) / 3600);
      var m = Math.floor((s % 3600) / 60);
      var sec = s % 60;
      var pad = function (n) { return String(n).padStart(2, '0'); };
      L.slot.innerHTML = d > 0
        ? unit(d, d === 1 ? 'day' : 'days') + unit(pad(h), 'hrs') + unit(pad(m), 'min') + unit(pad(sec), 'sec')
        : unit(pad(h), 'hrs') + unit(pad(m), 'min') + unit(pad(sec), 'sec');
    }
  }

  /* Neighbours never share a hue. Honour the colour the data asked for when
     it does not clash, otherwise take the next free one round the wheel. */
  function paint(list) {
    var prev = null;
    list.forEach(function (ev) {
      var want = HUES[ev.color] ? ev.color : null;
      if (!want || want === prev) {
        var start = ORDER.indexOf(want || prev || ORDER[0]);
        for (var k = 1; k <= ORDER.length; k++) {
          var c = ORDER[(start + k) % ORDER.length];
          if (c !== prev) { want = c; break; }
        }
      }
      ev.color = want;
      prev = want;
    });
  }

  function render(data) {
    var stack = document.getElementById('cd-stack');
    var todayEnd = new Date(); todayEnd.setHours(0, 0, 0, 0);
    var list = (data.events || []).filter(function (ev) {
      if (ev.hidden) return false;
      if (ev.status === 'expected') return true;
      var e = endOfDay(ev.end || ev.start);
      return e && e.getTime() >= todayEnd.getTime();
    });

    /* Page order is soonest first; entries with no date yet fall to the end
       of the month they usually land in, which is what `start` carries. */
    list.sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
    paint(list);

    stack.innerHTML = '';
    list.forEach(function (ev, i) { stack.appendChild(card(ev, i)); });

    var counted = list.filter(function (e) { return e.status !== 'expected'; }).length;
    var meta = document.getElementById('cd-meta');
    if (meta) {
      meta.textContent = list.length + ' events · ' + counted + ' with a locked date · tap + Calendar to save one';
    }

    tick();
    setInterval(tick, 1000);
  }

  /* ----------------------------------------------------------------- form */

  function playerId() {
    var id = null;
    try { id = localStorage.getItem(PLAYER_KEY); } catch (e) { /* private mode */ }
    if (id) return id;
    id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try { localStorage.setItem(PLAYER_KEY, id); } catch (e) { /* ephemeral is fine */ }
    return id;
  }

  function wireForm() {
    var form = document.getElementById('cd-form');
    if (!form) return;
    var err = form.querySelector('.cd-err');
    var btn = form.querySelector('.cd-submit');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = new FormData(form);
      var get = function (k) { return (f.get(k) || '').toString().trim(); };
      var name = get('name'), date = get('date'), where = get('where');
      var link = get('link'), why = get('why'), who = get('who');

      if (name.length < 2) { return fail('What is it called?'); }
      if (!date) { return fail('It needs a date — even a rough one.'); }
      if (why.length < 8) { return fail('Tell me why. That is the whole question.'); }
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      var text = 'EVENT: ' + name + ' | DATE: ' + date + ' | WHERE: ' + (where || '—') +
        ' | LINK: ' + (link || '—') + ' | WHY: ' + why;

      fetch(SB + '/rest/v1/rpc/ad_suggest', {
        method: 'POST',
        headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_text: text.slice(0, 600),
          p_who: who,
          p_tab: 'countdown',
          p_sender: playerId()
        })
      }).then(function (r) {
        return r.ok ? r.text().then(function (t) { return t ? JSON.parse(t) : true; }) : null;
      }).catch(function () { return null; })
        .then(function (okay) {
          /* ad_suggest returns false on a server-side reject and null when the
             call itself failed — neither is a send, and clearing the form
             would throw away what they wrote. */
          if (!okay) {
            btn.disabled = false;
            btn.textContent = 'Put it in the jar';
            return fail('That didn’t send — try again in a minute.');
          }
          var box = form.parentNode;
          form.remove();
          var p = document.createElement('p');
          p.className = 'cd-thanks';
          p.textContent = 'In the jar. I read every one; the good ones go up.';
          box.appendChild(p);
        });
    });

    function fail(msg) { err.textContent = msg; err.hidden = false; }
  }

  fetch('../data/countdowns.json?v=' + Math.floor(Date.now() / 3.6e6))
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () {
      var stack = document.getElementById('cd-stack');
      if (stack) stack.innerHTML = '<p class="cd-sub">The list didn’t load. Try a refresh.</p>';
    });

  wireForm();
})();
