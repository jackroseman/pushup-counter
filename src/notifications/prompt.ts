export const NOTIFICATION_PROMPT_COPY = {
  title: 'Turn on notifications',
  line: 'Stay in the loop with your friends and challenges.',
  turnOn: 'Turn on notifications',
  notNow: 'Not now',
} as const;

export type NotificationSurface = 'sheet' | 'none';

/**
 * The only surface is the sheet (frame 22), shown once: right after the first create, accept,
 * or join while notifications are off. After either answer it never comes back (Settings has
 * the Notifications row). No banner on any other visit.
 */
export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export function notificationSurface(input: { permission: NotificationPermission; justActed: boolean; shown: boolean }): NotificationSurface {
  if (input.permission === 'granted' || input.shown) return 'none';
  return input.justActed ? 'sheet' : 'none';
}

/** Undetermined asks iOS. Denied can only be changed in Settings. Granted just saves the token. */
export function notificationTurnOn(permission: NotificationPermission): 'request' | 'settings' | 'register' {
  if (permission === 'granted') return 'register';
  if (permission === 'denied') return 'settings';
  return 'request';
}

const SHOWN_KEY = 'notification-prompt-shown.v1';

/** Whether the sheet has been answered on this phone. */
export async function readNotificationPromptShown(storage: { getItem: (key: string) => Promise<string | null> }): Promise<boolean> {
  return (await storage.getItem(SHOWN_KEY).catch(() => null)) === '1';
}

export async function markNotificationPromptShown(storage: { setItem: (key: string, value: string) => Promise<void> }): Promise<void> {
  await storage.setItem(SHOWN_KEY, '1');
}
