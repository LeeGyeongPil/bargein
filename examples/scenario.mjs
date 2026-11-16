// The "wall clock vs played samples" scenario shared by `npm run lesson` and the integration test.
// Dependencies are injected so the same code runs against src/ (tests) and dist/ (lesson).
import { WebSocket } from 'ws';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream a mock response (burst, stall, rest), barge in `bargeAtMs` after the first audio arrives,
 * and report what each method would have sent as audio_end_ms.
 */
export async function runBargeInScenario(deps) {
  const { AudioContext, AudioWorkletNode, createPlayer, createOpenAIBargeIn, playerWorkletUrl, mockUrl, bargeAtMs = 2500 } = deps;

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive', sinkId: { type: 'none' } }); // no sound device needed
  const player = await createPlayer(ctx, { workletUrl: playerWorkletUrl, AudioWorkletNode });
  let clearResult = null;
  const realClear = player.clear.bind(player);
  player.clear = async () => (clearResult = await realClear());

  const ws = new WebSocket(mockUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

  const sent = [];
  const replies = [];
  const send = (ev) => { sent.push(ev); ws.send(JSON.stringify(ev)); };
  const adapter = createOpenAIBargeIn({ player, send });
  let firstAudioAt = null;
  let wallMsAtBargeIn = null;
  const waiters = [];
  ws.on('message', (raw) => {
    const ev = JSON.parse(raw.toString());
    if (ev.type === 'response.output_audio.delta' && firstAudioAt === null) firstAudioAt = performance.now();
    if (ev.type === 'input_audio_buffer.speech_started') wallMsAtBargeIn = performance.now() - firstAudioAt;
    if (ev.type?.startsWith('conversation.item.') || ev.type === 'error') {
      replies.push(ev);
      for (const w of waiters.splice(0)) w();
    }
    adapter.handleServerEvent(ev);
  });
  const nextReply = () => new Promise((r) => waiters.push(r));

  try {
    send({ type: 'response.create' });
    while (firstAudioAt === null) await sleep(5);
    await sleep(Math.max(0, bargeAtMs - (performance.now() - firstAudioAt)));
    const truncated = nextReply();
    ws.send(JSON.stringify({ mock: 'speech_started' })); // the mock server plays the role of server VAD
    await truncated;

    // What a client would get without the clamp: wall-clock time plus a little, past the received length.
    const naive = Math.ceil(wallMsAtBargeIn) + 2000;
    const errored = nextReply();
    ws.send(JSON.stringify({ type: 'conversation.item.truncate', item_id: clearResult.itemId, content_index: 0, audio_end_ms: naive }));
    await errored;

    const truncate = sent.find((e) => e.type === 'conversation.item.truncate');
    return {
      wallMs: wallMsAtBargeIn,
      playedMs: clearResult.playedMs,
      receivedMs: clearResult.receivedMs,
      sentAudioEndMs: truncate?.audio_end_ms,
      wallClockAudioEndMs: Math.min(Math.floor(wallMsAtBargeIn), Math.floor(clearResult.receivedMs)),
      unclampedAudioEndMs: naive,
      sent,
      replies,
    };
  } finally {
    ws.close();
    await player.close();
    await ctx.close();
  }
}
