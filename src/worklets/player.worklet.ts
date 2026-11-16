import { PlaybackCore } from '../playback-core.js';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: unknown): void;

// Thin wrapper: all logic lives in PlaybackCore (unit-tested without a browser).
class BargeinPlayerProcessor extends AudioWorkletProcessor {
  core: PlaybackCore;
  alive = true;
  constructor(options: { processorOptions: { srcRate: number; jitterSamples: number } }) {
    super();
    const o = options.processorOptions;
    this.core = new PlaybackCore(o.srcRate, sampleRate, { jitterSamples: o.jitterSamples });
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'push') this.core.enqueue(m.itemId, m.contentIndex, m.samples);
      else if (m.type === 'end') this.core.markEnded(m.itemId);
      else if (m.type === 'clear') this.port.postMessage({ type: 'reply', id: m.id, snapshot: this.core.clear() });
      else if (m.type === 'close') {
        // Free the queue and let process() return false so the engine can collect this processor.
        this.core.clear();
        this.alive = false;
        this.port.postMessage({ type: 'closed' });
      } else if (m.type === 'query') this.port.postMessage({ type: 'reply', id: m.id, snapshot: this.core.snapshot() });
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const ch = outputs[0];
    this.core.process(ch[0]);
    for (let c = 1; c < ch.length; c++) ch[c].set(ch[0]);
    const events = this.core.takeEvents();
    if (events.length > 0) {
      const snapshot = this.core.snapshot();
      for (const name of events) this.port.postMessage({ type: 'event', name, snapshot });
    }
    return this.alive;
  }
}
registerProcessor('bargein-player', BargeinPlayerProcessor);
