/* Talk: something to talk about, one big card at a time. What Now's fourth
   view (#whatnow/talk); a card's own link is #whatnow/t-<id>.

   talk-core.js decides what is dealt. This file holds the card: a swipe right
   or the check marks it used for the group (kept on this phone), a swipe left
   or the x sends it to the back, the arrow keys do the same, and the next
   card turns over from its back in the group's colour. The decks come from
   data/talk-deck.json; Headlines and Sports from the Wire's own payload, so
   they refresh when it does, and the dealt card stays put when they do. With
   the Wire down the decks still deal, and with the decks down the Wire does.

   Demo runs on data/demo/talk.json and nothing is remembered. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, chips, button, agoShort } from '../ui.js';
import { BUBBLES, GROUP_COLORS, DEFAULT_GROUP, stories, deckCards, queue, normal, groupOf, usedBy, usedCount, addGroup, removeGroup, startOver, markUsed } from '../talk-core.js';

const TAB = 'whatnow';
const KEY = 'allday-talk';
const DECK_URL = '../data/talk-deck.json';
const COMMIT = 72;                       // the same travel that commits a swipe on a feed row
const START = 10;
const FLY_MS = 220;
const LONG_TEXT = 56;

/* every word a reader sees */
const WORDS = {
  ice: 'Icebreaker', deep: 'Deep', debate: 'Debate', head: 'Headline', sports: 'Sports', local: 'Local',
  everyone: 'Everyone', groups: 'Groups', newGroup: 'New group', name: 'Name', add: 'Add',
  used: 'Used', skip: 'Skip', star: 'Save', share: 'Share', startOver: 'Start over', remove: 'Remove',
  allDone: 'That’s all of them.', noHead: 'No headlines right now.', noSports: 'No sports right now.',
  noLoad: 'Couldn’t load.', tryAgain: 'Try again', icebreakers: 'Icebreakers',
  overTitle: (n) => 'Start ' + n + ' over?', overBody: (c) => c + (c === 1 ? ' card comes' : ' cards come') + ' back.',
  removeTitle: (n) => 'Remove ' + n + '?', removeBody: 'Its used cards come back if you make it again.',
};

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let T = normal(app.demo ? null : store.read(KEY, null));
let deck = null, deckFailed = false, news = { head: [], sports: [] }, today = null, wireFailed = false, wireSeen = false;
let bubble = 'mix', cards = [], busy = false, loading = null, settled = false;
let decked = null;                       // the deck has landed: the Wire is not waited for
let box = null, stage = null, bar = null, groupBtn = null, live = null, yes = null, no = null, under = null;

const save = () => { if (!app.demo) store.write(KEY, T); };
const groupName = (g) => g.name || WORDS.everyone;
const dot = (g) => '<i class="tk-dot" style="--gc:var(--talk-g' + esc(g.color) + ')"></i>';
const kindOf = (c) => (c.b === 'head' && c.local ? 'local' : c.b);
const faceClass = (c) => 'tk-' + kindOf(c);
const eyebrow = (c) => WORDS[kindOf(c)];
const itemOf = (c) => ({ k: 't-' + c.id, kind: 'talk', title: c.q, src: c.src || eyebrow(c), href: c.url || '#' + TAB + '/t-' + c.id });

/* ---------------------------------------------------------------- loading */
function takeNews(j) {
  today = j;
  wireSeen = true;
  wireFailed = false;
  news = stories(j, store.muted());
  if (!settled) return;
  /* the dealt card stays: a fresh paper only changes what comes after it */
  const dealt = cards[0];
  deal();
  if (dealt && dealt.id !== (cards[0] && cards[0].id)) cards = [dealt].concat(cards.filter((c) => c.id !== dealt.id));
  if (!dealt) paint(false);
  else paintNext();
}

function loadDemo() {
  return app.demoData('talk').then((d) => {
    const shift = Date.now() - Date.parse(d.today.updated);
    const move = (v) => {
      if (Array.isArray(v)) return v.map(move);
      if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = k === 'posted_at' ? new Date(Date.parse(v[k]) + shift).toISOString() : move(v[k]); }); return o; }
      return v;
    };
    deck = deckCards(d.deck);
    wireSeen = true;
    news = stories(move(d.today), store.muted());
  });
}

function loadDeck() {
  deckFailed = false;
  return data.fetchJSON(DECK_URL, 8000).then((j) => {
    const list = deckCards(j);
    if (!list.length) throw new Error('bad shape');
    deck = list;
  }).catch(() => { deckFailed = true; deck = []; });
}

function load() {
  if (loading) return loading;
  if (app.demo) { loading = decked = loadDemo(); return loading; }
  const wire = new Promise((res) => data.load('today', (j) => { takeNews(j); res(); }, () => {
    wireFailed = true;
    res();
    if (settled && !cards.length) paint(false);
  }));
  decked = loadDeck();
  loading = Promise.all([decked, wire]);
  return loading;
}

/* ------------------------------------------------------------------ dealing */
function deal() { cards = queue(bubble, deck || [], news, usedBy(T)); }

function act(c) {
  const foot = el('div', 'tk-foot');
  if (c.story) {
    const a = el('a', 'tk-src', esc(c.src) + (c.d ? ' · ' + esc(agoShort(c.d)) : '') + ' ' + ICON.ext);
    a.href = safeHref(c.url); a.target = '_blank'; a.rel = 'noopener';
    if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the article in the real build'); });
    foot.appendChild(a);
  } else foot.appendChild(el('span', 'tk-sp'));
  const it = itemOf(c);
  const sh = el('button', 'act sh', ICON.share);
  sh.setAttribute('aria-label', WORDS.share);
  sh.addEventListener('click', () => app.share(TAB, it.k, c.q));
  const on = store.isSaved(it.k);
  const st = el('button', 'act star' + (on ? ' on' : ''), ICON.star);
  st.setAttribute('aria-label', WORDS.star);
  st.setAttribute('aria-pressed', on ? 'true' : 'false');
  st.addEventListener('click', () => app.toggleSave(it));
  foot.append(sh, st);
  return foot;
}

function front(c) {
  const f = el('div', 'tk-face tk-front');
  const long = c.q.length > LONG_TEXT;
  f.innerHTML = '<div class="eyebrow">' + esc(eyebrow(c)) + '</div><h3 class="tk-q' + (long ? ' long' : '') + '">' + esc(c.q) + '</h3>';
  f.appendChild(act(c));
  return f;
}

function cardNode(c, turn) {
  const n = el('div', 'tk-card ' + faceClass(c) + (turn ? ' turn' : ''));
  n.dataset.k = 't-' + c.id;
  n.dataset.card = c.id;
  n.setAttribute('role', 'group');
  n.style.setProperty('--gc', 'var(--talk-g' + groupOf(T).color + ')');
  n.append(front(c), el('div', 'tk-face tk-back'));
  n.addEventListener('pointerdown', grab);
  return n;
}

/* a card with nothing to deal: the words and the one thing to do next */
function emptyNode() {
  const n = el('div', 'tk-card tk-empty');
  let words = WORDS.noLoad, btn = null;
  const toDeck = () => (deck && deck.length ? button(esc(WORDS.icebreakers), '', () => pick('ice')) : null);
  const news1 = bubble === 'head' ? news.head : bubble === 'sports' ? news.sports : null;
  if (news1 && !news1.length && !wireSeen && !wireFailed) words = '…';
  else if (news1 && !news1.length) { words = bubble === 'head' ? WORDS.noHead : WORDS.noSports; btn = toDeck(); }
  else if (deckFailed) btn = button(esc(WORDS.tryAgain), '', () => { loadDeck().then(() => { deal(); paint(true); }); });
  else if (usedCount(T)) { words = WORDS.allDone; btn = button(esc(WORDS.startOver), '', askOver); }
  n.appendChild(el('h3', 'tk-q', esc(words)));
  if (btn) n.appendChild(btn);
  return n;
}

function paintNext() {
  if (!under) return;
  const c = cards[1];
  under.className = 'tk-under' + (c ? ' ' + faceClass(c) : '');
  under.hidden = !c;
}

function paint(turn) {
  if (!stage) return;
  stage.querySelectorAll('.tk-card').forEach((n) => n.remove());
  const c = cards[0];
  const has = !!c;
  stage.appendChild(has ? cardNode(c, turn && !reduced()) : emptyNode());
  paintNext();
  yes.disabled = no.disabled = !has;
  live.textContent = has ? c.q : '';
  paintGroup();
}

function paintGroup() {
  if (!groupBtn) return;
  const g = groupOf(T), n = usedCount(T);
  groupBtn.innerHTML = dot(g) + '<span>' + esc(groupName(g)) + '</span>' + (n ? '<b>' + esc(n) + '</b>' : '');
  groupBtn.setAttribute('aria-label', groupName(g) + ', ' + n + ' used. ' + WORDS.groups);
}

/* the dealt card leaves, the next turns over */
function done(used) {
  const c = cards[0];
  if (!c || busy) return;
  busy = true;
  const after = () => {
    busy = false;
    if (used) { markUsed(T, c.id); save(); }
    if (cards[0] && cards[0].id === c.id) { const top = cards.shift(); if (!used) cards.push(top); }
    paint(true);
  };
  const n = stage.querySelector('.tk-card');
  if (reduced() || !n) { after(); return; }
  n.style.removeProperty('--dx');
  n.classList.remove('dragging');
  n.classList.add(used ? 'fly-r' : 'fly-l');
  setTimeout(after, FLY_MS);
}

/* ----------------------------------------------------------------- swipe */
function grab(e) {
  if (busy || e.button > 0 || e.target.closest('a, button')) return;
  const n = e.currentTarget;
  const x0 = e.clientX, y0 = e.clientY, pid = e.pointerId;
  let dx = 0, live2 = false;
  const move = (m) => {
    if (m.pointerId !== pid) return;
    dx = m.clientX - x0;
    if (!live2) {
      if (Math.abs(m.clientY - y0) > Math.abs(dx) && Math.abs(m.clientY - y0) > START) { stop(); return; }
      if (Math.abs(dx) < START) return;
      live2 = true;
      n.classList.add('dragging');
      try { n.setPointerCapture(pid); } catch (err) { /* the pointer already went */ }
    }
    n.style.setProperty('--dx', dx + 'px');
    n.style.setProperty('--tilt', (dx / 24).toFixed(2) + 'deg');
    n.classList.toggle('to-r', dx >= COMMIT);
    n.classList.toggle('to-l', dx <= -COMMIT);
  };
  const stop = () => {
    n.removeEventListener('pointermove', move);
    n.removeEventListener('pointerup', up);
    n.removeEventListener('pointercancel', cancel);
  };
  const reset = () => {
    n.classList.remove('dragging', 'to-r', 'to-l');
    n.style.removeProperty('--dx');
    n.style.removeProperty('--tilt');
  };
  const up = () => { stop(); if (Math.abs(dx) >= COMMIT && live2) done(dx > 0); else reset(); };
  const cancel = () => { stop(); reset(); };
  n.addEventListener('pointermove', move);
  n.addEventListener('pointerup', up);
  n.addEventListener('pointercancel', cancel);
}

function onKey(e) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  if (!box || !box.isConnected || app.activeTab() !== TAB) return;
  if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
  if (document.querySelector('#sheet:not([hidden]), #confirm:not([hidden])')) return;
  e.preventDefault();
  done(e.key === 'ArrowRight');
}

/* ---------------------------------------------------------------- groups */
function askOver() {
  const g = groupOf(T), n = usedCount(T);
  if (!n) return;
  app.confirmBox({ title: WORDS.overTitle(groupName(g)), body: WORDS.overBody(n), yes: WORDS.startOver, onYes() {
    startOver(T); save(); deal(); paint(true);
    if (sheetPaint) sheetPaint();
  } });
}

let sheetPaint = null;
function groupsSheet() {
  app.sheet(WORDS.groups, (body, card, close) => {
    let color = (T.groups.length % GROUP_COLORS) + 1;
    const choose = (id) => { if (id !== T.on) { T.on = id; save(); deal(); paint(true); } close(); };
    const paintList = () => {
      body.innerHTML = '';
      T.groups.forEach((g) => {
        const r = el('div', 'sheet-row tk-grow');
        r.dataset.group = g.id;
        const pickB = el('button', 'tk-gname' + (g.id === T.on ? ' on' : ''), dot(g) + '<span>' + esc(groupName(g)) + '</span>');
        pickB.setAttribute('aria-pressed', g.id === T.on ? 'true' : 'false');
        pickB.addEventListener('click', () => choose(g.id));
        r.appendChild(pickB);
        const n = usedCount(T, g.id);
        if (n) r.appendChild(el('span', 'tk-gn', esc(n)));
        if (n && g.id === T.on) r.appendChild(button(esc(WORDS.startOver), 'ghost sm tk-over', askOver));
        if (g.id !== DEFAULT_GROUP) {
          const x = el('button', 'iconbtn tk-del', ICON.x);
          x.setAttribute('aria-label', WORDS.remove + ' ' + g.name);
          x.addEventListener('click', () => app.confirmBox({ title: WORDS.removeTitle(g.name), body: WORDS.removeBody, yes: WORDS.remove, onYes() {
            removeGroup(T, g.id); save(); deal(); paint(true); paintList();
          } }));
          r.appendChild(x);
        }
        body.appendChild(r);
      });
      body.appendChild(el('div', 'sheet-h', esc(WORDS.newGroup)));
      const f = el('form', 'tk-new');
      const inp = el('input', 'tk-input');
      inp.type = 'text'; inp.maxLength = 24; inp.placeholder = WORDS.name; inp.setAttribute('aria-label', WORDS.name);
      const swatches = el('div', 'tk-swatches');
      for (let i = 1; i <= GROUP_COLORS; i += 1) {
        const s = el('button', 'tk-swatch' + (i === color ? ' on' : ''));
        s.type = 'button';
        s.style.setProperty('--gc', 'var(--talk-g' + i + ')');
        s.setAttribute('aria-label', 'Color ' + i);
        s.setAttribute('aria-pressed', i === color ? 'true' : 'false');
        s.addEventListener('click', () => {
          color = i;
          [...swatches.children].forEach((b) => { const on = b === s; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
        });
        swatches.appendChild(s);
      }
      const add = el('button', 'btn', esc(WORDS.add));
      f.append(inp, swatches, add);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!addGroup(T, inp.value, color)) return;
        save(); deal(); paint(true); close();
      });
      body.appendChild(f);
    };
    sheetPaint = paintList;
    paintList();
  });
}

/* ------------------------------------------------------------------ the view */
function pick(b) {
  if (b === bubble) return;
  bubble = b;
  [...bar.children].forEach((c) => {
    if (!c.dataset.chip) return;
    const on = c.dataset.chip === b;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  });
  deal();
  paint(true);
}

function build() {
  box = el('div', 'talk');
  bar = chips(BUBBLES.map(([key, label]) => ({ key, label })), bubble, pick, 'tk-bubbles');
  stage = el('div', 'tk-stage');
  under = el('div', 'tk-under');
  under.hidden = true;
  stage.appendChild(under);
  no = el('button', 'tk-btn tk-no', ICON.x);
  no.setAttribute('aria-label', WORDS.skip);
  no.addEventListener('click', () => done(false));
  yes = el('button', 'tk-btn tk-yes', ICON.check);
  yes.setAttribute('aria-label', WORDS.used);
  yes.addEventListener('click', () => done(true));
  groupBtn = el('button', 'tk-group');
  groupBtn.addEventListener('click', groupsSheet);
  const btns = el('div', 'tk-btns');
  btns.append(no, groupBtn, yes);
  live = el('div', 'sr');
  live.setAttribute('aria-live', 'polite');
  box.append(bar, stage, btns, live);
  document.addEventListener('keydown', onKey);
}

/* draws into What Now's root; a second visit keeps the card that was dealt */
export function render(root) {
  const first = !box;
  if (first) build();
  root.appendChild(box);
  if (!first) return;
  load();
  decked.then(() => {
    settled = true;
    deal();
    paint(false);
  });
}

/* a card's own link: dealt on top, even if the group has used it. Resolves
   false when the card is not in the deck or today's paper. */
export function open(id) {
  return load().then(() => {
    const all = (deck || []).concat(news.head, news.sports);
    const c = all.find((x) => x.id === id);
    if (!c) return false;
    if (!box) return true;
    cards = [c].concat(cards.filter((x) => x.id !== id));
    paint(true);
    return true;
  });
}
