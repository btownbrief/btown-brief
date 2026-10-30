/* template.js — Body's Today cell (wave 1, 2026-10-29). Today is the
   habits tracker (modes/habits.js, untouched) with a Habits · Template ·
   Build switch over it. The Build (modes/build.js, untouched) is hosted in
   the same cell, so its Build | Habits pairing holds: a habit tapped done
   still drops a pallet on the site. Template is Stephen's own daily list (data/body/template-stephen.json):
   each habit with its one-line why, and one tap that copies all sixteen
   into the reader's tracker.

   The copy goes through the tracker's own Add form, one habit at a time,
   so it is the same door a reader's own typing uses: this phone's list
   when signed out (habits-local.js), the account when signed in, the
   demo's pretend server in the demo, with the same checks and the same
   repaint. A habit already on the list (same name) is left alone.

   Routes: #template lands on Habits (the bar's Today always does);
   #template/stephen is the template; #template/t-<n> flashes one habit. */

import * as app from '../app.js';
import { el, esc, ICON, button, pills } from '../ui.js';
import { liquify } from '../liquid.js';
import { data, row, para, section, plural } from './body-kit.js';

const KEY = 'template';
const FREQ = { daily: 'Daily', weekdays: 'Weekdays' };
const freqWord = (h) => (h.frequency === 'n_per_week' ? h.n + ' a week' : FREQ[h.frequency] || '');
const CAT = { fitness: 'Fitness', creative: 'Creative', business: 'Work', life_admin: 'Life admin', learn: 'Learning' };

const S = { root: null, tpl: null, failed: false, busy: false, done: null };

/* ---------------------------------------------- the tracker's own Add form */
const HB = '#panel-habits';
const q = (sel) => document.querySelector(HB + ' ' + sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  for (let t = 0; t < ms; t += 40) { const v = fn(); if (v) return v; await sleep(40); }
  return null;
}
const onList = () => new Set([...document.querySelectorAll(HB + ' .hb-row .hb-name')].map((n) => n.textContent.trim().toLowerCase()));

/* Add each habit through the tracker's form; resolves { added, had, error }.
   A habit counts as added only once its row is on the list. */
async function copy(list) {
  app.go('habits');
  const ready = await until(() => q('.hb-addbtn') || q('.hb-form'));
  if (!ready) return { added: 0, had: 0, error: 'Your habits didn’t open. Try again.' };
  /* a habit the reader is in the middle of typing is theirs: leave it */
  const draft = q('.hb-form input[name="text"]');
  if (draft && draft.value.trim()) return { added: 0, had: 0, error: 'Finish the habit you’re adding first.' };
  const have = onList();
  let added = 0, had = 0;
  for (const h of list) {
    const name = h.text.trim().toLowerCase();
    if (have.has(name)) { had++; continue; }
    if (!q('.hb-form')) { const b = q('.hb-addbtn'); if (!b) return { added, had, error: 'Stopped after ' + added + '.' }; b.click(); }
    const f = await until(() => q('.hb-form'), 3000);
    if (!f) return { added, had, error: 'Stopped after ' + added + '.' };
    f.querySelector('input[name="text"]').value = h.text;
    const fb = f.querySelector('[data-freq="' + h.frequency + '"]');
    if (fb) fb.click();
    if (h.frequency === 'n_per_week') f.querySelector('select[name="n"]').value = String(h.n);
    const share = f.querySelector('input[name="shared"]');
    if (share) share.checked = !!h.shared;
    f.requestSubmit();
    /* done when its row is on the list; a refusal stays on the form as its message */
    const end = await until(() => (onList().has(name) && !q('.hb-form') ? 'ok' : (q('.hb-form .bf-msg.err') || {}).textContent || ''), 8000);
    if (end !== 'ok') {
      const open = q('.hb-form .ghost');
      if (open) open.click();   // Cancel, so the list is left as it was
      return { added, had, error: end || 'Stopped after ' + added + '.' };
    }
    added++;
    have.add(name);
  }
  return { added, had, error: null };
}

function run(list) {
  if (S.busy) return;
  S.busy = true;
  paint();
  copy(list).catch(() => ({ added: 0, had: 0, error: 'That didn’t work. Try again.' })).then((r) => {
    S.busy = false;
    S.done = r;
    paint();
    const words = r.added ? 'Added ' + plural(r.added, 'habit', 'habits') : 'Nothing new to add';
    app.toast(r.error ? r.error : words + (r.had ? '. ' + r.had + ' ' + (r.had === 1 ? 'was' : 'were') + ' already on your list.' : '.'));
  });
}

/* --------------------------------------------------------------- drawing */
function paint() {
  const root = S.root;
  if (!root) return;
  root.innerHTML = '';
  if (S.failed) {
    const box = el('div', 'hb-gate');
    box.appendChild(el('p', 'hb-empty', 'The template didn’t load. Check your connection.'));
    box.appendChild(button('Try again', 'ghost', () => { S.failed = false; load(); }));
    root.appendChild(box);
    return;
  }
  const t = S.tpl;
  if (!t) { root.appendChild(el('p', 'loading', 'Loading the template…')); return; }
  const list = (t.habits || []).filter((h) => h && h.text);
  const wrap = el('div', 'tp');
  wrap.dataset.template = t.id;
  section(wrap, t.name, esc(plural(list.length, 'habit', 'habits')));
  para(wrap, t.blurb);
  list.forEach((h, i) => {
    const k = 't-' + (i + 1);
    const add = el('button', 'pillbtn', ICON.plus + '<span>Add</span>');
    add.type = 'button';
    add.setAttribute('aria-label', 'Add ' + h.text + ' to your habits');
    add.disabled = S.busy;
    add.addEventListener('click', () => run([h]));
    const r = row({ k, tile: { big: (h.frequency === 'n_per_week' ? h.n : h.frequency === 'weekdays' ? 5 : 7) + '×', small: 'a week' },
      title: h.text, lines: [h.why, [freqWord(h), CAT[h.category] ? '· ' + CAT[h.category] : '']], right: add });
    /* where each one lives in the app: Workouts, Water, the timer */
    if (Array.isArray(h.links) && h.links.length) {
      const s = el('div', 's');
      h.links.filter((l) => /^[a-z]+(\/[a-z-]+)?$/.test(String(l.tab || ''))).forEach((l, j) => {
        if (j) s.appendChild(document.createTextNode(' · '));
        const a = el('a', null, esc(l.label));
        a.href = '#' + l.tab;
        s.appendChild(a);
      });
      r.children[1].appendChild(s);
    }
    wrap.appendChild(r);
  });
  const go = el('div', 'hb-gate');
  const all = button(S.busy ? 'Adding…' : ICON.plus + ' Copy all ' + list.length + ' to my habits', '', () => run(list));
  all.dataset.copyAll = '1';
  all.disabled = S.busy;
  go.appendChild(all);
  wrap.appendChild(go);
  if (t.page) {
    const more = el('div', 'addrow');
    const a = el('a', 'pillbtn', 'How Stephen does it');
    a.href = '#coach/how-i-do-it';
    more.appendChild(a);
    wrap.appendChild(more);
  }
  root.appendChild(wrap);
  root.appendChild(el('div', 'spacer'));
}

function load() {
  paint();
  return data('template-stephen.json').then((j) => { S.tpl = j; }, () => { S.failed = true; }).then(paint);
}

/* ------------------------------------------------ Habits · Template · Build */
const SIDES = [['habits', 'Habits', '--liq-habits'], ['template', 'Template', '--app-body-pop'], ['build', 'Build', '--liq-build']];
function sideSwitch(on) {
  const r = el('div', 'secrow oa-sidesrow bd-sidesrow');
  const sides = SIDES.filter(([k]) => k === 'template' || app.registered(k));
  const sw = pills(sides.map(([k, l]) => [k, l]), on, (v) => (v === 'template' ? app.go(KEY, 'stephen') : app.go(v)), 'oa-sideswitch bd-sideswitch');
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', 'Today');
  [...sw.children].forEach((b, i) => { b.dataset.side = sides[i][0]; b.setAttribute('aria-pressed', String(sides[i][0] === on)); });
  liquify(sw, { key: 'body-side', idx: Math.max(0, sides.findIndex(([k]) => k === on)), colors: sides.map((x) => x[2]) });
  r.appendChild(sw);
  return r;
}
function wrapRow(top, inner) {
  const bar = el('div', 'secbar bd-sub');
  bar.appendChild(top);
  if (inner) (inner.classList && inner.classList.contains('secbar') ? [...inner.children] : [inner]).forEach((k) => bar.appendChild(k));
  return bar;
}
/* The Build's own row is its Build | Habits switch and its "?": this
   switch replaces the first, and the "?" joins it */
function buildRow(inner) {
  const top = sideSwitch('build');
  const help = inner && inner.querySelector('.bd-whatis');
  if (help) top.appendChild(help);
  return wrapRow(top, null);
}

app.register(KEY, {
  label: 'Template',
  icon: ICON.habits,
  promise: 'Stephen’s daily list, with why each one is on it.',
  mount(host) { S.root = host; load(); },
  activate(param) {
    /* the cell itself is the tracker; the template is its other side */
    if (!param) { app.go('habits'); return; }
    if (/^t-\d+$/.test(param)) {
      const when = S.tpl ? Promise.resolve() : load();
      when.then(() => { if (!app.flashHit(S.root, param)) app.toast('That habit isn’t on the template.'); });
    }
  },
  refresh() { paint(); },
  deactivate() {},
  subnav() { return wrapRow(sideSwitch('template'), null); },
  /* Habits' own row, under the switch */
  frame(child, inner) { return child === 'habits' ? wrapRow(sideSwitch('habits'), inner) : child === 'build' ? buildRow(inner) : inner; },
  landing() { return 'habits'; },
  keepSubnav: true,
  newSince() { return 0; },
});

/* for tests */
export const _state = () => ({ busy: S.busy, done: S.done, n: S.tpl ? S.tpl.habits.length : 0 });
