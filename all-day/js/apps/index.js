/* apps/index.js — the three Btown apps, one config each: All Day, Body, Town.

   One codebase, three folders. Each folder's index.html names its app on
   <html data-app="town"> and, but for All Day's, points <base> at /all-day/,
   so every app loads this same shell, the same modes and the same data paths.
   app.js reads the config of the app it is in; the switcher reads all three.

   A config, one file per app in this folder:

     id       the folder: 'town' is guide.btownbrief.com/town/
     name     the mast's wordmark, the wide rail, the page title
     short    the home-screen label (the manifest's short_name)
     icon     the app's glyph, an ICON key from ui.js
     accent   its colour token in tokens.css (the switcher tile, the icon);
              the mast takes the app's own --lake there too
     href     the folder, relative to /all-day/ (the <base> every app shares)
     url      the folder on the live site, for share links
     line     the app's one line, under its name in the switcher
     tabs     the bottom bar, in its fixed order: five to seven
       { mode: 'feed', label: 'Now', icon, top }
                hosts a mode that exists. The route is the mode's own key
                (#feed/<key>), because a mode links to itself by it. label
                and icon override the mode's own for this app only.
       { key: 'later', label, icon, promise, top, mixed }
                a tab whose mode is not built yet: the shell draws its
                promise (live) or a demo of it (?demo=1), never a blank.
                key is lowercase letters only (#later/<key>).
       top      the top tabs inside it, in page order
       mixed    the tab mixes doing and reading: the Real life / Online
                toggle shows on it, and sections tagged irl or online
                follow it
     hosted   { key: hostKey }: a tab with no cell of its own that lives
              inside another's (Body's Habits, under its template tab)
     full     { key: [href, what] }: the tab's full page on the guide
     nine     All Day only: its nine tabs are allowed */

import allDay from './all-day.js';
import body from './body.js';
import town from './town.js';

/* the switcher's order */
export const APPS = [allDay, body, town];

/* a tab's route key: the mode it hosts, or its own key */
export const keyOf = (t) => t.mode || t.key;

/* What is wrong with a config, as a list of plain sentences; empty when it
   is fine. The shell logs these and still runs; the tests fail on them. */
export function problems(cfg) {
  const out = [];
  if (!cfg || typeof cfg !== 'object') return ['no config'];
  ['id', 'name', 'short', 'icon', 'accent', 'href', 'url'].forEach((f) => { if (!cfg[f]) out.push(cfg.id + ': no ' + f); });
  const tabs = Array.isArray(cfg.tabs) ? cfg.tabs : [];
  const n = tabs.length;
  if (cfg.nine ? n !== 9 : n < 5 || n > 7) out.push(cfg.id + ': ' + n + ' bottom tabs (five to seven)');
  const seen = new Set();
  tabs.forEach((t, i) => {
    const k = keyOf(t);
    if (!k || !/^[a-z]+$/.test(k)) out.push(cfg.id + ': tab ' + i + ' has no lowercase key');
    if (seen.has(k)) out.push(cfg.id + ': ' + k + ' twice');
    seen.add(k);
    if (!t.mode && !(t.label && t.icon && t.promise)) out.push(cfg.id + ': ' + k + ' needs a label, an icon and a promise');
    if (t.top && (!Array.isArray(t.top) || !t.top.length)) out.push(cfg.id + ': ' + k + ' has an empty top');
  });
  Object.entries(cfg.hosted || {}).forEach(([k, host]) => {
    if (seen.has(k)) out.push(cfg.id + ': hosted ' + k + ' is also a tab');
    if (!seen.has(host)) out.push(cfg.id + ': ' + k + ' is hosted by ' + host + ', which is not a tab');
  });
  return out;
}

/* the app this page is: <html data-app="…">, All Day when none */
export function current() {
  const id = (document.documentElement.dataset.app || 'all-day').trim();
  return APPS.find((a) => a.id === id) || allDay;
}
