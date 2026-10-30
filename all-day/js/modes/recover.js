/* recover.js — Body · Recover (wave 1, 2026-10-29). From the content
   lane's data/body/recover.json and recover-spots.json:

   - Stretch, Yoga, Roll: the three mat routines, each move with its time,
     and Play, which walks through them one at a time with a countdown.
   - Sauna & cold: the saunas, cold plunges, floats and massage around
     town, with prices and the day each was checked; the gyms with a
     sauna and the yoga studios point back to Train's gym list.
   - Breathe: the double-inhale timer from the spec. Pick a preset or set
     the seconds and rounds; the phase, its count and the round show as it
     goes, with a buzz at each breath out on phones that can.
   - Sleep: the basics, and the trackers side by side with what each one
     measures and costs. */

import * as app from '../app.js';
import { el, esc, ICON, button, pills } from '../ui.js';
import { page, data, row, para, bullets, ext, links, tabLink, section, divider, field, select, sources, stat, player, shortDay, plural, pill, mmss } from './body-kit.js';

const KEY = 'recover';
const SPOT_ICON = { sauna: ICON.sun, infrared: ICON.sun, bathhouse: ICON.sun, 'cold-plunge': ICON.drop, float: ICON.drop, cryo: ICON.drop, massage: ICON.hand, spa: ICON.hand };

/* ---------------------------------------------------------- the routines */
const stepsOf = (r) => r.moves.map((m) => ({ name: m.name, seconds: Number(m.seconds) || 0, how: m.how }));
function drawRoutine(box, rec, tab) {
  const r = (rec.routines || []).find((x) => x.tab === tab);
  if (!r) { para(box, 'This routine isn’t in the file.'); return; }
  section(box, r.name, esc(plural(r.moves.length, 'move', 'moves') + ' · ' + mmss(r.total_seconds)));
  para(box, r.cue, 'note');
  const go = button(ICON.play + ' Play it through', '', () => player(r.name, stepsOf(r)));
  go.dataset.play = r.id;
  links(box, [go]);
  r.moves.forEach((m, i) => box.appendChild(row({
    k: r.id + '-' + i, tile: m.seconds >= 60 && m.seconds % 60 === 0 ? { big: m.seconds / 60, small: 'min' } : { big: m.seconds, small: 'sec' },
    title: m.name, lines: [m.sides === 2 ? (m.seconds / 2) + ' seconds a side' : '', m.how] })));
}

/* ------------------------------------------------------------ the spots */
function spotSheet(s, kinds) {
  app.sheet(s.name, (body) => {
    body.dataset.spot = s.id;
    [['Kind', kinds[s.kind] || s.kind], ['Where', s.address], ['What', s.offers], ['Hours', s.hours], ['Season', s.season], ['Notes', s.notes]].forEach(([l, v]) => {
      if (v != null && String(v).trim()) body.appendChild(el('div', 'sheet-row', '<div class="t"><b>' + esc(l) + '</b><div class="d">' + esc(v) + '</div></div>'));
    });
    if ((s.prices || []).length) {
      body.appendChild(el('div', 'sheet-h', 'Prices'));
      s.prices.forEach((p) => body.appendChild(el('div', 'sheet-row', '<div class="t">' + esc(p.item) + '</div><b>' + esc(p.price) + '</b>')));
    }
    body.appendChild(el('p', 'sheet-note', esc(s.verified ? 'Checked on its own site on ' + shortDay(s.verified) + '.' : 'Not verified.')));
    if ((s.unverified || []).length) body.appendChild(el('ul', 'hb-helpl', s.unverified.map((u) => '<li>' + esc(u) + '</li>').join('')));
    if (/^https?:/i.test(s.url || '')) { const r = el('div', 'linkrow'); r.appendChild(ext('Their site', s.url, 'btn sm')); body.appendChild(r); }
  });
}
function drawSpots(box, spots) {
  const kinds = spots.kinds || {};
  const list = (spots.spots || []).slice().sort((a, b) => !!b.verified - !!a.verified);
  section(box, 'Sauna & cold', esc(plural(list.length, 'place', 'places')));
  list.forEach((s) => {
    const p = (s.prices || [])[0];
    const r = row({
      k: 's-' + s.id, tile: { icon: SPOT_ICON[s.kind] || ICON.leaf }, title: s.name,
      lines: [[kinds[s.kind] || s.kind, '· ' + s.town], s.offers, p ? p.item + ': ' + p.price : 'Prices not published', s.hours,
        s.verified ? 'Verified ' + shortDay(s.verified) : 'Unverified'],
      right: /^https?:/i.test(s.url || '') ? ext('Site', s.url) : null,
      onOpen: () => spotSheet(s, kinds),
    });
    r.dataset.spot = s.id;
    box.appendChild(r);
  });
  if ((spots.gym_saunas || []).length) {
    divider(box, 'Gyms with a sauna', null);
    spots.gym_saunas.forEach((g) => box.appendChild(row({ k: 'gs-' + g.gym_id, tile: { icon: ICON.dumbbell }, title: g.name, lines: [g.note], right: tabLink('Gym', 'train/g-' + g.gym_id) })));
  }
  if ((spots.yoga_studios || []).length) {
    divider(box, 'Yoga studios', null);
    spots.yoga_studios.forEach((g) => box.appendChild(row({ k: 'ys-' + g.gym_id, tile: { icon: ICON.leaf }, title: g.name, lines: [g.drop_in || g.note], right: tabLink('Studio', 'train/g-' + g.gym_id) })));
  }
}

/* ------------------------------------------------------------- breathe */
const B = { preset: 'quick', inhale: 3, top_up: 1, exhale: 6, rounds: 12, running: false, paused: false, timer: 0 };
function stopBreath() { clearInterval(B.timer); B.running = false; B.paused = false; }
function drawBreathe(box, rec, ctx) {
  const b = rec.breathe;
  const t = b.timer;
  const phase = Object.fromEntries(t.phases.map((p) => [p.key, p]));
  section(box, b.name, null);
  para(box, b.what);
  const live = el('div', 'br-live');
  live.dataset.breathe = 'idle';
  box.appendChild(live);
  const idle = () => {
    live.innerHTML = '';
    live.dataset.breathe = 'idle';
    const secs = (B.inhale + B.top_up + B.exhale) * B.rounds;
    live.appendChild(stat({ num: mmss(secs), label: plural(B.rounds, 'round', 'rounds') + ' of ' + B.inhale + ' in, ' + B.top_up + ' more, ' + B.exhale + ' out' }));
  };
  /* presets, then the four numbers */
  const pre = el('div', 'addrow');
  pre.appendChild(pills(t.presets.map((p) => [p.key, p.label]), B.preset, (k) => {
    const p = t.presets.find((x) => x.key === k);
    B.preset = k; B.rounds = p.rounds;
    stopBreath(); ctx.redraw('breathe');
  }));
  box.appendChild(pre);
  const cur = t.presets.find((p) => p.key === B.preset);
  if (cur && cur.use) para(box, cur.use, 'note');
  const f = el('div', 'bform br-set hb-gate');
  const num = (key, label, lo, hi) => {
    const s = select(key, Array.from({ length: hi - lo + 1 }, (_, i) => [lo + i, String(lo + i)]), B[key]);
    s.addEventListener('change', () => { B[key] = Number(s.value); B.preset = null; stopBreath(); idle(); msg.textContent = ''; });
    return field(label, s);
  };
  const msg = el('p', 'bf-msg err');
  f.append(num('inhale', 'Breathe in (seconds)', 1, 8), num('top_up', 'Sip in more', 1, 4), num('exhale', 'Breathe out', 2, 16), num('rounds', 'Rounds', 1, 60));
  const go = button(ICON.play + ' Start', '', () => start());
  go.dataset.breatheGo = '1';
  const stop = button('Stop', 'ghost', () => { stopBreath(); idle(); });
  const pause = button('Pause', 'ghost', () => { if (!B.running) return; B.paused = !B.paused; pause.textContent = B.paused ? 'Resume' : 'Pause'; });
  const act = el('div', 'bf-go');
  act.append(go, pause, stop, msg);
  box.appendChild(act).classList.add('addrow');
  /* the four numbers stay folded until someone wants them */
  const more = el('details', 'hb-gate');
  more.appendChild(el('summary', 'bf-label', 'Timing'));
  f.classList.remove('hb-gate');
  more.appendChild(f);
  box.appendChild(more);
  idle();
  function start() {
    /* the spec's one rule: the breath out is longer than both breaths in */
    if (B.exhale <= B.inhale + B.top_up) { msg.textContent = 'Make the breath out longer than both breaths in together.'; return; }
    stopBreath();
    B.running = true;
    const seq = ['inhale', 'top_up', 'exhale'];
    let round = 1, p = 0, left = B.inhale, last = Date.now();
    const paint = () => {
      live.innerHTML = '';
      live.dataset.breathe = seq[p];
      const st = stat({ num: String(Math.max(1, Math.ceil(left))), label: phase[seq[p]].label, rnum: round + ' of ' + B.rounds, rlabel: 'Round',
        share: 100 * ((round - 1) * 3 + p) / (B.rounds * 3) });
      st.setAttribute('aria-live', 'polite');
      live.appendChild(st);
    };
    paint();
    B.timer = setInterval(() => {
      if (!live.isConnected) { stopBreath(); return; }
      const now = Date.now();
      if (!B.paused) left -= Math.min(1, (now - last) / 1000);   // a locked phone pauses it
      last = now;
      if (left > 0) { const n = live.querySelector('.hb-num'); if (n) n.textContent = String(Math.ceil(left)); return; }
      p++;
      if (p === seq.length) { p = 0; round++; }
      if (round > B.rounds) {
        stopBreath();
        live.innerHTML = '';
        live.dataset.breathe = 'done';
        live.appendChild(stat({ num: 'Done', label: plural(B.rounds, 'round', 'rounds') + '. Breathe normally.' }));
        return;
      }
      left = B[seq[p]];
      if (seq[p] === 'exhale' && navigator.vibrate) try { navigator.vibrate(20); } catch (e) { /* no buzz */ }
      paint();
    }, 200);
  }
  para(box, t.rule, 'note');
  if (b.meditation && b.meditation.length) {
    divider(box, 'Short meditations', null);
    b.meditation.forEach((m, i) => box.appendChild(row({ k: 'med-' + i, tile: { big: m.seconds >= 60 ? Math.round(m.seconds / 60) : m.seconds, small: m.seconds >= 60 ? 'min' : 'sec' },
      title: m.name, lines: [m.how], right: pill('Play', () => player(m.name, [{ name: m.name, seconds: m.seconds, how: m.how }])) })));
  }
  sources(box, b.sources);
}

/* --------------------------------------------------------------- sleep */
function drawSleep(box, rec) {
  const s = rec.sleep;
  section(box, 'Sleep', esc('Aim for ' + s.habit.target_hours + ' hours'));
  bullets(box, s.basics, 'The basics');
  divider(box, 'Trackers', null);
  (s.trackers || []).forEach((t) => box.appendChild(row({
    k: 'tk-' + t.id, tile: { icon: ICON.clock }, title: t.name,
    lines: [[t.form, '· ' + t.cost], t.measures, ['Best for', t.best_for], ['Trade-off', t.tradeoff],
      (t.verified ? 'Prices checked ' + shortDay(t.verified) : 'Prices not checked') + ((t.unverified || []).length ? ' · not confirmed: ' + t.unverified.join('; ') : '')],
    right: /^https?:/i.test(t.url || '') ? ext('Site', t.url) : null })));
  links(box, [tabLink('Add sleep to Today', 'template/t-13')]);
  sources(box, s.sources);
}

/* -------------------------------------------------------------- the tab */
app.register(KEY, page({
  key: KEY, label: 'Recover', icon: 'leaf',
  promise: 'Stretch, sauna, breathe and sleep, with a timer.',
  sections: [['stretch', 'Stretch'], ['yoga', 'Yoga'], ['roll', 'Roll'], ['sauna', 'Sauna & cold'], ['breathe', 'Breathe'], ['sleep', 'Sleep']],
  load: () => Promise.all([data('recover.json'), data('recover-spots.json')]).then(([rec, spots]) => ({ rec, spots })),
  draw(k, box, ctx) {
    if (k === 'stretch') drawRoutine(box, ctx.rec, 'Stretch');
    else if (k === 'yoga') drawRoutine(box, ctx.rec, 'Yoga');
    else if (k === 'roll') drawRoutine(box, ctx.rec, 'Roll');
    else if (k === 'sauna') drawSpots(box, ctx.spots);
    else if (k === 'breathe') drawBreathe(box, ctx.rec, ctx);
    else if (k === 'sleep') drawSleep(box, ctx.rec);
  },
  deactivate() { stopBreath(); },
}));

/* for tests */
export const _breath = () => ({ ...B, timer: undefined });
