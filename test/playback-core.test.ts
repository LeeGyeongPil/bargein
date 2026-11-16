import { describe, expect, it } from 'vitest';
import { PlaybackCore } from '../src/index.js';
import { tone, zeroCrossHz } from './helpers.js';

const OUT = 48000;
function render(core: PlaybackCore, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 128) core.process(out.subarray(i, Math.min(frames, i + 128)));
  return out;
}

describe('PlaybackCore', () => {
  it('consumes 24000 source samples per 48000 output frames (no octave bug)', () => {
    const core = new PlaybackCore(24000, OUT);
    core.enqueue('a', 0, tone(440, 24000, 2));
    const out = render(core, 48000);
    expect(core.snapshot().playedSrc).toBeCloseTo(24000, 0);
    expect(Math.round(zeroCrossHz(out, OUT))).toBe(440);
  });

  it('burst then stall: sample counting reports 1800 ms where wall clock says 2500 ms', () => {
    const core = new PlaybackCore(24000, OUT);
    const all = tone(220, 24000, 3);
    core.enqueue('item', 0, all.subarray(0, 12000)); // 500 ms burst
    render(core, 1200 * 48); // 1200 ms stall: only 500 ms of audio exists
    core.enqueue('item', 0, all.subarray(12000)); // rest arrives
    render(core, 1300 * 48); // clear at 2500 ms after the first audio
    const snap = core.clear();
    const playedMs = (snap.playedSrc / 24000) * 1000;
    const receivedMs = (snap.receivedSrc / 24000) * 1000;
    const wallMs = 2500;
    expect(Math.abs(playedMs - 1800)).toBeLessThanOrEqual(3);
    expect(receivedMs).toBe(3000);
    expect(wallMs - playedMs).toBeGreaterThan(690);
    expect(wallMs - playedMs).toBeLessThan(710);
  });

  it('played does not grow during an underrun, and underrun frames are counted', () => {
    const core = new PlaybackCore(24000, OUT);
    core.enqueue('a', 0, tone(440, 24000, 0.1));
    render(core, 4800);
    const before = core.snapshot();
    render(core, 9600);
    const after = core.snapshot();
    expect(after.playedSrc).toBe(before.playedSrc);
    expect(after.underrunFrames - before.underrunFrames).toBe(9600);
    expect(core.takeEvents()).toEqual(['started', 'underrun']);
  });

  it('an ended item that drains emits drained and no underrun', () => {
    const core = new PlaybackCore(24000, OUT);
    core.enqueue('a', 0, tone(440, 24000, 0.1));
    core.markEnded('a');
    render(core, 9600);
    expect(core.takeEvents()).toEqual(['started', 'drained']);
    const s = core.snapshot();
    expect(s.underrunFrames).toBe(0);
    expect(s.ended).toBe(true);
    expect(s.playedSrc).toBe(s.receivedSrc);
  });

  it('clear empties the queue and returns silence afterwards', () => {
    const core = new PlaybackCore(24000, OUT);
    core.enqueue('a', 0, tone(440, 24000, 1));
    render(core, 4800);
    const snap = core.clear();
    expect(snap.itemId).toBe('a');
    expect(snap.queuedSrc).toBeGreaterThan(0);
    expect(core.snapshot().queuedSrc).toBe(0);
    expect(core.snapshot().itemId).toBeNull();
    expect(render(core, 480).every((v) => v === 0)).toBe(true);
  });

  it('tracks items separately and reports the one being played', () => {
    const core = new PlaybackCore(24000, OUT);
    core.enqueue('a', 0, tone(440, 24000, 0.1));
    core.enqueue('b', 1, tone(440, 24000, 0.5));
    render(core, 48 * 150); // 100 ms of a + 50 ms of b
    const s = core.snapshot();
    expect(s.itemId).toBe('b');
    expect(s.contentIndex).toBe(1);
    expect(s.receivedSrc).toBe(12000);
    expect(Math.abs(s.playedSrc - 1200)).toBeLessThan(3);
  });

  it('jitter buffer delays the start until enough audio is queued', () => {
    const core = new PlaybackCore(24000, OUT, { jitterSamples: 2400 });
    core.enqueue('a', 0, tone(440, 24000, 0.05)); // 1200 < 2400
    render(core, 4800);
    expect(core.snapshot().playedSrc).toBe(0);
    core.enqueue('a', 0, tone(440, 24000, 0.1));
    render(core, 480);
    expect(core.snapshot().playedSrc).toBeGreaterThan(0);
  });

  it('works for 44.1 kHz contexts (fractional ratio)', () => {
    const core = new PlaybackCore(24000, 44100);
    core.enqueue('a', 0, tone(440, 24000, 1));
    const out = render(core, 44100);
    expect(core.snapshot().playedSrc).toBeGreaterThan(23990);
    expect(Math.abs(zeroCrossHz(out.subarray(0, 44000), 44100) - 440)).toBeLessThan(3);
  });

  it('rejects bad rates', () => {
    expect(() => new PlaybackCore(0, 48000)).toThrow(RangeError);
  });
});
