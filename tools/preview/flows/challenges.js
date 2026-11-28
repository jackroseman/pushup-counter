// Dedicated challenges flow for UX review and PR recordings.
// Covers create (each type/length), Your turn on Today and Compete, invites,
// Waiting, detail, finished result, You > Challenges with the period picker,
// a friend's head-to-head page, Rematch into the prefilled create sheet, and empty states.
//
//   npm --prefix tools/preview run capture -- challenges-tour
//   npm --prefix tools/preview run capture -- challenges-empty challenges-none challenges-busy

async function pickLengths({ tap, shot }, kind, labels) {
  for (const label of labels) {
    await tap(label, { label: true, wait: 700 });
    await shot(`new-${kind}-${label.replace(/\s+/g, '-')}`);
  }
}

module.exports = {
  order: 5.4,
  variants: [
    {
      id: 'tour',
      description:
        'Challenges tour: Your turn, invite, Waiting, detail, New challenge types and lengths, You period picker, friend record, finished result, rematch sheet',
      options: { user: 'regular' },
      timeoutMs: 240000,
      run: async (ctx) => {
        const { shot, tap, back } = ctx;

        await shot('today');
        await tap('See all', { wait: 1800 });
        await shot('compete-challenges');

        await tap('Jack invited you', { last: true, wait: 2000 });
        await shot('invite-detail');
        await back();

        await tap('Best set vs Brett', { last: true, wait: 2000 });
        await shot('challenge-detail');
        await back();

        await tap('Team week', { last: true, wait: 2000 });
        await shot('team-detail');
        await back();

        await tap('Best set vs Maya R', { last: true, wait: 2000 });
        await shot('waiting-detail');
        await back();

        await tap('New challenge', { label: true, last: true, wait: 2000 });
        await shot('new-challenge-best-set');
        await pickLengths(ctx, 'best-set', ['1 day', '3 days', '1 week']);

        await tap('Most reps', { last: true, wait: 900 });
        await shot('new-challenge-most-reps');
        await pickLengths(ctx, 'most-reps', ['1 day', '7 days', '14 days', '30 days']);

        await tap('Streak', { last: true, wait: 900 });
        await shot('new-challenge-streak');
        await pickLengths(ctx, 'streak', ['7 days', '14 days', '30 days']);

        await tap('Team', { last: true, wait: 900 });
        await shot('new-challenge-team');
        await pickLengths(ctx, 'team', ['1 day', '7 days', '14 days', '30 days']);

        await tap('Cancel', { wait: 1200 });

        await tap('You', { last: true, wait: 2000 });
        await shot('you-sets');
        await tap('Challenges', { last: true, wait: 1800 });
        await shot('you-challenges');
        await tap('Period: Last 30 days', { label: true, last: true, wait: 800 });
        await shot('you-challenges-period');
        await tap('Period: Last 30 days', { label: true, last: true, wait: 400 });

        await tap('Compete', { last: true, wait: 1800 });
        await tap('Friends', { label: true, last: true, wait: 2000 });
        await tap('Brett', { last: true, wait: 2000 });
        await shot('friend');
        await tap('Period: Last 30 days', { label: true, last: true, wait: 800 });
        await shot('friend-period');
        await tap('Period: Last 30 days', { label: true, last: true, wait: 400 });
        await tap('Most reps today', { last: true, wait: 2000 });
        await shot('finished-result');
        await tap('Rematch', { wait: 2000 });
        await shot('rematch-sheet');
      },
    },
    {
      id: 'empty',
      description: 'Challenge empty states: Today, Compete (no friends), You Challenges with the period picker',
      options: { user: 'empty' },
      run: async ({ shot, tap }) => {
        await shot('today-empty');
        await tap('Compete', { last: true, wait: 2000 });
        await tap('Challenges', { last: true, wait: 1500 });
        await shot('compete-nofriends');
        await tap('You', { last: true, wait: 2000 });
        await shot('you-empty-sets');
        await tap('Challenges', { last: true, wait: 1500 });
        await shot('you-challenges-empty');
        await tap('Period: Last 30 days', { label: true, last: true, wait: 800 });
        await shot('you-challenges-empty-period');
      },
    },
    {
      id: 'none',
      description: 'Compete > Challenges with friends but no open challenges yet (E10)',
      options: { user: 'regular', rpc: { my_challenges: () => [], my_open_challenges: () => [] } },
      run: async ({ shot, tap }) => {
        await tap('Compete', { last: true, wait: 2000 });
        await tap('Challenges', { last: true, wait: 1800 });
        await shot('compete-none');
      },
    },
    {
      id: 'busy',
      description: 'Today and Compete > Challenges with more than three action rows (See all, scrolled list)',
      options: {
        user: 'regular',
        rpc: {
          my_challenges: (args, F) => {
            const { busyChallenges } = require('./challenges-states');
            return args && args.p_battle ? F.challenges.filter((c) => c.id === args.p_battle) : busyChallenges(F);
          },
          my_open_challenges: (_args, F) => {
            const { busyOpen } = require('./challenges-states');
            return busyOpen(F);
          },
        },
      },
      run: async ({ shot, tap, page }) => {
        await shot('today-busy');
        await tap('Compete', { last: true, wait: 2000 });
        await tap('Challenges', { last: true, wait: 1800 });
        await shot('compete-busy');
        await page.evaluate(() =>
          document.querySelectorAll('div').forEach((el) => {
            if (el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight;
          }),
        );
        await page.waitForTimeout(500);
        await shot('compete-busy-scrolled');
      },
    },
  ],
};
