import type { KeyValueStore } from '../storage/history';

/** Random per-install id (reset on reinstall). Not tied to the hardware or to the account. */
export const INSTALLATION_ID_KEY = 'installationId.v1';

export function newInstallationId(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(random() * 16).toString(16);
  return s;
}

export async function getInstallationId(kv: KeyValueStore, random: () => number = Math.random): Promise<string> {
  const existing = await kv.getItem(INSTALLATION_ID_KEY);
  if (existing && /^[0-9a-f]{32}$/.test(existing)) return existing;
  const id = newInstallationId(random);
  await kv.setItem(INSTALLATION_ID_KEY, id);
  return id;
}
