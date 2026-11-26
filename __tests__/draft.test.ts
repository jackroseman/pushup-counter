import { DEFAULT_NUDGE_PREFS } from '../src/progress';
import type { GoalEnrollment } from '../src/progress';
import {
  goalDirty,
  goalEdited,
  profileDraftState,
  quietDirty,
  quietDraftOf,
  reminderDirty,
  reminderDraftOf,
} from '../src/progress/draft';

const enrollment = (partial: Partial<GoalEnrollment>): GoalEnrollment => ({
  id: 'g',
  programId: null,
  customDailyReps: null,
  startedOn: '2026-11-01',
  endedOn: null,
  recordedTimeZone: 'UTC',
  ...partial,
});

describe('Daily reminder draft', () => {
  const saved = reminderDraftOf(DEFAULT_NUDGE_PREFS);
  it('is clean until the toggle or the time differs from what is saved', () => {
    expect(reminderDirty(saved, { ...saved })).toBe(false);
    expect(reminderDirty(saved, { ...saved, dailyNudge: !saved.dailyNudge })).toBe(true);
    expect(reminderDirty(saved, { ...saved, nudgeLocalTime: '07:30' })).toBe(true);
  });
  it('is clean again when the edit is undone', () => {
    const changed = { ...saved, nudgeLocalTime: '07:30' };
    expect(reminderDirty(saved, { ...changed, nudgeLocalTime: saved.nudgeLocalTime })).toBe(false);
  });
  it('ignores prefs that other screens own', () => {
    expect(reminderDraftOf({ ...DEFAULT_NUDGE_PREFS, quietStart: '22:00', passPing: false })).toEqual(saved);
  });
});

describe('Quiet hours draft', () => {
  const saved = quietDraftOf(DEFAULT_NUDGE_PREFS);
  it('tracks From and To', () => {
    expect(quietDirty(saved, { ...saved })).toBe(false);
    expect(quietDirty(saved, { ...saved, quietStart: '22:00' })).toBe(true);
    expect(quietDirty(saved, { ...saved, quietEnd: '09:00' })).toBe(true);
  });
});

describe('Goal draft', () => {
  it('program: dirty only for a different program', () => {
    const open = enrollment({ programId: 'fifty_a_day' });
    expect(goalDirty(open, { kind: 'program', programId: 'fifty_a_day' })).toBe(false);
    expect(goalDirty(open, { kind: 'program', programId: 'first_20' })).toBe(true);
  });
  it('custom number: dirty only for a different number, and switching kind is a change', () => {
    const open = enrollment({ customDailyReps: 40 });
    expect(goalDirty(open, { kind: 'custom', customDailyReps: 40 })).toBe(false);
    expect(goalDirty(open, { kind: 'custom', customDailyReps: 45 })).toBe(true);
    expect(goalDirty(open, { kind: 'program', programId: 'fifty_a_day' })).toBe(true);
    expect(goalDirty(enrollment({ programId: 'fifty_a_day' }), { kind: 'custom', customDailyReps: 50 })).toBe(true);
  });
  it('with no goal, any pick can be saved, but only a changed pick needs a Discard prompt', () => {
    expect(goalDirty(null, { kind: 'program', programId: 'fifty_a_day' })).toBe(true);
    expect(goalEdited(null, { kind: 'program', programId: 'fifty_a_day' }, 'fifty_a_day')).toBe(false);
    expect(goalEdited(null, { kind: 'program', programId: 'first_20' }, 'fifty_a_day')).toBe(true);
    expect(goalEdited(null, { kind: 'custom', customDailyReps: 30 }, 'fifty_a_day')).toBe(true);
  });
});

describe('Profile draft', () => {
  const saved = { username: 'sunny', displayName: 'Sunny' };
  it('is clean with the saved values, and ignores case, spaces and display-name padding', () => {
    expect(profileDraftState(saved, { username: 'sunny', displayName: 'Sunny' }, 'unknown')).toEqual({ dirty: false, canSave: false });
    expect(profileDraftState(saved, { username: ' Sunny ', displayName: ' Sunny ' }, 'unknown').dirty).toBe(false);
    expect(profileDraftState({ username: 'sunny', displayName: null }, { username: 'sunny', displayName: '  ' }, 'unknown').dirty).toBe(false);
  });
  it('a display-name change can be saved without a username check', () => {
    expect(profileDraftState(saved, { username: 'sunny', displayName: 'Sun' }, 'unknown')).toEqual({ dirty: true, canSave: true });
  });
  it('a new username needs to be valid and confirmed free', () => {
    const draft = { username: 'sunny_2', displayName: 'Sunny' };
    expect(profileDraftState(saved, draft, 'checking')).toEqual({ dirty: true, canSave: false });
    expect(profileDraftState(saved, draft, 'taken')).toEqual({ dirty: true, canSave: false });
    expect(profileDraftState(saved, draft, 'unknown').canSave).toBe(false);
    expect(profileDraftState(saved, draft, 'free')).toEqual({ dirty: true, canSave: true });
    expect(profileDraftState(saved, { username: 'ab', displayName: 'Sunny' }, 'free').canSave).toBe(false);
    expect(profileDraftState(saved, { username: 'sunny', displayName: 'x'.repeat(200) }, 'unknown').canSave).toBe(false);
  });
});
