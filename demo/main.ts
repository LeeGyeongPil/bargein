// Demo page: connect to a (mock) realtime WebSocket, play the response and interrupt it.
import { createPlayer, type Player } from '../src/index.js';
import { createOpenAIBargeIn, type OpenAIBargeIn } from '../src/openai.js';
import { STORAGE_KEY, resolveLang, saveLang, t, type Lang, type MessageKey } from './i18n.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const TOTAL_MS = 3000; // the mock response is 3 s long; bars are scaled to it

let lang: Lang = resolveLang({ search: location.search, stored: localStorage.getItem(STORAGE_KEY), navigatorLanguage: navigator.language });
let statusKey: MessageKey = 'disconnected';

function applyLang(): void {
  document.documentElement.lang = lang;
  ($('lang') as HTMLSelectElement).value = lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(lang, el.dataset.i18n as MessageKey); });
  $('status').textContent = t(lang, statusKey);
}
$('lang').addEventListener('change', (e) => {
  lang = (e.target as HTMLSelectElement).value as Lang;
  saveLang(localStorage, lang); // remembered for the next visit
  applyLang();
});
applyLang();

// demo/run.mjs passes the real mock server address; a static build has no value and keeps the HTML default.
const mockUrl = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_BARGEIN_MOCK_URL;
if (mockUrl) ($('url') as HTMLInputElement).value = mockUrl;

const logBox = $('log');
function log(dir: 'sent' | 'received', ev: unknown): void {
  const copy = JSON.parse(JSON.stringify(ev));
  if (typeof copy.delta === 'string') copy.delta = copy.delta.slice(0, 12) + '...'; // keep the log readable
  logBox.textContent += `${t(lang, dir)}: ${JSON.stringify(copy)}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function bar(id: string, ms: number): void {
  $(`bar-${id}`).style.width = `${Math.min(100, (ms / TOTAL_MS) * 100)}%`;
  $(`val-${id}`).textContent = `${Math.round(ms)} ${t(lang, 'ms')}`;
}

let ctx: AudioContext | null = null;
let player: Player | null = null;
let adapter: OpenAIBargeIn | null = null;
let ws: WebSocket | null = null;
let firstAudioAt: number | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

async function disconnect(): Promise<void> {
  if (poll) clearInterval(poll);
  poll = null;
  ws?.close();
  ws = null;
  await player?.close();
  await ctx?.close();
  player = null; ctx = null; adapter = null;
  statusKey = 'disconnected';
  ($('play') as HTMLButtonElement).disabled = true;
  ($('interrupt') as HTMLButtonElement).disabled = true;
  $('connect').textContent = t(lang, 'connect');
  applyLang();
}

$('connect').addEventListener('click', async () => {
  if (ws) return disconnect();
  ctx = new AudioContext(); // created inside the click handler: allowed to start audio
  player = await createPlayer(ctx);
  const send = (ev: object) => { log('sent', ev); ws?.send(JSON.stringify(ev)); };
  adapter = createOpenAIBargeIn({ player, send });
  ws = new WebSocket(($('url') as HTMLInputElement).value);
  ws.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    log('received', ev);
    if (ev.type === 'response.output_audio.delta' && firstAudioAt === null) firstAudioAt = performance.now();
    adapter?.handleServerEvent(ev);
  };
  ws.onopen = () => {
    statusKey = 'connected';
    ($('play') as HTMLButtonElement).disabled = false;
    ($('interrupt') as HTMLButtonElement).disabled = false;
    $('connect').textContent = t(lang, 'disconnect');
    applyLang();
  };
  ws.onclose = () => { if (ws) void disconnect(); };
  poll = setInterval(async () => { // live bars while playing
    if (!player) return;
    const p = await player.position();
    if (p.itemId === null) return;
    bar('received', p.receivedMs);
    bar('played', p.playedMs);
    bar('wall', firstAudioAt === null ? 0 : performance.now() - firstAudioAt);
  }, 100);
});

$('play').addEventListener('click', () => {
  firstAudioAt = null;
  ws?.send(JSON.stringify({ mock: 'config', burstMs: 500, stallMs: ($('stall') as HTMLInputElement).checked ? 1200 : 0 }));
  const ev = { type: 'response.create' };
  log('sent', ev);
  ws?.send(JSON.stringify(ev));
});

$('interrupt').addEventListener('click', async () => {
  if (!adapter) { $('summary').textContent = t(lang, 'needGesture'); return; }
  if (firstAudioAt === null) { $('summary').textContent = t(lang, 'needResponse'); return; }
  const wallMs = performance.now() - firstAudioAt;
  const r = await adapter.bargeIn();
  if (!r) { $('summary').textContent = t(lang, 'nothingPlaying'); return; }
  bar('received', r.receivedMs);
  bar('played', r.playedMs);
  bar('wall', wallMs);
  const wallSend = Math.min(Math.floor(wallMs), Math.floor(r.receivedMs));
  $('summary').textContent =
    `${t(lang, 'sentValue')}: ${r.audioEndMs} | ${t(lang, 'wallValue')}: ${wallSend} (${t(lang, 'overReport')} ${wallSend - r.audioEndMs} ${t(lang, 'ms')})`;
});

// Octave bug check: the same 24 kHz 440 Hz data in a buffer declared at 48 kHz (wrong) and at 24 kHz (right).
async function renderTone(bufferRate: number): Promise<{ hz: number; ms: number }> {
  const data = new Float32Array(24000);
  for (let i = 0; i < data.length; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 24000);
  const off = new OfflineAudioContext(1, 48000, 48000);
  const buf = off.createBuffer(1, data.length, bufferRate);
  buf.copyToChannel(data, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = (await off.startRendering()).getChannelData(0);
  let end = out.length;
  while (end > 0 && Math.abs(out[end - 1]) < 1e-4) end--;
  let zc = 0;
  for (let i = 1; i < end; i++) if (out[i - 1] < 0 !== out[i] < 0) zc++;
  return { hz: Math.round(zc / 2 / (end / 48000)), ms: Math.round(end / 48) };
}
$('octave').addEventListener('click', async () => {
  const wrong = await renderTone(48000);
  const right = await renderTone(24000);
  $('octave-wrong').textContent = t(lang, 'octaveResult', wrong);
  $('octave-right').textContent = t(lang, 'octaveResult', right);
});
