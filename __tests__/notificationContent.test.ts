import { buildNotification, ClaimedNotification, deadlineText, ordinal, scoreText } from '../supabase/functions/_shared/notificationContent';

const B = '11111111-1111-4111-8111-111111111111';
const row = (kind: string, facts: ClaimedNotification['facts'], challenge: string | null = B): ClaimedNotification => ({
  id: 1,
  user_id: 'u',
  kind,
  challenge_id: challenge,
  facts,
});
const challenge = { id: B, kind: 'best_set' as const, metric: 'rep_count' as const, durationS: 60, status: 'active', endsAt: '2026-11-06T23:00:00Z' };
const week = { id: B, kind: 'total' as const, windowUnit: 'week' as const, metric: null, status: 'active', endsAt: '2026-11-09T05:00:00Z' };

describe('notification text', () => {
  it('friend request and accept link to the friends screen', () => {
    const n = buildNotification(row('friend_request', { actor: { username: 'bob' } }, null))!;
    expect(n.body).toBe('@bob wants to be friends');
    expect(n.data).toEqual({ type: 'friend_request', url: 'pushupcounter://friends' });
    expect(buildNotification(row('friend_accepted', { actor: { username: 'bob', displayName: 'Bob' } }, null))!.body).toMatch(/^Bob accepted/);
  });

  it('invite names the challenge', () => {
    const n = buildNotification(row('challenge_invite', { actor: { username: 'sunny', displayName: 'Sunny' }, challenge: week }))!;
    expect(n.body).toBe('Sunny challenged you: most reps this week.');
    expect(n.data).toMatchObject({ url: `pushupcounter://challenge/${B}`, challengeId: B });
    expect(buildNotification(row('challenge_invite', { actor: { displayName: 'Sunny' }, challenge }))!.body).toBe('Sunny challenged you: best set · 60 s.');
  });

  it('opponent submitted shows the deadline in the recipient time zone', () => {
    const n = buildNotification(row('set_submitted', { timeZone: 'America/New_York', actor: { username: 'bob', displayName: 'Bob' }, actorScore: { validReps: 28 }, challenge: { ...challenge, mySetDone: false } }))!;
    expect(n.body).toBe('Bob is on 28. You have until Fri 6:00 PM.');
    const done = buildNotification(row('set_submitted', { actor: { username: 'bob' }, actorScore: { validReps: 1 }, challenge: { ...challenge, mySetDone: true } }))!;
    expect(done.body).toBe('bob is on 1.');
    const weekUpdate = buildNotification(row('set_submitted', { actor: { displayName: 'Bob' }, actorScore: { validReps: 40 }, challenge: week }))!;
    expect(weekUpdate.body).toBe('Bob is on 40 reps this week.');
    expect(buildNotification(row('set_submitted', { actor: { username: 'bob' }, challenge: { ...challenge, status: 'completed' } }))).toBeNull();
  });

  it('accept and decline', () => {
    expect(buildNotification(row('invite_accepted', { actor: { displayName: 'Bob' }, challenge }))!.body).toBe("Bob accepted. You're on.");
    expect(buildNotification(row('invite_declined', { actor: { displayName: 'Bob' }, challenge }))!.body).toBe('Bob declined.');
  });

  it('reminders say how long is left, and skip people who already played', () => {
    const now = new Date('2026-11-06T19:00:00Z');
    const n = buildNotification(row('challenge_reminder', { challenge, leader: { username: 'sunny', validReps: 32 } }), now)!;
    expect(n.body).toBe("4 hours left to beat sunny's 32.");
    expect(buildNotification(row('challenge_reminder', { challenge: { ...challenge, mySetDone: true } }), now)).toBeNull();
    expect(buildNotification(row('challenge_reminder_half', { challenge: { ...challenge, endsAt: '2026-11-06T19:20:00Z' } }), now)!.body).toBe('Under an hour left.');
  });

  it('results: win, loss, draw', () => {
    const top = [
      { username: 'me', rank: 1, validReps: 32, isMe: true },
      { username: 'bob', rank: 2, validReps: 28 },
    ];
    expect(buildNotification(row('challenge_result', { challenge, result: { rank: 1, isWinner: true, validReps: 32, players: 2, top } }))!.body).toBe('You won. 32 to 28.');
    const lossTop = [{ username: 'bob', rank: 1, validReps: 40 }, { username: 'me', rank: 2, validReps: 30, isMe: true }];
    expect(buildNotification(row('challenge_result', { challenge, result: { rank: 2, validReps: 30, players: 3, top: lossTop } }))!.body).toBe('You came 2nd of 3.');
    expect(buildNotification(row('challenge_result', { challenge, result: { rank: 1, draw: true, validReps: 20, players: 2, top: [] } }))!.body).toBe('Draw.');
  });

  it('unknown kinds and missing facts send nothing', () => {
    expect(buildNotification(row('something_else', {}))).toBeNull();
    expect(buildNotification(row('challenge_invite', null))).toBeNull();
    expect(buildNotification(row('challenge_result', { challenge }))).toBeNull();
  });

  it('cancel and expiry', () => {
    expect(buildNotification(row('challenge_cancelled', { challenge: { ...challenge, creator: 'sunny' } }))!.body).toBe('@sunny cancelled the challenge.');
    expect(buildNotification(row('challenge_expired', { challenge: { ...challenge, creatorIsMe: true } }))!.body).toBe('The challenge ended before enough people played.');
  });
});

describe('helpers', () => {
  it('scoreText', () => {
    expect(scoreText({ validReps: 0 }, 'rep_count')).toBe('0 reps');
    expect(scoreText({ validReps: 5, metricValue: 87.6 }, 'tempo')).toBe('88');
    expect(scoreText(undefined, 'rep_count')).toBe('0');
  });
  it('deadlineText falls back to UTC for a bad zone', () => {
    expect(deadlineText('2026-11-06T23:00:00Z', 'Not/AZone')).toBe('Fri 11:00 PM');
    expect(deadlineText(undefined, 'UTC')).toBeNull();
  });
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});
