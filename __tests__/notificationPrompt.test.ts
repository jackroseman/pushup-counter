import {
  BANNER_HIDE_MS,
  BANNER_MAX_DISMISSES,
  NOTIFICATION_PROMPT_COPY,
  markNotificationBannerDismissed,
  markNotificationPromptShown,
  notificationBannerAction,
  notificationBannerVisible,
  notificationOptInState,
  notificationSurface,
  notificationTurnOn,
  readNotificationBannerDismiss,
  readNotificationPromptShown,
  subscribeNotificationOptInStorage,
} from '../src/notifications/prompt';

const kv = () => {
  const data = new Map<string, string>();
  return {
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => void data.set(k, v),
  };
};

describe('notificationOptInState', () => {
  it('is never-asked until the sheet is answered and iOS has not decided', () => {
    expect(notificationOptInState({ permission: 'undetermined', shown: false })).toBe('never-asked');
  });

  it('is soft-declined after Not now, while iOS is still undetermined', () => {
    expect(notificationOptInState({ permission: 'undetermined', shown: true })).toBe('soft-declined');
  });

  it('is ios-denied when iOS will not ask again, whether or not the sheet was shown', () => {
    expect(notificationOptInState({ permission: 'denied', shown: false })).toBe('ios-denied');
    expect(notificationOptInState({ permission: 'denied', shown: true })).toBe('ios-denied');
  });

  it('is granted once iOS permission is allowed', () => {
    expect(notificationOptInState({ permission: 'granted', shown: false })).toBe('granted');
    expect(notificationOptInState({ permission: 'granted', shown: true })).toBe('granted');
  });
});

describe('notificationSurface', () => {
  it('shows the sheet after creating, accepting, or joining, including an invite-link join, while never asked', () => {
    expect(notificationSurface({ permission: 'undetermined', justActed: true, shown: false })).toBe('sheet');
  });

  it('stays hidden once permission is granted', () => {
    expect(notificationSurface({ permission: 'granted', justActed: true, shown: false })).toBe('none');
  });

  it('does not show the sheet when iOS has already denied', () => {
    expect(notificationSurface({ permission: 'denied', justActed: true, shown: false })).toBe('none');
  });

  it('shows nothing on an ordinary visit while never asked', () => {
    expect(notificationSurface({ permission: 'undetermined', justActed: false, shown: false })).toBe('none');
  });

  it('is shown once: after an answer it never comes back', async () => {
    const storage = kv();
    expect(await readNotificationPromptShown(storage)).toBe(false);
    await markNotificationPromptShown(storage);
    const shown = await readNotificationPromptShown(storage);
    expect(shown).toBe(true);
    expect(notificationSurface({ permission: 'undetermined', justActed: true, shown })).toBe('none');
    expect(notificationSurface({ permission: 'denied', justActed: true, shown })).toBe('none');
  });
});

describe('notificationBannerVisible', () => {
  const open = { dismissCount: 0, lastDismissAt: null as number | null, now: 1_000, sheetOpen: false };

  it('shows for soft-declined and ios-denied, and hides for never-asked and granted', () => {
    expect(notificationBannerVisible({ ...open, state: 'soft-declined' })).toBe(true);
    expect(notificationBannerVisible({ ...open, state: 'ios-denied' })).toBe(true);
    expect(notificationBannerVisible({ ...open, state: 'never-asked' })).toBe(false);
    expect(notificationBannerVisible({ ...open, state: 'granted' })).toBe(false);
  });

  it('hides while the permission sheet is open', () => {
    expect(notificationBannerVisible({ ...open, state: 'soft-declined', sheetOpen: true })).toBe(false);
  });

  it('hides for 7 days after a dismiss, then can return', () => {
    const at = 10_000;
    expect(notificationBannerVisible({ state: 'soft-declined', dismissCount: 1, lastDismissAt: at, now: at + BANNER_HIDE_MS - 1 })).toBe(false);
    expect(notificationBannerVisible({ state: 'soft-declined', dismissCount: 1, lastDismissAt: at, now: at + BANNER_HIDE_MS })).toBe(true);
  });

  it('stops after 3 dismissals, even after 7 days', () => {
    const at = 10_000;
    expect(
      notificationBannerVisible({
        state: 'ios-denied',
        dismissCount: BANNER_MAX_DISMISSES,
        lastDismissAt: at,
        now: at + BANNER_HIDE_MS * 4,
      }),
    ).toBe(false);
  });
});

describe('notificationBannerAction', () => {
  it('asks iOS while soft-declined, and opens Settings after a denial', () => {
    expect(notificationBannerAction('soft-declined')).toBe('request');
    expect(notificationBannerAction('ios-denied')).toBe('settings');
    expect(notificationBannerAction('never-asked')).toBe('none');
    expect(notificationBannerAction('granted')).toBe('none');
  });
});

describe('notification banner dismiss storage', () => {
  it('starts empty and records each dismiss with a count and time', async () => {
    const storage = kv();
    expect(await readNotificationBannerDismiss(storage)).toEqual({ count: 0, at: null });
    expect(await markNotificationBannerDismissed(storage, 100)).toEqual({ count: 1, at: 100 });
    expect(await markNotificationBannerDismissed(storage, 200)).toEqual({ count: 2, at: 200 });
    expect(await readNotificationBannerDismiss(storage)).toEqual({ count: 2, at: 200 });
  });

  it('treats a corrupt row as no dismisses', async () => {
    const storage = kv();
    await storage.setItem('notification-banner-dismiss.v1', 'not-json');
    expect(await readNotificationBannerDismiss(storage)).toEqual({ count: 0, at: null });
  });
});

describe('notificationTurnOn', () => {
  it('asks iOS when undetermined, opens Settings when denied, and registers when granted', () => {
    expect(notificationTurnOn('undetermined')).toBe('request');
    expect(notificationTurnOn('denied')).toBe('settings');
    expect(notificationTurnOn('granted')).toBe('register');
  });
});

describe('notification prompt copy', () => {
  it('uses the approved opt-in copy', () => {
    expect(NOTIFICATION_PROMPT_COPY).toEqual({
      title: 'Keep up with your friends',
      line: 'Stay on top of challenges and scores without opening the app.',
      turnOn: 'Turn on notifications',
      notNow: 'Not now',
      bannerTurnOn: 'Turn on',
      openSettings: 'Open Settings',
    });
  });
});

describe('subscribeNotificationOptInStorage', () => {
  it('notifies listeners when the sheet is answered or the banner is dismissed', async () => {
    const storage = kv();
    const seen: string[] = [];
    const off = subscribeNotificationOptInStorage(() => seen.push('change'));
    await markNotificationPromptShown(storage);
    await markNotificationBannerDismissed(storage, 1);
    off();
    await markNotificationPromptShown(storage);
    expect(seen).toEqual(['change', 'change']);
  });
});
