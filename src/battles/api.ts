/** Supabase calls for friends and battles (thin wrappers around the phase-3 RPCs). */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Battle, Friend, FriendRecord, FriendRelation, InvitePreview } from './model';
import type { SubmitResult } from './uploadQueue';

type Res<T> = { ok: true; data: T } | { ok: false; message: string };

async function rpc<T>(client: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return { ok: false, message: error.message };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

type FriendRow = { user_id: string; username: string; display_name: string | null; relation: FriendRelation; since?: string | null };
const friendFromRow = (r: FriendRow): Friend => ({
  userId: r.user_id,
  username: r.username,
  displayName: r.display_name,
  relation: r.relation,
  since: r.since ?? null,
});

export const api = {
  myBattles: (c: SupabaseClient) => rpc<Battle[]>(c, 'my_battles'),
  async battle(c: SupabaseClient, id: string): Promise<Res<Battle | null>> {
    const r = await rpc<Battle[]>(c, 'my_battles', { p_battle: id });
    return r.ok ? { ok: true, data: r.data?.[0] ?? null } : r;
  },
  createBattle: (
    c: SupabaseClient,
    p: { format: 'max_reps' | 'timed'; durationS?: number; deadlineHours: number; friendIds: string[]; inviteLink: boolean },
  ) => rpc<{ battleId: string; inviteToken: string | null }>(c, 'create_battle', { p }),
  async respond(c: SupabaseClient, battleId: string, userId: string, accept: boolean): Promise<Res<null>> {
    const { error } = await c
      .from('battle_participants')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('battle_id', battleId)
      .eq('user_id', userId)
      .eq('status', 'invited');
    return error ? { ok: false, message: error.message } : { ok: true, data: null };
  },
  cancelBattle: (c: SupabaseClient, battleId: string) => rpc<null>(c, 'cancel_battle', { p_battle: battleId }),
  createInviteLink: (c: SupabaseClient, battleId: string) => rpc<string>(c, 'create_invite_link', { p_battle: battleId }),
  revokeInviteLink: (c: SupabaseClient, token: string) => rpc<null>(c, 'revoke_invite_link', { p_token: token }),
  invitePreview: (c: SupabaseClient, token: string) => rpc<InvitePreview>(c, 'invite_preview', { p_token: token }),
  redeemInvite: (c: SupabaseClient, token: string, addFriend: boolean) =>
    rpc<string>(c, 'redeem_invite', { p_token: token, p_add_friend: addFriend }),

  async friends(c: SupabaseClient): Promise<Res<Friend[]>> {
    const r = await rpc<FriendRow[]>(c, 'my_friends');
    return r.ok ? { ok: true, data: (r.data ?? []).map(friendFromRow) } : r;
  },
  async searchUsers(c: SupabaseClient, q: string): Promise<Res<Friend[]>> {
    const r = await rpc<FriendRow[]>(c, 'search_users', { p_query: q });
    return r.ok ? { ok: true, data: (r.data ?? []).map(friendFromRow) } : r;
  },
  sendFriendRequest: (c: SupabaseClient, username: string) => rpc<unknown>(c, 'send_friend_request', { p_username: username }),
  respondFriendRequest: (c: SupabaseClient, userId: string, accept: boolean) =>
    rpc<unknown>(c, 'respond_friend_request', { p_user: userId, p_accept: accept }),
  removeFriend: (c: SupabaseClient, userId: string) => rpc<unknown>(c, 'remove_friend', { p_user: userId }),
  blockUser: (c: SupabaseClient, userId: string) => rpc<unknown>(c, 'block_user', { p_user: userId }),
  unblockUser: (c: SupabaseClient, userId: string) => rpc<unknown>(c, 'unblock_user', { p_user: userId }),
  friendRecord: (c: SupabaseClient, userId: string) => rpc<FriendRecord>(c, 'friend_battle_record', { p_user: userId }),

  /** Ask the notify function to send queued pushes now (cron does it within a minute anyway). */
  kickNotify(c: SupabaseClient): void {
    c.functions.invoke('notify', { body: { drain: true } }).catch(() => {});
  },

  async submitSet(c: SupabaseClient, payload: Record<string, unknown>): Promise<SubmitResult> {
    const { data, error } = await c.functions.invoke('submit-set', { body: payload });
    if (!error) return { ok: true, setId: (data as { setId?: string })?.setId ?? '' };
    const ctx = (error as { context?: unknown }).context;
    let status = 0;
    let message = error.message;
    if (ctx && typeof (ctx as Response).status === 'number') {
      status = (ctx as Response).status;
      try {
        const body = await (ctx as Response).json();
        if (body?.error) message = String(body.error);
      } catch {
        // not JSON
      }
    }
    return { ok: false, status, error: message };
  },
};
