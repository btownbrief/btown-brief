/* Play: the arcade, the city game, the drawing world and the boards
   (APP-MAP.html, app 7). Games is hosted on Arcade as it is; wave 1
   (2026-10-29) built the other five as modes: js/modes/play-*.js, each
   behind a one-line entry file named for its route key (daily.js, …). */
export default {
  id: 'play',
  name: 'Play',
  short: 'Play',
  icon: 'games',
  accent: '--app-play',
  href: '../play/',
  url: 'https://guide.btownbrief.com/play/',
  line: 'The arcade, the city game, the drawing world and the boards.',
  tabs: [
    { mode: 'games', label: 'Arcade', top: ['New', 'Sections', 'Champs', 'Challenge a neighbor', 'Out in Burlington'] },
    { mode: 'daily', label: 'Daily', icon: 'calcheck', top: ['Wordle', 'Crossings', 'News quiz', 'Higher or lower', 'Where in Btown', 'Real or fake'] },
    { mode: 'city', label: 'City', icon: 'flag', top: ['Missions', 'Streets', 'Lit', 'Dibs', 'Photo quests', 'Crews', 'Season'] },
    { mode: 'draw', label: 'Draw', icon: 'pencil', top: ['Aquarium', 'The truck', 'Gallery', 'Prompt of the week'] },
    { mode: 'party', label: 'Party', icon: 'party', top: ['Btown Party', 'Trivia', 'Arcade Night', 'Stay Awhile', 'Table Talk'] },
    { mode: 'boards', label: 'Boards', icon: 'trophy', top: ['Leaderboards', 'Predictions', 'Bracket', 'Playing', 'Looking for a group', 'Gamertags'] },
  ],
  full: { games: ['https://play.btownbrief.com/', 'the BTown Games arcade'] },
};
