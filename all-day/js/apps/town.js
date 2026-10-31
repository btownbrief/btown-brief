/* Town: living here (APP-MAP.html, app 6). Wave 1 (2026-10-29) built the
   tabs as modes, one file each in js/modes/ named by the tab's key
   (main.js loads modes/<key>.js), sharing js/modes/town-kit.js:

     feed      everything that changed, one feed, newest first: home sales
               with Guess the price, permits, meetings, road work, food, jobs
     alerts    Since You Checked's log, your street's recycling day and
               parking-ban zone, plows, school closings, shelters, signups
     cityhall  the civic calendar, votes, Town Meeting Day 2027, taxes and
               the budget, watch parties from People's board
     streets   notable permits, construction projects, the street-report
               board, the 60-day sold list, the blotter's counts
     square    the Wire's Square, the same code (modes/square.js hosts
               modes/wire-square.js); All Day's Wire stays home for #wire
     guides    the City Guide's guide pages, a first-30-days checklist,
               and the guides still to come
     work      jobs by day and who's hiring

   Streets keeps the centre cell, where the switcher's hold lives. */
export default {
  id: 'town',
  name: 'Town',
  short: 'Town',
  icon: 'town',
  accent: '--app-town',
  href: '../town/',
  url: 'https://guide.btownbrief.com/town/',
  line: 'What changed where you live.',
  tabs: [
    { mode: 'feed', label: 'Now', icon: 'spark' },
    { mode: 'alerts', label: 'Alerts', icon: 'bell',
      top: ['Today', 'Trash & parking', 'Plows', 'Schools', 'Shelters', 'Signups'] },
    { mode: 'cityhall', label: 'City Hall', icon: 'columns',
      top: ['Meetings', 'Votes', 'Elections', 'Money', 'Vote together'] },
    { mode: 'streets', label: 'Streets', icon: 'cone',
      top: ['Going in', 'Torn up', 'Report', 'Sold', 'Blotter'] },
    { mode: 'square', label: 'Square', icon: 'people' },
    { mode: 'guides', label: 'Guides', icon: 'book',
      top: ['All guides', 'New here', 'Local news'] },
    { mode: 'work', label: 'Jobs', icon: 'briefcase',
      top: ['Jobs', 'Who’s hiring'] },
  ],
};
