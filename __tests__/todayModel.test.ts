import type { Battle, Participant } from '../src/battles/model';
import type { LeagueBoard, LeagueTotalRow } from '../src/backend/leagueClient';
import type { DayBucket } from '../src/progress/progress';
import {
  buildTodayView,
  challengeCard,
  heroLabel,
  leagueCard,
  leftLabel,
  ordinal,
  todayHero,
  todayLine,
  weekDays,
  type TodayInput,
} from '../src/ui/models/today';

// Wednesday, November 25, 2026 (America/New_York), 4:30 PM.
const NOW = Date.parse('2026-11-25T16:30:00-05:00');
const TODAY = '2026-11-25';
const H = 3_600_000;
const DAY = 24 * H;
const iso = (ms: number) => new Date(NOW + ms).toISOString();
const ME = 'me';

const row = (userId: string, name: string, reps: number, rank: number): LeagueTotalRow => ({
  userId,
  username: name.toLowerCase(),
  displayName: name,
  reps,
  rank,
  crownedLastWeek: false,
});
const board = (total: LeagueTotalRow[], weekEnd = '2026-11-29'): LeagueBoard => ({
  weekStart: '2026-11-23',
  weekEnd,
  timeZone: 'America/New_York',
  total,
  improvement: [],
});
const LEAGUE = board([row('j', 'Jack', 212, 1), row(ME, 'Sunny', 168, 2), row('b', 'Brett', 131, 3), row('m', 'Mia', 96, 4)]);

const person = (userId: string, name: string, extra: Partial<Participant> = {}): Participant => ({
  userId,
  username: name.toLowerCase(),
  displayName: name,
  status: 'accepted',
  isMe: userId === ME,
  attemptsUsed: 0,
  validReps: null,
  metricValue: null,
  avgDepthPct: null,
  tempoScore: null,
  rank: null,
  isWinner: false,
  ...extra,
});
const battle = (extra: Partial<Battle>): Battle => ({
  id: 'c1',
  mode: 'async',
  kind: 'best_set',
  windowUnit: null,
  metric: 'rep_count',
  status: 'active',
  durationS: null,
  attemptsAllowed: 1,
  targetReps: null,
  maxParticipants: 2,
  minQuality: 'good',
  inviteExpiresAt: iso(2 * DAY),
  startsAt: iso(-DAY),
  endsAt: iso(DAY + 2 * H),
  createdAt: iso(-DAY),
  finishedAt: null,
  createdBy: 'b',
  locked: false,
  participants: [person(ME, 'Sunny'), person('b', 'Brett', { attemptsUsed: 1, validReps: 31 })],
  inviteLinks: [],
  ...extra,
});

const days = (entries: [string, number, number | null][]): DayBucket[] => entries.map(([date, reps, target]) => ({ date, reps, target }));
const WEEK = days([
  ['2026-11-23', 52, 50],
  ['2026-11-24', 50, 50],
  ['2026-11-25', 22, 50],
]);

const input = (extra: Partial<TodayInput> = {}): TodayInput => ({
  today: TODAY,
  reps: 22,
  target: 50,
  rest: false,
  currentStreak: 12,
  dayOne: false,
  days: WEEK,
  targetFor: (date) => (date === '2026-11-28' ? 0 : 50),
  signedIn: true,
  meId: ME,
  board: LEAGUE,
  battles: [battle({})],
  now: NOW,
  ...extra,
});

describe('frame 4: Today', () => {
  const v = buildTodayView(input());
  it('shows the ring, the streak chip and "28 to go"', () => {
    expect(v.hero).toEqual({ kind: 'ring', reps: 22, target: 50, progress: 0.44, done: false });
    expect(v.streak).toBe(12);
    expect(v.line).toEqual({ text: '28 to go', tone: 'secondary' });
    expect(v.primary).toEqual({ title: 'Start a set', kind: 'primary' });
  });
  it('shows the league card with the gap to the person ahead', () => {
    expect(v.league).toEqual({
      label: 'League · ends Sunday',
      title: '2nd this week',
      detail: '44 behind Jack',
      people: [
        { name: 'Jack', me: false },
        { name: 'Sunny', me: true },
        { name: 'Brett', me: false },
      ],
    });
    expect(v.betterWithFriends).toBe(false);
  });
  it('shows the your-move card', () => {
    expect(v.challenge).toEqual({
      kind: 'your_move',
      battleId: 'c1',
      opponent: 'Brett',
      title: 'Your move vs Brett',
      detail: 'Best set · 31 to beat · 1 day left',
    });
  });
  it('shows the week strip: done days, today partial, a rest day off', () => {
    expect(v.week?.map((d) => d.label).join('')).toBe('MTWTFSS');
    expect(v.week?.map((d) => d.state)).toEqual(['done', 'done', 'partial', 'empty', 'empty', 'rest', 'empty']);
    expect(v.week?.[2]).toMatchObject({ today: true, count: 22, accessibilityLabel: 'Wednesday, 22 of 50' });
    expect(v.howItWorks).toBe(false);
  });
});

describe('frame 13: goal done', () => {
  const v = buildTodayView(input({ reps: 56, currentStreak: 13, days: days([['2026-11-23', 52, 50], ['2026-11-24', 50, 50], ['2026-11-25', 56, 50]]) }));
  it('fills the ring, turns the line green and the button gray', () => {
    expect(v.hero).toMatchObject({ kind: 'ring', progress: 1, done: true });
    expect(v.line).toEqual({ text: 'Goal done · 13-day streak', tone: 'signal' });
    expect(v.primary).toEqual({ title: 'Start another set', kind: 'gray' });
    expect(v.streak).toBe(13);
    expect(v.week?.[2].state).toBe('done');
  });
});

describe('E1: day one', () => {
  const v = buildTodayView(input({ reps: 0, target: 20, currentStreak: 0, dayOne: true, days: [], board: null, battles: [] }));
  it('hides the streak chip, challenge card and week strip', () => {
    expect(v.streak).toBeNull();
    expect(v.challenge).toBeNull();
    expect(v.week).toBeNull();
    expect(v.league).toBeNull();
  });
  it('shows the first-set line, Better with friends and How it works', () => {
    expect(v.line).toEqual({ text: 'Your first set starts here.', tone: 'secondary' });
    expect(v.betterWithFriends).toBe(true);
    expect(v.howItWorks).toBe(true);
  });
  it('hides league and challenges on day one even with a board', () => {
    const w = buildTodayView(input({ reps: 0, dayOne: true, days: [] }));
    expect(w.league).toBeNull();
    expect(w.challenge).toBeNull();
    expect(w.betterWithFriends).toBe(true);
  });
});

describe('E2: no goal', () => {
  const v = buildTodayView(input({ reps: 14, target: null, currentStreak: 0, board: null, battles: [], signedIn: false, meId: null }));
  it('counts without a ring and has no streak chip or week strip', () => {
    expect(v.hero).toEqual({ kind: 'count', reps: 14 });
    expect(v.line).toBeNull();
    expect(v.streak).toBeNull();
    expect(v.week).toBeNull();
  });
  it('shows Better with friends and How it works', () => {
    expect(v.betterWithFriends).toBe(true);
    expect(v.howItWorks).toBe(true);
    expect(v.challenge).toBeNull();
  });
  it('ignores a server streak without a goal', () => {
    expect(buildTodayView(input({ target: null, currentStreak: 4 })).streak).toBeNull();
  });
});

describe('E3: nothing yet today', () => {
  const zero = board([row('j', 'Jack', 0, 1), row('m', 'Mia', 0, 1), row('b', 'Brett', 0, 1), row(ME, 'Sunny', 0, 1)]);
  const v = buildTodayView(input({ reps: 0, currentStreak: 0, board: zero, battles: [], targetFor: () => 50, days: days([['2026-11-23', 0, 50], ['2026-11-24', 0, 50], ['2026-11-25', 0, 50]]) }));
  it('has no streak chip at 0 and shows "50 to go"', () => {
    expect(v.streak).toBeNull();
    expect(v.line?.text).toBe('50 to go');
  });
  it('shows the new-week league card and the Challenge a friend row', () => {
    expect(v.league).toMatchObject({ title: 'New week', detail: "Nobody's on the board yet" });
    expect(v.league?.people.map((p) => p.name)).toEqual(['Jack', 'Mia', 'Brett']);
    expect(v.challenge).toEqual({ kind: 'challenge_friend', title: 'Challenge a friend', detail: 'Best set, most reps, streak or team' });
  });
  it('shows an empty week with today outlined', () => {
    expect(v.week?.every((d) => d.state === 'empty')).toBe(true);
    expect(v.week?.[2].today).toBe(true);
  });
});

describe('league card rules', () => {
  it('needs a board with a friend on it', () => {
    expect(leagueCard(null, ME, TODAY)).toBeNull();
    expect(leagueCard(board([row(ME, 'Sunny', 10, 1)]), ME, TODAY)).toBeNull();
    expect(leagueCard(LEAGUE, null, TODAY)).toBeNull();
  });
  it('first place counts the lead over second', () => {
    const c = leagueCard(board([row(ME, 'Sunny', 90, 1), row('j', 'Jack', 60, 2), row('b', 'Brett', 10, 3), row('m', 'Mia', 0, 4)]), ME, TODAY);
    expect(c).toMatchObject({ title: '1st this week', detail: '30 ahead of Jack' });
    expect(c?.people.map((p) => p.name)).toEqual(['Sunny', 'Jack', 'Brett']);
  });
  it('a tie says who with', () => {
    expect(leagueCard(board([row('j', 'Jack', 50, 1), row(ME, 'Sunny', 50, 1)]), ME, TODAY)?.detail).toBe('Tied with Jack');
  });
  it('last place keeps the two ahead in the avatars', () => {
    const c = leagueCard(board([row('j', 'Jack', 90, 1), row('b', 'Brett', 60, 2), row('m', 'Mia', 10, 3), row(ME, 'Sunny', 0, 4)]), ME, TODAY);
    expect(c).toMatchObject({ title: '4th this week', detail: '10 behind Mia' });
    expect(c?.people.map((p) => p.name)).toEqual(['Brett', 'Mia', 'Sunny']);
  });
  it('names the last day of the week', () => {
    expect(leagueCard(board(LEAGUE.total, TODAY), ME, TODAY)?.label).toBe('League · ends today');
    expect(leagueCard(board(LEAGUE.total, '2026-11-26'), ME, TODAY)?.label).toBe('League · ends tomorrow');
  });
  it('falls back to the username', () => {
    const c = leagueCard(board([{ ...row('j', 'Jack', 99, 1), displayName: null }, row(ME, 'Sunny', 9, 2)]), ME, TODAY);
    expect(c?.detail).toBe('90 behind jack');
  });
});

describe('challenge card rules', () => {
  it('leaves out "to beat" before anyone else has played', () => {
    const c = challengeCard([battle({ participants: [person(ME, 'Sunny'), person('b', 'Brett')] })], true, NOW);
    expect(c).toMatchObject({ kind: 'your_move', detail: 'Best set · 1 day left' });
  });
  it('an invite opens the challenge instead of playing', () => {
    const c = challengeCard(
      [battle({ kind: 'total', windowUnit: 'week', participants: [person(ME, 'Sunny', { status: 'invited' }), person('b', 'Brett')] })],
      true,
      NOW,
    );
    expect(c).toEqual({ kind: 'invite', battleId: 'c1', opponent: 'Brett', title: 'Brett challenged you', detail: 'Most reps this week · 2 days left' });
  });
  it('a group names the first opponent plus the rest', () => {
    const c = challengeCard([battle({ participants: [person(ME, 'Sunny'), person('b', 'Brett'), person('j', 'Jack')] })], true, NOW);
    expect(c?.kind === 'your_move' && c.title).toBe('Your move vs Brett +1');
  });
  it('without a move waiting: Challenge a friend, only with friends', () => {
    const done = battle({ participants: [person(ME, 'Sunny', { attemptsUsed: 1, validReps: 20 }), person('b', 'Brett')] });
    expect(challengeCard([done], true, NOW)?.kind).toBe('challenge_friend');
    expect(challengeCard([done], false, NOW)).toBeNull();
    expect(challengeCard(null, false, NOW)).toBeNull();
  });
  it('signed out: no league or challenge card, Better with friends instead', () => {
    const v = buildTodayView(input({ signedIn: false }));
    expect(v.league).toBeNull();
    expect(v.challenge).toBeNull();
    expect(v.betterWithFriends).toBe(true);
    expect(v.week).not.toBeNull();
  });
});

describe('helpers', () => {
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
  });
  it('leftLabel', () => {
    expect(leftLabel(iso(5 * H), NOW)).toBe('5 h left');
    expect(leftLabel(iso(30 * 60_000), NOW)).toBe('under an hour left');
    expect(leftLabel(iso(3 * DAY), NOW)).toBe('3 days left');
    expect(leftLabel(iso(-H), NOW)).toBe('');
    expect(leftLabel(null, NOW)).toBe('');
  });
  it('rest day hero', () => {
    expect(todayHero({ reps: 5, target: 0, rest: true })).toEqual({ kind: 'rest', reps: 5 });
    expect(todayLine({ kind: 'rest', reps: 5 }, false, 3)).toBeNull();
    expect(heroLabel({ kind: 'rest', reps: 5 })).toBe('5 push-ups today, rest day');
  });
  it('goal done without a streak number', () => {
    expect(todayLine({ kind: 'ring', reps: 50, target: 50, progress: 1, done: true }, false, 0)).toEqual({ text: 'Goal done', tone: 'signal' });
  });
  it('past days that missed the goal stay empty; future days use the schedule', () => {
    const w = weekDays({ today: TODAY, days: days([['2026-11-23', 10, 50]]), targetFor: (d) => (d === '2026-11-29' ? 0 : 50) });
    expect(w[0].state).toBe('empty');
    expect(w[6].state).toBe('rest');
    expect(w[6].accessibilityLabel).toBe('Sunday, rest day');
  });
});
