import { decodeBase64, g711ToPcm16, type PcmFormat } from './pcm.js';
import type { ClearResult, Player } from './player.js';
import { BargeinError } from './errors.js';

// Event names in one place. GA names first, then the older beta aliases.
const AUDIO_DELTA = ['response.output_audio.delta', 'response.audio.delta'];
const AUDIO_DONE = ['response.output_audio.done', 'response.audio.done'];
const SPEECH_STARTED = 'input_audio_buffer.speech_started';
const RESPONSE_CREATED = 'response.created';
const RESPONSE_DONE = 'response.done';

export interface OpenAIBargeInOptions {
  player: Player;
  /** Send a client event (JSON-serialise it yourself). */
  send: (event: object) => void;
  /** Output audio format of the session. Default 'pcm16'. G.711 needs a player created with sourceRate: 8000. */
  outputFormat?: PcmFormat;
  /** Send response.cancel on barge-in. Default true. Set false if your session cancels automatically. */
  cancelOnBargeIn?: boolean;
  /** Called when handling an event fails. Default: console.error. */
  onError?: (err: unknown) => void;
}

export interface OpenAIBargeIn {
  /** Feed every parsed server event here. */
  handleServerEvent(ev: unknown): void;
  /** Cut off playback now (also called automatically on input_audio_buffer.speech_started). */
  bargeIn(): Promise<ClearResult | null>;
}

export function toOpenAIAppend(base64: string): { type: 'input_audio_buffer.append'; audio: string } {
  return { type: 'input_audio_buffer.append', audio: base64 };
}

interface Ev { type?: string; item_id?: string; content_index?: number; delta?: string }

export function createOpenAIBargeIn(o: OpenAIBargeInOptions): OpenAIBargeIn {
  const format = o.outputFormat ?? 'pcm16';
  const onError = o.onError ?? ((e: unknown) => console.error('[bargein]', e));
  if (format !== 'pcm16' && o.player.sourceRate !== 8000) {
    throw new BargeinError('BAD_AUDIO', `outputFormat "${format}" is 8 kHz audio: create the player with createPlayer(ctx, { sourceRate: 8000 }).`);
  }
  const cutItems = new Set<string>(); // items already truncated; late deltas for them are dropped
  let responseActive = false;
  let inflight: Promise<ClearResult | null> | null = null;

  function bargeIn(): Promise<ClearResult | null> {
    if (inflight) return inflight;
    // Cancel first so the server stops generating while we measure the playback position.
    if (responseActive && o.cancelOnBargeIn !== false) o.send({ type: 'response.cancel' });
    responseActive = false;
    inflight = (async () => {
      const r = await o.player.clear();
      if (r.itemId === null) return null;
      cutItems.add(r.itemId);
      if (r.ended && r.playedMs >= r.receivedMs) return r; // fully played: nothing to truncate
      o.send({ type: 'conversation.item.truncate', item_id: r.itemId, content_index: r.contentIndex, audio_end_ms: r.audioEndMs });
      return r;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  function handleServerEvent(raw: unknown): void {
    const ev = raw as Ev | null;
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') return;
    try {
      if (AUDIO_DELTA.includes(ev.type)) {
        if (typeof ev.item_id !== 'string' || typeof ev.delta !== 'string' || cutItems.has(ev.item_id)) return;
        responseActive = true;
        const idx = ev.content_index ?? 0;
        if (format === 'pcm16') o.player.push(ev.item_id, ev.delta, idx);
        else o.player.push(ev.item_id, g711ToPcm16(decodeBase64(ev.delta), format), idx);
      } else if (AUDIO_DONE.includes(ev.type)) {
        if (typeof ev.item_id === 'string') o.player.endItem(ev.item_id);
      } else if (ev.type === RESPONSE_CREATED) {
        responseActive = true;
      } else if (ev.type === RESPONSE_DONE) {
        responseActive = false;
      } else if (ev.type === SPEECH_STARTED) {
        bargeIn().catch(onError);
      }
    } catch (err) {
      onError(err);
    }
  }

  return { handleServerEvent, bargeIn };
}

