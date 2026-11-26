import { HOWTO_KEY } from '../src/progress/howto';
import { ONBOARDED_KEY, loadOnboarded, markOnboarded, needsOnboarding } from '../src/progress/onboarding';
import { DEFAULT_PROGRAM, goalSummary, programBars, programCards } from '../src/ui/models/goal';
import { PROGRAMS, type GoalEnrollment } from '../src/progress';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe('onboarding gate', () => {
  const fresh = { onboarded: false, howToSeen: false, setCount: 0, signedIn: false };
  it('a fresh install sees Welcome → goal → How it works', () => {
    expect(needsOnboarding(fresh)).toBe(true);
  });
  it('existing users skip it', () => {
    expect(needsOnboarding({ ...fresh, onboarded: true })).toBe(false);
    expect(needsOnboarding({ ...fresh, howToSeen: true })).toBe(false);
    expect(needsOnboarding({ ...fresh, setCount: 3 })).toBe(false);
    expect(needsOnboarding({ ...fresh, signedIn: true })).toBe(false);
  });
  it('reads both keys and writes the done flag', async () => {
    const kv = memory({ [HOWTO_KEY]: '1' });
    expect(await loadOnboarded(kv)).toEqual({ onboarded: false, howToSeen: true });
    await markOnboarded(kv);
    expect(kv.data.get(ONBOARDED_KEY)).toBe('1');
    expect(await loadOnboarded(kv)).toEqual({ onboarded: true, howToSeen: true });
  });
  it('unreadable storage never traps anyone in onboarding', async () => {
    const broken = { getItem: async () => Promise.reject(new Error('x')), setItem: async () => {} };
    const stored = await loadOnboarded(broken);
    expect(needsOnboarding({ ...stored, setCount: 0, signedIn: false })).toBe(false);
  });
});

describe('goal picker (frame 2)', () => {
  it('has the three programs with the mockup copy, and picks the middle one', () => {
    expect(programCards().map((c) => [c.title, c.summary, c.length])).toEqual([
      ['First 20 in a row', 'Build to 20 reps in one set', '4 weeks'],
      ['50 a day', 'Work up to 50 reps a day', '4 weeks'],
      ['100 a day', 'Reach 100 reps a day', '30 days'],
    ]);
    expect(DEFAULT_PROGRAM).toBe(programCards()[1].id);
  });
  it('draws one bar per week, scaled to the top week', () => {
    const fifty = PROGRAMS.find((p) => p.id === 'fifty_a_day')!;
    expect(programBars(fifty).map((b) => b.height)).toEqual([0.4, 0.6, 0.8, 1]);
    expect(programBars(fifty, 3).map((b) => b.current)).toEqual([false, false, true, false]);
  });
});

describe('goal sheet (frame 5)', () => {
  const enr = (extra: Partial<GoalEnrollment>): GoalEnrollment[] => [
    { id: 'e', programId: null, customDailyReps: null, startedOn: '2026-11-09', endedOn: null, recordedTimeZone: 'America/New_York', ...extra },
  ];
  it('no goal: nothing to summarize (the sheet opens on the picker)', () => {
    expect(goalSummary([], '2026-11-25')).toBeNull();
    expect(goalSummary(enr({ programId: 'fifty_a_day', endedOn: '2026-11-20' }), '2026-11-25')).toBeNull();
  });
  it('a program: week N of M, the current week lit, and today\'s number', () => {
    expect(goalSummary(enr({ programId: 'fifty_a_day' }), '2026-11-25')).toEqual({
      kind: 'program',
      programId: 'fifty_a_day',
      title: '50 a day',
      detail: 'Week 3 of 4',
      bars: [
        { height: 0.4, current: false },
        { height: 0.6, current: false },
        { height: 0.8, current: true },
        { height: 1, current: false },
      ],
      dailyTarget: 40,
    });
  });
  it('a program with Sundays off says so', () => {
    expect(goalSummary(enr({ programId: 'first_20' }), '2026-11-10')?.detail).toBe('Week 1 of 4 · Sundays off');
  });
  it('after the last week', () => {
    const s = goalSummary(enr({ programId: 'fifty_a_day', startedOn: '2026-10-01' }), '2026-11-25');
    expect(s).toMatchObject({ detail: 'Program done', dailyTarget: 50 });
    expect(s?.kind === 'program' && s.bars.some((b) => b.current)).toBe(false);
  });
  it('a custom number', () => {
    expect(goalSummary(enr({ customDailyReps: 35 }), '2026-11-25')).toEqual({ kind: 'custom', title: '35 a day', detail: 'Every day', dailyTarget: 35 });
  });
});
