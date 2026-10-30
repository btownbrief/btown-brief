/* Eat: where to eat right now, what's new, what's closing, the dinner club
   (APP-MAP.html, app 3). Wave 1 (2026-10-29) built every tab.

   A tab's route is its file's name (app.js reads letters only), so the
   tabs live in js/modes/deals.js, new.js, bites.js, market.js and
   dinner.js, and what they share in js/modes/eat-*.js. Open now keeps the
   `food` route, so a restaurant link from any app (#food/r-<id>) still
   lands here: in this app js/modes/eat-open.js registers Eat's own Open
   now under that key, after food.js has loaded. All Day's Food is
   unchanged. */
export default {
  id: 'eat',
  name: 'Eat',
  short: 'Eat',
  icon: 'food',
  accent: '--app-eat',
  href: '../eat/',
  url: 'https://guide.btownbrief.com/eat/',
  line: 'Where to eat right now, what’s new, what’s closing, and the dinner club.',
  tabs: [
    { mode: 'food', label: 'Open now', top: ['Open now', 'Randomizer', 'Inspections'] },
    { mode: 'deals', label: 'Deals', icon: 'tag', top: ['Today', 'Happy hour', 'Under $10'] },
    { mode: 'new', label: 'New', icon: 'spark',
      top: ['Just opened', 'Coming soon', 'Closing soon', 'Closed', 'Last month', 'Reminisce'] },
    { mode: 'bites', label: 'Bites', icon: 'bowl',
      top: ['Weekly Bite', 'In their own words', 'Photos', 'Menus', 'Asked on Reddit'] },
    { mode: 'market', label: 'Market', icon: 'basket', top: ['This week', 'In season', 'Farms', 'Fridge', 'Rescue'] },
    { mode: 'dinner', label: 'Dinner Club', icon: 'table',
      top: ['Next dinner', 'Sign up', 'Past dinners', 'Host a table', 'Restaurants'] },
  ],
  full: { food: ['../restaurants.html', 'the full restaurant guide'] },
};
