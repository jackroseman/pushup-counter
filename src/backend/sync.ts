import { DEFAULT_CONFIG } from '../core/types';
import type { KeyValueStore, SessionRecord } from '../storage/history';

/**
 * Solo set backup: every set saved on this phone is uploaded once with submit_set()
 * (idempotent on (user, SessionRecord.id)), including sets recorded before sign-in.
 * Local history stays the source of truth on the phone; clearing it does not delete the
 * backup. Pure logic + injected I/O so it is unit-tested; wiring lives in IdentityProvider.
 */

/** Bump when the rep detector's counting logic changes (stored with every uploaded set). */
export const DETECTOR_ALGORITHM_VERSION = 2;
export const SYNC_STATE_KEY = 'sync.v1';
const MAX_SET_MS = 2 * 60 * 60 * 1000;

export interface SyncState {
  /** Account the ids below belong to; a different account starts over. */
  userId: string | null;
  /** SessionRecord ids known to be on the server. */
  uploaded: string[];
  /** Ids the server refused for good (bad data); never retried. */
  rejected: string[];
  /** Whether the server's list of sets has been merged in for this account. */
  reconciled: boolean;
}

export const EMPTY_SYNC_STATE: SyncState = { userId: null, uploaded: [], rejected: [], reconciled: false };

export function sanitizeSyncState(raw: unknown): SyncState {
  if (typeof raw !== 'object' || raw === null) return EMPTY_SYNC_STATE;
  const r = raw as Partial<SyncState>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    userId: typeof r.userId === 'string' ? r.userId : null,
    uploaded: ids(r.uploaded),
    rejected: ids(r.rejected),
    reconciled: r.reconciled === true,
  };
}

export async function loadSyncState(kv: KeyValueStore): Promise<SyncState> {
  try {
    const raw = await kv.getItem(SYNC_STATE_KEY);
    return raw ? sanitizeSyncState(JSON.parse(raw)) : EMPTY_SYNC_STATE;
  } catch {
    return EMPTY_SYNC_STATE;
  }
}

export const saveSyncState = (kv: KeyValueStore, s: SyncState) => kv.setItem(SYNC_STATE_KEY, JSON.stringify(s));

/** Why a set is never uploaded (decided on the phone), or null if it should be. */
export function skipReason(r: SessionRecord): string | null {
  if (!r.reps.length) return 'no reps';
  if (!Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt) || r.endedAt < r.startedAt) return 'bad times';
  if (r.endedAt - r.startedAt > MAX_SET_MS) return 'longer than 2 hours';
  return null;
}

const dist = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 2 ? v : null);
const time = (v: unknown, min: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : null);

export interface PayloadContext {
  deviceId: string | null;
  appVersion: string | null;
  updateId: string | null;
}

/**
 * SessionRecord -> submit_set() payload. Out-of-range sensor values are dropped (sent as
 * null) instead of failing the whole set on a database check constraint.
 */
export function toSetPayload(r: SessionRecord, ctx: PayloadContext): Record<string, unknown> {
  const version = r.version ?? 1;
  const reps = r.reps
    .filter((rep) => Number.isFinite(rep.timestamp) && rep.timestamp >= r.startedAt)
    .map((rep) => {
      let bottom = dist(rep.bottomDistance);
      const top = dist(rep.topDistance);
      if (bottom !== null && top !== null && bottom > top) bottom = null;
      const completed = rep.timestamp;
      let bottomAt = time(rep.bottomAt, r.startedAt);
      if (bottomAt !== null && bottomAt > completed) bottomAt = null;
      let startedAt = time(rep.startedAt, r.startedAt);
      if (startedAt !== null && startedAt > (bottomAt ?? completed)) startedAt = null;
      return {
        index: rep.index,
        timestamp: completed,
        startedAt,
        bottomAt,
        bottomDistance: bottom,
        topDistance: top,
        faceLostAtBottom: rep.faceLostAtBottom === true,
        proximityTouched: rep.proximityTouched ?? null,
        source: rep.source,
        quality: rep.quality,
      };
    });
  const top = r.calibratedTopDistance;
  const trace = (r.trace ?? [])
    .filter(([t, d]) => Number.isFinite(t) && t >= 0 && (d === null || Number.isFinite(d)))
    .slice(0, 3001)
    .map(([t, d]) => [Math.round(t), d]);
  const payload: Record<string, unknown> = {
    id: r.id,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    version,
    depthTracking: r.depthTracking,
    calibratedTopDistance: typeof top === 'number' && top >= 0.15 && top <= 1.2 ? top : null,
    reps,
    deviceId: ctx.deviceId,
    appVersion: ctx.appVersion,
    updateId: ctx.updateId,
  };
  if (version >= 2) {
    payload.detectorConfig = { ...DEFAULT_CONFIG, algorithmVersion: DETECTOR_ALGORITHM_VERSION };
    if (trace.length) {
      payload.trace = trace;
      payload.traceResolutionMs = traceResolution(trace);
    }
  }
  return payload;
}

/** Bucket size of a trace (it doubles when long sets are downsampled). */
export function traceResolution(trace: readonly (readonly (number | null)[])[]): number {
  let min = Infinity;
  for (let i = 1; i < trace.length; i++) {
    const d = (trace[i][0] ?? 0) - (trace[i - 1][0] ?? 0);
    if (d > 0 && d < min) min = d;
  }
  return Number.isFinite(min) ? Math.min(10000, Math.max(50, Math.round(min))) : 100;
}

/** Postgres errors that mean "this data will never be accepted", as opposed to network or auth trouble. */
export function isPermanentError(e: { code?: string } | null | undefined): boolean {
  const c = e?.code ?? '';
  return /^(22|23)/.test(c); // data exceptions, integrity/check constraint violations
}

export interface SyncBackend {
  submitSet(payload: Record<string, unknown>): Promise<{ error: { code?: string; message: string } | null }>;
  /** SessionRecord ids of the user's solo sets already on the server. */
  listUploadedIds(userId: string): Promise<string[]>;
}

export interface SyncResult {
  uploaded: number;
  rejected: number;
  pending: number;
  error: string | null;
  state: SyncState;
}

export interface SyncStatus {
  /** Sets that should be backed up. */
  eligible: number;
  /** Of those, how many are on the server. */
  backedUp: number;
  rejected: number;
}

export function syncStatus(history: readonly SessionRecord[], s: SyncState): SyncStatus {
  const up = new Set(s.uploaded);
  const rej = new Set(s.rejected);
  const eligible = history.filter((r) => skipReason(r) === null);
  return {
    eligible: eligible.length,
    backedUp: eligible.filter((r) => up.has(r.id)).length,
    rejected: eligible.filter((r) => rej.has(r.id)).length,
  };
}

/** Upload every eligible set not yet on the server, oldest first. Stops at the first transient error. */
export async function syncSets(opts: {
  backend: SyncBackend;
  kv: KeyValueStore;
  userId: string;
  history: readonly SessionRecord[];
  ctx: PayloadContext;
}): Promise<SyncResult> {
  const { backend, kv, userId, ctx } = opts;
  let state = await loadSyncState(kv);
  if (state.userId !== userId) state = { ...EMPTY_SYNC_STATE, userId };
  let error: string | null = null;

  if (!state.reconciled) {
    try {
      const remote = await backend.listUploadedIds(userId);
      state = { ...state, uploaded: [...new Set([...state.uploaded, ...remote])], reconciled: true };
      await saveSyncState(kv, state);
    } catch (e) {
      return { uploaded: 0, rejected: 0, pending: -1, error: e instanceof Error ? e.message : String(e), state };
    }
  }

  const done = new Set([...state.uploaded, ...state.rejected]);
  const todo = opts.history.filter((r) => skipReason(r) === null && !done.has(r.id)).sort((a, b) => a.startedAt - b.startedAt);
  let uploaded = 0;
  let rejected = 0;
  let i = 0;
  for (; i < todo.length; i++) {
    const r = todo[i];
    let res: { error: { code?: string; message: string } | null };
    try {
      res = await backend.submitSet(toSetPayload(r, ctx));
    } catch (e) {
      res = { error: { message: e instanceof Error ? e.message : String(e) } };
    }
    if (!res.error) {
      state = { ...state, uploaded: [...state.uploaded, r.id] };
      uploaded++;
    } else if (isPermanentError(res.error)) {
      state = { ...state, rejected: [...state.rejected, r.id] };
      rejected++;
    } else {
      error = res.error.message;
      break;
    }
    await saveSyncState(kv, state);
  }
  return { uploaded, rejected, pending: todo.length - uploaded - rejected, error, state };
}
