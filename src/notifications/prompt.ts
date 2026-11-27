export const NOTIFICATION_PROMPT_COPY = {
  title: 'Keep up with your friends',
  line: 'Stay on top of challenges and scores without opening the app.',
  turnOn: 'Turn on notifications',
  notNow: 'Not now',
  bannerTurnOn: 'Turn on',
  openSettings: 'Open Settings',
} as const;

export const BANNER_HIDE_MS = 7 * 24 * 60 * 60 * 1000;
export const BANNER_MAX_DISMISSES = 3;

export type NotificationSurface = 'sheet' | 'none';
export type NotificationPermission = 'granted' | 'denied' | 'undetermined';
export type NotificationOptInState = 'never-asked' | 'soft-declined' | 'ios-denied' | 'granted';
export type BannerDismiss = { count: number; at: number | null };

/**
 * The pre-permission sheet is shown once: after the first create, accept, or join in the app,
 * or after joining through an invite link and landing on that challenge, while the state is
 * never-asked. After either answer it does not return. A banner on Today and on the challenge
 * screen covers soft-declined and iOS-denied. Settings has the Notifications row.
 */
export function notificationOptInState(input: { permission: NotificationPermission; shown: boolean }): NotificationOptInState {
  if (input.permission === 'granted') return 'granted';
  if (input.permission === 'denied') return 'ios-denied';
  return input.shown ? 'soft-declined' : 'never-asked';
}

export function notificationSurface(input: { permission: NotificationPermission; justActed: boolean; shown: boolean }): NotificationSurface {
  if (notificationOptInState(input) !== 'never-asked' || !input.justActed) return 'none';
  return 'sheet';
}

export function notificationBannerVisible(input: {
  state: NotificationOptInState;
  dismissCount: number;
  lastDismissAt: number | null;
  now: number;
  sheetOpen?: boolean;
}): boolean {
  if (input.sheetOpen) return false;
  if (input.state !== 'soft-declined' && input.state !== 'ios-denied') return false;
  if (input.dismissCount >= BANNER_MAX_DISMISSES) return false;
  if (input.lastDismissAt != null && input.now - input.lastDismissAt < BANNER_HIDE_MS) return false;
  return true;
}

/** Soft-declined still asks iOS. After a denial, only Settings can change it. */
export function notificationBannerAction(state: NotificationOptInState): 'request' | 'settings' | 'none' {
  if (state === 'soft-declined') return 'request';
  if (state === 'ios-denied') return 'settings';
  return 'none';
}

/** Undetermined asks iOS. Denied can only be changed in Settings. Granted just saves the token. */
export function notificationTurnOn(permission: NotificationPermission): 'request' | 'settings' | 'register' {
  if (permission === 'granted') return 'register';
  if (permission === 'denied') return 'settings';
  return 'request';
}

const SHOWN_KEY = 'notification-prompt-shown.v1';
const DISMISS_KEY = 'notification-banner-dismiss.v1';

const listeners = new Set<() => void>();

/** Subscribe to sheet and banner storage changes on this phone. */
export function subscribeNotificationOptInStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitNotificationOptInStorage(): void {
  for (const listener of listeners) listener();
}

/** Whether the sheet has been answered on this phone. */
export async function readNotificationPromptShown(storage: { getItem: (key: string) => Promise<string | null> }): Promise<boolean> {
  return (await storage.getItem(SHOWN_KEY).catch(() => null)) === '1';
}

export async function markNotificationPromptShown(storage: { setItem: (key: string, value: string) => Promise<void> }): Promise<void> {
  await storage.setItem(SHOWN_KEY, '1');
  emitNotificationOptInStorage();
}

export async function readNotificationBannerDismiss(storage: { getItem: (key: string) => Promise<string | null> }): Promise<BannerDismiss> {
  const raw = await storage.getItem(DISMISS_KEY).catch(() => null);
  if (!raw) return { count: 0, at: null };
  try {
    const parsed = JSON.parse(raw) as { count?: unknown; at?: unknown };
    const count = typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? Math.max(0, Math.floor(parsed.count)) : 0;
    const at = typeof parsed.at === 'number' && Number.isFinite(parsed.at) ? parsed.at : null;
    return { count, at };
  } catch {
    return { count: 0, at: null };
  }
}

export async function markNotificationBannerDismissed(
  storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
  },
  now: number,
): Promise<BannerDismiss> {
  const prev = await readNotificationBannerDismiss(storage);
  const next: BannerDismiss = { count: prev.count + 1, at: now };
  await storage.setItem(DISMISS_KEY, JSON.stringify(next));
  emitNotificationOptInStorage();
  return next;
}
