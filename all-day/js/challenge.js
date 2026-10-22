/* challenge.js — the No-algorithm challenge (Stephen, 2026-10-22: "use this
   for five days, see how far you make it without social media and that
   infinite doom scroll ... then tell me what do you miss").

   Where people meet it:
     - a card at the top of the Wire, for a reader who joined, or who came
       from the newsletter (the #challenge link, or any Beehiiv link until
       INVITE_UNTIL) and has not said Not now;
     - #challenge, the link the newsletter uses: it lands on the Wire with the
       challenge open. #challenge/feedback opens the form straight away.

   The card walks the five days: join with one tap, a one-tap check-in each
   day (how did today feel without the feeds), a roundup after day five, and
   the form (what did you miss, what would make you switch, which kind of
   person are you). The rules are challenge-core.js; this file draws them.

   What is kept where: the days and the draft stay on this phone (one
   localStorage key, KEY). Only the form leaves it, when the reader taps
   Send, to nn_challenge_send (supabase/nn-CHALLENGE.sql) with a random id
   this phone made, never a name, an email or an account. Stephen reads the
   answers on the boards desk (mod.html) or in Supabase's table editor.
   Joining and each day's check-in are counted as anonymous GoatCounter
   events, the way tab landings are. The demo keeps everything in memory and
   sends nothing.

   app.js loads this file once, after the first route, and hands it the
   Wire's panel; nothing here can hold up or break the app's boot. */

import * as app from './app.js';
import * as store from './store.js';
import { el, esc, button, ICON } from './ui.js';
import { dayKey } from './habits-core.js';
import * as C from './challenge-core.js';

const demo = store.isDemo();
const today = () => dayKey(Date.now());
const FEEL_LABEL = Object.fromEntries(C.FEELINGS);

/* ------------------------------------------------------------- keeping */
let mem = null;   // the demo's copy, and this visit's copy when storage refuses
function load() {
  if (demo) return C.normalize(mem);
  try {
    const raw = localStorage.getItem(C.KEY);
    return C.normalize(raw ? JSON.parse(raw) : mem);
  } catch (e) { return C.normalize(mem); }
}
function save(s) {
  mem = s;
  if (demo) return;
  try { localStorage.setItem(C.KEY, JSON.stringify(s)); } catch (e) { /* private mode: memory for this visit */ }
}
const update = (patch) => { const s = Object.assign(load(), patch); save(s); return s; };

/* anonymous counts, like the tab landings; never in the demo */
function count(path, title) {
  if (demo || !window.goatcounter || !window.goatcounter.count) return;
  window.goatcounter.count({ path: 'all-day-challenge-' + path, title: 'All Day challenge: ' + title, event: true });
}

/* ------------------------------------------------------------- arriving */
const hashWants = () => {
  const m = location.hash.match(/^#challenge(?:\/(feedback))?$/);
  return m ? m[1] || 'intro' : null;
};
/* A Beehiiv link carries _bhlid or its utm tags. */
function fromNewsletter() {
  const q = new URLSearchParams(location.search);
  return q.has('_bhlid') || /newsletter|email/i.test(q.get('utm_medium') || '') || /btownbrief|beehiiv/i.test(q.get('utm_source') || '');
}
function arrive() {
  const s = load();
  const want = hashWants();
  if (want) {
    if (!s.joined) { s.arrived = true; s.dismissed = false; }
    s.source = s.source || (fromNewsletter() ? 'newsletter' : 'link');
    save(s);
    count('link', 'opened the link');
    /* the address bar goes back to the Wire, so a share or a reload is a
       plain Wire link and this sheet does not open again by itself */
    history.replaceState(null, '', location.pathname + location.search + '#wire');
  } else if (fromNewsletter() && !s.joined && !s.arrived && today() <= C.INVITE_UNTIL) {
    save(Object.assign(s, { arrived: true, source: s.source || 'newsletter' }));
  }
  return want;
}

/* its own stylesheet, so the shell's CSS stays the shell's; the card waits
   for it rather than flashing unstyled */
function styles() {
  if (document.querySelector('link[data-challenge]')) return Promise.resolve();
  return new Promise((done) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'css/challenge.css?v=20261022';
    l.dataset.challenge = '';
    l.onload = l.onerror = () => done();
    setTimeout(done, 3000);
    document.head.appendChild(l);
  });
}

/* ----------------------------------------------------------------- boot */
let slot = null;
let panel = null;
let editing = false;   // today's feeling is being changed

export function start(wirePanel) {
  if (slot || !wirePanel) return;
  panel = wirePanel;
  slot = el('div', 'chal-slot');
  slot.hidden = true;
  panel.insertBefore(slot, panel.querySelector('.panel-body'));
  const want = arrive();
  styles().then(() => {
    paint();
    if (want) open(want);
  });
  /* the router has already landed #challenge on the Wire by the time this runs */
  window.addEventListener('hashchange', () => { const w = arrive(); if (w) { paint(); open(w); } });
  /* a new day while the app slept */
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') paint(); });
  window.addEventListener('storage', (e) => { if (e.key === C.KEY || e.key === null) paint(); });
}

function open(want) {
  if (app.activeTab() !== 'wire') app.go('wire');
  if (want === 'feedback') feedbackSheet(); else overview();
}

/* ----------------------------------------------------------------- card */
export function paint() {
  if (!slot) return;
  const s = load(), t = today();
  slot.innerHTML = '';
  if (!C.showCard(s, t)) { slot.hidden = true; return; }
  slot.hidden = false;
  slot.appendChild(card(s, t));
}

const head = (text, tail) => {
  const b = el('button', 'eyebrow chal-eye', esc(text) + (tail ? ' · ' + esc(tail) : '') + ICON.right);
  b.type = 'button';
  b.addEventListener('click', overview);
  return b;
};
const actions = (...btns) => { const r = el('div', 'chal-acts'); btns.filter(Boolean).forEach((b) => r.appendChild(b)); return r; };

function card(s, t) {
  const ph = C.phase(s, t);
  const sum = C.summary(s, t);
  const c = el('section', 'chal-card');
  c.setAttribute('aria-label', 'No-algorithm challenge');

  if (ph === 'none') {
    c.dataset.chal = 'invite';
    c.append(head('No-algorithm challenge'),
      el('h2', 'chal-h', 'Five days without the feeds'),
      el('p', 'chal-p', 'Use All Day instead of social media, then tell us what you missed.'),
      actions(button('I’m in', 'chal-go', join), button('Not now', 'ghost', notNow)));
    return c;
  }

  if (ph === 'done') {
    c.dataset.chal = s.sent ? 'sent' : 'roundup';
    c.append(head('No-algorithm challenge', 'Done'), el('h2', 'chal-h', esc(C.headline(sum))), dots(sum, true));
    if (s.sent) c.append(el('p', 'chal-p', 'Thanks for telling us.'));
    c.append(actions(
      button(s.sent ? 'Add more' : 'Tell us what you missed', s.sent ? 'ghost' : 'chal-go', feedbackSheet),
      button('Close', 'ghost', closeCard)));
    return c;
  }

  const felt = s.feel[t];
  if (!felt || editing) {
    c.dataset.chal = 'checkin';
    c.append(head('No-algorithm challenge', 'Day ' + sum.day + ' of ' + C.DAYS),
      el('h2', 'chal-h', 'How did today feel without the feeds?'), feels(felt), dots(sum, false));
    return c;
  }
  c.dataset.chal = 'logged';
  const fix = button('Change', 'ghost sm', () => { editing = true; paint(); });
  c.append(head('No-algorithm challenge', 'Day ' + sum.day + ' of ' + C.DAYS),
    el('h2', 'chal-h', 'Day ' + sum.day + ' ' + esc(C.FEEL_LINE[felt])), dots(sum, false),
    actions(button(s.sent ? 'Add more' : 'Tell us what’s missing', 'ghost sm', feedbackSheet), fix));
  return c;
}

/* the five feelings, one tap each */
function feels(current) {
  const row = el('div', 'chal-feels');
  C.FEELINGS.forEach(([k, label]) => {
    const b = el('button', 'chal-feel' + (k === 'caved' ? ' slip' : '') + (k === current ? ' on' : ''), esc(label));
    b.type = 'button';
    b.dataset.feel = k;
    b.setAttribute('aria-pressed', k === current ? 'true' : 'false');
    b.addEventListener('click', () => checkIn(k));
    row.appendChild(b);
  });
  return row;
}

/* the five days: filled for a day without the feeds, a ring for a slip */
function dots(sum, words) {
  const row = el('ol', 'chal-dots');
  sum.days.forEach((d) => {
    const li = el('li', 'chal-dot' + (d.feel ? (d.feel === 'caved' ? ' slip' : ' free') : '') + (d.today ? ' now' : ''));
    const said = d.feel ? FEEL_LABEL[d.feel] : (d.past ? 'not logged' : '');
    li.innerHTML = '<span class="o" aria-hidden="true"></span><span class="n" aria-hidden="true">' +
      esc(words && d.feel ? FEEL_LABEL[d.feel] : 'Day ' + d.day) + '</span><span class="sr">' + esc('Day ' + d.day + (said ? ', ' + said : '')) + '</span>';
    row.appendChild(li);
  });
  return row;
}

/* -------------------------------------------------------------- actions */
function join() {
  const s = C.join(load(), today(), fromNewsletter() ? 'newsletter' : 'app');
  save(s);
  editing = false;
  count('join', 'joined');
  app.closeSheet();
  if (app.activeTab() !== 'wire') app.go('wire');
  paint();
  if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
  app.toast('Day 1 starts now');
}
function notNow() {
  const before = load();
  update({ dismissed: true });
  paint();
  app.toast('Challenge hidden', () => { save(before); paint(); });
}
function closeCard() {
  const before = load();
  update({ closed: true });
  paint();
  app.toast('Challenge closed', () => { save(before); paint(); });
}
function checkIn(k) {
  const t = today();
  const before = load();
  const s = C.checkIn(before, t, k);
  if (s === before) return;
  save(s);
  editing = false;
  const n = C.dayOf(s, t);
  if (before.feel[t] !== k) count('day' + n + '-' + k, 'day ' + n + ' ' + k);
  paint();
  app.toast(C.phase(s, t) === 'done' ? 'That’s all five days' : 'Day ' + n + ' logged');
}

/* --------------------------------------------------------------- sheets */
function overview() {
  app.sheet('No-algorithm challenge', (body, sheetCard, close) => {
    body.classList.add('chal-sheet');
    const s = load(), t = today(), ph = C.phase(s, t);
    if (ph === 'none') {
      body.append(
        el('p', 'chal-lede', 'Five days without the feeds that pick for you. Skip Instagram, TikTok, Facebook and X, and use All Day for the news, the plans and the fun stuff.'),
        el('p', 'chal-lede', 'Each day, tap how it felt. After day five, tell us what you missed and what would make you switch.'),
        actions(button('I’m in', 'chal-go', join)));
      return;
    }
    const sum = C.summary(s, t);
    body.append(el('h3', 'chal-sh', esc(ph === 'done' ? C.headline(sum) : 'Day ' + sum.day + ' of ' + C.DAYS)), dots(sum, true));
    const again = ph === 'done' ? button('Start again', 'ghost', () => { save(C.quit(load())); join(); }) : null;
    body.append(actions(button(s.sent ? 'Add more' : 'Tell us what you missed', 'chal-go', feedbackSheet), again));
    const stop = button('Stop the challenge', 'ghost sm chal-stop', () => app.confirmBox({
      title: 'Stop the challenge?', body: 'Your days so far are cleared from this phone.', yes: 'Stop',
      onYes: () => { save(C.quit(load())); editing = false; close(); paint(); app.toast('Challenge stopped'); },
    }));
    if (ph === 'on') body.append(stop);
  });
}

/* The form. Everything is optional but one answer; the draft is kept on
   this phone as it is typed, so a closed sheet or a failed send loses
   nothing. */
function feedbackSheet() {
  app.sheet('Tell us what you missed', (body) => {
    body.classList.add('chal-sheet');
    const draft = load().draft;
    const keep = () => update({ draft: Object.assign({}, draft) });
    const f = el('form', 'chal-form');
    f.noValidate = true;

    f.appendChild(el('h3', 'chal-q', 'What did you miss?'));
    const missed = el('div', 'chal-chips');
    C.MISSED.forEach(([k, label]) => {
      const on = draft.missed.includes(k);
      const b = el('button', 'chal-chip' + (on ? ' on' : ''), esc(label));
      b.type = 'button';
      b.dataset.missed = k;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', () => {
        const now = !draft.missed.includes(k);
        draft.missed = now ? draft.missed.concat(k) : draft.missed.filter((x) => x !== k);
        b.classList.toggle('on', now);
        b.setAttribute('aria-pressed', now ? 'true' : 'false');
        keep();
      });
      missed.appendChild(b);
    });
    f.appendChild(missed);
    f.appendChild(field('input', 'missed_other', 'Anything else', 'What else did you miss', draft, keep));

    f.appendChild(el('h3', 'chal-q', 'What would make you switch for good?'));
    f.appendChild(field('textarea', 'switch_for', 'A section, a feature, a feed…', 'What would make you switch for good', draft, keep));

    f.appendChild(el('h3', 'chal-q', 'Which one sounds most like you?'));
    const kinds = el('div', 'chal-kinds');
    kinds.setAttribute('role', 'radiogroup');
    kinds.setAttribute('aria-label', 'Which one sounds most like you');
    C.ARCHETYPES.forEach(([k, name, gloss]) => {
      const b = el('button', 'chal-kind' + (draft.archetype === k ? ' on' : ''),
        '<b>' + esc(name) + '</b>' + (gloss ? '<span>' + esc(gloss) + '</span>' : ''));
      b.type = 'button';
      b.dataset.kind = k;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', draft.archetype === k ? 'true' : 'false');
      b.addEventListener('click', () => {
        draft.archetype = draft.archetype === k ? '' : k;
        kinds.querySelectorAll('.chal-kind').forEach((x) => {
          const on = x.dataset.kind === draft.archetype;
          x.classList.toggle('on', on);
          x.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        keep();
      });
      kinds.appendChild(b);
    });
    f.appendChild(kinds);
    f.appendChild(field('input', 'archetype_words', 'Or in your own words', 'Describe yourself in your own words', draft, keep));

    f.appendChild(el('p', 'sheet-note', 'Only Stephen reads these. No name or email goes with them.'));
    const go = button('Send', 'chal-go chal-send');
    go.type = 'submit';
    const msg = el('p', 'sheet-note chal-msg');
    msg.setAttribute('role', 'status');
    f.append(go, msg);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(draft, go, msg);
    });
    body.appendChild(f);
  });
}

function field(kind, name, placeholder, label, draft, keep) {
  const n = el(kind, 'field chal-in' + (kind === 'textarea' ? ' chal-area' : ''));
  if (kind === 'textarea') n.rows = 3; else n.type = 'text';
  n.name = name;
  n.placeholder = placeholder;
  n.maxLength = C.LIMITS[name];
  n.value = draft[name] || '';
  n.setAttribute('aria-label', label);
  n.addEventListener('input', () => { draft[name] = n.value; keep(); });
  return n;
}

const SAY = {
  empty: 'Pick or write at least one thing first.',
  busy: 'Too many answers at once. Try again in a bit.',
  bad_input: 'Something in there didn’t fit. Try it a little shorter.',
};
async function submit(draft, go, msg) {
  let s = load();
  if (!C.isId(s.cid)) s = update({ cid: C.newId() });
  const r = C.feedbackArgs(s, draft, today());
  if (r.error) { msg.textContent = SAY[r.error] || SAY.bad_input; return; }
  go.disabled = true;
  msg.textContent = '';
  const out = await send(r.args);
  go.disabled = false;
  if (!out || !out.ok) {
    msg.textContent = SAY[out && out.error] || 'Couldn’t send it just now. Your answers are kept here, so try again later.';
    return;
  }
  update({ sent: Date.now() });
  count('sent', 'sent feedback');
  app.closeSheet();
  paint();
  app.toast(demo ? 'Nothing is sent from the demo' : 'Sent. Thank you!');
}

/* one door, anonymous on purpose: no Authorization header, so the row
   cannot be tied to an account even by accident */
async function send(args) {
  if (demo) return { ok: true };
  try {
    const r = await fetch(store.SB_URL + '/rest/v1/rpc/nn_challenge_send', {
      method: 'POST',
      headers: { apikey: store.SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || Array.isArray(j)) return { error: 'offline' };
    return j;
  } catch (e) { return { error: 'offline' }; }
}
