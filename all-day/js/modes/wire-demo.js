/* wire-demo.js — the Wire's fake payloads for ?demo=1.

   data/demo/wire.json holds a baked day in the real contract: wire-today.json
   (date, counts, picks with rank and why, updates, sources, status, the
   Brief), wire/index.json and two frozen editions, plus a small pulse.json
   for Unfiltered. modes/wire.js draws them exactly as it draws the real
   ones; this file only stands in for the data layer. The demo clock is
   pinned to the baked afternoon (`now`), so the dateline, the ages and the
   "new since you were here" line read the same every time.

   Owned with modes/wire.js by the Wire's session. Every item is invented. */

import * as app from '../app.js';

let D = null;
let readyP = null;
const onToday = [];
let freshDone = false;

export const init = () => readyP || (readyP = app.demoData('wire').then((d) => { D = d; return d; }));

/* A pull to refresh brings two new stories into the current update, under
   its lead, the way the hourly run would. */
function withFresh(today, fresh) {
  const t = JSON.parse(JSON.stringify(today));
  const u = t.updates[0];
  u.items.splice(u.lead ? 1 : 0, 0, ...fresh);
  t.updated = D.now;
  t.count += fresh.length;
  ['local', 'everything'].forEach((scope) => fresh.forEach((it) => {
    if (scope === 'local' && !it.local) return;
    t.counts[scope].all += 1;
    if (it.ch in t.counts[scope]) t.counts[scope][it.ch] += 1;
  }));
  return t;
}

export const source = {
  now: () => (D ? Date.parse(D.now) : Date.now()),
  base: () => (D ? Date.parse(D.visitBase) / 1000 : 0),
  today(ok, fail) { onToday.push(ok); init().then((d) => ok(d.today), fail); },
  index(ok, fail) { init().then((d) => ok(d.index), fail); },
  pulse(ok, fail) { init().then((d) => ok(d.pulse), fail); },
  edition: (date) => init().then((d) => d.editions[date] || Promise.reject(new Error('no edition ' + date))),
  check() {
    if (!D || freshDone) return Promise.resolve(null);
    freshDone = true;
    D.today = withFresh(D.today, D.fresh);
    onToday.forEach((cb) => cb(D.today));
    return Promise.resolve(D.fresh.length + ' new since you looked');
  },
  newSince: () => (D ? Number(D.newSince) || 0 : 0),
};
