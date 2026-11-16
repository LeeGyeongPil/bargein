import { describe, expect, it } from 'vitest';
import { bytesToMs, computeAudioEndMs } from '../src/index.js';

describe('computeAudioEndMs', () => {
  it('floors played time to an integer', () => {
    expect(computeAudioEndMs({ playedMs: 1804.6, receivedMs: 3000 })).toBe(1804);
  });
  it('clamps to the received length (server rejects larger values)', () => {
    expect(computeAudioEndMs({ playedMs: 5000, receivedMs: 1000 })).toBe(1000);
    expect(computeAudioEndMs({ playedMs: 5000, receivedMs: 1000.7 })).toBe(1000);
  });
  it('never goes negative after latency compensation', () => {
    expect(computeAudioEndMs({ playedMs: 20, receivedMs: 3000, latencyMs: 80 })).toBe(0);
    expect(computeAudioEndMs({ playedMs: 500, receivedMs: 3000, latencyMs: 80 })).toBe(420);
  });
  it('treats NaN and Infinity safely', () => {
    expect(computeAudioEndMs({ playedMs: NaN, receivedMs: 100 })).toBe(0);
    expect(computeAudioEndMs({ playedMs: 10, receivedMs: NaN })).toBe(0);
    expect(computeAudioEndMs({ playedMs: Infinity, receivedMs: 100 })).toBe(0);
  });
  it('always returns an integer in 0..receivedMs', () => {
    for (let i = 0; i < 500; i++) {
      const played = (i * 37.31) % 4000 - 200;
      const received = (i * 11.7) % 3000;
      const v = computeAudioEndMs({ playedMs: played, receivedMs: received, latencyMs: i % 90 });
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(Math.floor(received));
    }
  });
});

describe('bytesToMs', () => {
  it('counts pcm16 at 24 kHz and G.711 at 8 kHz', () => {
    expect(bytesToMs(48000, 'pcm16')).toBe(1000);
    expect(bytesToMs(8000, 'g711_ulaw')).toBe(1000);
    expect(bytesToMs(8000, 'g711_alaw')).toBe(1000);
    expect(bytesToMs(32000, 'pcm16', 16000)).toBe(1000);
  });
  it('rejects a bad rate', () => {
    expect(() => bytesToMs(10, 'pcm16', 0)).toThrow(RangeError);
  });
});
