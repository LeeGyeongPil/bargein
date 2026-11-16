import { describe, expect, it } from 'vitest';
import { CaptureCore, encodeBase64, pcm16ToFloat } from '../src/index.js';
import { tone, zeroCrossHz } from './helpers.js';

function run(target: number, blockFrames: number) {
  const core = new CaptureCore(48000, target, 40);
  const mic = tone(440, 48000, 1);
  const chunks: Int16Array[] = [];
  for (let i = 0; i < mic.length; i += blockFrames) chunks.push(...core.process(mic.subarray(i, i + blockFrames)));
  return { core, chunks };
}

describe('CaptureCore', () => {
  it('emits 40 ms chunks: 960 samples @24k (2560 base64 chars), 640 @16k (1708 chars)', () => {
    for (const [rate, samples, chars] of [[24000, 960, 2560], [16000, 640, 1708]] as const) {
      const { chunks } = run(rate, 128);
      expect(chunks.length).toBe(25);
      for (const c of chunks) {
        expect(c.length).toBe(samples);
        expect(encodeBase64(c).length).toBe(chars);
      }
    }
  });

  it('block size does not change the output', () => {
    const a = run(24000, 128).chunks;
    const b = run(24000, 480).chunks;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toEqual(b[i]);
  });

  it('keeps 440 Hz after resampling', () => {
    const { chunks } = run(16000, 128);
    const all = chunks.flatMap((c) => Array.from(pcm16ToFloat(c)));
    expect(Math.round(zeroCrossHz(all, 16000))).toBe(440);
  });

  it('flush returns the partial remainder once', () => {
    const core = new CaptureCore(24000, 24000, 40);
    expect(core.process(tone(440, 24000, 0.05)).length).toBe(1);
    expect(core.flush()?.length).toBe(240);
    expect(core.flush()).toBeNull();
  });

  it('rejects a non-positive chunkMs', () => {
    expect(() => new CaptureCore(48000, 24000, 0)).toThrow(RangeError);
  });
});
