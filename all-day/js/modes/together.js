/* together.js — Body · Together (wave 1, 2026-10-29).

   - Run clubs and Fitness this week: the clubs' week from
     data/run-clubs.json through clubs-week.js, drawn with the same meet
     row People and What Now use. A meet opens its club in People, which
     has the sheet and "I'm going".
   - Work out and Recover: readers' sessions on the sports board (kind
     session, the one wave 0 added for Out's pickup games and this tab),
     split by what they are: a workout, run, ride or climb here; yoga and
     recovery under Recover. "I'm in" is the board's vote, painted as a
     count of who is going, the way People paints its plans. A session
     lasts two days.
   - Adult Social Sports: the Meetup group's link, and that it is
     relaunching (data/body/together.json). */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { el, esc, ICON, button, cards, meetRow } from '../ui.js';
import * as cw from '../clubs-week.js';
import { page, data, para, bullets, ext, links, section, plural, shortDay } from './body-kit.js';

const KEY = 'together';
const BOARD = 'sports';
const SPORT = { workout: 'Workout', run: 'Run', ride: 'Ride', climb: 'Climb', yoga: 'Yoga', recovery: 'Recovery' };
const LEVEL = { easy: 'Easy pace', any: 'Any level', competitive: 'Pushing it' };
const S = { day: { run: null, fit: null }, posts: null, failed: null };

const usable = (c) => !!c && /^https?:/i.test(String(c.url || ''));
const runClub = (c) => usable(c) && cw.isRun(c);
const fitClub = (c) => usable(c) && cw.isFitness(c);

/* ------------------------------------------------------------- the clubs */
function drawWeek(box, ctx, kind) {
  const run = kind === 'run';
  section(box, run ? 'Run clubs this week' : 'Fitness this week', esc(run ? 'Group runs, free and open' : 'Rides, hikes, climbs, paddles and pickup'));
  if (!ctx.clubs) { para(box, 'The clubs didn’t load.'); return; }
  const week = cw.weekStrip(ctx.clubs, Date.now(), run ? runClub : fitClub).map((d) => ({ ...d, meets: d.meets.filter((o) => !o.past) }));
  if (!week.some((d) => d.key === S.day[kind])) S.day[kind] = (week.find((d) => d.meets.length) || week[0]).key;
  const days = el('div', 'days');
  days.dataset.week = kind;
  week.forEach((d) => {
    const on = d.key === S.day[kind];
    const b = el('button', (on ? 'on' : '') + (d.meets.length ? '' : ' none'),
      '<span class="wd">' + esc(d.today ? 'Today' : d.wd) + '</span><span class="dd">' + esc(d.d) + '</span><span class="n">' + esc(d.meets.length || '') + '</span>');
    b.type = 'button';
    b.dataset.day = d.key;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', (d.today ? 'Today' : d.wd) + ' ' + d.d + ': ' + plural(d.meets.length, 'meet', 'meets'));
    b.addEventListener('click', () => { S.day[kind] = d.key; ctx.redraw(run ? 'runs' : 'fitness'); });
    days.appendChild(b);
  });
  box.appendChild(days);
  const day = week.find((d) => d.key === S.day[kind]);
  const list = el('div', 'meets');
  list.dataset.meets = day.key;
  /* People has the club's sheet and I'm going: a meet opens there */
  day.meets.forEach((o) => { const r = meetRow(o, (x) => app.go('people', x.k)); if (r) list.appendChild(r); });
  if (list.children.length) box.appendChild(list);
  else para(box, day.today ? 'Nothing left today.' : 'Nothing this day.', 'note');
}

/* --------------------------------------------------------- the sessions */
function load() {
  S.failed = null;
  return boards.list(BOARD, { kind: 'session', limit: 60 }).then((r) => {
    if (!r.ok) { S.posts = []; S.failed = r.message || 'The sessions didn’t load.'; return; }
    S.posts = r.posts.filter((p) => p && p.meta && SPORT[p.meta.sport]);
  });
}
const goingWords = (n) => (Number(n) > 0 ? n + ' going' : 'Be the first');
function sessionCard(p) {
  const m = p.meta || {};
  const it = boards.item(p, { tab: KEY, meta: () => [SPORT[m.sport], m.when, m.where, m.spots ? plural(Number(m.spots), 'spot', 'spots') : '', LEVEL[m.level] || ''].filter(Boolean).join(' · ') });
  it.left = null;   // a session ends when it happens; its "when" says so
  app.know([it]);
  const node = cards.board(it);
  if (!node) return null;
  node.dataset.session = p.id;
  const b = node.querySelector('[data-act="bvote"]');
  if (b) {
    b.setAttribute('aria-label', 'I’m in');
    b.innerHTML = ICON.check + '<span>I’m in</span><span class="n" hidden>' + esc(it.votes || '') + '</span>';
    b.after(el('span', 'going', esc(goingWords(it.votes))));
  }
  return node;
}
/* boards.js repaints the hidden count; the going words follow it */
const watched = new WeakSet();
function watchGoing(host) {
  if (watched.has(host) || !('MutationObserver' in window)) return;
  watched.add(host);
  new MutationObserver(() => host.querySelectorAll('.card.board').forEach((c) => {
    const n = c.querySelector('[data-act="bvote"] .n'), g = c.querySelector('.going');
    const want = goingWords(n ? Number(n.textContent) || 0 : 0);
    if (g && g.textContent !== want) g.textContent = want;
  })).observe(host, { subtree: true, childList: true, characterData: true });
}
function compose(kind) {
  const sports = kind === 'work' ? ['workout', 'run', 'ride', 'climb'] : ['yoga', 'recovery'];
  boards.compose({
    board: BOARD, kind: 'session', heading: kind === 'work' ? 'Post a workout' : 'Post a recovery session',
    title: 'What', titlePlaceholder: kind === 'work' ? 'Leg day at the Y, come along' : 'Sauna and a lake dip after work',
    fields: [
      { key: 'sport', label: 'What kind', type: 'enum', options: sports.map((s) => [s, SPORT[s]]), required: true },
      { key: 'where', label: 'Where', placeholder: kind === 'work' ? 'Greater Burlington YMCA' : 'Savu Sauna, the waterfront', max: 60, required: true },
      { key: 'when', label: 'When', placeholder: 'Tomorrow, 6 pm', max: 60, required: true },
      { key: 'spots', label: 'Spots', type: 'int', placeholder: '4', hint: 'Leave it empty for no limit.' },
      { key: 'level', label: 'Pace', type: 'enum', options: Object.entries(LEVEL) },
    ],
    body: 'More', bodyPlaceholder: 'What to bring, where to meet',
    notes: ['Up for two days. Others tap I’m in, and you see how many are coming.'],
    cta: 'Post it',
  });
}
function drawSessions(box, ctx, kind) {
  const work = kind === 'work';
  const want = work ? ctx.t.work_out_sports : ctx.t.recover_sports;
  section(box, work ? 'Work out' : 'Recover', esc(work ? 'Who is going where, and when' : 'Sauna, yoga and stretch, together'));
  if (S.posts == null) { box.appendChild(el('p', 'loading', 'One moment…')); return; }
  const list = S.posts.filter((p) => want.includes(p.meta.sport));
  const feed = el('div', 'feed');
  feed.dataset.sessions = kind;
  list.forEach((p) => { const n = sessionCard(p); if (n) feed.appendChild(n); });
  box.appendChild(feed);
  app.bindFeed(feed);
  watchGoing(feed);
  if (S.failed) para(box, S.failed, 'note');
  else if (!list.length) para(box, work ? 'Nobody has posted a workout yet. Be the first: say where and when.' : 'No recovery sessions yet. Post one and see who comes.');
  links(box, [button(ICON.plus + (work ? ' Post a workout' : ' Post a recovery session'), '', () => compose(kind))]);
}

/* -------------------------------------------------- Adult Social Sports */
function drawASS(box, t) {
  const a = t.adult_social_sports;
  section(box, 'Adult Social Sports', esc(a.members.toLocaleString('en-US') + ' members on Meetup'));
  para(box, a.line);
  const card = bullets(box, [a.status, 'Join on Meetup now and you’ll hear when the first events are posted.']);
  card.dataset.ass = 'relaunching';
  links(box, [ext('Join the group', a.url, 'btn')]);
  para(box, 'Checked on Meetup on ' + shortDay(a.checked) + '.', 'note');
}

/* -------------------------------------------------------------- the tab */
let ctxRef = null;
window.addEventListener('allday-boards', (e) => {
  const d = (e && e.detail) || {};
  if (!ctxRef || !(d.board === BOARD || d.what === 'delete' || d.what === 'hidden' || d.what === 'deleteme')) return;
  load().then(() => { ctxRef.redraw('work'); ctxRef.redraw('recover'); app.recount(); });
});
app.onAuth(() => { if (ctxRef) load().then(() => { ctxRef.redraw('work'); ctxRef.redraw('recover'); }); });

app.register(KEY, page({
  key: KEY, label: 'Together', icon: 'people',
  promise: 'Workouts and recovery with others, this week.',
  sections: [['runs', 'Run clubs'], ['fitness', 'Fitness this week'], ['work', 'Work out'], ['recover', 'Recover'], ['ass', 'Adult Social Sports']],
  load: () => Promise.all([
    data('together.json'),
    (app.demo ? app.demoData('run-clubs').then((j) => cw.redateDemo(j, Date.now())) : fetch('../data/run-clubs.json').then((r) => r.json())).then((j) => j.clubs, () => null),
    load(),
  ]).then(([t, clubs]) => (ctxRef = { t, clubs })),
  draw(k, box, ctx) {
    if (k === 'runs') drawWeek(box, ctx, 'run');
    else if (k === 'fitness') drawWeek(box, ctx, 'fit');
    else if (k === 'work') drawSessions(box, ctx, 'work');
    else if (k === 'recover') drawSessions(box, ctx, 'recover');
    else if (k === 'ass') drawASS(box, ctx.t);
  },
  /* the bar's dot: sessions posted since the last visit */
  newSince(ts, ctx) {
    const base = (Number(ts) || 0) * 1000;
    const want = ctx.t ? ctx.t.work_out_sports.concat(ctx.t.recover_sports) : [];
    return (S.posts || []).filter((p) => want.includes(p.meta.sport) && Date.parse(p.created_at) > base).length;
  },
}));
