// You tab (profile, records, recent sets) and Settings.
module.exports = {
  order: 6,
  description: 'You tab and Settings',
  options: { user: 'regular' },
  run: async ({ shot, tap }) => {
    await tap('You', { last: true, wait: 2000 });
    await shot('you');
    await tap('Challenges', { last: true, wait: 1800 });
    await shot('you-challenges');
    await tap('Settings', { label: true, last: true, wait: 2000 });
    await shot('settings');
  },
};
