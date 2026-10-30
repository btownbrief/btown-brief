/* fuel.js — Body · Fuel (wave 1, 2026-10-29). From the content lane's
   data/body/fuel.json:

   - Water and Protein: tap counters for today, kept on this phone by the
     New York day (habits-core.js), with the last seven days under them.
     Water starts at 96 oz in 16 oz taps, protein at 140 g with a 30 g
     shake, creatine at 5 g; the goal and the tap size can be changed.
   - Calories: MacroFactor's photo-logging steps and tips, and its link.
   - Basics: protein (with a calculator from your weight), creatine, and
     diet and weight, each with its sources.
   - Supplements: caffeine, L-theanine and NAC, each with its sources and
     the check-with-your-doctor line.
   - Less of: a counter the reader sets up for something they want to do
     less of. Nothing is preset. */

import * as app from '../app.js';
import { el, esc, ICON, button, chips } from '../ui.js';
import { page, data, demoData, keep, put, seed, row, para, bullets, ext, links, section, divider, field, input, select, sources, stat,
  today, addDays, shortDay, plural, pill } from './body-kit.js';
import { saveDayScore } from './day.js';

const KEY = 'fuel';
const DAYS = 'allday-body-fuel';       // { 'YYYY-MM-DD': { water, protein, shakes, creatine } }
const SET = 'allday-body-fuel-set';    // { waterGoal, waterTap, proteinGoal, shakeG }
const LESS = 'allday-body-less';       // [{ id, name, limit, per, swap, counts: { day: n } }]
const KEEP_DAYS = 60;
const WD = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });

const days = () => { const d = keep(DAYS, {}); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; };
const n0 = (v) => Math.max(0, Math.round(Number(v) || 0));
const dayOf = (k) => { const d = days()[k] || {}; return { water: n0(d.water), protein: n0(d.protein), shakes: n0(d.shakes), creatine: d.creatine === true }; };
function setDay(k, patch) {
  const all = days();
  all[k] = { ...dayOf(k), ...patch };
  /* keep the last sixty days */
  const cut = addDays(today(), -KEEP_DAYS);
  Object.keys(all).forEach((x) => { if (x < cut) delete all[x]; });
  const ok = put(DAYS, all);
  if (k === today()) saveDayScore();
  return ok;
}
function settings(def) {
  const s = keep(SET, {}) || {};
  return { waterGoal: Number(s.waterGoal) || def.water.goal_oz, waterTap: Number(s.waterTap) || def.water.tap_oz,
    proteinGoal: Number(s.proteinGoal) || def.protein_shake.protein_goal_g, shakeG: Number(s.shakeG) || def.protein_shake.grams_per_shake };
}
function setSetting(patch) {
  const ok = put(SET, { ...(keep(SET, {}) || {}), ...patch });
  saveDayScore();
  return ok;
}

/* the last seven days as the People week strip: a tap says the day's total */
function week(box, field_, unit, goal) {
  const strip = el('div', 'days');
  strip.dataset.week = field_;
  for (let i = 6; i >= 0; i--) {
    const k = addDays(today(), -i);
    const v = dayOf(k)[field_] || 0;
    const b = el('button', (i === 0 ? 'on' : '') + (v ? '' : ' none'),
      '<span class="wd">' + esc(i === 0 ? 'Today' : WD.format(new Date(k + 'T12:00:00Z'))) + '</span><span class="dd">' + esc(v) + '</span><span class="n">' + esc(v >= goal ? 'goal' : unit) + '</span>');
    b.type = 'button';
    b.setAttribute('aria-label', shortDay(k) + ': ' + v + ' ' + unit + (v >= goal ? ', goal met' : ''));
    b.addEventListener('click', () => app.toast(shortDay(k) + ': ' + v + ' ' + unit + (v >= goal ? '. Goal met.' : ' of ' + goal + '.')));
    strip.appendChild(b);
  }
  box.appendChild(strip);
}

/* --------------------------------------------------------------- water */
function drawWater(box, f, ctx) {
  const def = f.defaults;
  const s = settings(def);
  const t = dayOf(today());
  section(box, 'Water', esc('Goal ' + s.waterGoal + ' oz a day'));
  const st = stat({ num: t.water + ' oz', label: t.water >= s.waterGoal ? 'Goal met today' : 'of ' + s.waterGoal + ' today', share: 100 * t.water / s.waterGoal });
  st.dataset.water = String(t.water);
  box.appendChild(st);
  const add = button(ICON.plus + ' ' + s.waterTap + ' oz', '', () => { setDay(today(), { water: dayOf(today()).water + s.waterTap }); ctx.redraw('water'); });
  add.dataset.tap = 'water';
  const less = button('Undo', 'ghost', () => { setDay(today(), { water: Math.max(0, dayOf(today()).water - s.waterTap) }); ctx.redraw('water'); });
  less.disabled = !t.water;
  links(box, [add, less]);
  week(box, 'water', 'oz', s.waterGoal);
  const more = el('details', 'hb-gate');
  more.appendChild(el('summary', 'bf-label', 'Goal'));
  const goal = select('goal', [64, 72, 80, 88, 96, 104, 112, 120, 128].map((n) => [n, n + ' oz']), s.waterGoal);
  goal.addEventListener('change', () => { setSetting({ waterGoal: Number(goal.value) }); ctx.redraw('water'); });
  const tap = select('tap', [8, 12, 16, 20, 24, 32].map((n) => [n, n + ' oz']), s.waterTap);
  tap.addEventListener('change', () => { setSetting({ waterTap: Number(tap.value) }); ctx.redraw('water'); });
  const f2 = el('div', 'bform');
  f2.append(field('Daily goal', goal), field('One tap is', tap));
  more.appendChild(f2);
  box.appendChild(more);
  sources(box, def.water.sources);
}

/* -------------------------------------------------------------- protein */
function drawProtein(box, f, ctx) {
  const def = f.defaults;
  const s = settings(def);
  const t = dayOf(today());
  section(box, 'Protein', esc('Goal ' + s.proteinGoal + ' g a day'));
  const st = stat({ num: t.protein + ' g', label: t.protein >= s.proteinGoal ? 'Goal met today' : 'of ' + s.proteinGoal + ' today',
    rnum: String(t.shakes), rlabel: t.shakes === 1 ? 'shake' : 'shakes', share: 100 * t.protein / s.proteinGoal });
  st.dataset.protein = String(t.protein);
  box.appendChild(st);
  const shake = button(ICON.plus + ' Shake, ' + s.shakeG + ' g', '', () => { const d = dayOf(today()); setDay(today(), { protein: d.protein + s.shakeG, shakes: d.shakes + 1 }); ctx.redraw('protein'); });
  shake.dataset.tap = 'shake';
  const ten = button(ICON.plus + ' 10 g', 'ghost', () => { setDay(today(), { protein: dayOf(today()).protein + 10 }); ctx.redraw('protein'); });
  ten.dataset.tap = 'ten';
  const undo = button('Undo', 'ghost', () => { setDay(today(), { protein: Math.max(0, dayOf(today()).protein - 10) }); ctx.redraw('protein'); });
  undo.disabled = !t.protein;
  links(box, [shake, ten, undo]);
  /* creatine rides with the shake (the defaults' reminder) */
  const cr = button((t.creatine ? ICON.check + ' Creatine done today' : 'Creatine, ' + def.creatine.grams_per_day + ' g'), t.creatine ? '' : 'ghost', () => {
    setDay(today(), { creatine: !dayOf(today()).creatine }); ctx.redraw('protein');
  });
  cr.dataset.tap = 'creatine';
  cr.setAttribute('aria-pressed', String(!!t.creatine));
  links(box, [cr]);
  week(box, 'protein', 'g', s.proteinGoal);
  const more = el('details', 'hb-gate');
  more.appendChild(el('summary', 'bf-label', 'Goal'));
  const goal = select('pgoal', Array.from({ length: 17 }, (_, i) => 60 + i * 10).map((n) => [n, n + ' g']), s.proteinGoal);
  goal.addEventListener('change', () => { setSetting({ proteinGoal: Number(goal.value) }); ctx.redraw('protein'); });
  const sg = select('shake', [20, 25, 30, 35, 40, 50].map((n) => [n, n + ' g']), s.shakeG);
  sg.addEventListener('change', () => { setSetting({ shakeG: Number(sg.value) }); ctx.redraw('protein'); });
  const f2 = el('div', 'bform');
  f2.append(field('Daily goal', goal), field('One shake is', sg));
  more.appendChild(f2);
  box.appendChild(more);
}

/* ------------------------------------------------------------- calories */
function drawCalories(box, f) {
  const c = f.calories;
  section(box, 'Calories', null);
  para(box, c.intro);
  divider(box, c.app.name, null);
  c.photo_steps.forEach((s, i) => box.appendChild(row({ k: 'cal-' + i, tile: { big: i + 1, small: 'step' }, title: s })));
  bullets(box, c.photo_tips, 'Photo tips');
  links(box, [ext('Get ' + c.app.name, c.app.url, 'btn')]);
  para(box, c.app.price != null ? c.app.name + ' costs ' + c.app.price + '.' : c.app.price_note, 'note');
  sources(box, c.sources);
}

/* --------------------------------------------------------------- basics */
function drawBasics(box, f) {
  const b = f.basics;
  section(box, 'Basics', null);
  para(box, b.intro);
  b.sections.forEach((s) => {
    divider(box, s.title, null);
    const facts = [['How much', s.how_much], ['When', s.when], ['What it does', s.what_it_does], ['How', s.how], ['Heads up', s.heads_up]].filter(([, v]) => v);
    facts.forEach(([l, v]) => box.appendChild(el('p', 'hb-empty', '<b>' + esc(l) + '.</b> ' + esc(v))));
    if (s.calculator && s.calculator.input === 'weight_lb') box.appendChild(calculator(s.calculator));
    if ((s.easy_sources || []).length) bullets(box, s.easy_sources, 'Easy sources');
    if ((s.simple_rules || []).length) bullets(box, s.simple_rules, 'Simple rules');
    sources(box, s.sources);
  });
  para(box, f.doctor_line, 'note');
}
function calculator(c) {
  const box = el('div', 'hb-gate fu-calc');
  const w = input('weight', { type: 'number', placeholder: '180' });
  const out = el('p', 'hb-lab');
  out.setAttribute('aria-live', 'polite');
  const paint = () => {
    const lb = Number(w.value);
    out.textContent = lb >= 70 && lb <= 500 ? 'For active adults: ' + Math.round(lb * c.low_per_lb) + ' to ' + Math.round(lb * c.high_per_lb) + ' g' : '';
  };
  w.addEventListener('input', paint);
  box.append(field('Your weight in pounds', w), out);
  return box;
}

/* ---------------------------------------------------------- supplements */
function drawSupplements(box, f) {
  const s = f.supplements;
  section(box, 'Supplements', null);
  bullets(box, [f.doctor_line]).dataset.doctor = '1';
  para(box, s.intro);
  s.items.forEach((x) => {
    divider(box, x.name, null);
    const sup = el('div');
    sup.dataset.k = 'sup-' + x.id;
    [['What it is', x.what], ['How much', x.how_much], ['When', x.timing], ['Watch for', x.watch_for]].forEach(([l, v]) => {
      if (v) sup.appendChild(el('p', 'hb-empty', '<b>' + esc(l) + '.</b> ' + esc(v)));
    });
    box.appendChild(sup);
    sources(box, x.sources);
  });
}

/* --------------------------------------------------------------- less of */
const lessList = () => { const l = keep(LESS, []); return Array.isArray(l) ? l.filter((x) => x && x.name) : []; };
function countOf(x) {
  const c = x.counts || {};
  if (x.per === 'week') {
    let n = 0;
    for (let i = 0; i < 7; i++) n += Number(c[addDays(today(), -i)]) || 0;
    return n;
  }
  return Number(c[today()]) || 0;
}
function bump(id, by) {
  const all = lessList();
  const x = all.find((y) => y.id === id);
  if (!x) return;
  x.counts = { ...(x.counts || {}) };
  x.counts[today()] = Math.max(0, (Number(x.counts[today()]) || 0) + by);
  const cut = addDays(today(), -KEEP_DAYS);
  Object.keys(x.counts).forEach((k) => { if (k < cut) delete x.counts[k]; });
  put(LESS, all);
}
/* what the habit does for you (scroll-lessons.md section 5): the counter
   aims at that job, and a slip shows the swap first */
const GIVES = ['Bored', 'Stressed', 'Lonely', 'Avoiding something', 'Just habit'];
function lessForm(f, ctx) {
  const L = f.less_of;
  const byKey = Object.fromEntries(L.fields.map((x) => [x.key, x]));
  const form = el('form', 'bform hb-gate fu-less');
  form.noValidate = true;
  const name = input('name', { placeholder: byKey.name.hint, max: 50 });
  const limit = select('limit', [0, 1, 2, 3, 4, 5, 6, 7, 10, 14].map((n) => [n, String(n)]), 1);
  const per = select('per', (byKey.per.options || ['day', 'week']).map((o) => [o, 'a ' + o]), 'day');
  let gives = '';
  const own = input('gives', { placeholder: 'Or in your words', max: 40 });
  const chipRow = chips(GIVES.map((g) => ({ key: g, label: g })), '', (k, b) => {
    gives = gives === k ? '' : k;
    [...chipRow.children].forEach((c) => { const on = c.dataset.chip === gives; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    if (gives) own.value = '';
  }, 'fu-gives');
  [...chipRow.children].forEach((c) => { c.type = 'button'; });   // inside a form, a chip must not submit it
  own.addEventListener('input', () => { if (own.value.trim()) { gives = ''; [...chipRow.children].forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); }); } });
  const givesRow = el('div', 'bf-row');
  givesRow.append(el('p', 'bf-label', 'What it gives you'), chipRow, own);
  /* the form lines its rows up at the start; this one spans it, so the chips scroll inside it */
  givesRow.style.alignSelf = 'stretch';
  givesRow.style.minWidth = '0';
  const swap = input('swap', { placeholder: byKey.swap.hint, max: 80 });
  form.append(field(byKey.name.label, name), field(byKey.limit.label, limit), field(byKey.per.label, per), givesRow, field('What gives you that too', swap));
  const msg = el('p', 'bf-msg err');
  const go = button('Start counting', '');
  go.type = 'submit';
  const act = el('div', 'bf-go');
  act.append(go, msg);
  form.appendChild(act);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = name.value.trim().slice(0, 50);
    if (!n) { msg.textContent = 'What do you want less of?'; name.focus(); return; }
    const all = lessList();
    all.push({ id: 'l' + Date.now().toString(36), name: n, limit: Number(limit.value), per: per.value === 'week' ? 'week' : 'day',
      gives: (gives || own.value.trim()).slice(0, 40), swap: swap.value.trim().slice(0, 80), counts: {} });
    if (!put(LESS, all)) return;
    S.adding = false;
    ctx.redraw('less');
  });
  return form;
}
const S = { adding: false };
function drawLess(box, f, ctx) {
  const list = lessList();
  section(box, 'Less of', null);
  list.forEach((x) => {
    const n = countOf(x);
    const when = x.per === 'week' ? 'this week' : 'today';
    const plus = pill(ICON.plus + '<span>1</span>', () => {
      bump(x.id, 1);
      ctx.redraw('less');
      /* a slip: the swap first */
      if (x.swap) app.toast('Instead: ' + x.swap);
    });
    plus.setAttribute('aria-label', 'Count one: ' + x.name);
    const r = row({ k: 'less-' + x.id, tile: { big: n + '/' + x.limit, small: when }, title: x.name,
      lines: [x.swap ? ['Instead', x.swap] : '', x.gives ? ['Gives you', x.gives] : '', n > x.limit ? 'Over your limit.' : n === x.limit ? 'At your limit.' : ''], right: plus });
    r.dataset.less = x.id;
    box.appendChild(r);
    links(box, [pill('Undo', () => { bump(x.id, -1); ctx.redraw('less'); }), pill('Stop counting', () => {
      const all = lessList();
      const j = all.findIndex((y) => y.id === x.id);
      const [gone] = all.splice(j, 1);
      if (!put(LESS, all)) return;
      ctx.redraw('less');
      app.toast('Stopped counting ' + gone.name, () => { const back = lessList(); back.splice(j, 0, gone); put(LESS, back); ctx.redraw('less'); });
    })]);
  });
  if (!list.length || S.adding) box.appendChild(lessForm(f, ctx));
  else links(box, [button(ICON.plus + ' Count something else', 'ghost', () => { S.adding = true; ctx.redraw('less'); })]);
}

/* -------------------------------------------------------------- the tab */
app.register(KEY, page({
  color: '--tf-sold',
  key: KEY, label: 'Fuel', icon: 'drop',
  promise: 'Water, protein and calories, one tap each.',
  sections: [['water', 'Water'], ['protein', 'Protein'], ['calories', 'Calories'], ['basics', 'Basics'], ['supplements', 'Supplements'], ['less', 'Less of']],
  load: () => Promise.all([data('fuel.json'), app.demo ? demoData() : null]).then(([f, d]) => {
    if (d) {
      const shift = (n) => addDays(today(), -Number(n) || 0);
      if (Array.isArray(d.fuel)) seed(DAYS, Object.fromEntries(d.fuel.map(({ daysAgo, ...x }) => [shift(daysAgo), x])));
      if (Array.isArray(d.less)) seed(LESS, d.less.map((x, i) => ({ ...x, id: 'demo' + i, counts: Object.fromEntries((x.counts || []).map((c) => [shift(c.daysAgo), c.n])) })));
    }
    return { f };
  }),
  draw(k, box, ctx) {
    const f = ctx.f;
    if (k === 'water') drawWater(box, f, ctx);
    else if (k === 'protein') drawProtein(box, f, ctx);
    else if (k === 'calories') drawCalories(box, f);
    else if (k === 'basics') drawBasics(box, f);
    else if (k === 'supplements') drawSupplements(box, f);
    else if (k === 'less') drawLess(box, f, ctx);
  },
}));

/* for tests */
export const _day = (k) => dayOf(k || today());
