/**
 * The invite someone opened but hasn't acted on yet (signed out, picking a username, or in
 * first-run onboarding). Kept for this app session only, so Welcome and Pick a username can
 * say who invited them and the Add friend sheet comes back afterwards.
 */
import { useSyncExternalStore } from 'react';

import type { Inviter } from './api';

export type PendingInvite = { code: string; inviter: Inviter | null };

let current: PendingInvite | null = null;
const listeners = new Set<() => void>();

export const pendingInvite = {
  get: () => current,
  set(next: PendingInvite | null) {
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l());
  },
  /** Fill in who it's from once the preview loads (only for the same code). */
  setInviter(code: string, inviter: Inviter | null) {
    if (current?.code === code && current.inviter !== inviter) pendingInvite.set({ code, inviter });
  },
  clear(code?: string) {
    if (!code || current?.code === code) pendingInvite.set(null);
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function usePendingInvite(): PendingInvite | null {
  return useSyncExternalStore(pendingInvite.subscribe, pendingInvite.get, pendingInvite.get);
}
