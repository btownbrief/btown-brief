/* What Now: one answer, then put the phone down. The spinner stays; the Top
   100 becomes missions with a randomizer that scrolls to its pick; Music
   folds in as Tonight.

   Not built yet. Live, the tab states its promise; under ?demo=1 it shows the
   design prototype's screen on data/demo/whatnow.json. The tab's own session
   replaces the demo branch with real data and keeps the contract. The old
   What Now (whatnow-engine.js, whatnow-data.js) stays in the tree for that
   session to mine. */

import * as app from '../app.js';
import { el, esc, ICON, art, section, rail, chips, button, cards, put } from '../ui.js';

const KEY = 'whatnow';
const MODES = ['spin', 'missions', 'tonight'];
let root = null, D = null, pending = null;
const S = { mode: 'spin', theme: 'All', result: null, rolling: false };
const loaded = app.demo ? app.demoData(KEY).then((d) => { D = d; app.know(d.tonight); app.know(d.artists); app.recount(); return d; }) : null;

function render() {
  root.innerHTML = '';
  const w = D.weather;
  root.appendChild(el('div', 'wx', '<span><b>' + esc(w.temp) + '</b> ' + esc(w.sky) + '</span><span><b>' + esc(w.lake) + '</b> lake</span><span><b>' +
    esc(w.sunset) + '</b> sunset</span><span class="note when">' + esc(w.when) + '</span>'));
  if (S.mode === 'spin') renderSpin(); else if (S.mode === 'missions') renderMissions(); else renderTonight();
  root.appendChild(el('div', 'spacer'));
}

function renderSpin() {
  const s = el('div', 'spin');
  const big = el('button', 'big', ICON.shuffle + '<span>Spin</span>');
  big.addEventListener('click', spin);
  s.appendChild(big);
  s.appendChild(el('p', 'sub', 'One answer for right now. Then put the phone down.'));
  root.appendChild(s);
  if (S.result != null) {
    const a = D.answers[S.result];
    const r = el('div', 'result' + (S.rolling ? ' rolling' : ''));
    r.innerHTML = '<span class="c-media r169">' + art(a.art) + '</span><div class="in"><div class="eyebrow">Right now · ' + esc(D.weather.now) + '</div><h3>' +
      esc(a.title) + '</h3><p>' + esc(a.why) + '</p><div class="row"></div></div>';
    r.querySelector('.row').append(button('Do it ' + ICON.arrow, '', () => app.toast('Opens the details. Then go.')), button('Another', 'ghost', spin));
    root.appendChild(r);
  }
  section(root, 'Or pick a guide', 'Short lists for a kind of day.');
  const r1 = rail(root);
  D.guides.forEach((g) => {
    const c = el('a', 'vcard w180');
    c.href = '#whatnow/missions';
    c.innerHTML = '<span class="c-media r169">' + art(g.art) + '</span><span class="t">' + esc(g.title) + '</span><span class="s">' + esc(g.n) + ' things</span>';
    c.addEventListener('click', (e) => { e.preventDefault(); setMode('missions', g.theme); });
    r1.appendChild(c);
  });
}

/* the spin settles over seven ticks; under reduced motion it lands at once */
function spin() {
  if (S.rolling) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let n = still ? 6 : 0;
  S.rolling = !still;
  const tick = () => {
    S.result = Math.floor(Math.random() * D.answers.length);
    if (++n < 7) { render(); setTimeout(tick, 90 + n * 30); } else { S.rolling = false; render(); }
  };
  tick();
}

function renderMissions() {
  const done = D.missions.filter((m) => m.done).length;
  const sur = el('button', 'pillbtn on', ICON.shuffle + ' Surprise me');
  const s = section(root, 'The Top 100, as missions', '<b>' + done + '</b> done. Tap Surprise me and we pick one and scroll to it.', sur);
  s.dataset.sec = 'missions';
  root.appendChild(chips(D.themes.map((t) => ({ key: t, label: t })), S.theme, (k) => { S.theme = k; render(); }));
  const rows = D.missions.filter((m) => S.theme === 'All' || m.theme === S.theme).map((m) => {
    const r = el('div', 'lrow' + (m.done ? ' done' : ''));
    r.dataset.k = 'mission-' + m.n;
    r.innerHTML = '<span class="num">' + esc(m.n) + '</span><div><div class="t">' + esc(m.title) + '</div><div class="s">' + esc(m.theme) + ' · done by ' + esc(m.doneBy) + ' people</div></div>';
    const b = el('button', 'pillbtn' + (m.done ? ' on' : ''), m.done ? ICON.check + ' Done' : 'Mark done');
    b.addEventListener('click', () => { m.done = m.done ? 0 : 1; render(); app.toast(m.done ? 'Mission ' + m.n + ' done' : 'Unmarked'); });
    r.appendChild(b);
    root.appendChild(r);
    return r;
  });
  sur.addEventListener('click', () => {
    const open = rows.filter((r) => !r.classList.contains('done'));
    const r = open[Math.floor(Math.random() * open.length)] || rows[0];
    if (!r) return;
    rows.forEach((x) => x.classList.remove('hl'));
    r.classList.add('hl');
    app.jumpTo(r);
    setTimeout(() => r.classList.remove('hl'), 2400);
  });
  root.appendChild(button('Show all ' + esc(D.missionsTotal), 'ghost more', () => app.toast('All ' + D.missionsTotal + ' in the real build')));
}

function renderTonight() {
  const s = section(root, 'Tonight', 'Shows and events in the next six hours, from the same calendar the newsletter uses.');
  s.dataset.sec = 'tonight';
  const f = el('div', 'feed');
  root.appendChild(f);
  D.tonight.forEach((e) => put(f, cards.event(e)));
  app.bindFeed(f);
  section(root, 'Playing this week', 'Local artists with a show coming up. Press play; it keeps going when you leave.');
  D.artists.forEach((a) => {
    const r = el('div', 'lrow');
    r.innerHTML = '<span class="th">' + art(a.media) + '</span><div><div class="t">' + esc(a.title) + '</div><div class="s">' + esc(a.text) + '</div></div>';
    const b = el('button', 'pillbtn', ICON.play + ' ' + esc(a.dur));
    b.dataset.pk = a.k;
    b.dataset.label = a.dur;
    b.setAttribute('aria-label', 'Play ' + a.title);
    b.addEventListener('click', () => app.play(a));
    r.appendChild(b);
    root.appendChild(r);
  });
  app.paintPlayButtons();
}

function setMode(mode, theme) {
  S.mode = mode;
  if (theme) S.theme = theme;
  history.replaceState(null, '', '#whatnow/' + mode);
  app.paintSubnav();
  render();
  app.scrollTop();
}

function land() {
  if (!pending) return;
  const k = pending; pending = null;
  if (MODES.includes(k)) { S.mode = k; app.paintSubnav(); render(); return; }
  if (/^tn\d/.test(k) && S.mode !== 'tonight') { S.mode = 'tonight'; app.paintSubnav(); render(); }
  if (!app.flashHit(root, k)) app.toast('That one has passed.');
}

app.register(KEY, {
  label: 'What Now',
  icon: ICON.whatnow,
  promise: 'One answer for right now, a hundred missions for later, and what is on tonight.',
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
    return chips([{ key: 'spin', label: 'Spin', icon: ICON.shuffle },
      { key: 'missions', label: 'Missions', n: D.missionsDone + '/' + D.missionsTotal },
      { key: 'tonight', label: 'Tonight', n: D.tonight.length }], S.mode, (k) => setMode(k));
  },
  newSince() { return D ? D.newSince || 0 : 0; },
});
