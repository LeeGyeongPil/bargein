import { BargeinError } from './errors.js';
import type { Player } from './player.js';

export interface GeminiBargeIn {
  /** Feed every parsed server message (the JSON object) here. */
  handleServerMessage(msg: unknown): void;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const pick = (o: Obj, camel: string, snake: string): unknown => o[camel] ?? o[snake];

/** Base64 PCM16 chunk (16 kHz mono) as a Live API realtimeInput message. */
export function toGeminiRealtimeInput(base64: string, rate: 16000 = 16000): { realtimeInput: { audio: { data: string; mimeType: string } } } {
  return { realtimeInput: { audio: { data: base64, mimeType: `audio/pcm;rate=${rate}` } } };
}

/** Tell the server the mic stream paused (for example the user muted). */
export function toGeminiAudioStreamEnd(): { realtimeInput: { audioStreamEnd: true } } {
  return { realtimeInput: { audioStreamEnd: true } };
}

export function createGeminiBargeIn(o: { player: Player; onError?: (err: unknown) => void }): GeminiBargeIn {
  const onError = o.onError ?? ((e: unknown) => console.error('[bargein]', e));
  let turn = 1;
  const itemId = () => `gemini-turn-${turn}`;

  function handleServerMessage(raw: unknown): void {
    if (!isObj(raw)) return;
    const sc = pick(raw, 'serverContent', 'server_content');
    if (!isObj(sc)) return;
    try {
      if (pick(sc, 'interrupted', 'interrupted') === true) {
        // The server already dropped what it was generating; there is nothing to send back.
        o.player.clear().catch(onError);
        turn++;
        return;
      }
      const modelTurn = pick(sc, 'modelTurn', 'model_turn');
      const parts = isObj(modelTurn) && Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
      for (const part of parts) {
        const inline = isObj(part) ? pick(part, 'inlineData', 'inline_data') : null;
        if (!isObj(inline) || typeof inline.data !== 'string') continue;
        const mime = String(pick(inline, 'mimeType', 'mime_type') ?? '');
        const m = /rate=(\d+)/.exec(mime);
        if (m && Number(m[1]) !== o.player.sourceRate) {
          throw new BargeinError('BAD_AUDIO', `Model audio is ${m[1]} Hz but the player was created with sourceRate ${o.player.sourceRate}. Use createPlayer(ctx, { sourceRate: ${m[1]} }).`);
        }
        o.player.push(itemId(), inline.data);
      }
      if (pick(sc, 'turnComplete', 'turn_complete') === true) {
        o.player.endItem(itemId());
        turn++;
      }
    } catch (err) {
      onError(err);
    }
  }

  return { handleServerMessage };
}
