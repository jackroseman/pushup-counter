import type { GoalEnrollment } from './goals';
import type { ProgramId } from './programs';
import type { NudgePrefs } from './nudges';
import { normalizeUsername, usernameError, displayNameError } from '../backend/profile';

/**
 * Dirty-state rules for the Settings edit screens. An edit screen holds a local draft; Save is enabled
 * only while the draft differs from what is saved. Pure, so the rules are unit-tested.
 */

export type ReminderDraft = Pick<NudgePrefs, 'dailyNudge' | 'nudgeLocalTime'>;
export type QuietDraft = Pick<NudgePrefs, 'quietStart' | 'quietEnd'>;

export const reminderDraftOf = (p: NudgePrefs): ReminderDraft => ({ dailyNudge: p.dailyNudge, nudgeLocalTime: p.nudgeLocalTime });
export const quietDraftOf = (p: NudgePrefs): QuietDraft => ({ quietStart: p.quietStart, quietEnd: p.quietEnd });

export function reminderDirty(saved: ReminderDraft, draft: ReminderDraft): boolean {
  return saved.dailyNudge !== draft.dailyNudge || saved.nudgeLocalTime !== draft.nudgeLocalTime;
}

export function quietDirty(saved: QuietDraft, draft: QuietDraft): boolean {
  return saved.quietStart !== draft.quietStart || saved.quietEnd !== draft.quietEnd;
}

export type GoalDraft = { kind: 'program'; programId: ProgramId } | { kind: 'custom'; customDailyReps: number };

/** The open goal as a draft, or null with no goal. */
export function goalDraftOf(open: GoalEnrollment | null): GoalDraft | null {
  if (!open) return null;
  if (open.programId) return { kind: 'program', programId: open.programId };
  return { kind: 'custom', customDailyReps: open.customDailyReps ?? 0 };
}

/** With no goal saved, any pick is a change (it creates the goal). */
export function goalDirty(open: GoalEnrollment | null, draft: GoalDraft): boolean {
  const saved = goalDraftOf(open);
  if (!saved) return true;
  if (saved.kind === 'program' && draft.kind === 'program') return saved.programId !== draft.programId;
  if (saved.kind === 'custom' && draft.kind === 'custom') return saved.customDailyReps !== draft.customDailyReps;
  return true;
}

/** Something was picked beyond what the sheet opened with (nothing to discard if not). */
export function goalEdited(open: GoalEnrollment | null, draft: GoalDraft, defaultProgram: ProgramId): boolean {
  if (open) return goalDirty(open, draft);
  return !(draft.kind === 'program' && draft.programId === defaultProgram);
}

export interface ProfileFields {
  username: string;
  displayName: string;
}

export type Availability = 'unknown' | 'checking' | 'free' | 'taken';

/** Editing an existing profile: Save needs a real change, a valid form and a free (or unchanged) username. */
export function profileDraftState(
  saved: { username: string; displayName: string | null },
  draft: ProfileFields,
  availability: Availability,
): { dirty: boolean; canSave: boolean } {
  const username = normalizeUsername(draft.username);
  const dirty = username !== saved.username || draft.displayName.trim() !== (saved.displayName ?? '').trim();
  const valid = username !== '' && usernameError(username) == null && displayNameError(draft.displayName) == null;
  const settled = username === saved.username || availability === 'free';
  return { dirty, canSave: dirty && valid && settled };
}
