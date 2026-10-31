import { Rep } from './types';

export interface SessionSummary {
  totalReps: number;
  fullReps: number;
  goodReps: number;
  shallowReps: number;
  /** 0..100, rounded. */
  percentFull: number;
  /** Average range of motion in centimeters over reps that had depth data, null if none. */
  avgRangeOfMotionCm: number | null;
  durationSec: number;
}

export function summarize(reps: readonly Rep[], startedAt: number, endedAt: number): SessionSummary {
  const full = reps.filter((r) => r.quality === 'full').length;
  const good = reps.filter((r) => r.quality === 'good').length;
  const shallow = reps.filter((r) => r.quality === 'shallow').length;
  const roms = reps.map((r) => r.rangeOfMotion).filter((v): v is number => v !== null && Number.isFinite(v));
  const avgRom = roms.length ? roms.reduce((a, b) => a + b, 0) / roms.length : null;
  return {
    totalReps: reps.length,
    fullReps: full,
    goodReps: good,
    shallowReps: shallow,
    percentFull: reps.length ? Math.round((full / reps.length) * 100) : 0,
    avgRangeOfMotionCm: avgRom === null ? null : Math.round(avgRom * 1000) / 10,
    durationSec: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
  };
}
