/* answers.js — the town's answers. One module, one component, on Stay Awhile's
   table, so its report button, auto-hide and admin.html moderate them too.

   A question's id says where it came from: q### and tt### a deck card, bd###
   Stephen's board prompts (data/board-prompts.json), n<12 hex> a Wire story's
   question. The server refuses any other shape (supabase/nn-ANSWERS.sql).

   The reveal is one rule everywhere. Before you answer: the count, the top two
   answers cut short with their names held back, and the box. After you answer
   (remembered per question): every answer in full, yours first, hearts, report.
   There is no skip; answering is the unlock. Only the cut words ever reach the
   page before then.

   panel(qid) is the component: Talk opens it in a sheet, the Board in place,
   table.html in a tile. Nothing here needs the shell, so table.html can load it.
   Every call fails soft: no backend reads as no answers yet.

   Demo runs on data/demo/answers.json, in memory for the visit. */

import * as store from './store.js';
import { el, esc, svg, agoShort } from './ui.js';

const VOTER_KEY = 'sa-visitor';          // Stay Awhile's own, so a person is one voter
const NAME_KEY = 'sa-name';
const HEARTED_KEY = 'sa-hearted';
const FLAGGED_KEY = 'sa-flagged';
const ANSWERED_KEY = 'allday-answered';  // { qid: { id, at } }
const QID = /^(q[0-9]{3,4}|tt[0-9]{3,4}|bd[0-9]{3,4}|n[0-9a-f]{12})$/;
const FRESH_MS = 60000;
const TEASE_WORDS = 7;
const TEASE_SHARE = 0.6;                 // a short answer is never given away whole
const TEASED = 2;
const MAX_BODY = 600;
const MAX_NAME = 24;
const EVENT = 'allday-answers';
const HEART = svg('<path d="M12 20.2 4.6 12.9a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8a4.7 4.7 0 0 1 6.6 6.7z"/>');

/* every word a reader sees */
export const WORDS = {
  answer: 'Answer', answers: 'Answers', first: 'Be the first.',
  unlock: (n) => (n === 1 ? '1 answer. Yours unlocks it.' : n + ' answers. Yours unlocks them.'),
  many: (n) => (n === 1 ? '1 answer' : n + ' answers'),
  box: 'Your answer', name: 'Name', post: 'Post', you: 'You', anon: 'Anonymous',
  heart: 'Heart', report: 'Report', reported: 'Reported',
  slow: 'Slow down a minute.', rejected: 'That one can’t go up.', short: 'A little more.', failed: 'Couldn’t post. Try again.',
};

const demo = () => store.isDemo();
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const memo = {};                         // the demo's answered, hearted and flagged, for the visit
const recall = (key) => (demo() ? memo[key] || (memo[key] = {}) : obj(store.read(key, {})));
const keep = (key, v) => { if (demo()) memo[key] = v; else store.write(key, v); };

function voter() {
  let v = store.read(VOTER_KEY, null);
  if (typeof v === 'string' && v.length >= 8) return v;
  v = 'v' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  store.write(VOTER_KEY, v);
  return v;
}

/* store.rpc swallows errors, and the server's words ('slow down') are the point here */
function call(fn, args) {
  return fetch(store.SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: store.SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  }).then((r) => r.text().then((t) => {
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
    if (!r.ok) throw new Error(String((j && j.message) || r.status));
    return j;
  }));
}

/* ------------------------------------------------------------------- reading */
const rowsOf = (v) => (Array.isArray(v) ? v.filter((r) => r && r.id && r.body) : []);
const atOf = (r) => Date.parse(r.created_at) || 0;
const best = (a, b) => (Number(b.hearts) || 0) - (Number(a.hearts) || 0) || atOf(b) - atOf(a);
const liveId = (r) => !recall(FLAGGED_KEY)[r.id];

let demoRows = null;
function demoLoad() {
  if (!demoRows) {
    demoRows = fetch(new URL('../data/demo/answers.json', import.meta.url)).then((r) => r.json()).then((j) => {
      const now = Date.now();
      return rowsOf(j.rows).map((r) => ({ ...r, hearts: Number(r.hearts) || 0, created_at: new Date(now - Number(r.ageHours || 0) * 3600000).toISOString() }));
    }).catch(() => []);
  }
  return demoRows;
}

let act = new Map();                     // qid -> { n, last } with last in ms
let actAt = 0, actP = null, feedAt = 0, feedP = null, feedRows = [];

export const count = (qid) => (act.get(qid) || { n: 0 }).n;
export const lastAt = (qid) => (act.get(qid) || { last: 0 }).last;
export const entries = () => [...act.entries()];

/* who has answers, how many, and when the last one landed */
export function activity() {
  if (actP && Date.now() - actAt < FRESH_MS) return actP;
  actAt = Date.now();
  const rows = demo()
    ? demoLoad().then((list) => { const m = new Map(); list.forEach((r) => { const c = m.get(r.qid) || { qid: r.qid, n: 0, last_at: r.created_at }; c.n += 1; if (atOf(r) > Date.parse(c.last_at)) c.last_at = r.created_at; m.set(r.qid, c); }); return [...m.values()]; })
    : call('btb_sa_activity');
  actP = Promise.resolve(rows).then((list) => {
    const next = new Map(act);           // what this phone just posted stays counted if the server is behind
    (Array.isArray(list) ? list : []).forEach((a) => {
      if (!a || !a.qid) return;
      const had = next.get(a.qid), last = Date.parse(a.last_at) || 0;
      next.set(a.qid, had && had.last > last ? had : { n: Number(a.n) || 0, last });
    });
    act = next;
    return act;
  }).catch(() => act);
  return actP;
}

/* everything the town has said, newest first */
export function feed() {
  if (feedP && Date.now() - feedAt < FRESH_MS) return feedP.then(() => feedRows);
  feedAt = Date.now();
  feedP = Promise.resolve(demo() ? demoLoad() : call('btb_sa_feed', { p_limit: 1000 }))
    .then((list) => { feedRows = rowsOf(list); })
    .catch(() => {});
  return feedP.then(() => feedRows);
}

/* one question's answers, best first */
export function list(qid) {
  const rows = demo() ? demoLoad().then((all) => all.filter((r) => r.qid === qid)) : call('btb_sa_list', { p_qid: qid });
  return Promise.resolve(rows).then((r) => rowsOf(r).sort(best));
}

export const answered = (qid) => !!recall(ANSWERED_KEY)[qid];
const myId = (qid) => (recall(ANSWERED_KEY)[qid] || {}).id || null;

/* a card's question id, or null when it cannot take answers: a plain headline
   has no question, and only the shapes the server knows get a box */
export function qidOf(c) {
  if (!c || !c.id || (c.story && !c.hl)) return null;
  const q = c.story ? 'n' + c.id : String(c.id);
  return demo() || QID.test(q) ? q : null;
}
export const isQid = (k) => QID.test(String(k || ''));

/* the words of a tease: cut, fading, nameless */
export function cut(body) {
  const words = String(body || '').trim().split(/\s+/).filter(Boolean);
  const keepN = Math.min(TEASE_WORDS, Math.max(1, Math.ceil(words.length * TEASE_SHARE)));
  return words.slice(0, keepN).join(' ') + '…';
}
export const teased = (rows) => rows.filter(liveId).slice().sort(best).slice(0, TEASED);
const teaseNode = (r) => el('p', 'ans-cut', esc(cut(r.body)));
export function teaseNodes(host, rows) { host.replaceChildren(...teased(rows).map(teaseNode)); }

export function on(fn) {
  const h = (e) => fn(e.detail || {});
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/* ------------------------------------------------------------------- writing */
function landed(qid, row) {
  const done = recall(ANSWERED_KEY);
  done[qid] = { id: row ? row.id : null, at: Math.floor(Date.now() / 1000) };
  keep(ANSWERED_KEY, done);
  const had = act.get(qid) || { n: 0, last: 0 };
  act = new Map(act).set(qid, { n: had.n + (row ? 1 : 0), last: Date.now() });
  if (row) feedRows = [{ ...row, qid }].concat(feedRows);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { qid } }));
}

function submit(qid, name, body) {
  const v = body.replace(/\s+/g, ' ').trim().slice(0, MAX_BODY);
  const who = name.trim().slice(0, MAX_NAME);
  const row = (id) => ({ qid, id, name: who || null, body: v, hearts: 0, created_at: new Date().toISOString() });
  if (demo()) return Promise.resolve(row('demo-' + Date.now()));
  return call('btb_sa_submit', { p_qid: qid, p_name: who, p_body: v, p_voter: voter() }).then((id) => row(String(id)));
}

const refused = (m) => ({ 'slow down': WORDS.slow, rejected: WORDS.rejected, 'too short': WORDS.short }[m] || WORDS.failed);

function heart(id) {
  const h = recall(HEARTED_KEY);
  h[id] = 1;
  keep(HEARTED_KEY, h);
  if (!demo()) call('btb_sa_heart', { p_answer: id, p_voter: voter() }).catch(() => {});
}
function flag(id) {
  const f = recall(FLAGGED_KEY);
  f[id] = 1;
  keep(FLAGGED_KEY, f);
  if (!demo()) call('btb_sa_flag', { p_answer: id, p_voter: voter() }).catch(() => {});
}

/* ----------------------------------------------------------------- the panel */
function rowNode(r, mine) {
  const li = el('li', 'ans-row' + (mine ? ' mine' : ''));
  li.dataset.id = r.id;
  li.append(el('p', 'ans-body', esc(r.body)));
  const foot = el('div', 'ans-foot', '<span class="ans-who">' + esc(mine ? WORDS.you : r.name || WORDS.anon) + '</span><span class="ans-when">' + esc(agoShort(atOf(r) / 1000)) + '</span><span class="ans-sp"></span>');
  const hearted = !!recall(HEARTED_KEY)[r.id];
  const h = el('button', 'act ans-heart' + (hearted ? ' on' : ''), HEART + '<span class="n">' + esc(r.hearts || '') + '</span>');
  h.type = 'button';
  h.disabled = hearted;
  h.setAttribute('aria-label', WORDS.heart);
  h.setAttribute('aria-pressed', hearted ? 'true' : 'false');
  h.addEventListener('click', () => {
    h.disabled = true;
    h.classList.add('on');
    h.setAttribute('aria-pressed', 'true');
    r.hearts = (Number(r.hearts) || 0) + 1;
    h.querySelector('.n').textContent = r.hearts;
    heart(r.id);
  });
  foot.append(h);
  if (!mine) {
    const f = el('button', 'ans-report', esc(WORDS.report));
    f.type = 'button';
    f.addEventListener('click', () => { flag(r.id); li.remove(); });
    foot.append(f);
  }
  li.append(foot);
  return li;
}

function formNode(onPost) {
  const f = el('form', 'ans-form');
  const box = el('textarea', 'ans-box');
  box.rows = 2; box.maxLength = MAX_BODY; box.placeholder = WORDS.box;
  box.setAttribute('aria-label', WORDS.box);
  const name = el('input', 'ans-name');
  name.type = 'text'; name.maxLength = MAX_NAME; name.placeholder = WORDS.name; name.autocomplete = 'given-name';
  name.setAttribute('aria-label', WORDS.name);
  if (!demo()) name.value = String(store.read(NAME_KEY, '') || '');
  const go = el('button', 'btn ans-go', esc(WORDS.post));
  const row = el('div', 'ans-line');
  row.append(name, go);
  const err = el('p', 'ans-err');
  err.hidden = true;
  err.setAttribute('role', 'alert');
  f.append(box, row, err);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = box.value.trim();
    err.hidden = true;
    if (body.length < 2) { err.textContent = WORDS.short; err.hidden = false; box.focus(); return; }
    go.disabled = true;
    if (!demo()) store.write(NAME_KEY, name.value.trim());
    onPost(name.value, body, (msg) => { go.disabled = false; err.textContent = msg; err.hidden = false; });
  });
  return f;
}

export function panel(qid) {
  const box = el('div', 'ans');
  box.dataset.qid = qid;
  const head = el('p', 'ans-count');
  const tease = el('div', 'ans-tease');
  const out = el('ul', 'ans-list');
  let rows = null;
  const form = formNode((name, body, fail) => {
    submit(qid, name, body).then((row) => {
      rows = [row].concat((rows || []).filter((r) => r.id !== row.id));
      landed(qid, row);
      paint();
      if (document.activeElement && box.contains(document.activeElement)) document.activeElement.blur();
    }).catch((e) => {
      if (e.message !== 'duplicate') { fail(refused(e.message)); return; }
      landed(qid, null);
      list(qid).then((r) => { rows = r; paint(); }).catch(paint);
    });
  });
  const paint = () => {
    const open = answered(qid), mine = myId(qid), n = rows ? rows.filter(liveId).length : count(qid);
    box.classList.toggle('ans-open', open);
    form.hidden = open;
    tease.hidden = open;
    out.hidden = !open;
    head.textContent = open ? WORDS.many(n) : rows && !n ? WORDS.first : n ? WORDS.unlock(n) : '';
    if (!open) { teaseNodes(tease, rows || []); return; }
    const shown = (rows || []).filter(liveId);
    out.replaceChildren(...shown.filter((r) => r.id === mine).concat(shown.filter((r) => r.id !== mine)).map((r) => rowNode(r, r.id === mine)));
  };
  box.append(head, tease, form, out);
  paint();
  list(qid).then((r) => { rows = r; }).catch(() => { rows = rows || []; }).then(paint);
  return box;
}
