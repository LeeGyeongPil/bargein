// Minimal browser integration with Gemini Live over WebSocket (through your own relay server).
import { createCapture, createPlayer } from 'bargein';
import { createGeminiBargeIn, toGeminiRealtimeInput } from 'bargein/gemini';

export async function start(relayUrl: string): Promise<() => Promise<void>> {
  const ctx = new AudioContext(); // call from a click handler
  const ws = new WebSocket(relayUrl);
  const player = await createPlayer(ctx); // Gemini speaks 24 kHz PCM16
  const gemini = createGeminiBargeIn({ player });
  ws.onmessage = async (m) => {
    const text = typeof m.data === 'string' ? m.data : await (m.data as Blob).text(); // Live API frames may be binary
    gemini.handleServerMessage(JSON.parse(text)); // interrupted clears the queue; nothing to send back
  };

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const capture = await createCapture(ctx, stream, {
    targetRate: 16000, // Gemini input is 16 kHz
    onChunk: (c) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(toGeminiRealtimeInput(c.base64))),
  });
  capture.start();

  return async () => {
    await capture.close();
    stream.getTracks().forEach((t) => t.stop());
    await player.close();
    ws.close();
    await ctx.close();
  };
}
