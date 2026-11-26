/** Supabase calls for personal invite links (20261126170000_friend_invite_links.sql). */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Inviter = { username: string; displayName: string | null; userId?: string };
export type InvitePreviewStatus = 'ok' | 'own' | 'friends' | 'invalid';
export type FriendInvitePreview = { status: InvitePreviewStatus; inviter: Inviter | null };
export type RedeemResult = 'added' | 'already' | 'own';

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

const STATUSES: readonly InvitePreviewStatus[] = ['ok', 'own', 'friends', 'invalid'];

export function parsePreview(raw: unknown): FriendInvitePreview {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const status = STATUSES.includes(o.status as InvitePreviewStatus) ? (o.status as InvitePreviewStatus) : 'invalid';
  const i = typeof o.inviter === 'object' && o.inviter !== null ? (o.inviter as Record<string, unknown>) : null;
  const inviter =
    i && typeof i.username === 'string' && i.username
      ? {
          username: i.username,
          displayName: typeof i.displayName === 'string' && i.displayName.trim() ? i.displayName : null,
          ...(typeof i.userId === 'string' ? { userId: i.userId } : {}),
        }
      : null;
  return { status: inviter ? status : 'invalid', inviter };
}

export const inviteApi = {
  mine: (c: SupabaseClient) => rpc<string>(c, 'my_friend_invite'),
  reset: (c: SupabaseClient) => rpc<string>(c, 'reset_friend_invite'),
  async preview(c: SupabaseClient, code: string): Promise<Res<FriendInvitePreview>> {
    const r = await rpc<unknown>(c, 'friend_invite_preview', { p_code: code });
    return r.ok ? { ok: true, data: parsePreview(r.data) } : r;
  },
  async redeem(c: SupabaseClient, code: string): Promise<Res<RedeemResult | 'invalid'>> {
    const r = await rpc<string>(c, 'redeem_friend_invite', { p_code: code });
    if (!r.ok) return /invite not found/i.test(r.message) ? { ok: true, data: 'invalid' } : r;
    return r.data === 'added' || r.data === 'already' || r.data === 'own' ? { ok: true, data: r.data } : { ok: false, message: 'unexpected reply' };
  },
};
