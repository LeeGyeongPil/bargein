import { floatToPcm16 } from './pcm.js';
import { StreamResampler } from './resample.js';

/** DOM-free capture logic: device-rate Float32 in, fixed-size PCM16 chunks at the target rate out. */
export class CaptureCore {
  readonly inRate: number;
  readonly targetRate: number;
  readonly chunkSamples: number;
  private resampler: StreamResampler | null;
  private pending = new Float32Array(0);

  constructor(inRate: number, targetRate: number, chunkMs = 40) {
    if (!(chunkMs > 0)) throw new RangeError(`chunkMs must be positive, got ${chunkMs}`);
    this.inRate = inRate;
    this.targetRate = targetRate;
    this.chunkSamples = Math.max(1, Math.round((targetRate * chunkMs) / 1000));
    this.resampler = inRate === targetRate ? null : new StreamResampler(inRate, targetRate);
  }

  process(input: Float32Array): Int16Array[] {
    const rs = this.resampler ? this.resampler.push(input) : input;
    const all = new Float32Array(this.pending.length + rs.length);
    all.set(this.pending, 0);
    all.set(rs, this.pending.length);
    const chunks: Int16Array[] = [];
    let off = 0;
    while (all.length - off >= this.chunkSamples) {
      chunks.push(floatToPcm16(all.subarray(off, off + this.chunkSamples)));
      off += this.chunkSamples;
    }
    this.pending = all.slice(off);
    return chunks;
  }

  /** Remaining partial chunk (shorter than chunkMs), or null. */
  flush(): Int16Array | null {
    if (this.pending.length === 0) return null;
    const out = floatToPcm16(this.pending);
    this.pending = new Float32Array(0);
    return out;
  }
}
