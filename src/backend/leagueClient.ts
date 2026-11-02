import type { SupabaseClient } from '@supabase/supabase-js';

/** Last board for one account. A failed refresh keeps this. A different account does not. */
export const LEAGUE_CACHE_KEY = 'pushupcounter.league.v1';

export interface LeagueTotalRow {
  userId: string;
  username: string;
  displayName: string | null;
  reps: number;
  rank: number;
  crownedLastWeek: boolean;
}

export interface LeagueImprovementRow {
  userId: string;
  username: string;
  displayName: string | null;
  points: number;
  reps: number;
  goalDaysHit: number;
  goalDaysScheduled: number;
  usual: number | null;
  baselineWeeks: number;
  baselineMinWeeks: number;
  rank: number;
  crownedLastWeek: boolean;
}

export interface LeagueBoard {
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  total: LeagueTotalRow[];
  improvement: LeagueImprovementRow[];
}

export interface LeagueCacheStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function asNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function person(row: Record<string, unknown>): { userId: string; username: string; displayName: string | null } | null {
  if (typeof row.userId !== 'string' || row.userId.length === 0) return null;
  if (typeof row.username !== 'string' || row.username.length === 0) return null;
  if (row.displayName != null && typeof row.displayName !== 'string') return null;
  return { userId: row.userId, username: row.username, displayName: row.displayName ?? null };
}

/** Aggregates only. A missing field or a set id rejects the whole document. */
export function parseLeague(raw: unknown): LeagueBoard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  if (typeof doc.weekStart !== 'string' || !DATE.test(doc.weekStart)) return null;
  if (typeof doc.weekEnd !== 'string' || !DATE.test(doc.weekEnd)) return null;
  if (typeof doc.timeZone !== 'string' || doc.timeZone.length === 0) return null;
  if (!Array.isArray(doc.total) || !Array.isArray(doc.improvement)) return null;
  if ('sets' in doc || 'clientSetId' in doc) return null;
  const total: LeagueTotalRow[] = [];
  for (const item of doc.total) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const who = person(row);
    const reps = asInt(row.reps);
    const rank = asInt(row.rank);
    if (!who || reps == null || reps < 0 || rank == null || rank < 1 || typeof row.crownedLastWeek !== 'boolean') return null;
    total.push({ ...who, reps, rank, crownedLastWeek: row.crownedLastWeek });
  }
  const improvement: LeagueImprovementRow[] = [];
  for (const item of doc.improvement) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const who = person(row);
    const points = asInt(row.points);
    const reps = asInt(row.reps);
    const hit = asInt(row.goalDaysHit);
    const scheduled = asInt(row.goalDaysScheduled);
    const baseline = asInt(row.baselineWeeks);
    const minimum = asInt(row.baselineMinWeeks);
    const rank = asInt(row.rank);
    const usual = row.usual == null ? null : asNum(row.usual);
    const usualMissing = row.usual != null && usual == null;
    if (!who || points == null || reps == null || hit == null || scheduled == null || baseline == null || minimum == null) return null;
    if (rank == null || rank < 1 || usualMissing || typeof row.crownedLastWeek !== 'boolean') return null;
    improvement.push({
      ...who,
      points,
      reps,
      goalDaysHit: hit,
      goalDaysScheduled: scheduled,
      usual,
      baselineWeeks: baseline,
      baselineMinWeeks: minimum,
      rank,
      crownedLastWeek: row.crownedLastWeek,
    });
  }
  return { weekStart: doc.weekStart, weekEnd: doc.weekEnd, timeZone: doc.timeZone, total, improvement };
}

export async function fetchMyLeague(client: SupabaseClient): Promise<LeagueBoard> {
  const { data, error } = await client.rpc('my_league');
  if (error) throw new Error(error.message);
  const doc = parseLeague(data);
  if (!doc) throw new Error('League came back in an unexpected shape.');
  return doc;
}

export async function loadLeagueCache(store: LeagueCacheStore, userId: string): Promise<LeagueBoard | null> {
  try {
    const raw = await store.getItem(LEAGUE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId?: unknown; board?: unknown };
    if (parsed.userId !== userId) return null;
    return parseLeague(parsed.board);
  } catch {
    return null;
  }
}

export async function saveLeagueCache(store: LeagueCacheStore, userId: string, board: LeagueBoard): Promise<void> {
  await store.setItem(LEAGUE_CACHE_KEY, JSON.stringify({ userId, board }));
}
