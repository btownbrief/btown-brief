/* rows.js — one feed row, used by Wire, Reddit and Popular.

   A row is a <div class="fi"> so the swipe layer can translate it, with the
   link as a child rather than the row itself: an <a> that IS the row cannot
   carry a swipe without fighting the browser's own drag handling.

   `data-k` is the row's identity everywhere — gestures, saves, votes and
   read-state all key off it, so it has to be the same string in all four. */

import * as store from './store.js';
import * as app from './app.js';
import * as wire from './wire.js';
import { el, esc, safeHref, agoShort, starBtn, voteBtn, paintVote, ICON } from './ui.js';

export const keyOf = (it) => it.u || it.o || it.t;

export function isLocalSource(src) {
  return !!src && (src.local === 1 || src.topic === 'local');
}

/* The card the row opens when you hold it. Feeds carry two sentences of
   description; that plus the picture is a real preview, and the button
   underneath is the actual article. Nothing is fetched — a cross-origin
   fetch of a news site is blocked anyway, and a proxy would mean handing a
   third party every headline anyone hovers. */
export function previewFor(it, src) {
  const body = it.e
    ? it.e
    : 'This one does not carry a preview — its feed publishes headlines only.';
  const actions = [];
  const save = el('button', 'btn btn-quiet', store.isSaved(keyOf(it)) ? '★ Saved' : '☆ Save');
  save.addEventListener('click', () => {
    const on = store.toggleSaved(itemRecord(it, src));
    save.textContent = on ? '★ Saved' : '☆ Save';
  });
  actions.push(save);
  return app.peek({
    title: it.t || 'Untitled',
    from: [src?.short || src?.name, it.d ? agoShort(it.d) + ' ago' : ''].filter(Boolean).join(' · '),
    art: it.i,
    body,
    href: it.u,
    actions,
  });
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

  const row = el('div', 'fi' + (local ? ' is-local' : '') + (seen ? ' is-read' : ''));
  row.dataset.k = k;

  const link = el('a', 'fi-body');
  link.href = safeHref(it.u);
  link.target = '_blank';
  link.rel = 'noopener';
  link.appendChild(el('span', 'fi-title', esc(it.t || 'Untitled')));

  const meta = el('div', 'fi-meta');
  if (local && !opts.tag) meta.appendChild(el('span', 'tag-local', 'Local'));
  if (opts.tag) meta.appendChild(el('span', 'tag-local', esc(opts.tag)));
  meta.appendChild(el('span', 'fi-src', esc(src?.short || src?.name || '')));
  if (it.d) meta.appendChild(el('span', null, agoShort(it.d)));
  if (opts.isNew) meta.appendChild(el('span', 'tag-new', 'New'));
  if (it.a) meta.appendChild(el('span', null, '♪ Audio'));
  link.appendChild(meta);
  link.addEventListener('click', () => {
    store.markRead(k);
    row.classList.add('is-read');
  });
  row.appendChild(link);

  const foot = el('div', 'fi-foot');
  foot.appendChild(el('span', 'spacer'));
  const vote = voteBtn(store.voteCount(k), store.hasVoted(k), store.votesLive());
  vote.addEventListener('click', (e) => {
    e.preventDefault();
    const on = store.toggleVote(itemRecord(it, src));
    paintVote(vote, store.voteCount(k), on);
  });
  foot.appendChild(vote);

  const star = starBtn(store.isSaved(k));
  star.addEventListener('click', (e) => {
    e.preventDefault();
    const on = store.toggleSaved(itemRecord(it, src));
    star.classList.toggle('on', on);
    star.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  foot.appendChild(star);

  row.appendChild(foot);
  if (it.i) {
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
    onHold(k) {
      const found = lookup(k);
      if (found) previewFor(found.it, found.src);
    },
  };
}

/* One request for a screenful of vote counts, then repaint what changed. */
export function hydrateVotes(root, keys) {
  store.loadVotes(keys).then((ok) => {
    if (!ok) return;
    root.querySelectorAll('.fi').forEach((row) => {
      const k = row.dataset.k;
      const b = row.querySelector('.vote');
      if (!b) return;
      b.hidden = false;
      paintVote(b, store.voteCount(k), store.hasVoted(k));
    });
    root.querySelectorAll('.v[data-k]').forEach((card) => {
      const k = card.dataset.k;
      const b = card.querySelector('.vote');
      if (!b) return;
      b.hidden = false;
      paintVote(b, store.voteCount(k), store.hasVoted(k));
    });
  });
}
