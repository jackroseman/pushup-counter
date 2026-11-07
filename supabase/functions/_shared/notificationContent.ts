// Pure: turns a claimed outbox row (kind + facts from private.notification_facts) into
// push text. No Deno or npm imports, so jest tests it (__tests__/notificationContent.test.ts).
import type { PushContent } from './expoPush.ts';

export const APP_SCHEME = 'pushupcounter';
export const challengeUrl = (id: string) => `${APP_SCHEME}://challenge/${id}`;
export const FRIENDS_URL = `${APP_SCHEME}://friends`;
export const TODAY_URL = `${APP_SCHEME}://today`;
export const LEAGUE_URL = `${APP_SCHEME}://league`;

export type NotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'challenge_invite'
  | 'invite_accepted'
  | 'invite_declined'
  | 'set_submitted'
  | 'challenge_result'
  | 'challenge_expired'
  | 'challenge_cancelled'
  | 'challenge_reminder'
  | 'challenge_reminder_half'
  | 'daily_nudge'
  | 'pass_ping'
  | 'weekly_recap';

interface Person { username?: string; displayName?: string }
interface Score {
  username?: string;
  displayName?: string;
  validReps?: number;
  metricValue?: number | null;
  rank?: number;
  isMe?: boolean;
  isWinner?: boolean;
  teamTotal?: number | null;
  teamTarget?: number | null;
}
interface NudgeFacts { target?: number | null; reps?: number | null; rest?: boolean }
interface PassFacts { board?: 'total' | 'improvement'; theirs?: number | null; mine?: number | null }
interface RecapFacts {
  reps?: number | null;
  goalDaysHit?: number | null;
  goalDaysScheduled?: number | null;
  totalRank?: number | null;
  improvementRank?: number | null;
  totalCrown?: boolean;
  friends?: boolean;
}
export interface ChallengeFacts {
  id: string;
  kind?: 'best_set' | 'total' | 'streak' | 'team';
  windowUnit?: 'day' | 'week' | 'month' | 'custom' | null;
  metric?: 'rep_count' | 'depth_consistency' | 'tempo' | 'form_score' | null;
  durationS?: number | null;
  status?: string;
  endsAt?: string;
  creator?: string;
  creatorIsMe?: boolean;
  mySetDone?: boolean;
}
export interface NotificationFacts {
  timeZone?: string;
  actor?: Person;
  nudge?: NudgeFacts;
  pass?: PassFacts;
  recap?: RecapFacts;
  challenge?: ChallengeFacts;
  actorScore?: Score;
  leader?: Score;
  result?: Score & { players?: number; draw?: boolean; top?: Score[] };
}

export interface ClaimedNotification {
  id: number;
  user_id: string;
  kind: NotificationKind | string;
  challenge_id: string | null;
  facts: NotificationFacts | null;
}

const name = (p?: Person) => p?.displayName?.trim() || (p?.username ? `@${p.username}` : 'Someone');
const short = (p?: Person) => p?.displayName?.trim() || p?.username || 'Someone';

function windowPhrase(unit: ChallengeFacts['windowUnit']): string | null {
  if (unit === 'day') return 'today';
  if (unit === 'week') return 'this week';
  if (unit === 'month') return 'this month';
  return null;
}

function isWindow(c?: ChallengeFacts): boolean {
  return c?.kind === 'total' || c?.kind === 'streak' || c?.kind === 'team';
}

/** "most reps this week", "best set · 60 s". */
export function challengePhrase(c?: ChallengeFacts): string {
  if (!c) return 'a challenge';
  if (c.kind === 'total') {
    if (c.windowUnit === 'day') return 'most reps today';
    if (c.windowUnit === 'week') return 'most reps this week';
    if (c.windowUnit === 'month') return 'most reps this month';
    return 'most reps';
  }
  if (c.kind === 'best_set') return c.durationS ? `best set · ${c.durationS} s` : 'best set';
  if (c.kind === 'streak') return 'a streak face-off';
  if (c.kind === 'team') return 'a team goal';
  return 'a challenge';
}

/** A bare number for "is on 28" / "32 to 28". Rep challenges use counted reps. */
export function standingNumber(s: Score | undefined, metric: string | null | undefined): string {
  if (!metric || metric === 'rep_count') return String(s?.validReps ?? 0);
  return s?.metricValue == null ? '-' : `${Math.round(s.metricValue)}`;
}

/** "28 reps", or the metric value for score-based challenges. */
export function scoreText(s: Score | undefined, metric: string | undefined): string {
  if (!s) return '0';
  if (!metric || metric === 'rep_count') {
    const n = s.validReps ?? 0;
    return `${n} rep${n === 1 ? '' : 's'}`;
  }
  return s.metricValue == null ? '-' : `${Math.round(s.metricValue)}`;
}

/** "Fri 6:00 PM" in the recipient's time zone (falls back to UTC). */
export function deadlineText(iso: string | undefined, timeZone: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timeZone || 'UTC' }).format(d).replace(',', '');
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d).replace(',', '');
  }
}

export function hoursLeft(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 3_600_000));
}

/** Push text for one outbox row, or null when there is nothing worth sending. */
export function buildNotification(n: ClaimedNotification, now: Date = new Date()): PushContent | null {
  const f = n.facts ?? {};
  const c = f.challenge;
  const metric = c?.metric ?? undefined;
  const data = (type: string) => ({
    type,
    challengeId: n.challenge_id,
    url: n.challenge_id ? challengeUrl(n.challenge_id) : FRIENDS_URL,
  });
  const by = deadlineText(c?.endsAt, f.timeZone);
  switch (n.kind) {
    case 'friend_request':
      return { title: 'Friend request', body: `${name(f.actor)} wants to be friends`, data: { type: n.kind, url: FRIENDS_URL } };
    case 'friend_accepted':
      return { title: 'New friend', body: `${name(f.actor)} accepted your friend request. Challenge them!`, data: { type: n.kind, url: FRIENDS_URL } };
    case 'challenge_invite': {
      if (!c) return null;
      return { title: 'New challenge', body: `${name(f.actor)} challenged you: ${challengePhrase(c)}.`, data: data(n.kind) };
    }
    case 'invite_accepted':
      return c ? { title: 'Challenge accepted', body: `${short(f.actor)} accepted. You're on.`, data: data(n.kind) } : null;
    case 'invite_declined':
      return c ? { title: 'Challenge declined', body: `${short(f.actor)} declined.`, data: data(n.kind) } : null;
    case 'set_submitted': {
      if (!c || c.status === 'completed') return null;
      if (isWindow(c)) {
        const reps = f.actorScore?.validReps ?? 0;
        const where = windowPhrase(c.windowUnit);
        return { title: 'Challenge update', body: `${short(f.actor)} is on ${reps} reps${where ? ` ${where}` : ''}.`, data: data(n.kind) };
      }
      const nScore = standingNumber(f.actorScore, metric);
      const body = c.mySetDone
        ? `${short(f.actor)} is on ${nScore}.`
        : `${short(f.actor)} is on ${nScore}.${by ? ` You have until ${by}.` : ''}`;
      return { title: 'Challenge update', body, data: data(n.kind) };
    }
    case 'challenge_reminder':
    case 'challenge_reminder_half': {
      if (!c || c.mySetDone || c.status === 'completed') return null;
      const h = hoursLeft(c.endsAt, now);
      const left = h == null ? 'Time is running out' : h <= 1 ? 'Under an hour left' : `${h} hours left`;
      const target = !isWindow(c) && f.leader ? ` to beat ${short(f.leader)}'s ${standingNumber(f.leader, metric)}` : '';
      return { title: 'Challenge reminder', body: `${left}${target}.`, data: data(n.kind) };
    }
    case 'daily_nudge': {
      const nudge = f.nudge;
      if (!nudge || nudge.rest || (nudge.reps ?? 0) > 0 || nudge.target == null || nudge.target <= 0) return null;
      return {
        title: 'Today',
        body: `No push-ups yet today. Your goal is ${nudge.target}.`,
        data: { type: n.kind, url: TODAY_URL },
      };
    }
    case 'pass_ping': {
      const pass = f.pass;
      if (!pass || pass.theirs == null || pass.mine == null || pass.theirs <= pass.mine) return null;
      const body = pass.board === 'improvement'
        ? `${short(f.actor)} passed you this week on improvement — ${pass.theirs} to your ${pass.mine}.`
        : `${short(f.actor)} passed you this week — ${pass.theirs} to your ${pass.mine}.`;
      return { title: 'League', body, data: { type: n.kind, url: LEAGUE_URL } };
    }
    case 'weekly_recap': {
      const recap = f.recap;
      if (!recap || recap.reps == null) return null;
      let body = `${recap.reps} push-ups`;
      if ((recap.goalDaysScheduled ?? 0) > 0) body += ` · ${recap.goalDaysHit ?? 0}/${recap.goalDaysScheduled} goal days`;
      if (recap.friends && recap.totalRank && recap.improvementRank) {
        body += ` · ${ordinal(recap.totalRank)} on total, ${ordinal(recap.improvementRank)} on improvement.`;
      } else {
        body += '.';
      }
      if (recap.totalCrown) body += ' You took the total crown.';
      return { title: 'Your week', body, data: { type: n.kind, url: LEAGUE_URL } };
    }
    case 'challenge_result': {
      const r = f.result;
      if (!c || !r) return null;
      const others = (r.top ?? []).filter((t) => !t.isMe);
      const best = others[0];
      let body: string;
      if (c.kind === 'team' && r.isWinner) body = `Your team hit ${r.teamTarget ?? r.teamTotal ?? 0}.`;
      else if (r.draw && r.rank === 1) body = 'Draw.';
      else if (r.isWinner || r.rank === 1) {
        const mine = standingNumber(r, metric);
        body = best ? `You won. ${mine} to ${standingNumber(best, metric)}.` : `You won. ${mine}.`;
      } else if (r.rank == null) body = 'The challenge is over.';
      else body = `You came ${ordinal(r.rank)} of ${r.players ?? '?'}.`;
      return { title: 'Challenge results', body, data: data(n.kind) };
    }
    case 'challenge_expired':
      return c ? { title: 'Challenge ended', body: 'The challenge ended before enough people played.', data: data(n.kind) } : null;
    case 'challenge_cancelled':
      return c ? { title: 'Challenge cancelled', body: `${c.creator ? `@${c.creator}` : 'The creator'} cancelled the challenge.`, data: data(n.kind) } : null;
    default:
      return null;
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
