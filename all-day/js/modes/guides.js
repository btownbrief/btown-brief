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
import { el, esc, ICON } from '../ui.js';
import { townMode, row, card, line } from './town-kit.js';

const DONE_KEY = 'town-newhere';

/* the pages, in the order a new neighbor would want them */
const PAGES = [
  { id: 'housing', href: '../housing.html', icon: 'home', title: 'Find an apartment', line: 'Every property manager in town, so you can call them directly, plus where else to look.' },
  { id: 'contractors', href: '../contractors.html', icon: 'hand', title: 'Contractors and trades', line: 'Licensed electricians, plumbers and gas installers, from the state’s rolls.' },
  { id: 'volunteer', href: '../volunteer.html', icon: 'heart', title: 'Volunteer', line: 'Help this week, sorted by the time you’ve got.' },
  { id: 'beaches', href: '../beaches.html', icon: 'drop', title: 'Lake and beaches', line: 'The five official beaches and the whole shore, with can-I-swim status.' },
  { id: 'hobbies', href: '../hobbies.html', icon: 'leaf', title: 'Vermont hobbies', line: 'Sugaring, swimming holes, ice fishing, disc golf, each with its local on-ramp.' },
  { id: 'history', href: '../history.html', icon: 'book', title: 'The short history of Burlington', line: 'Abenaki homeland to the public waterfront, in five minutes.' },
  { id: 'gifts', href: '../gifts.html', icon: 'tag', title: 'The gift guide', line: 'Specific things from local shops and makers.' },
];
const SOON = ['Restrooms', 'Playgrounds', 'Study spots', 'Teens', 'Dogs', 'Seniors', 'EV charging', 'Libraries'];

/* the first 30 days, from the orientation kit's four welcome notes */
const FIRST30 = [
  { id: 'calendar', title: 'Bookmark the events calendar', line: 'The fastest way to see what a normal week here looks like.', href: '../events.html' },
  { id: 'street', title: 'Look up your recycling day and parking-ban zone', line: 'Alerts, Trash & parking. Trash is your hauler’s day, not the city’s.', href: '#alerts/trash' },
  { id: 'vtalert', title: 'Sign up for VT-Alert texts', line: 'How the city tells you about a winter parking ban.', href: 'https://www.burlingtonvt.gov/btv-alerts' },
  { id: 'walk', title: 'Walk a neighborhood with Btown Out Loud', line: 'The Old North End, the South End, the Hill or Winooski, with short stories at each stop.', href: '../out-loud/' },
  { id: 'clubs', title: 'Find a group you can just show up to', line: 'Run clubs, board games, book clubs, pickup sports, choirs.', href: '../clubs.html' },
  { id: 'coffee', title: 'Come to Saturday coffee', line: 'The Brief’s weekly meetup. People come and go the whole time.', href: 'https://www.meetup.com/burlington-social-activites-group/events/' },
  { id: 'volunteer', title: 'Volunteer once', line: 'A good way to meet people who care about the same things you do.', href: '../volunteer.html' },
  { id: 'library', title: 'Get a library card', line: 'The Fletcher Free Library is free, warm and full of events all winter.', href: 'https://www.fletcherfree.org/' },
  { id: 'renting', title: 'Know where to look for a place', line: 'The property managers, and what to ask before you sign.', href: '../housing.html' },
  { id: 'history', title: 'Learn the town’s story', line: 'Five minutes, and the street names start to make sense.', href: '../history.html' },
  { id: 'brief', title: 'Get the Brief', line: 'The free Monday and Friday email about what’s on in Burlington.', href: 'https://www.btownbrief.com/subscribe' },
];

const PLACEHOLDERS = [
  { key: 'help', label: 'Help', title: 'Benefits finder', paras: ['A few questions about your household, then the help you likely qualify for: food, heat, health care, child care, rent, and the property tax credit, with where to apply.'],
    links: [{ label: 'Vermont 2-1-1', href: 'https://vermont211.org/' }] },
  { key: 'childcare', label: 'Childcare', title: 'Childcare finder', paras: ['Centers and home programs with openings, ages and the state’s help paying, plus a private tracker for the waitlists you’re on (kept on your phone).',
    'Signup windows for programs and camps are already in Alerts, Signups.'], links: [{ label: 'Signups in Alerts', href: '#alerts/signups' }] },
  { key: 'schools', label: 'Schools', title: 'School menus and allergens', paras: ['The district’s lunch menu, read weekly, with a text when a dish has an allergen you’ve picked. Delays and closings are in Alerts.'],
    links: [{ label: 'Closings in Alerts', href: '#alerts/schools' }] },
  { key: 'rent', label: 'Rent', title: 'True rent and your deposit', paras: ['A true-rent calculator (heat, parking, fees and the walk to work, not just the listed rent) and a move-in checklist that protects your deposit.'],
    links: [{ label: 'Find an apartment', href: '../housing.html' }] },
  { key: 'vets', label: 'Vets', title: 'Vets you can afford', paras: ['What a visit, shots and spaying cost around town, the low-cost clinics, and who takes emergencies at night.'], links: [] },
  { key: 'whotocall', label: 'Who to call', title: 'Who do you call?', paras: ['The plumber, the electrician, the landlord-tenant line: the names readers trust, from an annual survey. Until then, the state’s licensing rolls.'],
    links: [{ label: 'Contractors and trades', href: '../contractors.html' }] },
  { key: 'wiki', label: 'Wiki', title: 'The local wiki', paras: ['Pages residents write and keep up: the best sledding hill, which laundromat takes cards, what the noise downtown was last night.'], links: [] },
];

function drawAll(box) {
  PAGES.forEach((p) => box.appendChild(row({ k: 'guide-' + p.id, href: p.href, icon: ICON[p.icon] || ICON.book, title: p.title, sub: esc(p.line) })));
  const soon = el('div', 'linkrow todaylinks');
  SOON.forEach((s) => soon.appendChild(el('span', 'chip', '<span>' + esc(s) + '</span>')));
  box.appendChild(el('p', 'note pad', esc('Coming to the shelf, on one template')));
  box.appendChild(soon);
}

function drawNew(box, d, ctx) {
  const done = new Set(ctx.demo ? (d.newHereDone || []) : store.read(DONE_KEY, []));
  const count = el('p', 'note pad');
  const paint = () => { count.textContent = done.size + ' of ' + FIRST30.length + ' done. Ticks stay on this phone.'; };
  box.appendChild(count);
  FIRST30.forEach((x) => {
    const r = row({ k: 'new-' + x.id, href: x.href, icon: ICON.check, title: x.title, sub: esc(x.line) });
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
  line(box, 'Which neighborhood is right for you comes next.');
}

const placeholder = (p) => (box) => card(box, { k: 'soon-' + p.key, title: p.title, paras: p.paras.map(esc), links: p.links, fine: esc('Coming soon') });

app.register('guides', townMode({
  key: 'guides', label: 'Guides', icon: 'book', promise: 'Every town guide on one shelf, from restrooms to rent.',
  demo: 'town-guides',
  load: () => Promise.resolve({}),
  sections: [
    { key: 'all', label: 'All guides', draw: drawAll },
    { key: 'newhere', label: 'New here', sub: 'Your first 30 days', draw: drawNew },
  ].concat(PLACEHOLDERS.map((p) => ({ key: p.key, label: p.label, draw: placeholder(p) }))),
}));
