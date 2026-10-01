/* First-time card. Reads data/first-time.json, renders one event from
   ?event=coffee|basketball, or a picker when none is given. Co-hosts link
   straight to ?event=… from a Meetup description. No dependencies. */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var want = (params.get('event') || '').toLowerCase();
  var picker = document.getElementById('ft-picker');
  var card = document.getElementById('ft-card');
  var hostnote = document.getElementById('ft-hostnote');
  var hero = document.getElementById('ft-hero');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function row(label, text, confirm) {
    if (!text) return null;
    var li = el('li', 'ft-row');
    li.appendChild(el('span', 'ft-label', label));
    var p = el('p', 'ft-text', text);
    if (confirm) {
      var c = el('span', 'ft-confirm', ' ' + confirm);
      c.title = 'Not yet confirmed by the host';
      p.appendChild(c);
    }
    li.appendChild(p);
    return li;
  }

  function renderPicker(events) {
    picker.innerHTML = '';
    Object.keys(events).forEach(function (k) {
      var e = events[k];
      var a = el('a', 'ft-pick' + (k === want ? ' on' : ''));
      a.href = '?event=' + k;
      a.appendChild(el('b', null, e.name));
      a.appendChild(el('span', null, e.when_short + ' · ' + e.where.split(',')[0]));
      picker.appendChild(a);
    });
  }

  function renderCard(e) {
    hero.querySelector('.page-hero-kicker').textContent = e.kicker + ' · first-time card';
    hero.querySelector('h1').textContent = e.name;
    hero.querySelector('.page-hero-sub').textContent = e.one_line;
    document.title = e.name + ': first time? — Burlington Brief';

    card.innerHTML = '';
    var top = el('div', 'ft-top');
    var when = el('div', 'ft-when');
    when.appendChild(el('span', 'ft-label', 'When'));
    when.appendChild(el('strong', null, e.when));
    var where = el('div', 'ft-where');
    where.appendChild(el('span', 'ft-label', 'Where'));
    var wl = el('a', null, e.where);
    wl.href = e.map_url; wl.target = '_blank'; wl.rel = 'noopener';
    where.appendChild(wl);
    where.appendChild(el('span', 'ft-where-detail', e.where_detail));
    top.appendChild(when); top.appendChild(where);
    card.appendChild(top);

    var ul = el('ul', 'ft-rows');
    [
      row('Cost', e.cost),
      row('Level / pace', e.pace, e.pace_confirm),
      row('Coming alone', e.alone),
      row('Without a car', e.car_free, e.car_free_confirm),
      row('How long', e.duration),
      row('Leaving early', e.leave_early),
      row('Bring', e.bring),
      row('Weather', e.weather, e.weather_confirm),
      row('Who to look for', e.look_for),
      row('RSVP', e.rsvp)
    ].forEach(function (li) { if (li) ul.appendChild(li); });
    card.appendChild(ul);

    var links = el('div', 'ft-links');
    [['Meetup page', e.meetup_url], ['Telegram chat', e.telegram_url], ['Ask a question first', e.community_url]].forEach(function (pair) {
      var a = el('a', 'ft-link', pair[0]);
      a.href = pair[1]; a.target = '_blank'; a.rel = 'noopener';
      links.appendChild(a);
    });
    card.appendChild(links);
    card.hidden = false;
  }

  fetch('data/first-time.json?v=' + new Date().toISOString().slice(0, 10))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      renderPicker(d.events);
      if (d.events[want]) {
        renderCard(d.events[want]);
      }
      var pre = document.getElementById('ft-checklist');
      pre.textContent = d.checklist.join('\n');
      hostnote.hidden = false;
      var btn = document.getElementById('ft-copy');
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(d.checklist.join('\n')).then(function () {
          btn.textContent = 'Copied';
          setTimeout(function () { btn.textContent = 'Copy the five lines'; }, 1500);
        }, function () { btn.textContent = 'Select the text above and copy'; });
      });
    })
    .catch(function () {
      picker.innerHTML = '<p class="page-empty">The card didn\'t load. The Meetup page has the basics.</p>';
    });
})();
