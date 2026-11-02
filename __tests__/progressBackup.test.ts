import {
  OLD_SETS_NOTE,
  OLDER_SETS_NOTE,
  REFRESH_FAILED,
  SYNCED_LATE,
  decideGoalSync,
  freshGoalSync,
  goalSnapshot,
  lateSetIds,
  mergeWorkouts,
  parseServerProgress,
  progressFromServer,
  queueGoalEdit,
  sameSnapshot,
  signedInViews,
  todayFromServer,
  type GoalEnrollment,
  type ServerEnrollment,
  type ServerProgress,
} from '../src/progress';

const DAY = 86_400_000;

function enrollment(partial: Partial<ServerEnrollment> = {}): ServerEnrollment {
  return {
    id: 'enroll-1',
    programId: null,
    customDailyReps: 10,
    startedOn: '2026-11-02',
    endedOn: null,
    recordedTimeZone: 'UTC',
    ...partial,
  };
}

function doc(partial: Partial<ServerProgress> = {}): ServerProgress {
  return {
    timeZone: 'UTC',
    today: '2026-11-02',
    todayReps: 4,
    target: 10,
    rest: false,
    goalMet: false,
    usual: 8,
    delta: 4,
    currentStreak: 2,
    longestStreak: 2,
    lifetimeReps: 40,
    badges: [{ milestone: 1000, earnedOn: null, remaining: 960 }],
    records: {
      bestSet: { reps: 20, date: '2026-11-01' },
      bestDay: null,
      bestWeek: null,
      bestMonth: null,
    },
    charts: {
      day: [{ date: '2026-11-02', reps: 4, target: 10 }],
      week: [{ start: '2026-11-02', reps: 4 }],
      month: [{ start: '2026-11-01', reps: 4 }],
      lifetime: [{ weekStart: '2026-11-02', total: 4 }],
    },
    program: { status: 'in_progress', name: 'Custom goal', detail: '10 a day' },
    enrollments: [enrollment()],
    sets: [
      { clientSetId: 'server-1', startedAt: Date.parse('2026-11-02T15:00:00.000Z'), timeZone: 'UTC', countedReps: 4, receivedAt: Date.parse('2026-11-02T15:01:00.000Z') },
    ],
    ...partial,
  };
}

const localGoal = (partial: Partial<GoalEnrollment> = {}): GoalEnrollment => ({
  id: 'local-1',
  programId: 'first_20',
  customDailyReps: null,
  startedOn: '2026-11-02',
  endedOn: null,
  recordedTimeZone: 'UTC',
  ...partial,
});

describe('progress backup copy', () => {
  it('keeps the sentences the spec shows the person', () => {
    expect(REFRESH_FAILED).toBe("Couldn't refresh.");
    expect(OLDER_SETS_NOTE).toBe('Older sets are in your charts.');
    expect(SYNCED_LATE).toBe('Synced late. It counts in your totals, not in your streak.');
    expect(OLD_SETS_NOTE).toBe("Sets older than 60 days still count toward your records. They don't rebuild a streak.");
  });
});

describe('my_progress on the phone', () => {
  it('rejects a document that is not the progress shape', () => {
    expect(parseServerProgress(null)).toBeNull();
    expect(parseServerProgress({ today: '2026-11-02' })).toBeNull();
    expect(parseServerProgress({ ...doc(), enrollments: [{ id: 'x' }] })?.enrollments).toEqual([]);
  });

  it('shows the server ring when every set is already uploaded', () => {
    const view = todayFromServer(doc(), []);
    expect(view.ringText).toBe('4 / 10');
    expect(view.streakLine).toBe('2 day streak');
    expect(view.usualLine).toBe('+4 vs your usual Monday');
  });

  it('says older sets live in the charts when the server has more than this phone', () => {
    const progress = progressFromServer(doc(), 0);
    expect(progress.historyNote).toBe(OLDER_SETS_NOTE);
    expect(progress.bestSet).toEqual({ reps: 20, date: '2026-11-01' });
    expect(progressFromServer(doc(), 1).historyNote).toBeNull();
  });

  it('counts a set still only on the phone without counting a shared id twice', () => {
    const server = doc().sets;
    const local = [
      { id: 'server-1', startedAt: server[0].startedAt, timeZone: 'UTC', countedReps: 4 },
      { id: 'phone-only', startedAt: Date.parse('2026-11-02T16:00:00.000Z'), timeZone: 'UTC', countedReps: 6 },
    ];
    const merged = mergeWorkouts(server, local);
    expect(merged.unsynced).toBe(true);
    expect(merged.workouts.map((row) => row.id)).toEqual(['server-1', 'phone-only']);
    const view = signedInViews(doc(), local);
    expect(view.today.ringText).toBe('10 / 10');
    expect(view.today.ringCaption).toBe('Goal met');
    expect(view.today.streakLine).toBe('1 day streak');
  });

  it('marks a set the server received after 60 days', () => {
    const startedAt = Date.parse('2026-08-01T12:00:00.000Z');
    expect(lateSetIds([{ clientSetId: 'late', startedAt, timeZone: 'UTC', countedReps: 10, receivedAt: startedAt + 61 * DAY }])).toEqual(['late']);
    expect(lateSetIds([{ clientSetId: 'ok', startedAt, timeZone: 'UTC', countedReps: 10, receivedAt: startedAt + DAY }])).toEqual([]);
  });
});

describe('goal sync', () => {
  const user = 'user-a';
  const serverGoal = enrollment();

  it('adopts the server goal when this account already has one', () => {
    const decision = decideGoalSync({ userId: user, local: [localGoal()], server: [serverGoal], sync: null });
    expect(decision.action).toEqual({ type: 'adopt' });
    expect(decision.next.settled).toBe(true);
    expect(decision.next.basedOn).toEqual(goalSnapshot(serverGoal));
  });

  it('uploads a phone goal only when the server has none and this sign-in is not settled', () => {
    const first = decideGoalSync({ userId: user, local: [localGoal()], server: [], sync: null });
    expect(first.action).toEqual({ type: 'upload', choice: { programId: 'first_20' } });
    const again = decideGoalSync({ userId: user, local: [localGoal()], server: [], sync: { ...first.next, pending: null, settled: true } });
    expect(again.action).toEqual({ type: 'none' });
  });

  it('uploads a pending edit only while the open enrollment is the one it was based on', () => {
    const basedOn = goalSnapshot(serverGoal);
    const pending = queueGoalEdit(user, { customDailyReps: 30 }, basedOn);
    const same = decideGoalSync({ userId: user, local: [], server: [serverGoal], sync: pending });
    expect(same.action).toEqual({ type: 'upload', choice: { customDailyReps: 30 } });
    const changed = enrollment({ id: 'enroll-2', customDailyReps: 40 });
    const lost = decideGoalSync({ userId: user, local: [], server: [changed], sync: pending });
    expect(lost.action).toEqual({ type: 'adopt' });
    expect(lost.next.pending).toBeNull();
  });

  it('treats a same-day change of the goal as a different snapshot', () => {
    const left = goalSnapshot(serverGoal);
    const right = goalSnapshot(enrollment({ customDailyReps: 30 }));
    expect(sameSnapshot(left, left)).toBe(true);
    expect(sameSnapshot(left, right)).toBe(false);
    expect(sameSnapshot(null, null)).toBe(true);
  });

  it('does not copy another account’s goal onto this one', () => {
    const other = freshGoalSync('user-b');
    other.settled = false;
    const empty = decideGoalSync({ userId: user, local: [localGoal()], server: [], sync: other });
    expect(empty.action).toEqual({ type: 'clear' });
    expect(empty.next.userId).toBe(user);
    const taken = decideGoalSync({ userId: user, local: [localGoal()], server: [serverGoal], sync: other });
    expect(taken.action).toEqual({ type: 'adopt' });
  });
});
