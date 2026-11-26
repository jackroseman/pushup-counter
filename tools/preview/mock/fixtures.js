// Canned backend data for the web preview: a signed-in user ("Sunny") a few weeks into the
// "50 a day" program, four friends, a league week and a handful of challenges.
//
// Everything is generated from a fixed clock (FIXED_NOW) and a seeded random number generator,
// so every capture renders the same screens. The shapes mirror the Supabase RPC results the app
// reads (src/backend/*Client.ts, src/battles/api.ts). If a screen breaks after a backend change,
// update the matching shape here.

const DAY = 86400000;
const TZ = 'America/New_York';
/** The browser clock is frozen here during captures (Wednesday afternoon, Eastern time). */
const FIXED_NOW = new Date('2026-11-25T16:30:00-05:00').getTime();
const ME = '11111111-1111-4111-8111-111111111111';

const isoDay = (t) => new Date(t - 5 * 3600000).toISOString().slice(0, 10);
const isoTime = (t) => new Date(t).toISOString();

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/** One finished set in the app's local history format (src/storage/history.ts). */
function makeSet(rand, start, reps, endReason = 'user') {
  const list = [];
  let t = start + 4000;
  for (let i = 1; i <= reps; i++) {
    const descent = 900 + rand() * 500;
    const ascent = 700 + rand() * 400;
    const ratio = 0.5 + rand() * 0.5;
    const quality = ratio >= 0.7 ? 'full' : ratio >= 0.45 ? 'good' : 'shallow';
    const startedAt = t;
    const bottomAt = t + descent;
    t = bottomAt + ascent;
    list.push({
      index: i, timestamp: t, quality, source: 'depth', bottomDistance: 0.12, topDistance: 0.42,
      rangeOfMotion: 0.3 * ratio, depthRatio: ratio, faceLostAtBottom: false, startedAt, bottomAt,
      descentMs: descent, ascentMs: ascent, intervalMs: i > 1 ? descent + ascent + 150 : null, proximityTouched: false,
    });
    t += 150;
  }
  const full = list.filter((r) => r.quality === 'full').length;
  const good = list.filter((r) => r.quality === 'good').length;
  const avgRom = list.reduce((a, r) => a + r.rangeOfMotion, 0) / reps;
  const trace = [];
  for (let ms = 0; ms < t - start; ms += 100) trace.push([ms, 0.27 + 0.13 * Math.cos((ms / 1800) * 2 * Math.PI)]);
  return {
    id: 'set-' + start, startedAt: start, endedAt: t + 1500,
    summary: {
      totalReps: reps, fullReps: full, goodReps: good, shallowReps: reps - full - good,
      percentFull: Math.round((full / reps) * 100), avgRangeOfMotionCm: Math.round(avgRom * 1000) / 10,
      durationSec: Math.round((t + 1500 - start) / 1000),
    },
    reps: list, calibratedTopDistance: 0.42, depthTracking: true, version: 2, trace, timeZone: TZ, endReason,
  };
}

function build(now = FIXED_NOW) {
  const rand = seeded(7);
  // Local set history: 30 days, a few rest days, one set so far today.
  const history = [];
  for (let d = 29; d >= 0; d--) {
    if (d === 12 || d === 13 || d === 20) continue;
    const day = now - d * DAY;
    const sets = d === 0 ? 1 : 1 + Math.floor(rand() * 3);
    for (let k = 0; k < sets; k++) {
      const reps = d === 0 ? 22 : 12 + Math.floor(rand() * 20) + Math.floor((30 - d) / 3);
      history.push(makeSet(rand, day - (7 - k * 3) * 3600000, reps, d === 1 && k === 0 ? 'tilt' : 'user'));
    }
  }
  history.sort((a, b) => b.startedAt - a.startedAt);

  const byDay = {};
  for (const s of history) byDay[isoDay(s.startedAt)] = (byDay[isoDay(s.startedAt)] || 0) + s.summary.totalReps;
  const today = isoDay(now);
  const day = [];
  for (let i = 13; i >= 0; i--) day.push({ date: isoDay(now - i * DAY), reps: byDay[isoDay(now - i * DAY)] || 0, target: 50 });
  const week = [];
  for (let i = 11; i >= 0; i--) {
    const start = now - ((new Date(now).getDay() + 6) % 7) * DAY - i * 7 * DAY;
    let reps = 0;
    for (let j = 0; j < 7; j++) reps += byDay[isoDay(start + j * DAY)] || 0;
    week.push({ start: isoDay(start), reps });
  }
  const month = [];
  for (let i = 11; i >= 0; i--) {
    const key = new Date(2026, 10 - i, 1).toISOString().slice(0, 7);
    let reps = 0;
    for (const k in byDay) if (k.startsWith(key)) reps += byDay[k];
    month.push({ start: key + '-01', reps });
  }
  let running = 0;
  const lifetime = week.map((w) => ({ weekStart: w.start, total: (running += w.reps) }));
  const lifetimeReps = running;
  const bestSet = history.reduce((a, b) => (b.summary.totalReps > a.summary.totalReps ? b : a));
  const bestDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const bestWeek = week.reduce((a, b) => (b.reps > a.reps ? b : a));
  const bestMonth = month.reduce((a, b) => (b.reps > a.reps ? b : a));

  const enrollment = { id: 'enr-1', programId: 'fifty_a_day', customDailyReps: null, startedOn: isoDay(now - 16 * DAY), endedOn: null, recordedTimeZone: TZ };

  // RPC my_progress (src/backend/progressClient.ts).
  const progress = {
    timeZone: TZ, today, todayReps: byDay[today] || 0, target: 50, rest: false, goalMet: false, usual: 44, delta: -22,
    currentStreak: 12, longestStreak: 12, lifetimeReps,
    badges: [
      { milestone: 100, earnedOn: isoDay(now - 27 * DAY), remaining: null },
      { milestone: 500, earnedOn: isoDay(now - 17 * DAY), remaining: null },
      { milestone: 1000, earnedOn: isoDay(now - 6 * DAY), remaining: null },
      { milestone: 5000, earnedOn: null, remaining: 5000 - lifetimeReps },
    ],
    records: {
      bestSet: { reps: bestSet.summary.totalReps, date: isoDay(bestSet.startedAt) },
      bestDay: { reps: bestDay[1], date: bestDay[0] },
      bestWeek: { reps: bestWeek.reps, date: bestWeek.start },
      bestMonth: { reps: bestMonth.reps, date: bestMonth.start },
    },
    charts: { day, week, month, lifetime },
    program: { status: 'in_progress', name: '50 a day', detail: 'Week 3 of 4 · 50 today' },
    enrollments: [enrollment],
    sets: history.map((s) => ({ clientSetId: s.id, startedAt: s.startedAt, receivedAt: s.endedAt + 1000, countedReps: s.summary.totalReps, timeZone: TZ })),
  };

  const emptyProgress = {
    ...progress, todayReps: 0, target: null, goalMet: false, usual: null, delta: null, currentStreak: 0, longestStreak: 0, lifetimeReps: 0,
    badges: [100, 500, 1000].map((m) => ({ milestone: m, earnedOn: null, remaining: m })),
    records: { bestSet: null, bestDay: null, bestWeek: null, bestMonth: null },
    charts: { day: [], week: [], month: [], lifetime: [] },
    program: { status: 'not_started', name: 'No goal yet', detail: 'Pick a program or set your own number.' },
    enrollments: [], sets: [],
  };

  const people = [
    ['22222222-2222-4222-8222-222222222222', 'brett', 'Brett'],
    ['33333333-3333-4333-8333-333333333333', 'jack', 'Jack'],
    ['44444444-4444-4444-8444-444444444444', 'maya', 'Maya R'],
    ['55555555-5555-4555-8555-555555555555', 'leo', 'Leo'],
  ];
  const P = (i) => ({ userId: people[i][0], username: people[i][1], displayName: people[i][2] });
  const MEP = { userId: ME, username: 'sunny', displayName: 'Sunny' };

  // RPC my_league (src/backend/leagueClient.ts).
  const league = {
    weekStart: isoDay(now - 2 * DAY), weekEnd: isoDay(now + 4 * DAY), timeZone: TZ,
    total: [
      { ...P(1), reps: 212, rank: 1, crownedLastWeek: true },
      { ...MEP, reps: 168, rank: 2, crownedLastWeek: false },
      { ...P(0), reps: 131, rank: 3, crownedLastWeek: false },
      { ...P(2), reps: 96, rank: 4, crownedLastWeek: false },
      { ...P(3), reps: 40, rank: 5, crownedLastWeek: false },
    ],
    improvement: [
      { ...MEP, points: 142, reps: 168, goalDaysHit: 2, goalDaysScheduled: 3, usual: 44, baselineWeeks: 4, baselineMinWeeks: 2, rank: 1, crownedLastWeek: false },
      { ...P(0), points: 118, reps: 131, goalDaysHit: 2, goalDaysScheduled: 3, usual: 38, baselineWeeks: 3, baselineMinWeeks: 2, rank: 2, crownedLastWeek: true },
      { ...P(1), points: 97, reps: 212, goalDaysHit: 1, goalDaysScheduled: 3, usual: 70, baselineWeeks: 4, baselineMinWeeks: 2, rank: 3, crownedLastWeek: false },
      { ...P(2), points: 0, reps: 96, goalDaysHit: 0, goalDaysScheduled: 0, usual: null, baselineWeeks: 1, baselineMinWeeks: 2, rank: 4, crownedLastWeek: false },
    ],
  };

  // RPC my_challenges (src/battles/api.ts).
  const part = (who, extra) => ({
    userId: who.userId, username: who.username, displayName: who.displayName, status: 'accepted', isMe: who.userId === ME,
    attemptsUsed: 1, validReps: null, metricValue: null, avgDepthPct: null, tempoScore: null, rank: null, isWinner: false, ...extra,
  });
  const base = {
    mode: 'async', metric: 'rep_count', durationS: null, attemptsAllowed: null, targetReps: null, maxParticipants: 8, minQuality: 'good',
    inviteExpiresAt: isoTime(now + 3 * DAY), createdAt: isoTime(now - 2 * DAY), finishedAt: null, createdBy: ME, locked: false, inviteLinks: [],
  };
  const challenges = [
    { ...base, id: 'c-week', kind: 'total', windowUnit: 'week', status: 'active', startsAt: isoTime(now - 2 * DAY), endsAt: isoTime(now + 4 * DAY + 7 * 3600000),
      participants: [part(P(1), { validReps: 212, rank: 1 }), part(MEP, { validReps: 168, rank: 2 }), part(P(0), { validReps: 131, rank: 3 })] },
    { ...base, id: 'c-best', kind: 'best_set', windowUnit: null, durationS: 60, attemptsAllowed: 3, status: 'active', startsAt: isoTime(now - DAY), endsAt: isoTime(now + DAY), createdBy: people[0][0],
      participants: [part(MEP, { validReps: 31, rank: 1, attemptsUsed: 2 }), part(P(0), { validReps: 28, rank: 2 })] },
    { ...base, id: 'c-streak', kind: 'streak', windowUnit: 'custom', status: 'active', startsAt: isoTime(now - 3 * DAY), endsAt: isoTime(now + 4 * DAY),
      participants: [part(MEP, { streakFloorReps: 40, daysSurvived: 3 }), part(P(2), { streakFloorReps: 30, daysSurvived: 3 }),
        part(P(3), { streakFloorReps: 30, daysSurvived: 1, eliminatedOn: isoDay(now - 2 * DAY), status: 'forfeited' })] },
    { ...base, id: 'c-team', kind: 'team', windowUnit: 'week', targetReps: 1000, status: 'active', startsAt: isoTime(now - 2 * DAY), endsAt: isoTime(now + 5 * DAY),
      participants: [MEP, P(1), P(0), P(2)].map((p, i) => part(p, { validReps: [168, 212, 131, 100][i], teamTotal: 611, teamTarget: 1000 })) },
    { ...base, id: 'c-invite', kind: 'total', windowUnit: 'day', status: 'pending', startsAt: null, endsAt: null, createdBy: people[1][0],
      participants: [part(P(1), {}), part(MEP, { status: 'invited', attemptsUsed: 0 })] },
    { ...base, id: 'c-done', kind: 'total', windowUnit: 'day', status: 'completed', startsAt: isoTime(now - 4 * DAY), endsAt: isoTime(now - 3 * DAY), finishedAt: isoTime(now - 3 * DAY),
      participants: [part(MEP, { validReps: 74, rank: 1, isWinner: true }), part(P(0), { validReps: 61, rank: 2 })] },
  ];

  // RPC my_friends.
  const friends = [
    ...people.map((p) => ({ user_id: p[0], username: p[1], display_name: p[2], relation: 'friend', since: '2026-10-01' })),
    { user_id: '66666666-6666-4666-8666-666666666666', username: 'tara', display_name: 'Tara', relation: 'incoming', since: null },
  ];
  const friendRecord = {
    played: 5, won: 3, drawn: 0, lost: 2,
    recent: [{ challengeId: 'c-done', finishedAt: isoTime(now - 3 * DAY), kind: 'total', windowUnit: 'day', metric: 'rep_count', durationS: null, players: 2,
      me: { rank: 1, validReps: 74, metricValue: null, isWinner: true }, them: { rank: 2, validReps: 61, metricValue: null, isWinner: false } }],
  };
  const profile = { id: ME, username: 'sunny', display_name: 'Sunny', time_zone: TZ };

  // Personal invite links (src/invites): Sunny's code, the code after Reset link, and how
  // friend_invite_preview describes Sunny to someone else. maya is the friend who opens it.
  const inviteCode = 'k7m2qx9p';
  const inviteCodeAfterReset = 'w4h8n3tc';
  const inviter = { username: 'sunny', displayName: 'Sunny', userId: ME };
  const maya = { id: '77777777-7777-4777-8777-777777777777', username: 'maya', display_name: 'Maya', time_zone: TZ };
  return {
    now, ME, history, enrollment, progress, emptyProgress, league, challenges, friends, friendRecord, profile,
    inviteCode, inviteCodeAfterReset, inviter, maya,
  };
}

module.exports = { FIXED_NOW, ME, TZ, DAY, isoDay, isoTime, build, makeSet, seeded };
