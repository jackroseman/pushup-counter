import {
  NOTIFICATION_PROMPT_COPY,
  markNotificationPromptShown,
  notificationSurface,
  notificationTurnOn,
  readNotificationPromptShown,
} from '../src/notifications/prompt';

describe('notificationSurface', () => {
  it('stays hidden once permission is granted', () => {
    expect(notificationSurface({ permission: 'granted', justActed: true, shown: false })).toBe('none');
  });

  it('shows the sheet after creating, accepting, or joining while permission is still off', () => {
    expect(notificationSurface({ permission: 'undetermined', justActed: true, shown: false })).toBe('sheet');
    expect(notificationSurface({ permission: 'denied', justActed: true, shown: false })).toBe('sheet');
  });

  it('shows nothing on an ordinary visit (no banner)', () => {
    expect(notificationSurface({ permission: 'undetermined', justActed: false, shown: false })).toBe('none');
    expect(notificationSurface({ permission: 'denied', justActed: false, shown: false })).toBe('none');
  });

  it('is shown once: after an answer it never comes back', async () => {
    const data = new Map<string, string>();
    const kv = { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => void data.set(k, v) };
    expect(await readNotificationPromptShown(kv)).toBe(false);
    await markNotificationPromptShown(kv);
    const shown = await readNotificationPromptShown(kv);
    expect(shown).toBe(true);
    expect(notificationSurface({ permission: 'undetermined', justActed: true, shown })).toBe('none');
    expect(notificationSurface({ permission: 'denied', justActed: true, shown })).toBe('none');
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
  it('stays generic', () => {
    expect(NOTIFICATION_PROMPT_COPY).toEqual({
      title: 'Turn on notifications',
      line: 'Stay in the loop with your friends and challenges.',
      turnOn: 'Turn on notifications',
      notNow: 'Not now',
    });
  });
});
