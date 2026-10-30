/* out-explore.js — Out · Explore (wave 1, 2026-10-29; APP-MAP.html rows 17 and 31).

   - Walks: the downtown walking tour, Out Loud's routes, and its audio pins,
     each playable in the shell's dock (data/out/app-walks.json, from
     out-loud/stories.json and data/walking-tour.json).
   - Then: Church Street address by address, what is there now and what was
     there before, each line with its source (data/out/app-then.json, from
     the Out data lane's history seed). Old photos are counted, never
     hotlinked: they belong to their archives.
   - Conditions: the beach tracker as the weather job last read it
     (data/weather/beaches.json), then the trail, park, ice and road sources
     a script can read today, then the ones a person has to check.
   - Dog parks: the fenced parks and dog beaches with their posted rules.

   On ?demo=1 every list is invented (data/demo/out-explore.json). */

import * as app from '../app.js';
import { outMode, readJSON, buttons, linkButton } from './out-common.js';
import { button } from '../ui.js';

const FIRST = { walks: 12, then: 15 };
const open = { walks: false, then: false };
let mod = null;

const mmss = (s) => (s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '');
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/[\s,;:]+\S*$/, '') + '…' : s; };
const years = (t) => (t.from ? t.from + (t.to ? ' to ' + t.to : '') + ': ' : '');

const BEACH = { open: 'Open', closed: 'Closed', advisory: 'Advisory', unknown: 'Not sampled now' };

async function load(demo) {
  const d = demo ? await readJSON(null, 'out-explore.json') : null;
  const [W, T, C, B] = d ? [d.walks, d.then, d.conditions, d.beaches] : await Promise.all([
    readJSON('../data/out/app-walks.json'), readJSON('../data/out/app-then.json'),
    readJSON('../data/out/conditions-sources.json'), readJSON('../data/weather/beaches.json').catch(() => null),
  ]);

  /* Walks */
  const tour = W.tour || {};
  const lead = [{ k: 'wk-tour', kind: 'post', src: 'Btown Brief', sid: 'out-walks', own: true, title: tour.name || 'A downtown walking tour', href: '../walking-tour.html',
    text: [tour.duration, tour.stops && tour.stops.length ? tour.stops.length + ' stops, from ' + tour.stops[0].title + ' to ' + tour.stops[tour.stops.length - 1].title + '.' : ''].filter(Boolean).join(' ') }]
    .concat((W.routes || []).map((r) => ({ k: 'wk-' + r.id, kind: 'post', src: 'Out Loud', sid: 'out-loud', title: r.title, href: '../out-loud/',
      text: short(r.blurb, 160) + (r.pins && r.pins.length ? ' ' + r.pins.length + ' stories on the way.' : '') })));
  const pins = (W.pins || []).filter((p) => p.audio).map((p) => ({
    k: 'ol-' + p.id, kind: 'audio', src: 'Out Loud', sid: 'out-loud', show: 'Out Loud', title: p.title, why: p.tease, href: '../out-loud/',
    src_audio: '../out-loud/' + p.audio, dur: mmss(p.secs), media: 'paper',
  }));
  const secs = [{
    key: 'walks', label: 'Walks', sub: 'The walking tour, and ' + pins.length + ' stories to hear where they happened.',
    items: lead.concat(open.walks ? pins : pins.slice(0, FIRST.walks)),
    draw(box) { buttons(box, [!open.walks && pins.length > FIRST.walks ? button('All ' + pins.length + ' stories', 'ghost sm', () => { open.walks = true; mod.reload(); }) : null, linkButton('Open Out Loud', '../out-loud/', 'ghost sm')]); },
  }];

  /* Then */
  const places = (T.places || []).filter((p) => p.timeline && p.timeline.length);
  const thenItems = places.map((p) => {
    const tl = p.timeline;
    const last = tl.slice(-3).reverse();
    return { k: 'th-' + p.id, kind: 'post', src: p.kind === 'block' ? 'Church Street' : 'Church St', sid: 'out-then', title: p.address + (typeof p.now === 'string' && p.now ? ' · now ' + p.now : ''),
      text: last.map((t) => years(t) + t.what).join('. ') + '.' + (tl.length > 3 ? ' ' + (tl.length - 3) + ' more on the record.' : '') + (p.photos ? ' ' + p.photos + (p.photos === 1 ? ' old photo' : ' old photos') + ' in the archives.' : ''),
      href: tl[tl.length - 1].url };
  });
  secs.push({
    key: 'then', label: 'Then', sub: 'Church Street, address by address: what was there before. Every line has its source.',
    items: open.then ? thenItems : thenItems.slice(0, FIRST.then),
    draw(box) { buttons(box, [!open.then && thenItems.length > FIRST.then ? button('All ' + thenItems.length + ' addresses', 'ghost sm', () => { open.then = true; mod.reload(); }) : null, linkButton('Burlington history', '../history.html', 'ghost sm')]); },
    empty: 'Nothing on the record yet.',
  });

  /* Conditions */
  const srcs = (C.sources || []).filter((s) => s.url);
  const readable = new Set(((C.counts || {}).machine_readable_ids) || []);
  const tracker = srcs.find((s) => s.id === 'btv-beach-tracker');
  const bl = (B && B.beaches) || [];
  const allQuiet = bl.length && bl.every((b) => b.status === 'unknown');
  const beachItems = allQuiet
    ? [{ k: 'cd-beaches', kind: 'post', src: 'Burlington beach tracker', sid: 'out-beaches', title: 'Beach season is over', href: (tracker && tracker.url) || '../beaches.html',
      text: 'The city stopped sampling after ' + String(bl[0].sampled || '').slice(0, 10) + '. Testing starts again in June.' }]
    : bl.map((b) => ({ k: 'cd-b-' + b.name.toLowerCase().replace(/\W+/g, '-'), kind: 'post', src: 'Burlington beach tracker', sid: 'out-beaches', live: b.status === 'open',
      title: b.name + ': ' + (BEACH[b.status] || cap(b.status)), href: (tracker && tracker.url) || '../beaches.html',
      text: [b.reason, b.ecoli != null ? 'E. coli ' + b.ecoli : '', b.sampled ? 'sampled ' + b.sampled : ''].filter(Boolean).join(' · ') }));
  const srcItem = (s) => ({ k: 'cd-' + s.id, kind: 'post', src: s.owner || s.name, sid: 'out-cd-' + s.id, title: s.name, href: s.url,
    text: short([(s.covers || []).slice(0, 4).join(', '), s.update_cadence].filter(Boolean).join('. '), 180) });
  secs.push({
    key: 'conditions', label: 'Conditions', sub: 'Beaches, trails, rinks and roads: where each one is posted.',
    items: beachItems.concat(srcs.filter((s) => readable.has(s.id) && s.id !== 'btv-beach-tracker').map(srcItem), srcs.filter((s) => !readable.has(s.id) && s.id !== 'btv-beach-tracker').map(srcItem)),
    draw: (box) => buttons(box, [linkButton('The beaches page', '../beaches.html', 'ghost sm')]),
  });

  /* Dog parks */
  const dogs = (C.dog_parks || []).filter((p) => p.source_url || p.url).map((p) => ({
    k: 'dg-' + p.id, kind: 'post', src: p.town || 'Dog park', sid: 'out-dogs', title: p.name, href: p.source_url || p.url,
    text: [cap(p.kind), p.hours, p.season, p.leash_rule].filter(Boolean).join('. ') + '.',
  }));
  secs.push({ key: 'dogs', label: 'Dog parks', sub: 'Fenced parks and dog beaches, with their posted rules.', items: dogs, empty: 'No dog parks listed.' });
  return secs;
}

mod = outMode({ key: 'explore', label: 'Explore', icon: 'pin', promise: 'Walks, old stories on every corner, and the trail report.', load });
app.register('explore', mod);
