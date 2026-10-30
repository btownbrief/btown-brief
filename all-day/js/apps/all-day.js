/* All Day: the feed (APP-MAP.html, app 1). Wave 1 (2026-10-29) gives it
   the map's five tabs: Today, the front page across all eight apps, then
   the Wire and the media. Food, People, What Now, The Build with Habits,
   and Games moved to their own apps (Eat, People, Out, Body, Play); an old
   link to one of them (#food/<key>, #people/<key>, …) opens in the app that
   has it now, by the shell's cross-app rule (app.js elsewhere()). */
export default {
  id: 'all-day',
  name: 'All Day',
  short: 'All Day',
  icon: 'wire',
  accent: '--app-all-day',
  href: '../all-day/',
  url: 'https://guide.btownbrief.com/all-day/',
  line: 'Everything, one place, all day.',
  tabs: [
    { mode: 'today', label: 'Today', icon: 'sun', top: ['What matters', 'Tonight', 'Open now', 'Open plans', 'Your habits'] },
    { mode: 'wire' },
    { mode: 'watch' },
    { mode: 'onair' },
    { mode: 'vintage' },
  ],
  /* each tab's full page on the guide, where one exists */
  full: {
    wire: ['../pulse.html', 'The Pulse, the full news page'],
  },
};
