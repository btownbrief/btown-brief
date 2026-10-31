/* The All cards view of table.html: the whole deck and the day's questions,
   with Talk's filters, a search and the town's answers on each card. The
   Table view is js/table-talk.js; the two share the page and nothing else.

   Cards with fresh answers lead, then the day's questions, then the deck in
   its order. Heavy cards are in Deep and nowhere else, Talk's rule. */

import * as store from '../all-day/js/store.js';
import * as data from '../all-day/js/wire.js';
import * as answers from '../all-day/js/answers.js';
import { BUBBLES, deckCards, questions } from '../all-day/js/talk-core.js';
import { el, esc, ICON, button, chips, agoShort } from '../all-day/js/ui.js';

const DECK_URL = 'data/talk-deck.json';
const APP_URL = 'https://guide.btownbrief.com/all-day/';
const STEP = 30;
const SPORTS = /\b(sports?|ski|skis|skier|skiers|skiing|snowboard\w*|hockey|baseball|softball|basketball|soccer|football|tennis|golf\w*|pickleball|team|teams|coach\w*|catamounts?|lake monsters|marathon|red sox|bruins|celtics|patriots)\b/i;
const WORDS = {
  search: 'Search', none: 'Nothing matches.', more: 'Show more', answer: 'Answer', answers: 'Answers', share: 'Share', star: 'Save',
  ice: 'Icebreaker', deep: 'Deep', debate: 'Debate', head: 'Headline', sports: 'Sports', local: 'Local',
};

if (new URLSearchParams(location.search).get('demo') === '1') store.setDemo(true);

const root = document.documentElement;
const host = document.getElementById('browse');
const tabs = [...document.querySelectorAll('.tt-views .chip')];
let cards = [], built = false, bubble = 'mix', term = '', upto = STEP, list = null, more = null;

/* ------------------------------------------------------------------ the list */
const kindOf = (c) => (c.story && c.local ? 'local' : c.b);
const has = (c) => answers.lastAt(answers.qidOf(c)) || 0;
function matches(c) {
  if (term && !(c.q + ' ' + (c.hl || '')).toLowerCase().includes(term)) return false;
  if (bubble === 'deep') return c.b === 'deep';
  if (c.heavy) return false;
  if (bubble === 'local') return !!c.local;
  if (bubble === 'sports') return c.b === 'sports' || SPORTS.test(c.q);
  return true;
}
const ranked = () => cards.filter((c) => answers.qidOf(c) && matches(c)).map((c, i) => [c, i]).sort((a, b) => has(b[0]) - has(a[0]) || a[1] - b[1]).map((x) => x[0]);

/* one node per card, so an open answer box and its draft survive a repaint */
const tiles = new Map();
function tile(c, i) {
  const qid = answers.qidOf(c);
  if (!tiles.has(qid)) tiles.set(qid, tileNode(c, qid));
  const n = tiles.get(qid);
  n.classList.toggle('alt', i % 2 === 1);
  n.classList.toggle('alt-w', (Math.floor(i / 2) + (i % 2)) % 2 === 1);
  return n;
}

function tileNode(c, qid) {
  const n = el('article', 'card tb');
  n.dataset.k = 't-' + c.id;
  n.dataset.qid = qid;
  const q = el('button', 'tb-q', esc(c.q));
  q.type = 'button';
  q.setAttribute('aria-expanded', 'false');
  const foot = el('div', 'tb-foot', '<span class="tb-meta"></span><span class="tb-sp"></span>');
  const open = el('div', 'tb-open');
  const toggle = () => {
    const was = open.querySelector('.ans');
    q.setAttribute('aria-expanded', was ? 'false' : 'true');
    if (was) was.remove(); else open.appendChild(answers.panel(qid));
  };
  const count = answers.count(qid);
  foot.querySelector('.tb-meta').textContent = count ? answers.WORDS.many(count) + ' · ' + agoShort(has(c) / 1000) : '';
  q.addEventListener('click', toggle);
  const go = button(esc(answers.answered(qid) ? WORDS.answers : WORDS.answer), 'ghost sm tb-go', () => { if (!open.querySelector('.ans')) toggle(); });
  const link = APP_URL + '#people/t-' + encodeURIComponent(c.id);
  const sh = el('button', 'act sh', ICON.share);
  sh.type = 'button';
  sh.setAttribute('aria-label', WORDS.share);
  sh.addEventListener('click', () => {
    if (navigator.share) navigator.share({ title: c.q, url: link }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
  });
  const k = 't-' + c.id;
  const st = el('button', 'act star' + (store.isSaved(k) ? ' on' : ''), ICON.star);
  st.type = 'button';
  st.setAttribute('aria-label', WORDS.star);
  st.setAttribute('aria-pressed', store.isSaved(k) ? 'true' : 'false');
  st.addEventListener('click', () => {
    const on = store.toggleSaved({ k, kind: 'talk', title: c.q, from: c.src || WORDS[kindOf(c)] || '', href: c.url || '#people/' + k });
    st.classList.toggle('on', on);
    st.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  foot.append(go, sh, st);
  n.append(el('div', 'eyebrow', esc(WORDS[kindOf(c)] || '')), q, foot, open);
  return n;
}

function paint() {
  const all = ranked();
  list.replaceChildren(...all.slice(0, upto).map(tile));
  if (!all.length) list.replaceChildren(el('p', 'tt-none', esc(WORDS.none)));
  more.hidden = upto >= all.length;
}

/* ------------------------------------------------------------------ the view */
function build() {
  built = true;
  const search = el('input', 'tt-search');
  search.type = 'search';
  search.placeholder = WORDS.search;
  search.setAttribute('aria-label', WORDS.search);
  search.addEventListener('input', () => { term = search.value.trim().toLowerCase(); upto = STEP; paint(); });
  const bar = chips(BUBBLES.map(([key, label]) => ({ key, label })), bubble, (key) => {
    bubble = key;
    [...bar.children].forEach((b) => { const on = b.dataset.chip === key; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    upto = STEP;
    paint();
  }, 'tk-bubbles');
  const tools = el('div', 'tt-tools');
  tools.append(search, bar);
  list = el('div', 'tt-list');
  more = button(esc(WORDS.more), 'ghost more tb-more', () => { upto += STEP; paint(); });
  more.hidden = true;
  host.append(tools, list, more);
  const today = new Promise((res) => data.load('talkToday', res, () => res(null)));
  Promise.all([
    fetch(DECK_URL).then((r) => r.json()).then(deckCards).catch(() => []),
    today.then((j) => { const q = questions(j, store.muted()); return q.head.concat(q.sports); }).catch(() => []),
    answers.activity(),
  ]).then(([deck, news]) => { cards = news.concat(deck); paint(); });
  answers.on(({ qid }) => {
    const n = list.querySelector('[data-qid="' + qid + '"]');
    if (!n) return;
    n.querySelector('.tb-meta').textContent = answers.WORDS.many(answers.count(qid));
    n.querySelector('.tb-go').textContent = WORDS.answers;
  });
}

function setView(v) {
  if (v === 'all') root.setAttribute('data-view', 'all'); else root.removeAttribute('data-view');
  tabs.forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  if (history.replaceState) history.replaceState(null, '', v === 'all' ? '#all' : location.pathname + location.search);
  if (v === 'all' && !built) build();
  /* the Table's card measures itself against the space it has */
  if (v !== 'all') window.dispatchEvent(new Event('resize'));
}

tabs.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
setView(root.getAttribute('data-view') === 'all' ? 'all' : 'table');
