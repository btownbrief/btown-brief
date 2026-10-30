/* story.js — The Paper's Story (wave 1, 2026-10-29): the mission and the
   story in a few words, and the ways to help.

     Mission          the line, and the creed under it
     How to use this  the lead's page (apps-2026-10/scroll-lessons.md §3),
                      word for word; Wire, Out and People link to their apps
     About            the About page
     Merch            merch.btownbrief.com
     Support          the support page
     How I live       Body's "How I do it" (a link the shell opens in Body) */

import * as app from '../app.js';
import { el, esc, ICON } from '../ui.js';
import { sectionBar } from '../sections.js';
import { APPS } from '../apps/index.js';
import * as P from './paper-core.js';

const KEY = 'story';
const SECS = [['mission', 'Mission'], ['howto', 'How to use this'], ['about', 'About'], ['merch', 'Merch'], ['support', 'Support'], ['howilive', 'How I live']];
/* Body's Coach tab, its "How I do it" (the shell opens a #link another app has in that app) */
const HOW = '#coach/how-i-do-it';
const S = { root: null, slots: {}, pending: null, ready: false };

/* an app's own folder, or a tab's #link (the shell opens it where it lives) */
const appLink = (id, label) => {
  const a = APPS.find((x) => x.id === id);
  const href = a ? new URL(a.href, document.baseURI).pathname + (app.demo ? '?demo=1' : '') : '#';
  return '<a href="' + esc(href) + '" data-app="' + esc(id) + '">' + esc(label) + '</a>';
};
const wire = '<a href="#wire" data-app="all-day">Wire</a>';

function buttons(host, list) {
  const m = el('div', 'pp-more');
  list.forEach((b) => m.appendChild(b));
  host.appendChild(m);
}

function draw() {
  const root = S.root;
  root.innerHTML = '';
  S.slots = {};
  const page = P.bind(el('div', 'pp pp-story'));

  const m = P.block(page, 'mission', 'Mission');
  m.querySelector('.sec').remove();
  m.appendChild(el('h1', 'pp-mission', esc(P.MISSION)));
  m.appendChild(el('p', 'pp-creed', esc(P.CREED)));
  S.slots.mission = m;

  /* word for word (Stephen's page via the lead, 2026-10-29) */
  const h = P.block(page, 'howto', 'How to use this');
  h.appendChild(el('p', '', esc('The Btown apps are a feed with no algorithm. I pick what\'s in them, and I pick it so that most of it ends ' +
    'with you out in Burlington. Here\'s the honest idea behind it. Scrolling usually does a job for us. It fills ' +
    'a bored minute or quiets a stressful one, and taking the feed away without replacing the job just sends ' +
    'your thumb somewhere worse. The best replacement anyone has found is other people, and the trouble with ' +
    'other people is that they\'re less convenient than a phone. So these apps try to make the local option the ' +
    'convenient one. Same thumb motion, pointed at your town.') + ' Scroll the ' + wire + esc(' when you want to catch up. Open ') +
    appLink('out', 'Out') + esc(' when you want to go somewhere. Open ') + appLink('people', 'People') +
    esc(' when you want company. If a tab doesn\'t end with you doing something real, tell me and I\'ll fix it.')));
  h.appendChild(el('p', 'pp-credit', '<em>' + esc('The idea that a habit is mostly anesthesia comes from the writer Chris Lakin.') + '</em>'));
  S.slots.howto = h;

  const a = P.block(page, 'about', 'About');
  buttons(a, [P.linkBtn('About me', P.LINKS.about, 'sm')]);
  S.slots.about = a;

  const me = P.block(page, 'merch', 'Merch');
  buttons(me, [P.linkBtn('The merch shop', P.LINKS.merch, 'sm')]);
  S.slots.merch = me;

  const su = P.block(page, 'support', 'Support');
  buttons(su, [P.linkBtn('Support the Brief', P.LINKS.support, 'sm')]);
  S.slots.support = su;

  const hl = P.block(page, 'howilive', 'How I live');
  const go = el('a', 'btn sm', esc('How I do it') + ' ' + ICON.right);
  go.href = HOW;
  go.dataset.howto = '1';
  buttons(hl, [go]);
  S.slots.howilive = hl;

  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}

function land() {
  const want = S.pending;
  if (!want || !S.ready || !S.root || !S.root.firstChild) return;
  S.pending = null;
  if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
  app.toast('That’s not in Story.');
}

app.register(KEY, {
  label: 'Story',
  icon: ICON.heart,
  promise: 'The mission, the story and the merch.',
  mount(root) {
    P.style();
    S.root = root;
    S.ready = true;
    draw();
    land();
  },
  activate(param) { S.pending = param || null; land(); },
  refresh() { if (S.ready && S.root) draw(); },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-paper-story', title: 'Story', color: '--app-paper-pop',
      find: (k) => S.slots[k], onPick: (k) => app.jumpTo(S.slots[k]),
      items: SECS.map(([k, label]) => ({ key: k, label })) });
  },
  keepSubnav: true,
  newSince() { return 0; },
});
