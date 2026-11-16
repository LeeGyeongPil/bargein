/**
 * Streaming linear resampler. Output sample n is taken at input position n * from / to,
 * so splitting the input into arbitrary chunks gives exactly the same output as one call.
 */
export class StreamResampler {
  fromRate: number;
  toRate: number;
  private carry = new Float32Array(0);
  private absStart = 0; // absolute input index of carry[0]
  private n = 0; // number of output samples produced

  constructor(fromRate: number, toRate: number) {
    if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError(`sample rates must be positive, got ${fromRate} -> ${toRate}`);
    this.fromRate = fromRate;
    this.toRate = toRate;
  }

  push(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.carry.length + input.length);
    buf.set(this.carry, 0);
    buf.set(input, this.carry.length);
    const out: number[] = [];
    for (;;) {
      const num = this.n * this.fromRate;
      const i0 = Math.floor(num / this.toRate);
      const local = i0 - this.absStart;
      if (local + 1 >= buf.length) break;
      const frac = (num % this.toRate) / this.toRate;
      out.push(buf[local] + (buf[local + 1] - buf[local]) * frac);
      this.n++;
    }
    const nextLocal = Math.max(0, Math.floor((this.n * this.fromRate) / this.toRate) - this.absStart);
    this.carry = buf.slice(Math.min(nextLocal, buf.length));
    this.absStart += Math.min(nextLocal, buf.length);
    return Float32Array.from(out);
  }

  reset(): void {
    this.carry = new Float32Array(0);
    this.absStart = 0;
    this.n = 0;
  }
}
