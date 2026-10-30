/* The Paper: the news outlet and the front door (APP-MAP.html, app 8).
   Wave 1 (2026-10-29): every tab is built (js/modes/paper-*.js); the top
   tabs are in page order. */
export default {
  id: 'paper',
  name: 'The Paper',
  short: 'The Paper',
  icon: 'paper',
  accent: '--app-paper',
  href: '../paper/',
  url: 'https://guide.btownbrief.com/paper/',
  line: 'The news outlet and the front door.',
  tabs: [
    { mode: 'front', label: 'Front', icon: 'paper',
      top: ['Today', 'Questions', 'The edition', 'Picks'] },
    { mode: 'editions', label: 'Editions', icon: 'stack',
      top: ['Latest', 'By date', 'By interest', 'Search', 'This week last year', 'Random', 'Ask'] },
    { mode: 'picks', label: 'Picks', icon: 'star',
      top: ['Stephen’s picks', 'Best of', 'This month', 'Spotlight'] },
    { mode: 'gossip', label: 'Gossip', icon: 'comment',
      top: ['This week', 'Threads', 'Archive'] },
    { mode: 'everything', label: 'Everything', icon: 'grid',
      top: ['Apps', 'Pages', 'Games', 'A to Z', 'Start here'] },
    { mode: 'story', label: 'Story', icon: 'heart',
      top: ['Mission', 'About', 'Merch', 'Support', 'How I live'] },
  ],
};
