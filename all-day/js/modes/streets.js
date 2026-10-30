/* Town · Streets: what's going in, what's torn up, and what got fixed
   (APP-MAP.html, Town; ideas 3, 8, 10, 15 and 23). All but Report read
   data/town/streets.json, which scripts/town/streets.py writes daily.
   Top to bottom:

   - Going in. The permits the notable rule picks (a demolition, an ADU, a
     restaurant or bar fit-out, a change of use, a new building, $250,000
     or more), one row per job, and the latest weeks' roundup. No
     contractor names: Stephen hasn't decided on business names yet, and
     people's names were never kept.
   - Torn up. The city's construction projects, one row each, the ones
     under construction first.
   - Report. The `streets` board's `report` posts: what, where, a photo if
     there is one, and a status chip (Fixed or Still broken). Stephen sees
     each one before it shows (the board is pre-moderated). The city's own
     Report a Concern (See, Click, Fix) sits beside it, because a city
     crew only hears about a pothole there.
   - Sold. Arm's-length sales from the last 60 days of state transfer
     returns: address, price, kind. No buyer or seller names; a company
     buyer is "a company", unnamed. The out-of-state flag is shown only as
     each week's share, never on a sale, until Stephen decides.
   - Blotter. The police press-release headlines (date, offence, case
     number, never a name) and the monthly counts, which are anonymous.
   - Wish list. A placeholder for the annual "what do you want in the old
     ___" poll. */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { el, esc, ICON, divider } from '../ui.js';
import { townMode, getJSON, row, card, links, line, list, stats, today, plusDays, fmtDay, ago, epoch, money, shortMoney } from './town-kit.js';

const WHAT = [['pothole', 'Pothole'], ['streetlight', 'Streetlight out'], ['sidewalk', 'Sidewalk'], ['crosswalk', 'Crosswalk'], ['sign', 'Sign'], ['graffiti', 'Graffiti'], ['trash', 'Trash'], ['tree', 'Tree'], ['other', 'Something else']];
const WHAT_LABEL = Object.fromEntries(WHAT);
const REASON = { demolition: 'Demolition', adu: 'An ADU', restaurant_or_fitout: 'Restaurant, bar or fit-out', commercial_occupancy: 'Change of use', new_building: 'New building', big_project: '$250K or more', units: '10 or more units' };
const CONCERN = 'https://www.burlingtonvt.gov/862/Report-a-Concern';
const cls = (c) => String(c || 'Property').replace(/^\d+\.\s*/, '');
const sec = (d, k) => ((d.streets || {}).sections || {})[k] || {};

/* ------------------------------------------------------------- Going in */
/* '2026-W43' → 'Oct 19', the Monday that ISO week starts */
function mondayOf(w) {
  const [y, n] = String(w).split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4.getTime() + ((n - 1) * 7 - ((jan4.getUTCDay() + 6) % 7)) * 864e5);
  return fmtDay(mon.toISOString().slice(0, 10)).replace(/^\w+, /, '');
}
const jobName = (x) => (x.project && !/^project_\d+$/i.test(x.project.trim()) ? x.project : x.kind + ' at ' + x.address);
function drawGoing(box, d) {
  const p = sec(d, 'permits');
  const wk = (p.weekly_roundup || []).slice(0, 2);
  if (wk.length) stats(box, [[String(wk[0].total), 'Permits filed the week of ' + mondayOf(wk[0].week)], [String(wk[0].notable), 'Worth a look'], [shortMoney(wk[0].est_cost_total), 'Estimated work']]);
  const seen = new Set();
  const jobs = (p.items || []).filter((x) => x.notable).sort((a, b) => b.applied.localeCompare(a.applied)).filter((x) => {
    const key = (x.address + '|' + (x.project || '')).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!jobs.length) line(box, 'Nothing notable filed in the last six weeks.');
  else list(box, jobs.map((x) => row({ k: 'pm-' + x.permit_no, href: x.source_url, date: x.applied, title: jobName(x),
    sub: esc([x.address, (x.notable_reasons || []).map((r) => REASON[r] || r).join(', '), x.est_cost ? money(x.est_cost) : '', x.status].filter(Boolean).join(' · ')) })), 6);
  line(box, 'From the city’s weekly permit export, last updated ' + fmtDay(p.export_date) + ', so the newest week is always missing.');
}

/* ------------------------------------------------------------- Torn up */
const ORDER = { 'Under Construction': 0, 'Approved/In-Design': 1, 'In Design': 2, Proposed: 3, Postponed: 4, Completed: 5 };
function drawTorn(box, d) {
  const pr = (sec(d, 'projects').items || []).slice().sort((a, b) => (ORDER[a.status] ?? 6) - (ORDER[b.status] ?? 6) || String(b.last_edited).localeCompare(String(a.last_edited)));
  const n = pr.filter((x) => x.status === 'Under Construction').length;
  line(box, n + ' under construction now, of ' + pr.length + ' city projects on the books.');
  list(box, pr.map((x) => row({ k: 'pj-' + x.slug, href: (x.links || [])[0] || x.source_url, icon: ICON.cone, title: x.name,
    sub: esc([x.type, x.department, [...new Set((x.wards || []).join(';').split(/[;,]/).map((w) => w.trim()).filter(Boolean))].join(', '), x.construction_year && /^\d{4}$/.test(x.construction_year) ? 'Build ' + x.construction_year : ''].filter(Boolean).join(' · ')),
    tag: [x.status || 'Unknown', x.status === 'Under Construction' ? 'live' : x.status === 'Completed' ? 'local' : 'left'] })), 10);
  box.appendChild(links([{ label: 'The city’s construction portal', href: 'https://www.burlingtonvt.gov/323/Construction-Portal' }]));
}

/* --------------------------------------------------------------- Report */
function drawReport(box) {
  const intro = card(box, { k: 'report-how', paras: [esc('A pothole, a dark streetlight, a crosswalk worn away. Drop a pin and a photo here so neighbors can see it, and Stephen looks at each one before it shows. Report it to the city too: that’s how a crew gets sent.')],
    links: [{ label: 'Report it to the city (See, Click, Fix)', href: CONCERN }] });
  const row2 = intro.querySelector('.row');
  const post = el('button', 'btn sm', ICON.plus + ' Report a street problem');
  post.addEventListener('click', () => boards.compose({ board: 'streets', kind: 'report', heading: 'Report a street problem', title: 'What’s wrong', titlePlaceholder: 'Deep pothole in the bike lane',
    body: 'Anything a crew would want to know',
    fields: [{ key: 'what', label: 'What is it', type: 'enum', options: WHAT, required: true }, { key: 'where', label: 'Where: a street and a cross street', type: 'text', placeholder: 'North Winooski Ave at Union St', required: true }],
    notes: ['Places and photos of streets only: no faces, no plates, no people.', 'It shows once Stephen has looked.'],
    onPosted: () => load() }));
  row2.insertBefore(post, row2.firstChild);
  const host = el('div', 'feed');
  box.appendChild(host);
  const meta = (p) => [WHAT_LABEL[(p.meta || {}).what] || 'Report', (p.meta || {}).where].filter(Boolean).join(' · ');
  function load() {
    host.innerHTML = '';
    host.appendChild(el('p', 'loading', 'Loading reports…'));
    boards.list('streets', { kind: 'report', limit: 30 }).then((r) => {
      host.innerHTML = '';
      if (!r.ok) {
        host.appendChild(el('p', 'note pad', esc(r.error === 'off' || r.error === 'bad_board' || r.error === 'bad_kind' ? 'Street reports open once the board is switched on. Until then, the city’s form above is the way.' : r.message)));
        return;
      }
      if (!r.posts.length) { host.appendChild(el('p', 'note pad', esc('No street reports yet. Be the first.'))); return; }
      const items = boards.draw(host, r.posts, { tab: 'streets', meta, ratio: 'r169' });
      items.forEach((it, i) => {
        const fixed = !!(r.posts[i].meta || {}).fixed;
        const head = host.querySelector('.card.board[data-k="' + CSS.escape(it.k) + '"] .c-head');
        if (head) head.appendChild(el('span', 'tag tag-' + (fixed ? 'local' : 'live'), fixed ? 'Fixed' : 'Still broken'));
      });
    });
  }
  load();
}

/* ----------------------------------------------------------------- Sold */
const weekOf = (key) => { const [y, m, dd] = key.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, dd)); const dow = (t.getUTCDay() + 6) % 7; return plusDays(key, -dow); };
function drawSold(box, d) {
  const s = sec(d, 'sales');
  const from = plusDays(today(), -60);
  const sales = (s.items || []).filter((x) => x.arms_length && x.price > 0 && x.closed >= from).sort((a, b) => b.closed.localeCompare(a.closed));
  const m = s.medians || {};
  stats(box, [[shortMoney((m['30d'] || {}).all_residential) || '—', 'Median home, last 30 days'], [shortMoney((m['90d'] || {}).all_residential) || '—', 'Last 90 days (' + ((m['90d'] || {}).count || 0) + ' sales)'], [shortMoney((m['365d'] || {}).all_residential) || '—', 'Last year']]);
  /* the out-of-state flag, only as each week's share */
  const weeks = new Map();
  sales.forEach((x) => { const w = weekOf(x.closed); const o = weeks.get(w) || { n: 0, out: 0 }; o.n += 1; if (x.out_of_state_buyer) o.out += 1; weeks.set(w, o); });
  const wl = [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  if (wl.length) {
    divider(box, 'Out-of-state buyers', 'each week, by mailing address');
    list(box, wl.map(([w, o]) => row({ k: 'wk-' + w, href: s.items[0] ? s.items[0].source_url : 'https://geodata.vermont.gov/', date: w, title: 'Week of ' + fmtDay(w).replace(/^\w+, /, ''),
      sub: esc(o.out + ' of ' + o.n + ' sale' + (o.n === 1 ? '' : 's') + ' to an out-of-state address') })), 6);
  }
  if (!sales.length) line(box, 'No arm’s-length sales posted in the last 60 days.');
  else list(box, sales.map((x) => row({ k: 'sale-' + x.return_id, href: x.source_url, date: x.closed, title: x.address,
    sub: '<b>' + esc(money(x.price)) + '</b> · ' + esc([cls(x.property_class), x.buyer_entity ? 'bought by a company' : ''].filter(Boolean).join(' · ')) })), 8);
  line(box, 'From Vermont’s property transfer returns, posted about a week after closing (latest ' + fmtDay(s.latest_posted) + '). Gifts, family transfers and $0 deeds are left out. No names.');
}

/* -------------------------------------------------------------- Blotter */
const SAFE_HEAD = /^(UPDATE\s+)?\d{1,2}\/\d{1,2}\/\d{4}\s+[A-Za-z /&,-]+\|\s*\d{2}[A-Z]{2}\d{5,}$/;
const top = (o, n) => Object.entries(o || {}).filter(([k]) => k !== 'NA').sort((a, b) => b[1] - a[1]).slice(0, n);
const mon = (k) => (k ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(new Date(k + '-15T12:00:00Z')) : '');
function drawBlotter(box, d) {
  const b = sec(d, 'blotter');
  const pi = b.police_incidents_month || {}, ar = b.arrests_month || {}, fi = b.fire_incidents_month || {};
  stats(box, [[(pi.total || 0).toLocaleString('en-US'), 'Police calls in ' + mon(pi.month)], [(fi.total || 0).toLocaleString('en-US'), 'Fire and rescue calls in ' + mon(fi.month)], [String(ar.total || 0), 'Arrests in ' + mon(ar.month)]]);
  const pr = b.press_releases || [];
  if (pr.length) {
    divider(box, 'Police press releases');
    list(box, pr.map((x, i) => row({ k: 'pr-' + (x.case_number || i) + (x.is_update ? '-u' : '') + '-' + i, href: x.source_url, icon: ICON.flag,
      title: SAFE_HEAD.test(String(x.headline).trim()) ? x.headline : 'Police press release' + (x.case_number ? ', case ' + x.case_number : ''),
      sub: esc(ago(x.posted)), tag: x.is_update ? ['Update', 'left'] : null })), 5);
  }
  const groups = top(pi.by_call_type_group, 6);
  if (groups.length) {
    divider(box, 'What the police were called for', mon(pi.month));
    list(box, groups.map(([k, v]) => row({ k: 'pc-' + k.toLowerCase().replace(/\W+/g, '-'), href: pi.source_url, title: k, sub: esc(v.toLocaleString('en-US') + ' calls') })), 6);
  }
  line(box, 'The city publishes no daily log, and these counts are a month behind and anonymous. A written weekly column comes later.');
}

/* ------------------------------------------------------------ Wish list */
function drawWish(box) {
  card(box, { k: 'wish-poll', title: 'What do you want in the old ___?',
    paras: [esc('Once a year, the Brief asks what you want in the empty storefronts and lots around town, and shows the votes by block. The first poll opens in 2027.')],
    fine: esc('Coming soon') });
}

app.register('streets', townMode({
  key: 'streets', label: 'Streets', icon: 'cone', promise: 'What’s going in, what’s torn up, and what got fixed.',
  demo: 'town-streets',
  load: () => getJSON('../data/town/streets.json').then((streets) => ({ streets })),
  sections: [
    { key: 'going', label: 'Going in', sub: 'Permits worth knowing about', draw: drawGoing, newest: (d) => epoch(sec(d, 'permits').export_date) },
    { key: 'torn', label: 'Torn up', sub: 'City construction, one project per row', draw: drawTorn, newest: (d) => (sec(d, 'projects').items || []).reduce((m, x) => Math.max(m, epoch(x.last_edited)), 0) },
    { key: 'report', label: 'Report', draw: drawReport },
    { key: 'sold', label: 'Sold', sub: 'The last 60 days of sales', draw: drawSold, newest: (d) => epoch(sec(d, 'sales').latest_posted) },
    { key: 'blotter', label: 'Blotter', draw: drawBlotter, newest: (d) => (sec(d, 'blotter').press_releases || []).reduce((m, x) => Math.max(m, epoch(x.posted)), 0) },
    { key: 'wish', label: 'Wish list', draw: drawWish },
  ],
}));
