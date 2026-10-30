/* out-events.js — Out · Events (wave 1, 2026-10-29; APP-MAP.html rows 1 and 43).

   Every upcoming event in Burlington, lane by lane: This weekend first, then
   the lanes the Out data lane sorts events into (data/out/events-lanes.json,
   by scripts/out/lanes.py), then the online side (events you watch from a
   screen, and Been there: the shows readers saw), then Submit.

   - Stephen's own events (his Meetup group, Btown Brief, Coffee Club) are
     pinned: at the top of This weekend whatever day they fall in the next
     week, and first in any lane they belong to (newsletter/AGENTS.md, "Stephen's
     OWN events are never missed").
   - Each event is the shell's event card: the date tile, when, where, the
     cost as the listing gives it (never a guessed "Free"), the link to its
     own page. An event with no link is never drawn.
   - Been there: an event that has started carries a "Been there" button. One
     tap logs it as a `logged` post on the `stage` board (boards-core.js),
     with its venue and date and nothing else to fill in. "Log a show" opens
     the full form for anything not listed.
   - Submit opens the reader form the data lane specified
     (data/out/submit-event-spec.json, 17 fields). It checks what it can on
     the phone and sends nothing: the queue behind it is not built yet, and
     the form says so.

   The data is data/out/app-events.json, the next two weeks of the lane file
   with only what a card shows (scripts/out/build_out_app.py). On ?demo=1 it
   is data/demo/out-events.json: invented events dated by days from today. */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { el, esc, button } from '../ui.js';
import { outMode, readJSON, timing, etNow, addDays, dowOf, domOf, dateWords, clock, demoDay, now, buttons, linkButton } from './out-common.js';

const FILE = '../data/out/app-events.json';
const SPEC = '../data/out/submit-event-spec.json';
const FULL = '../events.html';
/* the lanes, in the order the map gives them, with the pill's short words */
const LANES = [
  ['live-music', 'Live music'], ['open-mic', 'Open mics'], ['gallery', 'Galleries'], ['free', 'Free'], ['family', 'Family'],
  ['outdoors', 'Outdoors'], ['civic', 'Civic'], ['nightlife', 'Nightlife'],
];
const PER_LANE = 15;
const PER_DAY = 10;

/* a listing's own words for the cost, short enough for the card. Never "Free" unless it says so. */
function cost(e) {
  let p = String(e.price || '').trim().replace(/\.$/, '');
  if (!p) return e.free ? 'Free' : 'Cost on the listing';
  if (p.length > 40) p = p.slice(0, 38).replace(/[\s,;:]+\S*$/, '') + '…';
  return p;
}

function card(e, today, nowMs) {
  const t = timing(e, nowMs);
  /* an exhibit that runs for weeks shows on today, not on the day it opened */
  const day = t.lastDay && e.date < today ? today : e.date;
  const when = t.lastDay && t.lastDay > e.date ? 'Through ' + dateWords(t.lastDay) : e.allDay || !clock(e.start) ? 'All day' : clock(e.start);
  return {
    k: 'ev-' + e.id, kind: 'event', src: e.src || 'Listing', sid: 'out-' + (e.src || 'listing'), own: !!e.own, title: e.title, href: e.url,
    dow: dowOf(day), dom: domOf(day), when, where: [e.venue, e.town].filter(Boolean).join(', ') || 'Where it is: on the listing', price: cost(e),
    cta: t.started ? 'Been there' : null, act: t.started ? 'outbeen' : null, ev: { venue: e.venue || e.town || 'Burlington', day: e.date > today ? today : day },
  };
}

/* the coming weekend: Friday to Sunday, or what is left of this one */
function weekend(today) {
  const dow = dowOf(today);
  const toFri = { Mon: 4, Tue: 3, Wed: 2, Thu: 1 }[dow];
  const first = toFri == null ? today : addDays(today, toFri);
  const last = addDays(today, { Fri: 2, Sat: 1, Sun: 0 }[dow] ?? toFri + 2);
  return [first, last];
}

/* the demo file's events are dated by days from today */
function undemo(j) {
  return { ...j, events: (j.events || []).map((e) => {
    const date = demoDay(e.in);
    const start = date + 'T' + (e.at || '12:00') + ':00-04:00';
    return { ...e, date, start, end: e.hours ? new Date(Date.parse(start) + e.hours * 3600000).toISOString() : null,
      until: e.days ? demoDay(Number(e.in) + e.days) : null };
  }) };
}

function stageItem(p) {
  const m = p.meta || {};
  return boards.item(p, { tab: 'events', meta: () => [m.venue, m.date, m.stars ? '★'.repeat(m.stars) : ''].filter(Boolean).join(' · ') });
}

let mod = null;

async function load(demo) {
  const [raw, stage] = await Promise.all([readJSON(FILE, 'out-events.json'), boards.list('stage', { kind: 'logged', limit: 20 })]);
  const data = demo ? undemo(raw) : raw;
  const nowMs = Date.now();
  const today = etNow(nowMs).day;
  const live = (data.events || []).filter((e) => e && e.url && e.title && !timing(e, nowMs).over);
  const ownFirst = (list) => list.filter((e) => e.own).concat(list.filter((e) => !e.own));
  const cardsOf = (list) => list.map((e) => card(e, today, nowMs));
  const more = (n, what) => (box) => { if (n > 0) buttons(box, [linkButton(n + ' more ' + what + ' on the events page', FULL)]); };

  /* This weekend: Stephen's own events of the coming week pinned on top, then up to ten a day */
  const [fri, sun] = weekend(today);
  const pinned = live.filter((e) => e.own && e.date <= addDays(today, 7));
  const days = [];
  for (let d = fri; d <= sun; d = addDays(d, 1)) days.push(d);
  let left = 0;
  const wk = days.flatMap((d) => {
    const on = live.filter((e) => e.date === d && !e.own && !e.until && !e.online);
    /* the listings with a lane read better than the long tail of library hours */
    const ranked = on.filter((e) => e.lanes.some((l) => l !== 'free')).concat(on.filter((e) => !e.lanes.some((l) => l !== 'free')));
    left += Math.max(0, ranked.length - PER_DAY);
    return ranked.slice(0, PER_DAY);
  });
  const secs = [{
    key: 'weekend', label: 'This weekend', world: 'irl',
    sub: (dowOf(fri) === dowOf(today) ? 'Today' : dateWords(fri)) + ' to ' + dateWords(sun) + (pinned.length ? '. The Brief’s own events first.' : ''),
    items: cardsOf(pinned.concat(wk)), draw: more(left, 'this weekend'), empty: 'Nothing listed for the weekend yet.',
  }];

  LANES.forEach(([lane, label]) => {
    const inLane = ownFirst(live.filter((e) => e.lanes.includes(lane) && !e.online));
    secs.push({ key: lane, label, world: 'irl', items: cardsOf(inLane.slice(0, PER_LANE)), draw: more(inLane.length - PER_LANE, label.toLowerCase()),
      empty: 'Nothing in ' + label.toLowerCase() + ' for the next two weeks.' });
  });

  const online = live.filter((e) => e.online);
  secs.push({ key: 'online', label: 'Online', short: 'Online', world: 'online', sub: 'Talks and classes you join from a screen.', items: cardsOf(online.slice(0, PER_LANE)),
    empty: 'No online events listed for the next two weeks.' });

  const posts = stage.ok ? stage.posts : [];
  const logged = posts.map(stageItem);
  secs.push({
    key: 'been', label: 'Been there', world: 'online', sub: 'Shows and plays readers saw. Tap Been there on an event that has started, or log one here.',
    newest: logged.length ? Math.max(...logged.map((it) => it.created)) : undefined,
    items: logged,
    draw(box) {
      if (!logged.length) box.appendChild(el('p', 'note pad', esc(stage.ok ? 'Nobody has logged a show yet. Be the first.' : 'Been there opens once the boards are switched on.')));
      buttons(box, [button('Log a show you saw', 'sm', () => logShow())]);
    },
  });

  secs.push({
    key: 'submit', label: 'Submit an event', short: 'Submit', sub: 'Putting something on? Send it in. Every event needs a link to its own page.',
    draw(box) { buttons(box, [button('Submit an event', 'sm', () => submitSheet())]); },
  });
  return secs;
}

/* ------------------------------------------------------------ Been there */
app.onAct('outbeen', (it) => logIt(it));
function logIt(it) {
  const ev = it.ev || {};
  boards.create('stage', { kind: 'logged', title: String(it.title).slice(0, 80), meta: { venue: String(ev.venue).slice(0, 60), date: ev.day } }).then((r) => {
    if (r.ok) { app.toast('Logged. It’s in Been there.'); if (mod) mod.reload(); return; }
    if (r.error === 'no_name') { nameFirst(it); return; }
    app.toast(r.error === 'not_signed_in' ? 'Sign in to log it.' : r.message);
  });
}
/* the first post of a reader with no name yet: the name, then the log */
function nameFirst(it) {
  app.sheet('Your first name', (body, card, close) => {
    body.appendChild(el('p', 'sheet-note', esc('Been there shows it under your first name. Neighbors see it, nothing else.')));
    const f = el('form', 'bform');
    const row = el('div', 'bf-row');
    const inp = el('input', 'field bf-in');
    inp.name = 'display_name'; inp.maxLength = 32; inp.placeholder = 'Maya, or Maya R.'; inp.setAttribute('aria-label', 'Your first name');
    const msg = el('p', 'bf-msg');
    const go = button('Log it', '');
    go.type = 'submit';
    const foot = el('div', 'bf-go');
    foot.append(go, msg);
    row.appendChild(inp);
    f.append(row, foot);
    body.appendChild(f);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      boards.setProfile({ display_name: inp.value }).then((r) => {
        if (!r.ok) { msg.textContent = r.message; msg.classList.add('err'); return; }
        close();
        logIt(it);
      });
    });
  });
}

function logShow() {
  boards.compose({
    board: 'stage', kind: 'logged', heading: 'Log a show you saw', title: 'What you saw', titlePlaceholder: 'The late set at Radio Bean',
    fields: [
      { key: 'venue', label: 'Where', type: 'text', max: 60, placeholder: 'The Flynn' },
      { key: 'date', label: 'When', type: 'text', max: 20, placeholder: etNow().day, hint: 'The day you went, like ' + etNow().day + '.' },
      { key: 'what', label: 'What it was', type: 'enum', options: [['show', 'A show'], ['play', 'A play'], ['comedy', 'Comedy'], ['film', 'A film'], ['talk', 'A talk'], ['game', 'A game'], ['other', 'Something else']] },
      { key: 'stars', label: 'Stars, one to five', type: 'int', placeholder: '4' },
    ],
    body: 'A line about it', bodyPlaceholder: 'The second act is the one.',
    notes: ['Kept for good, under your first name.'],
    cta: 'Log it',
    onPosted: () => { if (mod) mod.reload(); },
  });
}

/* ---------------------------------------------------------------- Submit */
const HTTPS = /^https:\/\/[^\s/$.?#][^\s]*\.[^\s]+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let specP = null;
const spec = () => (specP = specP || fetch(SPEC).then((r) => r.json()));

function control(f, id) {
  let c;
  if (f.type === 'select' || f.type === 'select+text') {
    c = el('select', 'field bf-in');
    [['', 'Choose one']].concat((f.options || []).map((o) => [o, o.charAt(0).toUpperCase() + o.slice(1)])).forEach(([v, l]) => {
      const o = el('option', null, esc(l)); o.value = v; c.appendChild(o);
    });
  } else if (f.type === 'multiselect') {
    c = el('div', 'chips');
    (f.options || []).forEach((o) => {
      const lab = el('label', 'chip', '<input type="checkbox" name="' + esc(f.key) + '" value="' + esc(o) + '"> <span>' + esc(o.replace(/-/g, ' ')) + '</span>');
      c.appendChild(lab);
    });
    return c;
  } else if (f.type === 'textarea') {
    c = el('textarea', 'field bf-in');
  } else {
    c = el('input', 'field bf-in');
    c.type = { url: 'url', email: 'email', 'datetime-local': 'datetime-local', image: 'file' }[f.type] || 'text';
    if (f.type === 'image') c.accept = 'image/*';
  }
  c.name = f.key;
  c.id = id;
  if (f.max) c.maxLength = f.max;
  return c;
}

function submitSheet() {
  app.sheet('Submit an event', (body) => {
    const wait = el('p', 'loading', 'One moment…');
    body.appendChild(wait);
    spec().then((s) => {
      wait.remove();
      body.appendChild(el('p', 'bf-note', esc('Every event needs a link to its own page. No link, no listing.')));
      const f = el('form', 'bform');
      f.noValidate = true;
      s.fields.forEach((fd, i) => {
        const id = 'oes' + i;
        const row = el('div', 'bf-row');
        const lab = el('label', 'bf-label', esc(fd.label) + (fd.required ? '' : ' <span class="bf-opt">' + (fd.required_if ? 'sometimes needed' : 'optional') + '</span>'));
        lab.htmlFor = id;
        row.appendChild(lab);
        row.appendChild(control(fd, id));
        const hint = fd.help || (fd.key === 'url' ? 'The event’s own page, starting https.' : fd.key === 'price' ? 'Never assumed free: pick what the listing says.' : fd.privacy || '');
        if (hint) row.appendChild(el('p', 'bf-hint', esc(hint)));
        if (fd.type === 'select+text') {
          const extra = el('input', 'field bf-in');
          extra.type = 'text'; extra.name = fd.key + '_text'; extra.placeholder = 'The price, like $15'; extra.maxLength = 40;
          row.appendChild(extra);
        }
        f.appendChild(row);
      });
      f.appendChild(el('p', 'bf-note', esc('Nothing is shown until Stephen checks it. A ticketed event from an organizer we don’t know also needs one page they don’t control.')));
      const msg = el('p', 'bf-msg');
      msg.setAttribute('role', 'status');
      const go = button('Check and send', '');
      go.type = 'submit';
      const row = el('div', 'bf-go');
      row.append(go, msg);
      f.appendChild(row);
      body.appendChild(f);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        const val = (k) => String(fd.get(k) || '').trim();
        const miss = s.fields.filter((x) => x.required && x.type !== 'multiselect' && !val(x.key)).map((x) => x.label);
        const ticketed = /ticketed/i.test(val('price'));
        if (ticketed && !val('ticket_url')) miss.push('Ticket link');
        const bad = [];
        if (val('url') && !HTTPS.test(val('url'))) bad.push('The event’s link needs to start with https://');
        ['ticket_url', 'independent_source_url'].forEach((k) => { if (val(k) && !HTTPS.test(val(k))) bad.push('Links need to start with https://'); });
        if (val('contact_email') && !EMAIL.test(val('contact_email'))) bad.push('That email doesn’t look right.');
        if (val('start') && Date.parse(val('start')) < Date.now()) bad.push('The start is in the past.');
        if (/^paid/i.test(val('price')) && !val('price_text')) bad.push('Add the price.');
        msg.classList.toggle('err', !!(miss.length || bad.length));
        if (!val('url')) { msg.textContent = 'Every event needs a link to its own page.' + (miss.length > 1 ? ' Also missing: ' + miss.filter((m) => !/Link to the event/.test(m)).join(', ') + '.' : ''); return; }
        if (miss.length) { msg.textContent = 'Still needed: ' + miss.join(', ') + '.'; return; }
        if (bad.length) { msg.textContent = [...new Set(bad)].join(' '); return; }
        msg.textContent = 'It all checks out. Submissions open soon: this form doesn’t send anything yet, so nothing you typed left your phone.';
      });
    }).catch(() => { wait.textContent = 'The form didn’t load. Try again in a moment.'; });
  });
}

mod = outMode({ key: 'events', label: 'Events', icon: 'calendar', mixed: true,
  promise: 'Every show, open mic and gallery night, lane by lane.', load });
app.register('events', mod);

/* for the tests */
export const _cost = cost;
export const _weekend = weekend;
export const _now = now;
