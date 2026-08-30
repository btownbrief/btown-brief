/* ig.js — Instagram, in the order it was posted. Two halves of one tab.

   DO is the original promise. A lot of what happens in Burlington is announced
   on Instagram and nowhere else: Sunset Watchers Club picks a spot two days
   out, Bolters posts a run, a pop-up names its location in a caption. None of
   that reaches Seven Days, Hello Burlington or Front Porch Forum, so the only
   way to see it has been to already follow the account AND to be shown the
   post. That half is text-forward on purpose — the caption is the event.

   SEE is the other half, and it is a different question. Not "what is on"
   but "what does it look like here right now, and who is making things about
   it": the missed-connections page, the creemee reviewers, the DJs, the
   people who shoot the lake every evening. Nobody reads a photograph for the
   logistics, so SEE is a wall of pictures and the words step back.

   ONE RULE COVERS BOTH. Newest first and nothing else. No ranking, no
   engagement count, no "suggested", no infinite tail — the ordering is the
   clock, which is the one thing the app it comes from will not give you. If
   either half ever starts deciding what you should see first, it has become
   the thing this exists to avoid. The toggle picks which room you are in; it
   never sorts the room.

   THE IMAGES EXPIRE. Instagram's CDN signs every URL with an `oe` parameter
   about four days out, so this payload is rebuilt daily and the tab says when
   it was built. If a picture is missing, that is what happened. DO degrades
   to its caption, which is the useful half of a DO card. A SEE tile has no
   useful form without its picture, so it removes itself instead of leaving a
   grey square in the wall.

   Tapping a post opens the caption here and links out to Instagram. It never
   embeds their player, and there is no login, no like and no comment — going
   to Instagram is a deliberate act, not something this tab does for you. */

import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, safeHref, chip, heading, scrollHint, agoShort, seg,
         tabStamp, stampOf } from './../ui.js';

/* Machine values, not labels. The words on the buttons are a taste decision
   and will change; `do` and `see` are written into the payload by the builder
   and must not. */
const SEGMENTS = ['do', 'see'];

const state = {
  root: null,
  ig: null,
  segment: 'do',
  /* One selected account per half. Sharing a single `who` across the toggle
     means switching halves lands you on an empty feed filtered by a handle
     the other half has never heard of. */
  who: { do: null, see: null },
  openAccounts: false,
};

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

const allPosts = () =>
  (state.ig && Array.isArray(state.ig.posts)) ? state.ig.posts : [];

/* A payload written before the tab had two halves has no `s` on its records,
   and the service worker can hand us one of those for days. Everything
   unlabelled is DO — which is exactly what those posts were. */
const segmentOf = (p) => (p && p.s === 'see') ? 'see' : 'do';

const postsIn = (segment) => allPosts().filter((p) => segmentOf(p) === segment);

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

/* ------------------------------------------------------------------ DO */
/* A grid of pictures answers "what does Burlington look like". It does not
   answer "what is happening", which is the whole reason these accounts are
   worth reading — Sunset Watchers Club names a spot in the caption, Bolters
   names a time. So the caption rides on the card and the picture sits beside
   it, rather than the text hiding behind a tap.

   Four lines, clamped. Long captions run to a wall of hashtags; the rest is
   one tap away and almost nobody wants it. */
function doCell(p) {
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

/* ----------------------------------------------------------------- SEE */
/* The wall. Square tiles, because a grid of mixed aspect ratios reads as a
   mess, and the same reason Photos gives: these are all pictures of the same
   town and the eye wants a rhythm to scan.

   The handle sits ON the picture rather than under it. A caption line under
   every tile turns the wall back into a list, and the one thing you want
   while scanning is whose it is. The words are still there — the whole
   caption is one tap away in the same sheet DO uses. */
function seeCell(p) {
  const tile = el('article', 'igw-tile');
  const hit = el('button', 'igw-hit');

  const img = el('img', 'igw-img');
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.alt = p.c ? esc(p.c).slice(0, 80) : '';
  img.src = p.i;
  /* A photo wall has no useful form without the photo. There is no text
     fallback worth a square here, so the tile leaves rather than sitting in
     the grid as a hole.

     If they ALL leave — a payload old enough that every signature has expired
     — the wall would otherwise be an empty box under a heading promising
     ninety posts. The last tile out turns the lights off. */
  img.addEventListener('error', () => {
    const wall = tile.parentNode;
    tile.remove();
    if (wall && !wall.querySelector('.igw-tile') && !wall.nextElementSibling) {
      wall.insertAdjacentElement('afterend', el('p', 'empty',
        'These pictures have expired — the wall is rebuilt every morning.'));
    }
  });
  hit.appendChild(img);

  const foot = el('span', 'igw-foot');
  foot.innerHTML = '<span class="igw-who">@' + esc(p.h) + '</span>' +
    '<span class="igw-when">' + esc(agoShort(p.ts)) + '</span>';
  hit.appendChild(foot);

  if (p.v) hit.appendChild(el('span', 'igw-vid'));

  hit.addEventListener('click', () => openPost(p));
  tile.appendChild(hit);
  return tile;
}

/* --------------------------------------------------------------- chrome */

const COPY = {
  do: {
    eyebrow: 'Posted, not ranked',
    title: 'Things to do',
    note: 'The accounts that announce it here first — markets, run clubs, ' +
          'pop-ups, block parties. Newest first, with what they actually said.',
    emptyAccount: 'Nothing from that account in the last few weeks.',
  },
  see: {
    eyebrow: 'Posted, not ranked',
    title: 'Things to see',
    note: 'The people making things about this place — the food reviewers, ' +
          'the DJs, the sunset shooters, the missed connections. Tap any ' +
          'picture for the caption.',
    emptyAccount: 'Nothing from that account in the last few weeks.',
  },
};

/* The toggle. `seg()` is the house control — Music switches Artists/Venue
   calendar with it, Photos switches All/Sunsets — so this is the same shape
   the rest of the app already taught the reader.

   It carries an aria-label and pressed state that the bare helper does not:
   this one changes what the entire tab is for, which is a bigger promise than
   picking a shelf, and a screen reader should hear which half is live. */
function toggle(host) {
  const wrap = seg(
    [['do', 'Do'], ['see', 'See']],
    state.segment,
    (v) => {
      if (v === state.segment) return;
      state.segment = v;
      /* The account rail belongs to the half you were in. Reopening it in the
         other half shows a list you did not ask for. */
      state.openAccounts = false;
      render();
      if (state.root) state.root.scrollTop = 0;
    });
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Which half of Instagram');
  [...wrap.children].forEach((b, i) => {
    b.setAttribute('aria-pressed', SEGMENTS[i] === state.segment ? 'true' : 'false');
  });
  host.appendChild(wrap);
}

/* The account row, scoped to one half. Ordered by who posted most recently,
   so the row is itself in clock order rather than alphabetical. */
function accounts(host, list) {
  const seen = [];
  list.forEach((p) => { if (!seen.includes(p.h)) seen.push(p.h); });
  if (seen.length < 2) return;

  const who = state.who[state.segment];
  const wrap = el('div', 'ig-accts' + (state.openAccounts ? ' is-open' : ''));
  const chips = el('div', 'chips');
  chips.appendChild(chip('Everyone', !who, () => {
    state.who[state.segment] = null;
    render();
  }));
  seen.forEach((h) => chips.appendChild(
    chip('@' + esc(h), who === h, () => {
      state.who[state.segment] = who === h ? null : h;
      render();
    })));
  wrap.appendChild(chips);
  host.appendChild(wrap);
  if (!state.openAccounts) scrollHint(chips);

  /* Thirty-one accounts is a long sideways push, and the one you want is
     rarely near the front. Same affordance the rails carry: open it out into
     a plain list, and close it from the same control. */
  const btn = el('button', 'ig-accts-btn',
    state.openAccounts ? 'Back to a row' : 'All ' + seen.length + ' accounts');
  btn.setAttribute('aria-expanded', state.openAccounts ? 'true' : 'false');
  btn.addEventListener('click', () => {
    state.openAccounts = !state.openAccounts;
    render();
    if (state.openAccounts) {
      const w = state.root.querySelector('.ig-accts');
      if (w) w.scrollIntoView({ block: 'nearest' });
    }
  });
  host.appendChild(btn);
}

export function render() {
  const root = state.root;
  root.innerHTML = '';
  tabStamp(root, stampOf(state.ig && state.ig.generated), 'the accounts, every morning');
  app.jarRow(root, 'ig');

  const segment = state.segment;
  const copy = COPY[segment];
  const mine = postsIn(segment);

  toggle(root);

  /* Count the accounts in THIS half, not the payload's top-level `handles`
     list — that one spans both, so DO would claim credit for the creators. */
  const here = new Set(mine.map((p) => p.h)).size;
  heading(root, {
    eyebrow: copy.eyebrow,
    title: copy.title,
    sub: '<span class="count">' + mine.length + ' post' +
         (mine.length === 1 ? '' : 's') + ' across ' + here +
         ' account' + (here === 1 ? '' : 's') + '</span>',
  });
  root.appendChild(el('p', 'ig-note', copy.note));

  accounts(root, mine);

  const who = state.who[segment];
  const list = who ? mine.filter((p) => p.h === who) : mine;

  if (!list.length) {
    root.appendChild(el('p', 'empty',
      !state.ig ? 'Loading…'
        : who ? copy.emptyAccount
        /* An older payload has no SEE half at all. That is not an error and
           it heals itself the next morning, so say which it is. */
        : segment === 'see'
          ? 'No creator posts in this edition yet — it fills in overnight.'
          : 'Nothing posted in the last few weeks.'));
    return;
  }

  const feed = el('div', segment === 'see' ? 'igw-wall' : 'ig-feed');
  const cell = segment === 'see' ? seeCell : doCell;
  list.forEach((p) => feed.appendChild(cell(p)));
  root.appendChild(feed);
}
