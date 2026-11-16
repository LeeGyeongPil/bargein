export interface AudioEndInput {
  /** Milliseconds of the item that were actually rendered (sample-counted). */
  playedMs: number;
  /** Milliseconds of the item that the server has sent so far. */
  receivedMs: number;
  /** Output latency to subtract so the value reflects what was heard (default 0). */
  latencyMs?: number;
}

/**
 * Value for `audio_end_ms` of `conversation.item.truncate`: an integer in 0..receivedMs.
 * The server rejects values larger than the audio it generated, so the result is clamped.
 */
export function computeAudioEndMs(i: AudioEndInput): number {
  const heard = i.playedMs - (i.latencyMs ?? 0);
  const received = Number.isFinite(i.receivedMs) ? Math.max(0, Math.floor(i.receivedMs)) : 0;
  if (!Number.isFinite(heard)) return 0;
  return Math.max(0, Math.min(received, Math.floor(heard)));
}
