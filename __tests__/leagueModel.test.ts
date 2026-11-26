import type { LeagueBoard, LeagueImprovementRow, LeagueTotalRow } from '../src/backend/leagueClient';
import { LEAGUE_INFO, formatEndsIn, hasCrown, isNewWeek, leagueHeader, leagueView, ordinal, toPass, zonedMidnight } from '../src/progress/leagueView';

const ME = 'me';
const total = (userId: string, name: string, reps: number, rank: number): LeagueTotalRow => ({
  userId,
  username: name.toLowerCase(),
  displayName: name,
  reps,
  rank,
  crownedLastWeek: false,
});
const improvement = (row: LeagueTotalRow, points: number, rank: number): LeagueImprovementRow => ({
  ...row,
  points,
  goalDaysHit: 0,
  goalDaysScheduled: 0,
  usual: null,
  baselineWeeks: 0,
  baselineMinWeeks: 3,
  rank,
});
// Wednesday 2026-11-25 16:30 in New York; the week ends at midnight starting Monday 2026-11-30.
const NOW = Date.parse('2026-11-25T16:30:00-05:00');
const board = (rows: LeagueTotalRow[], imp: LeagueImprovementRow[] = []): LeagueBoard => ({
  weekStart: '2026-11-23',
  weekEnd: '2026-11-30',
  timeZone: 'America/New_York',
  total: rows,
  improvement: imp,
});

// Frame 18.
const frame18 = [
  total('jack', 'Jack', 286, 1),
  total(ME, 'Sunny', 242, 2),
  total('brett', 'Brett', 198, 3),
  total('maya', 'Maya', 171, 4),
  total('leo', 'Leo', 160, 5),
  total('tara', 'Tara', 92, 6),
];

describe('league view (frames 18, 19, E8, E9)', () => {
  it('frame 18: podium, rows from 4th, and the gap to the next person', () => {
    const view = leagueView({
      board: board(frame18),
      meId: ME,
      mode: 'total',
      now: NOW,
    });
    expect(view.kind).toBe('board');
    if (view.kind !== 'board') return;
    expect(view.header).toBe('This week · ends in 4d 7h');
    expect(view.podium.map((p) => [p.name, p.score, p.me])).toEqual([
      ['Jack', 286, false],
      ['Sunny', 242, true],
      ['Brett', 198, false],
    ]);
    expect(view.rest.map((p) => [p.rank, p.name, p.score])).toEqual([
      [4, 'Maya', 171],
      [5, 'Leo', 160],
      [6, 'Tara', 92],
    ]);
    expect(view.title).toBe("You're 2nd");
    expect(view.line).toBe('45 more to pass Jack');
  });

  it('frame 19: only the user on the board is the empty league', () => {
    expect(
      leagueView({
        board: board([total(ME, 'Sunny', 40, 1)]),
        meId: ME,
        mode: 'total',
        now: NOW,
      }),
    ).toEqual({ kind: 'empty' });
    expect(leagueView({ board: board([]), meId: ME, mode: 'total', now: NOW })).toEqual({ kind: 'empty' });
  });

  it('E8: a new week lists everyone at 0, the user first, then by name', () => {
    const rows = [
      total('maya', 'Maya', 0, 1),
      total('brett', 'Brett', 0, 1),
      total(ME, 'Sunny', 0, 1),
      total('jack', 'Jack', 0, 1),
      total('leo', 'Leo', 0, 1),
    ];
    const view = leagueView({
      board: board(rows),
      meId: ME,
      mode: 'total',
      now: Date.parse('2026-11-23T00:30:00-05:00'),
    });
    expect(view.kind).toBe('newWeek');
    if (view.kind !== 'newWeek') return;
    expect(view.header).toBe('New week · ends in 6d 23h');
    expect(view.people.map((p) => (p.me ? 'You' : p.name))).toEqual(['You', 'Brett', 'Jack', 'Leo', 'Maya']);
    expect(view.people.every((p) => p.score === 0 && !hasCrown(p))).toBe(true);
    expect(isNewWeek(board(rows))).toBe(true);
  });

  it('E8 wins over the Improvement board: nobody has a rep yet', () => {
    const rows = [total(ME, 'Sunny', 0, 1), total('jack', 'Jack', 0, 1)];
    const view = leagueView({
      board: board(rows, [improvement(rows[1], 20, 1), improvement(rows[0], 0, 2)]),
      meId: ME,
      mode: 'improvement',
      now: NOW,
    });
    expect(view.kind).toBe('newWeek');
  });

  it("E9: the user hasn't started; others ranked, the user pinned with the gap to the closest person", () => {
    const rows = [
      total('jack', 'Jack', 286, 1),
      total('brett', 'Brett', 198, 2),
      total('maya', 'Maya', 171, 3),
      total('leo', 'Leo', 160, 4),
      total('tara', 'Tara', 44, 5),
      total(ME, 'Sunny', 0, 6),
    ];
    const view = leagueView({
      board: board(rows),
      meId: ME,
      mode: 'total',
      now: NOW,
    });
    expect(view.kind).toBe('notStarted');
    if (view.kind !== 'notStarted') return;
    expect(view.people.map((p) => p.name)).toEqual(['Jack', 'Brett', 'Maya', 'Leo', 'Tara']);
    expect(view.people.filter(hasCrown).map((p) => p.name)).toEqual(['Jack']);
    expect(view.me.score).toBe(0);
    expect(view.line).toBe('45 to pass Tara');
  });

  it('E9: friends still at 0 are listed but are not the person to pass', () => {
    const rows = [total('jack', 'Jack', 10, 1), total(ME, 'Sunny', 0, 2), total('leo', 'Leo', 0, 2)];
    const view = leagueView({
      board: board(rows),
      meId: ME,
      mode: 'total',
      now: NOW,
    });
    expect(view.kind === 'notStarted' && view.line).toBe('11 to pass Jack');
  });

  it('ties keep a stable order (rank, then name) and share the rank', () => {
    const rows = [total('b', 'Brett', 50, 1), total('a', 'Alex', 50, 1), total(ME, 'Sunny', 50, 1), total('z', 'Zoe', 10, 4)];
    const one = leagueView({
      board: board(rows),
      meId: ME,
      mode: 'total',
      now: NOW,
    });
    const two = leagueView({
      board: board([...rows].reverse()),
      meId: ME,
      mode: 'total',
      now: NOW,
    });
    expect(one).toEqual(two);
    if (one.kind !== 'board') throw new Error(one.kind);
    expect(one.podium.map((p) => p.name)).toEqual(['Alex', 'Brett', 'Sunny']);
    expect(one.title).toBe("You're 1st");
    expect(one.line).toBe('Tied with Alex');
  });

  it('in the lead: says how far ahead', () => {
    const rows = [total(ME, 'Sunny', 80, 1), total('jack', 'Jack', 50, 2)];
    const view = leagueView({
      board: board(rows),
      meId: ME,
      mode: 'total',
      now: NOW,
    });
    expect(view.kind === 'board' && [view.title, view.line]).toEqual(["You're 1st", '30 ahead of Jack']);
  });

  it('Improvement uses points and the improvement ranks', () => {
    const rows = [total(ME, 'Sunny', 168, 2), total('jack', 'Jack', 212, 1), total('brett', 'Brett', 131, 3)];
    const imp = [improvement(rows[0], 142, 1), improvement(rows[2], 118, 2), improvement(rows[1], 97, 3)];
    const view = leagueView({
      board: board(rows, imp),
      meId: ME,
      mode: 'improvement',
      now: NOW,
    });
    if (view.kind !== 'board') throw new Error(view.kind);
    expect(view.podium.map((p) => [p.name, p.score])).toEqual([
      ['Sunny', 142],
      ['Brett', 118],
      ['Jack', 97],
    ]);
    expect(view.title).toBe("You're 1st");
    expect(view.line).toBe('24 ahead of Brett');
  });
});

describe('league helpers', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });

  it('to pass is one more than the gap', () => {
    expect(toPass(242, 286)).toBe(45);
    expect(toPass(0, 44)).toBe(45);
  });

  it('week end is midnight in the league time zone, across daylight saving', () => {
    expect(new Date(zonedMidnight('2026-11-30', 'America/New_York')).toISOString()).toBe('2026-11-30T05:00:00.000Z');
    expect(new Date(zonedMidnight('2026-07-06', 'America/New_York')).toISOString()).toBe('2026-07-06T04:00:00.000Z');
    expect(new Date(zonedMidnight('2026-03-09', 'America/New_York')).toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(new Date(zonedMidnight('2026-11-30', 'Europe/Paris')).toISOString()).toBe('2026-11-29T23:00:00.000Z');
    expect(new Date(zonedMidnight('2026-11-30', 'UTC')).toISOString()).toBe('2026-11-30T00:00:00.000Z');
  });

  it('"ends in" text', () => {
    expect(formatEndsIn((4 * 24 + 7) * 3_600_000 + 30 * 60_000)).toBe('4d 7h');
    expect(formatEndsIn(7 * 3_600_000 + 12 * 60_000)).toBe('7h 12m');
    expect(formatEndsIn(12 * 60_000 + 59_000)).toBe('12m');
    expect(formatEndsIn(10_000)).toBe('1m');
    expect(leagueHeader({ weekEnd: '2026-11-30', timeZone: 'America/New_York' }, false, Date.parse('2026-11-30T05:00:00Z'))).toBe(
      'This week · ending now',
    );
  });
});

describe('league (i) sheet', () => {
  it('explains the week in two plain lines, with no numbers or formulas', () => {
    expect(LEAGUE_INFO.lines).toEqual([
      'Every push-up you do this week counts. Most reps wins.',
      'The board starts fresh every week.',
    ]);
    const copy = [LEAGUE_INFO.title, ...LEAGUE_INFO.lines].join(' ');
    expect(copy).not.toMatch(/\d|%|×|points per|baseline/i);
  });
});
