import { loadLeagueCache, parseLeague, saveLeagueCache, type LeagueBoard, type LeagueCacheStore } from '../src/backend/leagueClient';
import {
  CROWN_CAPTION,
  DEFAULT_LEAGUE_WEIGHTS,
  FRIEND_WEEK_SUBTITLE,
  FRIENDS_LEAGUE_COPY,
  LEAGUE_ABOUT,
  NO_FRIENDS,
  WEEK_LINE,
  formatLeagueNumber,
  friendWeekLine,
  improvementDetail,
  leaguePoints,
  leagueUsual,
  rankLeague,
} from '../src/progress/league';

const board = (over: Partial<LeagueBoard> = {}): LeagueBoard => ({
  weekStart: '2026-11-02',
  weekEnd: '2026-11-09',
  timeZone: 'UTC',
  total: [
    { userId: 'me', username: 'me', displayName: null, reps: 50, rank: 2, crownedLastWeek: true },
    { userId: 'friend', username: 'friend', displayName: 'Alex', reps: 80, rank: 1, crownedLastWeek: false },
  ],
  improvement: [
    {
      userId: 'me',
      username: 'me',
      displayName: null,
      points: 50,
      reps: 50,
      goalDaysHit: 1,
      goalDaysScheduled: 7,
      usual: 20,
      baselineWeeks: 3,
      baselineMinWeeks: 3,
      rank: 1,
      crownedLastWeek: false,
    },
  ],
  ...over,
});

describe('league points', () => {
  it('matches the worked example, and the two tabs can disagree', () => {
    const mine = leaguePoints({ weekReps: 230, usual: 200, goalDaysHit: 5, goalDaysScheduled: 6, weekEnded: false });
    const friend = leaguePoints({ weekReps: 400, usual: 400, goalDaysHit: 2, goalDaysScheduled: 6, weekEnded: false });
    expect(mine).toEqual({ beat: 30, goal: 100, perfect: 0, points: 130 });
    expect(friend).toEqual({ beat: 0, goal: 40, perfect: 0, points: 40 });
    const people = [
      { id: 'me', reps: 230, points: mine.points, hit: 5 },
      { id: 'friend', reps: 400, points: friend.points, hit: 2 },
    ];
    expect(rankLeague(people, (row) => [row.reps]).map((row) => row.id)).toEqual(['friend', 'me']);
    expect(rankLeague(people, (row) => [row.points, row.hit, row.reps]).map((row) => row.id)).toEqual(['me', 'friend']);
  });

  it('withholds the usual week until three finished weeks, and a perfect week waits for Sunday', () => {
    expect(leagueUsual([10, 20])).toBeNull();
    expect(leagueUsual([10, 50, 20])).toBe(20);
    expect(leagueUsual([10, 20, 30, 40])).toBe(25);
    expect(leagueUsual([1, 2, 3, 4, 5, 6, 7, 8, 9], { ...DEFAULT_LEAGUE_WEIGHTS, baselineWeeks: 8 })).toBe(4.5);
    const open = leaguePoints({ weekReps: 10, usual: null, goalDaysHit: 6, goalDaysScheduled: 6, weekEnded: false });
    expect(open.beat).toBe(0);
    expect(open.perfect).toBe(0);
    const closed = leaguePoints({ weekReps: 10, usual: 40, goalDaysHit: 6, goalDaysScheduled: 6, weekEnded: true });
    expect(closed).toEqual({ beat: 0, goal: 120, perfect: 30, points: 150 });
    expect(leaguePoints({ weekReps: 10, usual: 4, goalDaysHit: 0, goalDaysScheduled: 0, weekEnded: true }).perfect).toBe(0);
  });

  it('ranks ties as 1, 2, 2, 4', () => {
    const ranked = rankLeague(
      [
        { id: 'a', reps: 10 },
        { id: 'b', reps: 30 },
        { id: 'c', reps: 20 },
        { id: 'd', reps: 20 },
      ],
      (row) => [row.reps],
    );
    expect(Object.fromEntries(ranked.map((row) => [row.id, row.rank]))).toEqual({ b: 1, c: 2, d: 2, a: 4 });
  });

  it('formats the row copy', () => {
    expect(formatLeagueNumber(20)).toBe('20');
    expect(formatLeagueNumber(20.5)).toBe('20.5');
    expect(formatLeagueNumber(2000)).toBe('2,000');
    expect(improvementDetail({ reps: 50, goalDaysHit: 1, goalDaysScheduled: 7, usual: 20, baselineWeeks: 3, baselineMinWeeks: 3 })).toBe(
      '50 reps · 1/7 goal days · Usual 20',
    );
    expect(improvementDetail({ reps: 50, goalDaysHit: 1, goalDaysScheduled: 7, usual: null, baselineWeeks: 2, baselineMinWeeks: 3 })).toBe(
      '50 reps · 1/7 goal days · Baseline 2/3 weeks',
    );
    expect(friendWeekLine(230, 130)).toBe('This week: 230 reps · 130 improvement points');
    expect(LEAGUE_ABOUT).not.toMatch(/\d/);
    expect(WEEK_LINE).toBe("Each person's week is Monday to Sunday where they are.");
    expect(CROWN_CAPTION).toBe('Last week, among your current friends.');
    expect(NO_FRIENDS).toBe("Add a friend to start this week's board.");
    expect(FRIENDS_LEAGUE_COPY.startsWith('Friends are on your weekly league together.')).toBe(true);
    expect(FRIEND_WEEK_SUBTITLE).toBe("This week's league, and your battles together.");
  });
});

describe('league document', () => {
  it('rejects a document that is not aggregates', () => {
    expect(parseLeague(null)).toBeNull();
    expect(parseLeague({})).toBeNull();
    expect(parseLeague({ ...board(), weekStart: 'Monday' })).toBeNull();
    expect(parseLeague({ ...board(), sets: [] })).toBeNull();
    expect(parseLeague({ ...board(), total: [{ userId: 'me', username: 'me', reps: 1, rank: 0, crownedLastWeek: false }] })).toBeNull();
  });

  it('keeps the last board for this account only', async () => {
    const saved = new Map<string, string>();
    const store: LeagueCacheStore = {
      getItem: async (key) => saved.get(key) ?? null,
      setItem: async (key, value) => {
        saved.set(key, value);
      },
    };
    const doc = board();
    await saveLeagueCache(store, 'account-a', doc);
    expect(await loadLeagueCache(store, 'account-a')).toEqual(doc);
    expect(await loadLeagueCache(store, 'account-b')).toBeNull();
    expect(parseLeague(doc)).toEqual(doc);
  });
});
