import {
  DEFAULT_NUDGE_PREFS,
  NUDGE_KEY,
  decideNudgeSync,
  holdUntil,
  loadNudges,
  nextLocalReminder,
  parseRecapRanks,
  prefsFromServer,
  sanitizeNudges,
  saveNudges,
  shiftClock,
  weekCard,
} from '../src/progress/nudges';
import { GoalEnrollment } from '../src/progress/goals';
import { KeyValueStore } from '../src/storage/history';

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

const utc = (iso: string) => Date.parse(iso);

const goal = (startedOn: string, custom = 30): GoalEnrollment => ({
  id: 'g1',
  programId: null,
  customDailyReps: custom,
  startedOn,
  endedOn: null,
  recordedTimeZone: 'UTC',
});

const sundayRest = (startedOn: string): GoalEnrollment => ({
  id: 'g2',
  programId: 'first_20',
  customDailyReps: null,
  startedOn,
  endedOn: null,
  recordedTimeZone: 'UTC',
});

describe('nudge prefs on the phone', () => {
  it('stores the same fields as the server, under pushupcounter.nudges.v1', async () => {
    const kv = new MemoryKV();
    expect(await loadNudges(kv)).toEqual(DEFAULT_NUDGE_PREFS);
    const edited = { ...DEFAULT_NUDGE_PREFS, dailyNudge: false, nudgeLocalTime: '07:30', quietStart: '22:00', quietEnd: '07:00' };
    await saveNudges(kv, edited);
    expect(kv.data.get(NUDGE_KEY)).toContain('"dailyNudge":false');
    expect(await loadNudges(kv)).toEqual(edited);
  });

  it('drops unknown and broken values back to the defaults', () => {
    expect(sanitizeNudges({ dailyNudge: false, nudgeLocalTime: '25:00', quietStart: '9:00', recapWeekday: 9, extra: true }).nudgeLocalTime).toBe('18:00');
    expect(sanitizeNudges({ dailyNudge: false, quietStart: '9:00' }).quietStart).toBe('21:00');
    expect(sanitizeNudges(null)).toEqual(DEFAULT_NUDGE_PREFS);
  });
});

describe('quiet hours', () => {
  const zone = 'UTC';
  it('holds a push that lands inside the overnight window until quiet ends', () => {
    const at = new Date('2026-11-08T22:15:00.000Z');
    expect(holdUntil(at, '21:00', '08:00', zone).toISOString()).toBe('2026-11-09T08:00:00.000Z');
  });

  it('holds an early-morning push until the same morning quiet ends', () => {
    const at = new Date('2026-11-09T07:10:00.000Z');
    expect(holdUntil(at, '21:00', '08:00', zone).toISOString()).toBe('2026-11-09T08:00:00.000Z');
  });

  it('leaves a push that is already outside quiet hours', () => {
    const at = new Date('2026-11-08T18:00:00.000Z');
    expect(holdUntil(at, '21:00', '08:00', zone).toISOString()).toBe(at.toISOString());
  });

  it('treats equal start and end as no quiet hours', () => {
    const at = new Date('2026-11-08T22:00:00.000Z');
    expect(holdUntil(at, '21:00', '21:00', zone).toISOString()).toBe(at.toISOString());
  });

  it('holds a midday window until its end the same day', () => {
    const at = new Date('2026-11-08T13:30:00.000Z');
    expect(holdUntil(at, '13:00', '15:00', zone).toISOString()).toBe('2026-11-08T15:00:00.000Z');
  });
});

describe('local daily reminder', () => {
  const prefs = { ...DEFAULT_NUDGE_PREFS, nudgeLocalTime: '18:00', quietStart: '21:00', quietEnd: '08:00' };
  const base = {
    prefs,
    timeZone: 'UTC',
    signedIn: false,
    pushRegistered: false,
    enrollments: [goal('2026-11-01')],
    repsToday: 0,
    lastFiredDate: null as string | null,
  };

  it('schedules today at the nudge time for someone without a server push token', () => {
    const at = nextLocalReminder({ ...base, now: utc('2026-11-04T15:00:00.000Z') });
    expect(at?.toISOString()).toBe('2026-11-04T18:00:00.000Z');
  });

  it('does not also schedule a local reminder when the server will send one', () => {
    expect(nextLocalReminder({ ...base, signedIn: true, pushRegistered: true, now: utc('2026-11-04T15:00:00.000Z') })).toBeNull();
  });

  it('still schedules locally for a signed-in person who declined push', () => {
    const at = nextLocalReminder({ ...base, signedIn: true, pushRegistered: false, now: utc('2026-11-04T15:00:00.000Z') });
    expect(at?.toISOString()).toBe('2026-11-04T18:00:00.000Z');
  });

  it('cancels today when a counted rep already landed or the day is a rest day or there is no goal', () => {
    expect(nextLocalReminder({ ...base, repsToday: 8, now: utc('2026-11-04T15:00:00.000Z') })?.toISOString()).toBe('2026-11-05T18:00:00.000Z');
    const sunday = utc('2026-11-08T15:00:00.000Z');
    expect(nextLocalReminder({ ...base, enrollments: [sundayRest('2026-11-02')], now: sunday })?.toISOString()).toBe('2026-11-09T18:00:00.000Z');
    expect(nextLocalReminder({ ...base, enrollments: [], now: utc('2026-11-04T15:00:00.000Z') })).toBeNull();
  });

  it('does not schedule a second local reminder after today already fired', () => {
    expect(nextLocalReminder({ ...base, now: utc('2026-11-04T19:00:00.000Z'), lastFiredDate: '2026-11-04' })?.toISOString()).toBe('2026-11-05T18:00:00.000Z');
  });

  it('fires a catch-up once if the app opens after the nudge time and today is still empty', () => {
    const at = nextLocalReminder({ ...base, now: utc('2026-11-04T19:00:00.000Z'), lastFiredDate: null });
    expect(at?.getTime()).toBe(utc('2026-11-04T19:00:00.000Z'));
  });

  it('holds the local reminder until quiet hours end when the chosen time is inside them', () => {
    const at = nextLocalReminder({
      ...base,
      prefs: { ...prefs, nudgeLocalTime: '22:00' },
      now: utc('2026-11-04T15:00:00.000Z'),
    });
    expect(at?.toISOString()).toBe('2026-11-05T08:00:00.000Z');
  });

  it('stays off when the daily reminder is off', () => {
    expect(nextLocalReminder({ ...base, prefs: { ...prefs, dailyNudge: false }, now: utc('2026-11-04T15:00:00.000Z') })).toBeNull();
  });
});

describe('Sunday week card', () => {
  const workouts = [
    { id: 'a', startedAt: utc('2026-11-02T15:00:00.000Z'), timeZone: 'UTC', countedReps: 30 },
    { id: 'b', startedAt: utc('2026-11-04T15:00:00.000Z'), timeZone: 'UTC', countedReps: 40 },
    { id: 'c', startedAt: utc('2026-11-08T15:00:00.000Z'), timeZone: 'UTC', countedReps: 10 },
  ];
  const enrollments = [sundayRest('2026-11-02')];

  it('shows this week from Sunday 00:00 through Monday 12:00, then hides', () => {
    const sunday = weekCard({ now: utc('2026-11-08T00:30:00.000Z'), timeZone: 'UTC', workouts, enrollments, signedIn: false, ranks: null });
    expect(sunday?.reps).toBe(80);
    expect(sunday?.goalDaysHit).toBe(2);
    expect(sunday?.goalDaysScheduled).toBe(6);
    expect(sunday?.title).toBe('This week');
    expect(sunday?.destination).toBe('progress');
    expect(sunday?.ranks).toBeNull();

    const mondayMorning = weekCard({
      now: utc('2026-11-09T11:00:00.000Z'),
      timeZone: 'UTC',
      workouts,
      enrollments,
      signedIn: true,
      ranks: { total: 2, improvement: 1, friends: true },
    });
    expect(mondayMorning?.title).toBe('Last week');
    expect(mondayMorning?.weekStart).toBe('2026-11-02');
    expect(mondayMorning?.destination).toBe('league');
    expect(mondayMorning?.ranks).toBe('2nd on total, 1st on improvement');

    expect(weekCard({ now: utc('2026-11-09T12:00:00.000Z'), timeZone: 'UTC', workouts, enrollments, signedIn: true, ranks: null })).toBeNull();
    expect(weekCard({ now: utc('2026-11-07T18:00:00.000Z'), timeZone: 'UTC', workouts, enrollments, signedIn: false, ranks: null })).toBeNull();
  });

  it('omits ranks for an anonymous person and for an account with no friends', () => {
    const card = weekCard({
      now: utc('2026-11-08T18:00:00.000Z'),
      timeZone: 'UTC',
      workouts,
      enrollments,
      signedIn: true,
      ranks: { total: 1, improvement: 1, friends: false },
    });
    expect(card?.ranks).toBeNull();
    expect(card?.destination).toBe('league');
  });
});

describe('nudge sync and clocks', () => {
  const local = { ...DEFAULT_NUDGE_PREFS, nudgeLocalTime: '07:30' };
  const server = { ...DEFAULT_NUDGE_PREFS, dailyNudge: false, nudgeLocalTime: '19:00' };

  it('uploads the phone prefs only when the account has no row', () => {
    const first = decideNudgeSync({ userId: 'a', local, server: null, sync: null });
    expect(first.action).toEqual({ type: 'upload', prefs: local });
    expect(first.next.settled).toBe(false);
    const again = decideNudgeSync({ userId: 'a', local, server: null, sync: { userId: 'a', settled: true } });
    expect(again.action.type).toBe('none');
  });

  it('keeps the server row, including over another account stored on this phone', () => {
    const kept = decideNudgeSync({ userId: 'a', local, server, sync: null });
    expect(kept.action).toEqual({ type: 'adopt', prefs: server });
    const switched = decideNudgeSync({ userId: 'b', local, server: null, sync: { userId: 'a', settled: true } });
    expect(switched.action).toEqual({ type: 'adopt', prefs: DEFAULT_NUDGE_PREFS });
    expect(switched.next).toEqual({ userId: 'b', settled: true });
  });

  it('reads a Postgres time and steps the clock by half an hour', () => {
    expect(prefsFromServer({
      daily_nudge: true,
      pass_ping: false,
      weekly_recap: true,
      quiet_start: '21:00:00',
      quiet_end: '08:00:00',
      nudge_local_time: '18:00:00',
      recap_weekday: 7,
      recap_local_time: '18:00:00',
    })).toMatchObject({ passPing: false, nudgeLocalTime: '18:00', quietStart: '21:00' });
    expect(prefsFromServer(null)).toBeNull();
    expect(shiftClock('18:00', 30)).toBe('18:30');
    expect(shiftClock('00:00', -30)).toBe('23:30');
    expect(shiftClock('23:30', 30)).toBe('00:00');
  });

  it('accepts only the caller ranks', () => {
    expect(parseRecapRanks({ weekStart: '2026-11-02', totalRank: 2, improvementRank: 1, friends: true, totalCrown: false })).toEqual({
      total: 2,
      improvement: 1,
      friends: true,
    });
    expect(parseRecapRanks({ totalRank: 0, improvementRank: 1, friends: true })).toBeNull();
    expect(parseRecapRanks({ reps: 40 })).toBeNull();
  });
});
