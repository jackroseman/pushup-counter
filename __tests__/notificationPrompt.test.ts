import {
  NOTIFICATION_PROMPT_COPY,
  NOTIFICATION_SNOOZE_MS,
  notificationSurface,
  notificationTurnOn,
  snoozeUntil,
} from '../src/notifications/prompt';

const now = 1_700_000_000_000;

describe('notificationSurface', () => {
  it('stays hidden once permission is granted', () => {
    expect(notificationSurface({ permission: 'granted', justActed: true, snoozedUntil: null, now })).toBe('none');
  });

  it('shows the sheet after creating, accepting, or joining while permission is still off', () => {
    expect(notificationSurface({ permission: 'undetermined', justActed: true, snoozedUntil: null, now })).toBe('sheet');
    expect(notificationSurface({ permission: 'denied', justActed: true, snoozedUntil: null, now })).toBe('sheet');
  });

  it('shows nothing on an ordinary visit, or while Not now lasts (no banner)', () => {
    expect(notificationSurface({ permission: 'undetermined', justActed: false, snoozedUntil: null, now })).toBe('none');
    expect(notificationSurface({ permission: 'denied', justActed: false, snoozedUntil: null, now })).toBe('none');
    const until = snoozeUntil(now);
    expect(until - now).toBe(NOTIFICATION_SNOOZE_MS);
    expect(until - now).toBe(3 * 24 * 60 * 60 * 1000);
    expect(notificationSurface({ permission: 'denied', justActed: true, snoozedUntil: until, now: until - 1 })).toBe('none');
    expect(notificationSurface({ permission: 'undetermined', justActed: true, snoozedUntil: until, now: until })).toBe('sheet');
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
