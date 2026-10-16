/* Vintage & custom tees: the shop guide, spotted posts that expire in three
   weeks, swaps, designs built on Printify, points for a giveaway (never a
   raffle).

   Not built yet. Live, the tab states its promise; under ?demo=1 it shows the
   design prototype's screen on data/demo/vintage.json. The tab's own session
   replaces the demo branch with real data and keeps the contract. */

import * as app from '../app.js';
import { el, esc, ICON, art, mark, section, rail, chips, button } from '../ui.js';

const KEY = 'vintage';
let root = null, D = null, pending = null;
const loaded = app.demo ? app.demoData(KEY).then((d) => { D = d; app.know(d.spotted); app.recount(); return d; }) : null;
const SHIRT = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M32 14 20 22 8 42l16 8-2 36h56l-2-36 16-8-12-20-12-8a18 18 0 0 1-36 0z"/></svg>';

const sec = (title, sub, key) => { const s = section(root, title, sub); s.dataset.sec = key; return s; };

function render() {
  root.innerHTML = '';
  sec('Spotted this week', 'Seen on a rack, posted by a reader. A post lasts three weeks, then it is gone.', 'spotted');
  const g = el('div', 'grid2');
  D.spotted.forEach((p) => {
    const w = el('div');
    const t = el('a', 'tile');
    t.href = p.href;
    t.dataset.k = p.k;
    t.innerHTML = art(p.media) + '<span class="ct">' + ICON.clock + ' ' + esc(p.days) + 'd left</span>';
    t.addEventListener('click', (e) => { e.preventDefault(); app.lightbox(p); });
    const [what, rest] = String(p.text).split(' · ');
    w.append(t, el('p', 'cap', '<b>' + esc(what) + '</b><br>' + esc(rest) + ' · ' + esc(p.author)));
    g.appendChild(w);
  });
  root.appendChild(g);
  const add = el('div', 'linkrow addrow');
  add.append(button(ICON.plus + ' Post a find', '', () => app.toast('Posting needs the email sign-in')));
  root.appendChild(add);

  sec('The shop guide', 'Every vintage shop in town, with hours we check.', 'shops');
  D.shops.forEach((s) => {
    const r = el('div', 'lrow');
    r.innerHTML = '<span class="th">' + art(s.art) + '</span><div><div class="t">' + esc(s.name) + '</div><div class="s">' + esc(s.hood) +
      ' · <span class="ok">open until ' + esc(s.until) + '</span> · ' + esc(s.tags) + '</div></div>';
    const b = el('button', 'pillbtn', ICON.pin + ' Map');
    b.addEventListener('click', () => app.toast('Opens the map'));
    r.appendChild(b);
    root.appendChild(r);
  });

  sec('Make a tee', 'Send a design, get a shirt.', 'tees');
  const tc = el('div', 'textcard', '<h3 class="serif">Your design, built on Printify, approved by Stephen.</h3><p>Email one or upload it. You get the mockup within a day. If it sells you get yours free; artists get shirts or credit, never cash commissions.</p>');
  const r3 = el('div', 'row');
  r3.append(button('Upload a design', '', () => app.toast('Upload comes with the real build')),
    button('Try one on a model', 'ghost', () => app.toast('Printify mockups on a model; selfie try-on later')));
  tc.appendChild(r3);
  root.appendChild(tc);
  const r1 = rail(root, 'pad-top');
  D.tees.forEach((t) => {
    const c = el('a', 'tee');
    c.href = '#vintage/tees';
    /* the shirt's colour is the fake product's, like a photograph's, so it
       rides in from the demo data rather than from the tokens */
    c.innerHTML = '<span class="c-media" style="--shirt:' + esc(t.shirt) + '"><span class="shirt">' + SHIRT + '</span><span class="design">' + art(t.art) + '</span></span>' +
      '<span class="t">' + esc(t.title) + '</span><span class="s">' + esc(t.by) + ' · ' + esc(D.teePrice) + '</span>';
    c.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the shirt in the merch shop'); });
    r1.appendChild(c);
  });
  root.appendChild(el('p', 'note pad', esc(D.designs) + ' designs so far. The ' + esc(D.coreDesigns) + ' in the core list are always in stock.'));

  sec('Swaps', 'Trade, don’t toss. Meet at the swap shelf on Pine.', 'swaps');
  D.swaps.forEach((s) => {
    const r = el('div', 'lrow');
    r.innerHTML = '<span class="th bare">' + mark(s.who.split(' ·')[0], 'round lg') + '</span><div><div class="t">' + esc(s.title) + '</div><div class="s">' + esc(s.who) + '</div></div>';
    const b = el('button', 'pillbtn', 'Offer');
    b.addEventListener('click', () => app.toast('Offers need the email sign-in'));
    r.appendChild(b);
    root.appendChild(r);
  });

  sec('Thrift points', 'Log a find, earn points, maybe win the month.', 'points');
  root.appendChild(el('div', 'stat', '<div><b>' + esc(D.points.mine) + '</b><span>your points</span></div><div><b>' + esc(D.points.finds) +
    '</b><span>finds logged</span></div><div><b>' + esc(D.points.daysToDraw) + '</b><span>days to the draw</span></div>'));
  root.appendChild(el('div', 'textcard gap', '<p>Points go into a monthly giveaway for a shirt and a shop credit. A giveaway, never a raffle: nobody pays to enter and no money changes hands.</p>'));
  root.appendChild(el('div', 'spacer'));
}

function land() {
  if (!pending) return;
  const k = pending; pending = null;
  const s = root.querySelector('[data-sec="' + CSS.escape(k) + '"]');
  if (s) { app.jumpTo(s); return; }
  if (!app.flashHit(root, k)) app.toast('That post has expired.');
}

app.register(KEY, {
  label: 'Vintage',
  icon: ICON.vintage,
  promise: 'Every vintage shop in town, what is on the racks this week, and tees designed by neighbors.',
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
    return chips([['spotted', 'Spotted'], ['shops', 'Shops'], ['tees', 'Make a tee'], ['swaps', 'Swaps'], ['points', 'Points']]
      .map(([key, label]) => ({ key, label })), null, (k) => app.jumpTo(root.querySelector('[data-sec="' + k + '"]')));
  },
  newSince() { return D ? D.newSince || 0 : 0; },
});
