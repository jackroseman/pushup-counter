// Today tab for a returning user part-way through today's goal.
module.exports = {
  order: 1,
  description: 'Today tab: signed in, 22 of 50 done, league and challenge cards',
  options: { user: 'regular' },
  run: async ({ shot }) => {
    await shot('today');
  },
};
