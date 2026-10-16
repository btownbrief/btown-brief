/* Games: the leaderboard, challenge a neighbor, new games, party night, the
   arcade chat.

   Not built yet. Live, the tab states its promise; under ?demo=1 it shows the
   design prototype's screen on data/demo/games.json. The tab's own session
   replaces the demo branch with real data and keeps the contract. */

import * as app from '../app.js';
import { el, esc, ICON, art, mark, section, rail, chips, button } from '../ui.js';

const KEY = 'games';
let root = null, D = null, pending = null;
const S = { game: null };
const loaded = app.demo ? app.demoData(KEY).then((d) => { D = d; S.game = d.challengeGames[0]; app.recount(); return d; }) : null;

const sec = (title, sub, key, right) => { const s = section(root, title, sub, right); s.dataset.sec = key; return s; };

function render() {
  root.innerHTML = '';
  const all = el('button', 'pillbtn', 'All games');
  all.addEventListener('click', () => app.toast('Per-game boards in the real build'));
  sec('This month’s leaderboard', 'Resets in ' + esc(D.resetsIn) + ' days. Top three get a shirt.', 'board', all);
  const b = el('div', 'board');
  D.board.forEach((r, i) => {
    b.appendChild(el('div', 'r' + (r.me ? ' me' : ''), '<span class="rank">' + (i + 1) + '</span>' + mark(r.name, 'round lg') + '<div><div class="t">' + esc(r.name) +
      '</div><div class="s">' + esc(r.game) + '</div></div><span class="sc">' + esc(Number(r.score).toLocaleString('en-US')) + '</span>'));
  });
  root.appendChild(b);

  sec('Challenge a neighbor', 'Pick a game, send the link. First to three wins.', 'challenge');
  const tc = el('div', 'textcard', '<p>The room works on any phone, no download. The Hangout already makes rooms for two; this sends one by text.</p>');
  const row = el('div', 'row');
  D.challengeGames.forEach((g) => {
    const p = el('button', 'pillbtn' + (S.game === g ? ' on' : ''), esc(g));
    p.setAttribute('aria-pressed', S.game === g ? 'true' : 'false');
    p.addEventListener('click', () => { S.game = g; render(); });
    row.appendChild(p);
  });
  tc.appendChild(row);
  const r2 = el('div', 'row');
  r2.append(button('Send a challenge ' + ICON.share, '', () => app.toast('Shares a room link for ' + S.game)), el('span', 'fine', esc(D.openChallenges) + ' open challenges waiting for you'));
  tc.appendChild(r2);
  root.appendChild(tc);

  sec('New this month', 'From Stephen’s bookmarks, built small.', 'new');
  const g = el('div', 'grid2');
  D.new.forEach((n) => {
    const t = el('a', 'tile r43');
    t.href = '#games/new';
    t.innerHTML = art(n.art) + '<span class="lbl">' + esc(n.title) + '<span class="s">' + esc(n.line) + '</span></span>';
    t.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens ' + n.title + ' in the arcade'); });
    g.appendChild(t);
  });
  root.appendChild(g);

  sec('Party night', esc(D.party.when), 'party');
  const tc4 = el('div', 'textcard', '<h3 class="serif">' + esc(D.party.title) + '</h3><p>' + esc(D.party.text) + '</p>');
  const r4 = el('div', 'row');
  r4.append(button('Save the date', '', () => app.toast('Added to your calendar in the real build')), button('Last time’s champions', 'ghost', () => app.jumpTo(root.querySelector('[data-sec="champs"]'))));
  tc4.appendChild(r4);
  root.appendChild(tc4);

  sec('Arcade chat', 'Trash talk, bug reports, game ideas.', 'chat');
  const tc5 = el('div', 'textcard', '<p>Lives in the community’s Btown Arcade channel, so it has notifications and a moderator. Sign in with your newsletter email.</p>');
  const r5 = el('div', 'row');
  r5.append(button('Open the chat ' + ICON.ext, 'ghost', () => app.toast('Opens the Btown Arcade channel')));
  tc5.appendChild(r5);
  root.appendChild(tc5);

  sec('Champions', 'One a month since July.', 'champs');
  const r6 = rail(root);
  D.champions.forEach((c) => {
    const v = el('a', 'vcard w170');
    v.href = '#games/champs';
    v.innerHTML = '<span class="c-media r169">' + art(c.art) + '<span class="tag tag-own on-pic">' + ICON.trophy + '</span></span><span class="t">' + esc(c.month) + ' · ' + esc(c.who) +
      '</span><span class="s">' + esc(c.game) + '</span>';
    v.addEventListener('click', (e) => e.preventDefault());
    r6.appendChild(v);
  });
  root.appendChild(el('div', 'spacer'));
}

function land() {
  if (!pending) return;
  const k = pending; pending = null;
  const s = root.querySelector('[data-sec="' + CSS.escape(k) + '"]');
  if (s) { app.jumpTo(s); return; }
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

app.register(KEY, {
  label: 'Games',
  icon: ICON.games,
  promise: 'The arcade’s leaderboard, challenges to send a neighbor, and new games every month.',
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
    return chips([['board', 'Leaderboard'], ['challenge', 'Challenge'], ['new', 'New games'], ['party', 'Party night'], ['chat', 'Chat']]
      .map(([key, label]) => ({ key, label })), null, (k) => app.jumpTo(root.querySelector('[data-sec="' + k + '"]')));
  },
  newSince() { return D ? D.newSince || 0 : 0; },
});
