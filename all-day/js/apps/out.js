/* Out: tonight and this weekend, in real life (APP-MAP.html, app 2). */
export default {
  id: 'out',
  name: 'Out',
  short: 'Out',
  icon: 'out',
  accent: '--app-out',
  href: '../out/',
  url: 'https://guide.btownbrief.com/out/',
  line: 'Tonight and this weekend, in real life.',
  tabs: [
    { mode: 'whatnow', label: 'Now', top: ['Spin', 'Missions', 'Tonight', 'Weather'] },
    /* wave 1 (2026-10-29): the map's lanes as top tabs, the online side, Been there, Submit */
    { mode: 'events', label: 'Events', icon: 'calendar', mixed: true,
      top: ['This weekend', 'Live music', 'Open mics', 'Galleries', 'Free', 'Family', 'Outdoors', 'Civic', 'Nightlife', 'Online', 'Been there', 'Submit'] },
    { mode: 'nightlife', label: 'Nightlife', icon: 'moon', top: ['Open tonight', 'Happy hours', 'Mixers'] },
    { mode: 'sports', label: 'Sports', icon: 'ball', top: ['Pickup', 'Leagues', 'Game day', 'Adult Social Sports'] },
    { mode: 'explore', label: 'Explore', icon: 'pin', top: ['Walks', 'Then', 'Conditions', 'Dog parks'] },
  ],
  full: {
    whatnow: ['../things-to-do.html', 'the full things-to-do guide'],
    events: ['../events.html', 'the full events calendar'],
    sports: ['../sports.html', 'every team’s schedule'],
  },
};
