/* People: pick who you are here as, see plans open to strangers, mixers, the
   quiz that puts you in a group, and the directory. Rebuilt from scratch;
   Small Talk and Up For It are reference only.

   Not built yet. Live, the tab states its promise; under ?demo=1 it shows the
   design prototype's screen on data/demo/people.json. The tab's own session
   replaces the demo branch with real data and keeps the contract. */

import * as app from '../app.js';
import { el, esc, ICON, mark, section, chips, button, cards, put } from '../ui.js';

const KEY = 'people';
let root = null, D = null, pending = null;
const S = { arch: null };
const loaded = app.demo ? app.demoData(KEY).then((d) => { D = d; app.know(d.plans); app.know(d.mixers); app.recount(); return d; }) : null;

const sec = (title, sub, key) => { const s = section(root, title, sub); s.dataset.sec = key; return s; };
const feed = () => { const f = el('div', 'feed'); root.appendChild(f); return f; };

function render() {
  root.innerHTML = '';
  sec('Who are you here as?', 'Pick one. It changes what you see first and who sees you.', 'arch');
  const grid = el('div', 'arch');
  D.archetypes.forEach((a) => {
    const b = el('button', S.arch === a.key ? 'on' : '', (ICON[a.icon] || '') + '<div><b>' + esc(a.name) + '</b><span>' + esc(a.line) + '</span></div>');
    b.setAttribute('aria-pressed', S.arch === a.key ? 'true' : 'false');
    b.addEventListener('click', () => { S.arch = S.arch === a.key ? null : a.key; render(); if (S.arch) app.toast('You’re here as ' + a.name.toLowerCase() + '.'); });
    grid.appendChild(b);
  });
  root.appendChild(grid);

  sec('Open to strangers this week', 'Real plans from real people. Say you’d go and the host hears about it.', 'plans');
  const f1 = feed();
  const mine = S.arch ? (D.archetypes.find((a) => a.key === S.arch) || {}).name : null;
  const plans = mine ? D.plans.slice().sort((a, b) => (b.arch === mine) - (a.arch === mine)) : D.plans;
  plans.forEach((p) => put(f1, cards.person(p)));
  app.bindFeed(f1);

  sec('Mixers', 'One a week, each for one kind of person. Becomes a Meetup event the moment ten say yes.', 'mix');
  const f2 = feed();
  D.mixers.forEach((m) => put(f2, cards.event(m)));
  app.bindFeed(f2);

  sec('The quiz', '', 'quiz');
  const tc = el('div', 'textcard', '<h3 class="serif">Three minutes, then your people.</h3><p>Eight questions. We put you in a group chat with six people who answered like you, and one plan to meet in the next two weeks.</p>');
  const r = el('div', 'row');
  r.append(button('Take the quiz', '', () => app.toast('The quiz comes with the real build')), el('span', 'fine', 'Sign in by email to join a chat.'));
  tc.appendChild(r);
  root.appendChild(tc);

  sec('The directory', esc(D.directoryCount) + ' people. Sign in to see them all and to be seen.', 'dir');
  const g = el('div', 'grid2 dir');
  D.directory.forEach((p) => g.appendChild(el('div', 'lrow', mark(p.name, 'round lg') + '<div><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(p.arch) + '</div></div>')));
  root.appendChild(g);
  root.appendChild(el('div', 'spacer'));
}

function land() {
  if (!pending) return;
  const k = pending; pending = null;
  if (!app.flashHit(root, k)) app.toast('That plan has passed.');
}

app.register(KEY, {
  label: 'People',
  icon: ICON.people,
  promise: 'Find your people: say who you are here as, and say yes to a plan with strangers.',
  mount(r) {
    root = r;
    if (!app.demo) { app.promise(r, KEY); return; }
    r.innerHTML = '<p class="loading">Loading…</p>';
    loaded.then(() => { render(); if (app.activeTab() === KEY) app.paintSubnav(); land(); })
      .catch(() => { r.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b> Reload to try again.</div>'; });
  },
  activate(param) { pending = param; if (D && root) land(); },
  refresh() { if (D && root) render(); },
  deactivate() {},
  subnav() {
    if (!D || !root) return null;
    return chips([['arch', 'Who you are'], ['plans', 'Open to strangers'], ['mix', 'Mixers'], ['quiz', 'The quiz'], ['dir', 'Directory']]
      .map(([key, label]) => ({ key, label })), null, (k) => app.jumpTo(root.querySelector('[data-sec="' + k + '"]')));
  },
  newSince() { return D ? D.newSince || 0 : 0; },
});
