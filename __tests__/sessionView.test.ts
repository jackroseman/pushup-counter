import { clockText, countdownProgress, countingTitle, faceCenteringView, faceRestartDue, nextSetNumber, toBeatLine, CENTER_FACE_LINE, FACE_RESTART_MS } from '../src/session/sessionView';
import type { Battle } from '../src/battles/model';
import type { GuideSnapshot } from '../src/core';

const p = (o: Partial<Battle['participants'][number]>) =>
  ({ userId: 'u', username: null, displayName: null, status: 'accepted', isMe: false, attemptsUsed: 0, validReps: null, metricValue: null, avgDepthPct: null, tempoScore: null, rank: null, isWinner: false, ...o }) as Battle['participants'][number];

describe('sessionView', () => {
  it('formats the set clock', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(41_900)).toBe('0:41');
    expect(clockText(72_000)).toBe('1:12');
    expect(clockText(-5)).toBe('0:00');
  });

  it('titles the counting screen', () => {
    expect(countingTitle({ setNumber: 4, elapsedMs: 41_000 })).toBe('Set 4 · 0:41');
    expect(countingTitle({ setNumber: null, elapsedMs: 5_000 })).toBe('0:05');
    expect(countingTitle({ setNumber: 2, elapsedMs: 5_000, isBattle: true, battleClock: '0:55' })).toBe('Challenge · 0:55');
    expect(countingTitle({ setNumber: 2, elapsedMs: 5_000, isBattle: true, battleClock: '' })).toBe('Challenge · 0:05');
  });

  it("numbers today's sets in the phone's zone", () => {
    const zone = 'America/New_York';
    const now = Date.parse('2026-11-25T15:00:00-05:00');
    const sets = [Date.parse('2026-11-25T07:05:00-05:00'), Date.parse('2026-11-25T09:30:00-05:00'), Date.parse('2026-11-24T23:30:00-05:00')];
    expect(nextSetNumber(sets, now, zone)).toBe(3);
    expect(nextSetNumber([], now, zone)).toBe(1);
  });

  it('says how many reps beat the best other player', () => {
    const battle = {
      participants: [
        p({ isMe: true, validReps: 60 }),
        p({ displayName: 'Brett', validReps: 47 }),
        p({ username: 'jack', validReps: 30 }),
        p({ displayName: 'Nobody', validReps: null }),
      ],
    };
    expect(toBeatLine(battle, 17)).toBe('31 to beat Brett');
    expect(toBeatLine(battle, 47)).toBe('1 to beat Brett');
    expect(toBeatLine(battle, 48)).toBeNull();
    expect(toBeatLine({ participants: [p({ isMe: true, validReps: 10 }), p({ username: 'jack', validReps: 0 })] }, 3)).toBeNull();
    expect(toBeatLine(undefined, 3)).toBeNull();
  });

  it('fills the 3-2-1 ring by seconds left', () => {
    expect(countdownProgress(3, 3)).toBe(1);
    expect(countdownProgress(2, 3)).toBeCloseTo(2 / 3);
    expect(countdownProgress(null, 3)).toBe(0);
  });

  it('shows the plain line when the pose is right and the hint otherwise', () => {
    expect(faceCenteringView(null)).toEqual({ centered: false, ready: false, progress: 0, line: CENTER_FACE_LINE });
    const guide = (ok: boolean, centered: 'ok' | 'bad', message: string, progress = 0.5) =>
      ({ pose: { ok, centered }, progress, message, holding: ok, lastReset: null, result: null }) as unknown as GuideSnapshot;
    expect(faceCenteringView(guide(true, 'ok', 'Hold still'))).toEqual({ centered: true, ready: true, progress: 0.5, line: CENTER_FACE_LINE });
    expect(faceCenteringView(guide(false, 'bad', 'Shift left a little to center over the camera', 0))).toMatchObject({
      centered: false,
      ready: false,
      line: 'Shift left a little to center over the camera',
    });
  });

  it('restarts face tracking only after a long stretch with no face', () => {
    const since = 1_000_000;
    // Just entered centering: wait.
    expect(faceRestartDue({ now: since + 1_000, since, lastTracked: 0, lastRestart: 0 })).toBe(false);
    // No face at all for the full gap: restart.
    expect(faceRestartDue({ now: since + FACE_RESTART_MS, since, lastTracked: 0, lastRestart: 0 })).toBe(true);
    // A face was seen recently: wait.
    expect(faceRestartDue({ now: since + 10_000, since, lastTracked: since + 9_000, lastRestart: 0 })).toBe(false);
    // Just restarted: give it the full gap again.
    expect(faceRestartDue({ now: since + 6_000, since, lastTracked: 0, lastRestart: since + 4_000 })).toBe(false);
    expect(faceRestartDue({ now: since + 8_000, since, lastTracked: 0, lastRestart: since + 4_000 })).toBe(true);
  });
});
