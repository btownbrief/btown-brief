/* Dinner Club (Eat, wave 1, 2026-10-29). Btown Bites is Stephen's dinner
   group for 21 to 35 year olds, at tables of six; every dinner is posted on
   Meetup first, and the RSVP there is the ticket.

   - Next dinner. The soonest upcoming event on Stephen's Meetup calendar
     (Up For It's copy of the group's iCal, the feed People reads) whose
     title says Btown Bites or dinner, else data/eat/dinners.json's `next`:
     the day, the time, the place, and the RSVP. None: one line and the
     group.
   - Sign up. The short matching form: a first name, an age band, the nights
     that work, anything you don't eat. There is no private board for it in
     the shell yet, so it opens the reader's email to btownbrief@gmail.com
     with the answers written out; nothing is stored here.
   - Past dinners. data/eat/dinners.json, newest first: the day, the place,
     the Meetup event and the edition that announced it; photos as a shelf
     once a dinner has any.
   - Host a table / Restaurants. One line and an email button each.

   ?demo=1 reads data/demo/eat-dinner.json (its dinners dated from the
   reader's now). Keys are d-<…>; #dinner/<section> and #dinner/<key> land. */

import * as app from '../app.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, art, section, listRail, pills } from '../ui.js';
import { sectionBar } from '../sections.js';

const KEY = 'dinner';
const MEETUP_FEED = 'https://play.btownbrief.com/up-for-it/data/meetup.json';
const DINNERS_URL = '../data/eat/dinners.json';
const MEETUP_GROUP = 'https://www.meetup.com/burlington-social-activites-group/';
const DEMO_FILE = 'data/demo/eat-dinner.json';
const MAIL = 'btownbrief@gmail.com';
const TZ = 'America/New_York';
const DINNER = /btown bites|dinner/i;
const SECTIONS = [['next', 'Next dinner'], ['signup', 'Sign up'], ['past', 'Past dinners'], ['host', 'Host a table'], ['restaurants', 'Restaurants']];
const AGES = [['21-25', '21–25'], ['26-30', '26–30'], ['31-35', '31–35']];
const NIGHTS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['sun', 'Sun']];

const S = { root: null, slots: null, pending: null, ready: false, next: null, failed: false, past: [], group: MEETUP_GROUP };

/* "Thursday, November 5" and "7 pm", in Burlington's clock */
const dayWords = (ms) => new Date(ms).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
function timeWords(ms) {
  const t = new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  return t.replace(':00', '').replace(/\s?([AP])M$/i, (m0, ap) => ' ' + ap.toLowerCase() + 'm');
}
/* a YYYY-MM-DD and HH:MM in Burlington as epoch ms (EDT or EST, read off the date) */
function btvMs(ymd, hhmm) {
  const guess = Date.parse(ymd + 'T' + (hhmm || '19:00') + ':00Z');
  const h = Number(new Date(guess).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }));
  return guess + ((Number(String(hhmm || '19:00').slice(0, 2)) - h + 24) % 24) * 3600000;
}
function outLink(label, href, cls) {
  const a = el('a', cls || 'btn ghost sm', esc(label) + ' ' + ICON.ext);
  a.href = safeHref(href);
  a.target = '_blank'; a.rel = 'noopener';
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast(label + ' opens in the real build'); });
  return a;
}
const mailLink = (label, subject) => {
  const a = el('a', 'btn ghost sm', ICON.mail + ' ' + esc(label));
  a.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject);
  a.dataset.mail = subject;
  return a;
};

/* ----------------------------------------------------------------- data */
function nextDinner(events) {
  const now = Date.now();
  return (Array.isArray(events) ? events : [])
    .filter((e) => e && DINNER.test(String(e.title || '')) && /^https?:/i.test(String(e.url || '')) && Date.parse(e.starts_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] || null;
}
const pastOf = (list) => (Array.isArray(list) ? list : []).filter((p) => p && p.id && p.title && Number.isFinite(p.ms)).sort((a, b) => b.ms - a.ms);
function load() {
  if (app.demo) {
    return app.demoJSON(DEMO_FILE).then((d) => {
      const at = (days, hhmm) => {
        const t = new Date(Date.now() + days * 86400000);
        const [h, m] = String(hhmm || '19:00').split(':').map(Number);
        t.setHours(h, m || 0, 0, 0);
        return t.getTime();
      };
      const n = d.next;
      S.next = n ? { title: n.title, url: n.url, location: n.location, starts_at: new Date(at(n.days_from_now, n.time)).toISOString() } : null;
      S.past = pastOf((d.past || []).map((p) => ({ ...p, ms: at(p.days_from_now, p.time) })));
      if (d.group) S.group = d.group;
    }).catch(() => { S.failed = true; });
  }
  const feed = data.fetchJSON(MEETUP_FEED, 8000).then((j) => nextDinner(j && j.events)).catch(() => { S.failed = true; return null; });
  const file = data.fetchJSON(DINNERS_URL, 8000).catch(() => null);
  return Promise.all([feed, file]).then(([n, d]) => {
    if (d && d.group) S.group = d.group;
    const own = d && d.next && d.next.date && Date.parse(d.next.date) > Date.now() - 86400000 ? {
      title: d.next.title, url: d.next.meetup_url || S.group, location: [d.next.place, d.next.address].filter(Boolean).join(', '),
      starts_at: new Date(btvMs(d.next.date, d.next.time)).toISOString() } : null;
    S.next = n || own;
    if (n || own) S.failed = false;
    S.past = pastOf(((d && d.past) || []).map((p) => ({ ...p, ms: btvMs(p.date, p.time) })));
  });
}

/* ---------------------------------------------------------------- pages */
function paintNext(box) {
  section(box, 'Next dinner');
  const n = S.next;
  const tc = el('div', 'textcard');
  if (!n) {
    tc.dataset.k = 'd-next-none';
    tc.innerHTML = '<h3 class="serif">' + esc(S.failed ? 'Didn’t load.' : 'No dinner on the calendar yet.') + '</h3>';
    const row = el('div', 'row');
    row.appendChild(outLink('Btown Bites on Meetup', S.group, 'btn sm'));
    tc.appendChild(row);
    box.appendChild(tc);
    return;
  }
  const ms = Date.parse(n.starts_at);
  tc.dataset.k = 'd-next';
  tc.innerHTML = '<h3 class="serif">' + esc(n.title) + '</h3>' +
    '<p><b>' + esc(dayWords(ms)) + '</b> · ' + esc(timeWords(ms)) + '</p>' +
    (n.location ? '<p>' + ICON.pin + ' ' + esc(n.location) + '</p>' : '');
  const row = el('div', 'row');
  const go = outLink('RSVP on Meetup', n.url, 'btn');
  go.dataset.signup = '1';
  row.appendChild(go);
  tc.appendChild(row);
  box.appendChild(tc);
}

/* The matching form: four answers, sent as an email the reader can read
   before it goes. Nothing is stored or sent from here. */
function paintSignup(box) {
  section(box, 'Sign up');
  const tc = el('div', 'textcard');
  tc.dataset.k = 'd-signup';
  const f = el('form', 'dinnerform');
  f.noValidate = true;
  f.innerHTML = '<p>' + esc('Ages 21 to 35, tables of six.') + '</p>' +
    '<div class="row"><input class="field" name="name" maxlength="40" placeholder="' + esc('First name') + '" aria-label="First name" autocomplete="given-name"></div>' +
    '<div class="row ages"></div><div class="row nights"></div>' +
    '<div class="row"><input class="field" name="skip" maxlength="80" placeholder="' + esc('Anything you don’t eat?') + '" aria-label="Anything you don’t eat" autocomplete="off"></div>' +
    '<div class="row"><button type="submit" class="btn send">' + esc('Count me in') + '</button></div>' +
    '<p class="note err" role="alert" hidden></p>';
  const pick = { age: '', nights: new Set() };
  const ages = pills(AGES, '', (v) => { pick.age = v; });
  ages.setAttribute('role', 'group');
  ages.setAttribute('aria-label', 'Age');
  f.querySelector('.ages').appendChild(ages);
  const nights = el('div', 'pills nightpick');
  nights.setAttribute('role', 'group');
  nights.setAttribute('aria-label', 'Nights that work');
  NIGHTS.forEach(([v, label]) => {
    const b = el('button', '', esc(label));
    b.type = 'button';
    b.dataset.night = v;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const on = !pick.nights.has(v);
      if (on) pick.nights.add(v); else pick.nights.delete(v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    nights.appendChild(b);
  });
  f.querySelector('.nights').appendChild(nights);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = f.querySelector('.err');
    const say = (m) => { err.textContent = m; err.hidden = !m; };
    const name = String(new FormData(f).get('name') || '').trim();
    const skip = String(new FormData(f).get('skip') || '').trim();
    if (!name) return say('Add your first name.');
    if (!pick.age) return say('Pick your age.');
    if (!pick.nights.size) return say('Pick a night or two.');
    say('');
    const href = signupMail({ name, age: pick.age, nights: NIGHTS.filter(([v]) => pick.nights.has(v)).map(([, l]) => l), skip });
    f.dataset.mail = href;
    if (app.demo) { app.toast('Demo: nothing was sent.'); return; }
    location.href = href;
  });
  tc.appendChild(f);
  box.appendChild(tc);
}
export function signupMail(a) {
  const body = ['Name: ' + a.name, 'Age: ' + a.age, 'Nights: ' + a.nights.join(', '), 'Doesn’t eat: ' + (a.skip || 'nothing')].join('\n');
  return 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Btown Bites: count me in') + '&body=' + encodeURIComponent(body);
}

function paintPast(box) {
  section(box, 'Past dinners');
  if (!S.past.length) { box.appendChild(el('p', 'note pad', esc('The first one is coming.'))); return; }
  const photos = S.past.flatMap((p) => (p.photos || []).filter(Boolean).map((u, i) => ({ p, u, i })));
  if (photos.length) {
    const r = listRail(box, { name: 'dinner-past', label: 'Past dinners', cells: 160 });
    photos.forEach(({ p, u, i }) => {
      const a = el('a', 'vcard w180');
      a.dataset.k = 'd-photo-' + p.id + '-' + i;
      a.href = '#' + KEY + '/d-past-' + p.id;
      a.innerHTML = '<span class="c-media r45">' + art(u) + '</span><span class="t">' + esc(p.place || p.title) + '</span><span class="s">' + esc(shortDay(p.ms)) + '</span>';
      a.addEventListener('click', (e) => { e.preventDefault(); app.lightbox({ media: u, title: p.title, text: p.title }); });
      r.appendChild(a);
    });
  }
  const list = el('div', 'places');
  S.past.forEach((p) => {
    const row = el('div', 'lrow meet');
    row.dataset.k = 'd-past-' + p.id;
    const [mon, day] = shortDay(p.ms).split(' ');
    const body = el('div', 'open', '<div class="t">' + esc(p.place || p.title) + '</div><div class="s">' + esc([dayWords(p.ms), p.seats ? p.seats + ' at the table' : ''].filter(Boolean).join(' · ')) + '</div>');
    const links = el('div', 'linkrow');
    if (p.meetup_url) links.appendChild(outLink('Meetup', p.meetup_url, 'pillbtn'));
    if (p.edition && p.edition.archive_url) links.appendChild(outLink('The Brief, ' + shortDay(Date.parse(p.edition.date + 'T12:00:00Z')), p.edition.archive_url, 'pillbtn'));
    if (links.children.length) body.appendChild(links);
    row.append(el('span', 'th tm', '<b>' + esc(day) + '</b><span>' + esc(mon) + '</span>'), body);
    list.appendChild(row);
  });
  box.appendChild(list);
}

function paintHost(box) {
  section(box, 'Host a table');
  const tc = el('div', 'textcard');
  tc.dataset.k = 'd-host';
  tc.innerHTML = '<p>' + esc('Pick a place and a night. We post it on Meetup.') + '</p>';
  const row = el('div', 'row');
  row.appendChild(mailLink('Email us', 'Host a Btown Bites table'));
  tc.appendChild(row);
  box.appendChild(tc);
}

function paintRestaurants(box) {
  section(box, 'Restaurants');
  const tc = el('div', 'textcard');
  tc.dataset.k = 'd-restaurants';
  tc.innerHTML = '<p>' + esc('Room for a table of six? Host Btown Bites.') + '</p>';
  const row = el('div', 'row');
  row.appendChild(mailLink('Email us', 'Host Btown Bites at our restaurant'));
  tc.appendChild(row);
  box.appendChild(tc);
}

const PAINT = { next: paintNext, signup: paintSignup, past: paintPast, host: paintHost, restaurants: paintRestaurants };
function draw() {
  const root = S.root;
  root.innerHTML = '';
  S.slots = Object.create(null);
  const page = el('div', 'shelf dinner');
  SECTIONS.forEach(([k]) => {
    const box = el('section', 'shelf-sec');
    box.dataset.sec = k;
    S.slots[k] = box;
    page.appendChild(box);
    PAINT[k](box);
  });
  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}
const jump = (k) => app.jumpTo(S.slots && S.slots[k]);

function land() {
  const want = S.pending;
  if (!want || !S.ready) return;
  S.pending = null;
  if (S.slots && S.slots[want]) { jump(want); return; }
  if (!app.flashHit(S.root, want)) app.toast('That’s gone from Dinner Club now.');
}

app.register(KEY, {
  label: 'Dinner Club',
  icon: ICON.table,
  promise: 'Tables of six, a dated dinner, and you’re invited.',
  mount(root) {
    S.root = root;
    root.innerHTML = '<p class="loading">' + esc('Checking the calendar…') + '</p>';
    load().then(() => { S.ready = true; draw(); land(); });
  },
  activate(param) { S.pending = param || null; land(); },
  /* the form keeps what was typed: a setting change redraws nothing here */
  refresh() {},
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-dinner', title: 'Dinner Club', color: app.APP.accent + '-pop',
      find: (k) => S.slots && S.slots[k], onPick: (k) => jump(k),
      items: SECTIONS.map(([key, label]) => ({ key, label })) });
  },
  keepSubnav: true,
  newSince() { return 0; },
});
