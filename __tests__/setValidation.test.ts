import { statusForDbError, validateBattleSet } from '../supabase/functions/_shared/setValidation';

const BATTLE = '22222222-2222-4222-8222-222222222222';
const cfg = { algorithmVersion: 2, floorDistance: 0.08, fullRatio: 0.7, goodRatio: 0.45, minCountRatio: 0.3, minRepIntervalMs: 400 };
function set(n = 3, extra: Record<string, unknown> = {}) {
  const start = 1_700_000_000_000;
  const reps = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    startedAt: start + 1000 + i * 1500,
    bottomAt: start + 1600 + i * 1500,
    timestamp: start + 2200 + i * 1500,
    bottomDistance: 0.15,
    topDistance: 0.42,
    source: 'depth',
  }));
  return { id: 'local-1', battleId: BATTLE, version: 2, startedAt: start, endedAt: start + 3000 + n * 1500, reps, trace: [[0, 0.42], [100, 0.4]], detectorConfig: cfg, ...extra };
}

describe('validateBattleSet', () => {
  it('accepts a good set and drops any client userId', () => {
    const r = validateBattleSet(set(3, { userId: 'someone-else' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.battleId).toBe(BATTLE);
      expect('userId' in r.payload).toBe(false);
    }
  });

  it('accepts a 0-rep attempt without a trace', () => {
    expect(validateBattleSet(set(0, { trace: undefined })).ok).toBe(true);
  });

  it.each([
    ['no battle id', { battleId: 'x' }, /battleId/],
    ['legacy data', { version: 1 }, /data version/],
    ['no detector config', { detectorConfig: undefined }, /detector config/],
    ['too long', { endedAt: 1_700_000_000_000 + 3 * 3600_000 }, /2 hours/],
    ['ends before start', { endedAt: 1 }, /times/],
    ['no trace', { trace: [] }, /depth trace/],
    ['huge trace', { trace: Array.from({ length: 3002 }, (_, i) => [i * 100, 0.4]) }, /3001/],
    ['bad trace point', { trace: [[0, 'x']] }, /trace point/],
  ])('rejects %s', (_label, extra, msg) => {
    const r = validateBattleSet(set(3, extra));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });

  it('rejects non-monotonic reps and reps outside the set', () => {
    const s = set(3);
    s.reps[2].index = 5;
    expect(validateBattleSet(s)).toMatchObject({ ok: false, error: expect.stringMatching(/indices/) });
    const t = set(3);
    t.reps[2].timestamp = t.reps[1].timestamp - 10;
    t.reps[2].bottomAt = t.reps[2].timestamp - 100;
    t.reps[2].startedAt = t.reps[2].timestamp - 200;
    expect(validateBattleSet(t)).toMatchObject({ ok: false, error: expect.stringMatching(/backwards/) });
    const u = set(3);
    u.reps[2].timestamp = u.endedAt + 5000;
    expect(validateBattleSet(u)).toMatchObject({ ok: false, error: expect.stringMatching(/outside the set/) });
    const v = set(3);
    v.reps[0].source = 'proximity';
    expect(validateBattleSet(v)).toMatchObject({ ok: false, error: expect.stringMatching(/depth/) });
  });

  it('rejects too many reps and non-objects', () => {
    expect(validateBattleSet(set(2001)).ok).toBe(false);
    expect(validateBattleSet(null).ok).toBe(false);
    expect(validateBattleSet([]).ok).toBe(false);
  });
});

describe('statusForDbError', () => {
  it('maps battle rule violations to 409 and data errors to 400', () => {
    expect(statusForDbError('no attempts left', 'P0001')).toBe(409);
    expect(statusForDbError('battle deadline passed', 'P0001')).toBe(409);
    expect(statusForDbError('not an accepted participant', 'P0001')).toBe(409);
    expect(statusForDbError('value too long', '22001')).toBe(400);
    expect(statusForDbError('boom')).toBe(500);
  });
});
