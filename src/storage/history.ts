import { Rep, SessionSummary, TracePoint } from '../core';

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  summary: SessionSummary;
  reps: Rep[];
  calibratedTopDistance: number | null;
  depthTracking: boolean;
  /** 2 = depth-only counting with timing + trace. Missing on sets saved by older versions. */
  version?: number;
  /** Downsampled (~10 Hz) face-distance trace: [ms since startedAt, meters | null]. */
  trace?: TracePoint[];
}

/** Minimal async key-value interface (AsyncStorage satisfies it) so this is testable. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const HISTORY_KEY = 'pushupcounter.history.v1';
export const MAX_HISTORY = 200;

export class HistoryStore {
  constructor(private readonly kv: KeyValueStore) {}

  async load(): Promise<SessionRecord[]> {
    const raw = await this.kv.getItem(HISTORY_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SessionRecord[]) : [];
    } catch {
      return [];
    }
  }

  /** Newest first. Sessions with zero reps are not saved. */
  async add(record: SessionRecord): Promise<SessionRecord[]> {
    const all = await this.load();
    if (record.summary.totalReps === 0) return all;
    const next = [record, ...all.filter((r) => r.id !== record.id)].slice(0, MAX_HISTORY);
    await this.kv.setItem(HISTORY_KEY, JSON.stringify(next));
    return next;
  }

  async remove(id: string): Promise<SessionRecord[]> {
    const next = (await this.load()).filter((r) => r.id !== id);
    await this.kv.setItem(HISTORY_KEY, JSON.stringify(next));
    return next;
  }

  async clear(): Promise<void> {
    await this.kv.removeItem(HISTORY_KEY);
  }
}
