// Challenges in the states a UX review needs: lots of "your move" rows, a long Finished list,
// a friend's page with the head-to-head record, and a finished challenge. Run one with e.g.
// `capture -- challenges-states-busy`. The extra challenges are built on top of the default fixtures.
const { isoTime, DAY } = require('../mock/fixtures');

// Extra challenges for the "busy" user: three more best sets waiting on you, a pending invite you
// sent, and a run of finished challenges (won, lost, draw, team goal, cancelled).
function busyChallenges(F) {
  const person = (n) => F.challenges[0].participants.concat(F.challenges[1].participants).find((p) => p.displayName === n);
  const base = F.challenges[1];
  const you = F.challenges[1].participants.find((p) => p.isMe);
  const bestSet = (id, who, theirReps) => ({
    ...base, id, createdBy: who.userId, startsAt: isoTime(F.now - 5 * 3600000), endsAt: isoTime(F.now + (3 + theirReps % 20) * 3600000),
    participants: [{ ...you, validReps: null, attemptsUsed: 0, rank: null }, { ...who, status: 'accepted', isMe: false, attemptsUsed: 1, validReps: theirReps, rank: 1, isWinner: false, metricValue: null, avgDepthPct: null, tempoScore: null }],
  });
  const done = (id, kind, daysAgo, myReps, theirReps, who, extra = {}) => ({
    ...F.challenges[5], id, kind, windowUnit: kind === 'best_set' ? null : 'week', durationS: kind === 'best_set' ? 60 : null,
    startsAt: isoTime(F.now - (daysAgo + 7) * DAY), endsAt: isoTime(F.now - daysAgo * DAY), finishedAt: isoTime(F.now - daysAgo * DAY),
    participants: [
      { ...you, validReps: myReps, rank: myReps >= theirReps ? 1 : 2, isWinner: myReps >= theirReps, attemptsUsed: 1 },
      { ...who, status: 'accepted', isMe: false, attemptsUsed: 1, validReps: theirReps, rank: myReps >= theirReps ? 2 : 1, isWinner: theirReps >= myReps, metricValue: null, avgDepthPct: null, tempoScore: null },
    ],
    ...extra,
  });
  const jack = person('Jack');
  const maya = person('Maya R') || person('Maya');
  const brett = person('Brett');
  const mk = (p) => (p ? { userId: p.userId, username: p.username, displayName: p.displayName } : { userId: 'x', username: 'x', displayName: 'X' });
  return [
    ...F.challenges.filter((c) => c.id !== 'c-done'),
    bestSet('c-turn-2', mk(jack), 33),
    bestSet('c-turn-3', mk(maya || brett), 25),
    bestSet('c-turn-4', mk(brett), 41),
    done('c-d1', 'total', 3, 74, 61, mk(brett)),
    done('c-d2', 'best_set', 6, 29, 35, mk(jack)),
    done('c-d3', 'total', 10, 410, 388, mk(maya || brett)),
    done('c-d4', 'total', 13, 300, 300, mk(jack)),
    done('c-d5', 'best_set', 20, 31, 22, mk(brett)),
    done('c-d6', 'total', 27, 150, 190, mk(jack)),
    done('c-d7', 'best_set', 41, 40, 37, mk(maya || brett), { status: 'cancelled' }),
  ];
}

function busyOpen(F) {
  const extra = [
    { id: 'c-turn-2', title: 'Best set vs Jack', name: 'Jack', reps: 33 },
    { id: 'c-turn-3', title: 'Best set vs Maya R', name: 'Maya R', reps: 25 },
    { id: 'c-turn-4', title: 'Best set vs Brett', name: 'Brett', reps: 41 },
  ];
  return [
    ...F.openChallenges,
    ...extra.map((x) => ({
      ...F.openChallenges[1],
      challengeId: x.id,
      title: x.title,
      statusLabel: `${x.reps} to beat`,
      primaryOpponentDisplayName: x.name,
      endsAt: F.challenges[1].endsAt,
      timeLeftAmount: 3 + (x.reps % 20),
      timeLeftUnit: 'hour',
      sortRank: 0,
    })),
  ];
}

module.exports = {
  order: 5.5,
  variants: [
    {
      id: 'busy',
      description: 'Today and Compete > Challenges with four moves waiting on you and a long Finished list',
      options: { user: 'regular', rpc: {
        my_challenges: (args, F) => (args && args.p_battle ? F.challenges.filter((c) => c.id === args.p_battle) : busyChallenges(F)),
        my_open_challenges: (_args, F) => busyOpen(F),
      } },
      run: async ({ shot, tap, page }) => {
        await shot('today');
        await tap('Compete', { last: true, wait: 2000 });
        await tap('Challenges', { last: true, wait: 1800 });
        await shot('challenges');
        // Scroll every scrollable area to its end (the list is a ScrollView, which is a div on the web).
        await page.evaluate(() => document.querySelectorAll('div').forEach((el) => { if (el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight; }));
        await page.waitForTimeout(500);
        await shot('challenges-scrolled');
      },
    },
    {
      id: 'none',
      description: 'Compete > Challenges with friends but no challenges yet',
      options: { user: 'regular', rpc: { my_challenges: () => [], my_open_challenges: () => [] } },
      run: async ({ shot, tap }) => {
        await tap('Compete', { last: true, wait: 2000 });
        await tap('Challenges', { last: true, wait: 1800 });
        await shot('challenges-none');
      },
    },
    {
      id: 'friend',
      description: 'Compete > Friends > a friend: this week, best set, your record together, challenges',
      options: { user: 'regular' },
      run: async ({ shot, tap }) => {
        await tap('Compete', { last: true, wait: 2000 });
        await tap('Friends', { label: true, last: true, wait: 2000 });
        await shot('friends');
        await tap('Brett', { last: true, wait: 2000 });
        await shot('friend');
      },
    },
    {
      id: 'finished',
      description: 'A finished challenge from the Finished row: result, standings and Rematch',
      options: { user: 'regular' },
      run: async ({ shot, tap }) => {
        await tap('Compete', { last: true, wait: 2000 });
        await tap('Friends', { label: true, last: true, wait: 2000 });
        await tap('Brett', { last: true, wait: 2000 });
        await tap('Most reps today', { last: true, wait: 2000 });
        await shot('finished');
      },
    },
  ],
};
