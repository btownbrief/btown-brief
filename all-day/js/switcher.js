/* switcher.js — the eight apps from the mast, and the home-screen card
   (wave 0, 2026-10-29; the map: "an app switcher in the mast: the eight
   icons, so you hop between apps without the hub", and "the
   add-to-home-screen button and a 'how to bookmark this' card live in
   every mast").

   One small button beside the wordmark (and beside the app's name on a
   wide screen's rail) opens a sheet: the eight apps as icons, this one
   marked, each a plain link to its folder; under them, this app's own
   home-screen card. Each app has its own manifest, name and icon, so each
   goes on the home screen as its own app. The card uses the browser's own
   install prompt where it offers one (Chrome on Android, Edge, desktop
   Chrome); elsewhere "How to add it" opens the short sheet with the
   iPhone and the Android steps, and the keys that bookmark it on a
   computer. */

import { el, esc, ICON, button } from './ui.js';
import { APPS } from './apps/index.js';
import * as asks from './asks.js';

let S = { sheet: null, toast: () => {}, app: null, demo: false };
export function bind(o) { S = { ...S, ...o }; }

/* the button: 'mast' sits after the wordmark, 'rail' after the rail's name */
export function button_(where) {
  const b = el('button', 'iconbtn appsbtn', ICON.apps);
  b.type = 'button';
  b.dataset.apps = where;
  b.setAttribute('aria-label', 'All Btown apps');
  b.setAttribute('aria-haspopup', 'dialog');
  b.addEventListener('click', open);
  return b;
}
export { button_ as button };

/* an app's tile: its glyph on its own colour */
export function tile(a, cls) {
  return '<span class="apptile' + (cls ? ' ' + cls : '') + '" style="--tile:var(' + a.accent + ');--tile-pop:var(' + a.accent + '-pop)">' + (ICON[a.icon] || ICON.grid) + '</span>';
}

export function open() {
  if (!S.sheet) return;
  const me = S.app || APPS[0];
  S.sheet('Btown apps', (body) => {
    body.classList.add('apps-sheet');
    const grid = el('div', 'appgrid');
    APPS.forEach((a) => {
      const here = a.id === me.id;
      const link = el('a', 'appcell' + (here ? ' on' : ''), tile(a) + '<span class="appname">' + esc(a.short) + '</span>');
      /* the folder, relative to the shared <base>; the demo stays a demo */
      link.href = a.href + (S.demo ? '?demo=1' : '');
      link.dataset.app = a.id;
      if (here) { link.setAttribute('aria-current', 'page'); link.setAttribute('aria-label', a.name + ', you are here'); }
      grid.appendChild(link);
    });
    body.appendChild(grid);
    body.appendChild(installCard(me));
  });
}

/* This app on the home screen: the browser's own button where it has one,
   else the two taps for this phone, and the full how-to a tap away. */
export function installCard(a) {
  const c = el('div', 'installcard');
  c.dataset.install = a.id;
  c.innerHTML = tile(a, 'sm') + '<div class="ic-words"><b>' + esc(asks.installed() ? a.name + ' is on your home screen' : 'Put ' + a.name + ' on your home screen') + '</b></div>';
  const row = el('div', 'ic-row');
  if (!asks.installed()) {
    if (asks.canPrompt()) row.appendChild(button(ICON.plus + ' Add to home screen', 'sm', () => asks.promptInstall()));
    else row.appendChild(asks.howTo());
  }
  const how = button('How to bookmark this', 'ghost sm', () => howSheet(a));
  how.dataset.howto = '1';
  row.appendChild(how);
  c.appendChild(row);
  return c;
}

/* the short sheet: iPhone, Android, a computer; this phone's first */
export function howSheet(a) {
  if (!S.sheet) return;
  const steps = {
    iphone: ['iPhone', [[ICON.share, 'Tap Share in Safari'], [ICON.plus, 'Tap Add to Home Screen'], [ICON.check, 'Tap Add']]],
    android: ['Android', [[ICON.more, 'Tap the menu in Chrome'], [ICON.home, 'Tap Add to Home screen'], [ICON.check, 'Tap Install or Add']]],
    computer: ['A computer', [[ICON.star, (asks.isMac() ? 'Press ⌘ D' : 'Press Ctrl D') + ' to bookmark it']]],
  };
  const order = asks.isIOS() ? ['iphone', 'android', 'computer'] : asks.isAndroid() ? ['android', 'iphone', 'computer'] : ['computer', 'iphone', 'android'];
  S.sheet('Keep ' + a.name + ' handy', (body) => {
    body.classList.add('howto-sheet');
    order.forEach((k) => {
      const [name, list] = steps[k];
      const box = el('div', 'howto');
      box.dataset.platform = k;
      box.appendChild(el('div', 'sheet-h', esc(name)));
      const ol = el('ol', 'howto-steps');
      list.forEach(([icon, words]) => ol.appendChild(el('li', null, '<span class="ask-key">' + icon + '</span><span>' + esc(words) + '</span>')));
      box.appendChild(ol);
      body.appendChild(box);
    });
  });
}
