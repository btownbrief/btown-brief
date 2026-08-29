/* main.js — the entry point. Registers the five modes, wires the two sheets
   that belong to the shell rather than to any tab, then routes.

   Modules make the boot order deterministic: every import has evaluated and
   every register() has run before route() is called on the last line. There
   is no global registry to race. */

import * as app from './app.js';
import * as store from './store.js';
import * as data from './wire.js';
import { el, esc, safeHref, ICON, seg } from './ui.js';

import * as wire from './modes/wire.js';
import * as reddit from './modes/reddit.js';
import * as watch from './modes/watch.js';
import * as listen from './modes/listen.js';
import * as music from './modes/music.js';
import * as photos from './modes/photos.js';
import * as wander from './modes/wander.js';

app.register('wire', wire);
app.register('reddit', reddit);
app.register('watch', watch);
app.register('listen', listen);
app.register('music', music);
app.register('photos', photos);
app.register('wander', wander);

const $ = (id) => document.getElementById(id);

$('saved-btn').innerHTML = ICON.star;
$('settings-btn').innerHTML = ICON.gear;

/* --------------------------------------------------------------- saved */

const KIND_LABEL = { wire: 'Headline', video: 'Video', episode: 'Episode', wiki: 'Wikipedia', reddit: 'Thread', artist: 'Artist', photo: 'Photo' };

$('saved-btn').addEventListener('click', () => {
  app.sheet('Saved', (body, close) => {
    const paint = () => {
      const items = store.saved();
      body.innerHTML = '';
      if (!items.length) {
        body.appendChild(el('p', 'empty', 'Nothing saved yet. Tap ★ on anything worth keeping, or swipe a headline right.'));
        return;
      }
      items.forEach((it) => {
        const row = el('div', 'sheet-row');
        const link = el('a');
        const internal = /^#/.test(it.href || '');
        link.href = safeHref(it.href);
        if (!internal) { link.target = '_blank'; link.rel = 'noopener'; }
        link.innerHTML = '<div class="t">' + esc(it.title) + '</div>' +
          '<div class="d">' + esc(KIND_LABEL[it.kind] || 'Saved') +
          (it.from ? ' · ' + esc(it.from) : '') + '</div>';
        if (internal) link.addEventListener('click', close);
        const drop = el('button', 'iconbtn', ICON.x);
        drop.setAttribute('aria-label', 'Remove');
        drop.addEventListener('click', () => { store.toggleSaved(it); paint(); });
        row.append(link, drop);
        body.appendChild(row);
      });
    };
    paint();
  });
});

/* ------------------------------------------------------------ settings */
/* Every source on one screen with a switch each, which is the other way to
   shape the wire — the swipe mutes one thing you are looking at, this is
   where you go when you know what you want gone. */

$('settings-btn').addEventListener('click', () => {
  app.sheet('Settings', (body) => {
    const set = store.settings();

    body.appendChild(el('p', 'eyebrow', 'Appearance'));
    body.appendChild(seg([['auto', 'Follow phone'], ['light', 'Light'], ['dark', 'Dark']],
      store.theme(), (v) => {
        store.setTheme(v);
        window.dispatchEvent(new Event('allday-theme'));
        $('settings-btn').click();      // reopen so the segment repaints
      }));

    const focus = el('div', 'sheet-row');
    focus.innerHTML = '<div><div class="t">Focus</div>' +
      '<div class="d">Hide headlines you have already opened, instead of dimming them</div></div>';
    const sw = el('div', 'sw' + (set.focus ? ' on' : ''));
    sw.setAttribute('role', 'switch');
    sw.setAttribute('tabindex', '0');
    sw.setAttribute('aria-checked', set.focus ? 'true' : 'false');
    const flip = () => {
      const on = !store.settings().focus;
      store.setSetting('focus', on);
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      app.refresh();
    };
    sw.addEventListener('click', flip);
    sw.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    focus.appendChild(sw);
    body.appendChild(focus);

    body.appendChild(el('p', 'eyebrow', 'Sources'));
    const hint = el('p', 'sub');
    hint.style.cssText = 'font-size:.86rem;color:var(--ink-faint);margin:-4px 0 10px';
    hint.textContent = 'Muting a source here hides it in All Day and on the Pulse page too.';
    body.appendChild(hint);

    const holder = el('div');
    body.appendChild(holder);

    const paintSources = (payload) => {
      const muted = store.muted();
      const sources = (Array.isArray(payload?.sources) ? payload.sources : [])
        .slice()
        .sort((a, b) => (a.short || a.name || '').localeCompare(b.short || b.name || ''));
      holder.innerHTML = '';
      if (!sources.length) {
        holder.appendChild(el('p', 'loading', 'Loading sources…'));
        return;
      }
      const mutedCount = sources.filter((s) => muted[s.id]).length;
      hint.textContent = sources.length + ' sources · ' + mutedCount + ' muted. ' +
        'Muting here hides it on the Pulse page too.';
      sources.forEach((s) => {
        const row = el('div', 'sheet-row');
        const on = !muted[s.id];
        row.innerHTML = '<div><div class="t">' + esc(s.short || s.name) + '</div>' +
          '<div class="d">' + esc(s.topic || '') +
          (s.local === 1 || s.topic === 'local' ? ' · local' : '') +
          (s.pod === 1 ? ' · podcast' : '') + '</div></div>';
        const toggle = el('div', 'sw' + (on ? ' on' : ''));
        toggle.setAttribute('role', 'switch');
        toggle.setAttribute('tabindex', '0');
        toggle.setAttribute('aria-checked', on ? 'true' : 'false');
        toggle.setAttribute('aria-label', (s.short || s.name) + ' visible');
        const hit = () => {
          const nowMuted = !store.muted()[s.id];
          store.setMuted(s.id, nowMuted);
          toggle.classList.toggle('on', !nowMuted);
          toggle.setAttribute('aria-checked', nowMuted ? 'false' : 'true');
          app.refresh();
        };
        toggle.addEventListener('click', hit);
        toggle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(); } });
        row.appendChild(toggle);
        holder.appendChild(row);
      });
    };

    data.load('pulse', paintSources, () => {
      holder.innerHTML = '';
      holder.appendChild(el('p', 'empty', 'Sources load with the wire.'));
    });
  });
});

/* --------------------------------------------------------------- welcome */
/* First visit only. Five lines, because someone who has to read a paragraph
   to find out what an app is will close it instead. */
const TOUR = [
  ['Wire', 'Every headline, local and national'],
  ['Reddit', 'What people are posting'],
  ['Watch', 'Video, picked by hand nightly'],
  ['Listen', 'Every Vermont podcast, playable here'],
  ['Music', 'Bands from here, and who’s playing this week'],
  ['Photos', 'Burlington as its neighbours see it'],
  ['Wikipedia', 'A rabbit hole worth falling into'],
];

function welcome() {
  const box = el('div', 'welcome');
  const card = el('div', 'welcome-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'What All Day is');
  card.innerHTML =
    '<p class="eyebrow">Burlington Brief</p>' +
    '<h2>Seven feeds, one app.</h2>' +
    '<ul class="welcome-list">' +
      TOUR.map(([n, d]) =>
        '<li><b>' + esc(n) + '</b><span>' + esc(d) + '</span></li>').join('') +
    '</ul>' +
    '<p class="welcome-local"><i></i>Anything local is green.</p>' +
    /* Swipe is the one thing nobody discovers on their own, and muting is
       the setting that makes the wire yours. Two lines, with the direction
       drawn, beats a paragraph nobody reads. */
    '<p class="welcome-swipe"><em>Swipe any headline:</em>' +
      '<span><b>←</b> mute the outlet</span>' +
      '<span><b>→</b> save it</span>' +
    '</p>';
  const go = el('button', 'btn btn-big', 'Start reading');
  go.addEventListener('click', () => { store.markWelcomed(); box.remove(); });
  card.appendChild(go);
  box.appendChild(card);
  box.addEventListener('click', (e) => {
    if (e.target === box) { store.markWelcomed(); box.remove(); }
  });
  document.body.appendChild(box);
  go.focus();
}

/* ---------------------------------------------------------------- boot */

store.touchVisit();
app.route();
if (store.needsWelcome()) welcome();
