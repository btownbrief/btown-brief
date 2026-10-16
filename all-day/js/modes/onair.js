/* On Air: the Brief out loud, Btown TV's picks, live cams, every local
   podcast, and with the switch on Everything the wider shelf too. One player
   in the shell; it keeps going across tabs.

   Not built yet. Live, the tab states its promise; under ?demo=1 it shows the
   design prototype's screen on data/demo/onair.json. The tab's own session
   replaces the demo branch with real data and keeps the contract. The Local
   / Everything switch here is the shell's, shared with the Wire. */

import * as app from '../app.js';
import { el, esc, ICON, art, section, rail, chips, button, localSwitch, geo, setGeo } from '../ui.js';

const KEY = 'onair';
let root = null, D = null, pending = null;
const loaded = app.demo ? app.demoData(KEY).then((d) => {
  D = d;
  app.know([d.brief, ...d.tv, ...d.tvMore, ...d.cams, ...d.pods, ...d.podsMore, ...d.past]);
  app.recount();
  return d;
}) : null;

const sec = (title, sub, key) => { const s = section(root, title, sub); if (key) s.dataset.sec = key; return s; };

function vcard(v, w) {
  const c = el('a', 'vcard ' + w);
  c.href = v.href;
  c.dataset.k = v.k;
  c.innerHTML = '<span class="c-media r169">' + art(v.media) + '<span class="play">' + ICON.play + '</span>' + (v.dur ? '<span class="dur">' + esc(v.dur) + '</span>' : '') +
    (v.live ? '<span class="tag tag-live on-pic">Live</span>' : '') + '</span><span class="t">' + esc(v.title) + '</span><span class="s">' + esc(v.why || v.text || '') + '</span>';
  c.addEventListener('click', (e) => { e.preventDefault(); app.play(v); });
  return c;
}

function render() {
  root.innerHTML = '';
  const B = D.brief;
  sec('The Brief, out loud', 'Today’s newsletter, read to you.', 'brief');
  const au = el('div', 'audio');
  au.dataset.k = B.k;
  au.innerHTML = '<button class="pb" data-pk="' + esc(B.k) + '" aria-label="Play the Brief">' + ICON.play + '</button><div><div class="eyebrow">' + esc(B.when) + '</div><h3>' +
    esc(B.title) + '</h3><p>' + esc(B.text) + '</p></div>' +
    '<div class="wave" aria-hidden="true">' + Array.from({ length: 40 }, (_, i) => '<i style="height:' + (6 + Math.round(10 * Math.abs(Math.sin(i * 0.7)) + 8 * Math.abs(Math.cos(i * 0.3)))) + 'px"></i>').join('') + '</div>';
  au.querySelector('.pb').addEventListener('click', () => app.play(B));
  root.appendChild(au);

  const every = geo() === 'everything';
  sec(every ? 'Tonight, local and beyond' : 'Btown TV tonight', every
    ? 'The five local picks, then three from the wider shelf of ' + esc(D.channels) + ' channels.'
    : 'Five picks, each with a reason. The reason is the product.', 'tv');
  const r1 = rail(root);
  (every ? D.tv.concat(D.tvMore) : D.tv).forEach((v) => r1.appendChild(vcard(v, 'w250')));

  sec('Live', 'Ambient. A lake at night is not competing with anything.', 'live');
  const r2 = rail(root);
  D.cams.forEach((v) => r2.appendChild(vcard(v, 'w220')));

  sec(every ? 'Podcasts' : 'Local podcasts', every ? 'Every show made here, then the ones Burlington listens to most.' : 'Every show made here, newest episode first.', 'pods');
  (every ? D.pods.concat(D.podsMore) : D.pods).forEach((p) => {
    const r = el('div', 'lrow');
    r.dataset.k = p.k;
    r.innerHTML = '<span class="th">' + art(p.media) + '</span><div><div class="t">' + esc(p.show) + '</div><div class="s">' + esc(p.title) + ' · ' + esc(p.text) + '</div></div>';
    const b = el('button', 'pillbtn', ICON.play + ' ' + esc(p.dur));
    b.dataset.pk = p.k;
    b.dataset.label = p.dur;
    b.setAttribute('aria-label', 'Play ' + p.show);
    b.addEventListener('click', () => app.play(p));
    r.appendChild(b);
    root.appendChild(r);
  });
  root.appendChild(button('All ' + esc(D.showCount) + ' shows', 'ghost more', () => app.toast('The full list in the real build')));

  sec('Past nights', 'The nightly picks, kept for a month.', 'past');
  const r4 = rail(root);
  D.past.forEach((v) => r4.appendChild(vcard(v, 'w170')));
  root.appendChild(el('div', 'spacer'));
  app.paintPlayButtons();
}

function land() {
  if (!pending) return;
  const k = pending; pending = null;
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

app.register(KEY, {
  label: 'On Air',
  icon: ICON.onair,
  promise: 'The Brief read aloud, tonight’s Btown TV, live cams and every local podcast, in one player.',
  mount(r) {
    root = r;
    if (!app.demo) { app.promise(r, KEY); return; }
    r.innerHTML = '<p class="loading">Loading…</p>';
    loaded.then(() => { render(); if (app.activeTab() === KEY) app.paintSubnav(); land(); })
      .catch(() => { r.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b> Reload to try again.</div>'; });
  },
  activate(param) {
    if (param === 'local' || param === 'everything') {
      /* a link can set the shared switch: #onair/everything */
      setGeo(param);
      if (D && root) { app.paintSubnav(); render(); }
      return;
    }
    pending = param;
    if (D && root) land();
  },
  refresh() { if (D && root) { app.paintSubnav(); render(); } },
  deactivate() {},
  subnav() {
    if (!D || !root) return null;
    const band = el('div', 'toolband');
    band.appendChild(localSwitch(() => { app.paintSubnav(); render(); }));
    band.appendChild(chips([['brief', 'Out loud'], ['tv', 'Btown TV'], ['live', 'Live'], ['pods', 'Podcasts'], ['past', 'Past nights']]
      .map(([key, label]) => ({ key, label })), null, (k) => app.jumpTo(root.querySelector('[data-sec="' + k + '"]'))));
    return band;
  },
  newSince() { return D ? D.newSince || 0 : 0; },
});
