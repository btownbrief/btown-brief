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
import { el, esc, ICON, divider } from '../ui.js';
import { townMode, getJSON, maybeJSON, NOT_LOADED, row, card, links, line, list, quietForm, today, plusDays, fmtDay, epoch } from './town-kit.js';

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
    if (!g.length && name !== 'Today') return;
    divider(box, name, g.length ? String(g.length) : '');
    if (!g.length) { line(box, 'Nothing yet today.'); return; }
    list(box, g.map((j) => row({ k: 'job-' + j.id, href: j.url, date: j.posted, title: j.title,
      sub: esc([j.employer, pay(j), CAT[j.cat] || '', j.source && j.source !== j.employer ? 'via ' + j.source : ''].filter(Boolean).join(' · ')) })), name === 'Earlier' ? 4 : 6);
  });
  box.appendChild(links([{ label: 'Job board', href: '../jobs.html' }]));
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
const spansOf = (week, day) => String((week || {})[day] || '').split(',').map((r) => r.trim()).filter((r) => SPAN.test(r)).map((r) => r.split('-').map(toMin));
const DAYNAME = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
/* open now and until when, or the next time it opens this week; `soon`
   is minutes to that opening, for the order */
function openState(week, at) {
  const on = spansOf(week, at.day).find(([a, b]) => at.min >= a && at.min < b);
  if (on) return { open: true, soon: 0, words: 'Open until ' + clock(on[1]) };
  const d0 = DAYS.indexOf(at.day);
  for (let n = 0; n < 7; n++) {
    const day = DAYS[(d0 + n) % 7];
    const next = spansOf(week, day).find(([a]) => n > 0 || a > at.min);
    if (next) return { open: false, soon: n * 1440 + next[0] - at.min, words: 'Opens ' + (n === 0 ? '' : n === 1 ? 'tomorrow ' : DAYNAME[day] + ' ') + clock(next[0]) };
  }
  return { open: false, soon: 1e9, words: 'Hours not listed' };
}
function drawShops(box, d, ctx) {
  if (d.shops.failed) { line(box, NOT_LOADED); return; }
  const shops = ((d.shops || {}).shops || []).filter((s) => s.week && Object.values(s.week).some((v) => SPAN.test(String(v || '').split(',')[0].trim())));
  const at = ctx.demo && d.demoNow ? d.demoNow : nowET();
  const rows = shops.map((s) => ({ s, st: openState(s.week, at) })).sort((a, b) => a.st.soon - b.st.soon || a.s.name.localeCompare(b.s.name));
  const n = rows.filter((x) => x.st.open).length;
  line(box, n + ' of ' + rows.length + ' open now');
  if (rows.length) list(box, rows.map(({ s, st }) => row({ k: 'shop-' + s.id, href: s.website || '#vintage', icon: ICON.tag, title: s.name,
    sub: esc([st.words, s.neighborhood, (s.kinds || []).join(', ')].filter(Boolean).join(' · ')), tag: st.open ? ['Open', 'local'] : null })), 8);
  box.appendChild(links([{ label: 'Food: Open now in Eat', href: '#food' }]));
}

/* ------------------------------------------------------------ Businesses */
function drawBusinesses(box) {
  quietForm(box, { k: 'listing-form', title: 'List your business, free',
    intro: 'Stephen reads each one before it goes up.',
    fields: [{ name: 'name', label: 'Business name' }, { name: 'link', label: 'Website or Instagram', type: 'url', placeholder: 'https://' },
      { name: 'email', label: 'Your email', type: 'email' },
      { name: 'sponsor', label: 'Interested in sponsoring the Brief?', type: 'select', options: ['Not now', 'Yes, tell me more'] }],
    button: 'Send my listing',
    after: 'Not sent: this form isn’t live yet. Email btownbrief@gmail.com.' });
}

/* --------------------------------------------------------- Get a website */
function drawWebsite(box) {
  quietForm(box, { k: 'website-form', title: 'A website for your business', intro: 'Your hours, menu, map and ordering, kept up for you.',
    fields: [{ name: 'name', label: 'Business name' }, { name: 'need', label: 'It should', type: 'select', options: ['Show our hours and info', 'Take orders', 'Take bookings', 'Something else'] },
      { name: 'email', label: 'Your email', type: 'email' }],
    button: 'Ask about a website',
    after: 'Not sent: this form isn’t live yet. Email btownbrief@gmail.com.' });
}

/* ------------------------------------------------------ Tees for your team */
function drawTees(box) {
  card(box, { k: 'team-tees',
    paras: [esc('Shirts for a league team, a run club or a race. Team orders are coming.')],
    links: [{ label: 'The Brief’s merch shop', href: 'https://merch.btownbrief.com/', primary: true }, { label: 'Make a tee in Vintage', href: '#vintage' }] });
}

/* --------------------------------------------------------------- Sponsor */
function drawSponsor(box) {
  card(box, { k: 'sponsor-soon', title: 'Sponsor the Brief',
    paras: [esc('Email btownbrief@gmail.com.')],
    fine: 'Coming soon' });
}

app.register('work', townMode({
  key: 'work', label: 'Work', icon: 'briefcase', promise: 'Who’s hiring, local shops, and help for businesses.',
  demo: 'town-work',
  load: () => Promise.all([getJSON('../data/jobs.json'), maybeJSON('../data/vintage-shops.json')]).then(([jobs, shops]) => ({ jobs, shops })),
  sections: [
    { key: 'jobs', label: 'Jobs', draw: drawJobs, newest: (d) => epoch((d.jobs || {}).updated) },
    { key: 'hiring', label: 'Who’s hiring', draw: drawHiring },
    { key: 'shops', label: 'Shops', draw: drawShops },
    { key: 'businesses', label: 'Businesses', draw: drawBusinesses },
    { key: 'website', label: 'Get a website', draw: drawWebsite },
    { key: 'tees', label: 'Tees for your team', draw: drawTees },
    { key: 'sponsor', label: 'Sponsor', draw: drawSponsor },
  ],
}));
