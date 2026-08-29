/* rows.js — one feed row, used by Wire, Reddit and Popular.

   Note there is no hold handler here. Long-pressing a row is Safari's job:
   iOS renders a live preview of the linked page, which beats any card we
   could draw from a two-sentence RSS blurb. See gestures.js.

   A row is a <div class="fi"> so the swipe layer can translate it, with the
   link as a child rather than the row itself: an <a> that IS the row cannot
   carry a swipe without fighting the browser's own drag handling.

   `data-k` is the row's identity everywhere — gestures, saves, votes and
   read-state all key off it, so it has to be the same string in all four. */

import * as store from './store.js';
import * as app from './app.js';
import * as wire from './wire.js';
import { el, esc, safeHref, agoShort, starBtn, voteBtn, paintVote } from './ui.js';

export const keyOf = (it) => it.u || it.o || it.t;

export function isLocalSource(src) {
  return !!src && (src.local === 1 || src.topic === 'local');
}

export function itemRecord(it, src) {
  return {
    k: keyOf(it),
    kind: 'wire',
    title: it.t || 'Untitled',
    from: src?.short || src?.name || '',
    href: it.u,
    art: it.i || '',
  };
}

/* Build one row. `opts.tag` overrides the LOCAL badge (Reddit passes r/sub). */
export function feedRow(it, src, opts = {}) {
  const k = keyOf(it);
  const local = isLocalSource(src);
  const seen = store.isRead(k);

  const row = el('div', 'fi' + (local ? ' is-local' : '') + (seen ? ' is-read' : '') +
    (store.hasPassed(k) ? ' passed' : '') + (opts.compact ? ' is-compact' : ''));
  row.dataset.k = k;

  const link = el('a', 'fi-body');
  link.href = safeHref(it.u);
  link.target = '_blank';
  link.rel = 'noopener';
  link.appendChild(el('span', 'fi-title', esc(it.t || 'Untitled')));

  const meta = el('span', 'fi-meta');
  if (local && !opts.tag) meta.appendChild(el('span', 'tag-local', 'Local'));
  if (opts.tag) meta.appendChild(el('span', 'tag-local', esc(opts.tag)));
  /* the outlet wears its topic's colour — the cheapest colour on the page,
     because the words are already there */
  const topic = (src && src.topic) || '';
  /* inside a by-source column the outlet name is on the column head — it
     would be printed once per row for nothing */
  if (!opts.compact) {
    meta.appendChild(el('span', 'fi-src' + (topic ? ' t-' + topic : ''),
      esc(src?.short || src?.name || '')));
  }
  if (it.d) meta.appendChild(el('span', null, agoShort(it.d)));
  if (opts.isNew) meta.appendChild(el('span', 'tag-new', 'New'));
  if (it.a) meta.appendChild(el('span', null, '♪'));
  link.addEventListener('click', () => {
    store.markRead(k);
    row.classList.add('is-read');
  });
  row.appendChild(link);

  const foot = el('div', 'fi-foot');
  foot.appendChild(meta);
  foot.appendChild(el('span', 'spacer'));
  const vote = voteBtn(store.voteCount(k), store.hasVoted(k), store.votesLive());
  vote.addEventListener('click', (e) => {
    e.preventDefault();
    const on = store.toggleVote(itemRecord(it, src));
    paintVote(vote, store.voteCount(k), on);
  });
  foot.appendChild(vote);

  row.appendChild(foot);

  const star = starBtn(store.isSaved(k));
  star.addEventListener('click', (e) => {
    e.preventDefault();
    const on = store.toggleSaved(itemRecord(it, src));
    star.classList.toggle('on', on);
    star.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  row.appendChild(star);
  if (it.i && !opts.compact) {
    const img = el('img', 'fi-thumb');
    img.src = it.i;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    row.appendChild(img);
  }
  return row;
}

/* Wire the swipe/hold layer to a feed, given a way to look an item up. */
export function bindFeed(root, lookup, onChange) {
  return {
    onSave(k) {
      const found = lookup(k);
      if (!found) return;
      const on = store.toggleSaved(itemRecord(found.it, found.src));
      app.toast(on ? 'Saved' : 'Removed from saved');
      onChange?.();
    },
    onMute(k) {
      const found = lookup(k);
      if (!found || !found.src) return;
      const name = found.src.short || found.src.name || 'this source';
      app.confirmBox({
        title: 'Mute ' + name + '?',
        body: 'You won’t see ' + name + ' anywhere in All Day, or on the Pulse page. Bring it back any time in Settings.',
        yes: 'Mute',
        danger: true,
        onYes() {
          store.setMuted(found.src.id, true);
          onChange?.();
          app.toast('Muted ' + name, () => {
            store.setMuted(found.src.id, false);
            onChange?.();
          });
        },
      });
    },
  };
}

/* Grey out what scrolled off the top. Only what the reader actually watched
   leave the screen counts — a re-render while scrolled deep reports
   everything above the viewport as "not intersecting", and none of that was
   read. Straight port of pulse.js's intent observer, sharing its key. */
const passWatchers = new WeakMap();

export function watchPassed(root) {
  if (!('IntersectionObserver' in window)) return null;
  /* a tab re-renders on every chip tap; the previous pass observer is
     watching nodes that no longer exist */
  passWatchers.get(root)?.disconnect();
  const seen = Object.create(null);
  let pending = [];
  let timer = 0;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      if (e.isIntersecting) { seen[k] = 1; return; }
      if (e.boundingClientRect.bottom <= 0 && seen[k]) {
        e.target.classList.add('passed');
        pending.push(k);
        io.unobserve(e.target);
      }
    });
    if (!pending.length) return;
    clearTimeout(timer);
    timer = setTimeout(() => { store.markPassed(pending); pending = []; }, 600);
  }, { root, threshold: 0 });
  root.querySelectorAll('.fi').forEach((r) => io.observe(r));
  passWatchers.set(root, io);
  return io;
}

/* One request for a screenful of vote counts, then repaint what changed. */
export function hydrateVotes(root, keys) {
  store.loadVotes(keys).then((ok) => {
    if (!ok) return;
    /* Anything carrying a key and a vote button, rather than a list of card
       classes to keep in sync — the picks and the Wikipedia doors both got
       arrows that stayed hidden because they were shapes this list did not
       know about. */
    root.querySelectorAll('[data-k]').forEach((host) => {
      const b = host.querySelector('.vote');
      if (!b) return;
      b.hidden = false;
      paintVote(b, store.voteCount(host.dataset.k), store.hasVoted(host.dataset.k));
    });
  });
}
