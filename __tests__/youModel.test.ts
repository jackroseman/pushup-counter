import { buildYou, nextMilestone, RECENT_SETS } from '../src/progress/you';
import type { ProgressModel } from '../src/progress';

const ZONE = 'America/New_York';
const NOW = Date.parse('2026-11-25T16:30:00-05:00');
const at = (iso: string) => Date.parse(iso);

const badges = (lifetime: number) =>
  [1000, 10_000, 100_000].map((milestone) => ({
    milestone,
    earnedOn: lifetime >= milestone ? '2026-11-10' : null,
    remaining: lifetime >= milestone ? null : milestone - lifetime,
  }));

function view(partial: Partial<ProgressModel> = {}): ProgressModel {
  return {
    empty: false,
    day: [],
    week: [],
    month: [],
    lifetime: [],
    bestSet: { reps: 34, date: '2026-11-25' },
    bestDay: { reps: 82, date: '2026-11-09' },
    bestWeek: null,
    bestMonth: null,
    longestStreak: 19,
    streakIsNow: false,
    badges: badges(1371),
    program: { status: 'in_progress', name: '50 a day', detail: '' },
    historyNote: null,
    ...partial,
  };
}

const recent = [
  { id: 'a', startedAt: at('2026-11-25T09:30:00-05:00'), reps: 34 },
  { id: 'b', startedAt: at('2026-11-25T07:05:00-05:00'), reps: 22 },
  { id: 'c', startedAt: at('2026-11-24T18:40:00-05:00'), reps: 28 },
  { id: 'd', startedAt: at('2026-11-20T18:40:00-05:00'), reps: 34 },
];

describe('You model (frame 14, E5, E6)', () => {
  it('frame 14: records grid, next milestone and the last three sets with Best on the best one', () => {
    const m = buildYou({ view: view(), lifetimeReps: 1371, setCount: 60, hasGoal: true, recent, nowMs: NOW, timeZone: ZONE });
    expect(m.empty).toBe(false);
    expect(m.tiles).toEqual([
      { label: 'Lifetime', value: '1,371', caption: 'reps' },
      { label: 'Best set', value: '34', caption: 'Today' },
      { label: 'Best day', value: '82', caption: 'Nov 9' },
      { label: 'Longest streak', value: '19', caption: 'days' },
    ]);
    expect(m.milestone).toEqual({ label: 'Next milestone', current: 1371, target: 10_000, progress: 0.1371 });
    expect(m.showGoalRow).toBe(false);
    expect(m.recent.map((r) => [r.id, r.best])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ]);
    expect(m.recent).toHaveLength(RECENT_SETS);
  });

  it('marks Best only on a set matching the best set by reps and day', () => {
    const m = buildYou({ view: view({ bestSet: { reps: 34, date: '2026-11-20' } }), lifetimeReps: 1371, setCount: 60, hasGoal: true, recent, nowMs: NOW, timeZone: ZONE });
    expect(m.recent.some((r) => r.best)).toBe(false);
  });

  it('says 1 day, not 1 days', () => {
    const m = buildYou({ view: view({ longestStreak: 1 }), lifetimeReps: 10, setCount: 1, hasGoal: true, recent, nowMs: NOW, timeZone: ZONE });
    expect(m.tiles[3]).toEqual({ label: 'Longest streak', value: '1', caption: 'day' });
  });

  it('E6: no goal swaps the streak tile for Sets and the milestone for the goal row', () => {
    const m = buildYou({ view: view({ bestDay: { reps: 26, date: '2026-11-25' } }), lifetimeReps: 64, setCount: 4, hasGoal: false, recent, nowMs: NOW, timeZone: ZONE });
    expect(m.noGoal).toBe(true);
    expect(m.tiles[3]).toEqual({ label: 'Sets', value: '4', caption: 'all time' });
    expect(m.tiles[2].caption).toBe('Today');
    expect(m.milestone).toBeNull();
    expect(m.showGoalRow).toBe(true);
    expect(m.recent).toHaveLength(3);
  });

  it('E5: no sets shows one card and the first milestone at 0, with or without a goal', () => {
    for (const hasGoal of [true, false]) {
      const m = buildYou({
        view: view({ empty: true, bestSet: null, bestDay: null, longestStreak: 0, badges: badges(0) }),
        lifetimeReps: 0,
        setCount: 0,
        hasGoal,
        recent: [],
        nowMs: NOW,
        timeZone: ZONE,
      });
      expect(m.empty).toBe(true);
      expect(m.showGoalRow).toBe(false);
      expect(m.recent).toEqual([]);
      expect(m.milestone).toEqual({ label: 'First milestone', current: 0, target: 1000, progress: 0 });
    }
  });

  it('hides the milestone once every milestone is reached', () => {
    expect(nextMilestone(badges(150_000), 150_000)).toBeNull();
    expect(nextMilestone(badges(999), 999)?.label).toBe('First milestone');
    expect(nextMilestone(badges(1000), 1000)).toEqual({ label: 'Next milestone', current: 1000, target: 10_000, progress: 0.1 });
  });
});
