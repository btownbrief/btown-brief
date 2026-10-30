/* nightlife.js — Out · Nightlife (wave 1, 2026-10-29; APP-MAP.html row 37 and the memo's
   "nightlife by age" and "happy-hour mixers").

   Three sections, all about tonight and this week:
   - Open tonight: readers' "my group is out tonight and has room" posts on
     the `nightlife` board (kind open_tonight, boards-core.js): where, until
     when, how many spots, a rough age band. A post lasts a day. The form is
     the boards' own compose sheet, by the board's rules: a place, never a
     home address, and nothing shows a reader's email.
   - Happy hours: today's happy hours from data/deals.json (the list Eat's
     Food tab reads), soonest first, "on now" while one runs. A deal with no
     page of its own links to Eat's happy-hour list.
   - Mixers: this week's events from the Events data that are mixers or
     socials by name, then the evening nightlife lane.

   Nightlife does not mix doing and reading: everything here is a place to
   be tonight, so it has no Real life / Online switch (wave 0 had put one on
   while it was a placeholder). Dinner nights and By age, on the map, wait
   for the dinner club and for enough posts to sort by age. */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { el, esc, button } from '../ui.js';
import { outMode, readJSON, timing, etNow, addDays, dowOf, domOf, clock, demoDay, buttons } from './outkit.js';

const AGES = [['twenties', '20s'], ['thirties', '30s'], ['forties', '40s'], ['fifties', '50s and up'], ['any', 'Any age']];
const AGE_WORD = Object.fromEntries(AGES);
const MIXER = /\b(mixer|mingle|singles|speed[- ]dating|social hour|meet ?up|networking|trivia|game night|karaoke|dance party|happy hour)\b/i;
const STRONG = /\b(mixer|mingle|singles|speed[- ]dating)\b/i;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const toMin = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function openItem(p) {
  const m = p.meta || {};
  return boards.item(p, { tab: 'nightlife', meta: () => [m.where, m.until ? 'until ' + m.until : '', m.spots ? m.spots + (m.spots === 1 ? ' spot' : ' spots') : '', AGE_WORD[m.ages] || '']
    .filter(Boolean).join(' · ') });
}

function hhItem(d, nowMin) {
  const a = toMin(d.start), b = toMin(d.end);
  const on = a != null && b != null && nowMin >= a && nowMin < b;
  const when = d.all_day ? 'All day today' : a != null ? clock(d.start) + (b != null ? ' to ' + clock(d.end) : '') + ' today' : 'Today';
  return {
    k: 'hh-' + d.id, kind: 'post', src: d.business, sid: 'out-hh-' + (d.restaurant_id || d.id), title: d.title, live: on,
    text: when,
    href: d.link || '#food/hh', start: a == null ? 9999 : a,
  };
}

function mixerItem(e, today) {
  return {
    k: 'mx-' + e.id, kind: 'event', src: e.src || 'Listing', sid: 'out-' + (e.src || 'listing'), own: !!e.own, title: e.title, href: e.url,
    dow: dowOf(e.date), dom: domOf(e.date), when: clock(e.start) || 'All day', where: [e.venue, e.town].filter(Boolean).join(', ') || 'Where it is: on the listing',
    price: String(e.price || '').replace(/\.$/, '').slice(0, 40) || (e.free ? 'Free' : ''),
  };
}

let mod = null;

async function load(demo) {
  const [deals, evs, open] = await Promise.all([
    readJSON('../data/deals.json', 'out-deals.json'),
    readJSON('../data/out/app-events.json', 'out-events.json'),
    boards.list('nightlife', { kind: 'open_tonight', limit: 30 }),
  ]);
  const t = etNow();
  const nowMin = t.hour * 60 + t.minute;
  const dayKey = DAY_KEYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(t.dow)];

  /* Open tonight */
  const posts = open.ok ? open.posts : [];
  const opens = posts.map(openItem);
  /* a section shows when it has something, or something to do: Open tonight
     once the board answers, Happy hours while one is left today */
  const secs = [];
  if (open.ok) secs.push({
    key: 'open', label: 'Open tonight',
    newest: opens.length ? Math.max(...opens.map((it) => it.created)) : undefined, items: opens,
    draw(box) {
      if (!opens.length) box.appendChild(el('p', 'note pad', esc('No groups out yet.')));
      buttons(box, [button('My group is out tonight', 'sm', () => postGroup())]);
    },
  });

  /* Happy hours, today */
  const hh = (deals.deals || []).filter((d) => d.type === 'happy-hour' && (d.days || []).includes(dayKey) && (toMin(d.end) == null || toMin(d.end) > nowMin))
    .map((d) => hhItem(d, nowMin)).sort((a, b) => a.start - b.start);
  if (hh.length) secs.push({ key: 'happy', label: 'Happy hours', items: hh });

  /* Mixers, this week */
  const data = demo ? { events: (evs.events || []).map((e) => ({ ...e, date: demoDay(e.in), start: demoDay(e.in) + 'T' + (e.at || '19:00') + ':00-04:00' })) } : evs;
  const week = addDays(t.day, 7);
  const soon = (data.events || []).filter((e) => e.url && e.date >= t.day && e.date <= week && !e.online && !timing(e).over);
  const hourOf = (e) => Number(String(e.start).slice(11, 13)) || 0;
  /* a coffee meetup at 9 am is not a night out; a mixer is, whenever it starts */
  const named = soon.filter((e) => MIXER.test(e.title) && (hourOf(e) >= 16 || STRONG.test(e.title)));
  const evening = soon.filter((e) => !named.includes(e) && e.lanes && e.lanes.includes('nightlife') && hourOf(e) >= 17);
  const mixers = named.concat(evening).slice(0, 15).sort((a, b) => String(a.start).localeCompare(String(b.start))).map((e) => mixerItem(e, t.day));
  secs.push({ key: 'mixers', label: 'Mixers', items: mixers, empty: 'None this week.' });
  return secs;
}

function postGroup() {
  boards.compose({
    board: 'nightlife', kind: 'open_tonight', heading: 'My group is out tonight', title: 'What you’re up to', titlePlaceholder: 'Four of us at a brewery, room for two',
    fields: [
      { key: 'where', label: 'Where', type: 'text', max: 60, placeholder: 'A brewery on Pine St' },
      { key: 'until', label: 'Until about', type: 'text', max: 20, placeholder: '11 pm' },
      { key: 'spots', label: 'Room for how many', type: 'int', placeholder: '2' },
      { key: 'ages', label: 'Rough age of the group', type: 'enum', options: AGES },
    ],
    body: 'Anything else', bodyPlaceholder: 'We’re at the big table in the back.',
    notes: ['Gone after a day. A bar or a block, never a home address.'],
    cta: 'Post it',
    onPosted: () => { if (mod) mod.reload(); },
  });
}

mod = outMode({ key: 'nightlife', label: 'Nightlife', icon: 'moon', promise: 'Whose group is out tonight, and where to join them.', load });
app.register('nightlife', mod);
