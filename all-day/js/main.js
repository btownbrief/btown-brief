/* main.js — the entry point. Imports the shell, then the nine tabs (each one
   calls app.register() as it loads), then starts the router.

   Modules make the boot order deterministic: app.js has evaluated before any
   tab imports it, and every register() has run before start() routes. The
   tab bar's order is TABS in app.js, not the order of these lines. */

import * as app from './app.js';
/* boards.js wires the board cards' buttons and Settings → Your account,
   so it loads before any tab that draws a board. */
import './boards.js';

import './modes/wire.js';
import './modes/watch.js';
import './modes/food.js';
import './modes/people.js';
import './modes/whatnow.js';
import './modes/vintage.js';
import './modes/habits.js';
import './modes/build.js';
import './modes/onair.js';
import './modes/games.js';

app.start();
