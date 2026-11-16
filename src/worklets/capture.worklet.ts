import { CaptureCore } from '../capture-core.js';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: unknown): void;

class BargeinCaptureProcessor extends AudioWorkletProcessor {
  core: CaptureCore;
  active = false;
  alive = true;
  constructor(options: { processorOptions: { targetRate: number; chunkMs: number } }) {
    super();
    const o = options.processorOptions;
    this.core = new CaptureCore(sampleRate, o.targetRate, o.chunkMs);
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'start') this.active = true;
      else if (e.data.type === 'stop') {
        this.active = false;
        const rest = this.core.flush();
        this.port.postMessage({ type: 'stopped', rest });
      } else if (e.data.type === 'close') {
        this.active = false;
        this.alive = false;
        this.port.postMessage({ type: 'closed' });
      }
    };
  }
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0] && inputs[0][0];
    if (this.active && input) {
      for (const pcm16 of this.core.process(input)) this.port.postMessage({ type: 'chunk', pcm16 });
    }
    return this.alive;
  }
}
registerProcessor('bargein-capture', BargeinCaptureProcessor);
