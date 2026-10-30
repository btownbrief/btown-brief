/* paper-front.js — The Paper's Front (wave 1, 2026-10-29): the news
   outlet's front door, the hub's job from now on.

   The first screen on a 390 phone, from the inspiration pass
   (newsletter/reference/drafts/apps-2026-10/paper-inspiration.md): the
   date, the mission line, a one-line email strip, the twelve questions as
   a swipe row, and the top of today's lead. Then the lead itself with what
   is in that edition, everything we make (beside the lead, in the rail, on
   a wide screen), and today's picks.

   The email strip is the shell's own Beehiiv embed (asks.js): the address
   is typed into beehiiv.com in a sandboxed frame, never into this page.
   Each question opens its answer as a sheet of at most four links, copied
   from the hub (data/paper/questions.json). */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, safeHref, ICON, cards, chips, listRail } from '../ui.js';
import { sectionBar } from '../sections.js';
import { BEEHIIV_EMBED, subscribed } from '../asks.js';
import * as P from './paper-core.js';

const KEY = 'front';
const S = { root: null, slots: {}, latest: null, qs: [], pending: null, ready: false, edAt: 0 };

/* -------------------------------------------------------------- the strip */
function mailStrip() {
  const box = el('div', 'askcard pp-mail');
  box.dataset.ask = 'news';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Get the Btown Brief');
  const jump = el('a', '', esc('Read the latest first'));
  jump.href = '#front/edition';
  if (!app.demo && subscribed()) {
    box.classList.add('in');
    box.appendChild(el('p', 'ask-t', esc('You get the Brief. Thanks for reading.')));
    const foot = el('div', 'pp-mail-foot');
    foot.appendChild(jump);
    box.appendChild(foot);
    return box;
  }
  box.appendChild(el('p', 'ask-t', esc('The Btown Brief, free in your inbox Monday and Friday.')));
  if (app.demo) {
    /* the demo draws the strip's shape; the real one is Beehiiv's own form */
    const r = el('div', 'pp-mail-row', '<input class="field" type="email" placeholder="Your email" aria-label="Your email (demo)" disabled>');
    const b = el('button', 'btn sm', 'Subscribe');
    b.type = 'button';
    b.addEventListener('click', () => app.toast('Demo: the real strip is Beehiiv’s own form'));
    r.appendChild(b);
    box.appendChild(r);
  } else {
    const f = document.createElement('iframe');
    f.className = 'ask-embed';
    f.src = BEEHIIV_EMBED;
    f.title = 'Subscribe to the Btown Brief';
    f.height = '52';
    f.setAttribute('frameborder', '0');
    f.setAttribute('scrolling', 'no');
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    /* the same sandbox as the shell's ask: Beehiiv may submit its form, never steer this page */
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    box.appendChild(f);
  }
  const foot = el('div', 'pp-mail-foot');
  foot.appendChild(jump);
  const already = el('button', 'btn ghost sm', esc('I’m already subscribed'));
  already.type = 'button';
  already.addEventListener('click', () => {
    if (!app.demo) store.setAsk('subscribed', true);
    app.toast('Thanks for reading');
    box.replaceWith(mailStrip());
  });
  foot.appendChild(already);
  box.appendChild(foot);
  return box;
}

/* ---------------------------------------------------------- the questions */
function openQuestion(q) {
  app.sheet(q.q, (body) => {
    body.classList.add('pp-qsheet');
    (q.links || []).slice(0, 4).forEach((l) => {
      const href = safeHref(l.href);
      const ext = /^https?:/.test(href);
      const r = el('div', 'sheet-row');
      const a = el('a', 't', esc(l.title) + '<div class="d">' + esc(l.line || '') + '</div>');
      a.href = href;
      if (ext) { a.target = '_blank'; a.rel = 'noopener'; }
      r.appendChild(a);
      r.appendChild(el('span', 'pp-go', ext ? ICON.ext : ICON.right));
      body.appendChild(r);
    });
  });
  if (!app.demo && window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path: 'paper-question-' + q.key, title: 'The Paper question: ' + q.q, event: true });
  }
}

/* ----------------------------------------------------------------- draw */
function draw(d) {
  const root = S.root;
  root.innerHTML = '';
  S.slots = {};
  const page = P.bind(el('div', 'pp'));

  /* Today: the date, the mission, the strip */
  const today = P.block(page, 'today', 'Today');
  today.querySelector('.sec').remove();
  today.appendChild(el('p', 'pp-dateline', '<span class="eyebrow">' + esc(P.longDate(new Date())) + ' · Burlington, Vermont</span>'));
  today.appendChild(el('h1', 'pp-mission', esc(P.MISSION)));
  today.appendChild(mailStrip());
  S.slots.today = today;

  /* Questions: the twelve, a swipe row; each opens its answer */
  const qbox = P.block(page, 'questions', 'What are you here for?');
  S.qs = d.questions;
  if (S.qs.length) {
    const row = chips(S.qs.map((q) => ({ key: q.key, label: q.q })), null, (k) => { const q = S.qs.find((x) => x.key === k); if (q) openQuestion(q); }, 'pp-qs');
    row.setAttribute('aria-label', 'Questions, each opens a few links');
    row.querySelectorAll('.chip').forEach((c) => c.removeAttribute('aria-pressed'));
    qbox.appendChild(row);
  } else P.noteLine(qbox, 'The questions didn’t load. Everything has every page.');
  S.slots.questions = qbox;

  /* The edition: the latest one's lead and what was in it */
  const ed = P.block(page, 'edition', 'The edition');
  ed.querySelector('.sec').remove();
  const L = d.latest;
  if (L && L.title && L.url) {
    const dt = new Date(L.date);
    const at = isNaN(dt) ? 0 : Math.floor(dt.getTime() / 1000);
    S.edAt = at;
    const it = app.know([{ kind: 'lead', k: 'front-lead', title: L.title, why: String(L.preview || '').replace(/\s+/g, ' '), href: safeHref(L.url),
      src: 'The Btown Brief', sid: 'btownbrief', own: true, ago: at ? P.ago(at) : '' }])[0];
    const wrap = el('div', 'pp-lead');
    const card = cards.lead(it, { tag: 'The latest edition' + (at ? ' · ' + P.shortDate(new Date(at * 1000)) : '') });
    if (card) wrap.appendChild(card);
    ed.appendChild(wrap);
    const stories = d.rundown.slice(0, 6);
    if (stories.length) {
      ed.appendChild(el('div', 'tdiv', '<span>In this edition</span><span class="s">' + stories.length + ' stories</span>'));
      const ol = el('ol', 'pp-rundown');
      stories.forEach((s, i) => {
        const li = el('li', '', '<span class="n">' + (i + 1) + '</span><span><a href="' + esc(safeHref(s.u)) + '" target="_blank" rel="noopener">' + esc(s.t) + '</a>' +
          (s.s ? '<span class="src">' + esc(s.s) + '</span>' : '') + '</span>');
        ol.appendChild(li);
      });
      ed.appendChild(ol);
    }
    const more = el('div', 'pp-more');
    more.appendChild(P.linkBtn('Read the edition', L.url, 'sm'));
    const all = el('a', 'btn ghost sm', esc('Every edition'));
    all.href = '#editions';
    more.appendChild(all);
    ed.appendChild(more);
  } else {
    P.noteLine(ed, 'The latest edition didn’t load. It comes back when the connection does.');
    const more = el('div', 'pp-more');
    more.appendChild(P.linkBtn('Read the Brief', P.LINKS.brief));
    ed.appendChild(more);
  }
  S.slots.edition = ed;

  /* Everything we make: the eight apps, a strip (the rail has them on a wide screen) */
  const ab = el('section', 'pp-sec pp-apps-sec');
  ab.appendChild(el('div', 'sec', '<div><h2>' + esc('Everything we make') + '</h2><p>' + esc('Eight free apps for Burlington, no account, no ads.') + '</p></div>'));
  const track = listRail(ab, { name: 'paper-apps', label: 'the apps', cls: 'pp-apprail' });
  P.appCards(track, KEY, { inRail: true });
  const azBtn = el('div', 'pp-more');
  const az = el('a', 'btn ghost sm', esc('Every page and game, A to Z'));
  az.href = '#everything';
  azBtn.appendChild(az);
  ab.appendChild(azBtn);
  page.appendChild(ab);

  /* Picks: three of Stephen's a day, and the page in the spotlight */
  const pk = P.block(page, 'picks', 'Today’s picks', 'From Stephen, a few a day');
  const items = d.picks.map((p, i) => P.item(KEY, 'pick-' + i + '-' + p.title, { title: p.title, line: p.why, href: p.href, eyebrow: p.eyebrow || null }));
  app.know(items);
  items.forEach((it) => { const n = P.row(it); if (n) pk.appendChild(n); });
  const pm = el('div', 'pp-more');
  const pa = el('a', 'btn ghost sm', esc('All of Stephen’s picks'));
  pa.href = '#picks';
  pm.appendChild(pa);
  pk.appendChild(pm);
  S.slots.picks = pk;

  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) { app.paintSubnav(); app.paintAside(); }
}

function gather() {
  return Promise.all([P.load('latest'), P.load('recent'), P.load('questions'), P.load('picks'), P.load('catalog')]).then(([latest, recent, qs, pj, cat]) => {
    const eds = (recent && Array.isArray(recent.editions) ? recent.editions : []);
    const mine = latest && eds.find((e) => e.url === latest.url);
    return {
      latest,
      rundown: ((mine || eds[0] || {}).stories || []).filter((s) => s && s.t && s.u),
      questions: ((qs && qs.questions) || []).filter((q) => q && q.key && q.q),
      picks: P.todaysPicks(pj, cat),
    };
  });
}

let loading = null;
function load() {
  if (!loading) loading = gather().then((d) => { S.data = d; S.edAt = 0; const t = new Date((d.latest || {}).date); S.edAt = isNaN(t) ? 0 : Math.floor(t / 1000); S.ready = true; app.recount(); return d; });
  return loading;
}
setTimeout(load, 0);

function land() {
  const want = S.pending;
  if (!want || !S.ready || !S.root || !S.root.firstChild) return;
  S.pending = null;
  if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
  const q = S.qs.find((x) => x.key === want);
  if (q) { openQuestion(q); return; }
  if (!app.flashHit(S.root, want)) app.toast('That’s gone from the Front now.');
}

app.register(KEY, {
  label: 'Front',
  icon: ICON.paper,
  promise: 'Today’s edition, the questions, and today’s picks.',
  mount(root) {
    P.style();
    S.root = root;
    root.appendChild(el('p', 'loading', esc('Loading the Front…')));
    load().then((d) => { draw(d); land(); });
  },
  activate(param) { S.pending = param || null; land(); },
  refresh() { if (S.data && S.root) draw(S.data); },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-paper-front', title: 'Front', color: '--app-paper-pop',
      find: (k) => S.slots[k], onPick: (k) => app.jumpTo(S.slots[k]),
      items: [{ key: 'today', label: 'Today' }, { key: 'questions', label: 'Questions' }, { key: 'edition', label: 'The edition', newest: S.edAt || undefined }, { key: 'picks', label: 'Picks' }] });
  },
  keepSubnav: true,
  aside() {
    if (!S.ready) return null;
    const box = el('div', 'ws pp-aside');
    box.appendChild(el('h3', '', esc('Everything we make')));
    box.appendChild(el('p', '', esc('Eight free apps for Burlington. No account, no ads.')));
    P.appCards(box, KEY, { column: true });
    return box;
  },
  newSince(ts) { return S.edAt && S.edAt > (Number(ts) || P.now() - 4 * 3600) ? 1 : 0; },
});
