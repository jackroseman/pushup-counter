/**
 * The green New tag on Friends (invite frame b10): friends added since the list was last
 * opened. Opening the list moves the mark, so the tag shows once.
 */
import type { Friend } from '../battles/model';

export const FRIENDS_SEEN_KEY = 'friends.seenAt.v1';

type Store = { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void> };

/** Reads the previous mark and moves it to now. null the first time (nobody is new then). */
export async function takeFriendsSeenAt(store: Store, now = Date.now()): Promise<number | null> {
  let prev: number | null = null;
  try {
    const raw = await store.getItem(FRIENDS_SEEN_KEY);
    const n = raw === null ? NaN : Number(raw);
    prev = Number.isFinite(n) ? n : null;
  } catch {
    prev = null;
  }
  store.setItem(FRIENDS_SEEN_KEY, String(now)).catch(() => {});
  return prev;
}

export function newFriendIds(rows: readonly Friend[], seenAt: number | null): Set<string> {
  if (seenAt === null) return new Set();
  return new Set(
    rows.filter((f) => f.relation === 'friend' && f.since && Date.parse(f.since) > seenAt).map((f) => f.userId),
  );
}

/** New friends first, then the usual order. */
export function newFirst(rows: readonly Friend[], fresh: ReadonlySet<string>): Friend[] {
  return [...rows.filter((f) => fresh.has(f.userId)), ...rows.filter((f) => !fresh.has(f.userId))];
}
