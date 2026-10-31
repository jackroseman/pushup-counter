import { HistoryStore, KeyValueStore, SessionRecord, HISTORY_KEY } from '../src/storage/history';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/storage/settings';
import { summarize } from '../src/core';

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

const record = (id: string, reps: number): SessionRecord => {
  const r = Array.from({ length: reps }, (_, i) => ({
    index: i + 1,
    timestamp: i,
    quality: 'full' as const,
    source: 'proximity' as const,
    bottomDistance: 0.15,
    topDistance: 0.5,
    rangeOfMotion: 0.35,
    depthRatio: 0.83,
    faceLostAtBottom: false,
  }));
  return { id, startedAt: 0, endedAt: 1000, summary: summarize(r, 0, 1000), reps: r, calibratedTopDistance: 0.5, depthTracking: true };
};

describe('HistoryStore', () => {
  it('persists newest first and round-trips JSON', async () => {
    const kv = new MemoryKV();
    const store = new HistoryStore(kv);
    await store.add(record('a', 3));
    await store.add(record('b', 5));
    const fresh = new HistoryStore(kv);
    const all = await fresh.load();
    expect(all.map((r) => r.id)).toEqual(['b', 'a']);
    expect(all[0].summary.totalReps).toBe(5);
  });

  it('skips empty sessions, removes and clears', async () => {
    const kv = new MemoryKV();
    const store = new HistoryStore(kv);
    await store.add(record('empty', 0));
    expect(await store.load()).toHaveLength(0);
    await store.add(record('a', 1));
    await store.add(record('b', 1));
    expect((await store.remove('a')).map((r) => r.id)).toEqual(['b']);
    await store.clear();
    expect(await store.load()).toEqual([]);
  });

  it('round-trips v2 records with a trace and rep timing', async () => {
    const kv = new MemoryKV();
    const store = new HistoryStore(kv);
    const r = { ...record('v2', 2), version: 2, trace: [[0, 0.5], [100, null], [200, 0.31]] as [number, number | null][] };
    r.reps[1] = { ...r.reps[1], descentMs: 600, ascentMs: 500, intervalMs: 1400, startedAt: 10, bottomAt: 610 };
    await store.add(r);
    const [loaded] = await new HistoryStore(kv).load();
    expect(loaded.trace).toEqual([[0, 0.5], [100, null], [200, 0.31]]);
    expect(loaded.reps[1].intervalMs).toBe(1400);
  });

  it('survives corrupt storage', async () => {
    const kv = new MemoryKV();
    kv.data.set(HISTORY_KEY, '{not json');
    expect(await new HistoryStore(kv).load()).toEqual([]);
  });
});

describe('settings', () => {
  it('defaults and saves', async () => {
    const kv = new MemoryKV();
    expect(await loadSettings(kv)).toEqual(DEFAULT_SETTINGS);
    await saveSettings(kv, { ...DEFAULT_SETTINGS, haptics: false });
    expect((await loadSettings(kv)).haptics).toBe(false);
  });

  it('migrates old settings: drops the removed depthOnlyCounting toggle, keeps the rest', async () => {
    const kv = new MemoryKV();
    kv.data.set('pushupcounter.settings.v1', JSON.stringify({ depthOnlyCounting: true, speakQuality: false, haptics: 'yes' }));
    const s = await loadSettings(kv);
    expect(s).toEqual({ speakQuality: false, haptics: true });
    expect('depthOnlyCounting' in s).toBe(false);
  });

  it('survives corrupt settings', async () => {
    const kv = new MemoryKV();
    kv.data.set('pushupcounter.settings.v1', 'nope{');
    expect(await loadSettings(kv)).toEqual(DEFAULT_SETTINGS);
  });
});
