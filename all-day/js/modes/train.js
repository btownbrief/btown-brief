/* train.js — Body · Train (wave 1, 2026-10-29). From the content lane's
   data/body/workouts.json and gyms.json:

   - Gyms: every facility around Burlington with its address, hours, day
     pass, what it has and the day it was checked on its own site; anything
     A row opens the rest.
   - Beginner, Intermediate, Hardcore: each routine as a list to follow at
     the gym, machine by machine: how to set it up, the sets and reps, the
     effort ("stop with 2 left in the tank"), the rest, and Log. Tapping a
     machine ticks it off for this visit.
   - Sprints: the session, with a timer that plays it through.
   - Log: one line per machine (the settings, the weight, the reps, what
     was left), kept on this phone the way habits-local keeps taps, newest
     first, with last time's line shown as you type the machine.
   */

import * as app from '../app.js';
import { el, esc, ICON, button, chips } from '../ui.js';
import { page, data, demoData, keep, put, seed, row, para, bullets, ext, links, tabLink, section, divider, field, input, select,
  player, today, shortDay, plural, addDays, pill } from './body-kit.js';

const KEY = 'train';
const LOG = 'allday-body-log';
const LOG_MAX = 500;
const SHOW = 10;
const HAS = [['machines', 'Machines'], ['free_weights', 'Free weights'], ['pool', 'Pool'], ['sauna', 'Sauna'], ['courts', 'Courts'], ['classes', 'Classes'], ['childcare', 'Childcare']];
const S = { town: 'all', more: false, done: new Set() };

const logList = () => { const l = keep(LOG, []); return Array.isArray(l) ? l.filter((x) => x && typeof x.machine === 'string' && x.machine) : []; };
const daysOf = (r) => (Array.isArray(r.days) ? r.days : [{ name: null, exercises: r.exercises || [] }]);
const money = (s) => (String(s || '').match(/\$\d+(?:\.\d\d)?/) || [''])[0];

/* ------------------------------------------------------------------ gyms */
function gymSheet(g, kinds) {
  app.sheet(g.name, (body) => {
    body.dataset.gym = g.id;
    const facts = [['Kind', kinds[g.kind] || g.kind], ['Address', g.address], ['Hours', g.hours], ['Day pass', g.day_pass], ['Membership', g.membership],
      ['Intro offer', g.intro_offer], ['Has', HAS.filter(([k]) => g.has && g.has[k]).map(([, w]) => w).join(', ')], ['Also', g.also],
      ['If you’re new', g.beginner], ['Notes', g.notes]];
    facts.forEach(([label, v]) => {
      if (v == null || !String(v).trim()) return;
      body.appendChild(el('div', 'sheet-row', '<div class="t"><b>' + esc(label) + '</b><div class="d">' + esc(v) + '</div></div>'));
    });
    if (/^https?:/i.test(g.url || '')) { const r = el('div', 'linkrow'); r.appendChild(ext('Their site', g.url, 'btn sm')); body.appendChild(r); }
  });
}
function drawGyms(box, ctx) {
  const all = ctx.gyms.gyms || [];
  const kinds = ctx.gyms.kinds || {};
  section(box, 'Gyms', esc(plural(all.length, 'place', 'places')));
  const towns = Object.entries(all.reduce((m, g) => { m[g.town] = (m[g.town] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const pick = chips([{ key: 'all', label: 'All' }].concat(towns.map((t) => ({ key: t, label: t }))), S.town, (k) => { S.town = k; S.more = false; ctx.redraw('gyms'); }, 'tb-towns');
  const wrap = el('div', 'addrow');
  wrap.appendChild(pick);
  box.appendChild(wrap);
  /* verified first, in the file's order otherwise */
  const list = all.filter((g) => S.town === 'all' || g.town === S.town).sort((a, b) => !!b.verified - !!a.verified);
  list.slice(0, S.more ? list.length : SHOW).forEach((g) => {
    const pass = money(g.day_pass);
    const has = HAS.filter(([k]) => g.has && g.has[k]).map(([, w]) => w).join(', ');
    const r = row({
      k: 'g-' + g.id, tile: pass ? { big: pass, small: 'day pass' } : { icon: ICON.dumbbell }, title: g.name,
      lines: [String(g.address || '').replace(/,?\s*VT\s*\d{5}.*$/, ''), g.hours, [kinds[g.kind] || '', has ? '· ' + has : '']],
      right: /^https?:/i.test(g.url || '') ? ext('Site', g.url) : null,
      onOpen: () => gymSheet(g, kinds),
    });
    r.dataset.gym = g.id;
    r.dataset.verified = g.verified ? '1' : '0';
    box.appendChild(r);
  });
  if (list.length > SHOW && !S.more) {
    const r = el('div', 'addrow');
    r.appendChild(button('Show all ' + list.length, 'ghost', () => { S.more = true; ctx.redraw('gyms'); }));
    box.appendChild(r);
  }
}

/* -------------------------------------------------------------- routines */
function effortSheet(w) {
  app.sheet(w.effort.name, (body) => {
    body.appendChild(el('p', 'sheet-note', esc(w.effort.how)));
    w.effort.scale.forEach((s) => body.appendChild(el('div', 'sheet-row', '<div class="t"><b>' + esc(s.left + ' left') + '</b> ' + esc(s.feels) + '<div class="d">' + esc(s.use) + '</div></div>')));
    body.appendChild(el('p', 'sheet-note', esc(w.effort.rule)));
  });
}
function setupSheet(w) {
  app.sheet('Setting up', (body) => {
    w.setup_basics.forEach((s) => body.appendChild(el('div', 'sheet-row', '<div class="t"><b>' + esc(s.step) + '</b><div class="d">' + esc(s.how) + '</div></div>')));
  });
}
function firstDaySheet(w) {
  const f = w.first_day;
  app.sheet(f.name, (body) => {
    body.appendChild(el('p', 'sheet-note', esc(f.who + ' About ' + f.minutes + ' minutes.')));
    body.appendChild(el('div', 'sheet-h', 'Bring'));
    body.appendChild(el('ul', 'hb-helpl', f.bring.map((b) => '<li>' + esc(b) + '</li>').join('')));
    f.steps.forEach((s, i) => body.appendChild(el('div', 'sheet-row', '<div class="t"><b>' + esc((i + 1) + '. ' + s.title) + '</b> <span class="d">' + esc(s.minutes + ' min') + '</span><div class="d">' + esc(s.how) + '</div></div>')));
    body.appendChild(el('p', 'sheet-note', esc(f.after)));
  });
}
function drawRoutine(box, w, id) {
  const r = (w.routines || []).find((x) => x.id === id);
  if (!r) { para(box, 'This routine isn’t in the file.'); return; }
  section(box, r.name, esc(r.days_per_week + ' days a week · about ' + r.minutes + ' minutes'));
  para(box, r.who);
  bullets(box, [r.schedule, 'Warm up: ' + r.warmup, r.progression].filter(Boolean));
  const tools = [pill('Reps left in the tank', () => effortSheet(w)), pill('Setting up', () => setupSheet(w))];
  if (id === 'beginner' && w.first_day) tools.unshift(pill('Your first day', () => firstDaySheet(w)));
  links(box, tools);
  daysOf(r).forEach((d, di) => {
    if (d.name) divider(box, d.name, null);
    d.exercises.forEach((x, xi) => {
      const k = 'x-' + id + '-' + di + '-' + xi;
      const last = lastFor(x.machine);
      const log = el('button', 'pillbtn', esc('Log'));
      log.type = 'button';
      log.setAttribute('aria-label', 'Log ' + x.machine);
      log.addEventListener('click', () => logSheet(w, x.machine));
      const rr = row({
        k, tile: { big: x.sets + '×', small: x.reps }, title: x.machine, done: S.done.has(k),
        lines: [last ? ['Last time', lineOf(last)] : '', x.works && x.setup ? [x.works + '.', x.setup] : x.setup || x.works, x.how,
          'Stop with ' + x.left + ' left in the tank · rest ' + (x.rest_seconds >= 120 ? x.rest_seconds / 60 + ' min' : x.rest_seconds + ' s')],
        right: log,
        onOpen: (n) => { if (S.done.has(k)) S.done.delete(k); else S.done.add(k); n.classList.toggle('done', S.done.has(k)); },
      });
      rr.querySelector('.open').setAttribute('aria-label', x.machine + ': tap when it’s done');
      box.appendChild(rr);
    });
  });
  if (r.notes) para(box, r.notes, 'note');
  para(box, 'Cool down: ' + r.cooldown, 'note');
}

/* --------------------------------------------------------------- sprints */
function drawSprints(box, w) {
  const s = w.sprints;
  const m = s.main;
  section(box, s.name, esc(m.rounds + ' rounds · ' + m.work_seconds + ' s hard · ' + m.rest_seconds + ' s walking back'));
  bullets(box, ['How often: ' + s.days_per_week, 'Where: ' + s.where, 'Effort: ' + m.effort, m.rest_how, m.progression]);
  const steps = s.warmup.map((x) => ({ name: x.what, seconds: Math.round(Number(x.minutes) * 60), how: 'Warm-up' }));
  for (let i = 1; i <= m.rounds; i++) {
    steps.push({ name: 'Sprint ' + i + ' of ' + m.rounds, seconds: m.work_seconds, how: m.effort });
    if (i < m.rounds) steps.push({ name: 'Walk back', seconds: m.rest_seconds, how: m.rest_how });
  }
  steps.push({ name: 'Cool down', seconds: Math.round(Number(s.cooldown.minutes) * 60), how: s.cooldown.what });
  const go = button(ICON.play + ' Start the session', '', () => player(s.name, steps));
  go.dataset.playSprints = '1';
  links(box, [go]);
  s.warmup.forEach((x, i) => box.appendChild(row({ k: 'sp-w' + i, tile: { big: x.minutes, small: 'min' }, title: x.what, lines: ['Warm-up'] })));
  box.appendChild(row({ k: 'sp-main', tile: { big: m.rounds + '×', small: m.work_seconds + ' s' }, title: 'Sprint, then walk back', lines: [m.effort, 'Rest ' + m.rest_seconds + ' s between'] }));
  box.appendChild(row({ k: 'sp-cool', tile: { big: s.cooldown.minutes, small: 'min' }, title: 'Cool down', lines: [s.cooldown.what] }));
  para(box, s.safety, 'note');
}

/* ------------------------------------------------------------------- log */
const machines = (w) => [...new Set((w.routines || []).flatMap((r) => daysOf(r).flatMap((d) => d.exercises.map((x) => x.machine))))];
function lastFor(machine) {
  const m = String(machine || '').trim().toLowerCase();
  return m ? logList().find((x) => x.machine.toLowerCase() === m) || null : null;
}
const lineOf = (x) => [x.settings, x.weight, x.reps ? x.reps + ' reps' : '', x.left !== '' && x.left != null ? x.left + ' left' : ''].filter(Boolean).join(' · ');
function logForm(w, machine, onSaved) {
  const f = el('form', 'bform tr-log');
  f.noValidate = true;
  const date = input('date', { type: 'date', value: today() });
  const mach = input('machine', { placeholder: 'Chest press', value: machine || '', max: 60 });
  const dl = el('datalist');
  dl.id = 'tr-machines';
  machines(w).forEach((m) => { const o = el('option'); o.value = m; dl.appendChild(o); });
  mach.setAttribute('list', dl.id);
  const last = el('p', 'bf-hint');
  const showLast = () => { const x = lastFor(mach.value); last.textContent = x ? 'Last time, ' + shortDay(x.date) + ': ' + lineOf(x) : ''; };
  mach.addEventListener('input', showLast);
  const settings = input('settings', { placeholder: 'Seat 4, back pad 2', max: 60 });
  const weight = input('weight', { placeholder: 'Pin at 90', max: 30 });
  const reps = input('reps', { placeholder: '12, 11, 10', max: 40 });
  const left = select('left', [['', 'Pick one']].concat([0, 1, 2, 3, 4, 5].map((n) => [n, n + ' left'])), '');
  const note = input('note', { placeholder: 'Go up next time', max: 80 });
  const mf = field('Lift', mach);
  mf.append(dl, last);
  f.append(field('Date', date), mf, field('Settings', settings), field('Weight', weight), field('Reps per set', reps), field('Left in the tank', left), field('Note', note));
  const msg = el('p', 'bf-msg');
  msg.setAttribute('role', 'status');
  const go = button('Save to my log', '');
  go.type = 'submit';
  const act = el('div', 'bf-go');
  act.append(go, msg);
  f.appendChild(act);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const x = { date: /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? date.value : today(), machine: mach.value.trim().slice(0, 60), settings: settings.value.trim(),
      weight: weight.value.trim(), reps: reps.value.trim(), left: left.value === '' ? '' : Number(left.value), note: note.value.trim(), at: Date.now() };
    if (!x.machine) { msg.textContent = 'Which lift?'; msg.classList.add('err'); mach.focus(); return; }
    const all = logList();
    all.unshift(x);
    all.sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
    if (!put(LOG, all.slice(0, LOG_MAX))) { msg.textContent = 'This phone wouldn’t save it.'; msg.classList.add('err'); return; }
    onSaved(x);
  });
  showLast();
  return f;
}
function logSheet(w, machine) {
  app.sheet('Log ' + (machine || 'a machine'), (body, card, close) => {
    body.appendChild(logForm(w, machine, () => { close(); app.toast('Logged ' + (machine || 'it')); redrawLog(); }));
  });
}
let redrawLog = () => {};
function drawLog(box, w, ctx) {
  redrawLog = () => ['beginner', 'intermediate', 'hardcore', 'log'].forEach((k) => ctx.redraw(k));
  const list = logList();
  section(box, 'Log', null);
  if (!list.length) para(box, 'Nothing logged yet.');
  links(box, [button(ICON.plus + ' Log a machine', '', () => logSheet(w, ''))]);
  list.slice(0, 40).forEach((x, i) => {
    const del = el('button', 'act del', ICON.trash);
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete this line');
    del.addEventListener('click', () => {
      const all = logList();
      const j = all.findIndex((y) => y.at === x.at && y.machine === x.machine);
      if (j < 0) return;
      const [gone] = all.splice(j, 1);
      put(LOG, all);
      ctx.redraw('log');
      app.toast('Deleted', () => { const back = logList(); back.splice(j, 0, gone); put(LOG, back); ctx.redraw('log'); });
    });
    const [mo, d] = shortDay(x.date).split(' ');
    box.appendChild(row({ k: 'log-' + i, tile: { big: d || '', small: mo || '' }, title: x.machine, lines: [lineOf(x), x.note], right: del }));
  });
}

/* -------------------------------------------------------------- the tab */
app.register(KEY, page({
  key: KEY, label: 'Train', icon: 'dumbbell', color: '--tf-going',
  promise: 'The gyms, three workouts, and a log of your effort.',
  sections: [['gyms', 'Gyms'], ['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['hardcore', 'Hardcore'], ['sprints', 'Sprints'], ['log', 'Log']],
  load: () => Promise.all([data('workouts.json'), data('gyms.json'), app.demo ? demoData() : null]).then(([w, gyms, d]) => {
    if (d && Array.isArray(d.log)) seed(LOG, d.log.map((x, i) => ({ ...x, date: x.daysAgo != null ? shiftDay(x.daysAgo) : x.date, at: Date.now() - i })));
    return { w, gyms };
  }),
  draw(k, box, ctx) {
    if (k === 'gyms') drawGyms(box, ctx);
    else if (k === 'sprints') drawSprints(box, ctx.w);
    else if (k === 'log') drawLog(box, ctx.w, ctx);
    else drawRoutine(box, ctx.w, k);
  },
  /* #train/g-<gym id> opens that gym; show every gym first so it is there */
  land(want, ctx) {
    if (!/^g-/.test(want) || !ctx) return false;
    const g = (ctx.gyms.gyms || []).find((x) => 'g-' + x.id === want);
    if (!g) return false;
    S.town = 'all'; S.more = true;
    ctx.redraw('gyms');
    app.flashHit(document.getElementById('panel-' + KEY), want);
    return true;
  },
}));

/* the demo's log lines are dated "n days ago" */
function shiftDay(n) { return addDays(today(), -Number(n) || 0); }
