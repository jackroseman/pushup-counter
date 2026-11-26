// First run on a fresh phone: Welcome -> Pick a daily goal -> How it works -> Today.
module.exports = {
  order: 7,
  description: 'First run: Welcome, Pick a daily goal, How it works, then Today (signed out, no data)',
  options: { user: 'new' },
  run: async ({ shot, tap }) => {
    await shot('welcome');
    await tap('Get started', { wait: 1500 });
    await shot('pick-goal');
    await tap('50 a day', { wait: 800 });
    await shot('pick-goal-selected');
    await tap('Continue', { wait: 1500 });
    await shot('how-it-works');
    await tap('Maybe later', { wait: 2500 });
    await shot('today');
  },
};
