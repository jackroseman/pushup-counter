import { MAX_HISTORY } from '../src/storage/history';
import {
  EMPTY_PROGRESS,
  HISTORY_CAP_NOTE,
  STREAK_NOW,
  addCalendarDays,
  addMonths,
  buildProgress,
  chartCeiling,
  formatCount,
  lockedBadgeText,
  monthStart,
  weekStart,
} from '../src/progress';
import type { GoalEnrollment, Workout } from '../src/progress';

const ZONE = 'UTC';
const TODAY = '2026-11-09';

function at(isoDate: string, hour = 12): number {
  return Date.parse(`${isoDate}T${String(hour).padStart(2, '0')}:00:00.000Z`);
}

function workout(partial: Partial<Workout> & Pick<Workout, 'id' | 'countedReps'> & { date?: string }): Workout {
  const { date, ...rest } = partial;
  return {
    startedAt: date ? at(date) : at(TODAY),
    ...rest,
  };
}

function enroll(partial: Partial<GoalEnrollment> & Pick<GoalEnrollment, 'startedOn'>): GoalEnrollment {
  return {
    id: partial.id ?? 'goal-1',
    programId: partial.programId ?? null,
    customDailyReps: partial.customDailyReps ?? null,
    startedOn: partial.startedOn,
    endedOn: partial.endedOn ?? null,
    recordedTimeZone: partial.recordedTimeZone ?? ZONE,
  };
}

function progress(workouts: Workout[], enrollments: GoalEnrollment[] = [], storedCount = workouts.length) {
  return buildProgress({ workouts, enrollments, today: TODAY, timeZone: ZONE, storedCount });
}

describe('progress charts', () => {
  it('builds the day, week, and month windows, including today', () => {
    const view = progress([
      workout({ id: 'old', date: '2025-01-15', countedReps: 40 }),
      workout({ id: 'today-a', date: TODAY, countedReps: 6 }),
      workout({ id: 'today-b', date: TODAY, countedReps: 8 }),
    ]);

    expect(view.empty).toBe(false);
    expect(view.day).toHaveLength(14);
    expect(view.day[0].date).toBe(addCalendarDays(TODAY, -13));
    expect(view.day[view.day.length - 1]).toMatchObject({ date: TODAY, reps: 14 });
    expect(view.day.find((d) => d.date === '2025-01-15')).toBeUndefined();

    expect(view.week).toHaveLength(12);
    expect(view.week[0].start).toBe(addCalendarDays(weekStart(TODAY), -7 * 11));
    expect(view.week[view.week.length - 1]).toMatchObject({ start: weekStart(TODAY), reps: 14 });
    expect(view.week.find((w) => w.start === weekStart('2025-01-15'))).toBeUndefined();

    expect(view.month).toHaveLength(12);
    expect(view.month[0].start).toBe(addMonths(monthStart(TODAY), -11));
    expect(view.month[view.month.length - 1]).toMatchObject({ start: '2026-11-01', reps: 14 });
    expect(view.month.find((m) => m.start === '2025-01-01')).toBeUndefined();
  });

  it('marks the target on days that had one, including a rest day at zero', () => {
    const view = progress([], [enroll({ programId: 'first_20', startedOn: '2026-11-02' })]);
    expect(view.day.find((d) => d.date === '2026-11-02')?.target).toBe(10);
    expect(view.day.find((d) => d.date === '2026-11-08')?.target).toBe(0);
    expect(view.day.find((d) => d.date === '2026-11-09')?.target).toBe(15);
    expect(view.day.find((d) => d.date === '2026-10-27')?.target).toBeNull();
  });

  it('plots a lifetime point every week from the first set through this week', () => {
    const view = progress([
      workout({ id: 'old', date: '2026-01-15', countedReps: 40 }),
      workout({ id: 'now', date: TODAY, countedReps: 12 }),
    ]);
    expect(view.lifetime[0]).toEqual({ weekStart: weekStart('2026-01-15'), total: 40 });
    expect(view.lifetime[view.lifetime.length - 1]).toEqual({ weekStart: weekStart(TODAY), total: 52 });
    expect(view.lifetime.length).toBeGreaterThan(12);
    const flat = view.lifetime.filter((p) => p.weekStart > weekStart('2026-01-15') && p.weekStart < weekStart(TODAY));
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.every((p) => p.total === 40)).toBe(true);
  });

  it('is empty, with an empty lifetime, when there are no sets', () => {
    const view = progress([]);
    expect(view.empty).toBe(true);
    expect(view.day.every((d) => d.reps === 0)).toBe(true);
    expect(view.lifetime).toEqual([]);
    expect(view.bestSet).toBeNull();
    expect(view.bestDay).toBeNull();
    expect(view.bestWeek).toBeNull();
    expect(view.bestMonth).toBeNull();
    expect(view.longestStreak).toBe(0);
    expect(view.streakIsNow).toBe(false);
    expect(EMPTY_PROGRESS).toBe('Do a set to start.');
    expect(STREAK_NOW).toBe("That's now.");
  });
});

describe('records shelf', () => {
  it('keeps the richest bucket and breaks a tie toward the earliest date', () => {
    const view = progress([
      workout({ id: 'late', date: '2026-03-02', countedReps: 40 }),
      workout({ id: 'early', date: '2026-01-15', countedReps: 40 }),
      workout({ id: 'small', date: '2026-01-15', countedReps: 9, startedAt: at('2026-01-15', 18) }),
    ]);
    expect(view.bestSet).toEqual({ reps: 40, date: '2026-01-15' });
    expect(view.bestDay).toEqual({ reps: 49, date: '2026-01-15' });
    expect(view.bestWeek).toEqual({ reps: 49, date: weekStart('2026-01-15') });
    expect(view.bestMonth).toEqual({ reps: 49, date: '2026-01-01' });
  });

  it('counts every stored rep toward records, and only fresh sets toward the streak', () => {
    const view = progress(
      [
        workout({
          id: 'backfill',
          date: '2026-08-01',
          countedReps: 40,
          receivedAt: at('2026-11-01'),
        }),
        workout({ id: 'today', date: TODAY, countedReps: 10 }),
      ],
      [enroll({ customDailyReps: 10, startedOn: '2026-08-01' })],
    );
    expect(view.bestSet).toEqual({ reps: 40, date: '2026-08-01' });
    expect(view.day[view.day.length - 1].reps).toBe(10);
    expect(view.longestStreak).toBe(1);
    expect(view.streakIsNow).toBe(true);
  });

  it('says the longest streak is now only when the current run matches it', () => {
    const goal = [enroll({ customDailyReps: 5, startedOn: '2026-11-01' })];
    const ongoing = progress(
      [
        workout({ id: 'a', date: '2026-11-07', countedReps: 5 }),
        workout({ id: 'b', date: '2026-11-08', countedReps: 5 }),
        workout({ id: 'c', date: TODAY, countedReps: 5 }),
      ],
      goal,
    );
    expect(ongoing.longestStreak).toBe(3);
    expect(ongoing.streakIsNow).toBe(true);

    const broken = progress(
      [
        workout({ id: 'a', date: '2026-11-01', countedReps: 5 }),
        workout({ id: 'b', date: '2026-11-02', countedReps: 5 }),
        workout({ id: 'c', date: '2026-11-03', countedReps: 5 }),
      ],
      goal,
    );
    expect(broken.longestStreak).toBe(3);
    expect(broken.streakIsNow).toBe(false);
  });
});

describe('milestone badges', () => {
  it('dates a badge from the set that crossed, and counts what is left on the rest', () => {
    const view = progress([
      workout({ id: 'cross', date: '2026-02-02', countedReps: 1000 }),
      workout({ id: 'more', date: TODAY, countedReps: 50 }),
    ]);
    expect(view.badges.map((b) => b.milestone)).toEqual([1000, 10_000, 100_000]);
    expect(view.badges[0]).toEqual({ milestone: 1000, earnedOn: '2026-02-02', remaining: null });
    expect(view.badges[1]).toMatchObject({ earnedOn: null, remaining: 8950 });
    expect(view.badges[2]).toMatchObject({ earnedOn: null, remaining: 98950 });
    expect(lockedBadgeText(258, 1000)).toBe('258 to 1,000');
    expect(formatCount(100000)).toBe('100,000');
  });

  it('locks every badge at the full distance when there are no sets', () => {
    const view = progress([]);
    expect(view.badges.every((b) => b.earnedOn === null && b.remaining === b.milestone)).toBe(true);
  });

  it('keeps the next milestone on the chart scale', () => {
    expect(chartCeiling(50, [1000, 10_000, 100_000])).toBe(1000);
    expect(chartCeiling(5000, [1000, 10_000, 100_000])).toBe(10_000);
    expect(chartCeiling(100_001, [1000, 10_000, 100_000])).toBe(100_001);
    expect(chartCeiling(0, [])).toBe(1);
  });
});

describe('programs and the history note', () => {
  it('describes a program as not started, in this week, or complete', () => {
    expect(progress([]).program).toEqual({ status: 'not_started', name: 'Program', detail: 'Not started' });

    const active = progress([], [enroll({ programId: 'first_20', startedOn: '2026-11-02' })]);
    expect(active.program).toEqual({
      status: 'in_progress',
      name: 'First 20 in a row',
      detail: 'Week 2 · 15 a day · Sunday off',
    });

    const done = progress([workout({ id: 'twenty', date: '2026-11-04', countedReps: 20 })], [
      enroll({ programId: 'first_20', startedOn: '2026-11-02' }),
    ]);
    expect(done.program).toEqual({ status: 'complete', name: 'First 20 in a row', detail: 'Complete' });

    const custom = progress([], [enroll({ customDailyReps: 30, startedOn: '2026-11-02' })]);
    expect(custom.program).toEqual({ status: 'in_progress', name: 'Custom goal', detail: '30 a day' });
  });

  it('notes the 200-set cap once the phone is full', () => {
    expect(progress([], [], MAX_HISTORY).historyNote).toBe(HISTORY_CAP_NOTE);
    expect(progress([], [], MAX_HISTORY - 1).historyNote).toBeNull();
    expect(HISTORY_CAP_NOTE).toBe('Showing the last 200 sets on this phone. Sign in to keep the full history.');
  });
});

describe('calendar months', () => {
  it('steps across year boundaries', () => {
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
  });
});
