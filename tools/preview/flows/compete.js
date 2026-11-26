// Compete tab: league board and its explainer, challenges list, a challenge, the New challenge sheet.
module.exports = {
  order: 5,
  description: 'League board, How the league works, Challenges, a challenge, New challenge sheet',
  options: { user: 'regular' },
  run: async ({ shot, tap, back }) => {
    await tap('Compete', { last: true, wait: 2000 });
    await shot('league');
    await tap('How the league works', { label: true, last: true, wait: 1500 });
    await shot('league-info');
    await tap('Close', { label: true, last: true, wait: 1200 });
    await tap('Challenges', { last: true, wait: 1800 });
    await shot('challenges');
    await tap('Most reps this week', { last: true, wait: 2000 });
    await shot('challenge-detail');
    await back();
    await tap('New challenge', { label: true, last: true, wait: 2000 });
    await shot('new-challenge');
  },
};
