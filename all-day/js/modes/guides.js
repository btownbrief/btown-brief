/* Town · Guides: every town guide on one shelf (APP-MAP.html, Town; ideas
   5, 11, 14, 19, 20, 21, 29, 33 and 35). Top to bottom:

   - All guides. The City Guide's guide pages as rows that open the pages
     (beaches, hobbies, contractors, housing, history, volunteer, gifts),
     and the guides still to come on the Town Guides template.
   - New here. A first-30-days checklist, seeded from the staged November
     orientation kit (advisor/data/staged/2026-10-04/community-kits/
     orientation): the events calendar, recycling day and parking-ban zone,
     VT-Alert texts, a neighborhood walk, clubs, volunteering, the library,
     renters' rights. Ticks stay on this device only (and not in the demo).
   - Help, Childcare, Schools, Rent, Vets, Who to call and Wiki. Placeholders
     that name what will appear, each linking the page that covers part of
     it today where there is one. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON, divider } from '../ui.js';
import { townMode, row, card } from './town-kit.js';

const DONE_KEY = 'town-newhere';

/* the pages, in the order a new neighbor would want them */
const PAGES = [
  { id: 'housing', href: '../housing.html', icon: 'home', title: 'Find an apartment' },
  { id: 'contractors', href: '../contractors.html', icon: 'hand', title: 'Contractors and trades' },
  { id: 'volunteer', href: '../volunteer.html', icon: 'heart', title: 'Volunteer' },
  { id: 'beaches', href: '../beaches.html', icon: 'drop', title: 'Lake and beaches' },
  { id: 'hobbies', href: '../hobbies.html', icon: 'leaf', title: 'Vermont hobbies' },
  { id: 'history', href: '../history.html', icon: 'book', title: 'The short history of Burlington' },
  { id: 'gifts', href: '../gifts.html', icon: 'tag', title: 'The gift guide' },
];
const SOON = ['Restrooms', 'Playgrounds', 'Study spots', 'Teens', 'Dogs', 'Seniors', 'EV charging', 'Libraries'];

/* the first 30 days, from the orientation kit's four welcome notes */
const FIRST30 = [
  { id: 'calendar', title: 'Bookmark the events calendar', href: '../events.html' },
  { id: 'street', title: 'Look up your recycling day and parking-ban zone', href: '#alerts/trash' },
  { id: 'vtalert', title: 'Sign up for VT-Alert texts', href: 'https://www.burlingtonvt.gov/btv-alerts' },
  { id: 'walk', title: 'Walk a neighborhood with Btown Out Loud', href: '../out-loud/' },
  { id: 'clubs', title: 'Find a group you can just show up to', href: '../clubs.html' },
  { id: 'coffee', title: 'Come to Saturday coffee', href: 'https://www.meetup.com/burlington-social-activites-group/events/' },
  { id: 'volunteer', title: 'Volunteer once', href: '../volunteer.html' },
  { id: 'library', title: 'Get a library card', href: 'https://www.fletcherfree.org/' },
  { id: 'renting', title: 'Know where to look for a place', href: '../housing.html' },
  { id: 'history', title: 'Learn the town’s story', href: '../history.html' },
  { id: 'news', title: 'Pick your local news', href: '#guides/news' },
];

/* how to follow local news, from the r/vermont consensus Stephen shared on
   Oct 29: NBC5 for breaking news, VTDigger, Seven Days and Vermont Public
   for depth, free TV over an antenna or the station apps. Front Porch
   Forum stays out (his rule: never in reader copy). */
const NEWS = [
  { id: 'brief', title: 'The Btown Brief', sub: 'Monday and Friday, free', href: 'https://www.btownbrief.com/subscribe' },
  { id: 'nbc5', title: 'NBC5', sub: 'Breaking news', href: 'https://www.mynbc5.com/' },
  { id: 'vtdigger', title: 'VTDigger', sub: 'State politics, in depth', href: 'https://vtdigger.org/' },
  { id: 'sevendays', title: 'Seven Days', sub: 'Burlington news, food and arts; the Daily 7 email', href: 'https://www.sevendaysvt.com/' },
  { id: 'vpr', title: 'Vermont Public', sub: 'Radio and reporting', href: 'https://www.vermontpublic.org/' },
  { id: 'tv', title: 'Free local TV', sub: 'An antenna, or the WCAX and NBC5 apps', href: 'https://www.fcc.gov/media/engineering/dtvmaps' },
  { id: 'vtalert', title: 'VT-Alert', sub: 'Parking bans and emergencies, by text', href: 'https://www.burlingtonvt.gov/btv-alerts' },
];
const drawNews = (box) => NEWS.forEach((x) => box.appendChild(row({ k: 'news-' + x.id, href: x.href, icon: ICON.paper, title: x.title, sub: esc(x.sub) })));

const PLACEHOLDERS = [
  { key: 'help', label: 'Help', title: 'Benefits finder', paras: ['The help your household likely qualifies for, and where to apply.'],
    links: [{ label: 'Vermont 2-1-1', href: 'https://vermont211.org/' }] },
  { key: 'childcare', label: 'Childcare', title: 'Childcare finder', paras: ['Centers with openings, help paying, and your waitlists.'], links: [{ label: 'Signups in Alerts', href: '#alerts/signups' }] },
  { key: 'schools', label: 'Schools', title: 'School menus and allergens', paras: ['The lunch menu each week, with allergen alerts.'],
    links: [{ label: 'Closings in Alerts', href: '#alerts/schools' }] },
  { key: 'rent', label: 'Rent', title: 'True rent and your deposit', paras: ['What a place really costs, and a deposit checklist.'],
    links: [{ label: 'Find an apartment', href: '../housing.html' }] },
  { key: 'vets', label: 'Vets', title: 'Vets you can afford', paras: ['What vets cost, the low-cost clinics, and who’s open at night.'], links: [] },
  { key: 'whotocall', label: 'Who to call', title: 'Who do you call?', paras: ['The tradespeople readers trust, from a yearly survey.'],
    links: [{ label: 'Contractors and trades', href: '../contractors.html' }] },
  { key: 'wiki', label: 'Wiki', title: 'The local wiki', paras: ['Pages neighbors write and keep up.'], links: [] },
];

function drawAll(box) {
  PAGES.forEach((p) => box.appendChild(row({ k: 'guide-' + p.id, href: p.href, icon: ICON[p.icon] || ICON.book, title: p.title })));
  const soon = el('div', 'linkrow todaylinks');
  SOON.forEach((s) => soon.appendChild(el('span', 'chip', '<span>' + esc(s) + '</span>')));
  divider(box, 'Coming soon');
  box.appendChild(soon);
}

function drawNew(box, d, ctx) {
  const done = new Set(ctx.demo ? (d.newHereDone || []) : store.read(DONE_KEY, []));
  const count = el('p', 'note pad');
  const paint = () => { count.textContent = done.size + ' of ' + FIRST30.length + ' done'; };
  box.appendChild(count);
  FIRST30.forEach((x) => {
    const r = row({ k: 'new-' + x.id, href: x.href, icon: ICON.check, title: x.title });
    const b = el('button', 'btn sm ghost', done.has(x.id) ? 'Done' : 'Mark done');
    b.setAttribute('aria-pressed', done.has(x.id) ? 'true' : 'false');
    r.classList.toggle('done', done.has(x.id));
    b.addEventListener('click', () => {
      if (done.has(x.id)) done.delete(x.id); else done.add(x.id);
      const on = done.has(x.id);
      r.classList.toggle('done', on);
      b.textContent = on ? 'Done' : 'Mark done';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (!ctx.demo) store.write(DONE_KEY, [...done]);
      paint();
    });
    r.lastElementChild.replaceWith(b);
    box.appendChild(r);
  });
  paint();
}

const placeholder = (p) => (box) => card(box, { k: 'soon-' + p.key, title: p.title, paras: p.paras.map(esc), links: p.links, fine: 'Coming soon' });

app.register('guides', townMode({
  key: 'guides', label: 'Guides', icon: 'book', promise: 'Every town guide on one shelf, from restrooms to rent.',
  demo: 'town-guides',
  load: () => Promise.resolve({}),
  sections: [
    { key: 'all', label: 'All guides', draw: drawAll },
    { key: 'newhere', label: 'New here', sub: 'Your first 30 days', draw: drawNew },
    { key: 'news', label: 'Local news', draw: drawNews },
  ].concat(PLACEHOLDERS.map((p) => ({ key: p.key, label: p.label, draw: placeholder(p) }))),
}));
