/* Burlington government meetings — renders data/civic.json. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var TZ = 'America/New_York';

  function safeUrl(url) {
    return /^https?:\/\//i.test(url || '') ? url : '#';
  }

  function dateFor(start) {
    return new Date(start);
  }

  function dayKey(start) {
    return dateFor(start).toLocaleDateString('en-CA', { timeZone: TZ });
  }

  function dayLabel(start) {
    return dateFor(start).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  }

  function timeLabel(meeting) {
    var label = dateFor(meeting.start).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    return meeting.time_uncertain ? label + ' (check agenda)' : label;
  }

  function linksHTML(meeting) {
    var links = [
      ['Agenda', meeting.agenda_url], ['Packet', meeting.packet_url],
      ['Minutes', meeting.minutes_url], ['Video', meeting.video_url],
    ].filter(function (link) { return link[1]; });
    if (!links.length) return '';
    return '<div class="civic-links">' + links.map(function (link) {
      return '<a href="' + esc(safeUrl(link[1])) + '" target="_blank" rel="noopener">' + esc(link[0]) + ' ↗</a>';
    }).join('') + '</div>';
  }

  function meetingHTML(meeting, recent) {
    var distinctTitle = meeting.title && meeting.title.toLowerCase() !== meeting.body.toLowerCase();
    var summary = '';
    if (recent && meeting.summary_text) {
      summary = '<p class="civic-summary">' + esc(meeting.summary_text) + '</p>';
    } else if (recent && meeting.summary_status === 'pending') {
      summary = '<p class="civic-summary-pending">Summary coming.</p>';
    }
    return '<article class="civic-meeting">' +
      '<div class="civic-meeting-main"><h3>' + esc(meeting.body) + '</h3>' +
      (distinctTitle ? '<p class="civic-meeting-title">' + esc(meeting.title) + '</p>' : '') +
      '<p class="civic-meeting-meta"><span>' + esc(timeLabel(meeting)) + '</span>' +
      (meeting.venue ? '<span>' + esc(meeting.venue) + '</span>' : '') + '</p></div>' +
      linksHTML(meeting) + summary + '</article>';
  }

  function groupedHTML(meetings, recent) {
    if (!meetings.length) return '<p class="page-empty">' + (recent ? 'No recent meetings are in the feed yet.' : 'No upcoming meetings are posted yet. Check the body links below for late notices.') + '</p>';
    var groups = [];
    meetings.forEach(function (meeting) {
      var key = dayKey(meeting.start);
      var last = groups[groups.length - 1];
      if (!last || last.key !== key) {
        last = { key: key, start: meeting.start, meetings: [] };
        groups.push(last);
      }
      last.meetings.push(meeting);
    });
    return '<div class="civic-docket">' + groups.map(function (group) {
      return '<section class="civic-day"><h3 class="civic-day-label">' + esc(dayLabel(group.start)) + '</h3><div class="civic-day-list">' + group.meetings.map(function (meeting) { return meetingHTML(meeting, recent); }).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  function bodyHTML(body) {
    return '<article class="civic-body"><h3>' + esc(body.name) + '</h3><p>' + esc(body.typical_schedule) + '</p><div class="civic-links">' +
      '<a href="' + esc(safeUrl(body.source_url)) + '" target="_blank" rel="noopener">Source ↗</a>' +
      (body.video_url ? '<a href="' + esc(safeUrl(body.video_url)) + '" target="_blank" rel="noopener">Video ↗</a>' : '') +
      '</div></article>';
  }

  window.BTBC.fetchJSON('data/civic.json').then(function (data) {
    var upcoming = Array.isArray(data.upcoming) ? data.upcoming.slice().sort(function (a, b) { return a.start.localeCompare(b.start); }) : [];
    var past = Array.isArray(data.past) ? data.past.slice().sort(function (a, b) { return b.start.localeCompare(a.start); }) : [];
    var bodies = Array.isArray(data.bodies) ? data.bodies : [];
    document.getElementById('civic-upcoming').innerHTML = groupedHTML(upcoming, false);
    document.getElementById('civic-past').innerHTML = groupedHTML(past, true);
    document.getElementById('civic-bodies').innerHTML = bodies.map(bodyHTML).join('');
    var generated = data.generated ? new Date(data.generated) : null;
    if (generated && !isNaN(generated.getTime())) {
      document.getElementById('civic-updated').textContent = 'Last checked ' + generated.toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' });
    }
  }).catch(function () {
    document.getElementById('civic-upcoming').innerHTML = '<p class="page-empty">Could not load the meeting calendar. Run a local server (<code>python3 -m http.server 8000</code>) if you’re previewing from disk.</p>';
    document.getElementById('civic-past').innerHTML = '';
  });
})();
