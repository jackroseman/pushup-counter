import type { AsyncBattleDefaults, StreakLengths, TeamTargets } from '../backend/appSettings';
import type { ChallengeKind } from './model';

/** The New challenge sheet's choices (frame 21). */
export interface NewChallengeForm {
  kind: ChallengeKind;
  /** Best set: seconds per set, or null for one untimed set. */
  durationS: number | null;
  /** Best set: hours everyone has to play. */
  deadlineHours: number;
  /** Most reps / team: local days from the start of today. */
  durationDays: 1 | 7 | 14 | 30;
  /** Streak: length in days. */
  streakDays: number;
  /** Team: the shared goal. */
  targetReps: number;
  friendIds: string[];
}

export const KIND_TILES: { kind: ChallengeKind; title: string; line: string }[] = [
  { kind: 'best_set', title: 'Best set', line: 'One set, most reps' },
  { kind: 'total', title: 'Most reps', line: 'Total over the length' },
  { kind: 'streak', title: 'Streak', line: 'Hit your goal every day' },
  { kind: 'team', title: 'Team', line: 'Reach a goal together' },
];

export interface LengthOption {
  key: string;
  label: string;
}

/** "6 hours", "1 day", "3 days", "1 week". */
export function hoursLabel(h: number): string {
  if (h === 168) return '1 week';
  if (h % 24 === 0) return h === 24 ? '1 day' : `${h / 24} days`;
  return h === 1 ? '1 hour' : `${h} hours`;
}

const DURATIONS: { key: '1' | '7' | '14' | '30'; label: string; days: 1 | 7 | 14 | 30 }[] = [
  { key: '1', label: '1 day', days: 1 },
  { key: '7', label: '7 days', days: 7 },
  { key: '14', label: '14 days', days: 14 },
  { key: '30', label: '30 days', days: 30 },
];

/** The Length segments for a kind. Values come from app settings, so they can change without a release. */
export function lengthOptions(kind: ChallengeKind, s: { battle: AsyncBattleDefaults; streak: StreakLengths }): LengthOption[] {
  if (kind === 'best_set') {
    const hours = [...new Set([...s.battle.deadlineOptionsHours, s.battle.deadlineHours])]
      .filter((h) => h <= s.battle.maxDeadlineHours)
      .sort((a, b) => a - b);
    return hours.map((h) => ({ key: String(h), label: hoursLabel(h) }));
  }
  if (kind === 'streak') return s.streak.optionsDays.map((d) => ({ key: String(d), label: `${d} days` }));
  return DURATIONS.map((w) => ({ key: w.key, label: w.label }));
}

/** Which Length segment is on. */
export function lengthKey(form: NewChallengeForm): string {
  if (form.kind === 'best_set') return String(form.deadlineHours);
  if (form.kind === 'streak') return String(form.streakDays);
  return String(form.durationDays);
}

/** Apply a Length segment. */
export function withLength(form: NewChallengeForm, key: string): NewChallengeForm {
  if (form.kind === 'best_set') return { ...form, deadlineHours: Number(key) };
  if (form.kind === 'streak') return { ...form, streakDays: Number(key) };
  return { ...form, durationDays: Number(key) as NewChallengeForm['durationDays'] };
}

/** "60 s", "2 min", "No limit". */
export function timeLimitLabel(durationS: number | null): string {
  if (!durationS) return 'No limit';
  return durationS % 60 === 0 && durationS >= 120 ? `${durationS / 60} min` : `${durationS} s`;
}

/** First form: rematch / from-set settings if given, else the mockup defaults (best set, 60 s). */
export function initialForm(
  s: { battle: AsyncBattleDefaults; streak: StreakLengths; team: TeamTargets },
  offer?: { kind: ChallengeKind; durationS?: number | null; durationDays?: 1 | 7 | 14 | 30; window?: 'day' | 'week' | 'month' },
  friendIds?: string[],
  setTimerS?: number | null,
): NewChallengeForm {
  const kind = offer?.kind ?? 'best_set';
  const durationS =
    offer?.kind === 'best_set' ? (offer.durationS ?? null) : setTimerS !== undefined ? setTimerS : (s.battle.timedDurationsS[0] ?? null);
  return {
    kind,
    durationS,
    deadlineHours: s.battle.deadlineHours,
    durationDays: offer?.durationDays ?? (offer?.window === 'day' ? 1 : offer?.window === 'month' ? 30 : 7),
    streakDays: s.streak.optionsDays[0] ?? s.streak.minDays,
    targetReps: s.team.defaultTarget,
    friendIds: friendIds ?? [],
  };
}

/** Switching kind keeps friends; most reps defaults to this week, team to its default window. */
export function withKind(form: NewChallengeForm, kind: ChallengeKind, team: TeamTargets): NewChallengeForm {
  if (kind === form.kind) return form;
  return { ...form, kind, durationDays: kind === 'team' || kind === 'total' ? form.durationDays || 7 : form.durationDays };
}

/** The `create_challenge` payload. No `metric`: every new challenge counts reps. No invite link from the sheet. */
export function newChallengePayload(form: NewChallengeForm) {
  return {
    kind: form.kind,
    durationS: form.kind === 'best_set' ? (form.durationS ?? undefined) : undefined,
    deadlineHours: form.kind === 'best_set' ? form.deadlineHours : undefined,
    durationDays: form.kind === 'total' || form.kind === 'team' ? form.durationDays : undefined,
    streakDays: form.kind === 'streak' ? form.streakDays : undefined,
    targetReps: form.kind === 'team' ? form.targetReps : undefined,
    friendIds: [...form.friendIds],
    inviteLink: false,
  };
}

/** Send is on once at least one friend is picked. */
export function canSend(form: NewChallengeForm): boolean {
  return form.friendIds.length > 0;
}
