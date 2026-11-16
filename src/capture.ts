import { BargeinError } from './errors.js';
import { loadWorklet, workletNodeCtor, type AudioWorkletNodeCtor } from './load-worklet.js';
import { encodeBase64 } from './pcm.js';

export interface CaptureChunk {
  base64: string;
  pcm16: Int16Array;
  rate: number;
  durationMs: number;
}

export interface CaptureOptions {
  /** 24000 for OpenAI Realtime, 16000 for Gemini Live. */
  targetRate: 16000 | 24000;
  /** Chunk length in milliseconds. Default 40. */
  chunkMs?: number;
  onChunk: (c: CaptureChunk) => void;
  /** URL of dist/worklets/capture.js, for pages whose CSP blocks blob: URLs. */
  workletUrl?: string;
  /** AudioWorkletNode constructor of a non-browser Web Audio implementation. */
  AudioWorkletNode?: AudioWorkletNodeCtor;
}

export interface Capture {
  start(): void;
  stop(): void;
  close(): Promise<void>;
}

/**
 * Capture from a MediaStream or any AudioNode. The context keeps its own (device) sample rate;
 * the worklet resamples, so Firefox never sees a forced rate.
 */
export async function createCapture(ctx: BaseAudioContext, source: MediaStream | AudioNode, opts: CaptureOptions): Promise<Capture> {
  if (opts.targetRate !== 16000 && opts.targetRate !== 24000) {
    throw new RangeError(`targetRate must be 16000 or 24000, got ${String(opts.targetRate)}`);
  }
  const Ctor = workletNodeCtor(opts.AudioWorkletNode);
  await loadWorklet(ctx, 'capture', opts.workletUrl);
  const chunkMs = opts.chunkMs ?? 40;
  const node = new Ctor(ctx, 'bargein-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    processorOptions: { targetRate: opts.targetRate, chunkMs },
  });
  let input: AudioNode;
  let ownsInput = false;
  if ('getAudioTracks' in source) {
    const c = ctx as AudioContext;
    if (typeof c.createMediaStreamSource !== 'function') {
      throw new BargeinError('BAD_AUDIO', 'A MediaStream source needs a real-time AudioContext. Pass an AudioNode instead for offline contexts.');
    }
    input = c.createMediaStreamSource(source);
    ownsInput = true;
  } else {
    input = source;
  }
  input.connect(node);
  let closed = false;
  let stopResolve: (() => void) | null = null;

  const emit = (pcm16: Int16Array) =>
    opts.onChunk({ base64: encodeBase64(pcm16), pcm16, rate: opts.targetRate, durationMs: (pcm16.length / opts.targetRate) * 1000 });

  node.port.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'chunk') emit(m.pcm16);
    else if (m.type === 'stopped') {
      if (m.rest && m.rest.length > 0) emit(m.rest);
      stopResolve?.();
    }
  };

  return {
    start() {
      if (closed) throw new BargeinError('CLOSED', 'start() called on a closed capture.');
      node.port.postMessage({ type: 'start' });
    },
    stop() {
      if (!closed) node.port.postMessage({ type: 'stop' });
    },
    async close() {
      if (closed) return;
      // Ask the worklet to flush the partial chunk, but never hang if it is gone.
      await new Promise<void>((resolve) => {
        stopResolve = resolve;
        node.port.postMessage({ type: 'stop' });
        setTimeout(resolve, 200);
      });
      closed = true;
      node.port.postMessage({ type: 'close' }); // lets the worklet stop processing
      node.port.onmessage = null;
      input.disconnect(node);
      node.disconnect();
      if (ownsInput) input.disconnect();
    },
  };
}
