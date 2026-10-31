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
    await saveSettings(kv, { ...DEFAULT_SETTINGS, depthOnlyCounting: true });
    expect((await loadSettings(kv)).depthOnlyCounting).toBe(true);
  });
});
