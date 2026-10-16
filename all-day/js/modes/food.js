/* Food: restaurants in their own words, menus one tap away, deals, recipes.
   We feature, we don't review.

   Not built yet. Live, the tab states its promise; under ?demo=1 it shows the
   design prototype's screen on data/demo/food.json. The tab's own session
   replaces the demo branch with real data and keeps the contract. */

import * as app from '../app.js';
import { el, esc, ICON, art, section, rail, chips, button } from '../ui.js';

const KEY = 'food';
let root = null, D = null, pending = null;
const S = { f: 'open', deal: 0 };
const loaded = app.demo ? app.demoData(KEY).then((d) => { D = d; app.know(d.videos); app.recount(); return d; }) : null;

const sec = (title, sub, key) => { const s = section(root, title, sub); s.dataset.sec = key; return s; };

function render() {
  root.innerHTML = '';
  const hero = el('div', 'hero');
  hero.innerHTML = '<span class="c-media r169">' + art(D.hero.art) + '</span><span class="eyebrow">' + esc(D.hero.eyebrow) + '</span>' +
    '<h3>' + esc(D.hero.title) + '</h3><p>' + esc(D.hero.text) + '</p>';
  const row = el('div', 'row');
  row.append(button('Menu ' + ICON.ext, '', () => app.toast('Opens the menu, one tap, in the real build')),
    button('Order ' + ICON.ext, 'ghost', () => app.toast('Opens the restaurant’s own ordering')),
    button('Directions', 'ghost', () => app.toast('Opens the map')));
  hero.appendChild(row);
  root.appendChild(hero);

  const label = (D.filters.find((f) => f.key === S.f) || D.filters[0]).label;
  sec(S.f === 'open' ? 'Open now near ' + D.near : label, esc(S.f === 'recipes' ? D.recipe.sub : D.placesNote), 'list');
  if (S.f === 'recipes') {
    const tc = el('div', 'textcard', '<h3 class="serif">' + esc(D.recipe.title) + '</h3><p>' + esc(D.recipe.text) + '</p>');
    const r = el('div', 'row');
    r.append(button('Read it ' + ICON.ext, 'ghost', () => app.toast('Opens the recipe')));
    tc.appendChild(r);
    root.appendChild(tc);
  } else if (S.f !== 'deals') {
    D.places.filter((p) => p.tags.includes(S.f)).forEach((p) => {
      const r = el('div', 'lrow');
      r.innerHTML = '<span class="th">' + art(p.art) + '</span><div><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(p.cuisine) + ' · ' + esc(p.dist) +
        ' · <span class="ok">open until ' + esc(p.until) + '</span> · ' + esc(p.price) + '</div></div>';
      const b = el('button', 'pillbtn', 'Menu');
      b.addEventListener('click', () => app.toast('The menu, one tap, in the real build'));
      r.appendChild(b);
      root.appendChild(r);
    });
  }

  sec('Deals this week', esc(D.dealsNote), 'deals');
  const deck = el('div', 'deck');
  const paint = () => {
    const d = D.deals[S.deal];
    deck.innerHTML = art(d.art) + '<div class="segs">' + D.deals.map((_, i) => '<i class="' + (i <= S.deal ? 'on' : '') + '"></i>').join('') + '</div>' +
      '<div class="body"><div class="eyebrow">' + esc(d.checked) + '</div><h3>' + esc(d.title) + '</h3><p>' + esc(d.place) + '</p><div class="row"></div></div>' +
      '<button class="hit l" aria-label="Previous deal"></button><button class="hit r" aria-label="Next deal"></button>';
    deck.querySelector('.row').append(button('Directions', 'ghost sm', () => app.toast('Opens the map')), button('Save', 'ghost sm', () => app.toast('Saved the deal')));
    deck.querySelector('.hit.l').addEventListener('click', () => { S.deal = (S.deal + D.deals.length - 1) % D.deals.length; paint(); });
    deck.querySelector('.hit.r').addEventListener('click', () => { S.deal = (S.deal + 1) % D.deals.length; paint(); });
  };
  paint();
  root.appendChild(deck);

  sec('In their own words', 'Short videos from the kitchens themselves. No voiceover from us.', 'vids');
  const r4 = rail(root);
  D.videos.forEach((v) => {
    const c = el('a', 'vcard vert');
    c.href = v.href;
    c.dataset.k = v.k;
    c.innerHTML = '<span class="c-media">' + art(v.media) + '<span class="play">' + ICON.play + '</span></span><span class="t">' + esc(v.title) + '</span><span class="s">' + esc(v.text) + '</span>';
    c.addEventListener('click', (e) => { e.preventDefault(); app.play(v); });
    r4.appendChild(c);
  });

  sec('Feature a dish', 'What should the town taste next?', 'add');
  const tc = el('div', 'textcard', '<h3 class="serif">We feature, we don’t review.</h3><p>Add a dish you would tell a friend about. No stars, no scores, no negatives. For the full picture there is a Google link on every place.</p>');
  const r5 = el('div', 'row');
  r5.append(button('Add a dish', '', () => app.toast('Needs the email sign-in. That comes with the real build.')), el('span', 'fine', esc(D.featuredCount) + ' dishes featured by readers this fall'));
  tc.appendChild(r5);
  root.appendChild(tc);
  root.appendChild(el('div', 'spacer'));
}

function setFilter(k) {
  if (!D.filters.some((f) => f.key === k)) return false;
  S.f = k;
  app.paintSubnav();
  render();
  return true;
}

function land() {
  if (!pending) return;
  const k = pending; pending = null;
  if (setFilter(k)) { app.jumpTo(root.querySelector('[data-sec="list"]')); return; }
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

app.register(KEY, {
  label: 'Food',
  icon: ICON.food,
  promise: 'Restaurants in their own words, menus one tap away, and the deals worth crossing town for.',
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
    return chips(D.filters, S.f, (k) => { setFilter(k); app.jumpTo(root.querySelector('[data-sec="list"]')); });
  },
  newSince() { return D ? D.newSince || 0 : 0; },
});
