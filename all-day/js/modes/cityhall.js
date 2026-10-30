/* Town · City Hall: every meeting and vote, in plain English (APP-MAP.html,
   Town; ideas 4, 13 and 16). Top to bottom:

   - Meetings. The civic calendar civic.html reads (data/civic.json, from
     the city's CivicClerk portal): what meets next, with its agenda,
     packet and video, then the last week's meetings with their minutes.
     A time the portal gave in a doubtful form says "check agenda", as the
     full page does.
   - Votes. A short page on how a vote reaches the council, the council and
     Board of Finance meetings coming up, and the ballot questions already
     on an agenda for March. The per-member scorecard is wave 2.
   - Elections. Town Meeting Day 2027 from data/town/cityhall-sources.json:
     the date, the filing deadline worked out from state law (to confirm
     with the clerk; neither the clerk nor the Secretary of State has
     posted 2027 dates), the offices up, and what a petition needs.
   - Money. The FY27 tax rates, a bill estimate for a home value you type
     (nothing leaves the page), when bills are due, and the budget
     documents. Contract awards are wave 2.
   - Vote together. Results-night and watch-party plans: `plan` posts on
     People's board whose words are about an election or a vote. Read-only
     here; "Post a plan" opens People's Plans. */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { el, esc, ICON, divider } from '../ui.js';
import { townMode, getJSON, row, card, links, line, list, stats, today, fmtDay, fmtLong, epoch, daysTo, money } from './town-kit.js';

const VOTEY = /\b(vote|voting|votes|election|elections|results|ballot|debate|town meeting|watch party|candidate|mayor|council)\b/i;
const PORTAL = 'https://burlingtonvt.portal.civicclerk.com/';

/* The city's portal gives each meeting's local wall time marked as UTC,
   and scripts/refresh_civic.py converts it to Burlington time a second
   time, so data/civic.json runs four or five hours early (City Council at
   1 pm, not 6 pm; checked against the portal's API on 2026-10-29). The
   stored instant read back in UTC is the real wall time and day. Fix the
   script and this together. */
const WALL_T = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
const wallDay = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : String(iso || '').slice(0, 10); };
function when(m) {
  const t = Date.parse(m.start);
  if (!Number.isFinite(t)) return '';
  const h = new Date(t).getUTCHours();
  return WALL_T.format(new Date(t)) + (h < 7 || h > 22 ? ' (check agenda)' : '');
}
function meetingRow(m, i, past) {
  const docs = [['Agenda', m.agenda_url], ['Packet', m.packet_url], ['Minutes', m.minutes_url], ['Video', m.video_url]].filter((x) => x[1])
    .map(([t, u]) => '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>').join(' · ');
  const key = wallDay(m.start);
  return row({ k: 'mtg-' + (past ? 'p' : 'u') + i + '-' + key, href: m.agenda_url || m.video_url || PORTAL, date: key, title: m.title,
    sub: esc([fmtDay(key) + ', ' + when(m), m.venue].filter(Boolean).join(' · ')) + (docs ? '<br>' + docs : ''),
    tag: !past && key === today() ? ['Today', 'live'] : null });
}

/* ------------------------------------------------------------- Meetings */
function drawMeetings(box, d) {
  const c = d.civic || {};
  const up = (c.upcoming || []).slice().sort((a, b) => a.start.localeCompare(b.start));
  const past = (c.past || []).slice().sort((a, b) => b.start.localeCompare(a.start));
  if (up.length) list(box, up.map((m, i) => meetingRow(m, i, false)), 6);
  else line(box, 'No meetings posted yet.');
  if (past.length) {
    divider(box, 'Recent meetings');
    list(box, past.map((m, i) => meetingRow(m, i, true)), 4);
  }
  box.appendChild(links([{ label: 'Civic calendar', href: '../civic.html' }, { label: 'City meeting portal', href: PORTAL }]));
}

/* ---------------------------------------------------------------- Votes */
function drawVotes(box, d) {
  card(box, { k: 'how-votes', title: 'How a vote gets to the council',
    paras: [esc('Committees send most decisions to a City Council agenda. Money goes through the Board of Finance first; charter changes go to voters in March.')],
    links: [{ label: 'City Council', href: 'https://www.burlingtonvt.gov/413/City-Council' }, { label: 'Watch on Town Meeting TV', href: 'https://www.cctv.org/watch-tv/series/burlington-city-council' }] });
  const up = ((d.civic || {}).upcoming || []).filter((m) => /city council|board of finance/i.test(m.body + ' ' + m.title)).sort((a, b) => a.start.localeCompare(b.start));
  if (up.length) list(box, up.map((m, i) => meetingRow(m, 'v' + i, false)), 4);
  else line(box, 'No council meetings posted yet.');
  const q = (((d.cityhall || {}).derived || {}).town_meeting_day_2027 || {}).ballot_questions_seen || [];
  if (q.length) card(box, { k: 'ballot-seen', title: 'Already headed for the March ballot', paras: q.map((x) => esc(x.replace(/\s*\(.*\)$/, ''))) });
}

/* ------------------------------------------------------------ Elections */
function drawElections(box, d) {
  const t = (((d.cityhall || {}).derived) || {}).town_meeting_day_2027;
  if (!t) { line(box, 'The 2027 election dates aren’t in yet.'); return; }
  const [fd, ft] = String(t.filing_deadline || '').split(' ');
  const [wd] = String(t.withdrawal_deadline || '').split(' ');
  const n = daysTo(t.election_date);
  stats(box, [[n > 0 ? String(n) : '0', n === 1 ? 'day to Town Meeting Day' : 'days to Town Meeting Day'], [fmtDay(fd).replace(/^\w+, /, ''), 'Filing deadline, to confirm'], ['150', 'Signatures to run for mayor']]);
  card(box, { k: 'tmd-2027', title: 'Town Meeting Day, ' + fmtLong(t.election_date),
    paras: ['To get on the ballot, file a petition with the city clerk by <b>' + esc(fmtLong(fd)) + (ft ? ' at 5 pm' : '') + '</b>. The last day to withdraw is ' + esc(fmtLong(wd)) + '.',
      esc('Worked out from state law. Confirm with the clerk, 802-865-7000.')],
    links: [{ label: 'City elections page', href: 'https://www.burlingtonvt.gov/986/Elections', primary: true }, { label: 'The state law', href: 'https://legislature.vermont.gov/statutes/section/17/055/02681' }] });
  list(box, (t.offices_expected || []).map((o, i) => row({ k: 'office-' + i, href: 'https://www.burlingtonvt.gov/986/Elections', icon: ICON.columns, title: o.replace(/\s*\(.*\)$/, ''), sub: esc((o.match(/\((.*)\)$/) || [])[1] || 'Up in March 2027') })), 6);
}

/* ---------------------------------------------------------------- Money */
function drawMoney(box, d) {
  const tx = ((d.cityhall || {}).derived || {}).tax_rates;
  if (!tx) { line(box, 'The tax rates aren’t in yet.'); return; }
  const r = tx.per_100_of_grand_list.FY2027;
  const rate = r.homestead_education + r.municipal + r.local_agreement;
  stats(box, [[r.municipal.toFixed(4), 'City rate per $100'], [r.homestead_education.toFixed(4), 'School rate per $100 (homestead)'], [rate.toFixed(4), 'Together']]);
  const c = card(box, { k: 'tax-estimate', title: 'What your tax bill is made of',
    paras: [esc('Appraised value ÷ 100 × the rates above. Due in four parts: the 12th of August, November, March and June.')] });
  const r2 = el('div', 'row');
  const input = el('input', 'field');
  input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.step = '1000'; input.name = 'value';
  input.placeholder = 'Appraised value, like 450000';
  input.setAttribute('aria-label', 'Appraised value of your home');
  r2.appendChild(input);
  c.appendChild(r2);
  const out = el('p', '', '');
  c.appendChild(out);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.innerHTML = v > 0 ? 'About <b>' + esc(money(v / 100 * rate)) + '</b> a year, or ' + esc(money(v / 100 * rate / 4)) + ' a quarter, before the state’s property tax credit.' : '';
  });
  const top = tx.fy27_municipal_components_top || {};
  card(box, { k: 'city-rate-parts', title: 'The biggest pieces of the city rate',
    paras: [esc('General city services ' + top.general_city + ', retirement ' + top.retirement + ', debt ' + top.debt_service + ', per $100.')],
    links: [{ label: 'FY27 budget', href: 'https://www.burlingtonvt.gov/1225/Fiscal-Year-2027-Budget', primary: true }, { label: 'Rate sheet', href: 'https://www.burlingtonvt.gov/DocumentCenter/View/12141' },
      { label: 'Tax rates', href: 'https://www.burlingtonvt.gov/215/Tax-Rates-Calculations' }, { label: 'School budget', href: 'https://www.bsdvt.org/district/budget/' },
      { label: 'Property tax credit', href: 'https://tax.vermont.gov/ptc' }] });
}

/* -------------------------------------------------------- Vote together */
function drawTogether(box, d, ctx) {
  const intro = box.appendChild(links([{ label: 'Post a plan in People', href: '#plans', primary: true }]));
  const host = el('div', 'plist');
  box.appendChild(host);
  const draw = (posts) => {
    host.innerHTML = '';
    const mine = posts.filter((p) => VOTEY.test((p.title || '') + ' ' + (p.body || '')));
    if (!mine.length) { host.appendChild(el('p', 'note pad', esc('No watch parties yet.'))); return; }
    mine.forEach((p) => host.appendChild(row({ k: 'vt-' + p.id, href: '#plans/b-' + p.id, icon: ICON.calendar, title: p.title,
      sub: esc([(p.meta || {}).when, p.place, p.author ? 'from ' + p.author : ''].filter(Boolean).join(' · ')) })));
  };
  if (ctx.demo) { draw(d.votePlans || []); return intro; }
  host.appendChild(el('p', 'loading', 'Looking for plans…'));
  boards.list('people', { kind: 'plan', limit: 60 }).then((r) => {
    if (!r.ok) { host.innerHTML = ''; host.appendChild(el('p', 'note pad', esc(r.message || 'People’s board isn’t answering right now.'))); return; }
    draw(r.posts);
  });
  return intro;
}

app.register('cityhall', townMode({
  key: 'cityhall', label: 'City Hall', icon: 'columns', promise: 'Every meeting and vote, in plain English.',
  demo: 'town-cityhall',
  load: () => Promise.all([getJSON('../data/civic.json'), getJSON('../data/town/cityhall-sources.json').catch(() => ({}))]).then(([civic, cityhall]) => ({ civic, cityhall })),
  sections: [
    { key: 'meetings', label: 'Meetings', draw: drawMeetings, newest: (d) => epoch((d.civic || {}).generated) },
    { key: 'votes', label: 'Votes', draw: drawVotes },
    { key: 'elections', label: 'Elections', draw: drawElections },
    { key: 'money', label: 'Money', draw: drawMoney },
    { key: 'together', label: 'Vote together', draw: drawTogether },
  ],
}));
