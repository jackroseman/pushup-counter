// Pure: turns a claimed outbox row (kind + facts from private.notification_facts) into
// push text. No Deno or npm imports, so jest tests it (__tests__/notificationContent.test.ts).
import type { PushContent } from './expoPush.ts';

export const APP_SCHEME = 'pushupcounter';
export const battleUrl = (id: string) => `${APP_SCHEME}://battle/${id}`;
export const FRIENDS_URL = `${APP_SCHEME}://friends`;

export type NotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'battle_invite'
  | 'invite_accepted'
  | 'invite_declined'
  | 'set_submitted'
  | 'battle_result'
  | 'battle_expired'
  | 'battle_cancelled'
  | 'battle_reminder'
  | 'battle_reminder_half';

interface Person { username?: string; displayName?: string }
interface Score { username?: string; validReps?: number; metricValue?: number | null; rank?: number; isMe?: boolean; isWinner?: boolean }
export interface NotificationFacts {
  timeZone?: string;
  actor?: Person;
  battle?: {
    id: string;
    format?: 'max_reps' | 'timed' | 'multi_day';
    metric?: 'rep_count' | 'depth_consistency' | 'tempo' | 'form_score';
    durationS?: number;
    status?: string;
    endsAt?: string;
    creator?: string;
    creatorIsMe?: boolean;
    mySetDone?: boolean;
  };
  actorScore?: Score;
  leader?: Score;
  result?: Score & { players?: number; draw?: boolean; top?: Score[] };
}

export interface ClaimedNotification {
  id: number;
  user_id: string;
  kind: NotificationKind | string;
  battle_id: string | null;
  facts: NotificationFacts | null;
}

const name = (p?: Person) => p?.displayName?.trim() || (p?.username ? `@${p.username}` : 'Someone');
const short = (p?: Person) => p?.displayName?.trim() || p?.username || 'Someone';

function battleLabel(b?: NotificationFacts['battle']): string {
  if (!b) return 'a battle';
  if (b.format === 'timed' && b.durationS) return `a ${b.durationS} s battle`;
  if (b.format === 'max_reps') return 'a max-reps battle';
  return 'a battle';
}

/** "28 reps", or the metric value for score-based battles. */
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
  const b = f.battle;
  const metric = b?.metric;
  const battleData = (type: string) => ({ type, battleId: n.battle_id, url: n.battle_id ? battleUrl(n.battle_id) : FRIENDS_URL });
  const by = deadlineText(b?.endsAt, f.timeZone);
  switch (n.kind) {
    case 'friend_request':
      return { title: 'Friend request', body: `${name(f.actor)} wants to be friends`, data: { type: n.kind, url: FRIENDS_URL } };
    case 'friend_accepted':
      return { title: 'New friend', body: `${name(f.actor)} accepted your friend request. Challenge them!`, data: { type: n.kind, url: FRIENDS_URL } };
    case 'battle_invite': {
      if (!b) return null;
      const lead = f.leader ? ` ${short(f.leader)} already did ${scoreText(f.leader, metric)}.` : '';
      return { title: 'New challenge', body: `${name(f.actor)} challenged you to ${battleLabel(b)}.${lead}`, data: battleData(n.kind) };
    }
    case 'invite_accepted':
      return b ? { title: 'Challenge accepted', body: `${short(f.actor)} accepted${b.mySetDone ? '' : ', your move'}`, data: battleData(n.kind) } : null;
    case 'invite_declined':
      return b ? { title: 'Challenge declined', body: `${short(f.actor)} declined your challenge`, data: battleData(n.kind) } : null;
    case 'set_submitted': {
      if (!b || b.status === 'completed') return null; // the result push covers it
      const score = scoreText(f.actorScore, metric);
      const body = b.mySetDone
        ? `${short(f.actor)} did ${score}`
        : `${short(f.actor)} did ${score}. Beat it${by ? ` by ${by}` : ''}`;
      return { title: 'Battle update', body, data: battleData(n.kind) };
    }
    case 'battle_reminder':
    case 'battle_reminder_half': {
      if (!b || b.mySetDone || b.status === 'completed') return null;
      const h = hoursLeft(b.endsAt, now);
      const left = h == null ? 'Time is running out' : h <= 1 ? 'Under an hour left' : `${h} h left`;
      const target = f.leader ? ` to beat ${short(f.leader)}'s ${scoreText(f.leader, metric)}` : ' in your battle';
      return { title: 'Battle reminder', body: `${left}${target}`, data: battleData(n.kind) };
    }
    case 'battle_result': {
      const r = f.result;
      if (!b || !r) return null;
      const others = (r.top ?? []).filter((t) => !t.isMe);
      const best = others[0];
      let body: string;
      if (r.draw && r.rank === 1) body = `It's a draw! ${scoreText(r, metric)} each`;
      else if (r.isWinner || r.rank === 1) body = `You won! ${scoreText(r, metric)}${best ? ` vs ${scoreText(best, metric)}` : ''}`;
      else if (r.rank == null) body = `Battle over. ${best ? `${short(best)} won with ${scoreText(best, metric)}` : 'See the results'}`;
      else {
        const winner = (r.top ?? []).find((t) => t.rank === 1);
        body = `You came ${ordinal(r.rank)} of ${r.players ?? '?'}. ${winner ? `${short(winner)} won with ${scoreText(winner, metric)}` : ''}`.trim();
      }
      return { title: 'Battle results', body, data: battleData(n.kind) };
    }
    case 'battle_expired':
      return b ? { title: 'Battle expired', body: b.creatorIsMe ? 'Nobody joined your challenge in time' : `${b.creator ? `@${b.creator}'s` : 'A'} challenge expired`, data: battleData(n.kind) } : null;
    case 'battle_cancelled':
      return b ? { title: 'Battle cancelled', body: `${b.creator ? `@${b.creator}` : 'The creator'} cancelled the battle`, data: battleData(n.kind) } : null;
    default:
      return null;
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
