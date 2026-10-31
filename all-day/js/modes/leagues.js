/* Body · Leagues: every adult league you can join around Burlington.

   data/body/leagues.json holds them by organizer, read from each organizer's
   own pages. An organizer is a tile. Its sports are small rows inside it, and a
   row opens to that sport's leagues: when, what it costs, how to sign up. The
   pill filters by sport, the most-offered first. Whatever closes for signups
   soonest sits on top: the organizer, and the sport inside it. A league leaves the tab the
   day after its `ends` date; one with no `ends` stays. The link says Sign up
   only when `signup_open` is true and today in Burlington is not past
   `signup_until`.

   Every reader-facing word of the tab is in COPY. */

import * as app from '../app.js';
import { el, esc, ICON, safeHref, button } from '../ui.js';
import { sectionBar } from '../sections.js';
import { data, today } from './body-kit.js';

const COPY = {
  label: 'Leagues',
  promise: 'Join something',
  loading: 'Loading',
  failed: 'Didn’t load',
  retry: 'Try again',
  all: 'All',
  nodates: 'Dates not posted',
  signup: 'Sign up',
  details: 'Details',
  count: (n) => (n === 1 ? '1 league' : n + ' leagues'),
};

const S = { root: null, orgs: [], filter: 'all', loaded: false, failed: false };

const running = (o) => o.sports.filter((x) => !x.ends || x.ends >= today());
const line = (x) => [x.level, x.format].filter(Boolean).join(' · ');
const canJoin = (x) => x.signup_open === true && !(x.signup_until && x.signup_until < today());
const league = (x) => '<div class="lg-one">' +
  (line(x) ? '<p class="lg-what">' + esc(line(x)) + '</p>' : '') +
  '<p class="lg-when">' + esc(x.season || COPY.nodates) + '</p>' +
  (x.day || x.where ? '<p>' + esc([x.day, x.where].filter(Boolean).join(' · ')) + '</p>' : '') +
  (x.cost ? '<p>' + esc(x.cost) + '</p>' : '') +
  (x.signup ? '<p>' + esc(x.signup) + '</p>' : '') +
  (x.url ? '<a class="lg-go" href="' + esc(safeHref(x.url)) + '" target="_blank" rel="noopener">' + esc(canJoin(x) ? COPY.signup : COPY.details) + ICON.right + '</a>' : '') + '</div>';

/* the soonest signup still open among these leagues; 'z' sorts after any date */
const closes = (list) => list.filter((x) => canJoin(x) && x.signup_until).map((x) => x.signup_until).sort()[0] || 'z';
function sportsOf(o) {
  const by = new Map();
  running(o).forEach((x) => { if (!by.has(x.sport)) by.set(x.sport, []); by.get(x.sport).push(x); });
  return [...by.entries()].sort((a, b) => closes(a[1]).localeCompare(closes(b[1])) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
}
function tile(o) {
  const sports = sportsOf(o).filter(([s]) => S.filter === 'all' || s === S.filter);
  const c = el('article', 'lg-org');
  c.dataset.org = o.id;
  c.innerHTML = '<h3>' + esc(o.name) + '</h3><p class="lg-town">' + esc(o.town || '') + '</p>' +
    sports.map(([s, list]) => '<details class="lg-sport"' + (S.filter === 'all' ? '' : ' open') + '><summary><span>' + esc(s) + '</span>' +
      (list.length > 1 ? '<span class="lg-n">' + esc(COPY.count(list.length)) + '</span>' : '') + '</summary>' + list.map(league).join('') + '</details>').join('');
  return c;
}
function draw() {
  const root = S.root;
  if (!root) return;
  root.innerHTML = '';
  if (!S.loaded) { root.appendChild(el('p', 'tf-empty', esc(COPY.loading))); return; }
  if (S.failed) {
    const box = el('div', 'hb-gate');
    box.appendChild(el('p', 'hb-empty', esc(COPY.failed)));
    box.appendChild(button(esc(COPY.retry), 'ghost', load));
    root.appendChild(box);
    return;
  }
  const wrap = el('div', 'lg-wrap');
  const shown = (o) => running(o).filter((x) => S.filter === 'all' || x.sport === S.filter);
  S.orgs.filter((o) => shown(o).length).sort((a, b) => closes(shown(a)).localeCompare(closes(shown(b)))).forEach((o) => wrap.appendChild(tile(o)));
  root.appendChild(wrap);
  root.appendChild(el('div', 'spacer'));
}
function load() {
  S.loaded = false;
  S.failed = false;
  draw();
  return data('leagues.json').then((d) => { S.orgs = d.organizers || []; }, () => { S.failed = true; })
    .then(() => { S.loaded = true; draw(); app.paintSubnav(); });
}
function setFilter(k) {
  if (S.filter === k) return;
  S.filter = k;
  app.paintSubnav();
  draw();
  app.scrollTop(false);
}

app.register('leagues', {
  label: COPY.label,
  icon: ICON.ball,
  promise: COPY.promise,
  mount(root) {
    S.root = root;
    load();
  },
  activate(param) { if (param && S.loaded) setFilter(param); },
  refresh() { draw(); },
  subnav() {
    if (!S.loaded || S.failed) return null;
    const n = new Map();
    S.orgs.forEach((o) => running(o).forEach((x) => n.set(x.sport, (n.get(x.sport) || 0) + 1)));
    const items = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => ({ key, label: key }));
    return sectionBar({ key: 'body-leagues', title: COPY.label, color: '--tf-jobs', current: S.filter, onPick: setFilter, items: [{ key: 'all', label: COPY.all }].concat(items) });
  },
  keepSubnav: true,
  newSince() { return 0; },
});
