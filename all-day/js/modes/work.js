/* Town · Jobs: who's hiring. Top to bottom:

   - Jobs. The job board's data (data/jobs.json, the thirteen boards and
     employers jobs.html reads), grouped Today · This week · Earlier by the
     Burlington date each was posted.
   - Who's hiring. The same postings counted by employer. */

import * as app from '../app.js';
import { el, esc, ICON, divider } from '../ui.js';
import { townMode, getJSON, NOT_LOADED, row, links, line, list, today, plusDays, fmtDay, epoch } from './town-kit.js';

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
    if (!g.length) return;
    divider(box, name, String(g.length));
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

app.register('work', townMode({
  color: '--tf-jobs',
  key: 'work', label: 'Jobs', icon: 'briefcase', promise: 'Who’s hiring in Burlington.',
  demo: 'town-work',
  load: () => getJSON('../data/jobs.json').then((jobs) => ({ jobs })),
  sections: [
    { key: 'jobs', label: 'Jobs', draw: drawJobs, newest: (d) => epoch((d.jobs || {}).updated) },
    { key: 'hiring', label: 'Who’s hiring', draw: drawHiring },
  ],
}));
