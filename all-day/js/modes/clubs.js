/* clubs.js — People · Clubs (wave 1, 2026-10-29; APP-MAP rows 22 and the
   Clubs line of the People table).

   - Every club: data/groups.json, the clubs page's hand-checked list, by
     kind (a chip each), with the clubs page and its "add your club" form a
     tap away. A club's row opens its own page.
   - Run clubs: data/run-clubs.json's week through clubs-week.js, the same
     seven-day strip as the You tab; a meet opens its sheet on You
     (#people/rc-<club>-<date>-<hhmm>, people.js's landClub), so there is
     one club sheet, not two.
   - Start something: the clubs board's `idea` posts (boards-core.js, wave
     0): a club or ritual someone wants, its kind, the days the poster has
     in mind and how many it needs (`size`). The vote is "I'm in". Once the
     votes reach the size, the card offers "Propose the first gathering",
     which opens the gatherings board's form (Stephen looks first). The
     poster's days ride on the idea; a reader's own days need a board
     field that doesn't exist yet (a shell ask in the report).
   - Wanted: the same ideas still short of their number, most wanted first:
     the library of things nobody has started yet.
   - Musicians: the ideas whose kind is music (a band, a jam, a choir), the
     first vertical of the map's musician finder, with its own post button. */

import * as app from '../app.js';
import * as cw from '../clubs-week.js';
import { el, esc, chips, meetRow, button, ICON } from '../ui.js';
import { RULES } from '../boards-core.js';
import * as boards from '../boards.js';
import * as kit from './people-kit.js';

const KEY = 'clubs';
const KIND_LABEL = { run: 'Run clubs', league: 'Leagues', pickup: 'Pickup & drop-in', games: 'Games', trivia: 'Trivia', books: 'Books', language: 'Languages',
  music: 'Music & choirs', dance: 'Dance', making: 'Making & crafts', outdoors: 'Outdoors', social: 'Social', other: 'Other' };
const IDEA_KIND = { sport: 'Sport', outdoors: 'Outdoors', music: 'Music', books: 'Books', food: 'Food', games: 'Games', making: 'Making', social: 'Social', learning: 'Learning', other: 'Something else' };
const SHOWN = 8;
const S = { groups: null, rc: null, ideas: [], r: null, kind: 'all', all: false, rcDay: null };

function load() {
  if (app.demo) {
    return Promise.all([
      app.demoData('people').then((d) => { S.groups = d.groups || []; }, () => { S.groups = []; }),
      app.demoData('run-clubs').then((j) => { S.rc = cw.redateDemo(j, Date.now()).clubs; }, () => { S.rc = []; }),
      kit.demo('clubs'),
    ]).then(reload);
  }
  return Promise.all([
    kit.json(kit.GROUPS_URL).then((j) => { S.groups = j && Array.isArray(j.groups) ? j.groups : []; }),
    kit.json(kit.RUN_CLUBS_URL).then((j) => { S.rc = j && Array.isArray(j.clubs) ? j.clubs : []; }),
    reload(),
  ]);
}
function reload() {
  return kit.listBoard('clubs', { kind: 'idea' }).then((r) => { S.r = r; S.ideas = r.posts; });
}

const size = (p) => Number((p.meta || {}).size) || 0;
const ready = (p) => size(p) && (Number(p.votes) || 0) >= size(p);
function ideaMeta(p) {
  const m = p.meta || {};
  const n = Number(p.votes) || 0;
  const count = !size(p) ? (n ? n + ' in' : '') : n >= size(p) ? n + ' in, ready to start' : n + ' in, ' + size(p) + ' to start';
  return [IDEA_KIND[m.kind] || '', m.days || '', count].filter(Boolean).join(' · ');
}

/* under an idea with enough people in: propose the first gathering */
function under(p) {
  if (!ready(p)) return null;
  const go = button(ICON.calendar + ' Propose the first gathering', 'pkey', () => firstGathering(p));
  go.type = 'button';
  go.dataset.first = p.id;
  const r = el('div', 'linkrow pp-under');
  r.appendChild(go);
  return r;
}

function firstGathering(p) {
  boards.compose({ board: 'gatherings', kind: 'gathering', heading: 'The first ' + p.title.replace(/^an? /i, ''), title: 'What it is', titlePlaceholder: p.title,
    fields: [
      { key: 'when', label: 'When', placeholder: kit.etDay(Date.now() + 7 * kit.DAY) + ', 7 pm' },
      { key: 'place', label: 'Where', placeholder: 'A café, a park, a back room' },
      { key: 'kind', label: 'What kind', type: 'enum', options: RULES.boards.gatherings.meta.kind.values.map((v) => [v, v === 'board-games' ? 'Board games' : v[0].toUpperCase() + v.slice(1)]) },
    ],
    body: 'Anything to know', notes: ['Shows once approved.'], cta: 'Send it' });
}

function ideaFeed(host, list, empty, withUnder) {
  if (S.r && !S.r.ok) { kit.boardNote(host, S.r); return; }
  if (!list.length) { host.appendChild(el('p', 'note pad', empty)); return; }
  kit.feed(host, list, { tab: KEY, meta: ideaMeta, vote: 'I’m in', after: withUnder ? (p) => under(p) : null });
}
function ideaButton(label, kinds) {
  return kit.postButton(label, { board: 'clubs', kind: 'idea', heading: label, title: 'What you’d start', titlePlaceholder: kinds.length === 1 ? 'A folk jam, Tuesday nights' : 'A Sunday morning sketch club',
    fields: [
      { key: 'kind', label: 'What kind', type: 'enum', options: kinds.map((k) => [k, IDEA_KIND[k]]) },
      { key: 'days', label: 'Which days', placeholder: 'Tuesday nights' },
      { key: 'size', label: 'How many to start', type: 'int', placeholder: '6' },
    ],
    body: kinds.length === 1 ? 'What you play' : 'What it would be like' });
}

/* the clubs page's list, one kind at a time */
function drawEvery(b) {
  const g = (S.groups || []).filter((x) => x && x.name && /^https?:/i.test(String(x.url || '')));
  if (!g.length) { b.appendChild(el('p', 'note pad', 'The clubs didn’t load.')); b.appendChild(kit.outRow('Every club on the clubs page', 'Leagues, pickup, books, games and more', kit.CLUBS_PAGE, 'clubs-page')); return; }
  const kinds = Object.keys(KIND_LABEL).map((k) => [k, g.filter((x) => x.kind === k).length]).filter(([, n]) => n);
  const row = chips([{ key: 'all', label: 'All', n: g.length }].concat(kinds.map(([k, n]) => ({ key: k, label: KIND_LABEL[k], n }))), S.kind, (k) => { S.kind = k; S.all = false; mode.redraw(); }, 'pad');
  row.dataset.kinds = '1';
  b.appendChild(row);
  const list = g.filter((x) => S.kind === 'all' || x.kind === S.kind);
  const shown = S.all ? list : list.slice(0, SHOWN);
  kit.rowList(b, shown.map((x) => {
    const m = (x.meets || [])[0];
    const when = m && m.day ? { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' }[m.day] : '';
    return kit.outRow(x.name, [KIND_LABEL[x.kind] || '', when, x.town && x.town !== 'Burlington' ? x.town : ''].filter(Boolean).join(' · '), x.url, 'club:' + x.id);
  })).dataset.every = S.kind;
  const r = el('div', 'linkrow chlinks');
  if (list.length > shown.length) r.appendChild(button('Show all ' + list.length, 'ghost sm', () => { S.all = true; mode.redraw(); }));
  r.appendChild(kit.linkBtn('Add your club', kit.CLUBS_PAGE + '#add', 'ghost sm'));
  b.appendChild(r);
}

function drawRun(b) {
  if (!S.rc || !S.rc.length) { b.appendChild(el('p', 'note pad', 'The run clubs didn’t load.')); return; }
  const now = Date.now();
  const week = cw.weekStrip(S.rc, now, (c) => /^https?:/i.test(String(c.url || '')) && cw.isRun(c)).map((d) => ({ ...d, meets: d.meets.filter((o) => !o.past) }));
  if (!week.some((d) => d.key === S.rcDay)) S.rcDay = (week.find((d) => d.meets.length) || week[0]).key;
  const days = el('div', 'days');
  week.forEach((d) => {
    const on = d.key === S.rcDay;
    const x = el('button', (on ? 'on' : '') + (d.meets.length ? '' : ' none'), '<span class="wd">' + esc(d.today ? 'Today' : d.wd) + '</span><span class="dd">' + esc(d.d) + '</span><span class="n">' + esc(d.meets.length || '') + '</span>');
    x.type = 'button';
    x.dataset.day = d.key;
    x.setAttribute('aria-pressed', on ? 'true' : 'false');
    x.addEventListener('click', () => { S.rcDay = d.key; mode.redraw(); });
    days.appendChild(x);
  });
  b.appendChild(days);
  const day = week.find((d) => d.key === S.rcDay);
  const list = el('div', 'meets');
  list.dataset.meets = day.key;
  /* the club's sheet is You's: one sheet, one "I'm going" */
  day.meets.forEach((o) => { const r = meetRow(o, (x) => app.go('people', x.k)); if (r) list.appendChild(r); });
  if (list.children.length) b.appendChild(list);
  else b.appendChild(el('p', 'note pad', day.today ? 'Nothing left today.' : 'Nothing this day.'));
}

const unstarted = () => S.ideas.filter((p) => !ready(p)).sort((a, c) => (Number(c.votes) || 0) - (Number(a.votes) || 0) || Date.parse(c.created_at) - Date.parse(a.created_at));
const music = () => S.ideas.filter((p) => (p.meta || {}).kind === 'music');

const mode = kit.tab({
  key: KEY, label: 'Clubs', icon: 'flag', boards: ['clubs'], votesCount: true,
  promise: 'Every club in town, and the ones still being started.',
  load, reload,
  posts: () => S.ideas,
  count: (ts) => kit.newer(S.ideas, ts),
  sections: [
    { key: 'every', label: 'Every club', draw: drawEvery },
    { key: 'run', label: 'Run clubs', draw: drawRun },
    { key: 'start', label: 'Start something', newest: () => kit.newest(S.ideas),
      draw(b) {
        b.appendChild(ideaButton('Start something', Object.keys(IDEA_KIND)));
        ideaFeed(b, S.ideas.slice().sort((a, c) => ready(c) - ready(a) || Date.parse(c.created_at) - Date.parse(a.created_at)), 'No ideas yet.', true);
      } },
    { key: 'wanted', label: 'Wanted', newest: () => kit.newest(unstarted()),
      draw(b) {
        ideaFeed(b, unstarted(), 'Nothing waiting.');
      } },
    { key: 'musicians', label: 'Musicians', newest: () => kit.newest(music()),
      draw(b) {
        b.appendChild(ideaButton('Find musicians', ['music']));
        ideaFeed(b, music(), 'No one looking yet.');
      } },
  ],
});
app.register(KEY, mode);
export const _peek = () => ({ ideas: S.ideas.map((p) => ({ title: p.title, votes: p.votes, size: size(p), ready: ready(p) })) });
