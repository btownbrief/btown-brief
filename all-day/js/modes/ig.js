/* ig.js — Instagram, in the order it was posted.

   A lot of what happens in Burlington is announced on Instagram and nowhere
   else. Sunset Watchers Club picks a spot two days out; Bolters posts a run;
   a pop-up names its location in a caption. None of that reaches Seven Days,
   Hello Burlington or Front Porch Forum, so the only way to see it has been
   to already follow the account AND to be shown the post.

   This shows those accounts newest-first and nothing else. No ranking, no
   engagement count, no "suggested", no infinite tail — the ordering is the
   clock, which is the one thing the app it comes from will not give you. If
   this tab ever starts deciding what you should see first, it has become the
   thing it exists to avoid.

   THE IMAGES EXPIRE. Instagram's CDN signs every URL with an `oe` parameter
   about three days out, so this payload is rebuilt daily and the tab says
   when it was built. If a picture is missing, that is what happened — the
   tile degrades to the caption rather than a broken frame.

   Tapping a post opens the caption here and links out to Instagram. It never
   embeds their player, and there is no login, no like and no comment — going
   to Instagram is a deliberate act, not something this tab does for you. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, safeHref, chip, heading, scrollHint, agoShort,
         tabStamp, stampOf } from './../ui.js';

const state = { root: null, ig: null, who: null };

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Loading the feed…</p>';
  data.load('instagram', (json) => { state.ig = json; render(); }, () => {
    root.innerHTML = '';
    root.appendChild(el('div', 'errbox',
      '<b>Couldn’t reach the feed.</b><br>It is rebuilt every morning.'));
  });
}

export function activate() {}
export function refresh() { if (state.ig) render(); }
export function deactivate() { app.closePeek(); }

const posts = () => (state.ig && Array.isArray(state.ig.posts)) ? state.ig.posts : [];

function openPost(p) {
  app.sheet('@' + p.h, (body) => {
    const img = el('img', 'ig-full');
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    img.src = p.i;
    /* A signed URL that has aged out should not leave a broken frame in the
       middle of the sheet — the caption is the part that still works. */
    img.addEventListener('error', () => { img.remove(); });
    body.appendChild(img);

    body.appendChild(el('p', 'ig-handle',
      '@' + esc(p.h) + ' · ' + esc(agoShort(p.ts)) + ' ago'));
    if (p.c) body.appendChild(el('p', 'ig-cap', esc(p.c)));

    const row = el('div', 'btns');
    const go = el('a', 'btn', 'Open on Instagram');
    go.href = safeHref(p.u);
    go.target = '_blank';
    go.rel = 'noopener';
    row.appendChild(go);
    const acct = el('a', 'btn btn-quiet', 'The account');
    acct.href = safeHref('https://www.instagram.com/' + p.h + '/');
    acct.target = '_blank';
    acct.rel = 'noopener';
    row.appendChild(acct);
    body.appendChild(row);
  });
}

function cell(p) {
  const box = el('div', 'ig-cell');
  const hit = el('button', 'ig-hit');
  const img = el('img', 'ig-img');
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = p.c ? p.c.slice(0, 80) : '';
  img.src = p.i;
  img.addEventListener('error', () => { box.classList.add('is-dead'); });
  hit.appendChild(img);
  if (p.v) hit.appendChild(el('span', 'ig-vid'));
  hit.addEventListener('click', () => openPost(p));
  box.appendChild(hit);
  box.appendChild(el('span', 'ig-who', '@' + esc(p.h)));
  return box;
}

export function render() {
  const root = state.root;
  root.innerHTML = '';
  tabStamp(root, stampOf(state.ig && state.ig.generated), 'the accounts, every morning');

  const all = posts();
  const accounts = (state.ig && state.ig.handles) || [];

  heading(root, {
    eyebrow: 'Posted, not ranked',
    title: 'Instagram',
    sub: 'Burlington accounts in the order they posted. ' +
         '<span class="count">' + all.length + ' posts across ' +
         accounts.length + ' account' + (accounts.length === 1 ? '' : 's') + '</span>',
  });

  root.appendChild(el('p', 'ig-note',
    'No algorithm, no likes, no endless scroll — just the newest thing each ' +
    'of these accounts posted. Tap a picture for the caption.'));

  if (accounts.length > 1) {
    const chips = el('div', 'chips');
    chips.appendChild(chip('Everyone', !state.who, () => { state.who = null; render(); }));
    /* Ordered by who posted most recently, so the chip row is itself in
       clock order rather than alphabetical. */
    const seen = [];
    all.forEach((p) => { if (!seen.includes(p.h)) seen.push(p.h); });
    seen.forEach((h) => chips.appendChild(
      chip('@' + esc(h), state.who === h,
        () => { state.who = state.who === h ? null : h; render(); })));
    root.appendChild(chips);
    scrollHint(chips);
  }

  const list = state.who ? all.filter((p) => p.h === state.who) : all;
  const grid = el('div', 'ig-grid');
  list.forEach((p) => grid.appendChild(cell(p)));
  root.appendChild(grid);

  if (!list.length) {
    root.appendChild(el('p', 'empty',
      state.ig ? 'Nothing from that account in the last few weeks.' : 'Loading…'));
  }
}
