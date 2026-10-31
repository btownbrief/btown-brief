/* All Day: the feed. Its nine tabs are the ones the live app has had since
   2026-10-21, in the same order, so /all-day/ is unchanged by the move to
   per-app configs (wave 0, 2026-10-29). It is the one app allowed more than
   seven (`nine: true`). */
export default {
  id: 'all-day',
  name: 'All Day',
  short: 'All Day',
  icon: 'wire',
  accent: '--app-all-day',
  href: '../all-day/',
  url: 'https://guide.btownbrief.com/all-day/',
  line: 'Everything, one place, all day.',
  nine: true,
  /* What Now sits fifth of nine, dead centre, in the one wider cell */
  tabs: [
    { mode: 'wire' },
    { mode: 'watch' },
    { mode: 'food' },
    { mode: 'people' },
    { mode: 'whatnow' },
    { mode: 'vintage' },
    { mode: 'social' },
    { mode: 'onair' },
    { mode: 'games' },
  ],
  hosted: { reddit: 'social' },
  /* The Build and Habits moved to Body on 2026-10-30, and the Reddit tab took
     their cell. Their old links land in Body (app.js sends a tab this app
     doesn't have to the app that does). */
  /* each tab's full page on the guide, where one exists */
  full: {
    wire: ['../pulse.html', 'The Pulse, the full news page'],
    food: ['../restaurants.html', 'the full restaurant guide'],
    people: ['../clubs.html', 'every club, league and pickup game'],
    whatnow: ['../things-to-do.html', 'the full things-to-do guide'],
    games: ['https://play.btownbrief.com/', 'the BTown Games arcade'],
  },
};
