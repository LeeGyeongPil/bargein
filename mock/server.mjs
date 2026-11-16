// Practice mock of a realtime voice WebSocket server (NOT the real OpenAI / Gemini service).
// It sends audio faster than real time (a burst), stalls, then sends the rest, and it rejects
// conversation.item.truncate values larger than the audio it sent, like the real API.
//
//   node mock/server.mjs --protocol openai --burst-ms 500 --stall-ms 1200
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { stepTone, toBase64 } from './tones.mjs';

const RATE = 24000;

export async function startMockServer(opts = {}) {
  const {
    port = Number(process.env.BARGEIN_MOCK_PORT ?? 8787),
    host = '127.0.0.1',
    protocol = 'openai',
    burstMs = Number(process.env.BARGEIN_BURST_MS ?? 500),
    stallMs = Number(process.env.BARGEIN_STALL_MS ?? 1200),
    totalMs = 3000,
    chunkMs = 100,
  } = opts;
  if (protocol !== 'openai' && protocol !== 'gemini') throw new Error(`protocol must be "openai" or "gemini", got "${protocol}"`);

  const wss = new WebSocketServer({ port, host });
  await new Promise((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); });
  const events = []; // every client message, for tests and the demo log

  wss.on('connection', (sock) => {
    const timers = new Set();
    let sentSamples = 0;
    let itemCounter = 0;
    let itemId = null;
    let started = false;
    const cfg = { burstMs, stallMs }; // a client can change these with {mock:'config', ...}

    const send = (o) => { if (sock.readyState === 1) sock.send(JSON.stringify(o)); };
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const stopStreaming = () => { for (const t of timers) clearTimeout(t); timers.clear(); };

    function sendChunk(samples) {
      sentSamples += samples.length;
      const b64 = toBase64(samples);
      if (protocol === 'openai') send({ type: 'response.output_audio.delta', item_id: itemId, content_index: 0, delta: b64 });
      else send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: `audio/pcm;rate=${RATE}`, data: b64 } }] } } });
    }

    function startResponse() {
      if (started) return;
      started = true;
      itemId = `item_${++itemCounter}`;
      sentSamples = 0;
      const audio = stepTone(totalMs, RATE);
      const per = (RATE * chunkMs) / 1000;
      let next = 0;
      const sendUpTo = (limitMs) => {
        while (next < audio.length && (next / RATE) * 1000 < limitMs) {
          sendChunk(audio.subarray(next, next + per));
          next += per;
        }
      };
      if (protocol === 'openai') send({ type: 'response.created', response: { id: 'resp_1' } });
      sendUpTo(cfg.burstMs); // burst: audio is generated faster than real time
      later(cfg.stallMs, () => { // network stall, then everything else at once
        sendUpTo(Infinity);
        if (protocol === 'openai') {
          send({ type: 'response.output_audio.done', item_id: itemId, content_index: 0 });
          send({ type: 'response.done', response: { id: 'resp_1', status: 'completed' } });
        } else send({ serverContent: { turnComplete: true } });
        started = false;
      });
    }

    sock.on('message', (raw) => {
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch { return send({ type: 'error', error: { message: 'invalid JSON' } }); }
      events.push(ev);
      if (ev.mock === 'config') {
        if (Number.isFinite(ev.burstMs)) cfg.burstMs = ev.burstMs;
        if (Number.isFinite(ev.stallMs)) cfg.stallMs = ev.stallMs;
      } else if (ev.mock === 'speech_started') {
        stopStreaming();
        started = false;
        if (protocol === 'openai') send({ type: 'input_audio_buffer.speech_started', audio_start_ms: 0, item_id: 'item_user' });
        else send({ serverContent: { interrupted: true } });
      } else if (protocol === 'openai') {
        if (ev.type === 'response.create') startResponse();
        else if (ev.type === 'response.cancel') {
          stopStreaming();
          started = false;
          send({ type: 'response.done', response: { id: 'resp_1', status: 'cancelled' } });
        } else if (ev.type === 'conversation.item.truncate') {
          const receivedMs = (sentSamples / RATE) * 1000;
          if (!Number.isInteger(ev.audio_end_ms) || ev.audio_end_ms < 0) {
            send({ type: 'error', error: { message: 'audio_end_ms must be a non-negative integer' } });
          } else if (ev.audio_end_ms > receivedMs) {
            send({ type: 'error', error: { message: `audio_end_ms exceeds the audio sent for this item (${Math.floor(receivedMs)} ms)` } });
          } else {
            send({ type: 'conversation.item.truncated', item_id: ev.item_id, content_index: ev.content_index, audio_end_ms: ev.audio_end_ms });
          }
        }
      } else if (ev.clientContent) startResponse(); // gemini: a client turn starts the response
    });
    sock.on('close', stopStreaming);
  });

  return {
    port: wss.address().port,
    url: `ws://${host}:${wss.address().port}`,
    events,
    async close() {
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => wss.close(r));
    },
  };
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startMockServer({
    protocol: argValue('--protocol') ?? 'openai',
    burstMs: argValue('--burst-ms') ? Number(argValue('--burst-ms')) : undefined,
    stallMs: argValue('--stall-ms') ? Number(argValue('--stall-ms')) : undefined,
    port: argValue('--port') ? Number(argValue('--port')) : undefined,
  });
  console.log(`practice mock server (not the real service) listening on ${server.url}`);
  process.on('SIGINT', () => server.close().then(() => process.exit(0)));
}
