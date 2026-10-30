/* Town · Alerts: what changed, and the city's day-to-day, from official
   sources only (APP-MAP.html, Town; ideas 6 and 7). Top to bottom:

   - Today. Since You Checked's change log (data/changes/changes.json, the
     same file changes.html reads), newest first: agendas posted, road and
     transit changes, weather alerts, new events, breaking news. Nothing
     here is fetched twice; the weather alerts come from that log too.
   - Trash & parking. Type your street and get its recycling day and its
     winter parking-ban zone, from the city's layer behind "Find Your
     Recycling Day" (433 segments, data/town/alerts.json). Trash is private
     haulers, so there is no city trash day, and the page says so. Then the
     parking-ban headline as the city posted it (never "there is a ban":
     the lights, 802-658-SNOW and VT-Alert are the official word), the ban
     rules, and the Pine St drop-off hours. The street is remembered on
     this device only.
   - Plows. The five Greenway (bike path) segments, the only live plow
     source, and the plain line that the city has no street plow tracker.
   - Schools. Closings and delays from the NBC5 and WCAX parsers and the
     district's own posts; when there are none, it says none, as of when.
   - Shelters. Any warming or cooling announcement from the city's feeds,
     the year-round places (data/town/shelters.json), and the line that
     cold-snap openings are checked by hand.
   - Signups. The next registration openings and deadlines from
     data/town/signups.json, soonest first. Only dates the program has
     published; last year's pattern is never shown as this year's. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON } from '../ui.js';
import { townMode, getJSON, row, card, links, line, list, today, dayOf, fmtDay, ago, epoch, daysTo } from './town-kit.js';

const STREET_KEY = 'town-street';
const CAT = { news: 'News', events: 'New event', chatter: 'r/burlington', cityhall: 'City Hall', roads: 'Roads', food: 'Food', weather: 'Weather', beaches: 'Beaches', transit: 'Transit', police: 'Police' };
const CLOSINGS = [
  { label: 'NBC5 closings', href: 'https://www.mynbc5.com/weather/closings' },
  { label: 'WCAX closings', href: 'https://www.wcax.com/weather/closings/' },
  { label: 'Burlington School District', href: 'https://www.bsdvt.org/' },
];

const newestOf = (list, f) => list.reduce((m, x) => Math.max(m, epoch(f(x))), 0);

/* ---------------------------------------------------------------- Today */
function drawToday(box, d) {
  const ev = ((d.changes && d.changes.events) || []).slice().sort((a, b) => epoch(b.ts) - epoch(a.ts));
  if (!ev.length) { line(box, 'Nothing has changed since the last check.'); return; }
  const rows = ev.map((e, i) => row({ k: 'chg-' + i + '-' + epoch(e.ts), href: e.url || '../changes.html', title: e.headline,
    sub: esc([...new Set([CAT[e.category] || e.category, e.detail, e.sourceName, ago(e.ts)].filter(Boolean))].join(' · ')),
    tag: e.category === 'weather' ? ['Weather', 'live'] : null }));
  list(box, rows, 12);
  box.appendChild(links([{ label: 'Since You Checked, the full page', href: '../changes.html' }]));
}

/* ----------------------------------------------------- Trash & parking */
function drawTrash(box, d, ctx) {
  const a = d.alerts.sections;
  const rec = a.recycling || { items: [] };
  const streets = [...new Set(rec.items.map((r) => r.street))].sort();
  const form = el('div', 'textcard gap');
  form.dataset.k = 'street-lookup';
  form.innerHTML = '<h3>Your street</h3><p>Recycling day and parking-ban zone, from the city’s own map.</p>';
  const r = el('div', 'row');
  const input = el('input', 'field');
  input.type = 'search';
  input.name = 'street';
  input.setAttribute('list', 'town-streets');
  input.setAttribute('aria-label', 'Your street');
  input.placeholder = 'Start typing a street, like Pine St';
  input.autocomplete = 'off';
  const dl = el('datalist');
  dl.id = 'town-streets';
  dl.innerHTML = streets.map((s) => '<option value="' + esc(s) + '">').join('');
  r.append(input, dl);
  form.appendChild(r);
  const out = el('div', 'plist');
  form.appendChild(out);
  box.appendChild(form);
  const norm = (s) => String(s || '').toLowerCase().replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|place|pl|court|ct|terrace|ter)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
  function show(q, save) {
    out.innerHTML = '';
    const n = norm(q);
    if (!n) return;
    const exact = rec.items.filter((x) => norm(x.street) === n);
    const hits = exact.length ? exact : rec.items.filter((x) => norm(x.street).startsWith(n)).slice(0, 8);
    if (!hits.length) { out.appendChild(el('p', 'note', esc('No street by that name on the city’s map. Try the first word only, or use the city’s map.'))); return; }
    const seen = new Set();
    hits.forEach((x) => {
      const key = x.street + x.recycling_day + x.parking_ban_zone;
      if (seen.has(key)) return;
      seen.add(key);
      out.appendChild(row({ k: 'st-' + norm(x.street) + '-' + seen.size, href: x.source_url || rec.source_url, icon: ICON.calcheck, title: x.street,
        sub: 'Recycling <b>' + esc(x.recycling_day || 'not listed') + '</b> · Parking-ban zone <b>' + esc(x.parking_ban_zone || '?') + '</b>' }));
    });
    if (exact.length > 1 && new Set(exact.map((x) => x.recycling_day + x.parking_ban_zone)).size > 1) {
      out.appendChild(el('p', 'note', esc('This street is split between days or zones, and the city’s layer has no house numbers. Check your block on the city’s map.')));
    }
    if (save && exact.length && !ctx.demo) store.write(STREET_KEY, exact[0].street);
  }
  input.addEventListener('input', () => show(input.value, true));
  const mine = ctx.demo ? (d.demoStreet || '') : store.read(STREET_KEY, '');
  if (mine) { input.value = mine; show(mine, false); }
  card(box, { k: 'trash-day', title: 'Trash day', paras: [esc('Burlington collects recycling weekly, in the blue cart, out by 7 am. Trash is picked up by private haulers, so there is no city trash day: your hauler sets it.'),
    esc('No pickup on Memorial Day, July 4, Labor Day, Thanksgiving or Christmas.')],
  links: [{ label: 'The city’s recycling map', href: rec.source_url && /webappviewer/.test(rec.source_url) ? rec.source_url : 'https://www.burlingtonvt.gov/315/Recycling-Solid-Waste-Collection' }, { label: 'Recycling rules', href: rec.rules_url }],
  fine: esc('The city last edited this layer in ' + (rec.layer_last_edited || 'an earlier year').slice(0, 4) + '. Checked ' + fmtDay(rec.verified) + '.') });

  const pb = a.parking_ban || {};
  const ban = (pb.items || [])[0];
  const rules = pb.rules || {};
  const c = card(box, { k: 'parking-ban', title: 'Winter parking ban',
    paras: ban ? ['<b>' + esc(ban.headline) + '</b> (' + esc(ban.channel || 'the city') + ', ' + esc(ago(ban.posted)) + ')' + (ban.says_lifted ? '. It says the ban is lifted.' : '.'),
      esc('That is the city’s headline. The ban itself is the overhead lights, 802-658-SNOW and VT-Alert texts.')]
      : [esc('No parking-ban headline from the city in the last three days. The official word is the overhead lights, 802-658-SNOW and VT-Alert texts, which a script can’t read, so check those on a snowy night.')],
    links: [{ label: 'Winter parking rules', href: rules.source_url }, { label: 'Get VT-Alert texts', href: 'https://www.burlingtonvt.gov/btv-alerts' }],
    fine: esc('Checked ' + fmtDay(pb.verified) + '.') });
  if (ban) c.insertBefore(el('p', '', '<span class="tag tag-live">' + esc(ban.says_lifted ? 'Lifted' : 'Ban headline') + '</span>'), c.children[1]);
  const rl = [['When it’s called', rules.called_by], ['Hours', rules.hours], ['If you’re parked on the street', rules.penalty], ['Free garages', rules.free_garages], ['City lots', rules.surface_lots]].filter((x) => x[1]);
  const rb = el('div', 'plist');
  rl.forEach(([t, v], i) => rb.appendChild(row({ k: 'ban-rule-' + i, href: rules.source_url, title: t, sub: esc(v) })));
  box.appendChild(rb);

  const drop = ((a.dropoff || {}).items || [])[0];
  if (drop) card(box, { k: 'dropoff', title: drop.name, paras: [esc(drop.address + ' · ' + drop.hours), esc('Takes ' + drop.takes + '.')].concat(drop.district_notice ? [esc(drop.district_notice)] : []),
    links: [{ label: 'CSWD', href: drop.source_url }], fine: esc('Checked ' + fmtDay(drop.verified) + '.') });
}

/* ---------------------------------------------------------------- Plows */
function drawPlows(box, d) {
  const g = d.alerts.sections.greenway || { items: [] };
  card(box, { k: 'no-tracker', title: 'Burlington has no street plow tracker',
    paras: [esc('The city doesn’t publish where its plows are. DPW tried truck tracking last winter, but it isn’t a public feed. The one live plow source is Parks’ status for the bike path, below.')],
    links: [{ label: 'How the city plows', href: 'https://www.burlingtonvt.gov/610/Snowfighting-Program' }] });
  const rows = (g.items || []).map((s, i) => row({ k: 'gw-' + i, href: s.source_url, icon: ICON.leaf, title: s.segment,
    sub: esc([s.notes, s.last_plowed ? 'Last plowed ' + fmtDay(dayOf(s.last_plowed)) : 'No plow date yet'].filter(Boolean).join(' · ')),
    tag: s.plowed_in_winter_program ? ['Plowed in winter', 'local'] : ['Not plowed', 'left'] }));
  if (rows.length) list(box, rows, 6);
  line(box, 'The bike path’s status wakes up with the first snow. Checked ' + fmtDay(g.verified) + '.');
}

/* -------------------------------------------------------------- Schools */
function drawSchools(box, d) {
  const c = d.alerts.sections.closings || {};
  const items = (c.items || []).concat((c.district_posts || []).map((p) => ({ org: p.headline, status: 'District post', outlet: p.outlet, source_url: p.source_url, posted: p.posted })));
  if (!items.length) {
    card(box, { k: 'no-closings', title: 'No closings or delays', paras: [esc('Nothing for Burlington-area schools on NBC5’s or WCAX’s lists, and nothing from the district, as of ' + fmtDay(c.verified) + '.'),
      esc('The district’s own call or ParentSquare message is the official word. The TV lists pass it on.')], links: CLOSINGS });
    return;
  }
  list(box, items.map((x, i) => row({ k: 'close-' + i, href: x.source_url, icon: ICON.bell, title: x.org, sub: esc([x.outlet, x.posted ? ago(x.posted) : ''].filter(Boolean).join(' · ')),
    tag: [x.status || 'Closed', 'live'] })), 10);
  box.appendChild(links(CLOSINGS));
}

/* ------------------------------------------------------------- Shelters */
function drawShelters(box, d) {
  const s = d.alerts.sections.shelters || {};
  (s.items || []).forEach((x, i) => box.appendChild(row({ k: 'shelter-news-' + i, href: x.source_url, icon: ICON.bell, title: x.headline, sub: esc([x.channel, ago(x.posted)].filter(Boolean).join(' · ')), tag: ['Posted', 'live'] })));
  if (!(s.items || []).length) line(box, 'No warming or cooling announcements from the city in the last two weeks.');
  const st = (d.shelters && d.shelters.places) || [];
  list(box, st.map((p) => row({ k: 'shelter-' + p.id, href: p.source_url, icon: ICON.home, title: p.name, sub: esc([p.what, p.phone].filter(Boolean).join(' · ')) })), 8);
  card(box, { k: 'shelter-hand', paras: [esc('Warming and cooling openings during a cold snap or a heat wave often go out only on social media, from COTS or through 2-1-1. Those are checked by hand. Call 2-1-1 or COTS at 802-864-7402 to confirm a bed.')],
    links: [{ label: 'Vermont 2-1-1', href: 'https://vermont211.org/' }, { label: 'COTS', href: 'https://www.cotsonline.org/' }] });
}

/* -------------------------------------------------------------- Signups */
function signupsOf(d) {
  const t = today();
  const out = [];
  ((d.signups && d.signups.programs) || []).forEach((p) => {
    if (p.date_basis !== 'published') return;
    if (p.next_opens && p.next_opens >= t) out.push({ p, date: p.next_opens, what: 'Opens' });
    else if (p.next_deadline && p.next_deadline >= t) out.push({ p, date: p.next_deadline, what: p.next_opens && p.next_opens <= t ? 'Open now, closes' : 'Deadline' });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
function drawSignups(box, d) {
  const s = signupsOf(d);
  if (!s.length) { line(box, 'No published registration dates coming up right now.'); return; }
  list(box, s.map((x) => {
    const n = daysTo(x.date);
    return row({ k: 'su-' + x.p.id, href: x.p.page, date: x.date, title: x.p.name,
      sub: esc([x.what + ' ' + fmtDay(x.date), x.p.org, x.p.season].filter(Boolean).join(' · ')),
      tag: n <= 3 ? [n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days', 'live'] : null });
  }), 8);
  line(box, 'Only dates a program has published. Camps and leagues that haven’t posted yet show up here when they do.');
}

app.register('alerts', townMode({
  key: 'alerts', label: 'Alerts', icon: 'bell', promise: 'Trash day, parking bans, plows and school delays.',
  demo: 'town-alerts',
  load: () => Promise.all([
    getJSON('../data/changes/changes.json').catch(() => ({ events: [] })),
    getJSON('../data/town/alerts.json'),
    getJSON('../data/town/signups.json').catch(() => ({ programs: [] })),
    getJSON('../data/town/shelters.json').catch(() => ({ places: [] })),
  ]).then(([changes, alerts, signups, shelters]) => ({ changes, alerts, signups, shelters })),
  sections: [
    { key: 'today', label: 'Today', sub: 'What changed in Burlington, newest first', draw: drawToday, newest: (d) => newestOf((d.changes && d.changes.events) || [], (e) => e.ts) },
    { key: 'trash', label: 'Trash & parking', draw: drawTrash, newest: (d) => newestOf(d.alerts.sections.parking_ban.items || [], (e) => e.posted) },
    { key: 'plows', label: 'Plows', draw: drawPlows, newest: (d) => newestOf(d.alerts.sections.greenway.items || [], (e) => e.updated) },
    { key: 'schools', label: 'Schools', draw: drawSchools, newest: (d) => newestOf(d.alerts.sections.closings.items || [], () => d.alerts.sections.closings.verified + 'T12:00:00Z') },
    { key: 'shelters', label: 'Shelters', draw: drawShelters, newest: (d) => newestOf(d.alerts.sections.shelters.items || [], (e) => e.posted) },
    { key: 'signups', label: 'Signups', sub: 'Registration openings and deadlines', draw: drawSignups },
  ],
}));

