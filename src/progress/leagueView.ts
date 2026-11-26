import type { LeagueBoard, LeagueImprovementRow, LeagueTotalRow } from '../backend/leagueClient';
import { personName } from '../battles/model';

/**
 * League segment of Compete (frames 18, 19, E8, E9), as pure rules.
 * Numbers and ranks come from the server (`my_league`); nothing here recomputes them.
 */

export type LeagueMode = 'total' | 'improvement';

export const LEAGUE_MODE_LABEL: Record<LeagueMode, string> = {
  total: 'Total',
  improvement: 'Improvement',
};

export interface LeaguePerson {
  userId: string;
  /** Display name (never "You"; the view swaps that in for `me`). */
  name: string;
  score: number;
  rank: number;
  me: boolean;
}

export type LeagueView =
  /** Only the user on the board (frame 19). */
  | { kind: 'empty' }
  /** Friends, but nobody has a rep this week (E8): everyone at 0, user first. */
  | { kind: 'newWeek'; header: string; people: LeaguePerson[] }
  /** Others are on the board, the user is at 0 (E9): ranked list without the user, user pinned below. */
  | {
      kind: 'notStarted';
      header: string;
      people: LeaguePerson[];
      me: LeaguePerson;
      line: string;
    }
  /** The user has reps (frame 18): podium for the top three, rows from 4th, the user's card. */
  | {
      kind: 'board';
      header: string;
      podium: LeaguePerson[];
      rest: LeaguePerson[];
      me: LeaguePerson | null;
      title: string;
      line: string;
    };

type Row = LeagueTotalRow | LeagueImprovementRow;

const scoreOf = (mode: LeagueMode, row: Row) => (mode === 'total' ? row.reps : (row as LeagueImprovementRow).points);

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Offset of `timeZone` from UTC at `ms`, in ms (local wall clock minus UTC). */
function zoneOffset(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return wall - (ms - (ms % 1000));
}

/** Midnight at the start of `isoDate` in `timeZone`, as epoch ms. */
export function zonedMidnight(isoDate: string, timeZone: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  let guess = utc - zoneOffset(utc, timeZone);
  // A second pass settles days where the offset changes (daylight saving).
  guess = utc - zoneOffset(guess, timeZone);
  return guess;
}

/** "4d 7h", "7h 12m", "12m". Whole units only, rounded down. */
export function formatEndsIn(msLeft: number): string {
  const minutes = Math.max(0, Math.floor(msLeft / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}

/**
 * "This week · ends in 4d 7h" ("New week · …" before anyone has a rep). The week ends at
 * midnight starting `weekEnd` (the server sends the day after the last day) in the league's time zone.
 */
export function leagueHeader(board: Pick<LeagueBoard, 'weekEnd' | 'timeZone'>, newWeek: boolean, now: number): string {
  let end = Number.NaN;
  try {
    end = zonedMidnight(board.weekEnd, board.timeZone);
  } catch {
    end = Number.NaN;
  }
  const lead = newWeek ? 'New week' : 'This week';
  if (!Number.isFinite(end)) return lead;
  if (end <= now) return `${lead} · ending now`;
  return `${lead} · ends in ${formatEndsIn(end - now)}`;
}

/** True when nobody on the board has a rep this week. */
export function isNewWeek(board: Pick<LeagueBoard, 'total'>): boolean {
  return board.total.every((row) => row.reps === 0);
}

const byName = (a: LeaguePerson, b: LeaguePerson) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.userId.localeCompare(b.userId);

/** Server rank, then score, then name: ties always land in the same order. */
const byRank = (a: LeaguePerson, b: LeaguePerson) => a.rank - b.rank || b.score - a.score || byName(a, b);

/** "45 more to pass Jack" needs the closest person ahead: lowest score above the user's. */
function nextAhead(people: readonly LeaguePerson[], me: LeaguePerson): LeaguePerson | null {
  const ahead = people.filter((p) => !p.me && p.score > me.score);
  if (ahead.length === 0) return null;
  return ahead.reduce((best, p) => (p.score < best.score || (p.score === best.score && byRank(p, best) > 0) ? p : best));
}

/** Pass someone = one more than they have. */
export const toPass = (me: number, them: number) => them - me + 1;

export function leagueView(input: { board: LeagueBoard; meId: string | null; mode: LeagueMode; now: number }): LeagueView {
  const { board, meId, mode, now } = input;
  if (board.total.length <= 1) return { kind: 'empty' };
  const newWeek = isNewWeek(board);
  const header = leagueHeader(board, newWeek, now);
  const toPerson = (row: Row): LeaguePerson => ({
    userId: row.userId,
    name: personName(row),
    score: newWeek ? 0 : scoreOf(mode, row),
    rank: row.rank,
    me: row.userId === meId,
  });

  if (newWeek) {
    // Everyone from the total board (it lists every friend), the user first, then by name.
    const people = board.total.map(toPerson);
    const mine = people.filter((p) => p.me);
    const others = people.filter((p) => !p.me).sort(byName);
    return { kind: 'newWeek', header, people: [...mine, ...others] };
  }

  const rows: Row[] = mode === 'total' ? board.total : board.improvement;
  const people = rows.map(toPerson).sort(byRank);
  const me = people.find((p) => p.me) ?? null;
  const myReps = board.total.find((row) => row.userId === meId)?.reps ?? 0;

  if (me && myReps === 0) {
    const others = people.filter((p) => !p.me);
    const next = nextAhead(people, me);
    const line = next ? `${toPass(me.score, next.score)} to pass ${next.name}` : '';
    return { kind: 'notStarted', header, people: others, me, line };
  }

  const podium = people.slice(0, 3);
  const rest = people.slice(3);
  if (!me)
    return {
      kind: 'board',
      header,
      podium,
      rest,
      me: null,
      title: '',
      line: '',
    };
  const next = nextAhead(people, me);
  let line: string;
  if (next) {
    line = `${toPass(me.score, next.score)} more to pass ${next.name}`;
  } else {
    const tied = people.filter((p) => !p.me && p.score === me.score);
    const below = people.filter((p) => !p.me && p.score < me.score);
    if (tied.length > 0) line = `Tied with ${tied[0].name}`;
    else if (below.length > 0) line = `${me.score - below[0].score} ahead of ${below[0].name}`;
    else line = '';
  }
  return {
    kind: 'board',
    header,
    podium,
    rest,
    me,
    title: `You're ${ordinal(me.rank)}`,
    line,
  };
}

/** The crown sits on first place, once someone has scored. */
export const hasCrown = (p: LeaguePerson) => p.rank === 1 && p.score > 0;
