import { describe, expect, it } from 'vitest';
import {
  BargeinError, bytesToPcm16, decodeBase64, encodeBase64, floatToPcm16, g711ToPcm16, pcm16ToFloat,
} from '../src/index.js';

describe('PCM16', () => {
  it('clips +-1.0 to 32767 / -32768 and beyond-range to the same', () => {
    const out = floatToPcm16(new Float32Array([1, -1, 0, 2, -3]));
    expect(Array.from(out)).toEqual([32767, -32768, 0, 32767, -32768]);
  });

  it('round-trips through float within one LSB', () => {
    const src = new Int16Array([0, 1, -1, 12345, -12345, 32767, -32768]);
    const back = floatToPcm16(pcm16ToFloat(src));
    for (let i = 0; i < src.length; i++) expect(Math.abs(back[i] - src[i])).toBeLessThanOrEqual(1);
  });
});

describe('base64', () => {
  it('matches known vectors', () => {
    expect(encodeBase64(new Uint8Array([]))).toBe('');
    expect(encodeBase64(new Uint8Array([0x66]))).toBe('Zg==');
    expect(encodeBase64(new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]))).toBe('Zm9vYmFy');
    expect(encodeBase64(new Int16Array([1, -2]))).toBe('AQD+/w==');
  });

  it('decodes back, including large buffers', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(decodeBase64(encodeBase64(big))).toEqual(big);
  });

  it('rejects invalid base64 with BAD_AUDIO', () => {
    expect(() => decodeBase64('***not base64***')).toThrow(BargeinError);
    try { decodeBase64('%%%'); } catch (e) { expect((e as BargeinError).code).toBe('BAD_AUDIO'); }
  });

  it('rejects odd byte counts for PCM16', () => {
    expect(() => bytesToPcm16(new Uint8Array(3))).toThrow(/even number of bytes/);
    expect(Array.from(bytesToPcm16(new Uint8Array([1, 0, 0xfe, 0xff])))).toEqual([1, -2]);
  });
});

describe('G.711', () => {
  it('decodes mu-law and A-law reference points', () => {
    expect(Array.from(g711ToPcm16(new Uint8Array([0xff, 0x7f, 0x00, 0x80]), 'g711_ulaw'))).toEqual([0, 0, -32124, 32124]);
    expect(Array.from(g711ToPcm16(new Uint8Array([0xd5, 0x55]), 'g711_alaw'))).toEqual([8, -8]);
  });
});
