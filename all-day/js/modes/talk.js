/* Talk: something to talk about, three cards at once. A section of People
   (#people/talk); a card's own link is #people/t-<id>.

   talk-core.js decides what can be dealt. This file holds the three seats: a
   news question, an icebreaker and a debate or deep question, all readable
   with no tapping. The check marks a card used for the group (kept on this
   phone) and it stays on the table until it is swapped, a swap changes that
   one seat, and Deal three changes all of them. A used card never comes back
   for that group.

   The decks come from data/talk-deck.json, Headlines and Sports from the
   Wire's own payload, their questions from data/talk-today.json, so they
   refresh when those do, and the dealt cards stay put when they do. A seat
   with nothing of its own takes a card from another, so the decks still deal
   with the Wire down, and the Wire with the decks down.

   Demo runs on data/demo/talk.json and nothing is remembered. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, chips, button, agoShort, section } from '../ui.js';
import { BUBBLES, SEATS, GROUP_COLORS, DEFAULT_GROUP, stories, questions, ask, deckCards, pools, seatOf, normal, groupOf, usedBy, usedCount, addGroup, removeGroup, startOver, markUsed, unmarkUsed } from '../talk-core.js';

const TAB = 'people';
const KEY = 'allday-talk';
const DECK_URL = '../data/talk-deck.json';
const STAGGER_MS = 70;

/* every word a reader sees */
const WORDS = {
  title: 'Talk', ice: 'Icebreaker', deep: 'Deep', debate: 'Debate', head: 'Headline', sports: 'Sports', local: 'Local',
  everyone: 'Everyone', groups: 'Groups', newGroup: 'New group', name: 'Name', add: 'Add',
  used: 'Used', swap: 'Swap', deal: 'Deal three', star: 'Save', share: 'Share', startOver: 'Start over', remove: 'Remove',
  allDone: 'That’s all of them.', noLoad: 'Couldn’t load.', tryAgain: 'Try again',
  overTitle: (n) => 'Start ' + n + ' over?', overBody: (c) => c + (c === 1 ? ' card comes' : ' cards come') + ' back.',
  removeTitle: (n) => 'Remove ' + n + '?', removeBody: 'Its used cards come back if you make it again.',
};

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let T = normal(app.demo ? null : store.read(KEY, null));
let deck = null, deckFailed = false, news = { head: [], sports: [] };
let paper = null, asked = null, paperIn = false, askedIn = false;
let bubble = 'mix', pool = { news: [], ice: [], other: [] }, hand = [null, null, null], loading = null, settled = false;
let decked = null;                       // the deck has landed: its two seats do not wait for the Wire
let box = null, table = null, bar = null, groupBtn = null, live = null, dealBtn = null;

const save = () => { if (!app.demo) store.write(KEY, T); };
const groupName = (g) => g.name || WORDS.everyone;
const dot = (g) => '<i class="tk-dot" style="--gc:var(--talk-g' + esc(g.color) + ')"></i>';
const kindOf = (c) => (c.b === 'head' && c.local ? 'local' : c.b);
const eyebrow = (c) => WORDS[kindOf(c)];
const isUsed = (c) => !!usedBy(T)[c.id];
const newsIn = () => paperIn && askedIn;
const itemOf = (c) => ({ k: 't-' + c.id, kind: 'talk', title: c.q, src: c.src || eyebrow(c), href: c.url || '#' + TAB + '/t-' + c.id });

/* ---------------------------------------------------------------- loading */
function mergeNews() {
  if (!newsIn()) return;
  news = ask(stories(paper, store.muted()), questions(asked, store.muted()));
  if (!settled) return;
  refill();
  paint(hand.map(() => false));
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
    news = ask(stories(move(d.today), store.muted()), questions(move(d.asked), store.muted(), Date.parse(d.asked.updated)));
    paperIn = askedIn = true;
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
  const wire = new Promise((res) => data.load('today', (j) => { paper = j; paperIn = true; mergeNews(); res(); }, () => { paperIn = true; mergeNews(); res(); }));
  const qs = new Promise((res) => data.load('talkToday', (j) => { asked = j; askedIn = true; mergeNews(); res(); }, () => { askedIn = true; mergeNews(); res(); }));
  decked = loadDeck();
  loading = Promise.all([decked, wire, qs]);
  return loading;
}

/* ------------------------------------------------------------------ dealing */
const inHand = (c) => hand.some((h) => h && h.id === c.id);

/* a seat's own pool first, then the others, so a seat with nothing left still deals */
function draw(seat) {
  const order = SEATS.slice(seat).concat(SEATS.slice(0, seat));
  for (const k of order) {
    const p = pool[k];
    while (p.length) { const c = p.shift(); if (!inHand(c) && !isUsed(c)) return c; }
  }
  return null;
}

/* the empty seats only: what is on the table stays. Until the news is in, its
   seat waits rather than dealing a deck card that would have to leave. */
function fill() { hand.forEach((c, i) => { if (!c && (i !== 0 || newsIn())) hand[i] = draw(i); }); }
function refill() { pool = pools(bubble, deck || [], news, usedBy(T)); fill(); }
function dealAll() { hand = [null, null, null]; refill(); }

/* a card leaving the table goes to the back of its line, unless it was used */
function putBack(c) { if (c && !isUsed(c)) pool[SEATS[seatOf(c)]].push(c); }

/* ------------------------------------------------------------------ a card */
function source(c) {
  if (!c.story) return null;
  const a = el('a', 'tk-src', (c.hl ? '<span class="tk-hl">' + esc(c.hl) + '</span>' : '') +
    '<span class="tk-from">' + esc(c.src) + (c.d ? ' · ' + esc(agoShort(c.d)) : '') + ' ' + ICON.ext + '</span>');
  a.href = safeHref(c.url); a.target = '_blank'; a.rel = 'noopener';
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the article in the real build'); });
  return a;
}

function iconBtn(cls, icon, label, on, onClick) {
  const b = el('button', 'act ' + cls + (on ? ' on' : ''), icon);
  b.setAttribute('aria-label', label);
  if (on !== null) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.addEventListener('click', onClick);
  return b;
}

function foot(c, seat) {
  const f = el('div', 'tk-foot', '<div class="eyebrow">' + esc(eyebrow(c)) + '</div>');
  const u = iconBtn('tk-used', ICON.check, WORDS.used, isUsed(c), () => toggleUsed(seat));
  const sw = iconBtn('tk-swap', ICON.shuffle, WORDS.swap, null, () => swap(seat));
  const it = itemOf(c);
  const sh = iconBtn('sh', ICON.share, WORDS.share, null, () => app.share(TAB, it.k, c.q));
  const st = iconBtn('star', ICON.star, WORDS.star, store.isSaved(it.k), () => app.toggleSave(it));
  f.append(el('span', 'tk-sp'), u, sw, sh, st);
  return f;
}

function cardNode(c, seat, turn, order) {
  const n = el('div', 'tk-card tk-' + kindOf(c) + (turn ? ' turn' : '') + (isUsed(c) ? ' used' : ''));
  n.dataset.k = 't-' + c.id;
  n.dataset.card = c.id;
  n.dataset.seat = SEATS[seat];
  n.setAttribute('role', 'group');
  n.style.setProperty('--gc', 'var(--talk-g' + groupOf(T).color + ')');
  if (order) n.style.setProperty('--tk-delay', order * STAGGER_MS + 'ms');
  const f = el('div', 'tk-front');
  f.appendChild(foot(c, seat));
  f.appendChild(el('h3', 'tk-q', esc(c.q)));
  const src = source(c);
  if (src) f.appendChild(src);
  n.append(el('div', 'tk-back'), f);
  return n;
}

/* nothing to deal: the words and the one thing to do next, once for the table */
function emptyNode(seat) {
  const n = el('div', 'tk-card tk-empty');
  n.dataset.seat = SEATS[seat];
  if (!settled || (seat === 0 && !newsIn())) { n.classList.add('tk-wait'); return n; }
  let words = WORDS.noLoad, btn = null;
  if (deckFailed) btn = button(esc(WORDS.tryAgain), '', () => { loadDeck().then(() => { dealAll(); paint(hand.map(() => true)); }); });
  else if (usedCount(T)) { words = WORDS.allDone; btn = button(esc(WORDS.startOver), '', askOver); }
  n.appendChild(el('h3', 'tk-q', esc(words)));
  if (btn) n.appendChild(btn);
  return n;
}

/* turns says which seats turn over as they land */
function paint(turns) {
  if (!table) return;
  const done = settled && newsIn();
  const nodes = hand.map((c, i) => {
    const turn = turns[i] && !reduced();
    return c ? cardNode(c, i, turn, turn ? i : 0) : done ? null : emptyNode(i);
  }).filter(Boolean);
  table.replaceChildren(...(nodes.length ? nodes : [emptyNode(0)]));
  dealBtn.hidden = done && !hand.some(Boolean);
  live.textContent = turns.some(Boolean) ? hand.filter(Boolean).map((c) => c.q).join('. ') : '';
  paintGroup();
}

function paintGroup() {
  if (!groupBtn) return;
  const g = groupOf(T), n = usedCount(T);
  groupBtn.innerHTML = dot(g) + '<span>' + esc(groupName(g)) + '</span>' + (n ? '<b>' + esc(n) + '</b>' : '');
  groupBtn.setAttribute('aria-label', groupName(g) + ', ' + n + ' used. ' + WORDS.groups);
}

function toggleUsed(seat) {
  const c = hand[seat];
  if (!c) return;
  if (isUsed(c)) unmarkUsed(T, c.id); else markUsed(T, c.id);
  save();
  paint(hand.map(() => false));
}

function swap(seat) {
  const c = hand[seat];
  hand[seat] = null;
  const next = draw(seat);
  putBack(c);
  hand[seat] = next || draw(seat);
  paint(hand.map((h, i) => i === seat));
}

function dealThree() {
  const old = hand;
  hand = [null, null, null];
  old.forEach(putBack);
  fill();
  paint(hand.map(() => true));
}

/* ---------------------------------------------------------------- groups */
function askOver() {
  const g = groupOf(T), n = usedCount(T);
  if (!n) return;
  app.confirmBox({ title: WORDS.overTitle(groupName(g)), body: WORDS.overBody(n), yes: WORDS.startOver, onYes() {
    startOver(T); save(); dealAll(); paint(hand.map(() => true));
    if (sheetPaint) sheetPaint();
  } });
}

const redeal = () => { save(); dealAll(); paint(hand.map(() => true)); };

let sheetPaint = null;
function groupsSheet() {
  app.sheet(WORDS.groups, (body, card, close) => {
    let color = (T.groups.length % GROUP_COLORS) + 1;
    const choose = (id) => { if (id !== T.on) { T.on = id; redeal(); } close(); };
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
            removeGroup(T, g.id); redeal(); paintList();
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
        redeal(); close();
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
  });
  dealAll();
  paint(hand.map(() => true));
}

function build() {
  box = el('div', 'talk');
  groupBtn = el('button', 'tk-group');
  groupBtn.addEventListener('click', groupsSheet);
  section(box, WORDS.title, '', groupBtn);
  bar = chips(BUBBLES.map(([key, label]) => ({ key, label })), bubble, pick, 'tk-bubbles');
  table = el('div', 'tk-table');
  dealBtn = button(esc(WORDS.deal), 'tk-deal', dealThree);
  live = el('div', 'sr');
  live.setAttribute('aria-live', 'polite');
  box.append(bar, table, dealBtn, live);
  paintGroup();
}

/* draws into People's Talk section; a second visit keeps the cards that were dealt */
export function render(host) {
  const first = !box;
  if (first) build();
  if (box.parentNode !== host) host.appendChild(box);
  if (!first) return;
  paint(hand.map(() => false));
  load();
  decked.then(() => {
    settled = true;
    dealAll();
    paint(hand.map(() => false));
  });
}

/* a card's own link: dealt into its seat, even if the group has used it.
   Resolves false when the card is not in the deck or today's paper. */
export function open(id) {
  return load().then(() => {
    const all = (deck || []).concat(news.head, news.sports);
    const c = all.find((x) => x.id === id);
    if (!c) return false;
    const seat = seatOf(c);
    if (!inHand(c)) hand[seat] = c;
    paint(hand.map((h) => !!h && h.id === id));
    app.flashHit(table, 't-' + id, true);
    return true;
  });
}
