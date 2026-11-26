import { HistoryStore, KeyValueStore, SessionRecord } from '../src/storage/history';
import { summarize } from '../src/core';
import type { Rep } from '../src/core';
import {
  CUSTOM_GOAL,
  PROGRAMS,
  addCalendarDays,
  celebrate,
  currentTargetLabel,
  goalForDate,
  loadGoal,
  phoneCountedReps,
  programComplete,
  saveEnrollment,
  saveGoal,
  scheduledReps,
  buildToday,
  segmentsCoverRamp,
} from '../src/progress';

class MemoryKV implements KeyValueStore {
  data = new Map<string, string>();
  async getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  async removeItem(k: string) {
    this.data.delete(k);
  }
}

const utc = (day: string, hour = 15) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`);

const workout = (day: string, reps: number, id = day) => ({
  id,
  startedAt: utc(day),
  timeZone: 'UTC',
  countedReps: reps,
});

const rep = (index: number, quality: Rep['quality'], timestamp: number, depth = 0.7): Rep => ({
  index,
  timestamp,
  quality,
  source: 'depth',
  bottomDistance: 0.2,
  topDistance: 0.5,
  rangeOfMotion: 0.3,
  depthRatio: depth,
  faceLostAtBottom: false,
});

describe('programs', () => {
  it('matches the seeded ramps and the published volumes', () => {
    expect(PROGRAMS.map((p) => p.id)).toEqual(['first_20', 'fifty_a_day', 'hundred_in_30']);
    for (const p of PROGRAMS) expect(segmentsCoverRamp(p)).toBe(true);
    const first = PROGRAMS[0];
    const fifty = PROGRAMS[1];
    const hundred = PROGRAMS[2];
    expect(scheduledReps(first, '2026-11-02')).toBe(420);
    expect(scheduledReps(first, '2026-11-01')).toBe(420);
    expect(scheduledReps(fifty, '2026-11-02')).toBe(980);
    expect(scheduledReps(hundred, '2026-11-02')).toBe(2055);
    expect(first.completionRule).toBe('single_set');
    expect(first.completionSetReps).toBe(20);
    expect(fifty.completionRule).toBe('finish_schedule');
    expect(hundred.segments[3]).toMatchObject({ dayFrom: 22, dayTo: 30, dailyTarget: 100, restWeekday: null });
  });

  it('uses the calendar Sunday, not the 7th program day', () => {
    const saved = saveEnrollment([], { programId: 'first_20' }, '2026-11-01', 'UTC', 'e1');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const sunday = goalForDate(saved.enrollments, '2026-11-01');
    const monday = goalForDate(saved.enrollments, '2026-11-02');
    expect(sunday).toMatchObject({ rest: true, target: 0, setMarker: null });
    expect(monday).toMatchObject({ rest: false, target: 10, setMarker: 5 });
    expect(currentTargetLabel(PROGRAMS[0], 1)).toBe('Week 1 · 10 a day · Sunday off');
    expect(currentTargetLabel(PROGRAMS[0], 8)).toBe('Week 2 · 15 a day · Sunday off');
    expect(currentTargetLabel(PROGRAMS[0], 29)).toBe('Maintaining · 25 a day · Sunday off');
    expect(currentTargetLabel(PROGRAMS[2], 22)).toBe('Week 4 · 100 a day');
  });
});

describe('goal enrollment', () => {
  it('updates a same-day switch in place and closes a later switch', () => {
    const first = saveEnrollment([], { programId: 'first_20' }, '2026-11-02', 'UTC', 'e1');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const sameDay = saveEnrollment(first.enrollments, { customDailyReps: 30 }, '2026-11-02', 'UTC', 'e2');
    expect(sameDay.ok).toBe(true);
    if (!sameDay.ok) return;
    expect(sameDay.enrollments).toHaveLength(1);
    expect(sameDay.enrollments[0]).toMatchObject({ id: 'e1', customDailyReps: 30, programId: null, startedOn: '2026-11-02', endedOn: null });

    const next = saveEnrollment(sameDay.enrollments, { programId: 'fifty_a_day' }, '2026-11-03', 'UTC', 'e3');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.enrollments.map((e) => [e.id, e.startedOn, e.endedOn])).toEqual([
      ['e1', '2026-11-02', '2026-11-03'],
      ['e3', '2026-11-03', null],
    ]);
    expect(goalForDate(next.enrollments, '2026-11-02')).toMatchObject({ customDailyReps: 30, target: 30 });
    expect(goalForDate(next.enrollments, '2026-11-03')).toMatchObject({ programId: 'fifty_a_day', target: 20 });
  });

  it('rejects a custom number outside 5 to 500', () => {
    expect(saveEnrollment([], { customDailyReps: 4 }, '2026-11-02', 'UTC', 'e').ok).toBe(false);
    expect(saveEnrollment([], { customDailyReps: 501 }, '2026-11-02', 'UTC', 'e').ok).toBe(false);
    expect(CUSTOM_GOAL).toMatchObject({ min: 5, max: 500, step: 5, suggested: 30 });
  });

  it('round-trips the phone goal', async () => {
    const kv = new MemoryKV();
    expect(await loadGoal(kv)).toEqual([]);
    const saved = saveEnrollment([], { programId: 'fifty_a_day' }, '2026-11-02', 'UTC', 'e1');
    if (!saved.ok) throw new Error('save');
    await saveGoal(kv, saved.enrollments);
    expect(await loadGoal(kv)).toEqual(saved.enrollments);
  });
});

describe('today', () => {
  const enroll = (id: string, programId: 'first_20' | 'fifty_a_day', startedOn: string, endedOn: string | null = null) => ({
    id,
    programId,
    customDailyReps: null,
    startedOn,
    endedOn,
    recordedTimeZone: 'UTC',
  });

  const custom = (id: string, reps: number, startedOn: string, endedOn: string | null = null) => ({
    id,
    programId: null,
    customDailyReps: reps,
    startedOn,
    endedOn,
    recordedTimeZone: 'UTC',
  });

  it('describes a first launch with no goal', () => {
    const view = buildToday({ workouts: [], enrollments: [], today: '2026-11-02', timeZone: 'UTC' });
    expect(view.ringText).toBe('0');
    expect(view.ringCaption).toBe('Set a goal');
    expect(view.streakLine).toBe('Set a goal to start a streak');
    expect(view.toGoLine).toBeNull();
    expect(view.showSetGoal).toBe(true);
    expect(view.ringProgress).toBeNull();
  });

  it('keeps reps with no fraction until a goal exists', () => {
    const view = buildToday({
      workouts: [workout('2026-11-02', 12)],
      enrollments: [],
      today: '2026-11-02',
      timeZone: 'UTC',
    });
    expect(view.ringText).toBe('12');
    expect(view.ringCaption).toBe('Set a goal');
    expect(view.ringProgress).toBeNull();
  });

  it('fills the ring, counts a streak, and hides toGoLine once the goal is met', () => {
    const enrollments = [custom('e', 20, '2026-11-02')];
    const workouts = [
      workout('2026-10-12', 20),
      workout('2026-10-19', 20),
      workout('2026-10-26', 20),
      workout('2026-11-02', 32, 'today'),
    ];
    const view = buildToday({ workouts, enrollments, today: '2026-11-02', timeZone: 'UTC' });
    expect(view.ringText).toBe('32 / 20');
    expect(view.ringCaption).toBe('+12 past your goal');
    expect(view.ringProgress).toBe(1);
    expect(view.streakLine).toBe('1 day streak');
    expect(view.toGoLine).toBeNull();
    expect(view.showSetGoal).toBe(false);

    const exact = buildToday({
      workouts: [workout('2026-10-12', 20), workout('2026-10-19', 20), workout('2026-10-26', 20), workout('2026-11-02', 20, 'today')],
      enrollments,
      today: '2026-11-02',
      timeZone: 'UTC',
    });
    expect(exact.ringText).toBe('20 / 20');
    expect(exact.ringCaption).toBe('Goal met');
  });

  it('shows N to go when reps are below the daily goal', () => {
    const zero = buildToday({
      workouts: [],
      enrollments: [custom('e', 50, '2026-11-02')],
      today: '2026-11-02',
      timeZone: 'UTC',
    });
    expect(zero.toGoLine).toBe('50 to go');

    const partial = buildToday({
      workouts: [workout('2026-11-02', 17, 'today')],
      enrollments: [custom('e', 30, '2026-11-02')],
      today: '2026-11-02',
      timeZone: 'UTC',
    });
    expect(partial.toGoLine).toBe('13 to go');
    expect(partial.ringText).toBe('17 / 30');
    expect(partial.ringCaption).toBe('');
  });

  it('does not move a rest day and does not count it in the streak', () => {
    const enrollments = [enroll('e', 'first_20', '2026-11-02')];
    const workouts = [workout('2026-11-05', 10), workout('2026-11-06', 10), workout('2026-11-07', 10), workout('2026-11-08', 4, 'sun')];
    const view = buildToday({ workouts, enrollments, today: '2026-11-08', timeZone: 'UTC' });
    expect(view.rest).toBe(true);
    expect(view.ringText).toBe('4');
    expect(view.ringCaption).toBe('Rest day');
    expect(view.streakLine).toBe('3 day streak');
    expect(view.ringProgress).toBeNull();
  });

  it('stops the streak on a missed targeted day and ignores a late sync for the streak only', () => {
    const enrollments = [enroll('e', 'fifty_a_day', '2026-11-02')];
    const missed = buildToday({
      workouts: [workout('2026-11-02', 20), workout('2026-11-04', 20)],
      enrollments,
      today: '2026-11-04',
      timeZone: 'UTC',
    });
    expect(missed.streakLine).toBe('1 day streak');

    const late = {
      ...workout('2026-11-03', 20, 'late'),
      receivedAt: utc('2026-11-03') + 61 * 24 * 60 * 60 * 1000,
    };
    const repaired = buildToday({
      workouts: [workout('2026-11-02', 20), late, workout('2026-11-04', 20)],
      enrollments,
      today: '2026-11-04',
      timeZone: 'UTC',
    });
    expect(repaired.streakLine).toBe('1 day streak');
    expect(repaired.reps).toBe(20);
  });

  it('trusts a phone set with no server receipt', () => {
    const enrollments = [enroll('e', 'fifty_a_day', '2026-11-02')];
    const view = buildToday({
      workouts: [workout('2026-11-02', 20), workout('2026-11-03', 20)],
      enrollments,
      today: '2026-11-03',
      timeZone: 'UTC',
    });
    expect(view.streakLine).toBe('2 day streak');
  });

  it('notes a workout recorded in another zone', () => {
    const enrollments = [enroll('e', 'fifty_a_day', '2026-10-12')];
    const view = buildToday({
      workouts: [{ ...workout('2026-11-02', 10, 'trip'), timeZone: 'America/New_York' }],
      enrollments,
      today: '2026-11-02',
      timeZone: 'UTC',
    });
    expect(view.toGoLine).toBe('40 to go');
    expect(view.travelLine).toBe("Yesterday's workout stays on yesterday at home.");
  });
});

describe('after a set', () => {
  const customGoal = [
    {
      id: 'e',
      programId: null,
      customDailyReps: 50,
      startedOn: '2026-10-01',
      endedOn: null,
      recordedTimeZone: 'UTC',
    },
  ];
  const first20 = [
    {
      id: 'e',
      programId: 'first_20' as const,
      customDailyReps: null,
      startedOn: '2026-11-02',
      endedOn: null,
      recordedTimeZone: 'UTC',
    },
  ];

  it('returns first_set when the merged history has a single set', () => {
    expect(celebrate([workout('2026-11-02', 12, 'only')], customGoal, '2026-11-02', 'UTC', 'only')).toEqual({
      kind: 'first_set',
    });
    expect(celebrate([workout('2026-11-02', 50, 'only')], customGoal, '2026-11-02', 'UTC', 'only')).toEqual({
      kind: 'first_set',
      goalMet: true,
    });
    expect(celebrate([workout('2026-11-02', 0, 'zero')], customGoal, '2026-11-02', 'UTC', 'zero')).toBeNull();
  });

  it('celebrates the highest change and sets goalMet when the goal is newly hit', () => {
    const history = [workout('2026-10-01', 50), workout('2026-10-02', 50), workout('2026-10-03', 50), workout('2026-10-04', 50), workout('2026-10-05', 50)];
    const card = celebrate([...history, workout('2026-11-02', 10, 'earlier'), workout('2026-11-02', 60, 'this')], customGoal, '2026-11-02', 'UTC', 'this');
    expect(card).toEqual({ kind: 'best_set', value: 60, goalMet: true });
  });

  it('returns structured kinds for milestone, longest_streak, best_day, best_week, best_month, goal_met, and set_marker', () => {
    const sets = Array.from({ length: 9 }, (_, i) => workout('2026-10-01', 100, `old-${i}`));
    expect(celebrate([...sets, workout('2026-11-02', 100, 'this')], first20, '2026-11-02', 'UTC', 'this')).toEqual({
      kind: 'milestone',
      value: 1000,
      goalMet: true,
    });

    const streakCard = celebrate(
      [workout('2026-11-02', 10, 'a'), workout('2026-11-03', 10, 'this')],
      first20,
      '2026-11-03',
      'UTC',
      'this',
    );
    expect(streakCard).toEqual({ kind: 'longest_streak', value: 2, goalMet: true });

    const dayCard = celebrate(
      [workout('2026-10-01', 30, 'a'), workout('2026-11-02', 20, 'b'), workout('2026-11-02', 20, 'this')],
      customGoal,
      '2026-11-02',
      'UTC',
      'this',
    );
    expect(dayCard).toEqual({ kind: 'best_day', value: 40 });

    const weekCard = celebrate(
      [
        workout('2026-10-01', 40, 'a'),
        workout('2026-11-02', 30, 'b'),
        workout('2026-11-03', 20, 'this'),
      ],
      customGoal,
      '2026-11-03',
      'UTC',
      'this',
    );
    expect(weekCard).toEqual({ kind: 'best_week', value: 50 });

    const monthCard = celebrate(
      [
        workout('2026-10-05', 40, 'a'),
        workout('2026-10-12', 40, 'b'),
        workout('2026-11-02', 30, 'c'),
        workout('2026-11-09', 30, 'd'),
        workout('2026-11-16', 30, 'this'),
      ],
      customGoal,
      '2026-11-16',
      'UTC',
      'this',
    );
    expect(monthCard).toEqual({ kind: 'best_month', value: 90 });

    const goalCard = celebrate(
      [workout('2026-10-01', 50, 'a'), workout('2026-11-02', 40, 'b'), workout('2026-11-02', 10, 'this')],
      customGoal,
      '2026-11-02',
      'UTC',
      'this',
    );
    expect(goalCard).toEqual({ kind: 'goal_met', value: 50 });

    const markerCard = celebrate(
      [workout('2026-10-06', 30, 'old'), workout('2026-11-02', 10, 'earlier'), workout('2026-11-02', 5, 'this')],
      first20,
      '2026-11-02',
      'UTC',
      'this',
    );
    expect(markerCard).toEqual({ kind: 'set_marker', value: 5 });
  });

  it('does not treat a tie as a new record', () => {
    const card = celebrate(
      [workout('2026-10-06', 50, 'old'), workout('2026-11-02', 20, 'earlier'), workout('2026-11-02', 20, 'this')],
      [
        {
          id: 'e',
          programId: null,
          customDailyReps: 10,
          startedOn: '2026-11-02',
          endedOn: null,
          recordedTimeZone: 'UTC',
        },
      ],
      '2026-11-02',
      'UTC',
      'this',
    );
    expect(card).toBeNull();
  });

  it('completes First 20 on one set of 20 and the other programs when the ramp ends', () => {
    const first = PROGRAMS[0];
    const fifty = PROGRAMS[1];
    const hundred = PROGRAMS[2];
    const enrollment = {
      id: 'e',
      programId: 'first_20' as const,
      customDailyReps: null,
      startedOn: '2026-11-02',
      endedOn: null,
      recordedTimeZone: 'UTC',
    };
    expect(programComplete(first, enrollment, [workout('2026-11-02', 20)], 'UTC', '2026-11-02')).toBe(true);
    expect(programComplete(first, enrollment, [workout('2026-11-02', 19)], 'UTC', '2026-11-02')).toBe(false);
    const ramp = { ...enrollment, programId: 'fifty_a_day' as const };
    expect(programComplete(fifty, ramp, [], 'UTC', '2026-11-29')).toBe(false);
    expect(programComplete(fifty, ramp, [], 'UTC', '2026-11-30')).toBe(true);
    const month = { ...enrollment, programId: 'hundred_in_30' as const, startedOn: '2026-11-02' };
    expect(programComplete(hundred, month, [], 'UTC', addCalendarDays('2026-11-02', 29))).toBe(false);
    expect(programComplete(hundred, month, [], 'UTC', addCalendarDays('2026-11-02', 30))).toBe(true);
  });
});

describe('counted reps and form score', () => {
  it('counts Full and Good reps inside a timer and ignores Shallow', async () => {
    const reps = [rep(1, 'full', 1000), rep(2, 'shallow', 2000), rep(3, 'good', 3000), rep(4, 'full', 70_000)];
    const record = {
      id: 's',
      startedAt: 0,
      endedAt: 80_000,
      summary: summarize(reps, 0, 80_000),
      reps,
      calibratedTopDistance: 0.5,
      depthTracking: true,
      timerDurationS: 60,
      timeZone: 'UTC',
    } satisfies SessionRecord;
    expect(phoneCountedReps(record)).toBe(2);
    await awaitHistory(new MemoryKV(), record);
  });

});

async function awaitHistory(kv: MemoryKV, record: SessionRecord) {
  const store = new HistoryStore(kv);
  await store.add(record);
  const [loaded] = await store.load();
  expect(loaded.timeZone).toBe('UTC');
  expect(loaded.timerDurationS).toBe(60);
}
