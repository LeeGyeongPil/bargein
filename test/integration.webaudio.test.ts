import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCapture, createPlayer } from '../src/index.js';
import { createOpenAIBargeIn } from '../src/openai.js';
import { captureWorkletSource, playerWorkletSource } from '../src/generated/worklet-sources.js';
import * as nwaTyped from 'node-web-audio-api';
import { runBargeInScenario } from '../examples/scenario.mjs';
import { startMockServer } from '../mock/server.mjs';
import { zeroCrossHz } from './helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nwa: any = nwaTyped;

// Real render thread (node-web-audio-api) running the real AudioWorklet bundles; no sound device, no keys.
let dir = '';
let playerUrl = '';
let captureUrl = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bargein-'));
  writeFileSync(path.join(dir, 'player.js'), playerWorkletSource);
  writeFileSync(path.join(dir, 'capture.js'), captureWorkletSource);
  playerUrl = path.join(dir, 'player.js'); // node-web-audio-api takes file paths
  captureUrl = path.join(dir, 'capture.js');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('real render thread', () => {
  it('barge-in sends the sample-counted audio_end_ms, the mock accepts it and rejects the unclamped one', async () => {
    const server = await startMockServer({ port: 0, burstMs: 500, stallMs: 1200 });
    try {
      const r = await runBargeInScenario({
        AudioContext: nwa.AudioContext, AudioWorkletNode: nwa.AudioWorkletNode,
        createPlayer, createOpenAIBargeIn, playerWorkletUrl: playerUrl, mockUrl: server.url,
      });
      expect(r.wallMs - r.playedMs).toBeGreaterThanOrEqual(500);
      expect(Number.isInteger(r.sentAudioEndMs)).toBe(true);
      expect(r.sentAudioEndMs).toBe(Math.floor(r.playedMs));
      expect(r.sentAudioEndMs).toBeLessThanOrEqual(r.receivedMs);
      // The mock finished generating at 1.7 s (faster than real time), so there is nothing to cancel, only to truncate.
      expect(r.sent.map((e) => e.type)).toEqual(['response.create', 'conversation.item.truncate']);
      const ok = r.replies.find((e) => e.type === 'conversation.item.truncated');
      expect(ok?.audio_end_ms).toBe(r.sentAudioEndMs);
      const bad = r.replies.find((e) => e.type === 'error');
      expect(bad?.error.message).toContain('audio_end_ms exceeds');
    } finally {
      await server.close();
    }
  }, 30000);

  it('while the response is still generating, barge-in sends cancel and then truncate clamped to what arrived', async () => {
    const server = await startMockServer({ port: 0, burstMs: 500, stallMs: 5000 });
    try {
      const r = await runBargeInScenario({
        AudioContext: nwa.AudioContext, AudioWorkletNode: nwa.AudioWorkletNode,
        createPlayer, createOpenAIBargeIn, playerWorkletUrl: playerUrl, mockUrl: server.url, bargeAtMs: 1500,
      });
      expect(r.sent.map((e) => e.type)).toEqual(['response.create', 'response.cancel', 'conversation.item.truncate']);
      expect(r.receivedMs).toBeCloseTo(500, -1);
      expect(r.sentAudioEndMs).toBeLessThanOrEqual(500);
      expect(r.replies.some((e) => e.type === 'conversation.item.truncated')).toBe(true);
    } finally {
      await server.close();
    }
  }, 30000);

  it.each([[24000, 960], [16000, 640]] as const)('capture worklet turns a 48 kHz 440 Hz oscillator into %i Hz chunks of %i samples', async (rate, samples) => {
    const ctx = new nwa.AudioContext({ sampleRate: 48000, sinkId: { type: 'none' } });
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const chunks: Int16Array[] = [];
    const cap = await createCapture(ctx, osc, {
      targetRate: rate, workletUrl: captureUrl, AudioWorkletNode: nwa.AudioWorkletNode,
      onChunk: (c) => chunks.push(c.pcm16),
    });
    try {
      osc.start();
      cap.start();
      const t0 = Date.now();
      while (chunks.length < 8 && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
      expect(chunks.length).toBeGreaterThanOrEqual(8);
      for (const c of chunks.slice(0, 7)) expect(c.length).toBe(samples);
      const all = chunks.slice(0, 7).flatMap((c) => Array.from(c));
      expect(Math.abs(zeroCrossHz(all, rate) - 440)).toBeLessThan(15);
    } finally {
      await cap.close();
      osc.stop();
      await ctx.close();
    }
  }, 30000);

  it('a closed player rejects push with CLOSED and a bad worklet URL gives WORKLET_LOAD_FAILED', async () => {
    const ctx = new nwa.AudioContext({ sinkId: { type: 'none' } });
    try {
      await expect(createPlayer(ctx, { workletUrl: 'file:///nonexistent/player.js', AudioWorkletNode: nwa.AudioWorkletNode }))
        .rejects.toMatchObject({ code: 'WORKLET_LOAD_FAILED' });
      const p = await createPlayer(ctx, { workletUrl: playerUrl, AudioWorkletNode: nwa.AudioWorkletNode });
      expect(() => p.push('a', new Int16Array(3).buffer.slice(0, 3))).toThrow(/even number of bytes/);
      await p.close();
      expect(() => p.push('a', new Int16Array(2))).toThrow(/closed/);
      await expect(p.clear()).rejects.toMatchObject({ code: 'CLOSED' });
    } finally {
      await ctx.close();
    }
  }, 30000);

  it('close() settles an in-flight clear() with CLOSED instead of leaving it pending', async () => {
    const ctx = new nwa.AudioContext({ sinkId: { type: 'none' } });
    try {
      const p = await createPlayer(ctx, { workletUrl: playerUrl, AudioWorkletNode: nwa.AudioWorkletNode });
      const inflight = p.clear();
      const rejected = expect(inflight).rejects.toMatchObject({ code: 'CLOSED' });
      await p.close();
      await rejected;
    } finally {
      await ctx.close();
    }
  }, 30000);

  it.each([['player', 'bargein-player', { srcRate: 24000, jitterSamples: 0 }, 1, 1], ['capture', 'bargein-capture', { targetRate: 24000, chunkMs: 40 }, 1, 0]] as const)(
    'the %s worklet acknowledges a close message so its processor can be released',
    async (name, proc, processorOptions, nIn, nOut) => {
      const ctx = new nwa.AudioContext({ sinkId: { type: 'none' } });
      try {
        await ctx.audioWorklet.addModule(name === 'player' ? playerUrl : captureUrl);
        const node = new nwa.AudioWorkletNode(ctx, proc, { numberOfInputs: name === 'player' ? 0 : nIn, numberOfOutputs: nOut, processorOptions });
        const got = new Promise<string>((resolve) => { node.port.onmessage = (e: MessageEvent) => { if (e.data.type === 'closed') resolve('closed'); }; });
        node.port.postMessage({ type: 'close' });
        const result = await Promise.race([got, new Promise<string>((r) => setTimeout(() => r('timeout'), 5000))]);
        expect(result).toBe('closed');
      } finally {
        await ctx.close();
      }
    }, 30000);
});
