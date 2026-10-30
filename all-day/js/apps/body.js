/* Body: the daily template (APP-MAP.html, app 5). Wave 1 (2026-10-29):
   Today is the habits tracker, hosted in the Today cell beside Stephen's
   template (modes/template.js, the way All Day hosts Habits under The
   Build); the other five tabs are built (modes/train.js, recover.js,
   fuel.js, coach.js, together.js, sharing modes/body-kit.js). */
export default {
  id: 'body',
  name: 'Body',
  short: 'Body',
  icon: 'body',
  accent: '--app-body',
  href: '../body/',
  url: 'https://guide.btownbrief.com/body/',
  line: 'Your daily template, for you first and then for anyone who wants it.',
  tabs: [
    { mode: 'template', label: 'Today', icon: 'habits', top: ['Habits', 'Template', 'Forests', 'Season', 'Wall'] },
    { mode: 'train', label: 'Train', icon: 'dumbbell',
      top: ['Gyms', 'Beginner', 'Intermediate', 'Hardcore', 'Sprints', 'Log', 'Book Stephen'] },
    { mode: 'recover', label: 'Recover', icon: 'leaf',
      top: ['Stretch', 'Yoga', 'Roll', 'Sauna & cold', 'Breathe', 'Sleep'] },
    { mode: 'fuel', label: 'Fuel', icon: 'drop',
      top: ['Water', 'Protein', 'Calories', 'Basics', 'Supplements', 'Less of'] },
    { mode: 'coach', label: 'Coach', icon: 'comment',
      top: ['How I do it', 'Capture', 'Chat'] },
    { mode: 'together', label: 'Together', icon: 'people',
      top: ['Run clubs', 'Fitness this week', 'Work out', 'Recover', 'Adult Social Sports'] },
  ],
  hosted: { habits: 'template' },
};
