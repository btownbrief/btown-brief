/* Body: the day as tiles you tap (modes/day.js), then the tools behind them:
   Habits with the season, the template and The Build (modes/template.js holds
   that switch), Train, Leagues, Recover and Fuel. */
export default {
  id: 'body',
  name: 'Body',
  short: 'Body',
  icon: 'body',
  accent: '--app-body',
  href: '../body/',
  url: 'https://guide.btownbrief.com/body/',
  line: 'Your day, one tap at a time.',
  tabs: [
    { mode: 'day', label: 'Today', icon: 'habits' },
    { mode: 'template', label: 'Habits', icon: 'check', top: ['Habits', 'Season', 'Template', 'Build'] },
    { mode: 'train', label: 'Train', icon: 'dumbbell',
      top: ['Gyms', 'Beginner', 'Intermediate', 'Hardcore', 'Sprints', 'Log'] },
    { mode: 'leagues', label: 'Leagues', icon: 'ball' },
    { mode: 'recover', label: 'Recover', icon: 'leaf',
      top: ['Stretch', 'Yoga', 'Roll', 'Sauna & cold', 'Breathe', 'Sleep'] },
    { mode: 'fuel', label: 'Fuel', icon: 'drop',
      top: ['Water', 'Protein', 'Calories', 'Basics', 'Supplements', 'Less of'] },
  ],
  hosted: { habits: 'template', season: 'template', build: 'template' },
};
