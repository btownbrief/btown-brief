/* The Board: the town answering, freshest on top. A section of People
   (#people/board); a block's own link is its question id, #people/bd001.

   Blocks are Stephen's prompts (data/board-prompts.json, { id, q, at, pin })
   and any Talk card or news question the town has answered, joined from the
   answers table to Talk's deck and the day's questions. A question that has
   left both is dropped, and a heavy card stays in Deep. Ordered by last
   answer; a prompt nobody has answered goes by its own time, and a pin
   stays first. Answering anywhere moves that block to the top, at once, and
   the reader who answered it goes with it.

   Each block is a prompt, its count and last answer, and the tease; tapping
   opens the answers component in place (answers.js holds the reveal). Eight
   show, then See more. It is not r/burlington, which stays a read-only feed.

   Demo reads the real prompts and data/demo/answers.json. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as answers from '../answers.js';
import { el, esc, ICON, button, agoShort, section } from '../ui.js';
import * as talk from './talk.js';

const TAB = 'people';
const PROMPTS_URL = '../data/board-prompts.json';
const SHOW = 8;
const MOVE_MS = 320;
const CATALOG_WAIT_MS = 2500;
const WORDS = { title: 'The Board', steve: 'Steve asks', more: 'See more', share: 'Share', star: 'Save', first: 'Be the first.', answer: 'Answer', answers: 'Answers' };

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let box = null, list = null, more = null, loading = null, failed = false, settle = null;
let shown = SHOW, prompts = [], known = new Map(), catalog = null;
const nodes = new Map();                 // qid -> a block's node, kept so an open block survives a move

/* ------------------------------------------------------------------ the blocks */
const timeOf = (b) => answers.lastAt(b.qid) || b.at;
function blocks() {
  const out = prompts.map((p) => ({ qid: p.id, q: p.q, at: Date.parse(p.at) || 0, pin: !!p.pin, own: true }));
  const have = new Set(out.map((b) => b.qid));
  answers.entries().forEach(([qid]) => {
    const c = known.get(qid);
    if (c && !c.heavy && !have.has(qid) && answers.count(qid)) out.push({ qid, q: c.q, at: 0, kind: talk.kindWord(c) });
  });
  return out.sort((a, b) => (b.pin - a.pin) || timeOf(b) - timeOf(a));
}

/* the top answers of each question, from the one feed */
let byQid = new Map();
function teases(rows) {
  byQid = new Map();
  rows.forEach((r) => { if (!byQid.has(r.qid)) byQid.set(r.qid, []); byQid.get(r.qid).push(r); });
}

export function load() {
  if (loading) return loading;
  const fed = () => answers.feed().then(teases);
  /* the prompts and the answers draw the Board; Talk's cards join when they land */
  catalog = talk.catalog().then((m) => { known = m; if (list) { place(); if (settle) settle(); } }).catch(() => {});
  loading = Promise.all([
    data.fetchJSON(PROMPTS_URL, 8000).then((j) => { prompts = (j && Array.isArray(j.prompts) ? j.prompts : []).filter((p) => p && answers.isQid(p.id) && p.q); }).catch(() => { failed = true; }),
    answers.activity(),
    fed(),
  ]);
  /* after the panel has painted, so a jump measures the block as it will stand */
  answers.on(({ qid, reported }) => {
    setTimeout(() => {
      if (list) place(reported ? null : qid);
      fed().then(() => { if (list) place(); });
    }, 0);
  });
  return loading;
}
export const has = () => !failed || !!prompts.length;

/* the freshest thing on the Board, for the Social tab: what the town last
   answered, or the newest prompt */
export function freshest() {
  return load().then(() => Promise.race([catalog, new Promise((res) => { setTimeout(res, CATALOG_WAIT_MS); })])).then(() => {
    const b = blocks().find((x) => !x.pin) || blocks()[0];
    return b ? { q: b.q, ts: timeOf(b), n: answers.count(b.qid), tease: answers.teased(byQid.get(b.qid) || []).map((r) => answers.cut(r.body)) } : null;
  });
}

/* ------------------------------------------------------------------ a block */
function iconBtn(cls, icon, label, on, onClick) {
  const b = el('button', 'act ' + cls + (on ? ' on' : ''), icon);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function paintBlock(n, b) {
  const c = answers.count(b.qid), t = timeOf(b);
  n.querySelector('.tb-meta').textContent = (c ? answers.WORDS.many(c) + ' · ' : '') + agoShort(t / 1000);
  const tease = n.querySelector('.tb-tease');
  const open = !!n.querySelector('.ans');
  tease.hidden = open || answers.answered(b.qid);
  if (!c) tease.replaceChildren(el('p', 'tb-first', esc(WORDS.first)));
  else answers.teaseNodes(tease, byQid.get(b.qid) || []);
  const go = n.querySelector('.tb-go');
  go.textContent = answers.answered(b.qid) ? WORDS.answers : WORDS.answer;
  go.hidden = open;
}

function toggle(n, b) {
  const was = n.querySelector('.ans');
  n.querySelector('.tb-q').setAttribute('aria-expanded', was ? 'false' : 'true');
  if (was) was.remove();
  else n.querySelector('.tb-open').appendChild(answers.panel(b.qid));
  paintBlock(n, b);
}

function blockNode(b) {
  const n = el('article', 'card tb');
  n.dataset.k = b.qid;
  const k = el('div', 'eyebrow', esc(b.own ? WORDS.steve : b.kind || ''));
  const q = el('button', 'tb-q', esc(b.q));
  q.type = 'button';
  q.setAttribute('aria-expanded', 'false');
  q.addEventListener('click', () => toggle(n, b));
  const foot = el('div', 'tb-foot', '<span class="tb-meta"></span><span class="tb-sp"></span>');
  const go = button('', 'ghost sm tb-go', () => { if (!n.querySelector('.ans')) toggle(n, b); });
  const it = { k: b.qid, kind: 'talk', title: b.q, src: WORDS.title, href: '#' + TAB + '/' + b.qid };
  const sh = iconBtn('sh', ICON.share, WORDS.share, false, () => app.share(TAB, b.qid, b.q));
  const st = iconBtn('star', ICON.star, WORDS.star, store.isSaved(b.qid), () => app.toggleSave(it));
  foot.append(go, sh, st);
  n.append(k, q, el('div', 'tb-tease'), foot, el('div', 'tb-open'));
  return n;
}

/* the list in the order it now stands: only what moved is touched, so a box
   someone is typing in stays put, and what moved glides to its new place.
   `lead` is the block just answered: if it is open the scroll goes with it at
   once and only that block glides, from where the reader last saw it. */
function place(lead) {
  const all = blocks();
  const open = [...nodes.entries()].filter(([, n]) => n.querySelector('.ans')).map(([q]) => q);
  const keep = all.filter((b, i) => i < shown || open.includes(b.qid));
  const was = new Map([...list.children].map((n) => [n, n.getBoundingClientRect().top]));
  keep.forEach((b, i) => {
    let n = nodes.get(b.qid);
    if (!n) { n = blockNode(b); nodes.set(b.qid, n); }
    paintBlock(n, b);
    n.classList.toggle('alt', i % 2 === 1);
    if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null);
  });
  while (list.children.length > keep.length) list.lastChild.remove();
  more.hidden = keep.length >= all.length;
  box.hidden = !all.length;
  const hit = lead && nodes.get(lead) && nodes.get(lead).querySelector('.ans') ? nodes.get(lead) : null;
  if (hit) app.jumpTo(hit, true);
  if (reduced()) return;
  (hit ? [hit] : [...list.children]).forEach((n) => {
    const from = was.get(n);
    const dy = from == null ? 0 : from - n.getBoundingClientRect().top;
    if (dy) n.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: MOVE_MS, easing: 'cubic-bezier(.2, .8, .3, 1)' });
  });
}

/* draws into People's Board section; a second visit keeps what is open */
export function render(host, onHeight) {
  settle = onHeight;
  if (box) { if (box.parentNode !== host) host.appendChild(box); return; }
  box = el('div', 'tb-sec');
  section(box, WORDS.title);
  list = el('div', 'tb-list');
  more = button(esc(WORDS.more), 'ghost more tb-more', () => { shown += SHOW; place(); });
  more.hidden = true;
  box.append(list, more);
  host.appendChild(box);
  load().then(() => {
    place();
    if (app.activeTab() === TAB) app.paintSubnav();
    if (onHeight) onHeight();
  });
}

/* a question's own link: its block, opened, for People to land on. False if
   the Board has no such block. */
export function open(qid) {
  return load().then(() => (blocks().some((b) => b.qid === qid) ? null : catalog)).then(() => {
    const all = blocks(), at = all.findIndex((b) => b.qid === qid);
    if (at < 0) return false;
    shown = Math.max(shown, at + 1);
    place();
    const n = nodes.get(qid);
    if (!n.querySelector('.ans')) toggle(n, all[at]);
    app.flashHit(list, qid, true);
    return n;
  });
}
