/* Town · City Hall: every meeting and vote, in plain English (APP-MAP.html,
   Town; ideas 4, 13 and 16). Top to bottom:

   - Council. What the City Council did, newest meeting on top, from
     data/town/council.json (scripts/council_summaries.py writes it from the
     city's minutes and checks every bullet against them). Each block is the
     date, the one line to read, two bullets with the rest behind Show all,
     what's next on the newest (an older one's next has been and gone), and
     the minutes and video. Three meetings, then See more and Collapse.
     The section is gone when the file is.
   - Meetings. The civic calendar civic.html reads (data/civic.json, from
     the city's CivicClerk portal): what meets next, with its agenda,
     packet and video, then the last week's meetings with their minutes; a council
     meeting there opens its summary above.
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
import * as store from '../store.js';
import { el, esc, safeHref, ICON, divider, collapseBar } from '../ui.js';
import { townMode, maybeJSON, NOT_LOADED, row, card, links, line, list, stats, today, fmtDay, fmtLong, epoch, daysTo, money, tile } from './town-kit.js';

const VOTEY = /\b(vote|voting|votes|election|elections|results|ballot|debate|town meeting|watch party|candidate|mayor|council)\b/i;
const PORTAL = 'https://burlingtonvt.portal.civicclerk.com/';
const COUNCIL = {
  one: 'If you only read one',
  next: 'Next',
  all: (n) => 'Show all ' + n,
  more: 'See more',
  minutes: 'Minutes',
  video: 'Video',
  source: 'City Hall',
  open: 'Open the minutes',
  share: 'Share',
  save: 'Save',
};
const COUNCIL_SHOWN = 3;
const BULLETS_SHOWN = 2;

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
function meetingRow(m, i, past, summary) {
  const docs = [['Agenda', m.agenda_url], ['Packet', m.packet_url], ['Minutes', m.minutes_url], ['Video', m.video_url]].filter((x) => x[1])
    .map(([t, u]) => '<a href="' + esc(safeHref(u)) + '" target="_blank" rel="noopener">' + t + '</a>').join(' · ');
  const key = wallDay(m.start);
  return row({ k: 'mtg-' + (past ? 'p' : 'u') + i + '-' + key, href: summary || m.agenda_url || m.video_url || PORTAL, date: key, title: m.title,
    sub: esc([fmtDay(key) + ', ' + when(m), String(m.venue || '').replace(/,?\s*Burlington,?\s*VT,?\s*\d{0,5}\s*$/i, '')].filter(Boolean).join(' · ')) + (docs ? '<br>' + docs : ''),
    tag: !past && key === today() ? ['Today', 'live'] : null });
}

/* -------------------------------------------------------------- Council */
const councilMeetings = (d) => ((d.council || {}).meetings || []).filter((m) => m && m.top && typeof m.date === 'string').sort((a, b) => b.date.localeCompare(a.date));
function councilBlock(m, i) {
  const k = 'council-' + m.id;
  app.know([{ k, kind: 'post', title: m.top, text: '', href: m.minutes_url || '#cityhall/' + k, src: COUNCIL.source, ago: fmtDay(m.date), open: COUNCIL.open }]);
  const saved = store.isSaved(k);
  const bullets = m.bullets || [];
  const block = el('article', 'cc');
  block.dataset.k = k;
  block.innerHTML = '<div class="cc-top">' + tile(m.date) + '<span class="eyebrow">' + esc(COUNCIL.one) + '</span><h3>' + esc(m.top) + '</h3></div>' +
    '<ul class="cc-list">' + bullets.map((b, i) => '<li' + (i >= BULLETS_SHOWN ? ' hidden' : '') + '><b>' + esc(b.head) + '</b> ' + esc(b.text) + '</li>').join('') + '</ul>' +
    (m.next && !i ? '<p class="cc-next"><b>' + esc(COUNCIL.next) + '</b> ' + esc(m.next) + '</p>' : '');
  if (bullets.length > BULLETS_SHOWN) {
    const all = el('button', 'cc-all', esc(COUNCIL.all(bullets.length)));
    all.type = 'button';
    all.addEventListener('click', () => { block.querySelectorAll('.cc-list li').forEach((li) => { li.hidden = false; }); all.remove(); });
    block.querySelector('.cc-list').after(all);
  }
  const foot = links([{ label: COUNCIL.minutes, href: m.minutes_url }, { label: COUNCIL.video, href: m.video_url }], true);
  foot.insertAdjacentHTML('beforeend', '<span class="sp"></span><span class="tf-acts"><button class="act sh" data-act="share" aria-label="' + esc(COUNCIL.share) + '">' + ICON.share + '</button>' +
    '<button class="act star' + (saved ? ' on' : '') + '" data-act="save" aria-label="' + esc(COUNCIL.save) + '" aria-pressed="' + saved + '">' + ICON.star + '</button></span>');
  block.appendChild(foot);
  return block;
}
function drawCouncil(box, d) {
  const blocks = councilMeetings(d).map(councilBlock);
  const host = el('div', 'cclist');
  host.dataset.grid = 'council';
  blocks.forEach((b, i) => { b.hidden = i >= COUNCIL_SHOWN; host.appendChild(b); });
  box.appendChild(host);
  if (blocks.length > COUNCIL_SHOWN) {
    const more = el('button', 'btn ghost more', esc(COUNCIL.more));
    more.dataset.more = 'council';
    const fold = collapseBar('the council', () => {
      blocks.forEach((b, i) => { b.hidden = i >= COUNCIL_SHOWN; });
      more.hidden = false;
      fold.hidden = true;
      app.jumpTo(box);
    });
    fold.classList.add('foot');
    fold.hidden = true;
    more.addEventListener('click', () => { blocks.forEach((b) => { b.hidden = false; }); more.hidden = true; fold.hidden = false; });
    box.append(more, fold);
  }
}

/* ------------------------------------------------------------- Meetings */
function drawMeetings(box, d) {
  const c = d.civic || {};
  if (c.failed) { line(box, NOT_LOADED); return; }
  const up = (c.upcoming || []).slice().sort((a, b) => a.start.localeCompare(b.start));
  const past = (c.past || []).slice().sort((a, b) => b.start.localeCompare(a.start));
  if (up.length) list(box, up.map((m, i) => meetingRow(m, i, false)), 6);
  else line(box, 'No meetings posted yet.');
  if (past.length) {
    divider(box, 'Recent meetings');
    const said = new Map(councilMeetings(d).map((m) => [m.date, m.id]));
    const summary = (m) => (/^city council meeting/i.test(m.title) && said.has(wallDay(m.start)) ? '#cityhall/council-' + said.get(wallDay(m.start)) : null);
    /* the newest meeting with a summary shows, however far down the week it is */
    const first = past.findIndex(summary);
    list(box, past.map((m, i) => meetingRow(m, i, true, summary(m))), first >= 4 ? 3 : 4, first);
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
  else line(box, (d.civic || {}).failed ? NOT_LOADED : 'No council meetings posted yet.');
  const q = (((d.cityhall || {}).derived || {}).town_meeting_day_2027 || {}).ballot_questions_seen || [];
  if (q.length) card(box, { k: 'ballot-seen', title: 'Already headed for the March ballot', paras: q.map((x) => esc(x.replace(/\s*\(.*\)$/, ''))) });
}

/* ------------------------------------------------------------ Elections */
function drawElections(box, d) {
  const t = (((d.cityhall || {}).derived) || {}).town_meeting_day_2027;
  if (!t) { line(box, d.cityhall.failed ? NOT_LOADED : 'The 2027 dates aren’t in yet.'); return; }
  const [fd, ft] = String(t.filing_deadline || '').split(' ');
  const [wd] = String(t.withdrawal_deadline || '').split(' ');
  const n = daysTo(t.election_date);
  stats(box, [[n > 0 ? String(n) : '0', n === 1 ? 'day to Town Meeting Day' : 'days to Town Meeting Day'], [fmtDay(fd).replace(/^\w+, /, ''), 'Filing deadline, to confirm'], ['150', 'Signatures to run for mayor']]);
  card(box, { k: 'tmd-2027', title: 'Town Meeting Day, ' + fmtLong(t.election_date),
    paras: ['To get on the ballot, file a petition with the city clerk by <b>' + esc(fmtLong(fd)) + (ft ? ' at 5 pm' : '') + '</b>. The last day to withdraw is ' + esc(fmtLong(wd)) + '.',
      esc('Worked out from state law. Confirm with the clerk, 802-865-7000.')],
    links: [{ label: 'City elections page', href: 'https://www.burlingtonvt.gov/986/Elections', primary: true }, { label: 'The state law', href: 'https://legislature.vermont.gov/statutes/section/17/055/02681' }] });
  divider(box, 'On the ballot');
  list(box, (t.offices_expected || []).map((o, i) => row({ k: 'office-' + i, href: 'https://www.burlingtonvt.gov/986/Elections', icon: ICON.columns, title: o.replace(/\s*\(.*\)$/, '') })), 6);
}

/* ---------------------------------------------------------------- Money */
function drawMoney(box, d) {
  const tx = ((d.cityhall || {}).derived || {}).tax_rates;
  if (!tx) { line(box, d.cityhall.failed ? NOT_LOADED : 'The tax rates aren’t in yet.'); return; }
  const r = tx.per_100_of_grand_list.FY2027;
  const rate = r.homestead_education + r.municipal + r.local_agreement;
  stats(box, [['$' + rate.toFixed(2), 'Tax per $100 of home value'], ['$' + r.municipal.toFixed(2), 'Of that, to the city'], ['$' + r.homestead_education.toFixed(2), 'And to schools']]);
  const c = card(box, { k: 'tax-estimate', title: 'Your tax bill',
    paras: [esc('Due in four parts: the 12th of August, November, March and June.')] });
  const r2 = el('div', 'row');
  const input = el('input', 'field');
  input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.step = '1000'; input.name = 'value';
  input.placeholder = 'Your home’s appraised value';
  input.setAttribute('aria-label', 'Appraised value of your home');
  r2.appendChild(input);
  c.appendChild(r2);
  const out = el('p', '', '');
  out.setAttribute('role', 'status');
  c.appendChild(out);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.innerHTML = v > 0 ? 'About <b>' + esc(money(v / 100 * rate)) + '</b> a year, or ' + esc(money(v / 100 * rate / 4)) + ' a quarter, before the state’s property tax credit.' : '';
  });
  const top = tx.fy27_municipal_components_top || {};
  card(box, { k: 'city-rate-parts', title: 'The biggest pieces of the city rate',
    paras: [esc('Of the city’s $' + r.municipal.toFixed(2) + ': $' + top.general_city.toFixed(2) + ' runs the city, $' + top.retirement.toFixed(2) + ' pays pensions, $' + top.debt_service.toFixed(2) + ' pays down debt.')],
    links: [{ label: 'City budget', href: 'https://www.burlingtonvt.gov/1225/Fiscal-Year-2027-Budget' }, { label: 'School budget', href: 'https://www.bsdvt.org/district/budget/' },
      { label: 'Property tax credit', href: 'https://tax.vermont.gov/ptc' }] });
}

/* -------------------------------------------------------- Vote together */
function drawTogether(box, d, ctx) {
  const intro = box.appendChild(links([{ label: 'Post a plan in People', href: '#people/plans', primary: true }]));
  const host = el('div', 'plist');
  box.appendChild(host);
  const draw = (posts) => {
    host.innerHTML = '';
    const mine = posts.filter((p) => VOTEY.test((p.title || '') + ' ' + (p.body || '')));
    if (!mine.length) { host.appendChild(el('p', 'note pad', esc('No watch parties yet.'))); return; }
    mine.forEach((p) => host.appendChild(row({ k: 'vt-' + p.id, href: '#people/b-' + p.id, icon: ICON.calendar, title: p.title,
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
  color: '--tf-city',
  key: 'cityhall', label: 'City Hall', icon: 'columns', promise: 'Every meeting and vote, in plain English.',
  demo: 'town-cityhall',
  load: () => Promise.all(['../data/civic.json', '../data/town/cityhall-sources.json', '../data/town/council.json'].map(maybeJSON)).then(([civic, cityhall, council]) => ({ civic, cityhall, council })),
  sections: [
    { key: 'council', label: 'Council', draw: drawCouncil, hide: (d) => !councilMeetings(d).length, newest: (d) => epoch((councilMeetings(d)[0] || {}).generated) },
    { key: 'meetings', label: 'Meetings', draw: drawMeetings, newest: (d) => epoch((d.civic || {}).generated) },
    { key: 'votes', label: 'Votes', draw: drawVotes },
    { key: 'elections', label: 'Elections', draw: drawElections },
    { key: 'money', label: 'Money', draw: drawMoney },
    { key: 'together', label: 'Vote together', draw: drawTogether },
  ],
}));
