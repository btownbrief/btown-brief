/* Town · Alerts: what changed, and the city's day-to-day, from official
   sources only (APP-MAP.html, Town; ideas 6 and 7). Top to bottom:

   - Today. Four answers at a glance: the ban, schools, your recycling day
     and the next signup. What changed lives on the Now tab.
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
     the year-round places (data/town/shelters.json), and 2-1-1 for a bed
     tonight.
   - Signups. The next registration openings and deadlines from
     data/town/signups.json, soonest first. Only dates the program has
     published; last year's pattern is never shown as this year's. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON, divider } from '../ui.js';
import { townMode, getJSON, maybeJSON, NOT_LOADED, row, card, links, line, list, today, dayOf, fmtDay, ago, epoch, daysTo } from './town-kit.js';

const STREET_KEY = 'town-street';
const CLOSINGS = [
  { label: 'NBC5 closings', href: 'https://www.mynbc5.com/weather/closings' },
  { label: 'WCAX closings', href: 'https://www.wcax.com/weather/closings/' },
  { label: 'Burlington School District', href: 'https://www.bsdvt.org/' },
];

/* the long names programs carry, as a reader says them */
const ORG = { 'Burlington Parks, Recreation & Waterfront': 'City Parks', 'Burlington City Arts': 'BCA', 'Fletcher Free Library': 'The library',
  'Greater Burlington YMCA': 'The Y', 'Petra Cliffs Climbing Center & Mountaineering School': 'Petra Cliffs' };
const newestOf = (list, f) => list.reduce((m, x) => Math.max(m, epoch(f(x))), 0);

/* ---------------------------------------------------------------- Today */
/* the four answers first (ban, schools, your recycling day, the next
   signup), each opening its section; then the civic changes. News,
   events and r/burlington are other apps' feeds and stay on the full
   Since You Checked page. */
function glance(box, d, ctx) {
  const a = d.alerts.sections;
  const pb = a.parking_ban || {};
  const ban = (pb.items || [])[0];
  const cl = ((a.closings || {}).items || []).length;
  const mine = ctx.demo ? d.demoStreet : store.read(STREET_KEY, '');
  const hit = mine && ((a.recycling || {}).items || []).find((x) => x.street === mine);
  const su = signupsOf(d)[0];
  const g = el('div', 'plist');
  g.append(
    row({ k: 'at-ban', href: '#alerts/trash', icon: ICON.cone, title: ban ? ban.headline : 'No ban posted', sub: ban ? esc(ago(ban.posted)) : '', tag: pb.status === 'ban_announcement_posted' ? ['Ban', 'live'] : null }),
    row({ k: 'at-schools', href: '#alerts/schools', icon: ICON.book, title: cl ? cl + (cl === 1 ? ' school closing or delay' : ' school closings or delays') : 'Schools open, no delays', tag: cl ? ['Schools', 'live'] : null }),
    row({ k: 'at-recycling', href: '#alerts/trash', icon: ICON.calcheck, title: hit ? 'Recycling ' + hit.recycling_day : 'Your recycling day',
      sub: hit ? esc(mine + ' · ban zone ' + hit.parking_ban_zone) : esc('Add your street') }),
  );
  if (su) g.appendChild(row({ k: 'at-signup', href: '#alerts/signups', icon: ICON.calendar, title: su.p.name, sub: esc(su.what + ' ' + fmtDay(su.date)) }));
  box.appendChild(g);
}
function drawToday(box, d, ctx) { glance(box, d, ctx); }

/* ----------------------------------------------------- Trash & parking */
function drawTrash(box, d, ctx) {
  const a = d.alerts.sections;
  const rec = a.recycling || { items: [] };
  const streets = [...new Set(rec.items.map((r) => r.street))].sort();
  const form = el('div', 'textcard gap');
  form.dataset.k = 'street-lookup';
  form.innerHTML = '<h3>Your street</h3>';
  const r = el('div', 'row');
  const input = el('input', 'field');
  input.type = 'search';
  input.name = 'street';
  input.setAttribute('list', 'town-streets');
  input.setAttribute('aria-label', 'Your street');
  input.placeholder = 'Pine St';
  input.autocomplete = 'off';
  const dl = el('datalist');
  dl.id = 'town-streets';
  dl.innerHTML = streets.map((s) => '<option value="' + esc(s) + '">').join('');
  r.append(input, dl);
  form.appendChild(r);
  const out = el('div', 'plist');
  out.setAttribute('role', 'status');
  form.appendChild(out);
  box.appendChild(form);
  /* only the street's last word is its type: "St Paul St" keeps its saint */
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|place|pl|court|ct|terrace|ter|parkway|pkwy|circle|cir|way)\.?\s*$/, '').replace(/^saint\s+/, 'st ').replace(/[^a-z0-9]/g, '');
  function show(q, save) {
    out.innerHTML = '';
    const n = norm(q);
    if (!n) return;
    /* the name as typed first ("Pine St"), then the same name with any ending ("Pine Pl") */
    const typed = rec.items.filter((x) => x.street.toLowerCase() === String(q).trim().toLowerCase());
    const exact = typed.length ? typed : rec.items.filter((x) => norm(x.street) === n);
    const hits = exact.length ? exact : rec.items.filter((x) => norm(x.street).startsWith(n)).slice(0, 8);
    if (!hits.length) { out.appendChild(el('p', 'note', esc('No street by that name.'))); return; }
    const seen = new Set();
    hits.forEach((x) => {
      const key = x.street + x.recycling_day + x.parking_ban_zone;
      if (seen.has(key)) return;
      seen.add(key);
      out.appendChild(row({ k: 'st-' + norm(x.street) + '-' + seen.size, href: x.source_url || rec.source_url, icon: ICON.calcheck, title: x.street,
        sub: 'Recycling <b>' + esc(x.recycling_day || 'not listed') + '</b> · Parking-ban zone <b>' + esc(x.parking_ban_zone || '?') + '</b>' }));
    });
    if (exact.length > 1 && new Set(exact.map((x) => x.recycling_day + x.parking_ban_zone)).size > 1) {
      out.appendChild(el('p', 'note', esc('Split street: check the city’s map.')));
    }
    /* kept only when the name points at one street */
    if (save && exact.length && new Set(exact.map((x) => x.street)).size === 1 && !ctx.demo) store.write(STREET_KEY, exact[0].street);
  }
  input.addEventListener('input', () => show(input.value, true));
  const mine = ctx.demo ? (d.demoStreet || '') : store.read(STREET_KEY, '');
  if (mine) { input.value = mine; show(mine, false); }
  card(box, { k: 'trash-day', title: 'Trash day', paras: [esc('Recycling is weekly, out by 7 am. There’s no city trash day: your private hauler sets it.'),
    esc('No pickup on Memorial Day, July 4, Labor Day, Thanksgiving or Christmas.')],
  links: [{ label: 'The city’s map', href: rec.source_url && /webappviewer/.test(rec.source_url) ? rec.source_url : 'https://www.burlingtonvt.gov/315/Recycling-Solid-Waste-Collection' }, { label: 'Recycling rules', href: rec.rules_url }] });

  const pb = a.parking_ban || {};
  const ban = (pb.items || [])[0];
  const rules = pb.rules || {};
  const c = card(box, { k: 'parking-ban', title: 'Winter parking ban',
    paras: [ban ? '<b>' + esc(ban.headline) + '</b> · ' + esc(ago(ban.posted)) : esc('No ban posted.'),
      esc('Official word: the overhead lights, 802-658-SNOW and VT-Alert.')],
    links: [{ label: 'Winter parking', href: rules.source_url }, { label: 'VT-Alert texts', href: 'https://www.burlingtonvt.gov/btv-alerts' }] });
  if (ban) c.insertBefore(el('p', '', '<span class="tag tag-live">' + esc(ban.says_lifted ? 'Lifted' : 'Ban headline') + '</span>'), c.children[1]);
  const rl = [['When it’s called', rules.called_by], ['Hours', rules.hours], ['If you’re parked on the street', rules.penalty], ['Free garages', rules.free_garages], ['City lots', rules.surface_lots]].filter((x) => x[1]);
  const rb = el('div', 'plist');
  rl.forEach(([t, v], i) => rb.appendChild(row({ k: 'ban-rule-' + i, href: rules.source_url, title: t, sub: esc(v) })));
  box.appendChild(rb);

  const drop = ((a.dropoff || {}).items || [])[0];
  if (drop) card(box, { k: 'dropoff', title: drop.name, paras: [esc(drop.address + ' · ' + drop.hours), esc('Takes ' + drop.takes + '.')],
    links: [{ label: 'CSWD', href: drop.source_url }] });
}

/* ---------------------------------------------------------------- Plows */
function drawPlows(box, d) {
  const g = d.alerts.sections.greenway || { items: [] };
  card(box, { k: 'no-tracker', title: 'Burlington has no street plow tracker',
    links: [{ label: 'How the city plows', href: 'https://www.burlingtonvt.gov/610/Snowfighting-Program' }] });
  /* the layer sleeps from spring to the first snow: last winter's notes
     would read as today's, so out of season it is one line */
  const fresh = (g.items || []).some((s) => epoch(s.updated) > Date.now() / 1000 - 14 * 86400);
  if (!fresh) { line(box, 'The bike path’s plow status starts with the first snow.'); return; }
  list(box, (g.items || []).map((s, i) => row({ k: 'gw-' + i, href: s.source_url, icon: ICON.leaf, title: s.segment,
    sub: esc([s.notes, s.last_plowed ? 'Plowed ' + ago(s.last_plowed) : ''].filter(Boolean).join(' · ')),
    tag: s.plowed_in_winter_program ? null : ['Not plowed', 'left'] })), 6);
}

/* -------------------------------------------------------------- Schools */
function drawSchools(box, d) {
  const c = d.alerts.sections.closings || {};
  const items = (c.items || []).concat((c.district_posts || []).map((p) => ({ org: p.headline, status: 'District post', outlet: p.outlet, source_url: p.source_url, posted: p.posted })));
  if (!items.length) {
    card(box, { k: 'no-closings', title: 'No closings or delays', paras: [esc('As of ' + fmtDay(c.verified) + '.')], links: CLOSINGS });
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
  if (!(s.items || []).length) line(box, 'No warming or cooling announcements.');
  const st = (d.shelters && d.shelters.places) || [];
  list(box, st.map((p) => row({ k: 'shelter-' + p.id, href: p.source_url, icon: ICON.home, title: p.name, sub: esc([p.what, p.phone].filter(Boolean).join(' · ')) })), 8);
  card(box, { k: 'shelter-hand', paras: [esc('For a bed tonight, call 2-1-1.')],
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
  if (d.signups.failed) { line(box, NOT_LOADED); return; }
  if (!s.length) { line(box, 'No signups coming up.'); return; }
  list(box, s.map((x) => {
    const n = daysTo(x.date);
    return row({ k: 'su-' + x.p.id, href: x.p.page, date: x.date, title: x.p.name,
      sub: esc([x.what + ' ' + fmtDay(x.date), ORG[x.p.org] || x.p.org].filter(Boolean).join(' · ')),
      tag: n <= 3 ? [n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days', 'live'] : null });
  }), 8);
}

app.register('alerts', townMode({
  color: '--tf-food',
  key: 'alerts', label: 'Alerts', icon: 'bell', promise: 'Trash day, parking bans, plows and school delays.',
  demo: 'town-alerts',
  load: () => Promise.all([
    getJSON('../data/town/alerts.json'),
    maybeJSON('../data/town/signups.json'),
    getJSON('../data/town/shelters.json').catch(() => ({ places: [] })),
  ]).then(([alerts, signups, shelters]) => ({ alerts, signups, shelters })),
  sections: [
    { key: 'today', label: 'Today', draw: drawToday },
    { key: 'trash', label: 'Trash & parking', draw: drawTrash, newest: (d) => newestOf(d.alerts.sections.parking_ban.items || [], (e) => e.posted) },
    { key: 'plows', label: 'Plows', draw: drawPlows, newest: (d) => newestOf(d.alerts.sections.greenway.items || [], (e) => e.updated) },
    { key: 'schools', label: 'Schools', draw: drawSchools, newest: (d) => newestOf(d.alerts.sections.closings.items || [], () => d.alerts.sections.closings.verified + 'T12:00:00Z') },
    { key: 'shelters', label: 'Shelters', draw: drawShelters, newest: (d) => newestOf(d.alerts.sections.shelters.items || [], (e) => e.posted) },
    { key: 'signups', label: 'Signups', draw: drawSignups },
  ],
}));

