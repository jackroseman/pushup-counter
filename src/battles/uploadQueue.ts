/**
 * Battle attempts are uploaded through the `submit-set` Edge Function (server-side validation,
 * then the submit_set RPC). Uploads are queued on the phone first so a set recorded offline or
 * during a flaky connection is not lost: the queue is retried on app start / foreground.
 * 0-rep attempts are uploaded too (they use the attempt). Pure: storage and HTTP are injected.
 */
import type { KeyValueStore } from '../storage/history';

export const BATTLE_QUEUE_KEY = 'battleUploads.v1';
const MAX_TRIES = 20;

export interface QueuedBattleSet {
  battleId: string;
  /** The set payload (toSetPayload) plus battleId. */
  payload: Record<string, unknown>;
  tries: number;
  queuedAt: number;
}

export interface FailedBattleSet extends QueuedBattleSet {
  error: string;
}

export interface BattleQueueState {
  pending: QueuedBattleSet[];
  /** Rejected by the server for good (e.g. deadline passed); kept so the app can say why. */
  failed: FailedBattleSet[];
}

export type SubmitResult = { ok: true; setId: string } | { ok: false; status: number; error: string };
export type Submit = (payload: Record<string, unknown>) => Promise<SubmitResult>;

const EMPTY: BattleQueueState = { pending: [], failed: [] };

export async function loadBattleQueue(kv: KeyValueStore): Promise<BattleQueueState> {
  try {
    const raw = await kv.getItem(BATTLE_QUEUE_KEY);
    if (!raw) return { pending: [], failed: [] };
    const v = JSON.parse(raw);
    const ok = (x: unknown): x is QueuedBattleSet =>
      typeof x === 'object' && x !== null && typeof (x as QueuedBattleSet).battleId === 'string' && typeof (x as QueuedBattleSet).payload === 'object';
    return {
      pending: Array.isArray(v?.pending) ? v.pending.filter(ok) : [],
      failed: Array.isArray(v?.failed) ? v.failed.filter(ok).slice(-20) : [],
    };
  } catch {
    return { ...EMPTY, pending: [], failed: [] };
  }
}

const save = (kv: KeyValueStore, s: BattleQueueState) => kv.setItem(BATTLE_QUEUE_KEY, JSON.stringify(s));

/** Adds a set (replacing a queued copy with the same set id). */
export async function enqueueBattleSet(kv: KeyValueStore, battleId: string, payload: Record<string, unknown>, now = Date.now()) {
  const s = await loadBattleQueue(kv);
  const id = payload.id;
  s.pending = s.pending.filter((q) => q.payload.id !== id);
  s.pending.push({ battleId, payload: { ...payload, battleId }, tries: 0, queuedAt: now });
  await save(kv, s);
}

/** 4xx (except 401/408/429) means the server will never accept it; anything else is retried. */
export function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export interface FlushResult {
  uploaded: string[];
  failed: FailedBattleSet[];
  remaining: number;
}

/** Uploads queued sets oldest first. Stops at the first transient failure (probably offline). */
export async function flushBattleQueue(kv: KeyValueStore, submit: Submit): Promise<FlushResult> {
  const s = await loadBattleQueue(kv);
  const uploaded: string[] = [];
  const failed: FailedBattleSet[] = [];
  const rest: QueuedBattleSet[] = [];
  let stop = false;
  for (const q of s.pending) {
    if (stop) {
      rest.push(q);
      continue;
    }
    let r: SubmitResult;
    try {
      r = await submit(q.payload);
    } catch (e) {
      r = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
    if (r.ok) {
      uploaded.push(q.battleId);
    } else if (isPermanentStatus(r.status) || q.tries + 1 >= MAX_TRIES) {
      failed.push({ ...q, tries: q.tries + 1, error: r.error });
    } else {
      rest.push({ ...q, tries: q.tries + 1 });
      stop = true;
    }
  }
  await save(kv, { pending: rest, failed: [...s.failed, ...failed].slice(-20) });
  return { uploaded, failed, remaining: rest.length };
}

/** Battles with an attempt that is recorded on this phone but not on the server yet. */
export const pendingBattleIds = (s: BattleQueueState) => new Set(s.pending.map((q) => q.battleId));
