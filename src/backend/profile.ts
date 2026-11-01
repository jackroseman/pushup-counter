import type { SupabaseClient } from '@supabase/supabase-js';

/** Same rule as the profiles.username check constraint. */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const DISPLAY_NAME_MAX = 40;

export interface Profile {
  id: string;
  username: string;
  displayName: string | null;
  timeZone: string;
}

/** What people type -> what we store: trimmed, lowercase, spaces to underscores. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '_');
}

/** A short message for an invalid username, or null when it is valid. Expects normalized input. */
export function usernameError(username: string): string | null {
  if (username.length < 3) return 'At least 3 characters.';
  if (username.length > 20) return 'At most 20 characters.';
  if (!USERNAME_RE.test(username)) return 'Letters, numbers and _ only.';
  return null;
}

export function displayNameError(name: string): string | null {
  return name.trim().length > DISPLAY_NAME_MAX ? `At most ${DISPLAY_NAME_MAX} characters.` : null;
}

/** A valid starting suggestion from the Apple name (if any), e.g. "Jack Roseman" -> "jackroseman_482". */
export function suggestUsername(name: string | null | undefined, random: () => number = Math.random): string {
  const base = (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 14);
  const stem = base.length >= 3 ? base : 'athlete';
  const digits = String(Math.floor(random() * 900) + 100);
  return `${stem}_${digits}`;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type Row = { id: string; username: string; display_name: string | null; time_zone: string };
const fromRow = (r: Row): Profile => ({ id: r.id, username: r.username, displayName: r.display_name, timeZone: r.time_zone });

/** The signed-in user's profile, or null if they have not picked a username yet. Throws on network errors. */
export async function fetchProfile(client: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await client
    .from('profiles')
    .select('id, username, display_name, time_zone')
    .eq('id', userId)
    .maybeSingle<Row>();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function isUsernameAvailable(client: SupabaseClient, username: string): Promise<boolean> {
  const { data, error } = await client.rpc('username_available', { p_username: username });
  if (error) throw new Error(error.message);
  return data === true;
}

export type SaveProfileResult = { ok: true; profile: Profile } | { ok: false; reason: 'taken' | 'invalid' | 'error'; message: string };

/** Map a PostgREST error to a user-facing result. */
export function profileErrorResult(error: { code?: string; message: string }): SaveProfileResult {
  if (error.code === '23505') return { ok: false, reason: 'taken', message: 'That username is taken.' };
  if (error.code === '23514') return { ok: false, reason: 'invalid', message: 'That name is not allowed.' };
  return { ok: false, reason: 'error', message: error.message };
}

/** Create (first time) or update the caller's profile. */
export async function saveProfile(
  client: SupabaseClient,
  p: { id: string; username: string; displayName: string; timeZone?: string },
  isNew: boolean,
): Promise<SaveProfileResult> {
  const row = {
    id: p.id,
    username: p.username,
    display_name: p.displayName.trim() || null,
    time_zone: p.timeZone ?? deviceTimeZone(),
  };
  const q = isNew
    ? client.from('profiles').insert(row).select('id, username, display_name, time_zone').single<Row>()
    : client.from('profiles').update(row).eq('id', p.id).select('id, username, display_name, time_zone').single<Row>();
  const { data, error } = await q;
  if (error) return profileErrorResult(error);
  return { ok: true, profile: fromRow(data) };
}
