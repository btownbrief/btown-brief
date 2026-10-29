/* Town: living here (APP-MAP.html, app 6). Nothing hosted yet: the City
   Guide pages it takes (changes.html, civic.html, the guides, jobs.html)
   arrive in wave 1. */
export default {
  id: 'town',
  name: 'Town',
  short: 'Town',
  icon: 'town',
  accent: '--app-town',
  href: '../town/',
  url: 'https://guide.btownbrief.com/town/',
  line: 'Living here.',
  tabs: [
    { key: 'alerts', label: 'Alerts', icon: 'bell',
      promise: 'Trash day, parking bans, plows and school delays.',
      top: ['Today', 'Trash & parking', 'Plows', 'Schools', 'Shelters', 'Signups', 'Since you checked'] },
    { key: 'cityhall', label: 'City Hall', icon: 'columns',
      promise: 'Every meeting and vote, in plain English.',
      top: ['Meetings', 'Votes', 'Elections', 'Money', 'Calendar', 'Vote together'] },
    { key: 'streets', label: 'Streets', icon: 'cone',
      promise: 'What’s going in, what’s torn up, and what got fixed.',
      top: ['Going in', 'Torn up', 'Report', 'Sold', 'Blotter', 'Wish list'] },
    { key: 'guides', label: 'Guides', icon: 'book',
      promise: 'Every town guide on one shelf, from restrooms to rent.',
      top: ['Restrooms', 'Playgrounds', 'Study spots', 'Teens', 'Dogs', 'Seniors', 'EV', 'Libraries', 'New here', 'Help',
        'Childcare', 'Schools', 'Rent', 'Vets', 'Who to call', 'Wiki'] },
    { key: 'work', label: 'Work', icon: 'briefcase',
      promise: 'Who’s hiring, local shops, and help for businesses.',
      top: ['Jobs', 'Who’s hiring', 'Shops', 'Businesses', 'Get a website', 'Tees for your team', 'Sponsor'] },
  ],
};
