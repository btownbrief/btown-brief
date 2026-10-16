/* Watch: movies and TV for a couple and for the town. Trailers, the list, a
   shared log (two dots: you, them), town ratings, a vote that becomes a
   screening.

   Not built yet. Live, the tab states its promise; under ?demo=1 it shows the
   design prototype's screen on data/demo/watch.json. The tab's own session
   replaces the demo branch with real data and keeps the contract. */

import * as app from '../app.js';
import { el, esc, safeHref, ICON, art, section, rail, chips, pills, button } from '../ui.js';

const KEY = 'watch';
let root = null, D = null, pending = null;
const S = { who: 'us', voted: null, filter: 'all' };
const loaded = app.demo ? app.demoData(KEY).then((d) => { D = d; app.recount(); return d; }) : null;

const sec = (title, sub, key, right) => { const s = section(root, title, sub, right); s.dataset.sec = key; return s; };

function poster(f, o = {}) {
  const a = el('a', 'poster');
  a.href = safeHref(f.href);
  a.dataset.k = f.k;
  a.innerHTML = '<span class="c-media">' + art(f.art) +
    (o.trailer ? '<span class="play">' + ICON.play + '</span><span class="dur">' + esc(f.dur) + '</span>' : '') +
    (o.seen ? '<span class="seen"><i class="' + (f.me ? 'on' : '') + '"></i><i class="' + (f.them ? 'on' : '') + '"></i></span><span class="rate">' + esc(f.rate.toFixed(1)) + '</span>' : '') +
    '</span><span class="t">' + esc(f.title) + '</span><span class="s">' + esc(o.trailer ? f.when : (f.year + (o.seen ? seenLabel(f) : ''))) + '</span>';
  a.addEventListener('click', (e) => { e.preventDefault(); if (o.trailer) app.play(trailer(f)); else filmSheet(f); });
  return a;
}
const trailer = (f) => ({ k: f.k, kind: 'video', src: 'Trailer', title: f.title + ' trailer', media: f.art, dur: f.dur, href: f.href });
const seenLabel = (f) => (S.who === 'me' ? (f.me ? ' · seen' : '')
  : (f.me && f.them ? ' · both seen' : f.me ? ' · you have' : f.them ? ' · ' + D.partner + ' has' : ' · neither'));

function filmSheet(f) {
  app.sheet(f.title, (body) => {
    const m = el('span', 'c-media r169', art(f.art) + '<span class="play">' + ICON.play + '</span>');
    m.addEventListener('click', () => app.play(trailer({ ...f, dur: D.trailerLength })));
    body.appendChild(m);
    body.appendChild(el('p', 'sheet-note', esc(f.year) + ' · Town rating <b>' + esc(f.rate.toFixed(1)) + '</b> from ' + esc(f.n) + ' people · trailer ' + esc(D.trailerLength)));
    const row = el('div', 'linkrow');
    const seen = (who, label) => {
      const b = button((f[who] ? '✓ ' : '') + esc(label), f[who] ? '' : 'ghost', () => {
        f[who] = f[who] ? 0 : 1;
        app.toast(label + (f[who] ? ' marked seen' : ' unmarked'));
        render();
        b.textContent = (f[who] ? '✓ ' : '') + label;
        b.classList.toggle('ghost', !f[who]);
      });
      return b;
    };
    row.append(seen('me', 'I’ve seen it'), seen('them', D.partner + ' has'),
      button('Rate', 'ghost', () => app.toast('Rating needs the email sign-in')),
      button('Watchlist', 'ghost', () => app.toast('Added to your watchlist')));
    body.appendChild(row);
    body.appendChild(el('div', 'sheet-h', 'Where to watch'));
    body.appendChild(el('p', 'sheet-note', esc(D.whereToWatch)));
  });
}

function render() {
  root.innerHTML = '';
  sec('Coming soon', 'Trailers for what is landing at the Roxy, the Savoy and at home.', 'soon');
  const r1 = rail(root);
  D.soon.forEach((f) => r1.appendChild(poster(f, { trailer: true })));

  const pill = pills([['us', 'With ' + D.partner], ['me', 'Just me']], S.who, (v) => { S.who = v; render(); });
  sec('The 200', S.who === 'us'
    ? 'Two dots on every poster: you, ' + esc(D.partner) + '. Filled means seen. <b>' + esc(D.neitherCount) + '</b> neither of you has.'
    : 'One dot: seen or not. <b>' + esc(D.leftCount) + '</b> left.', 'list', pill);
  root.appendChild(chips(D.filters, S.filter, (k) => { S.filter = k; render(); }));
  const r2 = rail(root);
  D.films.filter((f) => S.filter !== 'neither' || (!f.me && !f.them)).forEach((f) => r2.appendChild(poster(f, { seen: true })));

  sec('Town ratings this week', 'What Burlington watched and what it thought.', 'town');
  D.films.slice().sort((a, b) => b.n - a.n).slice(0, 4).forEach((f) => {
    const r = el('div', 'lrow');
    r.dataset.k = f.k + '-town';
    r.innerHTML = '<span class="th">' + art(f.art) + '</span><div><div class="t">' + esc(f.title) + ' <span class="note">' + esc(f.year) + '</span></div><div class="s"><b>' +
      esc(f.rate.toFixed(1)) + ' ★</b> · ' + esc(f.n) + ' ratings · ' + (f.n > 60 ? 'trending' : 'steady') + '</div></div>';
    const b = el('button', 'pillbtn', 'Rate');
    b.addEventListener('click', () => app.toast('Rating needs the email sign-in'));
    r.appendChild(b);
    r.addEventListener('click', (e) => { if (!e.target.closest('button')) filmSheet(f); });
    root.appendChild(r);
  });

  sec('Vote for the next screening', esc(D.voteSub), 'vote');
  const card = el('div', 'textcard');
  const total = D.vote.reduce((a, v) => a + (Number(v.n) || 0), 0) + (S.voted ? 1 : 0);
  D.vote.forEach((v) => {
    const nn = (Number(v.n) || 0) + (S.voted === v.title ? 1 : 0);
    const o = el('div', 'vote-opt' + (S.voted === v.title ? ' on' : ''));
    o.setAttribute('role', 'button');
    o.tabIndex = 0;
    o.innerHTML = '<div class="l">' + esc(v.title) + '<span>' + esc(nn) + '</span></div><div class="bar"><i style="width:' + Math.round(nn / (total || 1) * 100) + '%"></i></div>';
    o.addEventListener('click', () => { S.voted = S.voted === v.title ? null : v.title; render(); app.toast(S.voted ? 'Voted for ' + v.title : 'Vote removed'); });
    card.appendChild(o);
  });
  card.appendChild(el('p', 'fine', esc(D.voteFine)));
  root.appendChild(card);

  sec('Watch chat', 'Talk about tonight’s pick with whoever else is watching.', 'chat');
  const tc = el('div', 'textcard', '<h3>' + esc(D.chat.title) + '</h3><p>' + esc(D.chat.text) + '</p>');
  const row = el('div', 'row');
  row.append(button('Open the chat ' + ICON.ext, '', () => app.toast('Opens the Watch Club channel in the real build')),
    button('I’m in', 'ghost', () => app.toast('Counted. ' + (D.chat.in + 1) + ' in.')));
  tc.appendChild(row);
  root.appendChild(tc);
  root.appendChild(el('div', 'spacer'));
}

function land() {
  if (!pending) return;
  const k = pending; pending = null;
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

app.register(KEY, {
  label: 'Watch',
  icon: ICON.watch,
  promise: 'Trailers, the list you and your person are working through, and what the town thought of it.',
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
    return chips([['soon', 'Coming soon'], ['list', 'The 200'], ['town', 'Town ratings'], ['vote', 'Screening vote'], ['chat', 'Watch chat']]
      .map(([key, label]) => ({ key, label })), null, (k) => app.jumpTo(root.querySelector('[data-sec="' + k + '"]')));
  },
  newSince() { return D ? D.newSince || 0 : 0; },
});
