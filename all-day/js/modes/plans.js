/* plans.js — People · Plans (wave 1, 2026-10-29): the people board's
   plans, open to strangers, under four top tabs.

   - Open to strangers: every plan still to come, soonest first (a plan
     whose `when` can't be read sits at the end, newest first).
   - This week: the ones in the next seven days.
   - Mine: your own plans (boards.mine), signed in.
   - Down for Meetup: the plans whose poster ticked "post it on Meetup".

   The same board the You tab (people.js) draws its "Open to strangers"
   section from, and the one Out's Nightlife reads. A plan's `when` is read
   with people.js's own whenMs(), so both tabs agree on what has passed.
   "I'd go" is the board's vote. Posting goes through boards.compose: what,
   when, spots and an age band (the band only once the server's rules are
   round two's; never on a profile). The Meetup box needs the You tab's own
   composer, which boards.compose has no field for, so the post sheet says
   where to find it. */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { el, button } from '../ui.js';
import { whenMs, PEOPLE_RULES } from './people.js';
import * as kit from './people-kit.js';

const KEY = 'plans';
const PAST_GRACE = 3 * 3600000;
const AGES = { twenties: 'Mostly 20s', thirties: 'Mostly 30s', forties: 'Mostly 40s', fifties: '50 and up', any: 'Any age' };
const S = { posts: [], r: null, mine: null, round2: false };

const at = (p) => whenMs((p.meta || {}).when, Date.parse(p.created_at));
const upcoming = () => S.posts.map((p) => ({ p, at: at(p) })).filter((x) => x.at == null || x.at > Date.now() - PAST_GRACE)
  .sort((a, b) => (a.at == null) - (b.at == null) || (a.at || 0) - (b.at || 0) || Date.parse(b.p.created_at) - Date.parse(a.p.created_at));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const meta = (p) => { const m = p.meta || {}; return [m.when, m.spots ? plural(m.spots, 'spot', 'spots') : '', AGES[m.ages] || '', m.meetup ? 'Down for Meetup' : ''].filter(Boolean).join(' · '); };

function load() {
  return Promise.all([
    app.demo ? kit.demo('plans') : null,
    boards.roundTwo().then((v) => { S.round2 = v !== false; }),
  ]).then(reload);
}
function reload() {
  return Promise.all([
    kit.listBoard('people', { kind: 'plan' }).then((r) => { S.r = r; S.posts = r.posts; }),
    app.user() ? boards.mine().then((r) => { S.mine = r.ok ? r.posts.filter((p) => p.board === 'people' && p.status !== 'deleted') : []; }) : (S.mine = null),
  ]);
}

function plans(host, list, empty) {
  if (S.r && !S.r.ok) { kit.boardNote(host, S.r); return; }
  if (!list.length) { host.appendChild(el('p', 'note pad', empty)); return; }
  kit.feed(host, list, { tab: KEY, meta, noLeft: true, vote: 'I’d go' });
}

function compose() {
  const fields = [
    { key: 'when', label: 'When', placeholder: 'Saturday, 10 am', hint: 'A day and a time: “Thursday, 7 pm”.' },
    { key: 'spots', label: 'Spots', type: 'int', placeholder: '4' },
  ];
  if (S.round2) fields.push({ key: 'ages', label: 'Rough age band', type: 'enum', options: PEOPLE_RULES.ages.map((a) => [a, AGES[a]]), hint: 'On the plan only, never on your profile.' });
  return kit.postButton('Post a plan', { board: 'people', kind: 'plan', heading: 'A plan, open to strangers', title: 'What’s the plan', titlePlaceholder: 'Trivia at Three Needs, need a fifth',
    fields, place: 'Where', placePlaceholder: 'A bar, a park, a corner', body: 'Anything to know',
    notes: ['Meet somewhere public. To put it on Meetup too, post it from the You tab.'] }, () => reload().then(mode.redraw));
}

const mode = kit.tab({
  key: KEY, label: 'Plans', icon: 'calendar', boards: ['people'],
  promise: 'Plans open to strangers this week, with room for you.',
  load, reload,
  count: (ts) => kit.newer(S.posts, ts),
  sections: [
    { key: 'open', label: 'Open to strangers', newest: () => kit.newest(S.posts),
      draw(b) {
        b.appendChild(compose());
        plans(b, upcoming().map((x) => x.p), 'No plans up yet. Post the first one.');
      } },
    { key: 'week', label: 'This week', newest: () => kit.newest(S.posts),
      draw(b) {
        const end = Date.now() + 7 * kit.DAY;
        plans(b, upcoming().filter((x) => x.at != null && x.at < end).map((x) => x.p), 'Nothing dated this week yet.');
      } },
    { key: 'mine', label: 'Mine', newest: () => 0,
      draw(b) {
        if (!app.user()) {
          kit.textCard(b, null, ['Sign in to see the plans you posted, and who said they’d go.'], [button('Sign in', '', () => app.openSettings())], 'signin');
          return;
        }
        if (!S.mine) { b.appendChild(el('p', 'loading', 'One moment…')); return; }
        if (!S.mine.length) { b.appendChild(el('p', 'note pad', 'You haven’t posted a plan yet.')); return; }
        kit.feed(b, S.mine, { tab: KEY, meta, noLeft: true, vote: 'I’d go' });
      } },
    { key: 'meetup', label: 'Down for Meetup', newest: () => kit.newest(S.posts.filter((p) => p.meta && p.meta.meetup)),
      draw(b) {
        plans(b, upcoming().filter((x) => x.p.meta && x.p.meta.meetup).map((x) => x.p), 'No one has asked for Meetup this week.');
        b.appendChild(kit.outRow('The Btown Brief Meetup group', 'Where these land once Stephen posts them.', kit.MEETUP_GROUP, 'meetup-group'));
      } },
  ],
});
app.onAuth(() => reload().then(mode.redraw));
app.register(KEY, mode);
export const _peek = () => ({ posts: S.posts.map((p) => p.title), mine: S.mine && S.mine.map((p) => p.title) });
