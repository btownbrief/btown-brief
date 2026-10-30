/* Town: living here (APP-MAP.html, app 6). Wave 1 (2026-10-29) built all
   five tabs as modes, one file each in js/modes/ named by the tab's key
   (main.js loads modes/<key>.js), sharing js/modes/town-kit.js:

     alerts    Since You Checked's log, your street's recycling day and
               parking-ban zone, plows, school closings, shelters, signups
     cityhall  the civic calendar, votes, Town Meeting Day 2027, taxes and
               the budget, watch parties from People's board
     streets   notable permits, construction projects, the street-report
               board, the 60-day sold list, the blotter's counts
     guides    the City Guide's guide pages, a first-30-days checklist,
               and the guides still to come
     work      jobs by day, who's hiring, shops open now, and the business
               forms (which write nowhere yet)

   Streets keeps the centre cell, where the switcher's hold lives. */
export default {
  id: 'town',
  name: 'Town',
  short: 'Town',
  icon: 'town',
  accent: '--app-town',
  href: '../town/',
  url: 'https://guide.btownbrief.com/town/',
  line: 'Living here: alerts, city hall, the streets, the guides, and work.',
  tabs: [
    { mode: 'alerts', label: 'Alerts', icon: 'bell',
      top: ['Today', 'Trash & parking', 'Plows', 'Schools', 'Shelters', 'Signups'] },
    { mode: 'cityhall', label: 'City Hall', icon: 'columns',
      top: ['Meetings', 'Votes', 'Elections', 'Money', 'Vote together'] },
    { mode: 'streets', label: 'Streets', icon: 'cone',
      top: ['Going in', 'Torn up', 'Report', 'Sold', 'Blotter', 'Wish list'] },
    { mode: 'guides', label: 'Guides', icon: 'book',
      top: ['All guides', 'New here', 'Local news', 'Help', 'Childcare', 'Schools', 'Rent', 'Vets', 'Who to call', 'Wiki'] },
    { mode: 'work', label: 'Work', icon: 'briefcase',
      top: ['Jobs', 'Who’s hiring', 'Shops', 'Businesses', 'Get a website', 'Tees for your team', 'Sponsor'] },
  ],
};
