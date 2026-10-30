/* Dinner Club (Eat, wave 1, 2026-10-29): tables of six, a dated dinner,
   and you’re invited. Btown Bites is Stephen's dinner group for 21 to 35
   year olds; every dinner is posted on Meetup first, and people RSVP there.

   - Next dinner. From Stephen's own Meetup calendar (Up For It's copy of
     the group's iCal, the feed People reads): the soonest upcoming event
     whose title says Btown Bites or dinner. Its day in plain words, the
     time, the place, and "Sign up on Meetup". None on the calendar: it says
     so, with the group's link.
   - Sign up. How it works, in three lines, and the group.
   - Past dinners. A shelf of photos; there are none yet, so live shows one
     card saying they land here. The demo has invented past dinners.
   - Host a table / Restaurants. A short card each and an email line.

   Live never shows anything invented; ?demo=1 reads data/demo/eat-dinner.json
   (its dinners dated from the reader's now). Keys are d-<…>; #dinner/<section>
   and #dinner/<key> land. */

import * as app from '../app.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, art, section, listRail } from '../ui.js';
import { sectionBar } from '../sections.js';

const KEY = 'dinner';
const MEETUP_FEED = 'https://play.btownbrief.com/up-for-it/data/meetup.json';
const MEETUP_GROUP = 'https://www.meetup.com/burlington-social-activites-group/';
const DEMO_FILE = 'data/demo/eat-dinner.json';
const MAIL = 'btownbrief@gmail.com';
const TZ = 'America/New_York';
const DINNER = /btown bites|dinner/i;
const SECTIONS = [['next', 'Next dinner'], ['signup', 'Sign up'], ['past', 'Past dinners'], ['host', 'Host a table'], ['restaurants', 'Restaurants']];

const S = { root: null, slots: null, pending: null, ready: false, next: null, failed: false, past: [], group: MEETUP_GROUP };

/* "Thursday, November 5" and "7 pm", in Burlington's clock */
const dayWords = (ms) => new Date(ms).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
function timeWords(ms) {
  const t = new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  return t.replace(':00', '').replace(/\s?([AP])M$/i, (m0, ap) => ' ' + ap.toLowerCase() + 'm');
}
function outLink(label, href, cls) {
  const a = el('a', cls || 'btn ghost sm', label);
  a.href = safeHref(href);
  if (/^https?:/i.test(a.href)) { a.target = '_blank'; a.rel = 'noopener'; }
  if (app.demo && a.target) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens Meetup in the real build'); });
  return a;
}
const mailLink = (label, subject) => {
  const a = el('a', 'btn ghost sm', ICON.mail + ' ' + esc(label));
  a.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject);
  a.dataset.mail = subject;
  return a;
};

/* ----------------------------------------------------------------- data */
/* the soonest upcoming dinner on the calendar, or null */
function nextDinner(events) {
  const now = Date.now();
  return (Array.isArray(events) ? events : [])
    .filter((e) => e && DINNER.test(String(e.title || '')) && /^https?:/i.test(String(e.url || '')) && Date.parse(e.starts_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] || null;
}
function load() {
  if (app.demo) {
    return app.demoJSON(DEMO_FILE).then((d) => {
      /* the demo's dinners sit a set number of days from the reader's now */
      const at = (days, hhmm) => {
        const t = new Date(Date.now() + days * 86400000);
        const [h, m] = String(hhmm || '19:00').split(':').map(Number);
        t.setHours(h, m || 0, 0, 0);
        return t.getTime();
      };
      const n = d.next;
      S.next = n ? { uid: n.uid, title: n.title, url: n.url, location: n.location, starts_at: new Date(at(n.days_from_now, n.time)).toISOString() } : null;
      S.past = (d.past || []).map((p) => ({ ...p, ms: at(p.days_from_now, p.time) }));
      if (d.group) S.group = d.group;
    }).catch(() => { S.failed = true; });
  }
  return data.fetchJSON(MEETUP_FEED, 8000).then((j) => { S.next = nextDinner(j && j.events); }).catch(() => { S.failed = true; });
}

/* ---------------------------------------------------------------- pages */
function paintNext(box) {
  section(box, 'Next dinner');
  const n = S.next;
  const tc = el('div', 'textcard');
  if (!n) {
    tc.dataset.k = 'd-next-none';
    tc.innerHTML = '<p>' + esc(S.failed ? 'The calendar didn’t load. Dinners are posted on Meetup first.'
      : 'No dinner on the calendar yet. The next one is posted on Meetup first.') + '</p>';
    const row = el('div', 'row');
    row.appendChild(outLink('Btown Bites on Meetup ' + ICON.ext, S.group, 'btn sm'));
    tc.appendChild(row);
    box.appendChild(tc);
    return;
  }
  const ms = Date.parse(n.starts_at);
  tc.dataset.k = 'd-next';
  tc.innerHTML = '<span class="eyebrow">' + esc('Tables of six') + '</span><h3 class="serif">' + esc(n.title) + '</h3>' +
    '<p><b>' + esc(dayWords(ms)) + '</b> · ' + esc(timeWords(ms)) + '</p>' +
    (n.location ? '<p>' + ICON.pin + ' ' + esc(n.location) + '</p>' : '');
  const row = el('div', 'row');
  const go = outLink('Sign up on Meetup ' + ICON.ext, n.url, 'btn');
  go.dataset.signup = '1';
  row.appendChild(go);
  tc.appendChild(row);
  tc.appendChild(el('p', 'fine', esc('We book the table ahead, so RSVP early.')));
  box.appendChild(tc);
}

function paintSignup(box) {
  section(box, 'Sign up');
  const tc = el('div', 'textcard');
  tc.dataset.k = 'd-signup';
  tc.innerHTML = '<h3>' + esc('How it works') + '</h3>' +
    '<p>' + esc('Btown Bites is a dinner for 21 to 35 year olds who’d like to meet a few new people over a good meal.') + '</p>' +
    '<p>' + esc('You sit at a table of six. Say yes on Meetup, and we make the reservation ahead, so RSVP early.') + '</p>' +
    '<p>' + esc('Come as you are. Coming on your own is the point.') + '</p>';
  const row = el('div', 'row');
  row.appendChild(outLink('Join the group on Meetup ' + ICON.ext, S.group, 'btn sm'));
  tc.appendChild(row);
  box.appendChild(tc);
}

function paintPast(box) {
  section(box, 'Past dinners');
  const r = listRail(box, { name: 'dinner-past', label: 'Past dinners', cells: 160 });
  if (!S.past.length) {
    const a = el('a', 'vcard w180 vall');
    a.dataset.k = 'd-past-soon';
    a.href = safeHref(S.group);
    a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = '<span class="c-media r45"><b>' + esc('Coming') + '</b></span><span class="t">' + esc('Photos from past dinners land here.') + '</span>' +
      '<span class="s">' + esc('After the next one.') + '</span>';
    r.appendChild(a);
    return;
  }
  S.past.forEach((p) => {
    const a = el('a', 'vcard w180');
    a.dataset.k = 'd-past-' + p.id;
    a.href = '#' + KEY + '/d-past-' + p.id;
    a.innerHTML = '<span class="c-media r45">' + art(p.photo) + '</span><span class="t">' + esc(p.title) + '</span>' +
      '<span class="s">' + esc([new Date(p.ms).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }), p.place, p.seats ? p.seats + ' at the table' : ''].filter(Boolean).join(' · ')) + '</span>';
    r.appendChild(a);
  });
}

function paintHost(box) {
  section(box, 'Host a table');
  const tc = el('div', 'textcard');
  tc.dataset.k = 'd-host';
  tc.innerHTML = '<p>' + esc('Have a favorite spot and a free evening? Host a table: pick the place and the night, and we post it on Meetup so five people can join you.') + '</p>' +
    '<p>' + esc('You don’t need to know anyone. Just be the one who says hello first.') + '</p>';
  const row = el('div', 'row');
  row.appendChild(mailLink('Email us', 'Host a Btown Bites table'));
  tc.appendChild(row);
  tc.appendChild(el('p', 'fine', esc(MAIL)));
  box.appendChild(tc);
}

function paintRestaurants(box) {
  section(box, 'Restaurants');
  const tc = el('div', 'textcard');
  tc.dataset.k = 'd-restaurants';
  tc.innerHTML = '<p>' + esc('Have room for a table of six on a weeknight? Host Btown Bites at your restaurant. We book ahead and bring a table of new faces.') + '</p>' +
    '<p>' + esc('Tell us your nights and how many tables you can hold.') + '</p>';
  const row = el('div', 'row');
  row.appendChild(mailLink('Email us', 'Host Btown Bites at our restaurant'));
  tc.appendChild(row);
  tc.appendChild(el('p', 'fine', esc(MAIL)));
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

/* #dinner/<section> opens there; #dinner/d-<…> flashes that card */
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
  refresh() { if (S.ready) draw(); },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-dinner', title: 'Dinner Club', color: app.APP.accent + '-pop', fresh: true,
      find: (k) => S.slots && S.slots[k], onPick: (k) => jump(k),
      items: SECTIONS.map(([key, label]) => ({ key, label })) });
  },
  keepSubnav: true,
  /* nothing here arrives on its own between visits */
  newSince() { return 0; },
});
