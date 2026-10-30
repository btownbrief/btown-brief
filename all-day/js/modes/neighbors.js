/* neighbors.js — People · Neighbors (wave 1, 2026-10-29; APP-MAP rows 24,
   25 and 27): the Neighbor Exchange, Lost & found and volunteer shifts,
   each a lane on its board kind (boards-core.js, wave 0), drawn with the
   shell's board cards and a post form carrying the board's rule in one line
   (DESIGN.md §10: no rules on the tab face).

   - Borrow, Free, Favor: the neighbors board's borrow, free and favor
     kinds. The vote is "I can help". `got` on a post marks it done (lent,
     given, home again) and it sinks to the end of its lane.
   - Lost & found: the lost and found kinds, pets and things. A post that
     names a place gets a Map pill (a map search for those words, so a
     poster says a corner or a landmark, never a home address).
   - Shifts: the shifts board, a nonprofit's slot of a few hours with its
     sign-up link. Stephen approves each one before it shows (the board is
     pre-moderated because of the link). The vote is "I'm going". The
     guide's volunteer page has the longer-term roles.
   Lanes run freshest first, like every top-tab pill. */

import * as app from '../app.js';
import { el, esc, button } from '../ui.js';
import * as boards from '../boards.js';
import { RULES } from '../boards-core.js';
import * as kit from './people-kit.js';

const KEY = 'neighbors';
const VOLUNTEER_PAGE = '../volunteer.html';
const WHAT = { pet: 'A pet', keys: 'Keys', phone: 'A phone', wallet: 'A wallet', bike: 'A bike', bag: 'A bag', other: 'Something else' };
const ORGS_URL = '../data/volunteers/orgs.json';   // the volunteer page's hand-checked directory
const ORGS_SHOWN = 5;
const S = { posts: [], r: null, shifts: [], rs: null, orgs: [], orgsAt: 0, allOrgs: false };

function load() {
  return Promise.all([
    app.demo ? kit.demo('neighbors') : null,
    kit.json(ORGS_URL).then((j) => {
      S.orgs = ((j && j.organizations) || []).filter((o) => o && o.org && /^https:\/\//.test(String(o.url || '')));
      S.orgsAt = Math.max(0, ...S.orgs.map((o) => Math.floor((Date.parse(o.last_checked) || 0) / 1000)));
    }),
  ]).then(reload);
}
function reload() {
  return Promise.all([
    kit.listBoard('neighbors').then((r) => { S.r = r; S.posts = r.posts; }),
    kit.listBoard('shifts', { kind: 'shift' }).then((r) => { S.rs = r; S.shifts = r.posts; }),
  ]);
}

const of = (...kinds) => S.posts.filter((p) => kinds.includes(p.kind)).sort((a, b) => !!(a.meta || {}).got - !!(b.meta || {}).got || Date.parse(b.created_at) - Date.parse(a.created_at));
const done = (p) => ((p.meta || {}).got ? (p.kind === 'borrow' ? 'Lent' : p.kind === 'free' ? 'Given' : p.kind === 'favor' ? 'Done' : 'Home again') : '');
function meta(p) {
  const m = p.meta || {};
  if (p.kind === 'lost' || p.kind === 'found') return [kit.kindWord(p.kind), WHAT[m.what] || '', m.seen ? 'Seen ' + m.seen : '', m.when || '', done(p)].filter(Boolean).join(' · ');
  return [m.item || '', m.when || '', done(p)].filter(Boolean).join(' · ');
}
const shiftMeta = (p) => { const m = p.meta || {}; return [m.org, m.when, m.hours ? m.hours + (m.hours === 1 ? ' hour' : ' hours') : '', m.slots ? m.slots + (m.slots === 1 ? ' spot' : ' spots') : ''].filter(Boolean).join(' · '); };

function lane(host, r, list, opts, empty) {
  if (r && !r.ok) { kit.boardNote(host, r); return; }
  if (!list.length) { host.appendChild(el('p', 'note pad', empty)); return; }
  kit.feed(host, list, { tab: KEY, ...opts });
}
const RULE = { borrow: 'To lend, never to rent.', free: 'Free means free. Nothing for sale.', favor: 'An hour or two, for free.',
  lost: 'A corner or a landmark, never your address.', found: 'A corner or a landmark, never your address.' };
/* the board's rule, one short line in the form, where it matters */
const post = (label, kind, o) => kit.postButton(label, { board: 'neighbors', kind, heading: label, notes: [RULE[kind]], ...o });
const whatOptions = RULES.boards.neighbors.meta.what.values.map((v) => [v, WHAT[v]]);

const mode = kit.tab({
  key: KEY, label: 'Neighbors', icon: 'hand', fresh: true, boards: ['neighbors', 'shifts'],
  promise: 'Borrow a ladder, give a couch, grab a two-hour shift.',
  load, reload,
  count: (ts) => kit.newer(S.posts.concat(S.shifts), ts),
  sections: [
    { key: 'borrow', label: 'Borrow', newest: () => kit.newest(of('borrow')),
      draw(b) {
        b.appendChild(post('Ask to borrow', 'borrow', { title: 'What you need', titlePlaceholder: 'A tall ladder for Saturday',
          fields: [{ key: 'item', label: 'The thing', placeholder: 'Extension ladder' }, { key: 'when', label: 'When', placeholder: 'This Saturday' }],
          place: 'Neighborhood', placePlaceholder: 'Old North End', body: 'Anything to know' }));
        lane(b, S.r, of('borrow'), { meta, vote: 'I can lend', after: doneButton }, 'Nothing asked for.');
      } },
    { key: 'free', label: 'Free', newest: () => kit.newest(of('free')),
      draw(b) {
        b.appendChild(post('Give something away', 'free', { title: 'What it is', titlePlaceholder: 'A couch, you carry it', place: 'Neighborhood', placePlaceholder: 'Winooski', body: 'Size, state, when to come' }));
        lane(b, S.r, of('free'), { meta, vote: 'I want it', ratio: 'r11', after: doneButton }, 'Nothing up for grabs.');
      } },
    { key: 'favor', label: 'Favor', newest: () => kit.newest(of('favor')),
      draw(b) {
        b.appendChild(post('Ask a favor', 'favor', { title: 'What you need', titlePlaceholder: 'An hour of help moving a dresser',
          fields: [{ key: 'when', label: 'When', placeholder: 'Sunday afternoon' }], place: 'Neighborhood', placePlaceholder: 'South End', body: 'How long it takes' }));
        lane(b, S.r, of('favor'), { meta, vote: 'I can help', after: doneButton }, 'No favors asked.');
      } },
    { key: 'lost', label: 'Lost & found', newest: () => kit.newest(of('lost', 'found')),
      draw(b) {
        const fields = [{ key: 'what', label: 'What', type: 'enum', options: whatOptions }, { key: 'seen', label: 'Where it was last seen', placeholder: 'North Ave by the school' },
          { key: 'when', label: 'When', placeholder: 'Tuesday evening' }];
        const r = el('div', 'linkrow chlinks');
        [post('I lost something', 'lost', { title: 'What you lost', titlePlaceholder: 'Grey cat, white socks', fields, place: 'A place for the map', placePlaceholder: 'A corner or a landmark', body: 'How to know it' }),
          post('I found something', 'found', { title: 'What you found', titlePlaceholder: 'Keys on a red lanyard', fields, place: 'A place for the map', placePlaceholder: 'A corner or a landmark', body: 'Ask them to describe it' })]
          .forEach((x) => { if (x.firstChild) r.appendChild(x.firstChild); });
        b.appendChild(r);
        lane(b, S.r, of('lost', 'found'), { meta, map: true, vote: 'I’ll look', ratio: 'r11', after: doneButton }, 'Nothing lost or found.');
      } },
    { key: 'shifts', label: 'Shifts', newest: () => Math.max(kit.newest(S.shifts), S.orgsAt),
      draw(b) {
        b.appendChild(kit.postButton('Post a shift', { board: 'shifts', kind: 'shift', heading: 'A volunteer shift', title: 'What the shift is', titlePlaceholder: 'Two hours sorting at the food shelf',
          fields: [{ key: 'org', label: 'The nonprofit', placeholder: 'The food shelf' }, { key: 'when', label: 'When', placeholder: kit.etDay(Date.now() + 3 * kit.DAY) + ', 9 am' },
            { key: 'hours', label: 'Hours', type: 'int', placeholder: '2' }, { key: 'slots', label: 'People needed', type: 'int', placeholder: '6' },
            { key: 'link', label: 'Sign-up link', type: 'url', placeholder: 'https://' }],
          place: 'Where', body: 'What to bring', notes: ['Nonprofits only. Shows once approved.'] }));
        if (S.shifts.length || !S.orgs.length || (S.rs && !S.rs.ok)) lane(b, S.rs, S.shifts, { meta: shiftMeta, vote: 'I’m going', after: (p) => ((p.meta || {}).link ? signUp(p.meta.link) : null) }, 'No shifts this week.');
        if (!S.orgs.length) return;
        /* where to volunteer any week: the volunteer page's own list */
        b.appendChild(el('p', 'subh pad', '<b>Where to volunteer</b>'));
        const shown = S.allOrgs ? S.orgs : S.orgs.slice(0, ORGS_SHOWN);
        kit.rowList(b, shown.map((o) => kit.outRow(o.org, (o.categories || []).join(' · '), o.url, 'vo:' + o.org.toLowerCase().replace(/[^a-z0-9]+/g, '-')))).dataset.orgs = '1';
        const r = el('div', 'linkrow chlinks');
        if (shown.length < S.orgs.length) r.appendChild(button('Show all ' + S.orgs.length, 'ghost sm', () => { S.allOrgs = true; mode.redraw(); }));
        r.appendChild(kit.linkBtn('The volunteer page', VOLUNTEER_PAGE, 'ghost sm'));
        b.appendChild(r);
      } },
  ],
});
/* your own post: mark it lent, given, done or home again, and undo it
   (boards.put, round two's nn_post_meta_set; the board's change event reloads) */
const DONE_WORD = { borrow: 'Mark it lent', free: 'Mark it given', favor: 'Mark it done', lost: 'Mark it home again', found: 'Mark it home again' };
function doneButton(p, it) {
  if (!it.mine) return null;
  const got = !!(p.meta || {}).got;
  const r = el('div', 'linkrow pp-done');
  const b = button(esc(got ? 'Undo' : DONE_WORD[p.kind] || 'Mark it done'), 'ghost sm', () => {
    b.disabled = true;
    boards.put(p.id, { got: got ? null : true }).then((x) => { if (!x.ok) { b.disabled = false; app.toast(x.message); } });
  });
  b.type = 'button';
  b.dataset.done = p.id;
  r.appendChild(b);
  return r;
}
function signUp(href) {
  const r = el('div', 'linkrow pp-signup');
  r.appendChild(kit.linkBtn('Sign up', href, 'ghost sm'));
  return r;
}
app.register(KEY, mode);
export const _peek = () => ({ kinds: S.posts.map((p) => p.kind + ':' + p.title), shifts: S.shifts.map((p) => p.title) });
