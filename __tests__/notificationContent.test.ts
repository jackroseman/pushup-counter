import { buildNotification, ClaimedNotification, deadlineText, ordinal, scoreText } from '../supabase/functions/_shared/notificationContent';

const B = '11111111-1111-4111-8111-111111111111';
const row = (kind: string, facts: ClaimedNotification['facts'], battle: string | null = B): ClaimedNotification => ({
  id: 1,
  user_id: 'u',
  kind,
  battle_id: battle,
  facts,
});
const battle = { id: B, format: 'timed' as const, metric: 'rep_count' as const, durationS: 60, status: 'active', endsAt: '2026-11-06T23:00:00Z' };

describe('notification text', () => {
  it('friend request and accept link to the friends screen', () => {
    const n = buildNotification(row('friend_request', { actor: { username: 'bob' } }, null))!;
    expect(n.body).toBe('@bob wants to be friends');
    expect(n.data).toEqual({ type: 'friend_request', url: 'pushupcounter://friends' });
    expect(buildNotification(row('friend_accepted', { actor: { username: 'bob', displayName: 'Bob' } }, null))!.body).toMatch(/^Bob accepted/);
  });

  it('invite names the format and the score to beat', () => {
    const n = buildNotification(row('battle_invite', { actor: { username: 'sunny', displayName: 'Sunny' }, battle, leader: { username: 'sunny', validReps: 32 } }))!;
    expect(n.body).toBe('Sunny challenged you to a 60 s battle. sunny already did 32 reps.');
    expect(n.data).toMatchObject({ url: `pushupcounter://battle/${B}`, battleId: B });
  });

  it('opponent submitted shows the deadline in the recipient time zone', () => {
    const n = buildNotification(row('set_submitted', { timeZone: 'America/New_York', actor: { username: 'bob', displayName: 'Bob' }, actorScore: { validReps: 28 }, battle: { ...battle, mySetDone: false } }))!;
    expect(n.body).toBe('Bob did 28 reps. Beat it by Fri 6:00 PM');
    const done = buildNotification(row('set_submitted', { actor: { username: 'bob' }, actorScore: { validReps: 1 }, battle: { ...battle, mySetDone: true } }))!;
    expect(done.body).toBe('bob did 1 rep');
    expect(buildNotification(row('set_submitted', { actor: { username: 'bob' }, battle: { ...battle, status: 'completed' } }))).toBeNull();
  });

  it('reminders say how long is left, and skip people who already played', () => {
    const now = new Date('2026-11-06T19:00:00Z');
    const n = buildNotification(row('battle_reminder', { battle, leader: { username: 'sunny', validReps: 32 } }), now)!;
    expect(n.body).toBe("4 h left to beat sunny's 32 reps");
    expect(buildNotification(row('battle_reminder', { battle: { ...battle, mySetDone: true } }), now)).toBeNull();
    expect(buildNotification(row('battle_reminder_half', { battle: { ...battle, endsAt: '2026-11-06T19:20:00Z' } }), now)!.body).toBe('Under an hour left in your battle');
  });

  it('results: win, loss, draw', () => {
    const top = [
      { username: 'me', rank: 1, validReps: 32, isMe: true },
      { username: 'bob', rank: 2, validReps: 28 },
    ];
    expect(buildNotification(row('battle_result', { battle, result: { rank: 1, isWinner: true, validReps: 32, players: 2, top } }))!.body).toBe('You won! 32 reps vs 28 reps');
    const lossTop = [{ username: 'bob', rank: 1, validReps: 40 }, { username: 'me', rank: 2, validReps: 30, isMe: true }];
    expect(buildNotification(row('battle_result', { battle, result: { rank: 2, validReps: 30, players: 3, top: lossTop } }))!.body).toBe('You came 2nd of 3. bob won with 40 reps');
    expect(buildNotification(row('battle_result', { battle, result: { rank: 1, draw: true, validReps: 20, players: 2, top: [] } }))!.body).toBe("It's a draw! 20 reps each");
  });

  it('unknown kinds and missing facts send nothing', () => {
    expect(buildNotification(row('something_else', {}))).toBeNull();
    expect(buildNotification(row('battle_invite', null))).toBeNull();
    expect(buildNotification(row('battle_result', { battle }))).toBeNull();
  });

  it('cancel and expiry', () => {
    expect(buildNotification(row('battle_cancelled', { battle: { ...battle, creator: 'sunny' } }))!.body).toBe('@sunny cancelled the battle');
    expect(buildNotification(row('battle_expired', { battle: { ...battle, creatorIsMe: true } }))!.body).toBe('Nobody joined your challenge in time');
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
