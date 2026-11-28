/**
 * Challenges in the rebrand (frames 20, 23–25, E10, E11), as pure rules over `my_challenges`.
 * Scores, ranks and winners come from the server; nothing here recomputes a result.
 */
import { calendarDaysBetween, localDate, weekdayName } from '../progress/calendar';
import { formatCount, formatFriendlyDay, formatShortDate } from '../progress';
import { ordinal } from '../progress/leagueView';
import type { ChallengeOffer } from './challengeFromSet';
import { Battle, BattleGroups, canPlay, canRespond, groupBattles, isOpen, me, Participant, personName, streakDayCount } from './model';

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

/** "Today", "Yesterday", "Sun" within the week, else "Nov 9". */
export function shortDay(iso: string | null | undefined, now: number, timeZone: string): string {
  const ms = time(iso);
  if (!Number.isFinite(ms)) return '';
  const day = localDate(ms, timeZone);
  const diff = calendarDaysBetween(day, localDate(now, timeZone));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff >= 2 && diff <= 6) return weekdayName(day).slice(0, 3);
  return formatShortDate(day, timeZone, now);
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

/** Best score among the other players who have gone. */
function bestOther(b: Battle): Participant | null {
  const played = b.participants.filter((p) => !p.isMe && p.attemptsUsed > 0 && p.validReps != null);
  if (played.length === 0) return null;
  return played.reduce((top, p) => ((p.validReps ?? 0) > (top.validReps ?? 0) ? p : top));
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
export function leaderLine(b: Battle): string | null {
  const scored = b.participants.filter((p) => inIt(p) && (b.kind === 'total' || p.attemptsUsed > 0) && p.validReps != null);
  if (scored.length === 0) return null;
  const top = Math.max(...scored.map((p) => p.validReps ?? 0));
  if (top === 0) return null;
  const leaders = scored.filter((p) => (p.validReps ?? 0) === top);
  if (leaders.length > 1) return 'Tied';
  return leaders[0].isMe ? 'You lead' : `${personName(leaders[0])} leads`;
}

/** Waiting on people to accept or (best set) to play. */
function waitingOn(b: Battle): Participant[] {
  const cap = b.attemptsAllowed ?? 1;
  return b.participants.filter(
    (p) => !p.isMe && (p.status === 'invited' || (b.kind === 'best_set' && p.status === 'accepted' && p.attemptsUsed < cap)),
  );
}

export type ChallengeRow =
  | { type: 'play'; battle: Battle; avatar: string; title: string; subtitle: string }
  | { type: 'invite'; battle: Battle; avatar: string; title: string; subtitle: string }
  | { type: 'progress'; battle: Battle; title: string; right: string; subtitle: string; progress: number | null }
  | { type: 'finished'; battle: Battle; won: boolean; title: string; day: string };

/** The list in sections (frame 20): your move (play or answer), in progress, finished. */
export interface ChallengeList {
  yourMove: ChallengeRow[];
  inProgress: ChallengeRow[];
  finished: ChallengeRow[];
}

export function challengeRow(b: Battle, now: number, timeZone: string): ChallengeRow {
  if (canRespond(b, now)) {
    const from = b.participants.find((p) => p.userId === b.createdBy) ?? b.participants.find((p) => !p.isMe) ?? null;
    const who = from ? personName(from) : 'A friend';
    return { type: 'invite', battle: b, avatar: who, title: `${who} invited you`, subtitle: challengeName(b) };
  }
  if (canPlay(b, now)) {
    const best = bestOther(b);
    const left = shortTimeLeft(b.endsAt, now);
    const parts = [best ? `${formatCount(best.validReps ?? 0)} to beat` : 'Your turn', left].filter(Boolean);
    const others = b.participants.filter((p) => !p.isMe && inIt(p));
    return {
      type: 'play',
      battle: b,
      avatar: others[0] ? personName(others[0]) : 'You',
      title: `${challengeName(b)} vs ${opponents(b)}`,
      subtitle: parts.join(' · '),
    };
  }
  if (isOpen(b)) {
    const waiting = waitingOn(b);
    let right = '';
    let progress: number | null = null;
    if (b.kind === 'team') {
      const { total, target } = teamProgress(b);
      right = target > 0 ? `${formatCount(total)} of ${formatCount(target)}` : formatCount(total);
      progress = target > 0 ? Math.min(1, total / target) : null;
    } else if (b.kind === 'streak') {
      const d = b.status === 'active' ? streakDay(b, now) : null;
      if (d) {
        right = `Day ${d.day} of ${d.of}`;
        progress = d.day / d.of;
      }
    } else {
      right = leaderLine(b) ?? '';
    }
    if (waiting.length > 0 && (b.status === 'pending' || b.kind === 'best_set')) {
      right = waiting.length === 1 ? `Waiting on ${personName(waiting[0])}` : `Waiting on ${waiting.length}`;
    }
    if (!right) right = shortTimeLeft(b.endsAt, now);
    const title = b.kind === 'best_set' ? `${challengeName(b)} vs ${opponents(b)}` : challengeName(b);
    return { type: 'progress', battle: b, title, right, subtitle: playersLine(b), progress };
  }
  return {
    type: 'finished',
    battle: b,
    won: !!me(b)?.isWinner && b.status === 'completed',
    title: finishedTitle(b),
    day: shortDay(endedAt(b), now, timeZone),
  };
}

/** "Won vs Jack · Best set", "Lost vs Jack · Most reps", "2nd of 4 · Most reps", "Goal reached · Team week". */
export function finishedTitle(b: Battle): string {
  const name = b.kind === 'team' || b.kind === 'streak' ? challengeName(b) : kindLabel(b);
  if (b.status === 'cancelled') return `Cancelled · ${name}`;
  if (b.status === 'expired') return `Ended early · ${name}`;
  if (b.myOutcomeLabel) return `${b.myOutcomeLabel} · ${name}`;
  const result = resultOf(b);
  return `${result.short} · ${name}`;
}

export type ResultKind = 'won' | 'lost' | 'draw' | 'goal' | 'missed' | 'finished';

/** How it ended for the user. Team goals succeed or miss together. */
export function resultOf(b: Battle): { kind: ResultKind; short: string; title: string; winner: Participant | null } {
  const mine = me(b);
  if (b.kind === 'team') {
    const reached = b.participants.some((p) => p.isWinner);
    return reached
      ? { kind: 'goal', short: 'Goal reached', title: 'Goal reached', winner: null }
      : { kind: 'missed', short: 'Missed the goal', title: 'Missed the goal', winner: null };
  }
  const winners = b.participants.filter((p) => p.isWinner);
  const ranked = b.participants.filter((p) => p.rank != null);
  const two = b.participants.filter((p) => p.status === 'accepted' || p.status === 'forfeited').length <= 2;
  const vs = `vs ${opponents(b)}`;
  if (winners.length > 1 && winners.some((p) => p.isMe)) return { kind: 'draw', short: `Draw ${vs}`, title: 'Draw', winner: null };
  if (mine?.isWinner) return { kind: 'won', short: `Won ${vs}`, title: 'You won', winner: mine };
  const winner = winners[0] ?? null;
  if (mine && mine.rank != null && !two) {
    return {
      kind: 'lost',
      short: `${ordinal(mine.rank)} of ${ranked.length}`,
      title: winner ? `${personName(winner)} won` : 'Finished',
      winner,
    };
  }
  if (winner) return { kind: 'lost', short: `Lost ${vs}`, title: `${personName(winner)} won`, winner };
  return { kind: 'finished', short: 'Finished', title: 'Finished', winner: null };
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

export function challengeList(battles: readonly Battle[], now: number, timeZone: string): ChallengeList {
  const g: BattleGroups = groupBattles(battles, now);
  const row = (b: Battle) => challengeRow(b, now, timeZone);
  return { yourMove: g.yourMove.map(row), inProgress: g.waiting.map(row), finished: g.finished.map(row) };
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

/** Two people on a best set or most reps: the head-to-head card (frame 23). */
export function headToHead(b: Battle): { you: Participant; them: Participant } | null {
  if (b.kind !== 'best_set' && b.kind !== 'total') return null;
  const people = b.participants.filter(inIt);
  if (people.length !== 2) return null;
  const you = people.find((p) => p.isMe);
  const them = people.find((p) => !p.isMe);
  return you && them ? { you, them } : null;
}

/** Score shown on the head-to-head card: "–" until they've played. */
export function headScore(b: Battle, p: Participant): string {
  if (p.status === 'invited') return '–';
  if (b.kind === 'best_set' && p.attemptsUsed === 0) return '–';
  return formatCount(p.validReps ?? 0);
}

/** "Brett leads · 1 day left", "Waiting on Brett · 2 days left". */
export function detailLine(b: Battle, now: number): string {
  const waiting = waitingOn(b);
  const lead =
    b.kind === 'team'
      ? null
      : b.kind === 'streak'
        ? null
        : (leaderLine(b) ??
          (waiting.length === 1 ? `Waiting on ${personName(waiting[0])}` : waiting.length > 1 ? `Waiting on ${waiting.length}` : null));
  const left = b.status === 'pending' && !b.endsAt ? null : shortTimeLeft(b.endsAt, now);
  return [lead, left].filter(Boolean).join(' · ');
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

/**
 * Can an ordinary set still add reps to this challenge? Most reps, team and streak count every set done
 * inside their window, for anyone who has joined, whether or not the others have accepted yet (a challenge
 * is "pending" until a second person accepts, e.g. while the opponent hasn't answered or is a bot).
 * A best set is not here: it has its own Play attempt (`canPlay`).
 */
export function canAddReps(b: Battle, now: number): boolean {
  if (b.kind === 'best_set' || !isOpen(b)) return false;
  const mine = me(b);
  if (!mine || mine.status !== 'accepted') return false;
  const ends = time(b.endsAt);
  if (Number.isFinite(ends) && ends <= now) return false;
  const starts = time(b.startsAt);
  if (Number.isFinite(starts) && starts > now) return false;
  return true;
}
