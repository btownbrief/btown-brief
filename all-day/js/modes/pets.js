/* pets.js — People · Pets (wave 1, 2026-10-29; APP-MAP row 34 and the
   Pets line of the People table).

   - Dog parks: data/dating-pets.json's parks, checked by hand: the town,
     one line, the town's rules page and the park on the map.
   - Meetups: the calendar's pet events (people-match.js's petEvent: never
     a hot dog or a kids' story hour), readers' dog park plans on the people
     board (people-match.js's PETS words) and a button to post one.
   - Lost: the neighbors board's lost and found pets (Neighbors · Lost &
     found, the pets only), with the map, a button to post one, and the
     shelter.
   - Vets: not built. No vet list exists yet in the Town or Body data
     (checked on apps/town-data and apps/body-content, 2026-10-29), so it
     names what will come, and points at the guide that already lists the
     two 24-hour emergency vets. */

import * as app from '../app.js';
import { el, esc, safeHref, mark } from '../ui.js';
import { PETS, petEvent } from '../people-match.js';
import { whenMs } from './people.js';
import * as kit from './people-kit.js';

const KEY = 'pets';
const DOG_GUIDE = '../things-to-do.html';
const PAST_GRACE = 3 * 3600000;
const S = { dp: null, events: null, plans: [], rp: null, lost: [], rl: null };

function load() {
  return Promise.all([
    app.demo ? kit.demo('pets').then((d) => d.events || []) : null,
    kit.datingPets().then((j) => { S.dp = j; }),
  ]).then(([demoEvents]) => Promise.all([kit.events(demoEvents, (e) => { S.events = e; mode.redraw(); }).then((e) => { S.events = e; }), reload()]));
}
function reload() {
  return Promise.all([
    kit.listBoard('people', { kind: 'plan' }).then((r) => { S.rp = r; S.plans = r.posts; }),
    kit.listBoard('neighbors').then((r) => { S.rl = r; S.lost = r.posts.filter((p) => (p.kind === 'lost' || p.kind === 'found') && (p.meta || {}).what === 'pet'); }),
  ]);
}
const words = (p) => [p.title, p.body, p.place].filter(Boolean).join(' ');
const petPlans = () => S.plans.filter((p) => PETS.test(words(p))).filter((p) => { const at = whenMs((p.meta || {}).when, Date.parse(p.created_at)); return at == null || at > Date.now() - PAST_GRACE; });
const lostMeta = (p) => { const m = p.meta || {}; return [kit.kindWord(p.kind), m.seen ? 'Seen ' + m.seen : '', m.when || '', m.got ? 'Home again' : ''].filter(Boolean).join(' · '); };

function parkRow(x) {
  const r = el('div', 'lrow');
  r.dataset.k = 'park-' + x.id;
  const a = el('a', 'open', '<div class="t">' + esc(x.name) + '</div><div class="s">' + esc([x.town, x.where, x.line].filter(Boolean).join(' · ')) + '</div>');
  a.href = safeHref(x.url);
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', x.name + ': the town’s rules');
  const pin = kit.mapPill(x.name, x.lat, x.lng).firstChild;
  r.append(el('span', null, mark(x.name, 'round lg')), a, pin);
  return r;
}

const mode = kit.tab({
  key: KEY, label: 'Pets', icon: 'paw', boards: ['people', 'neighbors'],
  promise: 'Dog-park meetups, lost pets and vets you can afford.',
  load, reload,
  posts: () => S.plans.concat(S.lost),
  count: (ts) => kit.newer(petPlans().concat(S.lost), ts),
  sections: [
    { key: 'parks', label: 'Dog parks',
      draw(b) {
        const parks = S.dp ? (S.dp.pets.parks || []).filter((x) => x && x.name && /^https:\/\//.test(String(x.url || ''))) : [];
        if (!parks.length) { b.appendChild(el('p', 'note pad', 'Didn’t load.')); return; }
        kit.rowList(b, parks.map(parkRow)).dataset.parks = '1';
      } },
    { key: 'meetups', label: 'Meetups', newest: () => kit.newest(petPlans()),
      draw(b) {
        b.appendChild(kit.postButton('Post a dog park plan', { board: 'people', kind: 'plan', heading: 'A dog park plan', title: 'What’s the plan', titlePlaceholder: 'Dog park hang, bring your pup',
          fields: [{ key: 'when', label: 'When', placeholder: 'Saturday, 9 am' }, { key: 'spots', label: 'Spots', type: 'int', placeholder: '5' }],
          place: 'Which park', placePlaceholder: 'Starr Farm Dog Park', body: 'Anything to know', notes: ['Say “dog” in the title.'] }));
        const plans = petPlans();
        if (plans.length) kit.feed(b, plans, { tab: KEY, noLeft: true, vote: 'I’d go', meta: (p) => [(p.meta || {}).when, (p.meta || {}).spots ? p.meta.spots + ' spots' : ''].filter(Boolean).join(' · ') });
        else if (S.rp && !S.rp.ok) kit.boardNote(b, S.rp);
        b.appendChild(el('p', 'subh pad', '<b>On the calendar</b>'));
        if (S.events === null) { b.appendChild(el('p', 'note pad', 'Didn’t load.')); return; }
        kit.eventList(b, kit.eventItems(S.events, petEvent, 'pt-'), 'Nothing in the next two weeks.');
      } },
    { key: 'lost', label: 'Lost', newest: () => kit.newest(S.lost),
      draw(b) {
        const fields = [{ key: 'what', label: 'What', type: 'enum', options: [['pet', 'A pet']] }, { key: 'seen', label: 'Where they were last seen', placeholder: 'Starr Farm Road by the park' },
          { key: 'when', label: 'When', placeholder: 'This morning' }];
        const r = el('div', 'linkrow chlinks');
        [kit.postButton('Lost a pet', { board: 'neighbors', kind: 'lost', heading: 'A lost pet', title: 'Who they are', titlePlaceholder: 'Grey cat, white socks, answers to Moss', fields,
          place: 'A place for the map', placePlaceholder: 'A corner or a landmark', body: 'How to know them', notes: ['A corner or a landmark, never your address.'] }),
        kit.postButton('Found a pet', { board: 'neighbors', kind: 'found', heading: 'A found pet', title: 'Who you found', titlePlaceholder: 'Small brown dog, no collar', fields,
          place: 'A place for the map', placePlaceholder: 'A corner or a landmark', body: 'Where they are now', notes: ['A corner or a landmark, never your address.'] })].forEach((x) => { if (x.firstChild) r.appendChild(x.firstChild); });
        b.appendChild(r);
        if (S.rl && !S.rl.ok) kit.boardNote(b, S.rl);
        else if (!S.lost.length) b.appendChild(el('p', 'note pad', 'No lost pets.'));
        else kit.feed(b, S.lost, { tab: KEY, meta: lostMeta, map: true, vote: 'I’ll look', ratio: 'r11' });
        const help = S.dp ? (S.dp.pets.help || []).filter((h) => h && h.name && /^https:\/\//.test(String(h.url || ''))) : [];
        if (help.length) kit.rowList(b, help.map((h) => kit.outRow(h.name, h.line, h.url, 'ph:' + h.id)));
      } },
    { key: 'vets', label: 'Vets',
      draw(b) {
        kit.soon(b, 'Vets you can afford', ['Checkup and vaccine prices, low-cost clinics, help with a bill.'], 'vets');
        b.appendChild(kit.outRow('Emergency vets', 'In Burlington With Your Dog', DOG_GUIDE, 'dog-guide'));
      } },
  ],
});
app.register(KEY, mode);
export const _peek = () => ({ plans: petPlans().map((p) => p.title), lost: S.lost.map((p) => p.title) });
