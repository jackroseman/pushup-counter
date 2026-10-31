import { median } from './scoring';
import { Rep, RepQuality } from './types';

export interface RepValue {
  /** 1-based rep number. */
  rep: number;
  value: number;
}

export type TempoTrend = 'slowing' | 'steady' | 'speeding-up';
export type DepthConsistency = 'very consistent' | 'consistent' | 'variable';

export interface SetAnalysis {
  totalReps: number;
  fullReps: number;
  goodReps: number;
  shallowReps: number;
  /** Start of the set (after calibration) to "End set", seconds. */
  durationSec: number;
  /** Start of the first rep to the end of the last rep, seconds. */
  activeDurationSec: number | null;
  /** Reps per minute over the active part of the set. */
  repsPerMinute: number | null;

  /** Time between consecutive reps (completion to completion), seconds; rep = the later rep (2..n). */
  intervals: RepValue[];
  avgIntervalSec: number | null;
  medianIntervalSec: number | null;
  /** Fatigue: mean interval of the last third vs the first third. Needs >= 3 intervals. */
  tempo: { firstThirdSec: number; lastThirdSec: number; changePct: number; trend: TempoTrend } | null;

  /** Depth per rep, 0..100 (reps without depth data are skipped). */
  depthPcts: (RepValue & { quality: RepQuality })[];
  avgDepthPct: number | null;
  /** Standard deviation of depth %, in percentage points. */
  depthStdPct: number | null;
  depthConsistency: DepthConsistency | null;
  /** Avg depth % of the last third minus the first third (negative = getting shallower). */
  depthChangePct: number | null;

  avgDescentSec: number | null;
  avgAscentSec: number | null;
  /** Rep time = descent + ascent (falls back to time between reps for older sets). */
  repTimes: RepValue[];
  fastestRep: RepValue | null;
  slowestRep: RepValue | null;
}

export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function stdDev(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null) return null;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) * (v - m), 0) / values.length);
}

/** Mean of the first and last third of a series (at least one element each). */
export function thirds(values: readonly number[]): { first: number; last: number } | null {
  if (values.length < 3) return null;
  const k = Math.max(1, Math.floor(values.length / 3));
  return { first: mean(values.slice(0, k))!, last: mean(values.slice(values.length - k))! };
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const orNull = (v: number | null, f: (x: number) => number) => (v === null ? null : f(v));

/** Pure analysis of one set. Works for older saved sets too (missing timing fields are skipped). */
export function analyzeSet(reps: readonly Rep[], startedAt: number, endedAt: number): SetAnalysis {
  const count = (q: RepQuality) => reps.filter((r) => r.quality === q).length;

  // Time between reps.
  const intervals: RepValue[] = [];
  for (let i = 1; i < reps.length; i++) {
    const ms = isNum(reps[i].intervalMs) ? reps[i].intervalMs! : reps[i].timestamp - reps[i - 1].timestamp;
    if (ms > 0) intervals.push({ rep: reps[i].index, value: r2(ms / 1000) });
  }
  const iv = intervals.map((x) => x.value);
  const t = thirds(iv);
  let tempo: SetAnalysis['tempo'] = null;
  if (t && t.first > 0) {
    const changePct = ((t.last - t.first) / t.first) * 100;
    tempo = {
      firstThirdSec: r2(t.first),
      lastThirdSec: r2(t.last),
      changePct: Math.round(changePct),
      trend: changePct > 10 ? 'slowing' : changePct < -10 ? 'speeding-up' : 'steady',
    };
  }

  // Depth.
  const depthPcts = reps
    .filter((r) => isNum(r.depthRatio))
    .map((r) => ({ rep: r.index, value: Math.round(r.depthRatio! * 100), quality: r.quality }));
  const dv = depthPcts.map((x) => x.value);
  const depthStd = stdDev(dv);
  const dt = thirds(dv);

  // Rep timing.
  const descents = reps.map((r) => r.descentMs).filter(isNum);
  const ascents = reps.map((r) => r.ascentMs).filter(isNum);
  const timed = reps.filter((r) => isNum(r.descentMs) && isNum(r.ascentMs));
  const repTimes: RepValue[] = timed.length
    ? timed.map((r) => ({ rep: r.index, value: r2((r.descentMs! + r.ascentMs!) / 1000) }))
    : intervals;
  const fastest = repTimes.reduce<RepValue | null>((b, x) => (b === null || x.value < b.value ? x : b), null);
  const slowest = repTimes.reduce<RepValue | null>((b, x) => (b === null || x.value > b.value ? x : b), null);

  // Active duration.
  let activeMs: number | null = null;
  if (reps.length) {
    const first = reps[0];
    const begin = isNum(first.startedAt) ? first.startedAt : startedAt;
    activeMs = Math.max(0, reps[reps.length - 1].timestamp - begin);
  }
  const rpm = reps.length >= 2 && iv.length ? 60 / mean(iv)! : null;

  return {
    totalReps: reps.length,
    fullReps: count('full'),
    goodReps: count('good'),
    shallowReps: count('shallow'),
    durationSec: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
    activeDurationSec: activeMs === null ? null : r1(activeMs / 1000),
    repsPerMinute: orNull(rpm, r1),
    intervals,
    avgIntervalSec: orNull(mean(iv), r2),
    medianIntervalSec: iv.length ? r2(median(iv)) : null,
    tempo,
    depthPcts,
    avgDepthPct: orNull(mean(dv), Math.round),
    depthStdPct: orNull(depthStd, r1),
    depthConsistency:
      depthStd === null || dv.length < 2 ? null : depthStd < 6 ? 'very consistent' : depthStd < 12 ? 'consistent' : 'variable',
    depthChangePct: dt ? Math.round(dt.last - dt.first) : null,
    avgDescentSec: orNull(mean(descents), (v) => r2(v / 1000)),
    avgAscentSec: orNull(mean(ascents), (v) => r2(v / 1000)),
    repTimes,
    fastestRep: fastest,
    slowestRep: slowest,
  };
}

export function tempoTrendLabel(t: SetAnalysis['tempo']): string {
  if (!t) return 'Not enough reps';
  if (t.trend === 'slowing') return `Slowed down ${t.changePct}%`;
  if (t.trend === 'speeding-up') return `Sped up ${Math.abs(t.changePct)}%`;
  return 'Steady pace';
}
