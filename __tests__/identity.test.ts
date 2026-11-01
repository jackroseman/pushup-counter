import { KeyValueStore, SessionRecord } from '../src/storage/history';
import { summarize } from '../src/core';
import {
  displayNameError,
  normalizeUsername,
  profileErrorResult,
  suggestUsername,
  usernameError,
  USERNAME_RE,
} from '../src/backend/profile';
import { getInstallationId, INSTALLATION_ID_KEY, newInstallationId } from '../src/backend/installation';
import {
  DETECTOR_ALGORITHM_VERSION,
  isPermanentError,
  loadSyncState,
  sanitizeSyncState,
  skipReason,
  SyncBackend,
  syncSets,
  syncStatus,
  SYNC_STATE_KEY,
  toSetPayload,
  traceResolution,
} from '../src/backend/sync';
import { notifyHistoryChanged, onHistoryChanged } from '../src/backend/syncEvents';

class MemoryKV implements KeyValueStore {
  data = new Map<string, string>();
  async getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  async removeItem(k: string) {
    this.data.delete(k);
  }
}

const T0 = 1_700_000_000_000;
const record = (id: string, startedAt: number, reps = 3, extra: Partial<SessionRecord> = {}): SessionRecord => {
  const r = Array.from({ length: reps }, (_, i) => ({
    index: i + 1,
    timestamp: startedAt + 1000 * (i + 1),
    startedAt: startedAt + 1000 * i + 100,
    bottomAt: startedAt + 1000 * i + 500,
    quality: 'full' as const,
    source: 'depth' as const,
    bottomDistance: 0.15,
    topDistance: 0.5,
    rangeOfMotion: 0.35,
    depthRatio: 0.83,
    faceLostAtBottom: false,
  }));
  return {
    id,
    startedAt,
    endedAt: startedAt + 1000 * (reps + 1),
    summary: summarize(r, startedAt, startedAt + 1000 * (reps + 1)),
    reps: r,
    calibratedTopDistance: 0.5,
    depthTracking: true,
    version: 2,
    trace: [
      [0, 0.5],
      [100, 0.4],
      [200, null],
    ],
    ...extra,
  };
};
const ctx = { deviceId: 'dev-1', appVersion: '1.2.0', updateId: null };

describe('profile helpers', () => {
  it('normalizes and validates usernames like the database', () => {
    expect(normalizeUsername('  Jack Roseman ')).toBe('jack_roseman');
    expect(usernameError('ab')).toMatch(/3/);
    expect(usernameError('a'.repeat(21))).toMatch(/20/);
    expect(usernameError('jack-r')).toMatch(/Letters/);
    expect(usernameError('jack_r1')).toBeNull();
  });

  it('suggests a valid username', () => {
    const s = suggestUsername('Jäck Röseman', () => 0.5);
    expect(s).toBe('jackroseman_550');
    expect(USERNAME_RE.test(s)).toBe(true);
    expect(suggestUsername(null, () => 0)).toBe('athlete_100');
    expect(USERNAME_RE.test(suggestUsername('A Very Long Name Indeed Yes', () => 0.999))).toBe(true);
  });

  it('limits display names and maps save errors', () => {
    expect(displayNameError('x'.repeat(41))).not.toBeNull();
    expect(displayNameError('  Jack  ')).toBeNull();
    expect(profileErrorResult({ code: '23505', message: 'dup' })).toMatchObject({ ok: false, reason: 'taken' });
    expect(profileErrorResult({ code: '23514', message: 'check' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(profileErrorResult({ message: 'offline' })).toMatchObject({ ok: false, reason: 'error', message: 'offline' });
  });
});

describe('installation id', () => {
  it('is created once and reused', async () => {
    const kv = new MemoryKV();
    const a = await getInstallationId(kv);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await getInstallationId(kv)).toBe(a);
    kv.data.set(INSTALLATION_ID_KEY, 'garbage');
    expect(await getInstallationId(kv)).not.toBe('garbage');
    expect(newInstallationId(() => 0)).toBe('0'.repeat(32));
  });
});

describe('set payload', () => {
  it('maps a v2 record with detector config and trace', () => {
    const p = toSetPayload(record('s1', T0), ctx);
    expect(p).toMatchObject({ id: 's1', startedAt: T0, version: 2, deviceId: 'dev-1', appVersion: '1.2.0', calibratedTopDistance: 0.5 });
    expect((p.detectorConfig as { algorithmVersion: number }).algorithmVersion).toBe(DETECTOR_ALGORITHM_VERSION);
    expect(p.trace).toEqual([
      [0, 0.5],
      [100, 0.4],
      [200, null],
    ]);
    expect(p.traceResolutionMs).toBe(100);
    expect((p.reps as unknown[]).length).toBe(3);
  });

  it('sends legacy v1 records without detector config', () => {
    const p = toSetPayload(record('old', T0, 2, { version: undefined, trace: undefined }), ctx);
    expect(p.version).toBe(1);
    expect(p.detectorConfig).toBeUndefined();
    expect(p.trace).toBeUndefined();
  });

  it('nulls out-of-range sensor values instead of failing the set', () => {
    const r = record('s2', T0, 2, { calibratedTopDistance: 3 });
    r.reps[0] = { ...r.reps[0], bottomDistance: 0.6, topDistance: 0.5, bottomAt: T0 + 5000, startedAt: -1 };
    r.reps[1] = { ...r.reps[1], bottomDistance: 0, topDistance: 7 };
    const reps = toSetPayload(r, ctx).reps as Record<string, unknown>[];
    expect(reps[0]).toMatchObject({ bottomDistance: null, topDistance: 0.5, bottomAt: null, startedAt: null });
    expect(reps[1]).toMatchObject({ bottomDistance: null, topDistance: null });
    expect(toSetPayload(r, ctx).calibratedTopDistance).toBeNull();
  });

  it('drops reps before the set started and caps the trace', () => {
    const r = record('s3', T0, 2);
    r.reps[0] = { ...r.reps[0], timestamp: T0 - 1 };
    r.trace = Array.from({ length: 4000 }, (_, i) => [i * 100, 0.4] as [number, number]);
    const p = toSetPayload(r, ctx);
    expect((p.reps as unknown[]).length).toBe(1);
    expect((p.trace as unknown[]).length).toBe(3001);
  });

  it('measures trace resolution', () => {
    expect(traceResolution([])).toBe(100);
    expect(
      traceResolution([
        [0, 1],
        [200, 1],
        [400, 1],
      ]),
    ).toBe(200);
  });

  it('skips sets the server would reject', () => {
    expect(skipReason(record('a', T0))).toBeNull();
    expect(skipReason(record('b', T0, 0))).toBe('no reps');
    expect(skipReason({ ...record('c', T0), endedAt: T0 - 1 })).toBe('bad times');
    expect(skipReason({ ...record('d', T0), endedAt: T0 + 3 * 3600_000 })).toMatch(/2 hours/);
    expect(skipReason({ ...record('e', T0), battleId: '11111111-1111-4111-8111-111111111111' })).toMatch(/battle/);
  });

  it('classifies errors', () => {
    expect(isPermanentError({ code: '23514' })).toBe(true);
    expect(isPermanentError({ code: '22023' })).toBe(true);
    expect(isPermanentError({ code: 'PGRST301' })).toBe(false);
    expect(isPermanentError({})).toBe(false);
  });
});

function fakeBackend(remote: string[] = []) {
  const calls: string[] = [];
  const failOn = new Map<string, { code?: string; message: string }>();
  let listCalls = 0;
  const backend: SyncBackend = {
    submitSet: async (p) => {
      calls.push(p.id as string);
      return { error: failOn.get(p.id as string) ?? null };
    },
    listUploadedIds: async () => {
      listCalls++;
      return remote;
    },
  };
  return { backend, calls, failOn, listCalls: () => listCalls };
}

describe('syncSets', () => {
  const history = [record('new', T0 + 2000_000), record('old', T0), record('empty', T0 + 1000, 0), record('mid', T0 + 1000_000)];

  it('reconciles once, uploads oldest first, then does nothing', async () => {
    const kv = new MemoryKV();
    const f = fakeBackend(['mid']);
    const r = await syncSets({ backend: f.backend, kv, userId: 'u1', history, ctx });
    expect(f.calls).toEqual(['old', 'new']);
    expect(r).toMatchObject({ uploaded: 2, rejected: 0, pending: 0, error: null });
    expect(syncStatus(history, r.state)).toEqual({ eligible: 3, backedUp: 3, rejected: 0 });

    const again = await syncSets({ backend: f.backend, kv, userId: 'u1', history, ctx });
    expect(again.uploaded).toBe(0);
    expect(f.calls).toHaveLength(2);
    expect(f.listCalls()).toBe(1);
  });

  it('marks bad data as rejected and stops on network errors', async () => {
    const kv = new MemoryKV();
    const f = fakeBackend();
    f.failOn.set('old', { code: '23514', message: 'check' });
    f.failOn.set('mid', { message: 'Network request failed' });
    const r = await syncSets({ backend: f.backend, kv, userId: 'u1', history, ctx });
    expect(f.calls).toEqual(['old', 'mid']);
    expect(r).toMatchObject({ uploaded: 0, rejected: 1, pending: 2, error: 'Network request failed' });

    f.failOn.delete('mid');
    const r2 = await syncSets({ backend: f.backend, kv, userId: 'u1', history, ctx });
    expect(f.calls).toEqual(['old', 'mid', 'mid', 'new']);
    expect(r2).toMatchObject({ uploaded: 2, pending: 0 });
    expect(syncStatus(history, r2.state)).toEqual({ eligible: 3, backedUp: 2, rejected: 1 });
  });

  it('starts over for a different account', async () => {
    const kv = new MemoryKV();
    await syncSets({ backend: fakeBackend().backend, kv, userId: 'u1', history, ctx });
    const f2 = fakeBackend();
    const r = await syncSets({ backend: f2.backend, kv, userId: 'u2', history, ctx });
    expect(f2.calls).toEqual(['old', 'mid', 'new']);
    expect(r.state.userId).toBe('u2');
  });

  it('retries reconciliation when listing fails', async () => {
    const kv = new MemoryKV();
    const backend: SyncBackend = {
      submitSet: jest.fn(),
      listUploadedIds: async () => {
        throw new Error('offline');
      },
    };
    const r = await syncSets({ backend, kv, userId: 'u1', history, ctx });
    expect(r.error).toBe('offline');
    expect(backend.submitSet).not.toHaveBeenCalled();
    expect((await loadSyncState(kv)).reconciled).toBe(false);
  });

  it('survives corrupt saved state', async () => {
    const kv = new MemoryKV();
    kv.data.set(SYNC_STATE_KEY, '{nope');
    expect((await loadSyncState(kv)).uploaded).toEqual([]);
    expect(sanitizeSyncState({ userId: 3, uploaded: ['a', 1], reconciled: 'yes' })).toEqual({
      userId: null,
      uploaded: ['a'],
      rejected: [],
      reconciled: false,
    });
  });
});

describe('history change events', () => {
  it('notifies listeners and isolates failures', () => {
    const seen: number[] = [];
    const off1 = onHistoryChanged(() => {
      throw new Error('boom');
    });
    const off2 = onHistoryChanged(() => seen.push(1));
    notifyHistoryChanged();
    off2();
    notifyHistoryChanged();
    off1();
    expect(seen).toEqual([1]);
  });
});
