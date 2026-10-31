/* main.js — the entry point. Imports the shell, then the modes this app
   hosts (each calls app.register() as it loads), gives every tab whose mode
   is not built yet its shelf, then starts the router.

   Which modes load is the app's config (js/apps/<id>.js, through
   app.modes()): All Day's nine, Town's seven, Body's six and the modes it
   hosts. They load side by side, and start() waits for all of them, so
   every register() has run before the first route. A mode that fails to
   load is logged and its tab becomes a shelf with its promise, so one
   broken file can never take the whole app down. The tab bar's order is
   the config's, not the order the modes arrive in. */

import * as app from './app.js';
/* boards.js wires the board cards' buttons and Settings → Your account,
   so it loads before any tab that draws a board. */
import './boards.js';
/* account-data.js deletes Habits' and The Build's server data with the
   account in the apps that don't load those modes */
import './account-data.js';
import { shelf } from './shelf.js';
import { keyOf } from './apps/index.js';

const names = app.modes();
const loaded = await Promise.allSettled(names.map((m) => import('./modes/' + m + '.js')));
loaded.forEach((r, i) => { if (r.status === 'rejected') console.error('[all-day] mode ' + names[i] + ' did not load', r.reason); });

app.APP.tabs.forEach((t) => {
  const key = keyOf(t);
  if (!app.registered(key)) app.register(key, shelf({ promise: '', ...t, key, label: t.label || key, icon: t.icon || 'more' }, app.APP));
});

app.start();
