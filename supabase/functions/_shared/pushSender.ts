// Sends pushes through Expo with injected I/O (token lookup, token disabling, fetch), so the
// batching and per-user fan-out are jest-tested (__tests__/pushSender.test.ts) and shared by
// both modes of the notify function.
import { chunk, EXPO_PUSH_URL, ExpoMessage, ExpoTicket, isExpoPushToken, PushContent, tokensToDisable } from './expoPush.ts';
import { buildNotification, ClaimedNotification, isKnownNotificationKind } from './notificationContent.ts';

export interface PushIO {
  /** Active Expo tokens for these users. */
  tokensFor(userIds: string[]): Promise<{ userId: string; token: string }[]>;
  disable(tokens: string[]): Promise<void>;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  expoAccessToken?: string;
}

export interface SendStats { devices: number; sent: number; failed: number; disabled: number }

export async function sendMessages(messages: ExpoMessage[], io: PushIO): Promise<SendStats> {
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  for (const batch of chunk(messages)) {
    let res: { ok: boolean; json(): Promise<unknown> };
    try {
      res = await io.fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(io.expoAccessToken ? { Authorization: `Bearer ${io.expoAccessToken}` } : {}),
        },
        body: JSON.stringify(batch),
      });
    } catch {
      failed += batch.length;
      continue;
    }
    if (!res.ok) {
      failed += batch.length;
      continue;
    }
    const tickets = (((await res.json()) as { data?: ExpoTicket[] })?.data ?? []) as ExpoTicket[];
    sent += tickets.filter((t) => t.status === 'ok').length;
    failed += tickets.filter((t) => t.status === 'error').length;
    dead.push(...tokensToDisable(batch, tickets));
  }
  if (dead.length) await io.disable(dead);
  return { devices: messages.length, sent, failed, disabled: dead.length };
}

interface Tagged { notificationId: number; message: ExpoMessage }

function notificationId(id: number | string): number {
  const n = typeof id === 'number' ? id : Number(id);
  if (!Number.isSafeInteger(n)) throw new Error('bad notification id');
  return n;
}

function tokensByUser(tokens: readonly { userId: string; token: string }[]): Map<string, Set<string>> {
  const byUser = new Map<string, Set<string>>();
  for (const t of tokens) {
    if (!isExpoPushToken(t.token)) continue;
    if (!byUser.has(t.userId)) byUser.set(t.userId, new Set());
    byUser.get(t.userId)!.add(t.token);
  }
  return byUser;
}

/** One message per (notification, device). Notifications with no text are skipped. */
export function messagesFor(
  rows: readonly ClaimedNotification[],
  tokens: readonly { userId: string; token: string }[],
  now: Date = new Date(),
): ExpoMessage[] {
  return taggedFor(rows, tokens, now).map((t) => t.message);
}

function taggedFor(
  rows: readonly ClaimedNotification[],
  tokens: readonly { userId: string; token: string }[],
  now: Date,
): Tagged[] {
  const byUser = tokensByUser(tokens);
  const out: Tagged[] = [];
  for (const row of rows) {
    const content: PushContent | null = buildNotification(row, now);
    if (!content) continue;
    for (const to of byUser.get(row.user_id) ?? []) {
      out.push({ notificationId: notificationId(row.id), message: { to, sound: 'default', priority: 'high', ...content } });
    }
  }
  return out;
}

/** A known kind with no text is done. An unknown kind stays queued for a newer sender. */
export function planDelivery(rows: readonly ClaimedNotification[], now: Date = new Date()): {
  ready: ClaimedNotification[];
  failed: number[];
  retry: number[];
} {
  const ready: ClaimedNotification[] = [];
  const failed: number[] = [];
  const retry: number[] = [];
  for (const row of rows) {
    const id = notificationId(row.id);
    if (buildNotification({ ...row, id }, now)) ready.push({ ...row, id });
    else if (isKnownNotificationKind(row.kind)) failed.push(id);
    else retry.push(id);
  }
  return { ready, failed, retry };
}

async function sendTagged(tagged: readonly Tagged[], io: PushIO): Promise<SendStats & { attemptedIds: number[] }> {
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  const attempted = new Set<number>();
  for (const batch of chunk(tagged)) {
    let res: { ok: boolean; json(): Promise<unknown> };
    try {
      res = await io.fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(io.expoAccessToken ? { Authorization: `Bearer ${io.expoAccessToken}` } : {}),
        },
        body: JSON.stringify(batch.map((item) => item.message)),
      });
    } catch {
      failed += batch.length;
      continue;
    }
    if (!res.ok) {
      failed += batch.length;
      continue;
    }
    for (const item of batch) attempted.add(item.notificationId);
    const tickets = (((await res.json()) as { data?: ExpoTicket[] })?.data ?? []) as ExpoTicket[];
    const messages = batch.map((item) => item.message);
    sent += tickets.filter((t) => t.status === 'ok').length;
    failed += tickets.filter((t) => t.status === 'error').length;
    dead.push(...tokensToDisable(messages, tickets));
  }
  if (dead.length) await io.disable(dead);
  return { devices: tagged.length, sent, failed, disabled: dead.length, attemptedIds: [...attempted].sort((a, b) => a - b) };
}

export async function deliverClaimed(
  rows: readonly ClaimedNotification[],
  io: PushIO,
  now: Date = new Date(),
): Promise<SendStats & { notifications: number; attemptedIds: number[] }> {
  if (!rows.length) return { notifications: 0, devices: 0, sent: 0, failed: 0, disabled: 0, attemptedIds: [] };
  const tokens = await io.tokensFor([...new Set(rows.map((r) => r.user_id))]);
  const stats = await sendTagged(taggedFor(rows, tokens, now), io);
  return { notifications: rows.length, ...stats };
}

export interface OutboxOps {
  lease(limit: number): Promise<ClaimedNotification[]>;
  settle(sent: number[], failed: number[]): Promise<void>;
  release(ids: number[]): Promise<void>;
}

/** Lease, attempt, then mark sent only for rows Expo actually accepted a body for. */
export async function drainOutbox(ops: OutboxOps, io: PushIO, now: Date = new Date()): Promise<SendStats & { notifications: number }> {
  const totals = { notifications: 0, devices: 0, sent: 0, failed: 0, disabled: 0 };
  for (let round = 0; round < 5; round++) {
    const rows = (await ops.lease(200)).map((row) => ({ ...row, id: notificationId(row.id) }));
    if (!rows.length) break;
    const plan = planDelivery(rows, now);
    const retry = [...plan.retry];
    let attempted: number[] = [];
    if (plan.ready.length) {
      try {
        const stats = await deliverClaimed(plan.ready, io, now);
        attempted = stats.attemptedIds;
        totals.devices += stats.devices;
        totals.sent += stats.sent;
        totals.failed += stats.failed;
        totals.disabled += stats.disabled;
        const got = new Set(attempted);
        for (const row of plan.ready) if (!got.has(row.id)) retry.push(row.id);
      } catch {
        retry.push(...plan.ready.map((row) => row.id));
      }
    }
    await ops.settle(attempted, plan.failed);
    await ops.release(retry);
    totals.notifications += rows.length;
    if (rows.length < 200) break;
  }
  return totals;
}
