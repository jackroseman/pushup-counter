/**
 * Today screen rules (frames 4 and 13, empty states E1–E3). Pure: no React, no I/O.
 * See docs/rebrand/IMPLEMENTATION_PLAN.md §3 (frame 4) and the empty-state table.
 */
import type { Battle } from '../../battles/model';
import type { LeagueBoard, LeagueTotalRow } from '../../backend/leagueClient';
import { addCalendarDays, weekStart, weekdayName } from '../../progress/calendar';
import type { DayBucket } from '../../progress/progress';
import type { WeekDay, WeekDayState } from '../WeekStrip';

/** Ring, plain count (no goal) or rest day. */
export type TodayHero =
  | { kind: 'ring'; reps: number; target: number; progress: number; done: boolean }
  | { kind: 'count'; reps: number }
  | { kind: 'rest'; reps: number };

export interface TodayLine {
  text: string;
  tone: 'secondary' | 'signal';
}

export interface TodayLeagueCard {
  label: string;
  title: string;
  detail: string;
  people: { name: string; me: boolean }[];
}

export type TodayChallengeCard = { kind: 'challenge_friend'; title: string; detail: string };

export interface TodayView {
  hero: TodayHero;
  /** The line under the ring ("28 to go", "Goal done · 13-day streak", "Your first set starts here."). */
  line: TodayLine | null;
  /** Streak chip number; null hides the chip. */
  streak: number | null;
  primary: { title: string; kind: 'primary' | 'gray' };
  league: TodayLeagueCard | null;
  challenge: TodayChallengeCard | null;
  betterWithFriends: boolean;
  howItWorks: boolean;
  week: WeekDay[] | null;
}

export interface TodayInput {
  today: string;
  reps: number;
  /** Today's target; 0 on a rest day; null with no goal. */
  target: number | null;
  rest: boolean;
  currentStreak: number;
  /** No sets on this phone or on the server. */
  dayOne: boolean;
  /** The recent day buckets (oldest first). Days missing from it count as empty. */
  days: readonly DayBucket[];
  /** Target for a date with no bucket (later this week): from the goal schedule. */
  targetFor: (date: string) => number | null;
  signedIn: boolean;
  meId: string | null;
  board: LeagueBoard | null;
  battles: readonly Battle[] | null;
  now: number;
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
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

const shortName = (p: { username?: string | null; displayName?: string | null }) =>
  p.displayName?.trim() || p.username || 'Someone';

export function todayHero(input: Pick<TodayInput, 'reps' | 'target' | 'rest'>): TodayHero {
  const { reps, target, rest } = input;
  if (target == null) return { kind: 'count', reps };
  if (rest || target === 0) return { kind: 'rest', reps };
  return { kind: 'ring', reps, target, progress: Math.max(0, Math.min(1, reps / target)), done: reps >= target };
}

export function todayLine(hero: TodayHero, dayOne: boolean, streak: number): TodayLine | null {
  if (hero.kind !== 'ring') return null;
  if (hero.done) return { text: streak > 0 ? `Goal done · ${streak}-day streak` : 'Goal done', tone: 'signal' };
  if (dayOne) return { text: 'Your first set starts here.', tone: 'secondary' };
  return { text: `${hero.target - hero.reps} to go`, tone: 'secondary' };
}

/** Monday to Sunday of this week. Only today shows a partial count; a rest day reads "off". */
export function weekDays(input: Pick<TodayInput, 'today' | 'days' | 'targetFor'>): WeekDay[] {
  const { today, days, targetFor } = input;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const monday = weekStart(today);
  return DAY_LETTERS.map((label, i) => {
    const date = addCalendarDays(monday, i);
    const bucket = byDate.get(date);
    const target = bucket ? bucket.target : date > today ? targetFor(date) : null;
    const reps = bucket?.reps ?? 0;
    const isToday = date === today;
    let state: WeekDayState = 'empty';
    if (target === 0) state = 'rest';
    else if (target != null && target > 0 && reps >= target && date <= today) state = 'done';
    else if (isToday && reps > 0) state = 'partial';
    const day = weekdayName(date);
    const spoken =
      state === 'rest' ? `${day}, rest day` : state === 'done' ? `${day}, goal done` : target ? `${day}, ${reps} of ${target}` : day;
    return { label, state, count: state === 'partial' ? reps : undefined, today: isToday, accessibilityLabel: spoken };
  });
}

/** Up to three people around the user (the one ahead, the user, the one behind). */
function around(rows: readonly LeagueTotalRow[], index: number): LeagueTotalRow[] {
  if (rows.length <= 3) return [...rows];
  const start = Math.max(0, Math.min(index - 1, rows.length - 3));
  return rows.slice(start, start + 3);
}

function endsLabel(board: LeagueBoard, today: string): string {
  if (board.weekEnd <= today) return 'League · ends today';
  if (board.weekEnd === addCalendarDays(today, 1)) return 'League · ends tomorrow';
  return `League · ends ${weekdayName(board.weekEnd)}`;
}

/** The league card, or null without a board with at least one friend on it. */
export function leagueCard(board: LeagueBoard | null, meId: string | null, today: string): TodayLeagueCard | null {
  if (!board || !meId) return null;
  const rows = [...board.total].sort((a, b) => a.rank - b.rank || b.reps - a.reps);
  if (rows.length <= 1) return null;
  const label = endsLabel(board, today);
  const meIndex = rows.findIndex((r) => r.userId === meId);
  if (rows.every((r) => r.reps === 0) || meIndex < 0) {
    return {
      label,
      title: 'New week',
      detail: "Nobody's on the board yet",
      people: rows.slice(0, 3).map((r) => ({ name: shortName(r), me: r.userId === meId })),
    };
  }
  const me = rows[meIndex];
  const people = around(rows, meIndex).map((r) => ({ name: shortName(r), me: r.userId === meId }));
  const tiedWith = rows.find((r) => r.userId !== meId && r.reps === me.reps);
  const ahead = [...rows.slice(0, meIndex)].reverse().find((r) => r.reps > me.reps);
  const behind = rows.slice(meIndex + 1).find((r) => r.reps < me.reps);
  let detail: string;
  if (tiedWith) detail = `Tied with ${shortName(tiedWith)}`;
  else if (ahead) detail = `${ahead.reps - me.reps} behind ${shortName(ahead)}`;
  else if (behind) detail = `${me.reps - behind.reps} ahead of ${shortName(behind)}`;
  else detail = '';
  return { label, title: `${ordinal(me.rank)} this week`, detail, people };
}

/** "1 day left", "5 h left". Days from the end time, hours under a day. */
export function leftLabel(endsAt: string | null | undefined, now: number): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'under an hour left';
  if (hours < 24) return `${hours} h left`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}


/** "Challenge a friend" when the Your turn list is empty and the person has friends. Open rows come from the RPC. */
export function challengeCard(
  _battles: readonly Battle[] | null,
  hasFriends: boolean,
  _now: number,
): TodayChallengeCard | null {
  if (!hasFriends) return null;
  return { kind: 'challenge_friend', title: 'Challenge a friend', detail: 'Best set, most reps, streak or team' };
}

export function buildTodayView(input: TodayInput): TodayView {
  const hero = todayHero(input);
  const noGoal = input.target == null;
  const streak = !input.dayOne && !noGoal && input.currentStreak > 0 ? input.currentStreak : null;
  const league = input.dayOne || !input.signedIn ? null : leagueCard(input.board, input.meId, input.today);
  const hasFriends = !!input.board && input.board.total.length > 1;
  const challenge = input.dayOne || !input.signedIn ? null : challengeCard(input.battles, hasFriends, input.now);
  const done = hero.kind === 'ring' && hero.done;
  return {
    hero,
    line: todayLine(hero, input.dayOne, input.currentStreak),
    streak,
    primary: done ? { title: 'Start another set', kind: 'gray' } : { title: 'Start a set', kind: 'primary' },
    league,
    challenge,
    betterWithFriends: !league,
    howItWorks: input.dayOne || noGoal,
    week: input.dayOne || noGoal ? null : weekDays(input),
  };
}

/** VoiceOver label for the hero. */
export function heroLabel(hero: TodayHero): string {
  if (hero.kind === 'count') return `${hero.reps} push-ups today`;
  if (hero.kind === 'rest') return `${hero.reps} push-ups today, rest day`;
  return `${hero.reps} of ${hero.target} today${hero.done ? ', goal done' : ''}`;
}

