// npm run lesson: keyless demonstration of why bargein counts played samples instead of wall-clock time.
// Uses a local practice mock server and node-web-audio-api (a real audio render thread, no sound device).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nwa from 'node-web-audio-api';
import { createPlayer } from '../dist/index.js';
import { createOpenAIBargeIn } from '../dist/openai.js';
import { startMockServer } from '../mock/server.mjs';
import { runBargeInScenario } from './scenario.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const burstMs = Number(process.env.BARGEIN_BURST_MS ?? 500);
const stallMs = Number(process.env.BARGEIN_STALL_MS ?? 1200);

console.log(`bargein lesson: practice mock server (not the real OpenAI service), no API key needed`);
console.log(`scenario: ${burstMs} ms of audio arrives at once, then a ${stallMs} ms network stall, then the rest; the user interrupts 2.5 s after the first audio\n`);

const server = await startMockServer({ port: 0, burstMs, stallMs });
let r;
try {
  r = await runBargeInScenario({
    AudioContext: nwa.AudioContext, AudioWorkletNode: nwa.AudioWorkletNode,
    createPlayer, createOpenAIBargeIn,
    playerWorkletUrl: path.join(root, 'dist/worklets/player.js'),
    mockUrl: server.url,
  });
} finally {
  await server.close();
}

const pad = (s, n) => String(s).padEnd(n);
const ms = (v) => `${Math.round(v)} ms`;
console.log(`${pad('', 34)}value`);
console.log(`${pad('received (server sent)', 34)}${ms(r.receivedMs)}`);
console.log(`${pad('wall-clock (since first audio)', 34)}${ms(r.wallMs)}`);
console.log(`${pad('played (samples)', 34)}${ms(r.playedMs)}`);
console.log(`${pad('sent audio_end_ms (bargein)', 34)}${r.sentAudioEndMs}`);
console.log(`${pad('wall-clock method would send', 34)}${r.wallClockAudioEndMs}   <- over-reports by ${r.wallClockAudioEndMs - r.sentAudioEndMs} ms the model thinks the user heard\n`);
console.log('mock server replies:');
for (const e of r.replies) {
  if (e.type === 'conversation.item.truncated') console.log(`  conversation.item.truncated:${e.audio_end_ms}   (bargein value accepted)`);
  else if (e.type === 'error') console.log(`  error: ${e.error.message}   (sent ${r.unclampedAudioEndMs}: no clamp to the received length)`);
}
process.exit(0); // native audio threads keep the event loop alive otherwise
