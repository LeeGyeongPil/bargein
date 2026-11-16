import { describe, expect, it } from 'vitest';
import { StreamResampler, floatToPcm16 } from '../src/index.js';
import { tone, zeroCrossHz } from './helpers.js';

describe('StreamResampler', () => {
  it('48k -> 24k and 48k -> 16k keep exact one-second sample counts', () => {
    const one = tone(440, 48000, 1);
    expect(new StreamResampler(48000, 24000).push(one).length).toBe(24000);
    expect(new StreamResampler(48000, 16000).push(one).length).toBe(16000);
  });

  it('keeps the 440 Hz pitch', () => {
    const out = new StreamResampler(48000, 24000).push(tone(440, 48000, 1));
    expect(Math.round(zeroCrossHz(out, 24000))).toBe(440);
  });

  it('chunked input gives bit-identical output to one-shot, even for odd ratios', () => {
    const src = tone(440, 44100, 1);
    for (const to of [16000, 24000]) {
      const whole = new StreamResampler(44100, to).push(src);
      const r = new StreamResampler(44100, to);
      const parts: Float32Array[] = [];
      for (let i = 0; i < src.length; ) {
        const n = 1 + ((i * 7) % 500); // ragged chunk sizes, including 1
        parts.push(r.push(src.subarray(i, i + n)));
        i += n;
      }
      const joined = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for (const p of parts) { joined.set(p, o); o += p.length; }
      expect(joined.length).toBe(whole.length);
      expect(joined).toEqual(whole);
    }
  });

  it('reset starts over', () => {
    const r = new StreamResampler(48000, 24000);
    const a = r.push(tone(440, 48000, 0.1));
    r.reset();
    expect(r.push(tone(440, 48000, 0.1))).toEqual(a);
  });

  it('rejects non-positive rates', () => {
    expect(() => new StreamResampler(0, 24000)).toThrow(RangeError);
  });

  it('output is usable as PCM16', () => {
    expect(floatToPcm16(new StreamResampler(48000, 16000).push(tone(440, 48000, 0.04))).length).toBe(640);
  });
});
