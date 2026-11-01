// Sends pushes through Expo with injected I/O (token lookup, token disabling, fetch), so the
// batching and per-user fan-out are jest-tested (__tests__/pushSender.test.ts) and shared by
// both modes of the notify function.
import { chunk, EXPO_PUSH_URL, ExpoMessage, ExpoTicket, isExpoPushToken, PushContent, tokensToDisable } from './expoPush.ts';
import { buildNotification, ClaimedNotification } from './notificationContent.ts';

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

/** One message per (notification, device). Notifications with no text are skipped. */
export function messagesFor(
  rows: readonly ClaimedNotification[],
  tokens: readonly { userId: string; token: string }[],
  now: Date = new Date(),
): ExpoMessage[] {
  const byUser = new Map<string, Set<string>>();
  for (const t of tokens) {
    if (!isExpoPushToken(t.token)) continue;
    if (!byUser.has(t.userId)) byUser.set(t.userId, new Set());
    byUser.get(t.userId)!.add(t.token);
  }
  const out: ExpoMessage[] = [];
  for (const row of rows) {
    const content: PushContent | null = buildNotification(row, now);
    if (!content) continue;
    for (const to of byUser.get(row.user_id) ?? []) out.push({ to, sound: 'default', priority: 'high', ...content });
  }
  return out;
}

export async function deliverClaimed(rows: readonly ClaimedNotification[], io: PushIO, now: Date = new Date()): Promise<SendStats & { notifications: number }> {
  if (!rows.length) return { notifications: 0, devices: 0, sent: 0, failed: 0, disabled: 0 };
  const tokens = await io.tokensFor([...new Set(rows.map((r) => r.user_id))]);
  const stats = await sendMessages(messagesFor(rows, tokens, now), io);
  return { notifications: rows.length, ...stats };
}
