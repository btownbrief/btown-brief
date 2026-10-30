/* paper-story.js — The Paper's Story (wave 1, 2026-10-29): the mission and
   the story in a few words, and the ways to help.

     Mission    the line, and the creed under it
     About      who makes this, and the About page
     Merch      the shop that carries the line (merch.btownbrief.com)
     Support    the support page, and the tip jar
     How I live Body's "How I do it" (a link the shell opens in Body)

   The facts are the ones the hub already states in public (the reader
   count, Mondays and Fridays, one guy and a dog); change them here. */

import * as app from '../app.js';
import { el, esc, ICON } from '../ui.js';
import { sectionBar } from '../sections.js';
import * as P from './paper-core.js';

const KEY = 'story';
const SECS = [['mission', 'Mission'], ['about', 'About'], ['merch', 'Merch'], ['support', 'Support'], ['howilive', 'How I live']];
const FACTS = {
  readers: '3,000+ neighbors read it, and 7 in 10 open every issue.',
  merch: '87 Burlington designs on tees, hoodies, totes and stickers.',
};
/* Body's Coach tab, its "How I do it" (the shell opens a #link another app has in that app) */
const HOW = '#coach/how-i-do-it';
const S = { root: null, slots: {}, facts: FACTS, pending: null, ready: false };

function para(host, html) { host.appendChild(el('p', '', html)); }

function draw() {
  const root = S.root;
  root.innerHTML = '';
  S.slots = {};
  const page = P.bind(el('div', 'pp pp-story'));

  const m = P.block(page, 'mission', 'Mission');
  m.querySelector('.sec').remove();
  m.appendChild(el('p', 'pp-dateline', '<span class="eyebrow">' + esc('The Btown Brief') + '</span>'));
  m.appendChild(el('h1', 'pp-mission', esc(P.MISSION)));
  m.appendChild(el('p', 'pp-creed', esc(P.CREED)));
  para(m, esc('So everything here is a way in: the news, twice a week, so you know your town; plans, clubs and people to go with; and the small projects that make the place better. ') +
    '<b>' + esc('Free, no account, no ads.') + '</b>');
  S.slots.mission = m;

  const a = P.block(page, 'about', 'About');
  para(a, esc('It really is just one guy in Burlington, a laptop and a dog. The Brief comes out Monday and Friday. ' + S.facts.readers));
  const am = el('div', 'pp-more');
  am.appendChild(P.linkBtn('About me', P.LINKS.about, 'sm'));
  am.appendChild(P.linkBtn('Read the Brief', P.LINKS.brief));
  a.appendChild(am);
  S.slots.about = a;

  const me = P.block(page, 'merch', 'Merch');
  para(me, esc('Wear the town. ' + S.facts.merch));
  const mm = el('div', 'pp-more');
  mm.appendChild(P.linkBtn('The merch shop', P.LINKS.merch, 'sm'));
  me.appendChild(mm);
  S.slots.merch = me;

  const su = P.block(page, 'support', 'Support');
  para(su, esc('Reader support keeps all of this free, with no ads. If it’s useful to you, chip in what it’s worth.'));
  const sm = el('div', 'pp-more');
  sm.appendChild(P.linkBtn('Support the Brief', P.LINKS.support, 'sm'));
  sm.appendChild(P.linkBtn('Buy me a coffee', 'https://ko-fi.com/btownbrief'));
  su.appendChild(sm);
  S.slots.support = su;

  const h = P.block(page, 'howilive', 'How I live');
  para(h, esc('The routine behind the newsletter: how I train, eat, rest and keep the habits, written down so you can borrow any of it.'));
  const hm = el('div', 'pp-more');
  const go = el('a', 'btn sm', esc('How I do it') + ' ' + ICON.right);
  go.href = HOW;
  go.dataset.howto = '1';
  hm.appendChild(go);
  h.appendChild(hm);
  S.slots.howilive = h;

  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}

let loading = null;
function load() {
  /* the demo can say its own facts; live, they are the ones above */
  if (!loading) loading = (app.demo ? P.demoPart('story').then((j) => { if (j && j.facts) S.facts = { ...FACTS, ...j.facts }; }).catch(() => {}) : Promise.resolve())
    .then(() => { S.ready = true; });
  return loading;
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
    load().then(() => { draw(); land(); });
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
