/**
 * Open-challenge rows and period records as returned by the RPCs.
 * The back end has the opinions; these helpers only format and group for layout.
 */
import { formatCount } from '../progress';
import type { ChallengeKind, ChallengeWindow } from './model';

export type CtaType = 'accept_decline' | 'play' | 'start_set' | 'none';

export type OpenStatusKey =
  | 'invited_you'
  | 'awaiting_result'
  | 'play'
  | 'waiting_on'
  | 'start'
  | 'tied'
  | 'you_lead'
  | 'behind'
  | 'contribute'
  | 'goal_done'
  | 'streak_today'
  | 'goal_done_today';

export interface OpenPerson {
  userId: string;
  username: string | null;
  displayName: string | null;
  status: string;
  isMe: boolean;
}

export interface OpenChallenge {
  challengeId: string;
  kind: ChallengeKind;
  title: string;
  status: string;
  myParticipantStatus: string;
  startsAt: string | null;
  endsAt: string | null;
  timeLeftS: number | null;
  timeLeftAmount: number | null;
  timeLeftUnit: 'day' | 'hour' | 'minute' | null;
  canDoPushUps: boolean;
  needsResponse: boolean;
  isMyTurn: boolean;
  turnReason: string | null;
  ctaType: CtaType;
  ctaLabel: string | null;
  statusKey: OpenStatusKey | string;
  statusLabel: string | null;
  sortRank: number;
  myValidReps: number | null;
  leaderUserId: string | null;
  leaderDisplayName: string | null;
  leaderReps: number | null;
  waitingOn: { userId: string; displayName: string }[];
  people: OpenPerson[];
  teamTotal: number | null;
  teamTarget: number | null;
  streakDay: number | null;
  streakLength: number | null;
  progressFrac: number | null;
  primaryOpponentUserId: string | null;
  primaryOpponentDisplayName: string | null;
  awaitingResult: boolean;
  durationDays: number | null;
  windowUnit: ChallengeWindow | null;
  targetReps: number | null;
}

export interface ChallengeFriendRow {
  userId: string;
  username: string;
  displayName: string | null;
  wins: number;
  ties: number;
  losses: number;
  forfeits: number;
  lastFinishedAt: string | null;
  lastOutcome: string | null;
  sortRank: number;
}

export interface ChallengeRecordEvent {
  challengeId: string;
  kind: ChallengeKind;
  title: string;
  outcome: string;
  outcomeLabel: string;
  finishedAt: string;
  sortRank: number;
}

export interface ChallengeRecordPeriod {
  key: string;
  label: string;
  from: string | null;
  to: string;
  isDefault: boolean;
}

export interface MyChallengeRecord {
  periodFrom: string;
  periodTo: string;
  wins: number;
  ties: number;
  losses: number;
  forfeits: number;
  cancelled: number;
  expired: number;
  declined: number;
  friends: ChallengeFriendRow[];
  otherEvents: ChallengeRecordEvent[];
}

export interface FriendFinishedRow {
  challengeId: string;
  kind: ChallengeKind;
  title: string;
  outcome: string;
  outcomeLabel: string;
  finishedAt: string;
  myReps: number | null;
  theirReps: number | null;
  sortRank: number;
}

/** Format the server's time-left amount and unit. */
export function formatTimeLeft(row: Pick<OpenChallenge, 'timeLeftAmount' | 'timeLeftUnit' | 'timeLeftS' | 'awaitingResult'>): string {
  if (row.awaitingResult) return '';
  const n = row.timeLeftAmount;
  const unit = row.timeLeftUnit;
  if (n == null || !unit || n <= 0) {
    if (row.timeLeftS != null && row.timeLeftS <= 0) return '';
    return '';
  }
  if (unit === 'day') return n === 1 ? '1 day left' : `${n} days left`;
  if (unit === 'hour') return n === 1 ? '1 hour left' : `${n} hours left`;
  return n === 1 ? '1 minute left' : `${n} minutes left`;
}

/** Status line under the title, with team counts formatted on the client. */
export function formatStatusLine(row: OpenChallenge): string {
  let status = row.statusLabel;
  if ((row.statusKey === 'contribute' || row.statusKey === 'goal_done') && row.teamTarget != null) {
    status = `${formatCount(row.teamTotal ?? 0)} of ${formatCount(row.teamTarget)}`;
  }
  const left = formatTimeLeft(row);
  return [status, left].filter(Boolean).join(' · ');
}

export function actionRows(rows: readonly OpenChallenge[]): OpenChallenge[] {
  return rows.filter((r) => r.isMyTurn);
}

export function waitingRows(rows: readonly OpenChallenge[]): OpenChallenge[] {
  return rows.filter((r) => !r.isMyTurn);
}

/** Today shows the first three action rows, in the server's sort order. */
export function todayActionRows(rows: readonly OpenChallenge[], cap = 3): { rows: OpenChallenge[]; seeAll: boolean } {
  const action = actionRows(rows);
  return { rows: action.slice(0, cap), seeAll: action.length > cap };
}

export function avatarName(row: OpenChallenge): string {
  return row.primaryOpponentDisplayName || row.people.find((p) => !p.isMe)?.displayName || row.people.find((p) => !p.isMe)?.username || 'Someone';
}

export function recordIsEmpty(rec: MyChallengeRecord | null): boolean {
  if (!rec) return true;
  return rec.wins + rec.ties + rec.losses + rec.forfeits + rec.cancelled + rec.expired === 0 && rec.friends.length === 0;
}
