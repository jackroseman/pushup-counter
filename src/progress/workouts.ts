import type { Rep } from '../core';
import { SessionRecord } from '../storage/history';
import { localDate } from './calendar';

export interface Workout {
  id: string;
  startedAt: number;
  timeZone?: string;
  countedReps: number;
  /** Server receipt, ms. Absent on a set that never left the phone. */
  receivedAt?: number;
}

export function workoutDate(workout: Workout, fallbackZone: string): string {
  return localDate(workout.startedAt, workout.timeZone || fallbackZone);
}

const BACKFILL_MS = 60 * 24 * 60 * 60 * 1000;
const FUTURE_SLACK_MS = 2 * 60 * 1000;

/** Phone sets have no receipt and are trusted. A server set older than 60 days stays out of streaks. */
export function countsForStreak(workout: Workout): boolean {
  if (workout.receivedAt == null) return true;
  const delta = workout.receivedAt - workout.startedAt;
  if (delta < -FUTURE_SLACK_MS) return false;
  return delta <= BACKFILL_MS;
}

export function workoutFromRecord(record: SessionRecord): Workout {
  return {
    id: record.id,
    startedAt: record.startedAt,
    ...(record.timeZone ? { timeZone: record.timeZone } : {}),
    countedReps: phoneCountedReps(record),
  };
}

export function phoneCountedReps(record: { reps: readonly Rep[]; startedAt: number; timerDurationS?: number }): number {
  return countedRepList(record.reps, record.startedAt, record.timerDurationS).length;
}

export function countedRepList(reps: readonly Rep[], startedAt: number, timerDurationS?: number): Rep[] {
  const limit = timerDurationS != null ? startedAt + timerDurationS * 1000 : Number.POSITIVE_INFINITY;
  return reps.filter((r) => r.quality !== 'shallow' && r.timestamp <= limit).sort((a, b) => a.timestamp - b.timestamp);
}
