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
import * as wander from './modes/wander.js';

app.register('wire', wire);
app.register('reddit', reddit);
app.register('watch', watch);
app.register('listen', listen);
app.register('wander', wander);

const $ = (id) => document.getElementById(id);

$('saved-btn').innerHTML = ICON.star;
$('settings-btn').innerHTML = ICON.gear;

/* --------------------------------------------------------------- saved */

const KIND_LABEL = { wire: 'Headline', video: 'Video', episode: 'Episode', wiki: 'Wikipedia', reddit: 'Thread' };

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

/* ---------------------------------------------------------------- boot */

store.touchVisit();
app.route();
