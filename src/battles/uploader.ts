/** App-side glue for battle uploads: queue on the phone, then send through submit-set. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../backend/supabase';
import { payloadContext } from '../backend/identity';
import { toSetPayload } from '../backend/sync';
import type { SessionRecord } from '../storage/history';
import { api } from './api';
import { enqueueBattleSet, flushBattleQueue, FlushResult } from './uploadQueue';

let running: Promise<FlushResult | null> | null = null;
const listeners = new Set<(r: FlushResult) => void>();

/** Called after an upload round (screens refresh their standings). */
export function onBattleUploads(l: (r: FlushResult) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function flushBattleUploads(): Promise<FlushResult | null> {
  if (!supabase) return Promise.resolve(null);
  if (running) return running;
  const client = supabase;
  running = (async () => {
    try {
      const { data } = await client.auth.getSession();
      if (!data.session) return null;
      const r = await flushBattleQueue(AsyncStorage, (p) => api.submitSet(client, p));
      if (r.uploaded.length || r.failed.length) listeners.forEach((l) => l(r));
      return r;
    } catch {
      return null; // storage or network trouble: the queue is retried on the next foreground
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Queue a finished battle attempt (even with 0 reps) and try to upload it right away. */
export async function submitBattleAttempt(record: SessionRecord, battleId: string, deviceId: string | null) {
  await enqueueBattleSet(AsyncStorage, battleId, toSetPayload(record, payloadContext(deviceId)));
  return flushBattleUploads();
}
