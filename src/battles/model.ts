/**
 * Battle + friend data as returned by the phase-3 RPCs (my_battles, my_friends, ...), and the
 * pure helpers the screens use. No React or native imports, so it is unit-tested.
 */
export type BattleFormat = 'max_reps' | 'timed' | 'multi_day';
export type BattleMetric = 'rep_count' | 'depth_consistency' | 'tempo' | 'form_score';
export type BattleStatus = 'pending' | 'active' | 'completed' | 'cancelled' | 'expired';
export type ParticipantStatus = 'invited' | 'accepted' | 'declined' | 'expired' | 'forfeited';

export interface Participant {
  userId: string;
  username: string | null;
  displayName: string | null;
  status: ParticipantStatus;
  isMe: boolean;
  attemptsUsed: number;
  validReps: number | null;
  metricValue: number | null;
  avgDepthPct: number | null;
  tempoScore: number | null;
  rank: number | null;
  isWinner: boolean;
}

export interface InviteLink {
  token: string;
  maxUses: number;
  expiresAt: string;
  uses: number;
}

export interface Battle {
  id: string;
  mode: 'async' | 'live';
  format: BattleFormat;
  metric: BattleMetric;
  status: BattleStatus;
  durationS: number | null;
  attemptsAllowed: number;
  maxParticipants: number;
  minQuality: string;
  inviteExpiresAt: string;
  endsAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  createdBy: string | null;
  locked: boolean;
  participants: Participant[];
  inviteLinks: InviteLink[];
}

export type FriendRelation = 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';
export interface Friend {
  userId: string;
  username: string;
  displayName: string | null;
  relation: FriendRelation;
  since?: string | null;
}

export interface FriendRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  recent: {
    battleId: string;
    finishedAt: string;
    format: BattleFormat;
    metric: BattleMetric;
    durationS: number | null;
    players: number;
    me: { rank: number | null; validReps: number | null; metricValue: number | null; isWinner: boolean };
    them: { rank: number | null; validReps: number | null; metricValue: number | null; isWinner: boolean };
  }[];
}

export interface InvitePreview {
  status: 'ok' | 'not_found' | 'revoked' | 'closed' | 'expired' | 'used_up' | 'full';
  battle?: { id: string; format: BattleFormat; metric: BattleMetric; durationS: number | null; status: BattleStatus; endsAt: string | null; players: number; maxParticipants: number };
  creator?: { username: string; displayName: string | null };
  scores?: { username: string; displayName: string | null; validReps: number | null; metricValue: number | null }[];
  member?: boolean;
}

export const personName = (p: { username?: string | null; displayName?: string | null } | null | undefined) =>
  p?.displayName?.trim() || (p?.username ? `@${p.username}` : 'Someone');

export function battleTitle(b: Pick<Battle, 'format' | 'durationS'>): string {
  if (b.format === 'timed') return `${b.durationS ?? 60} s battle`;
  if (b.format === 'max_reps') return 'Max reps';
  return 'Battle';
}

export const me = (b: Battle) => b.participants.find((p) => p.isMe) ?? null;

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Can I still answer the invite? */
export function canRespond(b: Battle, now: number = Date.now()): boolean {
  const m = me(b);
  return !!m && m.status === 'invited' && (b.status === 'pending' || b.status === 'active') && time(b.inviteExpiresAt) > now;
}

/** Can I record my attempt now? (pending battles: only the creator may go first) */
export function canPlay(b: Battle, now: number = Date.now()): boolean {
  const m = me(b);
  if (!m || m.status !== 'accepted' || m.attemptsUsed >= b.attemptsAllowed) return false;
  if (b.endsAt && time(b.endsAt) <= now) return false;
  if (b.status === 'active') return true;
  return b.status === 'pending' && m.userId === b.createdBy;
}

export function isOpen(b: Battle) {
  return b.status === 'pending' || b.status === 'active';
}

export interface BattleGroups {
  /** Waiting on me: an invite to answer or an attempt to record. */
  yourMove: Battle[];
  /** Open, waiting on others. */
  waiting: Battle[];
  finished: Battle[];
}

export function groupBattles(battles: readonly Battle[], now: number = Date.now()): BattleGroups {
  const g: BattleGroups = { yourMove: [], waiting: [], finished: [] };
  for (const b of battles) {
    if (!isOpen(b)) g.finished.push(b);
    else if (canRespond(b, now) || canPlay(b, now)) g.yourMove.push(b);
    else g.waiting.push(b);
  }
  const byDeadline = (a: Battle, b: Battle) => (time(a.endsAt) || Infinity) - (time(b.endsAt) || Infinity);
  g.yourMove.sort(byDeadline);
  g.waiting.sort(byDeadline);
  g.finished.sort((a, b) => (time(b.finishedAt) || 0) - (time(a.finishedAt) || 0));
  return g;
}

/** "3 h 20 m left", "12 m left", "ended". */
export function timeLeft(iso: string | null | undefined, now: number = Date.now()): string {
  const ms = time(iso) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'ended';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'under a minute left';
  if (m < 60) return `${m} m left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} m left`;
  return `${Math.floor(h / 24)} days left`;
}

export function scoreLabel(p: Pick<Participant, 'validReps' | 'metricValue' | 'attemptsUsed'>, metric: BattleMetric): string {
  if (!p.attemptsUsed) return '-';
  if (metric === 'rep_count') return `${p.validReps ?? 0}`;
  return p.metricValue == null ? '-' : `${Math.round(p.metricValue)}`;
}

/** One-line state of a battle for the list. */
export function battleSubtitle(b: Battle, now: number = Date.now()): string {
  const m = me(b);
  if (b.status === 'completed') {
    if (!m || m.rank == null) return 'Finished';
    const players = b.participants.filter((p) => p.rank != null).length;
    const tied = b.participants.filter((p) => p.rank === 1).length > 1;
    if (m.rank === 1) return tied ? 'Draw' : 'You won';
    return `You came ${m.rank} of ${players}`;
  }
  if (b.status === 'expired') return 'Expired';
  if (b.status === 'cancelled') return 'Cancelled';
  if (canRespond(b, now)) return `Invite · ${timeLeft(b.inviteExpiresAt, now)}`;
  if (canPlay(b, now)) return `Your move · ${timeLeft(b.endsAt, now)}`;
  const waitingOn = b.participants.filter((p) => p.status === 'invited' || (p.status === 'accepted' && p.attemptsUsed < b.attemptsAllowed));
  return waitingOn.length ? `Waiting on ${waitingOn.length} · ${timeLeft(b.endsAt, now)}` : `Results soon`;
}

/** The share link for an invite token: universal link once a web domain is configured, else the custom scheme. */
export function inviteUrl(token: string, links: { scheme: string; webBaseUrl: string | null }): string {
  return links.webBaseUrl ? `${links.webBaseUrl}/b/${token}` : `${links.scheme}://invite/${token}`;
}

export function inviteShareMessage(b: Pick<Battle, 'format' | 'durationS'>, from: string, url: string): string {
  const what = b.format === 'timed' ? `a ${b.durationS ?? 60} second pushup battle` : 'a max-reps pushup battle';
  return `${from} challenged you to ${what} on Rep Royale. Open this on your iPhone to join: ${url}`;
}

/** Friends grouped for the friends screen. */
export function groupFriends(rows: readonly Friend[]) {
  const by = (r: FriendRelation) => rows.filter((f) => f.relation === r).sort((a, b) => a.username.localeCompare(b.username));
  return { incoming: by('incoming'), friends: by('friend'), outgoing: by('outgoing'), blocked: by('blocked') };
}

/** User-facing text for an RPC error message. */
export function friendlyError(message: string | undefined | null): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('not signed in')) return 'Sign in first.';
  if (m.includes('pick a username')) return 'Pick a username first (Account).';
  if (m.includes('user not found')) return 'No one with that username.';
  if (m.includes('battle is full')) return 'That battle is full.';
  if (m.includes('invite expired') || m.includes('invite no longer open')) return 'That invite has expired.';
  if (m.includes('invite revoked')) return 'That invite link was turned off.';
  if (m.includes('invite used up')) return 'That invite link has been used up.';
  if (m.includes('invite closed')) return 'That battle is over.';
  if (m.includes('invite not')) return "That invite isn't available.";
  if (m.includes('not friends')) return 'You can only challenge friends.';
  if (m.includes('that is you')) return "That's you!";
  if (m.includes('too many pending')) return 'Too many open friend requests. Wait for some answers.';
  if (m.includes('no attempts left')) return 'You already did your attempt.';
  if (m.includes('deadline')) return 'The deadline has passed.';
  if (m.includes('network') || m.includes('fetch')) return "Couldn't reach the server. Check your connection.";
  return message || 'Something went wrong.';
}
