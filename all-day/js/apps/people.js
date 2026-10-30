/* People: find your people (APP-MAP.html, app 4). Wave 1 (2026-10-29):
   the People mode (people.js) is hosted whole on You, as it was; each other
   tab is its own mode (plans.js, clubs.js, dating.js, neighbors.js, pets.js,
   talk.js), built on the same boards, club week and calendar, with what
   they share in modes/people-kit.js. A row that belongs to You still opens
   there (#people/<key>). */
export default {
  id: 'people',
  name: 'People',
  short: 'People',
  icon: 'people',
  accent: '--app-people',
  href: '../people/',
  url: 'https://guide.btownbrief.com/people/',
  line: 'Find your people.',
  tabs: [
    { mode: 'people', label: 'You', icon: 'user', top: ['Who you are', 'Interests', 'Your profile', 'Directory'] },
    { mode: 'plans', label: 'Plans', icon: 'calendar', top: ['Open to strangers', 'This week', 'Mine', 'Down for Meetup'] },
    { mode: 'clubs', label: 'Clubs', icon: 'flag', top: ['Every club', 'Run clubs', 'Start something', 'Wanted', 'Musicians'] },
    { mode: 'dating', label: 'Dating', icon: 'heart', mixed: true, top: ['Singles', 'Friends', 'Events', 'Pitch a friend', 'Posts'] },
    { mode: 'neighbors', label: 'Neighbors', icon: 'hand', top: ['Borrow', 'Free', 'Favor', 'Lost & found', 'Shifts'] },
    { mode: 'pets', label: 'Pets', icon: 'paw', top: ['Dog parks', 'Meetups', 'Lost', 'Vets'] },
    { mode: 'talk', label: 'Talk', icon: 'comment', top: ['Telegram', 'Community', 'Ask a regular'] },
  ],
  full: { people: ['../clubs.html', 'every club, league and pickup game'] },
};
