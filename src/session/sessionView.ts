/**
 * Pure helpers for the set screens (frames 6–10). No React or native imports, so they are
 * unit-tested in __tests__/sessionView.test.ts.
 */
import type { Battle } from '../battles/model';
import { personName } from '../battles/model';
import type { GuideSnapshot } from '../core';
import { localDate } from '../progress/calendar';

/** m:ss for a duration in ms (negative counts as 0). */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Small title over the counting screen: "Set 4 · 0:41". A challenge attempt shows its own clock. */
export function countingTitle({
  setNumber,
  elapsedMs,
  battleClock,
  isBattle,
}: {
  setNumber: number | null;
  elapsedMs: number;
  battleClock?: string;
  isBattle?: boolean;
}): string {
  const time = clockText(elapsedMs);
  if (isBattle) return battleClock ? `Challenge · ${battleClock}` : `Challenge · ${time}`;
  return setNumber ? `Set ${setNumber} · ${time}` : time;
}

/** Which number today's next set is (1 for the first set today). */
export function nextSetNumber(startedAts: readonly number[], nowMs: number, timeZone: string): number {
  const today = localDate(nowMs, timeZone);
  return startedAts.filter((t) => localDate(t, timeZone) === today).length + 1;
}

/**
 * "31 to beat Brett" while doing a best-set challenge attempt. The best score among the other
 * players is the bar; null when there's nobody to beat yet or the bar is already passed.
 */
export function toBeatLine(battle: Pick<Battle, 'participants'> | undefined, count: number): string | null {
  if (!battle) return null;
  let rival: Battle['participants'][number] | null = null;
  for (const p of battle.participants) {
    if (p.isMe || p.validReps == null || p.validReps <= 0) continue;
    if (!rival || p.validReps > (rival.validReps ?? 0)) rival = p;
  }
  if (!rival) return null;
  const need = (rival.validReps ?? 0) + 1 - count;
  if (need <= 0) return null;
  return `${need} to beat ${personName(rival)}`;
}

/** The 3-2-1 ring: share of the countdown still to go (3 → full ring). */
export function countdownProgress(value: number | null, total: number): number {
  if (value === null || total <= 0) return 0;
  return Math.max(0, Math.min(1, value / total));
}

export const CENTER_FACE_LINE = 'Get into top position and hold still.';

/** Face-centering state for frame 7: pills, frame color and the line under the title. */
export function faceCenteringView(guide: GuideSnapshot | null): {
  centered: boolean;
  ready: boolean;
  progress: number;
  line: string;
} {
  if (!guide) return { centered: false, ready: false, progress: 0, line: CENTER_FACE_LINE };
  const { pose } = guide;
  return {
    centered: pose.centered === 'ok',
    ready: pose.ok,
    progress: Math.max(0, Math.min(1, guide.progress)),
    line: pose.ok ? CENTER_FACE_LINE : guide.message,
  };
}

/** How long face centering waits for a first tracked face before it restarts face tracking. */
export const FACE_RESTART_MS = 4000;

/**
 * True when face centering has gone FACE_RESTART_MS with no tracked face, counted from the
 * latest of: centering started, the last tracked sample, the last restart. Restarting the
 * shared camera session is harmless before counting starts, and recovers a session that
 * stopped delivering faces (the screen otherwise waits forever on "Face not found").
 */
export function faceRestartDue({
  now,
  since,
  lastTracked,
  lastRestart,
  gapMs = FACE_RESTART_MS,
}: {
  now: number;
  since: number;
  lastTracked: number;
  lastRestart: number;
  gapMs?: number;
}): boolean {
  return now - Math.max(since, lastTracked, lastRestart) >= gapMs;
}
