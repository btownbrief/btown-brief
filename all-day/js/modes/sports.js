/* sports.js — Out · Sports (wave 1, 2026-10-29; APP-MAP.html rows 18, 28 and 37).

   From data/out/sports.json (the Out data lane: every record has its source
   page and the day it was checked):
   - Pickup: readers' "anyone at the courts at 6?" posts on the `sports`
     board (kind session, two days), then the drop-in spots with their
     hours, cost and day pass, the Brief's own Wednesday basketball pinned.
   - Leagues: sign-ups, soonest first, each with its sign-up link.
   - Game day: UVM's and the high schools' home games, by date.
   - Adult Social Sports: Stephen's 1,960-member Meetup group, quiet since
     June 2025, and the formats it ran, for the relaunch.

   Unknowns stay unknown: a spot with no posted hours says so, a league with
   no date says to check its page. On ?demo=1 the file is
   data/demo/out-sports.json, invented, dated by days from today. */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { el, esc, button } from '../ui.js';
import { outMode, readJSON, isDay, etNow, dowOf, domOf, dateWords, clock, demoDay, buttons } from './outkit.js';

const OURS = 'btown-brief-wednesday-pickup';
const SPORTS = ['basketball', 'soccer', 'volleyball', 'tennis', 'pickleball', 'frisbee', 'hockey', 'run', 'ride', 'climb', 'workout', 'yoga', 'recovery', 'other'];
const FIRST = 20;
const open = { pickup: false, leagues: false };
let mod = null;

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/[\s,;:]+\S*$/, '') + '…' : s; };
/* '2:00pm' or '7:00 PM' -> '2 pm' */
const time = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*([ap])m/i); return m ? clock((Number(m[1]) % 12 + (/p/i.test(m[3]) ? 12 : 0)) + ':' + m[2]) : ''; };

function sessionItem(p) {
  const m = p.meta || {};
  return boards.item(p, { tab: 'sports', meta: () => [cap(m.sport), m.where, m.when, m.spots ? m.spots + ' spots' : '', m.level === 'easy' ? 'easy pace' : m.level === 'competitive' ? 'competitive' : '']
    .filter(Boolean).join(' · ') });
}

function spotItem(p) {
  const pass = p.day_pass && p.day_pass.price ? 'Day pass ' + p.day_pass.price + (p.day_pass.where ? ' at the ' + p.day_pass.where : '') : '';
  return {
    k: 'pk-' + p.id, kind: 'post', src: p.venue || p.town || 'Pickup', sid: 'out-pk-' + p.id, own: p.id === OURS, title: p.name,
    text: [p.hours ? p.hours : 'Hours on their site', p.cost, pass, p.door === 'just show up' ? 'Just show up' : ''].filter(Boolean).map((x) => String(x).replace(/\.+$/, '')).join('. ') + '.',
    href: p.id === OURS && p.rsvp_url ? p.rsvp_url : p.source_url,
  };
}

function leagueItem(l, today) {
  /* a month alone ('2026-10') is not a day to print */
  const by = isDay(l.registration_deadline) && l.registration_deadline >= today ? 'Sign up by ' + dateWords(l.registration_deadline)
    : isDay(l.registration_opens) && l.registration_opens > today ? 'Sign-up opens ' + dateWords(l.registration_opens) : '';
  const starts = isDay(l.season_start) ? (l.season_start >= today ? 'Starts ' : 'Started ') + dateWords(l.season_start) : '';
  return {
    k: 'lg-' + l.id, kind: 'post', src: l.organizer || 'League', sid: 'out-lg-' + (l.organizer || l.id), title: l.name,
    text: [by, starts, [l.venue, l.town].filter(Boolean).join(', '), l.cost].filter(Boolean).join(' · ') || short(l.season_note, 140) || 'Dates on their page.',
    href: l.signup_url || l.source_url, sort: by ? 0 : starts && l.season_start >= today ? 1 : 2, when: l.registration_deadline || l.season_start || '9999',
  };
}

function gameItem(g) {
  return {
    k: 'gd-' + g.key, kind: 'event', src: g.src, sid: 'out-gd-' + g.src, title: g.title, href: g.url,
    dow: dowOf(g.date), dom: domOf(g.date), when: time(g.time) || 'Time on the schedule', where: g.venue || 'Home', price: g.tickets ? 'Tickets on the page' : 'Details on the page',
  };
}

/* every game with a date: UVM's teams and the high schools, home games only, from today */
function games(s, today) {
  const out = [];
  ((s.uvm || {}).teams || []).forEach((t) => (t.home_games || []).forEach((g, i) => out.push({
    key: 'uvm-' + t.sport + '-' + g.date + '-' + i, src: 'UVM Athletics', title: 'UVM ' + t.team + ' vs ' + String(g.opponent || '').replace(/\s+-\s+.*$/, ''),
    date: g.date, time: g.time, venue: g.venue, url: g.url || t.schedule_url, tickets: !!t.tickets_url })));
  (((s.high_school || {}).schools) || []).forEach((sc) => (sc.upcoming_home_games || []).forEach((g, i) => out.push({
    key: sc.school.replace(/\W+/g, '-').toLowerCase() + '-' + g.date + '-' + i, src: sc.school.replace(/ High School$| HS$/, ''),
    title: (g.level && g.level !== 'varsity' ? cap(g.level) + ' ' : '') + g.sport + ' vs ' + String(g.opponent || '').replace(/ HS$/, ''),
    date: g.date, time: g.time, url: g.url || sc.schedule_source,
    /* the game's own venue; a school's only venue when it has just one; otherwise the schedule says */
    venue: short(g.venue ? g.venue.replace(new RegExp('^(' + sc.school + '\\s*)+'), '') : sc.home_venues && sc.home_venues.length === 1 ? sc.home_venues[0].name : '', 60) || 'Venue on the schedule' })));
  return out.filter((g) => g.date >= today && g.url).sort((a, b) => a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)));
}

/* the demo dates its games and leagues by days from today */
function undemo(s) {
  const d = (x) => (x == null ? null : demoDay(x));
  const fix = (g) => ({ ...g, date: d(g.in) });
  return {
    ...s,
    uvm: { teams: (s.uvm.teams || []).map((t) => ({ ...t, home_games: (t.home_games || []).map(fix) })) },
    high_school: { schools: (s.high_school.schools || []).map((sc) => ({ ...sc, upcoming_home_games: (sc.upcoming_home_games || []).map(fix) })) },
    leagues: (s.leagues || []).map((l) => ({ ...l, registration_deadline: d(l.deadline_in), season_start: d(l.start_in) })),
  };
}

async function load(demo) {
  const [raw, sess] = await Promise.all([readJSON('../data/out/sports.json', 'out-sports.json'), boards.list('sports', { kind: 'session', limit: 30 })]);
  const s = demo ? undemo(raw) : raw;
  const today = etNow().day;

  /* Pickup: who's playing, then the spots, ours first */
  const playing = (sess.ok ? sess.posts : []).map(sessionItem);
  const spots = (s.pickup || []).slice().sort((a, b) => (b.id === OURS) - (a.id === OURS)).map(spotItem).filter((it) => it.href);
  const secs = [{
    key: 'pickup', label: 'Pickup',
    newest: playing.length ? Math.max(...playing.map((it) => it.created)) : undefined,
    items: playing.concat(open.pickup ? spots : spots.slice(0, FIRST)),
    draw(box, list) {
      const head = el('p', 'note pad', esc(playing.length ? '' : sess.ok ? 'No games posted yet.' : 'Opens soon.'));
      if (!playing.length) box.insertBefore(head, list);
      buttons(box, [button('Post a game', 'sm', () => postSession()),
        !open.pickup && spots.length > FIRST ? button('All ' + spots.length + ' spots', 'ghost sm', () => { open.pickup = true; mod.reload(); }) : null]);
    },
  }];

  /* Leagues: sign-up deadlines first, then the seasons about to start */
  const leagues = (s.leagues || []).map((l) => leagueItem(l, today)).filter((it) => it.href).sort((a, b) => a.sort - b.sort || a.when.localeCompare(b.when));
  secs.push({
    key: 'leagues', label: 'Leagues',
    items: open.leagues ? leagues : leagues.slice(0, FIRST),
    draw(box) { if (!open.leagues && leagues.length > FIRST) buttons(box, [button('All ' + leagues.length + ' leagues', 'ghost sm', () => { open.leagues = true; mod.reload(); })]); },
    empty: 'No sign-ups listed.',
  });

  /* Game day */
  const g = games(s, today);
  secs.push({ key: 'gameday', label: 'Game day', items: g.slice(0, 24).map(gameItem), empty: 'No home games listed.' });

  /* Adult Social Sports */
  const m = s.adult_social_sports_meetup || {};
  const ass = [];
  if (m.url) {
    ass.push({ k: 'ass-group', kind: 'post', src: 'Meetup', sid: 'out-ass', own: true, title: m.group_name || 'Burlington Adult Social Sports', href: m.url,
      text: [m.member_count ? m.member_count.toLocaleString('en-US') + ' members' : '', m.status === 'dormant' ? 'Relaunching soon' : ''].filter(Boolean).join(' · ') });
  }
  (m.past_event_formats || []).forEach((f, i) => {
    if (!f.source_url) return;
    ass.push({ k: 'ass-' + i, kind: 'post', src: 'Past league', sid: 'out-ass-past', title: f.format, href: f.source_url,
      text: [f.typical_day_time, f.count_seen ? f.count_seen + ' times, ' + f.years : f.years].filter(Boolean).join('. ') });
  });
  secs.push({ key: 'ass', label: 'Adult Social Sports', items: ass });
  return secs;
}

function postSession() {
  boards.compose({
    board: 'sports', kind: 'session', heading: 'Anyone want to play?', title: 'What’s the game', titlePlaceholder: 'Anyone at the courts at 6?',
    fields: [
      { key: 'sport', label: 'Sport', type: 'enum', options: SPORTS.map((x) => [x, cap(x)]) },
      { key: 'where', label: 'Where', type: 'text', max: 60, placeholder: 'Leddy Park courts' },
      { key: 'when', label: 'When', type: 'text', max: 60, placeholder: 'Today, 6 pm' },
      { key: 'spots', label: 'Players needed', type: 'int', placeholder: '4' },
      { key: 'level', label: 'Level', type: 'enum', options: [['easy', 'Easy'], ['any', 'Any'], ['competitive', 'Competitive']] },
    ],
    body: 'Anything else', bodyPlaceholder: 'Bring a light and a dark shirt.',
    notes: ['Gone after two days.'],
    cta: 'Post it',
    onPosted: () => { if (mod) mod.reload(); },
  });
}

mod = outMode({ key: 'sports', label: 'Sports', icon: 'ball', promise: 'Pickup games, leagues and game day, in one place.', load });
app.register('sports', mod);
