// Empty states: signed in but no sets, no goal, no friends yet.
module.exports = {
  order: 8,
  description: 'Empty states: Today, Compete and You for a signed-in user with no data',
  options: { user: 'empty' },
  run: async ({ shot, tap }) => {
    await shot('today-empty');
    await tap('Compete', { last: true, wait: 2000 });
    await shot('compete-empty');
    await tap('Challenges', { last: true, wait: 1500 });
    await shot('challenges-empty');
    await tap('You', { last: true, wait: 2000 });
    await shot('you-empty');
  },
};
