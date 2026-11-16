import { describe, expect, it } from 'vitest';
import { createGeminiBargeIn, toGeminiAudioStreamEnd, toGeminiRealtimeInput } from '../src/gemini.js';
import { fakePlayer, flush } from './fake-player.js';

const audioMsg = (data: string, rate = 24000) => ({
  serverContent: { modelTurn: { parts: [{ inlineData: { data, mimeType: `audio/pcm;rate=${rate}` } }] } },
});

describe('Gemini adapter', () => {
  it('pushes every inlineData part of a model turn', () => {
    const fp = fakePlayer();
    const g = createGeminiBargeIn({ player: fp.player });
    g.handleServerMessage({ serverContent: { modelTurn: { parts: [
      { text: 'hi' },
      { inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } },
      { inlineData: { data: 'AQA=', mimeType: 'audio/pcm;rate=24000' } },
    ] } } });
    expect(fp.pushes.map((p) => p.audio)).toEqual(['AAA=', 'AQA=']);
    expect(new Set(fp.pushes.map((p) => p.itemId)).size).toBe(1);
  });

  it('interrupted clears the player and the next turn gets a new item id', async () => {
    const fp = fakePlayer();
    const g = createGeminiBargeIn({ player: fp.player });
    g.handleServerMessage(audioMsg('AAA='));
    g.handleServerMessage({ serverContent: { interrupted: true } });
    await flush();
    g.handleServerMessage(audioMsg('AAA='));
    expect(fp.clears).toBe(1);
    expect(fp.pushes[0].itemId).not.toBe(fp.pushes[1].itemId);
  });

  it('turnComplete ends the item', () => {
    const fp = fakePlayer();
    const g = createGeminiBargeIn({ player: fp.player });
    g.handleServerMessage(audioMsg('AAA='));
    g.handleServerMessage({ serverContent: { turnComplete: true } });
    expect(fp.ended).toEqual([fp.pushes[0].itemId]);
  });

  it('accepts snake_case field names', () => {
    const fp = fakePlayer();
    const g = createGeminiBargeIn({ player: fp.player });
    g.handleServerMessage({ server_content: { model_turn: { parts: [{ inline_data: { data: 'AAA=', mime_type: 'audio/pcm;rate=24000' } }] } } });
    expect(fp.pushes.length).toBe(1);
  });

  it('reports a sample-rate mismatch with the fix', () => {
    const errs: unknown[] = [];
    const g = createGeminiBargeIn({ player: fakePlayer(24000).player, onError: (e) => errs.push(e) });
    g.handleServerMessage(audioMsg('AAA=', 16000));
    expect(String(errs[0])).toMatch(/sourceRate: 16000/);
  });

  it('builds realtimeInput messages', () => {
    expect(toGeminiRealtimeInput('QUJD')).toEqual({ realtimeInput: { audio: { data: 'QUJD', mimeType: 'audio/pcm;rate=16000' } } });
    expect(toGeminiAudioStreamEnd()).toEqual({ realtimeInput: { audioStreamEnd: true } });
  });

  it('ignores junk input', () => {
    const g = createGeminiBargeIn({ player: fakePlayer().player });
    expect(() => { g.handleServerMessage(null); g.handleServerMessage({ setupComplete: {} }); }).not.toThrow();
  });
});
