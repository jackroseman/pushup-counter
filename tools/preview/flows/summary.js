// A longer set that beats the best set, then the summary, Set details and All sets.
module.exports = {
  order: 4,
  description: '38-rep set (a new best), summary, Set details, All sets',
  options: { user: 'regular' },
  run: async ({ shot, tap, waitFor, doReps }) => {
    await tap(/^(Start a set|Start another set)$/, { wait: 500 });
    await waitFor('End set', 30000);
    await doReps(38, 900);
    await tap('End set', { wait: 3200 });
    await shot('summary-new-best');
    await tap('Set details', { wait: 2000 });
    await shot('set-details');
    await tap('Back', { label: true, last: true, wait: 1500 });
    await tap('Done', { wait: 2000 });
    await tap('You', { last: true, wait: 2000 });
    await tap('See all', { wait: 2000 });
    await shot('all-sets');
  },
};
