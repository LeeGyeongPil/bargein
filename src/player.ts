import { BargeinError } from './errors.js';
import { loadWorklet, workletNodeCtor, type AudioWorkletNodeCtor } from './load-worklet.js';
import { bytesToPcm16, decodeBase64, pcm16ToFloat } from './pcm.js';
import type { PlaybackSnapshot } from './playback-core.js';
import { computeAudioEndMs } from './truncate.js';

export interface PlayerOptions {
  /** Sample rate of the audio you push (24000 for OpenAI/Gemini PCM16 output, 8000 for G.711). Default 24000. */
  sourceRate?: number;
  /** Buffer this much audio before (re)starting playback. Default 0. */
  jitterMs?: number;
  /** 'output' subtracts AudioContext.outputLatency from heard time (default); 'none' disables it. */
  latencyCompensation?: 'none' | 'output';
  /** URL of dist/worklets/player.js, for pages whose CSP blocks blob: URLs. */
  workletUrl?: string;
  /** Where to connect the player. Default ctx.destination. */
  destination?: AudioNode;
  /** AudioWorkletNode constructor of a non-browser Web Audio implementation (e.g. node-web-audio-api). */
  AudioWorkletNode?: AudioWorkletNodeCtor;
  /** How long position()/clear() wait for the worklet before falling back to the last known value. Default 1000. */
  queryTimeoutMs?: number;
}

export interface PlaybackPosition {
  itemId: string | null;
  contentIndex: number;
  /** Milliseconds of the item the worklet has rendered (counted in samples, not wall time). */
  playedMs: number;
  /** Milliseconds of the item received from the server so far. */
  receivedMs: number;
  /** playedMs minus output latency: what the listener has probably heard. */
  heardMs: number;
  /** Milliseconds of silence rendered because data arrived late. */
  underrunMs: number;
  /** True when the server has finished sending this item. */
  ended: boolean;
}

export interface ClearResult extends PlaybackPosition {
  /** Integer in 0..receivedMs, ready for conversation.item.truncate. */
  audioEndMs: number;
}

export type PlayerEvent = 'started' | 'drained' | 'underrun';

export interface Player {
  readonly sourceRate: number;
  /** Queue audio (Int16Array, ArrayBuffer of little-endian PCM16, or base64 PCM16) for an item. */
  push(itemId: string, audio: Int16Array | ArrayBuffer | string, contentIndex?: number): void;
  /** Tell the player the server finished sending this item. */
  endItem(itemId: string): void;
  /** Drop queued audio and report how much of the current item was played. */
  clear(): Promise<ClearResult>;
  position(): Promise<PlaybackPosition>;
  on(ev: PlayerEvent, fn: (p: PlaybackPosition) => void): () => void;
  close(): Promise<void>;
}

interface Pending { resolve: (s: PlaybackSnapshot) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }

export async function createPlayer(ctx: BaseAudioContext, opts: PlayerOptions = {}): Promise<Player> {
  const sourceRate = opts.sourceRate ?? 24000;
  if (!(sourceRate > 0)) throw new RangeError(`sourceRate must be positive, got ${sourceRate}`);
  const realtime = !('startRendering' in ctx);
  if (realtime && ctx.state === 'suspended') {
    await Promise.race([(ctx as AudioContext).resume?.(), new Promise((r) => setTimeout(r, 250))]).catch(() => undefined);
    if (ctx.state === 'suspended') {
      throw new BargeinError('CONTEXT_SUSPENDED', 'The AudioContext is suspended (browser autoplay policy). Call createPlayer() or audioContext.resume() from a user gesture such as a click.');
    }
  }
  const Ctor = workletNodeCtor(opts.AudioWorkletNode);
  await loadWorklet(ctx, 'player', opts.workletUrl);
  const node = new Ctor(ctx, 'bargein-player', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { srcRate: sourceRate, jitterSamples: Math.round(((opts.jitterMs ?? 0) * sourceRate) / 1000) },
  });
  node.connect(opts.destination ?? ctx.destination);

  const listeners: Record<PlayerEvent, Set<(p: PlaybackPosition) => void>> = { started: new Set(), drained: new Set(), underrun: new Set() };
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed = false;
  let last: PlaybackSnapshot = { itemId: null, contentIndex: 0, playedSrc: 0, receivedSrc: 0, ended: false, underrunFrames: 0, queuedSrc: 0, outFrames: 0 };
  const received = new Map<string, number>(); // main-thread fallback if the worklet cannot answer

  const latencyMs = () =>
    opts.latencyCompensation === 'none' ? 0 : Math.max(0, ((ctx as { outputLatency?: number }).outputLatency ?? 0) * 1000);

  function toPosition(s: PlaybackSnapshot): PlaybackPosition {
    const playedMs = (s.playedSrc / sourceRate) * 1000;
    return {
      itemId: s.itemId,
      contentIndex: s.contentIndex,
      playedMs,
      receivedMs: (s.receivedSrc / sourceRate) * 1000,
      heardMs: Math.max(0, playedMs - latencyMs()),
      underrunMs: (s.underrunFrames / ctx.sampleRate) * 1000,
      ended: s.ended,
    };
  }

  node.port.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'reply') {
      last = m.snapshot;
      const p = pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.id);
        p.resolve(m.snapshot);
      }
    } else if (m.type === 'event') {
      last = m.snapshot;
      const pos = toPosition(m.snapshot);
      for (const fn of listeners[m.name as PlayerEvent] ?? []) fn(pos);
    }
  };

  function request(type: 'clear' | 'query'): Promise<PlaybackSnapshot> {
    if (closed) return Promise.reject(new BargeinError('CLOSED', 'The player is closed.'));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        // The worklet did not answer (context suspended or torn down): use the last known state.
        pending.delete(id);
        const itemId = last.itemId;
        resolve({ ...last, receivedSrc: itemId ? (received.get(itemId) ?? last.receivedSrc) : last.receivedSrc });
      }, opts.queryTimeoutMs ?? 1000);
      pending.set(id, { resolve, reject, timer });
      node.port.postMessage({ type, id });
    });
  }

  return {
    sourceRate,
    push(itemId, audio, contentIndex = 0) {
      if (closed) throw new BargeinError('CLOSED', 'push() called on a closed player. Create a new player after close().');
      const pcm =
        typeof audio === 'string' ? bytesToPcm16(decodeBase64(audio))
        : audio instanceof Int16Array ? audio
        : bytesToPcm16(new Uint8Array(audio));
      received.set(itemId, (received.get(itemId) ?? 0) + pcm.length);
      if (received.size > 32) received.delete(received.keys().next().value as string);
      node.port.postMessage({ type: 'push', itemId, contentIndex, samples: pcm16ToFloat(pcm) });
    },
    endItem(itemId) {
      if (!closed) node.port.postMessage({ type: 'end', itemId });
    },
    async clear() {
      const pos = toPosition(await request('clear'));
      received.clear();
      const audioEndMs = pos.itemId === null ? 0 : computeAudioEndMs({ playedMs: pos.playedMs, receivedMs: pos.receivedMs, latencyMs: pos.playedMs - pos.heardMs });
      return { ...pos, audioEndMs };
    },
    async position() {
      return toPosition(await request('query'));
    },
    on(ev, fn) {
      listeners[ev].add(fn);
      return () => listeners[ev].delete(fn);
    },
    async close() {
      if (closed) return;
      closed = true;
      // Settle in-flight clear()/position() calls so nobody waits forever.
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new BargeinError('CLOSED', 'The player was closed while a request was in flight.'));
      }
      pending.clear();
      received.clear();
      node.port.postMessage({ type: 'close' }); // lets the worklet free its queue and stop processing
      node.port.onmessage = null;
      node.disconnect();
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}
