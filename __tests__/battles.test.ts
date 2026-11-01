import {
  Battle,
  battleSubtitle,
  canPlay,
  canRespond,
  Friend,
  friendlyError,
  groupBattles,
  groupFriends,
  inviteShareMessage,
  inviteUrl,
  Participant,
  personName,
  scoreLabel,
  timeLeft,
} from '../src/battles/model';
import { battleClockText, battleEndReason, BattleRules } from '../src/battles/battleClock';
import { countedReps } from '../src/battles/counting';
import {
  BATTLE_QUEUE_KEY,
  enqueueBattleSet,
  flushBattleQueue,
  isPermanentStatus,
  loadBattleQueue,
  pendingBattleIds,
  Submit,
} from '../src/battles/uploadQueue';
import type { KeyValueStore } from '../src/storage/history';
import type { Rep } from '../src/core/types';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();
const H = 3600_000;

const person = (userId: string, extra: Partial<Participant> = {}): Participant => ({
  userId,
  username: userId,
  displayName: null,
  status: 'accepted',
  isMe: false,
  attemptsUsed: 0,
  validReps: null,
  metricValue: null,
  avgDepthPct: null,
  tempoScore: null,
  rank: null,
  isWinner: false,
  ...extra,
});

const battle = (extra: Partial<Battle> = {}, participants?: Participant[]): Battle => ({
  id: 'b1',
  mode: 'async',
  format: 'max_reps',
  metric: 'rep_count',
  status: 'active',
  durationS: null,
  attemptsAllowed: 1,
  maxParticipants: 8,
  minQuality: 'good',
  inviteExpiresAt: iso(10 * H),
  endsAt: iso(20 * H),
  createdAt: iso(-H),
  finishedAt: null,
  createdBy: 'alice',
  locked: false,
  participants: participants ?? [person('alice', { attemptsUsed: 1, validReps: 20 }), person('me', { isMe: true })],
  inviteLinks: [],
  ...extra,
});

describe('battle model', () => {
  it('lets an accepted player play once before the deadline', () => {
    expect(canPlay(battle(), NOW)).toBe(true);
    expect(canPlay(battle({ endsAt: iso(-1) }), NOW)).toBe(false);
    expect(canPlay(battle({}, [person('alice'), person('me', { isMe: true, attemptsUsed: 1 })]), NOW)).toBe(false);
    expect(canPlay(battle({}, [person('alice'), person('me', { isMe: true, status: 'invited' })]), NOW)).toBe(false);
    expect(canPlay(battle({ status: 'completed' }), NOW)).toBe(false);
  });

  it('only the creator may go first while a battle is pending', () => {
    const pending = (meId: string) => battle({ status: 'pending', createdBy: 'me' === meId ? 'me' : 'alice' }, [person('alice'), person('me', { isMe: true })]);
    expect(canPlay(pending('me'), NOW)).toBe(true);
    expect(canPlay(pending('other'), NOW)).toBe(false);
  });

  it('invitees can answer until the invite expires', () => {
    const invited = (exp: number) => battle({ inviteExpiresAt: iso(exp) }, [person('alice'), person('me', { isMe: true, status: 'invited' })]);
    expect(canRespond(invited(H), NOW)).toBe(true);
    expect(canRespond(invited(-1), NOW)).toBe(false);
    expect(canRespond(battle(), NOW)).toBe(false);
  });

  it('groups battles into your move / waiting / results', () => {
    const mine = battle({ id: 'mine', endsAt: iso(5 * H) });
    const soon = battle({ id: 'soon', endsAt: iso(H) });
    const waiting = battle({ id: 'waiting' }, [person('alice'), person('me', { isMe: true, attemptsUsed: 1 })]);
    const old = battle({ id: 'old', status: 'completed', finishedAt: iso(-5 * H) });
    const recent = battle({ id: 'recent', status: 'completed', finishedAt: iso(-H) });
    const g = groupBattles([old, mine, waiting, recent, soon], NOW);
    expect(g.yourMove.map((b) => b.id)).toEqual(['soon', 'mine']);
    expect(g.waiting.map((b) => b.id)).toEqual(['waiting']);
    expect(g.finished.map((b) => b.id)).toEqual(['recent', 'old']);
  });

  it('describes where a battle stands', () => {
    expect(battleSubtitle(battle(), NOW)).toBe('Your move · 20 h 0 m left');
    const won = battle({ status: 'completed' }, [person('alice', { rank: 2 }), person('me', { isMe: true, rank: 1 })]);
    expect(battleSubtitle(won, NOW)).toBe('You won');
    const draw = battle({ status: 'completed' }, [person('alice', { rank: 1 }), person('me', { isMe: true, rank: 1 })]);
    expect(battleSubtitle(draw, NOW)).toBe('Draw');
    const third = battle({ status: 'completed' }, [person('a', { rank: 1 }), person('b', { rank: 2 }), person('me', { isMe: true, rank: 3 })]);
    expect(battleSubtitle(third, NOW)).toBe('You came 3 of 3');
    const waiting = battle({}, [person('alice', { status: 'invited' }), person('me', { isMe: true, attemptsUsed: 1 })]);
    expect(battleSubtitle(waiting, NOW)).toBe('Waiting on 1 · 20 h 0 m left');
    expect(battleSubtitle(battle({ status: 'expired' }), NOW)).toBe('Expired');
  });

  it('formats time left and scores', () => {
    expect(timeLeft(iso(30_000), NOW)).toBe('under a minute left');
    expect(timeLeft(iso(12 * 60_000), NOW)).toBe('12 m left');
    expect(timeLeft(iso(72 * H), NOW)).toBe('3 days left');
    expect(timeLeft(iso(-1), NOW)).toBe('ended');
    expect(timeLeft(null, NOW)).toBe('');
    expect(scoreLabel({ attemptsUsed: 0, validReps: null, metricValue: null }, 'rep_count')).toBe('-');
    expect(scoreLabel({ attemptsUsed: 1, validReps: 0, metricValue: 0 }, 'rep_count')).toBe('0');
    expect(scoreLabel({ attemptsUsed: 1, validReps: 9, metricValue: 71.6 }, 'form_score')).toBe('72');
  });

  it('builds invite links: custom scheme now, web domain once configured', () => {
    const t = 'a'.repeat(32);
    expect(inviteUrl(t, { scheme: 'pushupcounter', webBaseUrl: null })).toBe(`pushupcounter://invite/${t}`);
    expect(inviteUrl(t, { scheme: 'pushupcounter', webBaseUrl: 'https://pushup.example.app' })).toBe(`https://pushup.example.app/b/${t}`);
    expect(inviteShareMessage({ format: 'timed', durationS: 60 }, 'Jack', 'pushupcounter://invite/x')).toMatch(/Jack challenged you to a 60 second pushup battle.*pushupcounter:\/\/invite\/x/);
  });

  it('names people and groups friends', () => {
    expect(personName({ username: 'jack', displayName: ' ' })).toBe('@jack');
    expect(personName({ username: 'jack', displayName: 'Jack R' })).toBe('Jack R');
    expect(personName(null)).toBe('Someone');
    const f = (username: string, relation: Friend['relation']): Friend => ({ userId: username, username, displayName: null, relation });
    const g = groupFriends([f('zed', 'friend'), f('amy', 'friend'), f('bob', 'incoming'), f('cat', 'outgoing'), f('dan', 'blocked')]);
    expect(g.friends.map((x) => x.username)).toEqual(['amy', 'zed']);
    expect(g.incoming.map((x) => x.username)).toEqual(['bob']);
    expect(g.outgoing.map((x) => x.username)).toEqual(['cat']);
    expect(g.blocked.map((x) => x.username)).toEqual(['dan']);
  });

  it('turns server errors into plain messages', () => {
    expect(friendlyError('not friends')).toMatch(/only challenge friends/);
    expect(friendlyError('invite expired')).toMatch(/expired/);
    expect(friendlyError('that is you')).toBe("That's you!");
    expect(friendlyError('TypeError: Network request failed')).toMatch(/connection/);
    expect(friendlyError('weird')).toBe('weird');
    expect(friendlyError(undefined)).toBe('Something went wrong.');
  });
});

describe('battle clock', () => {
  const timed: BattleRules = { format: 'timed', durationS: 60, idleEndS: 15, capS: 600 };
  const maxReps: BattleRules = { format: 'max_reps', durationS: null, idleEndS: 15, capS: 600 };
  const go = 1_000_000;

  it('ends timed sets at the duration', () => {
    expect(battleEndReason(timed, go + 59_999, go, null)).toBeNull();
    expect(battleEndReason(timed, go + 60_000, go, null)).toBe('time_up');
    expect(battleClockText(timed, go + 500, go, null)).toBe('1:00');
    expect(battleClockText(timed, go + 50_500, go, null)).toBe('0:10');
  });

  it('ends max-reps sets after a pause or at the cap', () => {
    expect(battleEndReason(maxReps, go + 14_000, go, null)).toBeNull();
    expect(battleEndReason(maxReps, go + 15_000, go, null)).toBe('idle');
    expect(battleEndReason(maxReps, go + 20_000, go, go + 10_000)).toBeNull();
    expect(battleEndReason(maxReps, go + 25_000, go, go + 10_000)).toBe('idle');
    expect(battleEndReason(maxReps, go + 600_000, go, go + 599_000)).toBe('cap');
    expect(battleClockText(maxReps, go + 1_000, go, null)).toBe('');
    expect(battleClockText(maxReps, go + 12_000, go, null)).toMatch(/Ends in 3/);
  });
});

describe('counted reps (what the battle will count)', () => {
  const rep = (i: number, quality: Rep['quality'], t: number): Rep => ({
    index: i,
    timestamp: t,
    quality,
    source: 'depth',
    bottomDistance: 0.15,
    topDistance: 0.5,
    rangeOfMotion: 0.35,
    depthRatio: 0.8,
    faceLostAtBottom: false,
  });
  it('counts Full and Good reps but never Shallow ones', () => {
    const reps = [rep(1, 'full', 1000), rep(2, 'good', 2000), rep(3, 'shallow', 3000), rep(4, 'full', 4000)];
    expect(countedReps(reps, 0, { format: 'max_reps', durationS: null })).toBe(3);
  });
  it('only counts reps inside a timed battle', () => {
    const reps = [rep(1, 'full', 59_000), rep(2, 'full', 60_000), rep(3, 'full', 61_000)];
    expect(countedReps(reps, 0, { format: 'timed', durationS: 60 })).toBe(2);
  });
});

class MemoryKV implements KeyValueStore {
  data = new Map<string, string>();
  async getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  async removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('battle upload queue', () => {
  it('classifies HTTP errors', () => {
    expect(isPermanentStatus(400)).toBe(true);
    expect(isPermanentStatus(409)).toBe(true);
    expect(isPermanentStatus(401)).toBe(false);
    expect(isPermanentStatus(429)).toBe(false);
    expect(isPermanentStatus(500)).toBe(false);
    expect(isPermanentStatus(0)).toBe(false);
  });

  it('queues, dedupes and uploads oldest first', async () => {
    const kv = new MemoryKV();
    await enqueueBattleSet(kv, 'b1', { id: 's1', reps: [] }, 1);
    await enqueueBattleSet(kv, 'b2', { id: 's2', reps: [] }, 2);
    await enqueueBattleSet(kv, 'b1', { id: 's1', reps: [1] }, 3);
    const q = await loadBattleQueue(kv);
    expect(q.pending.map((p) => p.payload.id)).toEqual(['s2', 's1']);
    expect(q.pending[1].payload).toEqual({ id: 's1', reps: [1], battleId: 'b1' });
    expect(pendingBattleIds(q)).toEqual(new Set(['b1', 'b2']));

    const sent: unknown[] = [];
    const submit: Submit = async (p) => (sent.push(p.id), { ok: true, setId: `${p.id}` });
    const r = await flushBattleQueue(kv, submit);
    expect(sent).toEqual(['s2', 's1']);
    expect(r.uploaded.length).toBe(2);
    expect((await loadBattleQueue(kv)).pending).toEqual([]);
  });

  it('keeps transient failures queued and drops permanent ones with the reason', async () => {
    const kv = new MemoryKV();
    await enqueueBattleSet(kv, 'b1', { id: 'late' }, 1);
    await enqueueBattleSet(kv, 'b2', { id: 'offline' }, 2);
    await enqueueBattleSet(kv, 'b3', { id: 'after' }, 3);
    const submit: Submit = async (p) =>
      p.id === 'late' ? { ok: false, status: 409, error: 'deadline passed' } : { ok: false, status: 0, error: 'Network request failed' };
    const r = await flushBattleQueue(kv, submit);
    expect(r.failed.map((f) => f.payload.id)).toEqual(['late']);
    const q = await loadBattleQueue(kv);
    // stops at the first transient error, so 'after' was not tried
    expect(q.pending.map((p) => [p.payload.id, p.tries])).toEqual([
      ['offline', 1],
      ['after', 0],
    ]);
    expect(q.failed.map((f) => [f.payload.id, f.error])).toEqual([['late', 'deadline passed']]);
  });

  it('survives corrupt storage', async () => {
    const kv = new MemoryKV();
    await kv.setItem(BATTLE_QUEUE_KEY, '{nope');
    expect(await loadBattleQueue(kv)).toEqual({ pending: [], failed: [] });
  });
});
