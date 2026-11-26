import { buildNotification } from '../supabase/functions/_shared/notificationContent';
import { addCalendarDays } from '../src/progress';
import type { GoalEnrollment } from '../src/progress';
import {
  backupValue,
  clockLabel,
  clockToDate,
  dateToClock,
  goalValue,
  quietHoursLabel,
  reminderPreview,
  reminderTarget,
} from '../src/progress/settingsView';

const custom = (startedOn: string, reps: number, endedOn: string | null = null): GoalEnrollment => ({
  id: `g-${startedOn}`,
  programId: null,
  customDailyReps: reps,
  startedOn,
  endedOn,
  recordedTimeZone: 'UTC',
});

describe('Settings values (frame 29, E15)', () => {
  it('formats reminder and quiet-hours times as in the mockup', () => {
    expect(clockLabel('18:00')).toBe('6:00 PM');
    expect(clockLabel('00:05')).toBe('12:05 AM');
    expect(clockLabel('12:30')).toBe('12:30 PM');
    expect(quietHoursLabel('21:00', '08:00')).toBe('9 PM – 8 AM');
    expect(quietHoursLabel('21:30', '07:00')).toBe('9:30 PM – 7 AM');
  });

  it('round-trips the time picker value', () => {
    for (const hhmm of ['00:00', '06:05', '18:00', '23:55']) expect(dateToClock(clockToDate(hhmm, new Date(2026, 10, 25)))).toBe(hhmm);
  });

  it('Daily goal reads "50 a day", or null (Not set, E15) with no goal today', () => {
    expect(goalValue([custom('2026-11-01', 50)], '2026-11-25')).toBe('50 a day');
    expect(goalValue([custom('2026-11-01', 1200)], '2026-11-25')).toBe('1,200 a day');
    expect(goalValue([], '2026-11-25')).toBeNull();
    expect(goalValue([custom('2026-10-01', 50, '2026-11-01')], '2026-11-25')).toBeNull();
  });

  it('the reminder preview quotes the goal and matches the reminder the server sends', () => {
    expect(reminderTarget([custom('2026-11-01', 50)], '2026-11-25', addCalendarDays)).toBe(50);
    expect(reminderTarget([], '2026-11-25', addCalendarDays)).toBeNull();
    const server = buildNotification({ id: 1, user_id: 'u', kind: 'daily_nudge', challenge_id: null, facts: { nudge: { target: 50, reps: 0, rest: false } } })!;
    expect(reminderPreview(50)).toEqual({ title: server.title, body: server.body });
  });

  it('Sets backed up', () => {
    expect(backupValue({ eligible: 12, backedUp: 12 }, false)).toBe('All');
    expect(backupValue({ eligible: 12, backedUp: 10 }, false)).toBe('10 of 12');
    expect(backupValue({ eligible: 0, backedUp: 0 }, false)).toBe('No sets yet');
    expect(backupValue(null, false)).toBe('Not yet');
    expect(backupValue({ eligible: 12, backedUp: 10 }, true)).toBe('Backing up');
  });
});
