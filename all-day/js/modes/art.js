/* Art & Photos: one wall for both, votes, photo of the week, the ones that end
   up on a shirt, and a small board.

   Not built yet. Live, the tab states its promise; under ?demo=1 it shows the
   design prototype's screen on data/demo/art.json. The tab's own session
   replaces the demo branch with real data and keeps the contract. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON, art, mark, section, rail, chips, button } from '../ui.js';

const KEY = 'art';
let root = null, D = null, pending = null;
const S = { f: 'all' };
const loaded = app.demo ? app.demoData(KEY).then((d) => { D = d; app.know(d.wall); app.recount(); return d; }) : null;

const sec = (title, sub, key) => { const s = section(root, title, sub); s.dataset.sec = key; return s; };
const votes = (w) => (w.votes || 0) + store.voteCount(w.k);

function render() {
  root.innerHTML = '';
  const top = D.wall[0];
  const hero = el('div', 'hero');
  hero.dataset.k = top.k + '-hero';
  hero.innerHTML = '<span class="c-media r169">' + art(top.media) + '</span><span class="eyebrow">Photo of the week</span><h3>' + esc(top.text) + '</h3><p>by ' +
    esc(top.author) + ' · ' + votes(top) + ' votes. ' + esc(D.heroNote) + '</p>';
  const row = el('div', 'row');
  const up = button(ICON.up + ' Vote', store.hasVoted(top.k) ? '' : 'ghost', () => {
    app.toggleVote(top);
    up.classList.toggle('ghost', !store.hasVoted(top.k));
    app.toast(store.hasVoted(top.k) ? 'Voted' : 'Vote removed');
  });
  row.append(up, button(ICON.tee + ' Put it on a shirt', '', () => app.toast('Sends it to the Vintage tab’s tee queue')));
  hero.appendChild(row);
  root.appendChild(hero);

  sec('The wall', 'Photos and art, side by side. Vote with the arrow; tap to see it big.', 'wall');
  root.appendChild(chips(D.filters, S.f, (k) => { S.f = k; render(); }));
  const g = el('div', 'grid3');
  D.wall.forEach((w) => {
    const t = el('a', 'tile' + (w.tall ? ' tall' : ''));
    t.href = w.href;
    t.dataset.k = w.k;
    t.setAttribute('aria-label', w.text + ', by ' + w.author);
    t.innerHTML = art(w.media) + '<span class="ct">' + ICON.up + votes(w) + '</span>';
    t.addEventListener('click', (e) => { e.preventDefault(); app.lightbox(w); });
    g.appendChild(t);
  });
  root.appendChild(g);

  sec('Add yours', 'Photos and art from Burlington, by people who live here.', 'add');
  const tc = el('div', 'textcard', '<p>Upload, tick the consent box, and we look at it within a day. Winners run in the newsletter; a few end up on shirts, and the artist gets the first one.</p>');
  const r = el('div', 'row');
  r.append(button(ICON.plus + ' Add a photo', '', () => app.toast('Upload comes with the real build')), button(ICON.plus + ' Add art', 'ghost', () => app.toast('Upload comes with the real build')));
  tc.appendChild(r);
  root.appendChild(tc);

  sec('Community board', 'Models, easels, classes, studio space.', 'board');
  D.board.forEach((b) => {
    const rr = el('div', 'lrow');
    rr.innerHTML = '<span class="th bare">' + mark(b.who.split(' ·')[0], 'round lg') + '</span><div><div class="t">' + esc(b.title) + '</div><div class="s">' + esc(b.who) + '</div></div>';
    const x = el('button', 'pillbtn', 'Reply');
    x.addEventListener('click', () => app.toast('Replies need the email sign-in'));
    rr.appendChild(x);
    root.appendChild(rr);
  });

  sec('Winners', 'One a week since August.', 'winners');
  const r1 = rail(root);
  D.winners.forEach((w) => {
    const c = el('a', 'vcard w150');
    c.href = '#art/winners';
    c.innerHTML = '<span class="c-media r11">' + art(w.art) + '</span><span class="t">' + esc(w.week) + '</span><span class="s">' + esc(w.who) + '</span>';
    c.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens that week’s picture'); });
    r1.appendChild(c);
  });
  root.appendChild(el('div', 'spacer'));
}

function land() {
  if (!pending) return;
  const k = pending; pending = null;
  const s = root.querySelector('[data-sec="' + CSS.escape(k) + '"]');
  if (s) { app.jumpTo(s); return; }
  if (!app.flashHit(root, k)) app.toast('That picture has moved.');
}

app.register(KEY, {
  label: 'Art',
  icon: ICON.art,
  promise: 'Photos and art by people who live here, on one wall, voted on by the town.',
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
    return chips([['wall', 'The wall'], ['add', 'Add yours'], ['board', 'Board'], ['winners', 'Winners']]
      .map(([key, label]) => ({ key, label })), null, (k) => app.jumpTo(root.querySelector('[data-sec="' + k + '"]')));
  },
  newSince() { return D ? D.newSince || 0 : 0; },
});
