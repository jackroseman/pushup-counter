// Pure hard checks for a battle set upload (SPEC §7 "Hard checks"), run by the submit-set
// Edge Function before it calls submit_set() as the service role. No Deno or npm imports,
// so jest tests it (__tests__/setValidation.test.ts). The DB triggers repeat the battle
// rules (participant, open battle, attempts, deadline); this file checks the data's shape.

export const BATTLE_DATA_VERSION = 2;
export const MAX_SET_MS = 2 * 60 * 60 * 1000;
export const MAX_REPS = 2000;
export const MAX_TRACE_POINTS = 3001;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Slack for clock jitter between rep timestamps and the set's end. */
const END_SLACK_MS = 1000;

export type ValidationResult =
  | { ok: true; payload: Record<string, unknown>; battleId: string }
  | { ok: false; error: string };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optNum = (v: unknown) => v === null || v === undefined || num(v);

export function validateBattleSet(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'body must be an object' };
  const p = body as Record<string, unknown>;
  const fail = (error: string): ValidationResult => ({ ok: false, error });

  if (typeof p.battleId !== 'string' || !UUID_RE.test(p.battleId)) return fail('battleId must be a uuid');
  if (typeof p.id !== 'string' || p.id.length < 1 || p.id.length > 100) return fail('id is required');
  if (p.version !== BATTLE_DATA_VERSION) return fail(`battle sets must use data version ${BATTLE_DATA_VERSION}`);
  if (!num(p.startedAt) || !num(p.endedAt) || p.endedAt < p.startedAt) return fail('bad start/end times');
  if (p.endedAt - p.startedAt > MAX_SET_MS) return fail('set is longer than 2 hours');

  const cfg = p.detectorConfig as Record<string, unknown> | undefined;
  if (typeof cfg !== 'object' || cfg === null || !num(cfg.algorithmVersion) || !num(cfg.fullRatio) || !num(cfg.goodRatio) || !num(cfg.minCountRatio) || !num(cfg.minRepIntervalMs)) {
    return fail('a detector config is required');
  }

  if (!Array.isArray(p.reps)) return fail('reps must be an array');
  if (p.reps.length > MAX_REPS) return fail(`at most ${MAX_REPS} reps`);
  let prevIndex = 0;
  let prevTime = -Infinity;
  for (const r of p.reps as unknown[]) {
    if (typeof r !== 'object' || r === null) return fail('bad rep');
    const rep = r as Record<string, unknown>;
    if (typeof rep.index !== 'number' || !Number.isInteger(rep.index) || rep.index !== prevIndex + 1) return fail('rep indices must be 1, 2, 3, ...');
    if (!num(rep.timestamp) || rep.timestamp < prevTime) return fail('rep times must not go backwards');
    if (rep.timestamp < p.startedAt || rep.timestamp > p.endedAt + END_SLACK_MS) return fail('rep outside the set');
    if (!optNum(rep.startedAt) || !optNum(rep.bottomAt) || !optNum(rep.bottomDistance) || !optNum(rep.topDistance)) return fail('bad rep values');
    if (num(rep.startedAt) && (rep.startedAt < p.startedAt || rep.startedAt > rep.timestamp)) return fail('rep start outside the rep');
    if (num(rep.bottomAt) && (rep.bottomAt < p.startedAt || rep.bottomAt > rep.timestamp)) return fail('rep bottom outside the rep');
    if (rep.source !== undefined && rep.source !== 'depth') return fail('battle reps must be counted from depth');
    prevIndex = rep.index;
    prevTime = rep.timestamp;
  }

  // A set with reps must carry its depth trace (the not_in_trace check reads it).
  const trace = p.trace;
  if (trace !== undefined && !Array.isArray(trace)) return fail('trace must be an array');
  const points = (trace ?? []) as unknown[];
  if (p.reps.length > 0 && points.length === 0) return fail('battle sets must include the depth trace');
  if (points.length > MAX_TRACE_POINTS) return fail(`trace is limited to ${MAX_TRACE_POINTS} points`);
  let prevT = -1;
  for (const pt of points) {
    if (!Array.isArray(pt) || pt.length !== 2 || !num(pt[0]) || !(pt[1] === null || num(pt[1]))) return fail('bad trace point');
    if (pt[0] < prevT) return fail('trace times must not go backwards');
    prevT = pt[0];
  }

  // Never trust a client-supplied owner; the function sets userId from the verified JWT.
  const { userId: _ignored, ...payload } = p;
  return { ok: true, payload, battleId: p.battleId };
}

/** Postgres error -> HTTP status for the submit-set function. */
export function statusForDbError(message: string, code?: string): number {
  if (/not an accepted participant|battle not open for sets|no attempts left|battle deadline passed/i.test(message)) return 409;
  if (code && /^(22|23)/.test(code)) return 400;
  return 500;
}
