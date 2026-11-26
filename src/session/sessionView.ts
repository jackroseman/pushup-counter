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

/** Face diagnostics counted by useSession for the dev-only line on the face screen (remove in PR 15). */
export interface FaceDiag {
  /** startFaceDistance result: "ok" also means camera access was granted. */
  faceStart: 'pending' | 'ok' | 'failed';
  /** onFaceDistance events (native sends every tracked sample, the first lost one of a gap, and one per interruption). */
  events: number;
  tracked: number;
  lastEventAt: number;
  lastError: string | null;
  /** JS calls to PushupSensors.startFaceDistance / stopFaceDistance, and sensor-effect runs, this set. */
  starts: number;
  stops: number;
  effects: number;
  /** Core Motion (flat check): on, off (stopped from the dev line), or skipped for this set. */
  motion: 'pending' | 'on' | 'off' | 'skipped' | 'none';
}

export function emptyFaceDiag(): FaceDiag {
  return { faceStart: 'pending', events: 0, tracked: 0, lastEventAt: 0, lastError: null, starts: 0, stops: 0, effects: 0, motion: 'pending' };
}

/**
 * One dense line, e.g. "cam ok · view 362x380 minimal · ev 12/9 · last 0.2s · start 1 stop 0 fx 1 · motion on".
 * view "-" = the face view's card has not been laid out yet.
 */
export function faceDiagLine(
  d: FaceDiag,
  view: { width: number; height: number } | null,
  variant: 'full' | 'minimal',
  now: number
): string {
  const parts = [
    `cam ${d.faceStart}`,
    view ? `view ${Math.round(view.width)}x${Math.round(view.height)} ${variant}` : `view - ${variant}`,
    `ev ${d.events}/${d.tracked}`,
    d.lastEventAt ? `last ${(Math.max(0, now - d.lastEventAt) / 1000).toFixed(1)}s` : 'last -',
    `start ${d.starts} stop ${d.stops} fx ${d.effects}`,
    `motion ${d.motion}`,
  ];
  if (d.lastError) parts.push(`err ${d.lastError}`);
  return parts.join(' · ');
}

/**
 * Pushup Dev (APP_VARIANT=development: app name "Pushup Dev", bundle id ending ".dev"; see
 * app.config.ts) or a Metro dev bundle.
 */
export function isDevVariant(
  config: { name?: string; ios?: { bundleIdentifier?: string } } | null | undefined,
  dev: boolean
): boolean {
  if (dev) return true;
  if (!config) return false;
  return config.name === 'Pushup Dev' || (config.ios?.bundleIdentifier ?? '').endsWith('.dev');
}
