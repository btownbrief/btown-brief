/* square.js — Town's Square tab. All of it is the Wire's Square
   (wire-square.js): this file only stands where modes/wire.js stands in All
   Day, handing it the paper and the Unfiltered wire and putting the chips
   at the top. #square/<key> lands on a post here; #wire links still open
   All Day, the Wire's home. */

import * as app from '../app.js';
import * as boards from '../boards.js';
import { ICON, chips } from '../ui.js';
import * as data from '../wire.js';
import * as demo from './wire-demo.js';
import * as square from './wire-square.js';

const COPY = { label: 'Square', promise: 'What Burlington is posting.', gone: 'That post has moved on.', loading: 'Loading the Square…' };

const SRC = app.demo ? demo.source : {
  now: () => Date.now(),
  today: (ok, fail) => data.load('today', ok, fail),
  pulse: (ok, fail) => data.load('pulse', ok, fail),
};
const S = { root: null, paper: null, pulse: null, canPost: false, open: null, wait: null };

/* a source that fails stays null, and the Square draws from the rest; a
   later payload is picked up on the next draw, never under a reader's thumb */
const fetched = (load, take) => new Promise((done) => load((j) => { take(j); done(); }, done));
/* the Unfiltered wire as wire-square.js reads it: the file, and its sources by id */
function takePulse(j) {
  const map = Object.create(null);
  (Array.isArray(j.sources) ? j.sources : []).forEach((s) => { if (s && s.id) map[s.id] = s; });
  S.pulse = { src: j, map };
}
function sources() {
  if (!S.wait) {
    const ask = app.demo ? Promise.resolve(true) : boards.roundFour().catch(() => false);
    S.wait = Promise.all([fetched(SRC.today, (j) => { S.paper = j; }), fetched(SRC.pulse, takePulse), ask.then((v) => { S.canPost = v === true; })]);
  }
  return S.wait;
}

function ago(ms) {
  const s = Math.max(0, Math.floor((SRC.now() - ms) / 1000));
  if (s < 90) return 'now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

function draw() {
  if (!S.root || !square.loaded()) return;
  const old = S.root.querySelector('.sq-types');
  const left = old ? old.scrollLeft : 0;
  square.render(S.root);
  const list = square.typeChips();
  if (list.length > 1) {
    const row = chips(list, square.type(), (k) => { square.setType(k); draw(); }, 'sq-types');
    S.root.prepend(row);
    row.scrollLeft = left;
  }
  if (S.open) {
    const k = S.open;
    S.open = null;
    if (!app.flashHit(S.root, k)) app.toast(COPY.gone);
  }
}

square.init({
  now: () => SRC.now(),
  ago,
  today: () => square.paperThreads(S.paper),
  pulse: () => S.pulse,
  needPulse: sources,
  showing: () => app.activeTab() === 'square',
  panel: () => (S.root ? S.root.closest('.panel') : null),
  redraw: draw,
  tab: 'square',
  canPost: () => S.canPost,
});

app.register('square', {
  label: COPY.label,
  icon: ICON.people,
  promise: COPY.promise,
  mount(root) {
    S.root = root;
    if (!square.loaded()) root.innerHTML = '<p class="loading">' + COPY.loading + '</p>';
    square.ensure().then(draw);
  },
  activate(param) {
    if (!param) return;
    S.open = param;
    square.showAll();
    draw();
  },
  refresh: draw,
  newSince: () => 0,
});
