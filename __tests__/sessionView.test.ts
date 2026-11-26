import { clockText, countdownProgress, countingTitle, faceCenteringView, faceDiagLine, emptyFaceDiag, isDevVariant, nextSetNumber, toBeatLine, CENTER_FACE_LINE } from '../src/session/sessionView';
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

  it('formats the dev face diagnostics line', () => {
    const d = { ...emptyFaceDiag(), faceStart: 'ok' as const, events: 12, tracked: 9, lastEventAt: 1_000, starts: 1, effects: 1, motion: 'on' as const };
    expect(faceDiagLine(d, { width: 361.4, height: 380 }, 'minimal', 1_200)).toBe(
      'cam ok · view 361x380 minimal · ev 12/9 · last 0.2s · start 1 stop 0 fx 1 · motion on'
    );
    expect(faceDiagLine(emptyFaceDiag(), null, 'full', 5)).toBe('cam pending · view - full · ev 0/0 · last - · start 0 stop 0 fx 0 · motion pending');
    expect(faceDiagLine({ ...emptyFaceDiag(), lastError: 'Camera in use' }, null, 'full', 5)).toContain('err Camera in use');
  });

  it('shows diagnostics only in Pushup Dev or a dev bundle', () => {
    expect(isDevVariant({ name: 'Pushup Dev' }, false)).toBe(true);
    expect(isDevVariant({ name: 'Rep Royale', ios: { bundleIdentifier: 'com.jackroseman.pushupcounter.dev' } }, false)).toBe(true);
    expect(isDevVariant({ name: 'Rep Royale', ios: { bundleIdentifier: 'com.jackroseman.pushupcounter' } }, false)).toBe(false);
    expect(isDevVariant(null, false)).toBe(false);
    expect(isDevVariant(null, true)).toBe(true);
  });
});
