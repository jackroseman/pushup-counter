import type { Battle } from './model';

const byId = new Map<string, Battle>();

/** Remember challenges the list already loaded so detail can paint before the refresh. */
export function rememberBattles(battles: readonly Battle[]): void {
  for (const battle of battles) byId.set(battle.id, battle);
}

export function rememberedBattle(id: string): Battle | undefined {
  return byId.get(id);
}

export function clearRememberedBattles(): void {
  byId.clear();
}
