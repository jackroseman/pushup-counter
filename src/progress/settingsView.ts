import { goalForDate, type GoalEnrollment } from './goals';
import { formatCount } from './progress';

/** `18:00` → `6:00 PM`. */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/** `21:00` → `9 PM`, `21:30` → `9:30 PM` (the Settings quiet hours value). */
export function shortClockLabel(hhmm: string): string {
  const full = clockLabel(hhmm);
  return full.replace(':00 ', ' ');
}

/** `9 PM – 8 AM`. */
export function quietHoursLabel(start: string, end: string): string {
  return `${shortClockLabel(start)} – ${shortClockLabel(end)}`;
}

/** `HH:MM` ↔ a Date today (for the native time picker). */
export function clockToDate(hhmm: string, base: Date = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base.getTime());
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

export function dateToClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Today's daily goal for Settings: `50 a day`, `Rest day`, or null when no goal covers today (E15).
 * Daily reminders only exist while a goal is set (plan §0 / gap 19).
 */
export function goalValue(enrollments: readonly GoalEnrollment[], today: string): string | null {
  const goal = goalForDate(enrollments, today);
  if (!goal) return null;
  if (goal.rest || goal.target <= 0) return 'Rest day';
  return `${formatCount(goal.target)} a day`;
}

/** The target the reminder preview quotes: today's, else the next day with one (up to a week out). */
export function reminderTarget(enrollments: readonly GoalEnrollment[], today: string, addDays: (iso: string, n: number) => string): number | null {
  for (let i = 0; i < 8; i++) {
    const goal = goalForDate(enrollments, addDays(today, i));
    if (goal && !goal.rest && goal.target > 0) return goal.target;
  }
  return null;
}

/** "Sets backed up" value. */
export function backupValue(status: { eligible: number; backedUp: number } | null, running: boolean): string {
  if (running) return 'Backing up';
  if (!status) return 'Not yet';
  if (status.eligible === 0) return 'No sets yet';
  if (status.backedUp >= status.eligible) return 'All';
  return `${formatCount(status.backedUp)} of ${formatCount(status.eligible)}`;
}

/**
 * What the daily reminder says (the Daily reminder preview). Same text as the on-phone reminder in
 * RootNavigator and the server `daily_nudge` push (tests keep them equal).
 */
export function reminderPreview(target: number): { title: string; body: string } {
  return { title: 'Today', body: `No push-ups yet today. Your goal is ${target}.` };
}
