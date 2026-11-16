// Minimal browser integration with OpenAI Realtime over WebSocket (through your own relay server).
import { createCapture, createPlayer } from 'bargein';
import { createOpenAIBargeIn, toOpenAIAppend } from 'bargein/openai';

export async function start(relayUrl: string): Promise<() => Promise<void>> {
  const ctx = new AudioContext(); // call from a click handler
  const ws = new WebSocket(relayUrl);
  const player = await createPlayer(ctx); // 24 kHz PCM16 output
  const bargein = createOpenAIBargeIn({ player, send: (ev) => ws.send(JSON.stringify(ev)) });
  ws.onmessage = (m) => bargein.handleServerEvent(JSON.parse(m.data)); // audio, cancel and truncate handled here

  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const capture = await createCapture(ctx, stream, {
    targetRate: 24000,
    onChunk: (c) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(toOpenAIAppend(c.base64))),
  });
  capture.start();

  return async () => { // stop everything
    await capture.close();
    stream.getTracks().forEach((t) => t.stop());
    await player.close();
    ws.close();
    await ctx.close();
  };
}
