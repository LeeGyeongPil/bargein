import type { ClearResult, Player, PlayerEvent } from '../src/index.js';

type PushCall = { itemId: string; audio: unknown; contentIndex: number };

/** Minimal Player double: records calls and returns a scripted clear() result. */
export function fakePlayer(sourceRate = 24000, clearResult: Partial<ClearResult> = {}) {
  const pushes: PushCall[] = [];
  const ended: string[] = [];
  let clears = 0;
  const result: ClearResult = {
    itemId: 'item_1', contentIndex: 0, playedMs: 1804.6, receivedMs: 3000, heardMs: 1804.6,
    underrunMs: 0, ended: false, audioEndMs: 1804, ...clearResult,
  };
  const player: Player = {
    sourceRate,
    push(itemId, audio, contentIndex = 0) { pushes.push({ itemId, audio, contentIndex }); },
    endItem(itemId) { ended.push(itemId); },
    async clear() { clears++; return result; },
    async position() { return result; },
    on(_ev: PlayerEvent) { return () => undefined; },
    async close() {},
  };
  return { player, pushes, ended, get clears() { return clears; } };
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
