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

const state = { root: null, ig: null, who: null, openAccounts: false };

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

/* A grid of pictures answers "what does Burlington look like". It does not
   answer "what is happening", which is the whole reason these accounts are
   worth reading — Sunset Watchers Club names a spot in the caption, Bolters
   names a time. So the caption rides on the card and the picture sits beside
   it, rather than the text hiding behind a tap.

   Four lines, clamped. Long captions run to a wall of hashtags; the rest is
   one tap away and almost nobody wants it. */
function cell(p) {
  const box = el('article', 'ig-post');
  const hit = el('button', 'ig-hit');

  const shot = el('span', 'ig-shot');
  const img = el('img', 'ig-img');
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  img.src = p.i;
  /* A signed URL that has aged out must not leave a broken frame — the card
     drops to text, which is still the useful half. */
  img.addEventListener('error', () => { box.classList.add('no-art'); });
  shot.appendChild(img);
  if (p.v) shot.appendChild(el('span', 'ig-vid'));
  hit.appendChild(shot);

  const body = el('span', 'ig-body');
  body.innerHTML =
    '<span class="ig-who">@' + esc(p.h) + '<span class="ig-when">' +
      esc(agoShort(p.ts)) + '</span></span>' +
    (p.c ? '<span class="ig-text">' + esc(p.c) + '</span>'
         : '<span class="ig-text ig-nocap">No caption — tap for the post.</span>');
  hit.appendChild(body);

  hit.addEventListener('click', () => openPost(p));
  box.appendChild(hit);
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
    'of these accounts posted, with what they actually said.'));

  if (accounts.length > 1) {
    /* Ordered by who posted most recently, so the row is itself in clock order
       rather than alphabetical. */
    const seen = [];
    all.forEach((p) => { if (!seen.includes(p.h)) seen.push(p.h); });

    const wrap = el('div', 'ig-accts' + (state.openAccounts ? ' is-open' : ''));
    const chips = el('div', 'chips');
    chips.appendChild(chip('Everyone', !state.who, () => { state.who = null; render(); }));
    seen.forEach((h) => chips.appendChild(
      chip('@' + esc(h), state.who === h,
        () => { state.who = state.who === h ? null : h; render(); })));
    wrap.appendChild(chips);
    root.appendChild(wrap);
    if (!state.openAccounts) scrollHint(chips);

    /* Thirty-one accounts is a long sideways push, and the one you want is
       rarely near the front. Same affordance the rails carry: open it out into
       a plain list, and close it from the same control. */
    const toggle = el('button', 'ig-accts-btn',
      state.openAccounts ? 'Back to a row'
                         : 'All ' + seen.length + ' accounts');
    toggle.setAttribute('aria-expanded', state.openAccounts ? 'true' : 'false');
    toggle.addEventListener('click', () => {
      state.openAccounts = !state.openAccounts;
      render();
      if (state.openAccounts) {
        const w = state.root.querySelector('.ig-accts');
        if (w) w.scrollIntoView({ block: 'nearest' });
      }
    });
    root.appendChild(toggle);
  }

  const list = state.who ? all.filter((p) => p.h === state.who) : all;
  const feed = el('div', 'ig-feed');
  list.forEach((p) => feed.appendChild(cell(p)));
  root.appendChild(feed);

  if (!list.length) {
    root.appendChild(el('p', 'empty',
      state.ig ? 'Nothing from that account in the last few weeks.' : 'Loading…'));
  }
}
