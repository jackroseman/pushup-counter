/**
 * Challenge labels, standings formatting, rematch defaults, and empty states.
 * Turn state, results, and whether to show a head-to-head card come from the RPCs.
 */
import { formatCount, formatFriendlyDay } from '../progress';
import type { ChallengeOffer } from './challengeFromSet';
import { Battle, isOpen, Participant, personName, streakDayCount } from './model';

const DAY = 86_400_000;
const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);

/** The kind on its own: "Best set", "Most reps", "Streak", "Team goal". */
export function kindLabel(b: Pick<Battle, 'kind'>): string {
  if (b.kind === 'best_set') return 'Best set';
  if (b.kind === 'total') return 'Most reps';
  if (b.kind === 'streak') return 'Streak';
  return 'Team goal';
}

const WINDOW_WORD = { day: 'day', week: 'week', month: 'month' } as const;

/** The challenge's name: "Best set", "Most reps this week", "7-day streak", "Team week". */
export function challengeName(b: Pick<Battle, 'kind' | 'windowUnit' | 'startsAt' | 'endsAt'>): string {
  if (b.kind === 'best_set') return 'Best set';
  if (b.kind === 'total') {
    if (b.windowUnit === 'day') return 'Most reps today';
    if (b.windowUnit === 'week') return 'Most reps this week';
    if (b.windowUnit === 'month') return 'Most reps this month';
    return 'Most reps';
  }
  if (b.kind === 'streak') {
    const days = streakDayCount(b);
    return days ? `${days}-day streak` : 'Streak';
  }
  if (b.windowUnit && b.windowUnit !== 'custom') return `Team ${WINDOW_WORD[b.windowUnit]}`;
  return 'Team goal';
}

/** How long it runs: "1 week", "7 days", "60 s" (a best set's time limit lives in its own row). */
export function lengthLabel(b: Pick<Battle, 'kind' | 'windowUnit' | 'startsAt' | 'endsAt'>): string | null {
  if (b.kind === 'streak') {
    const days = streakDayCount(b);
    return days ? `${days} day${days === 1 ? '' : 's'}` : null;
  }
  if (b.windowUnit && b.windowUnit !== 'custom') return `1 ${WINDOW_WORD[b.windowUnit]}`;
  return null;
}

/** "1 day left", "3 days left", "5 h left", "20 min left". */
export function shortTimeLeft(iso: string | null | undefined, now: number): string {
  const ms = time(iso) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'Ended';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h left`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}

/** People still in it (not declined, not an expired invite). */
const inIt = (p: Participant) => p.status === 'accepted' || p.status === 'invited' || p.status === 'forfeited';
const nameOf = (p: Participant) => (p.isMe ? 'You' : personName(p));

/** "Brett", "Brett and Jack", "Brett +2". Other people only. */
export function opponents(b: Pick<Battle, 'participants'>): string {
  const others = b.participants.filter((p) => !p.isMe && inIt(p)).map(personName);
  if (others.length === 0) return 'no one yet';
  if (others.length === 1) return others[0];
  if (others.length === 2) return `${others[0]} and ${others[1]}`;
  return `${others[0]} +${others.length - 1}`;
}

/** "You, Jack, Brett": everyone in it, the user first. */
export function playersLine(b: Pick<Battle, 'participants'>): string {
  const people = b.participants.filter(inIt);
  const mine = people.filter((p) => p.isMe);
  return [...mine, ...people.filter((p) => !p.isMe)].map(nameOf).join(', ');
}

/** Shared total and target on a team goal. */
export function teamProgress(b: Battle): { total: number; target: number } {
  const total = b.participants.find((p) => p.teamTotal != null)?.teamTotal ?? 0;
  const target = b.targetReps ?? b.participants.find((p) => p.teamTarget != null)?.teamTarget ?? 0;
  return { total, target };
}

/** Day N of a streak, 1-based, capped at its length. */
export function streakDay(b: Battle, now: number): { day: number; of: number } | null {
  const of = streakDayCount(b);
  const start = time(b.startsAt);
  if (!of || !Number.isFinite(start)) return null;
  return { day: Math.min(of, Math.max(1, Math.floor((now - start) / DAY) + 1)), of };
}

/** Who is ahead on a most-reps or best-set challenge: "Brett leads", "You lead", "Tied". */
/** "Won · Most reps", "Goal reached · Team week". Labels come from the RPC. */
export function finishedTitle(b: Battle): string {
  const name = b.kind === 'team' || b.kind === 'streak' ? challengeName(b) : kindLabel(b);
  if (b.myOutcomeLabel) return `${b.myOutcomeLabel} · ${name}`;
  if (b.status === 'cancelled') return `Cancelled · ${name}`;
  if (b.status === 'expired') return `Expired · ${name}`;
  return name;
}

/** When it ended, a hair before: a window closing at local midnight ended the day before (Sunday, not Monday). */
function endedAt(b: Battle): string | null {
  const ms = time(b.finishedAt ?? b.endsAt);
  return Number.isFinite(ms) ? new Date(ms - 1).toISOString() : null;
}

/** "Most reps this week · ended Sunday". */
export function resultSubtitle(b: Battle, now: number, timeZone: string): string {
  const at = endedAt(b);
  if (!at) return challengeName(b);
  const day = formatFriendlyDay(at, now, timeZone);
  return `${challengeName(b)} · ended ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}`;
}

/** E10 / E11: which empty state, if any. Friends unknown (still loading) shows none. */
export function challengesEmpty(battles: readonly Battle[] | null, friendCount: number | null): 'none' | 'noFriends' | null {
  if (!battles || battles.length > 0 || friendCount == null) return null;
  return friendCount === 0 ? 'noFriends' : 'none';
}

/** A standings row: rank (if any), name, score text. */
export interface StandingRow {
  userId: string;
  rank: number | null;
  name: string;
  score: string;
  me: boolean;
  /** Second line: invited, out, not played yet. */
  note: string | null;
}

/** Everyone in it, ordered by the server's rank (then score, then name). */
export function standings(b: Battle): StandingRow[] {
  const cap = b.attemptsAllowed ?? 1;
  const people = b.participants.filter((p) => p.status !== 'declined' && p.status !== 'expired');
  const score = (p: Participant) => (b.kind === 'streak' ? (p.daysSurvived ?? 0) : (p.validReps ?? 0));
  const sorted = [...people].sort(
    (x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9) || score(y) - score(x) || personName(x).localeCompare(personName(y)),
  );
  return sorted.map((p) => {
    let note: string | null = null;
    if (p.status === 'invited') note = 'Invited';
    else if (b.kind === 'streak' && (p.status === 'forfeited' || p.eliminatedOn)) note = 'Out';
    else if (p.status === 'forfeited') note = 'Left';
    else if (b.kind === 'best_set' && p.attemptsUsed === 0 && isOpen(b)) note = 'Not played yet';
    else if (b.kind === 'best_set' && p.attemptsUsed < cap && isOpen(b) && cap > 1) note = `${p.attemptsUsed} of ${cap} tries`;
    const played = b.kind !== 'best_set' || p.attemptsUsed > 0;
    const value = b.kind === 'streak' ? `${score(p)} ${score(p) === 1 ? 'day' : 'days'}` : played ? formatCount(p.validReps ?? 0) : '–';
    return { userId: p.userId, rank: p.rank, name: nameOf(p), score: p.status === 'invited' ? '–' : value, me: p.isMe, note };
  });
}

/** Score shown on the head-to-head card: "–" until they have played. */
export function headScore(b: Battle, p: Participant): string {
  if (p.status === 'invited') return '–';
  if (b.kind === 'best_set' && p.attemptsUsed === 0) return '–';
  return formatCount(p.validReps ?? 0);
}

/** Rematch: same people, same kind and length (create_challenge with the same settings). */
export function rematchParams(b: Battle): { friendIds: string[]; offer: ChallengeOffer } {
  const friendIds = b.participants.filter((p) => !p.isMe && p.status !== 'declined' && p.status !== 'expired').map((p) => p.userId);
  let offer: ChallengeOffer;
  if (b.kind === 'best_set') offer = { kind: 'best_set', durationS: b.durationS };
  else if (b.kind === 'total' || b.kind === 'team') {
    const days = (b.durationDays ?? (b.windowUnit === 'day' ? 1 : b.windowUnit === 'month' ? 30 : 7)) as 1 | 7 | 14 | 30;
    offer = { kind: b.kind, durationDays: days };
  } else offer = { kind: b.kind };
  return { friendIds, offer };
}
