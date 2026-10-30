/* Town · Work: who's hiring, local shops, and help for businesses
   (APP-MAP.html, Town; ideas 30 and the memo's website service). Top to
   bottom:

   - Jobs. The job board's data (data/jobs.json, the thirteen boards and
     employers jobs.html reads), grouped Today · This week · Earlier by the
     Burlington date each was posted.
   - Who's hiring. The same postings counted by employer.
   - Shops. Open now, for the shops whose hours someone has read off the
     shop's own page: today that is the vintage, thrift and used-book
     guide (data/vintage-shops.json). Food is Eat's Open now. Every other
     kind of shop needs its hours kept before it can join.
   - Businesses. A free listing form that writes nowhere yet, with the
     sponsor question.
   - Get a website. The service in a few lines and an intake form that
     writes nowhere yet. The package and the price are Stephen's to set.
   - Tees for your team. The merch shop, for teams and events.
   - Sponsor. The sponsor page isn't live (it waits on the
     sponsor-plumbing branch), so this says what will be here. */

import * as app from '../app.js';
import { el, esc, ICON } from '../ui.js';
import { townMode, getJSON, row, card, links, line, list, quietForm, today, plusDays, fmtDay, epoch } from './town-kit.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CAT = { tech: 'Tech', office: 'Office', healthcare: 'Health care', community: 'Community', education: 'Education', government: 'Government', trades: 'Trades', other: 'Other' };
const pay = (j) => j.pay || (j.pay_hr ? '$' + j.pay_hr + '/hr' : '');

/* ----------------------------------------------------------------- Jobs */
function drawJobs(box, d) {
  const jobs = ((d.jobs || {}).jobs || []).slice().sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
  if (!jobs.length) { line(box, 'No postings right now.'); return; }
  const t = today(), wk = plusDays(t, -6);
  const groups = [['Today', (j) => j.posted >= t], ['This week', (j) => j.posted < t && j.posted >= wk], ['Earlier', (j) => j.posted < wk]];
  groups.forEach(([name, test]) => {
    const g = jobs.filter(test);
    box.appendChild(el('p', 'note pad', esc(name + (g.length ? ' · ' + g.length : ''))));
    if (!g.length) { line(box, name === 'Today' ? 'Nothing new posted yet today.' : 'Nothing from these days.'); return; }
    list(box, g.map((j) => row({ k: 'job-' + j.id, href: j.url, date: j.posted, title: j.title,
      sub: esc([j.employer, pay(j), CAT[j.cat] || '', j.source && j.source !== j.employer ? 'via ' + j.source : ''].filter(Boolean).join(' · ')) })), name === 'Earlier' ? 4 : 6);
  });
  box.appendChild(links([{ label: 'The full job board, with filters', href: '../jobs.html' }]));
}

/* --------------------------------------------------------- Who's hiring */
function drawHiring(box, d) {
  const by = new Map();
  ((d.jobs || {}).jobs || []).forEach((j) => { const o = by.get(j.employer) || { n: 0, latest: '', url: j.url }; o.n += 1; if (j.posted > o.latest) { o.latest = j.posted; o.url = j.url; } by.set(j.employer, o); });
  const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n || b[1].latest.localeCompare(a[1].latest))
    .map(([name, o]) => row({ k: 'emp-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), href: '../jobs.html', icon: ICON.briefcase, title: name,
      sub: esc(o.n + ' opening' + (o.n === 1 ? '' : 's') + ' · newest ' + fmtDay(o.latest)) }));
  if (!rows.length) { line(box, 'No postings right now.'); return; }
  list(box, rows, 8);
}

/* ---------------------------------------------------------------- Shops */
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function nowET() { const o = {}; ET.formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return { day: o.weekday.toLowerCase().slice(0, 3), min: Number(o.hour) * 60 + Number(o.minute) }; }
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const clock = (m) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return (h % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm'); };
const SPAN = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;
function openState(week, at) {
  const raw = String((week || {})[at.day] || '');
  if (raw && !raw.split(',').some((r) => SPAN.test(r.trim()))) return { open: false, unknown: true, words: 'Hours not listed for today' };
  const spans = String((week || {})[at.day] || '').split(',').map((r) => r.trim()).filter((r) => SPAN.test(r)).map((r) => r.split('-').map(toMin));
  const on = spans.find(([a, b]) => at.min >= a && at.min < b);
  if (on) return { open: true, words: 'Open until ' + clock(on[1]) };
  const next = spans.find(([a]) => a > at.min);
  return { open: false, words: next ? 'Opens at ' + clock(next[0]) : 'Closed for today' };
}
function drawShops(box, d, ctx) {
  const shops = ((d.shops || {}).shops || []).filter((s) => s.week && Object.values(s.week).some((v) => SPAN.test(String(v || '').split(',')[0].trim())));
  const at = ctx.demo && d.demoNow ? d.demoNow : nowET();
  const rows = shops.map((s) => ({ s, st: openState(s.week, at) })).sort((a, b) => b.st.open - a.st.open || a.s.name.localeCompare(b.s.name));
  const n = rows.filter((x) => x.st.open).length;
  line(box, n + ' of ' + rows.length + ' vintage, thrift and book shops open right now, by the hours on their own pages.');
  if (rows.length) list(box, rows.map(({ s, st }) => row({ k: 'shop-' + s.id, href: s.website || '#vintage', icon: ICON.tag, title: s.name,
    sub: esc([st.words, s.neighborhood, (s.kinds || []).join(', ')].filter(Boolean).join(' · ')), tag: st.open ? ['Open', 'local'] : st.unknown ? null : ['Closed', 'left'] })), 8);
  card(box, { k: 'shops-more', paras: [esc('Restaurants, cafes and bars are in Eat’s Open now. Other shops join this list once their hours are kept up, with daily specials and a punch card to come.')],
    links: [{ label: 'Open now in Eat', href: '#food' }] });
}

/* ------------------------------------------------------------ Businesses */
function drawBusinesses(box) {
  quietForm(box, { k: 'listing-form', title: 'List your business, free',
    intro: 'A free listing in the Town app: what you do, where, your hours and a link. Stephen reads each one before it goes up.',
    fields: [{ name: 'name', label: 'Business name' }, { name: 'what', label: 'What you do, in a line' }, { name: 'where', label: 'Street address, or “online only”' },
      { name: 'hours', label: 'Hours', placeholder: 'Tue–Sat 10 to 6' }, { name: 'link', label: 'Website or Instagram', type: 'url', placeholder: 'https://' },
      { name: 'email', label: 'Your email, so Stephen can confirm', type: 'email' },
      { name: 'sponsor', label: 'Would you like to hear about sponsoring the Brief?', type: 'select', options: ['Not now', 'Yes, send me the details', 'Maybe later'] }],
    button: 'Send my listing',
    after: 'Thanks. This form isn’t connected yet, so nothing was sent. For now, email btownbrief@gmail.com and Stephen will add you.' });
}

/* --------------------------------------------------------- Get a website */
function drawWebsite(box) {
  card(box, { k: 'website-what', title: 'A website for your business',
    paras: [esc('A simple, fast site with your hours, your menu or services, a map and a way to order or book, kept up for you. Built by the Brief, for Burlington businesses.'),
      esc('Tell us what you need and Stephen will write back with what it would take.')],
    fine: esc('The package and the price are coming.') });
  quietForm(box, { k: 'website-form', title: 'What do you need?',
    fields: [{ name: 'name', label: 'Business name' }, { name: 'now', label: 'Your site today, if you have one', type: 'url', placeholder: 'https://' },
      { name: 'need', label: 'What it should do', type: 'select', options: ['Show who we are and our hours', 'Take orders', 'Take bookings', 'Something else'] },
      { name: 'more', label: 'Anything else', type: 'textarea' }, { name: 'email', label: 'Your email', type: 'email' }],
    button: 'Ask about a website',
    after: 'Thanks. This form isn’t connected yet, so nothing was sent. For now, email btownbrief@gmail.com.' });
}

/* ------------------------------------------------------ Tees for your team */
function drawTees(box) {
  card(box, { k: 'team-tees', title: 'Tees for your team',
    paras: [esc('Custom shirts for a rec league team, a run club, a race or a work crew, printed with your name on Burlington designs.'), esc('Team orders are coming. The shop is open now.')],
    links: [{ label: 'The Brief’s merch shop', href: 'https://merch.btownbrief.com/', primary: true }, { label: 'Make a tee in Vintage', href: '#vintage' }] });
}

/* --------------------------------------------------------------- Sponsor */
function drawSponsor(box) {
  card(box, { k: 'sponsor-soon', title: 'Sponsor the Brief',
    paras: [esc('The newsletter, the guide and these apps reach Burlington every week. The sponsor page, with what a spot includes and how to book one, is coming here.'),
      esc('Until then, email btownbrief@gmail.com.')],
    fine: esc('Coming soon') });
}

app.register('work', townMode({
  key: 'work', label: 'Work', icon: 'briefcase', promise: 'Who’s hiring, local shops, and help for businesses.',
  demo: 'town-work',
  load: () => Promise.all([getJSON('../data/jobs.json'), getJSON('../data/vintage-shops.json').catch(() => ({ shops: [] }))]).then(([jobs, shops]) => ({ jobs, shops })),
  sections: [
    { key: 'jobs', label: 'Jobs', sub: 'From thirteen local boards, refreshed daily', draw: drawJobs, newest: (d) => epoch((d.jobs || {}).updated) },
    { key: 'hiring', label: 'Who’s hiring', draw: drawHiring },
    { key: 'shops', label: 'Shops', sub: 'Open now', draw: drawShops },
    { key: 'businesses', label: 'Businesses', draw: drawBusinesses },
    { key: 'website', label: 'Get a website', draw: drawWebsite },
    { key: 'tees', label: 'Tees for your team', draw: drawTees },
    { key: 'sponsor', label: 'Sponsor', draw: drawSponsor },
  ],
}));
