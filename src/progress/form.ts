import type { FormScoreWeights } from '../backend/appSettings';
import type { Rep } from '../core';
import { countedRepList } from './workouts';

export interface FormScore {
  score: number | null;
  tempo: number | null;
  tempoCaption: string | null;
}

function stddevPop(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/** 100 × (1 − CV) of the gaps between consecutive counted reps. Null below 3 counted reps. */
export function tempoScore(gapsMs: readonly number[]): number | null {
  if (gapsMs.length < 2) return null;
  const mean = gapsMs.reduce((a, b) => a + b, 0) / gapsMs.length;
  if (!(mean > 0)) return null;
  const score = Math.max(0, 100 * (1 - stddevPop(gapsMs) / mean));
  return Math.round(score * 10) / 10;
}

export function formScoreForReps(
  reps: readonly Rep[],
  weights: FormScoreWeights,
  opts: { startedAt: number; timerDurationS?: number },
): FormScore {
  const counted = countedRepList(reps, opts.startedAt, opts.timerDurationS);
  const gaps: number[] = [];
  for (let i = 1; i < counted.length; i++) {
    const gap = counted[i].timestamp - counted[i - 1].timestamp;
    if (gap > 0) gaps.push(gap);
  }
  const tempo = tempoScore(gaps);
  const depths = counted.map((r) => r.depthRatio).filter((d): d is number => d != null && Number.isFinite(d)).map((d) => d * 100);
  if (depths.length === 0) return { score: null, tempo, tempoCaption: tempo == null ? 'Tempo needs 3 counted reps' : null };
  const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
  const consistency = Math.max(0, 100 - 4 * stddevPop(depths));
  const raw = weights.depth * avgDepth + weights.consistency * consistency + weights.tempo * (tempo ?? 0);
  return {
    score: Math.round(raw * 10) / 10,
    tempo,
    tempoCaption: tempo == null ? 'Tempo needs 3 counted reps' : null,
  };
}

export function formatFormScore(score: number | null): string {
  if (score == null) return '—';
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
