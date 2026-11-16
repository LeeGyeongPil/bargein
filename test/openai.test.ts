import { describe, expect, it } from 'vitest';
import { bytesToMs, encodeBase64 } from '../src/index.js';
import { createOpenAIBargeIn, toOpenAIAppend } from '../src/openai.js';
import { fakePlayer, flush } from './fake-player.js';

describe('OpenAI adapter', () => {
  it('pushes GA and beta audio delta events', () => {
    const fp = fakePlayer();
    const a = createOpenAIBargeIn({ player: fp.player, send: () => {} });
    a.handleServerEvent({ type: 'response.output_audio.delta', item_id: 'i1', content_index: 2, delta: 'AAA=' });
    a.handleServerEvent({ type: 'response.audio.delta', item_id: 'i1', delta: 'AQA=' });
    expect(fp.pushes).toEqual([
      { itemId: 'i1', audio: 'AAA=', contentIndex: 2 },
      { itemId: 'i1', audio: 'AQA=', contentIndex: 0 },
    ]);
  });

  it('on speech_started sends exactly cancel then truncate with the computed audio_end_ms', async () => {
    const fp = fakePlayer(24000, { itemId: 'item_9', contentIndex: 1, playedMs: 1804.6, receivedMs: 3000, audioEndMs: 1804 });
    const sent: object[] = [];
    const a = createOpenAIBargeIn({ player: fp.player, send: (e) => sent.push(e) });
    a.handleServerEvent({ type: 'response.output_audio.delta', item_id: 'item_9', content_index: 1, delta: 'AAA=' });
    a.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    await flush();
    expect(sent).toEqual([
      { type: 'response.cancel' },
      { type: 'conversation.item.truncate', item_id: 'item_9', content_index: 1, audio_end_ms: 1804 },
    ]);
    expect(fp.clears).toBe(1);
  });

  it('a second speech_started while one is being handled does not double-send', async () => {
    const fp = fakePlayer();
    const sent: object[] = [];
    const a = createOpenAIBargeIn({ player: fp.player, send: (e) => sent.push(e) });
    a.handleServerEvent({ type: 'response.created' });
    a.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    a.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    await flush();
    expect(sent.length).toBe(2);
  });

  it('does not truncate an item that already drained, and skips cancel once the response is done', async () => {
    const fp = fakePlayer(24000, { ended: true, playedMs: 3000, receivedMs: 3000, audioEndMs: 3000 });
    const sent: object[] = [];
    const a = createOpenAIBargeIn({ player: fp.player, send: (e) => sent.push(e) });
    a.handleServerEvent({ type: 'response.output_audio.delta', item_id: 'item_1', delta: 'AAA=' });
    a.handleServerEvent({ type: 'response.output_audio.done', item_id: 'item_1' });
    a.handleServerEvent({ type: 'response.done' });
    a.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    await flush();
    expect(fp.ended).toEqual(['item_1']);
    expect(sent).toEqual([]);
  });

  it('sends nothing when nothing was playing', async () => {
    const fp = fakePlayer(24000, { itemId: null });
    const sent: object[] = [];
    const a = createOpenAIBargeIn({ player: fp.player, send: (e) => sent.push(e) });
    a.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    await flush();
    expect(sent).toEqual([]);
  });

  it('drops late deltas of a truncated item', async () => {
    const fp = fakePlayer(24000, { itemId: 'item_1' });
    const a = createOpenAIBargeIn({ player: fp.player, send: () => {} });
    a.handleServerEvent({ type: 'response.output_audio.delta', item_id: 'item_1', delta: 'AAA=' });
    a.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    await flush();
    a.handleServerEvent({ type: 'response.output_audio.delta', item_id: 'item_1', delta: 'AAA=' });
    a.handleServerEvent({ type: 'response.output_audio.delta', item_id: 'item_2', delta: 'AAA=' });
    expect(fp.pushes.map((p) => p.itemId)).toEqual(['item_1', 'item_2']);
  });

  it('cancelOnBargeIn:false sends only the truncate', async () => {
    const fp = fakePlayer();
    const sent: Array<{ type: string }> = [];
    const a = createOpenAIBargeIn({ player: fp.player, send: (e) => sent.push(e as { type: string }), cancelOnBargeIn: false });
    a.handleServerEvent({ type: 'response.created' });
    await a.bargeIn();
    expect(sent.map((s) => s.type)).toEqual(['conversation.item.truncate']);
  });

  it('counts G.711 output at 8 kHz, 1 byte per sample', () => {
    const fp = fakePlayer(8000);
    const a = createOpenAIBargeIn({ player: fp.player, send: () => {}, outputFormat: 'g711_ulaw' });
    const bytes = new Uint8Array(8000).fill(0xff);
    a.handleServerEvent({ type: 'response.output_audio.delta', item_id: 'i', delta: encodeBase64(bytes) });
    const pushed = fp.pushes[0].audio as Int16Array;
    expect(pushed).toBeInstanceOf(Int16Array);
    expect(pushed.length).toBe(8000);
    expect((pushed.length / 8000) * 1000).toBe(bytesToMs(8000, 'g711_ulaw'));
  });

  it('refuses G.711 with a 24 kHz player and explains the fix', () => {
    expect(() => createOpenAIBargeIn({ player: fakePlayer(24000).player, send: () => {}, outputFormat: 'g711_alaw' })).toThrow(/sourceRate: 8000/);
  });

  it('reports errors through onError instead of throwing into the socket handler', () => {
    const fp = fakePlayer();
    fp.player.push = () => { throw new Error('boom'); };
    const errs: unknown[] = [];
    const a = createOpenAIBargeIn({ player: fp.player, send: () => {}, onError: (e) => errs.push(e) });
    a.handleServerEvent({ type: 'response.output_audio.delta', item_id: 'i', delta: 'AAA=' });
    expect(errs.length).toBe(1);
  });

  it('ignores junk input', () => {
    const a = createOpenAIBargeIn({ player: fakePlayer().player, send: () => {} });
    expect(() => { a.handleServerEvent(null); a.handleServerEvent('x'); a.handleServerEvent({}); }).not.toThrow();
  });

  it('builds input_audio_buffer.append', () => {
    expect(toOpenAIAppend('QUJD')).toEqual({ type: 'input_audio_buffer.append', audio: 'QUJD' });
  });
});
