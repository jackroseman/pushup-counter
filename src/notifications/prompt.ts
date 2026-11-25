/** How long Not now hides the sheet. The banner stays while permission is off. */
export const NOTIFICATION_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export const NOTIFICATION_PROMPT_COPY = {
  title: 'Turn on notifications',
  line: 'Stay in the loop on your challenges.',
  turnOn: 'Turn on notifications',
  notNow: 'Not now',
  banner: 'Notifications are off',
  bannerAction: 'Turn on',
} as const;

export type NotificationSurface = 'sheet' | 'banner' | 'none';

/**
 * Sheet only right after creating, accepting, or joining a challenge, and only
 * when Not now has worn off. Any other visit with permission off is the banner.
 */
export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export function notificationSurface(input: {
  permission: NotificationPermission;
  justActed: boolean;
  snoozedUntil: number | null;
  now: number;
}): NotificationSurface {
  if (input.permission === 'granted') return 'none';
  const snoozed = input.snoozedUntil != null && input.now < input.snoozedUntil;
  if (input.justActed && !snoozed) return 'sheet';
  return 'banner';
}

export function snoozeUntil(now: number): number {
  return now + NOTIFICATION_SNOOZE_MS;
}

/** Undetermined asks iOS. Denied can only be changed in Settings. Granted just saves the token. */
export function notificationTurnOn(permission: NotificationPermission): 'request' | 'settings' | 'register' {
  if (permission === 'granted') return 'register';
  if (permission === 'denied') return 'settings';
  return 'request';
}

const SNOOZE_KEY = 'notification-prompt-snooze-until';

export async function readNotificationSnooze(storage: { getItem: (key: string) => Promise<string | null> }): Promise<number | null> {
  const raw = await storage.getItem(SNOOZE_KEY).catch(() => null);
  if (!raw) return null;
  const until = Number(raw);
  return Number.isFinite(until) ? until : null;
}

export async function writeNotificationSnooze(storage: { setItem: (key: string, value: string) => Promise<void> }, until: number): Promise<void> {
  await storage.setItem(SNOOZE_KEY, String(until));
}
